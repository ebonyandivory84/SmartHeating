# SmartHeating – vollständige Projektdokumentation

Stand: 25. August 2026

Zielversion dieses Stands: 0.1.7

Repository: `ebonyandivory84/SmartHeating`

## 1. Ziel des Projekts

SmartHeating ist ein zentraler, empirisch lernender EnergyPlanner für eine Viessmann Vitocal 200, Warmwasserspeicher, Fußbodenheizung, Photovoltaikanlage und Hausbatterie. Der Planner soll die vorhandene elektrische und thermische Energie vorausschauend zwischen drei Speichern beziehungsweise Verbrauchern verteilen:

1. Hausbatterie
2. Warmwasserspeicher
3. Gebäude beziehungsweise Estrich und Fußbodenheizung

Optimierungsziele sind:

- Netzbezug minimieren;
- direkten PV-Eigenverbrauch maximieren;
- unnötige Batteriezyklen vermeiden;
- unnötige Einspeisung oder Abregelung bei vollem Akku reduzieren;
- thermische Speicherverluste berücksichtigen;
- Warmwasser- und Raumkomfort absichern;
- Batterieenergie für spätere Bedarfe reservieren;
- die reale Anlage empirisch lernen;
- Planungsverbesserungen nachvollziehbar quantifizieren.

## 2. Sicherheits- und Betriebsprinzip

Der Adapter arbeitet zunächst ausschließlich in `observe` oder `shadow`.

- Keine Viessmann-Schedules werden geschrieben.
- Keine Heizungs-, Batterie- oder Wechselrichter-States werden produktiv beschrieben.
- `controlEnabled` bleibt wirkungslos gesperrt; der Adapter protokolliert eine Warnung, falls es gesetzt wird.
- `executionAuthorized` ist in Plänen und Diagnosen immer `false`.
- Bestehende Automationen und Skripte bleiben unverändert die produktive Baseline.
- InfluxDB-Historisierung wird nur nach Eingabe von `SMARTHEATING_ENABLE_INFLUX` für eine explizite Liste konfigurierter States aktiviert.
- Es werden keine historischen Werte gelöscht oder verändert.
- Unbekannte vcontrold-IDs werden nicht geraten.

Die vorgesehene Reifestrecke lautet:

```text
Analyse → Backtest → Shadow Mode → Champion/Challenger → ausdrückliche Produktionsfreigabe
```

## 3. Systemumgebung

- ioBroker-Host: `192.168.44.31`
- js-controller: 7.1.0
- Admin-Adapter: 7.7.20
- Node.js auf ioBroker: 20.19.2
- InfluxDB-Instanz: `influxdb.0`
- SmartHeating-Instanz: `smartheating.0`
- read-only Dashboard-Port: 8097
- Adapterentwicklung: TypeScript, React 18, Material UI 6 und `@iobroker/adapter-react-v5` 7.7.1

Zugangsdaten, private Schlüssel und Secrets gehören nicht in das Repository.

## 4. Architektur

SmartHeating trennt eine gemeinsame Planung von späteren technischen Aktoren:

```text
PV / Batterie / Netz / Hauslast
Viessmann / Warmwasser / HK1
Innenklima / Wetter / Forecast
Anwesenheit / Feiertag
            │
            ▼
      semantische Signale
            │
            ▼
 Kontext + Datenqualität + Historie
            │
            ▼
 physikalische Modelle + Bedarfsmodelle
            │
            ▼
      Rolling-Horizon-Planner
            │
            ▼
 erklärbarer Shadow-Plan und Audit
            │
       ┌────┴────┐
       ▼         ▼
 DHW-Executor  HK1-Executor
   (später)      (später)
```

Der aktuelle Adapter enthält noch keine produktiven Executor-Komponenten.

## 5. Bestätigte Anlagenparameter

- Batteriekapazität: 20 kWh
- Mindest-SOC: 5 %
- angenommener Ladefaktor: 0,87
- angenommener Entladefaktor: 0,995
- maximal betrachtete Planungsleistung: 12 kW
- Warmwasser-Fallbackminimum: 37 °C
- normales Warmwasserziel: 50 °C
- erhöhtes Ziel `temp-2`: 60 °C
- Raumkomfortminimum: 20,5 °C
- Mindest-Heizzeit: 60 Minuten
- Planungsintervall: 15 Minuten
- Planungshorizont: 36 Stunden
- kein separater Stromzähler für die Wärmepumpe vorhanden

