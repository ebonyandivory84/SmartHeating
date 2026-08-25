import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  ThemeProvider,
  Typography
} from '@mui/material';
import { createTheme } from '@mui/material/styles';
import { AccountTree, AutoGraph, CloudSync, History, Refresh, Shield } from '@mui/icons-material';
import ioPackage from '../../io-package.json';

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

interface PlanRow {
  start?: string;
  end?: string;
  action?: string;
  reason?: string;
  confidence?: number;
}

interface DecisionRow {
  gate?: string;
  result?: boolean | string | number;
  consequence?: string;
}

interface Diagnostics {
  generatedAt?: string;
  adapter?: { version?: string; mode?: string; executionAuthorized?: boolean };
  readiness?: { score?: number; state?: string; blockers?: Array<{ semanticId?: string; issue?: string }> };
  history?: HistoryRow[];
  context?: Record<string, unknown>;
  plan?: {
    recommendation?: string;
    explanation?: string;
    uncertainty?: string;
    decisionTree?: DecisionRow[];
    schedule?: PlanRow[];
  };
  vcontrold?: Record<string, unknown>;
}

interface DashboardData {
  diagnostics: Diagnostics;
  dataQuality: unknown;
  regimes: unknown;
  learningStatus: unknown;
  learnedParameters: unknown;
  optimizationEvidence: unknown;
  drift: unknown;
  auditTimeline: unknown;
}

const dashboardTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#7ee2b8' },
    background: { default: '#050505', paper: '#101010' }
  }
});

export function DashboardApp({ adapterInstance }: { adapterInstance: string }): React.JSX.Element {
  return <ThemeProvider theme={dashboardTheme}><Dashboard adapterInstance={adapterInstance} /></ThemeProvider>;
}

