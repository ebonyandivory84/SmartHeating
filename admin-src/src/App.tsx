import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  ThemeProvider,
  Tooltip,
  Typography
} from '@mui/material';
import {
  AccountTree,
  AutoGraph,
  BatteryChargingFull,
  CheckCircle,
  CloudSync,
  DataObject,
  ErrorOutlined,
  History,
  PlayArrow,
  Save,
  Settings,
  Tune
} from '@mui/icons-material';
import {
  DialogSelectID,
  GenericApp,
  type AdminConnection,
  type GenericAppProps,
  type GenericAppState,
  type IobTheme,
  type ThemeName,
  type ThemeType
} from '@iobroker/adapter-react-v5';
import { Theme } from '@iobroker/adapter-react-v5/build/Theme';
import ioPackage from '../../io-package.json';

type NativeConfig = ioBroker.AdapterConfig;

interface HistoryRow {
  semanticId: string;
  label: string;
  stateId: string;
  required: boolean;
  historyRequired: boolean;
  exists: boolean;
  fresh: boolean;
  historyEnabled: boolean;
  historyReadable: boolean;
  historySamples: number;
  issue?: string;
}

interface Diagnostics {
  readiness?: { score?: number; state?: string; blockers?: Array<{ semanticId: string; issue?: string }> };
  history?: HistoryRow[];
  context?: Record<string, unknown>;
  plan?: { recommendation?: string; explanation?: string; decisionTree?: Array<Record<string, unknown>>; schedule?: Array<Record<string, unknown>> };
  vcontrold?: Record<string, unknown>;
}

interface SignalField {
  key: keyof NativeConfig;
  label: string;
  group: string;
  description: string;
  required?: boolean;
}