Die Lade- und Entladefaktoren sind Startannahmen und müssen später anhand realer Lade-/Entladeereignisse validiert werden.

## 6. Datenquellen und semantisches Mapping

### 6.1 Produktive Solardaten

Seit dem Adapterwechsel werden die aktuell laufenden Werte aus `ekd-solar.0.friendly` verwendet:

| Semantik | Standard-Datenpunkt |
|---|---|
| PV-Leistung | `ekd-solar.0.friendly.leistung_pv_aktuell` |
| Hausverbrauch | `ekd-solar.0.friendly.hausverbrauch_aktuell` |
| Netzleistung signed | `ekd-solar.0.friendly.netzleistung_signed_w` |
| Batterieleistung signed | `ekd-solar.0.friendly.batterieleistung_signed_w` |
| Batterie-SOC | `ekd-solar.0.friendly.ladezustand_akku` |

Konvention Batterieleistung: positiv bedeutet Entladung, negativ bedeutet Ladung.

### 6.2 Historische Solar-State-Familie

Die alte Familie bleibt ausschließlich historische Quelle:

| Semantik | Standard-Datenpunkt |
|---|---|
| PV-Leistung historisch | `0_userdata.0.SolarPower.pv_input_leistung_gesamt` |
| Hausverbrauch historisch | `0_userdata.0.SolarPower.hausverbrauch_aktuell` |
| Netzbezug historisch | `0_userdata.0.SolarPower.netzbezug_aktuell` |
| Netzeinspeisung historisch | `0_userdata.0.SolarPower.netzeinspeisung_aktuell` |
| Batterie-SOC historisch | `0_userdata.0.SolarPower.ladezustand_akku` |
| Batterieladung historisch | `0_userdata.0.SolarPower.ladeleistung_akku` |
| Batterieentladung historisch | `0_userdata.0.SolarPower.entladeleistung_akku` |

Aktuelle EKD-Reihen und historische Legacy-Reihen werden semantisch zusammengeführt, aber nicht blind als identische Messgrenze behandelt.

### 6.3 Viessmann Cloud als aktuelle Übergangsquelle

| Semantik | Standard-Datenpunkt |
|---|---|
| Warmwassertemperatur | `viessmannapi.0.299550.0.features.heating.dhw.sensors.temperature.dhwCylinder.properties.value.value` |
| Warmwasser-Soll normal | `viessmannapi.0.299550.0.features.heating.dhw.temperature.main.properties.value.value` |
| Warmwasser-Soll temp-2 | `viessmannapi.0.299550.0.features.heating.dhw.temperature.temp2.properties.value.value` |
| Warmwasserbereitung aktiv | `viessmannapi.0.299550.0.features.heating.dhw.charging.properties.active.value` |
| Kompressor aktiv | `viessmannapi.0.299550.0.features.heating.compressors.0.properties.active.value` |
| Kompressor-Modulation | `viessmannapi.0.299550.0.features.heating.compressors.0.sensors.power.properties.value.value` |
| HK1-Vorlauf | `viessmannapi.0.299550.0.features.heating.circuits.1.sensors.temperature.supply.properties.value.value` |
| Heizungsrücklauf | `viessmannapi.0.299550.0.features.heating.sensors.temperature.return.properties.value.value` |
| HK1-Pumpe | `viessmannapi.0.299550.0.features.heating.circuits.1.circulation.pump.properties.status.value` |
| HK1-Schedule-Baseline | `0_userdata.0.Viessmann.HK1.lastScheduleJson` |

Der Heizkreis wurde anhand der bestehenden SmartHeating-Logik als `heating.circuits.1` beziehungsweise HK1 bestätigt. Ein vermeintliches HK2-/Sekundärkreis-Signal wird nicht als Ersatz verwendet.

### 6.4 Klima, Forecast und Kontext