function Dashboard({ adapterInstance }: { adapterInstance: string }): React.JSX.Element {
  const [data, setData] = useState<DashboardData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const response = await fetch('/api/diagnostics', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setData(await response.json() as DashboardData);
      setError('');
    } catch (reason) {
      setError(`Dashboard-Daten konnten nicht geladen werden: ${String(reason)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (!data) {
    return <Box className="dashboard-loading"><CircularProgress /><Typography>SmartHeating-Dashboard wird geladen…</Typography>{error && <Alert severity="error">{error}</Alert>}</Box>;
  }

  const diagnostics = data.diagnostics;
  const history = diagnostics.history ?? [];
  const requiredHistory = history.filter(row => row.historyRequired && row.stateId);
  const enabledHistory = requiredHistory.filter(row => row.historyEnabled && row.historyReadable);
  const schedule = diagnostics.plan?.schedule ?? [];
  const decisionTree = diagnostics.plan?.decisionTree ?? [];
  const score = diagnostics.readiness?.score ?? 0;

  return (
    <Box className="dashboard-shell">
      <Box className="dashboard-header">
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <img src="smartheating.svg" alt="SmartHeating" />
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 800 }}>SmartHeating Dashboard</Typography>
            <Typography color="text.secondary">Instanz {adapterInstance} · automatische Aktualisierung alle 30 Sekunden</Typography>
          </Box>
        </Stack>
        <Button variant="outlined" startIcon={<Refresh />} disabled={busy} onClick={() => void refresh()}>Aktualisieren</Button>
      </Box>

      {error && <Alert severity="error">{error}</Alert>}
      <Alert severity="info" icon={<Shield />}>Observe/Shadow: Dieses Dashboard zeigt Planung und Lernstatus. Produktive Heizungs-, Batterie- und Viessmann-Schreibzugriffe sind nicht autorisiert.</Alert>

      <Box className="dashboard-metrics">
        <Metric title="Readiness" value={`${score} %`} tone={score >= 90 ? 'success' : score >= 65 ? 'warning' : 'error'} />
        <Metric title="Betriebsart" value={diagnostics.adapter?.mode ?? 'unbekannt'} tone="info" />
        <Metric title="InfluxDB lesbar" value={`${enabledHistory.length} / ${requiredHistory.length}`} tone={enabledHistory.length === requiredHistory.length ? 'success' : 'warning'} />
        <Metric title="Plan erzeugt" value={formatDate(diagnostics.generatedAt)} tone="default" />
      </Box>

      <Card className="hero-card" variant="outlined"><CardContent>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ justifyContent: 'space-between' }}>
          <Box>
            <Typography color="text.secondary">Aktuelle Empfehlung</Typography>
            <Typography variant="h4" sx={{ mt: 1, fontWeight: 800 }}>{diagnostics.plan?.recommendation ?? 'Noch keine Empfehlung'}</Typography>
            <Typography sx={{ mt: 1 }}>{diagnostics.plan?.explanation}</Typography>
          </Box>
          <Chip label={`Unsicherheit: ${diagnostics.plan?.uncertainty ?? 'unbekannt'}`} color="info" variant="outlined" />
        </Stack>
      </CardContent></Card>

      <Box className="dashboard-grid">
        <DashboardCard icon={<AccountTree />} title="Schedule-Prognose">
          {schedule.length ? <Box className="schedule-list">{schedule.map((row, index) => <Box className="schedule-row" key={`${row.start}:${index}`}>
            <strong>{formatDate(row.start)} – {formatDate(row.end)}</strong>
            <span>{row.action ?? 'Beobachten'}</span>
            <small>{row.reason}</small>
            <Chip size="small" label={`${Math.round((row.confidence ?? 0) * 100)} %`} />
          </Box>)}</Box> : <EmptyText text="Noch keine Schedule-Zeilen vorhanden." />}
        </DashboardCard>

        <DashboardCard icon={<AccountTree />} title="Entscheidungsbaum">
          {decisionTree.length ? <Stack divider={<Divider flexItem />} spacing={1}>{decisionTree.map((row, index) => <Box key={`${row.gate}:${index}`}>
            <Typography sx={{ fontWeight: 700 }}>{row.gate}</Typography>
            <Typography variant="body2" color="text.secondary">Ergebnis: {String(row.result)} · {row.consequence}</Typography>
          </Box>)}</Stack> : <EmptyText text="Noch kein Entscheidungsbaum vorhanden." />}
        </DashboardCard>

        <DashboardCard icon={<AutoGraph />} title="Lernen und Optimierung">
          <JsonBlock value={{ status: data.learningStatus, learnedParameters: data.learnedParameters, optimizationEvidence: data.optimizationEvidence, drift: data.drift }} />
        </DashboardCard>

        <DashboardCard icon={<History />} title="Datenqualität und Regime">
          <JsonBlock value={{ regimes: data.regimes, dataQuality: data.dataQuality, blockers: diagnostics.readiness?.blockers ?? [] }} />
        </DashboardCard>

        <DashboardCard icon={<CloudSync />} title="vcontrold-Migration">
          <JsonBlock value={diagnostics.vcontrold ?? { status: 'Noch keine lokalen Datenpunkte gemappt' }} />
        </DashboardCard>

        <DashboardCard icon={<History />} title="Audit-Timeline">
          <JsonBlock value={data.auditTimeline ?? []} />
        </DashboardCard>
      </Box>

      <Typography className="dashboard-footer" variant="caption">SmartHeating {ioPackage.common.version} · Ausführung weiterhin gesperrt</Typography>
    </Box>
  );
}

function DashboardCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }): React.JSX.Element {
  return <Card variant="outlined"><CardContent><Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}>{icon}<Typography variant="h6" sx={{ fontWeight: 750 }}>{title}</Typography></Stack>{children}</CardContent></Card>;
}

function Metric({ title, value, tone }: { title: string; value: string; tone: 'success' | 'warning' | 'error' | 'info' | 'default' }): React.JSX.Element {
  return <Card variant="outlined"><CardContent><Typography color="text.secondary">{title}</Typography><Chip sx={{ mt: 1 }} color={tone} label={value} /></CardContent></Card>;
}

function JsonBlock({ value }: { value: unknown }): React.JSX.Element {
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}

function EmptyText({ text }: { text: string }): React.JSX.Element {
  return <Typography color="text.secondary">{text}</Typography>;
}

function formatDate(value?: string): string {
  if (!value) return '–';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
}