const signals: SignalField[] = [
  { key: 'pvPowerState', label: 'PV-Leistung aktuell', group: 'EKD Solar – produktiv', required: true, description: 'Produktiver friendly-State; die alte Solar-Familie bleibt ausschließlich historische Quelle.' },
  { key: 'housePowerState', label: 'Hausverbrauch aktuell', group: 'EKD Solar – produktiv', required: true, description: 'Gesamter Hausverbrauch. Es wird aktuell kein separater Wärmepumpenzähler vorausgesetzt.' },
  { key: 'gridPowerState', label: 'Netzleistung signed', group: 'EKD Solar – produktiv', required: true, description: 'Vorzeichenbehafteter Netzfluss.' },
  { key: 'batteryPowerState', label: 'Batterieleistung signed', group: 'EKD Solar – produktiv', required: true, description: 'Positiv = Entladung, negativ = Ladung.' },
  { key: 'batterySocState', label: 'Batterie-SOC', group: 'EKD Solar – produktiv', required: true, description: 'Aktueller Ladezustand der 20-kWh-Batterie.' },
  { key: 'historicalPvPowerState', label: 'PV-Leistung historisch', group: 'Alte Solar-State-Familie', description: 'Historische Messreihe vor dem Wechsel zu ekd-solar.' },
  { key: 'historicalHousePowerState', label: 'Hausverbrauch historisch', group: 'Alte Solar-State-Familie', description: 'Historische Messreihe vor dem Adapterwechsel.' },
  { key: 'historicalBatterySocState', label: 'Batterie-SOC historisch', group: 'Alte Solar-State-Familie', description: 'Historische SOC-Messreihe.' },
  { key: 'historicalBatteryChargeState', label: 'Batterieladung historisch', group: 'Alte Solar-State-Familie', description: 'Wird mit Entladung zum historischen signed-Signal verrechnet.' },
  { key: 'historicalBatteryDischargeState', label: 'Batterieentladung historisch', group: 'Alte Solar-State-Familie', description: 'Wird mit Ladung zum historischen signed-Signal verrechnet.' },
  { key: 'dhwTemperatureState', label: 'Warmwassertemperatur', group: 'Viessmann Cloud / Wärmepumpe', required: true, description: 'Speichertemperatur für Komfort, Physikmodell und Ereigniserkennung.' },
  { key: 'dhwNormalTargetState', label: 'Warmwasser-Soll normal', group: 'Viessmann Cloud / Wärmepumpe', required: true, description: 'Normaler Sollwert.' },
  { key: 'dhwTemp2TargetState', label: 'Warmwasser-Soll temp-2', group: 'Viessmann Cloud / Wärmepumpe', required: true, description: 'Erhöhter Sollwert, nur mit separaten Schutzregeln.' },
  { key: 'dhwChargingState', label: 'Warmwasserbereitung aktiv', group: 'Viessmann Cloud / Wärmepumpe', required: true, description: 'Grenzt reale DHW-Heizereignisse ab.' },
  { key: 'compressorActiveState', label: 'Kompressor aktiv', group: 'Viessmann Cloud / Wärmepumpe', required: true, description: 'Verdichterstatus.' },
  { key: 'compressorModulationState', label: 'Kompressor-Modulation', group: 'Viessmann Cloud / Wärmepumpe', description: 'Übergangssignal, bis lokale vcontrold-Leistung verfügbar ist.' },
  { key: 'hk1SupplyTemperatureState', label: 'HK1 Vorlauf', group: 'Viessmann Cloud / Wärmepumpe', required: true, description: 'Direkter HK1-Vorlauf; nicht der vermutlich HK2-/Sekundärkreis-State.' },
  { key: 'returnTemperatureState', label: 'Heizungsrücklauf', group: 'Viessmann Cloud / Wärmepumpe', required: true, description: 'Basis des thermischen Gebäudemodells.' },
  { key: 'hk1PumpState', label: 'HK1 Pumpe', group: 'Viessmann Cloud / Wärmepumpe', required: true, description: 'Erkennt Heizphasen.' },
  { key: 'hk1ScheduleState', label: 'HK1 Schedule Cache', group: 'Viessmann Cloud / Wärmepumpe', required: true, description: 'Read-only Baseline aus dem bestehenden SmartHeating-Skript.' },
  { key: 'indoorTemperatureState', label: 'Innentemperatur primär', group: 'Klima', required: true, description: 'Sainlogic bleibt Primärquelle; Fallback ist der Mittelwert frischer ESPHome-Sensoren.' },
  { key: 'outsideTemperatureState', label: 'Außentemperatur', group: 'Klima', required: true, description: 'Aktueller realer Klimazustand.' },
  { key: 'solarRadiationState', label: 'Solarstrahlung', group: 'Klima', required: true, description: 'Wichtig für passive Solargewinne und weiche Regime.' },
  { key: 'pvForecastState', label: 'PV-Prognose JSON', group: 'Forecast & Kontext', required: true, description: 'Forecast-Snapshots müssen historisiert sein, damit Backtests leakage-frei bleiben.' },
  { key: 'pvForecastIssuedAtState', label: 'PV-Prognose Ausgabezeit', group: 'Forecast & Kontext', required: true, description: 'Zeitpunkt, zu dem der Forecast bekannt war.' },
  { key: 'weatherForecastState', label: 'Wetterprognose JSON', group: 'Forecast & Kontext', description: 'Optional, aber für Temperaturtrend und Strahlungsprognose empfohlen.' },
  { key: 'holidayState', label: 'Feiertag', group: 'Forecast & Kontext', description: 'Nutzungs- und Bedarfsmodell.' }
];

const vcontroldFields: SignalField[] = [
  { key: 'vcontroldDhwTemperatureState', label: 'Warmwassertemperatur lokal', group: 'vcontrold', description: 'Lokaler Vitocal-200-Speicherfühler.' },
  { key: 'vcontroldHk1SupplyTemperatureState', label: 'HK1 Vorlauf lokal', group: 'vcontrold', description: 'Lokaler HK1-Vorlauf.' },
  { key: 'vcontroldReturnTemperatureState', label: 'Rücklauf lokal', group: 'vcontrold', description: 'Lokaler Heizungsrücklauf.' },
  { key: 'vcontroldHk1PumpState', label: 'HK1 Pumpe lokal', group: 'vcontrold', description: 'Lokaler Pumpenstatus.' },
  { key: 'vcontroldHeatpumpPowerState', label: 'Wärmepumpe Gesamtleistung', group: 'vcontrold', description: 'Exakte elektrische Gesamtaufnahme – ändert die Messgrenze und verlangt Neukalibrierung.' },
  { key: 'vcontroldCompressorPowerState', label: 'Kompressorleistung', group: 'vcontrold', description: 'Exakte elektrische Verdichterleistung.' },
  { key: 'vcontroldElectricHeaterPowerState', label: 'Heizstableistung', group: 'vcontrold', description: 'Exakte elektrische Heizstableistung.' },
  { key: 'vcontroldCompressorModulationState', label: 'Kompressor-Modulation lokal', group: 'vcontrold', description: 'Lokale Frequenz/Modulation.' }
];