| Semantik | Standard-Datenpunkt |
|---|---|
| Innentemperatur primär | `sainlogic.0.weather.current.indoortemp` |
| Außentemperatur | `sainlogic.0.weather.current.outdoortemp` |
| Solarstrahlung | `sainlogic.0.weather.current.solarradiation` |
| PV-Forecast | `0_userdata.0.SolarForecast.next12h_kW_Json` |
| Forecast-Ausgabezeit | `0_userdata.0.SolarForecast.last_update_UTC` |
| Wetterforecast | `0_userdata.0.weather.DailyJson` |
| Anwesenheit | `0_userdata.0.presence_at_home.Teresa`, `0_userdata.0.presence_at_home.Sebastian` |
| Feiertag | `feiertage.0.heute.boolean` |

Sainlogic bleibt Primärsensor für die Innentemperatur. Ist der Wert älter als zehn Minuten oder ungültig, wird der Mittelwert aller frischen, plausiblen ESPHome-Sensoren zwischen 10 und 35 °C verwendet. Die konkreten Fallback-IDs sind in der Instanzkonfiguration hinterlegt und über den Objektbrowser änderbar.

## 7. vcontrold- und Optolink-Migration

Die geplante lokale Verbindung zur Vitocal 200 soll Viessmann-Cloud-Daten schrittweise ersetzen und zusätzliche exakte Messungen liefern:

- Warmwassertemperatur;
- HK1-Vorlauf;
- Heizungsrücklauf;
- HK1-Pumpenstatus;
- elektrische Gesamtaufnahme der Wärmepumpe;
- Kompressorleistung;
- Heizstableistung;
- Kompressorfrequenz beziehungsweise Modulation.

Die vcontrold-Felder bleiben leer, bis reale Datenpunkt-IDs bekannt sind. Vor einem Cutover gelten folgende Gates:

1. benötigte lokale States vollständig mappen;
2. InfluxDB-Historisierung aktivieren;
3. Cloud und lokale Quelle mindestens 14 Tage parallel beobachten;
4. Abdeckung, Bias, Korrelation und Messgrenze bewerten;
5. abhängige Modelle bei Messgrenzenänderung neu kalibrieren;
6. Cloudquelle nach Cutover zunächst 30 Tage als Fallback behalten.

Die exakte elektrische Leistungsaufnahme verbessert besonders DHW-Energie-, COP-, Kompressor- und Heizstabmodelle. Sie ist nicht ohne Neukalibrierung mit dem bisherigen Hauslast-Proxy austauschbar.

## 8. InfluxDB und Datenreife

Die am 25. August 2026 ausgeführte Matrix enthielt 44 konfigurierte beziehungsweise abgeleitete Reihen:

- 37 Reihen aktiviert und lesbar;
- 7 adaptereigene Reihen noch bestätigungspflichtig:
  - `smartheating.0.context.snapshot`
  - `smartheating.0.context.regimes`
  - `smartheating.0.planning.currentPlan`
  - `smartheating.0.planning.recommendation`
  - `smartheating.0.learning.optimizationEvidence`
  - `smartheating.0.learning.drift`
  - `smartheating.0.audit.timeline`

Diese sieben Reihen wurden bislang nicht automatisch aktiviert.

Der HK1-Schedule-Cache `0_userdata.0.Viessmann.HK1.lastScheduleJson` war zuletzt am 1. April 2026 aktualisiert. Die Gesamt-Readiness lag bei 97 %.

### Warum die HK1-Lag-Kalibrierung frühestens nach dem 7. September 2026 möglich ist

Der HK1-Vorlauf wurde erst ab Ende August 2026 zuverlässig historisiert. Für eine belastbare Lag-Schätzung sind mindestens 14 vollständige Tage mit Vorlauf, Pumpenstatus, Innen-/Außentemperatur und Heizphasen erforderlich. Vorher wäre die Sperre lediglich durch zu wenige Daten bestimmt. Das Datum ist daher kein fester Kalenderparameter, sondern ergibt sich aus dem Start der brauchbaren Historie plus Mindestbeobachtungszeit. Fehlende oder lückenhafte Tage verschieben den Termin nach hinten.

## 9. Kontextabhängiges Lernen

Das System verwendet keine harte Einteilung wie „25. September bis 31. März ist Winter“. Reale Bedingungen bestimmen den Kontext:

- Außen- und Innentemperatur;
- Temperaturforecast und Trend;
- Solarstrahlung;
- PV-Ist und PV-Forecast;
- Warmwassertemperatur;
- Batterie-SOC;
- Heiz- und DHW-Aktivität;
- Uhrzeit, Wochentag, Feiertag und Anwesenheit.

Weiche Regime sind unter anderem `cold_dark`, `cold_sunny`, `mild_cloudy`, `mild_sunny`, `warm`, `high_pv` und `low_pv`. Mehrere Regime können gleichzeitig mit unterschiedlichen Gewichten gelten.

Historische Beobachtungen werden gewichtet mit:

```text
Kontextähnlichkeit × Aktualität × Datenqualität
```

Die aktuelle Recency-Halbwertszeit beträgt 90 Tage. Robuste Ausreißer werden über Median Absolute Deviation und einen Startgrenzwert von 3,5 ausgeschlossen. Concept Drift benötigt wiederkehrende Abweichungen in gleicher Richtung; ein einzelner Fehler verändert das Modell nicht.

### Getrennte Modellklassen

Physikalische Modelle:

- DHW-Aufheizenergie und -dauer;
- DHW-Abkühlung;
- Gebäudereaktion und HK1-Lag;
- passive Solargewinne;
- Batterie-Lade-/Entladewirkungsgrad;
- PV-Forecast-Bias.

Nutzungs- und Bedarfsmodelle:

- Warmwasserbedarf P50/P90;
- Uhrzeit und Wochentag;
- Anwesenheit und Feiertag;
- kontextabhängiger Raumkomfort.

Mindestens 18 brauchbare Ereignisse sind als Startgrenze für Lernvorschläge vorgesehen. Modelle werden nicht automatisch produktiv befördert.

## 10. Planner und Entscheidungsbaum

Alle 15 Minuten wird ein neuer Rolling-Horizon-Plan erzeugt. Aktueller Zustand und zeitlich korrekt verfügbare Forecasts haben Vorrang vor historischen Mittelwerten.

Wichtige Gates:

- Warmwasser unter 37 °C erzwingt eine sofortige Komfortempfehlung;
- andernfalls wird ein geeignetes PV-Fenster für DHW gesucht;
- niedrige Innentemperatur wird gegen passive Solargewinne und PV-Kontext bewertet;
- Mindest-Heizzeit verhindert zu kurze Heizfenster;
- jede Empfehlung enthält Gründe, Unsicherheit und `executionAuthorized: false`.

Historische Forecasts müssen als damalige Forecast-Snapshots verwendet werden. Spätere Ist-Werte dürfen nicht rückwirkend als vermeintlicher Forecast in Backtests einfließen.

## 11. Optimierungsbewertung

Champion und Challenger sollen mit denselben zeitlich korrekten Eingangsdaten verglichen werden. Vorgesehene Kennzahlen:

- Netzbezug;
- PV-Direktverbrauch;
- Einspeisung beziehungsweise potenzielle Abregelung;
- Batteriedurchsatz und Zyklen;
- Warmwasser-Komfortverletzungen;
- Raumkomfortverletzungen;
- Prognosefehler;
- Planstabilität und unnötige Schaltvorgänge.

Die Bewertung erfolgt getrennt nach Kontext und Wetterregime. Ein komplexeres Modell gilt nur dann als Verbesserung, wenn es auf zeitlich getrennten Daten robust besser ist.

## 12. Bedienoberflächen

### 12.1 Instanzeinstellungen

Die Einstellungen verwenden ein konsequent dunkles Design und einen eigenen vertikal scrollbaren Inhaltsbereich. Die Navigation bleibt kontrastreich sichtbar.

Tabs:

1. Übersicht
2. Datenquellen
3. InfluxDB
4. Scheduler
5. Lernen
6. Feintuning
7. vcontrold
8. Diagnose

Die Datenpunktfelder verwenden den ioBroker-Objektbrowser. Bekannte Datenpunkte sind als Defaults hinterlegt.

### 12.2 Separates Dashboard

Ab Version 0.1.7 liefert der Adapter das read-only Dashboard über einen eigenen HTTP-Endpunkt auf Port 8097 aus. Dadurch benötigt die Anzeige weder eine Admin-Sitzung noch eine separate Websocket-Verbindung. In der ioBroker-Instanzliste erscheint über `common.localLinks` ein anklickbares SmartHeating-Dashboard-Symbol.

Das Dashboard zeigt:

- Readiness und Betriebsart;
- aktuelle Empfehlung und Erklärung;
- Schedule-Prognose;
- Entscheidungsbaum;
- InfluxDB-Abdeckung;
- Datenqualität und Kontextregime;
- Lernstatus, Parameter, Optimierungsevidenz und Drift;
- vcontrold-Migrationsstatus;
- Audit-Timeline.