const emptyDiagnostics: Diagnostics = {};

export class App extends GenericApp<GenericAppProps, GenericAppState> {
  constructor(props: GenericAppProps) {
    super(props, {
      adapterName: 'smartheating',
      bottomButtons: false,
      doNotLoadAllObjects: false
    });
  }

  createTheme(): IobTheme {
    return Theme('dark');
  }

  render(): React.JSX.Element {
    if (!this.state.loaded) return super.render();

    return (
      <ThemeProvider theme={this.state.theme}>
        <>
          <SmartHeatingConfig
            adapterInstance={`smartheating.${this.instance}`}
            changed={this.state.changed}
            config={this.state.native as NativeConfig}
            onSave={() => this.onSave(false)}
            onUpdate={(key, value) => this.updateNativeValue(String(key), value)}
            socket={this.socket}
            theme={this.state.theme}
            themeName={this.state.themeName}
            themeType={this.state.themeType}
          />
          {this.renderHelperDialogs()}
        </>
      </ThemeProvider>
    );
  }
}

interface SmartHeatingConfigProps {
  adapterInstance: string;
  changed: boolean;
  config: NativeConfig;
  onSave: () => void;
  onUpdate: <K extends keyof NativeConfig>(key: K, value: NativeConfig[K]) => void;
  socket: AdminConnection;
  theme: IobTheme;
  themeName: ThemeName;
  themeType: ThemeType;
}

function SmartHeatingConfig({
  adapterInstance,
  changed,
  config,
  onSave,
  onUpdate,
  socket,
  theme,
  themeName,
  themeType
}: SmartHeatingConfigProps): React.JSX.Element {
  const [diagnostics, setDiagnostics] = useState<Diagnostics>(emptyDiagnostics);
  const [tab, setTab] = useState(0);
  const [picker, setPicker] = useState<{ key: keyof NativeConfig; multi: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ severity: 'success' | 'warning' | 'error' | 'info'; text: string } | null>(null);
  const [historyDialog, setHistoryDialog] = useState(false);
  const [historyConfirmation, setHistoryConfirmation] = useState('');

  const refreshDiagnostics = useCallback(async () => {
    try {
      const result = await socket.sendTo<Diagnostics>(adapterInstance, 'getDiagnostics', {});
      setDiagnostics(result ?? emptyDiagnostics);
    } catch {
      setDiagnostics(emptyDiagnostics);
    }
  }, [adapterInstance, socket]);

  useEffect(() => {
    void refreshDiagnostics();
  }, [refreshDiagnostics]);

  const update = <K extends keyof NativeConfig>(key: K, value: NativeConfig[K]): void => {
    onUpdate(key, value);
  };

  const save = (): void => {
    onSave();
    setMessage({ severity: 'info', text: 'Konfiguration wird durch ioBroker gespeichert.' });
  };

  const runNow = async (): Promise<void> => {
    setBusy(true);
    try {
      await socket.sendTo(adapterInstance, 'runNow', {});
      await refreshDiagnostics();
      setMessage({ severity: 'success', text: 'Readiness und Planung wurden neu berechnet.' });
    } catch (error) {
      setMessage({ severity: 'warning', text: `Adapter nicht erreichbar: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const enableMissingHistory = async (): Promise<void> => {
    const stateIds = (diagnostics.history ?? []).filter(row => row.historyRequired && !row.historyEnabled && row.stateId).map(row => row.stateId);
    setBusy(true);
    try {
      await socket.sendTo(adapterInstance, 'enableHistory', { confirmation: historyConfirmation, stateIds });
      setHistoryDialog(false);
      setHistoryConfirmation('');
      await refreshDiagnostics();
      setMessage({ severity: 'success', text: `${stateIds.length} konfigurierte Datenpunkte wurden für InfluxDB angefordert und anschließend erneut geprüft.` });
    } catch (error) {
      setMessage({ severity: 'error', text: `Historisierung konnte nicht aktiviert werden: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const score = diagnostics.readiness?.score ?? 0;
  const missingHistory = (diagnostics.history ?? []).filter(row => row.historyRequired && Boolean(row.stateId) && !row.historyEnabled);
  const renderSignalRows = (fields: SignalField[]) => {
    const groups = [...new Set(fields.map(field => field.group))];
    return groups.map(group => (
      <Card key={group} variant="outlined" className="section-card">
        <CardContent>
          <Typography variant="h6" gutterBottom>{group}</Typography>
          <Stack spacing={2}>
            {fields.filter(field => field.group === group).map(field => (
              <Box className="signal-row" key={String(field.key)}>
                <Box className="signal-copy">
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Typography sx={{ fontWeight: 600 }}>{field.label}</Typography>
                    {field.required && <Chip size="small" color="primary" label="erforderlich" />}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">{field.description}</Typography>
                </Box>
                <TextField fullWidth size="small" value={String(config[field.key] ?? '')} onChange={event => update(field.key, event.target.value as never)} />
                <Button variant="outlined" onClick={() => setPicker({ key: field.key, multi: false })}>Objektbrowser</Button>
              </Box>
            ))}
          </Stack>
        </CardContent>
      </Card>
    ));
  };

  return (
      <Box className="app-shell">
        <Box className="topbar">
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <img className="logo" src="smartheating.svg" alt="SmartHeating" />
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>SmartHeating</Typography>
              <Typography variant="body2" color="text.secondary">Erklärbarer EnergyPlanner · Observe/Shadow · keine produktiven Schreibzugriffe</Typography>
            </Box>
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button startIcon={<PlayArrow />} variant="outlined" onClick={() => void runNow()} disabled={busy}>Neu prüfen</Button>
            <Button startIcon={<Save />} variant="contained" onClick={save} disabled={busy || !changed}>Speichern</Button>
          </Stack>
        </Box>

        {message && <Alert severity={message.severity} onClose={() => setMessage(null)}>{message.text}</Alert>}
        <Alert severity="info">Version {ioPackage.common.version} erzeugt ausschließlich Empfehlungen, Status- und Audit-States. Externe Viessmann-, Batterie- oder Heizungs-States werden nie automatisch beschrieben.</Alert>

        <Tabs className="main-tabs" value={tab} onChange={(_, value: number) => setTab(value)} variant="scrollable" scrollButtons="auto">
          <Tab icon={<CheckCircle />} iconPosition="start" label="Übersicht" />
          <Tab icon={<DataObject />} iconPosition="start" label="Datenquellen" />
          <Tab icon={<History />} iconPosition="start" label="InfluxDB" />
          <Tab icon={<AccountTree />} iconPosition="start" label="Scheduler" />
          <Tab icon={<AutoGraph />} iconPosition="start" label="Lernen" />
          <Tab icon={<Tune />} iconPosition="start" label="Feintuning" />
          <Tab icon={<CloudSync />} iconPosition="start" label="vcontrold" />
          <Tab icon={<Settings />} iconPosition="start" label="Diagnose" />
        </Tabs>

        <Box className="tab-content">
          {tab === 0 && <Stack spacing={2}>
            <Box className="metric-grid">
              <Metric title="Readiness" value={`${score} %`} color={score >= 90 ? 'success' : score >= 65 ? 'warning' : 'error'} />
              <Metric title="Betriebsart" value={config.operationMode} color="info" />
              <Metric title="Rolling Horizon" value={`${config.scheduleIntervalMinutes} min / ${config.planningHorizonHours} h`} color="info" />
              <Metric title="Steuerfreigabe" value="gesperrt" color="default" />
            </Box>
            <Card variant="outlined"><CardContent>
              <Typography variant="h6">Aktuelle Empfehlung</Typography>
              <Typography variant="h5" className="recommendation">{diagnostics.plan?.recommendation ?? 'Adapter starten, um eine Empfehlung zu erzeugen.'}</Typography>
              <Typography color="text.secondary">{diagnostics.plan?.explanation}</Typography>
            </CardContent></Card>
            <Card variant="outlined"><CardContent>
              <Typography variant="h6">Setup-Assistent</Typography>
              <Stack spacing={1} sx={{ mt: 1 }}>
                <Checklist ok={Boolean(diagnostics.history?.some(row => row.exists))} text="Datenpunktobjekte erreichbar" />
                <Checklist ok={missingHistory.length === 0 && Boolean(diagnostics.history?.length)} text="Alle benötigten Messreihen in InfluxDB aktiviert" />
                <Checklist ok={Boolean(config.pvForecastState)} text="PV-Forecast inklusive Ausgabezeit konfiguriert" />
                <Checklist ok={Boolean(config.hk1SupplyTemperatureState)} text="HK1-Vorlauf (circuits.1) konfiguriert" />
                <Checklist ok={false} text="vcontrold-Overlap vollständig – erst nach Anschluss und mindestens 14 Tagen möglich" />
              </Stack>
            </CardContent></Card>
          </Stack>}

          {tab === 1 && <Stack spacing={2}>
            <Alert severity="info">Die bekannten Datenpunkte sind voreingestellt. Jeder Eintrag kann über den ioBroker-Objektbrowser ersetzt werden.</Alert>
            {renderSignalRows(signals)}
            <Card variant="outlined" className="section-card"><CardContent>
              <Typography variant="h6">Innenraum-Fallbacksensoren</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Falls Sainlogic fehlt oder älter als {config.indoorFallbackMaxAgeMinutes} Minuten ist, verwendet SmartHeating den Mittelwert aller frischen Werte zwischen 10 und 35 °C.</Typography>
              <TextField fullWidth multiline minRows={3} value={(config.indoorFallbackStates ?? []).join('\n')} onChange={event => update('indoorFallbackStates', event.target.value.split('\n').map(value => value.trim()).filter(Boolean))} />
              <Button sx={{ mt: 1 }} variant="outlined" onClick={() => setPicker({ key: 'indoorFallbackStates', multi: true })}>Mehrere Objekte auswählen</Button>
            </CardContent></Card>
          </Stack>}

          {tab === 2 && <Stack spacing={2}>
            <Alert severity={missingHistory.length ? 'warning' : 'success'}>
              {missingHistory.length ? `${missingHistory.length} benötigte oder empfohlene Messreihen sind noch nicht für ${config.influxInstance} aktiviert.` : 'Alle geprüften Messreihen sind in der konfigurierten InfluxDB aktiviert.'}
            </Alert>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="InfluxDB-Instanz" value={config.influxInstance} onChange={event => update('influxInstance', event.target.value)} />
              <TextField label="Rücklesetest (Tage)" type="number" value={config.historyLookbackDays} onChange={event => update('historyLookbackDays', Number(event.target.value))} />
              <Button color="warning" variant="outlined" onClick={() => setHistoryDialog(true)} disabled={!missingHistory.length}>Fehlende Historisierung aktivieren…</Button>
            </Stack>
            <Box className="history-table">
              <Box className="history-head"><span>Signal</span><span>Datenpunkt</span><span>Objekt</span><span>Influx</span><span>Rücklesetest</span></Box>
              {(diagnostics.history ?? []).map(row => <Box className="history-line" key={`${row.semanticId}:${row.stateId}`}>
                <span><strong>{row.label}</strong><small>{row.semanticId}</small></span>
                <Tooltip title={row.stateId}><code>{row.stateId || 'nicht konfiguriert'}</code></Tooltip>
                <StatusIcon ok={row.exists} />
                <StatusIcon ok={row.historyEnabled} />
                <span><StatusIcon ok={row.historyReadable} /> <small>{row.historySamples} Stichprobe(n)</small></span>
              </Box>)}
            </Box>
          </Stack>}

          {tab === 3 && <Stack spacing={2}>
            <Alert severity="info">Die Entscheidung wird alle {config.scheduleIntervalMinutes} Minuten neu aufgebaut. Ist-Zustand und Forecast haben Vorrang vor historischen Mittelwerten.</Alert>
            <Card variant="outlined"><CardContent>
              <Typography variant="h6">Entscheidungsbaum</Typography>
              <pre>{JSON.stringify(diagnostics.plan?.decisionTree ?? [], null, 2)}</pre>
            </CardContent></Card>
            <Card variant="outlined"><CardContent>
              <Typography variant="h6">Aktuelle Schedule-Prognose</Typography>
              <pre>{JSON.stringify(diagnostics.plan?.schedule ?? [], null, 2)}</pre>
            </CardContent></Card>
          </Stack>}

          {tab === 4 && <Stack spacing={2}>
            <Alert severity="info">Physikalisches Anlagenmodell und Nutzungs-/Bedarfsmodell werden getrennt gelernt. Ein einzelner Ausreißer verändert kein Modell.</Alert>
            <Box className="two-columns">
              <LearningCard title="Physikalische Modelle" items={['DHW-Aufheizenergie und -dauer', 'DHW-Abkühlung', 'Gebäudereaktion und Heiz-Lag', 'Passive Solargewinne', 'Batteriewirkungsgrad', 'PV-Forecast-Bias']} />
              <LearningCard title="Bedarfsmodelle" items={['DHW-Nutzung P50/P90', 'Zeit- und Wochentagskontext', 'Anwesenheit/Feiertag', 'Kontextabhängiger Raumkomfort']} />
            </Box>
            <Card variant="outlined"><CardContent>
              <Typography variant="h6">Was wird optimiert?</Typography>
              <Typography color="text.secondary">Champion und Challenger werden mit identischen, zeitlich korrekten Eingangsdaten verglichen. Gemessen werden Netzbezug, Batteriedurchsatz, PV-Direktverbrauch, Komfortverletzungen und Prognosefehler – getrennt nach Jahresabschnitt und Wetterregime.</Typography>
              <Divider sx={{ my: 2 }} />
              <pre>{JSON.stringify(diagnostics, ['readiness'], 2)}</pre>
            </CardContent></Card>
          </Stack>}

          {tab === 5 && <Stack spacing={2}>
            <Alert severity="warning">Feintuning verändert Planungsgrenzen, aber niemals automatisch technische Viessmann-Grenzen. Zeitlich begrenzte Overrides laufen zum eingetragenen Zeitpunkt aus.</Alert>
            <Box className="form-grid">
              <NumberSetting label="Batteriekapazität" unit="kWh" value={config.batteryCapacityKWh} onChange={value => update('batteryCapacityKWh', value)} />
              <NumberSetting label="Mindest-SOC" unit="%" value={config.batteryMinimumSocPercent} onChange={value => update('batteryMinimumSocPercent', value)} />
              <NumberSetting label="Ladewirkungsgrad" unit="Faktor" value={config.batteryChargeEfficiency} step={0.001} onChange={value => update('batteryChargeEfficiency', value)} />
              <NumberSetting label="Entladewirkungsgrad" unit="Faktor" value={config.batteryDischargeEfficiency} step={0.001} onChange={value => update('batteryDischargeEfficiency', value)} />
              <NumberSetting label="Planungsgrenze" unit="kW" value={config.maximumPlanningPowerKW} onChange={value => update('maximumPlanningPowerKW', value)} />
              <NumberSetting label="DHW Fallback-Minimum" unit="°C" value={config.dhwComfortMinimumC} onChange={value => update('dhwComfortMinimumC', value)} />
              <NumberSetting label="DHW Normalziel" unit="°C" value={config.dhwNormalTargetC} onChange={value => update('dhwNormalTargetC', value)} />
              <NumberSetting label="Mindest-Heizzeit" unit="min" value={config.minimumHeatingMinutes} onChange={value => update('minimumHeatingMinutes', value)} />
              <NumberSetting label="Recency-Halbwertszeit" unit="Tage" value={config.recencyHalfLifeDays} onChange={value => update('recencyHalfLifeDays', value)} />
              <NumberSetting label="Mindest-Lernstichproben" unit="Ereignisse" value={config.minimumLearningSamples} onChange={value => update('minimumLearningSamples', value)} />
              <NumberSetting label="Dashboard-Port" unit="TCP" value={config.port} step={1} onChange={value => update('port', value)} />
            </Box>
            <Alert severity="info">Eine Änderung des Dashboard-Ports wird nach dem Speichern und Neustart der Adapterinstanz wirksam.</Alert>
            <FormControl><InputLabel>Betriebsart</InputLabel><Select label="Betriebsart" value={config.operationMode} onChange={event => update('operationMode', event.target.value as NativeConfig['operationMode'])}><MenuItem value="observe">Observe – nur Datenqualität</MenuItem><MenuItem value="shadow">Shadow – planen und vergleichen, nicht schalten</MenuItem></Select></FormControl>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Switch checked={config.learningEnabled} onChange={event => update('learningEnabled', event.target.checked)} /><Typography>Kontextabhängige Lernvorschläge berechnen (keine automatische Promotion)</Typography></Stack>
          </Stack>}

          {tab === 6 && <Stack spacing={2}>
            <Alert severity="warning">Erst mappen, dann InfluxDB aktivieren, mindestens 14 Tage parallel mit der Cloud messen und erst danach einen Cutover bewerten. Neue elektrische Leistungs-Messgrenzen erzwingen eine Modell-Neukalibrierung.</Alert>
            {renderSignalRows(vcontroldFields)}
            <Card variant="outlined"><CardContent><Typography variant="h6">Source-Switch-Gates</Typography><pre>{JSON.stringify(diagnostics.vcontrold ?? {}, null, 2)}</pre></CardContent></Card>
          </Stack>}

          {tab === 7 && <Stack spacing={2}>
            <Card variant="outlined"><CardContent>
              <Typography variant="h6">Support-Bundle (ohne Zugangsdaten)</Typography>
              <Typography color="text.secondary" sx={{ mb: 2 }}>Enthält Mappingstatus, Historisierungsmatrix, Readiness, aktuellen Kontext und die letzte Shadow-Entscheidung.</Typography>
              <Button variant="outlined" onClick={() => {
                const blob = new Blob([JSON.stringify(diagnostics, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url; anchor.download = `smartheating-diagnostics-${new Date().toISOString()}.json`; anchor.click(); URL.revokeObjectURL(url);
              }}>Support-Bundle herunterladen</Button>
            </CardContent></Card>
            <Card variant="outlined"><CardContent><pre>{JSON.stringify(diagnostics, null, 2)}</pre></CardContent></Card>
          </Stack>}
        </Box>

        {picker && <DialogSelectID
          socket={socket}
          selected={picker.multi ? (config[picker.key] as unknown as string[]) : String(config[picker.key] ?? '')}
          multiSelect={picker.multi}
          types="state"
          theme={theme}
          themeName={themeName}
          themeType={themeType}
          columns={['name', 'type', 'role', 'val']}
          onClose={() => setPicker(null)}
          onOk={selected => {
            if (selected !== undefined) {
              update(picker.key, (picker.multi ? (Array.isArray(selected) ? selected : [selected]) : (Array.isArray(selected) ? selected[0] : selected)) as never);
            }
            setPicker(null);
          }}
          onSelectConfirm={async selected => {
            return true;
          }}
        />}

        <Dialog open={historyDialog} onClose={() => setHistoryDialog(false)} maxWidth="md" fullWidth>
          <DialogTitle>InfluxDB-Historisierung ausdrücklich freigeben</DialogTitle>
          <DialogContent>
            <Alert severity="warning" sx={{ mb: 2 }}>Diese Aktion ändert die Objekt-Custom-Konfiguration der unten aufgeführten ioBroker-States. Sie schreibt keine Messwerte und keine Heizungsbefehle.</Alert>
            <Typography variant="body2" sx={{ mb: 1, whiteSpace: 'pre-wrap' }}>{missingHistory.map(row => row.stateId).filter(Boolean).join('\n')}</Typography>
            <TextField fullWidth label="Bestätigung eingeben" helperText="SMARTHEATING_ENABLE_INFLUX" value={historyConfirmation} onChange={event => setHistoryConfirmation(event.target.value)} />
          </DialogContent>
          <DialogActions><Button onClick={() => setHistoryDialog(false)}>Abbrechen</Button><Button color="warning" variant="contained" disabled={historyConfirmation !== 'SMARTHEATING_ENABLE_INFLUX'} onClick={() => void enableMissingHistory()}>Historisierung aktivieren</Button></DialogActions>
        </Dialog>
      </Box>
  );
}

function Metric({ title, value, color }: { title: string; value: string; color: 'success' | 'warning' | 'error' | 'info' | 'default' }): React.JSX.Element {
  return <Card variant="outlined"><CardContent><Typography color="text.secondary">{title}</Typography><Chip sx={{ mt: 1 }} color={color} label={value} /></CardContent></Card>;
}

function Checklist({ ok, text }: { ok: boolean; text: string }): React.JSX.Element {
  return <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>{ok ? <CheckCircle color="success" /> : <ErrorOutlined color="warning" />}<Typography>{text}</Typography></Stack>;
}

function StatusIcon({ ok }: { ok: boolean }): React.JSX.Element {
  return ok ? <CheckCircle color="success" fontSize="small" /> : <ErrorOutlined color="warning" fontSize="small" />;
}

function LearningCard({ title, items }: { title: string; items: string[] }): React.JSX.Element {
  return <Card variant="outlined"><CardContent><Typography variant="h6">{title}</Typography><ul>{items.map(item => <li key={item}>{item}</li>)}</ul></CardContent></Card>;
}

function NumberSetting({ label, unit, value, step = 0.1, onChange }: { label: string; unit: string; value: number; step?: number; onChange: (value: number) => void }): React.JSX.Element {
  return <TextField label={`${label} (${unit})`} type="number" value={value} slotProps={{ htmlInput: { step } }} onChange={event => onChange(Number(event.target.value))} />;
}