Das Dashboard aktualisiert sich alle 30 Sekunden und besitzt keine produktiven Steueraktionen.

## 13. Adapter-Statebaum

Wichtige States unter `smartheating.0`:

```text
info.connection
status.readinessScore
status.summary
status.historyMatrix
status.dataQuality
status.lastRun
status.lastError
planning.recommendation
planning.explanation
planning.currentPlan
planning.decisionTree
context.regimes
context.snapshot
learning.status
learning.learnedParameters
learning.optimizationEvidence
learning.drift
vcontrold.status
audit.timeline
```

JSON-Inhalte werden als JSON-Strings gespeichert, damit sie historisierbar und über den Objektbrowser nachvollziehbar bleiben.

## 14. Entwicklungs- und Veröffentlichungsablauf

Erforderlich ist Node.js 20.19 oder neuer.

```bash
npm install
npm run check
npm test
npm run build:admin
npm run test:all
```

Buildausgaben:

- Backend: `build/`
- Einstellungen und Dashboard: `admin/`

Installation aus GitHub auf ioBroker:

```bash
iobroker url https://github.com/ebonyandivory84/SmartHeating.git smartheating
```

Nach Updates sind Adapterversion, Instanzstatus, `info.connection`, Fehler-State und hochgeladene Admin-Dateien zu prüfen.

## 15. Teststatus

Der Stand vor Version 0.1.6 bestand alle sieben automatisierten Tests:

1. weiche Regime unterscheiden kalte sonnige und kalte dunkle Kontexte;
2. ähnliche historische Kontexte erhalten ein höheres Gewicht;
3. robuste Einzelausreißer werden ausgeschlossen;
4. Concept Drift benötigt persistente gleichgerichtete Residuen;
5. der Forecast-Parser akzeptiert den etablierten Datensatzvertrag;
6. das DHW-Komfortminimum überstimmt PV-Aufschub;
7. normaler DHW-Bedarf verwendet das stärkste verfügbare PV-Fenster.

Zusätzlich werden Backend und Adminoberflächen mit TypeScript geprüft und über Vite gebaut.

## 16. Versionsverlauf

- 0.1.0: erster Observe-/Shadow-Adapter mit Kontextplanung und InfluxDB-Matrix
- 0.1.1: Instanzobjekte und Node.js-20-Kompatibilität
- 0.1.2: leere vcontrold-Mappings aus aktivierbarer Historisierung entfernt
- 0.1.3: Laden der realen Instanzkonfiguration korrigiert
- 0.1.4: Admin-7-kompatibler React-18-/adapter-react-v5-Stack
- 0.1.5: offizieller ioBroker-`GenericApp`-Lebenszyklus für die Konfiguration
- 0.1.6: dunkle scrollbare Einstellungen, zentrales Projektdokument und separates Dashboard mit Instanzlisten-Link
- 0.1.7: eigener read-only Dashboard-Endpunkt ohne Websocket-Abhängigkeit

## 17. Bekannte Grenzen und nächste Schritte

- Die sieben adaptereigenen InfluxDB-Reihen warten auf ausdrückliche Freigabe.
- Der HK1-Schedule-Cache ist veraltet und muss durch eine aktuelle Baseline beziehungsweise zuverlässige Historie ersetzt werden.
- vcontrold ist noch nicht gemappt.
- Exakte Wärmepumpen-, Kompressor- und Heizstableistung fehlen bis zur Optolink-Anbindung.
- Die Lernmodelle veröffentlichen bislang Status und Startparameter; ein vollständiger persistenter Modelltrainer und belastbare Champion/Challenger-Backtests sind weitere Phasen.
- Es existiert weiterhin keine produktive Executor-Freigabe.
- Vor jeder späteren Produktionssteuerung sind Sicherheitsgrenzen, Fallbacks, manuelle Overrides, Auditierbarkeit und eine ausdrückliche Nutzerfreigabe erforderlich.

Diese Datei ist die kanonische Dokumentation des Projekts. Änderungen an Architektur, Datenpunkten, Sicherheitsregeln, Historisierung, Lernlogik oder Betriebsstatus sollen hier mit Datum nachgeführt werden.
