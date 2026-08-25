# ioBroker.smartheating

SmartHeating ist ein zentraler, empirisch lernender EnergyPlanner für eine Viessmann Vitocal 200 in Verbindung mit PV-Anlage und Batteriespeicher. Der Adapter arbeitet in der ersten Version ausschließlich im `Observe`- oder `Shadow`-Modus: Er prüft Datenqualität, Historisierung und Modellreife, erstellt einen erklärbaren 24–36-Stunden-Plan und vergleicht ihn später mit dem bestehenden Zeitplan. Produktive Heizungs-, Batterie- oder Viessmann-States werden nicht beschrieben.

## Grundprinzip

Eine Entscheidung entsteht aus aktuellem Zustand, Forecast, jüngster Historie und empirischen Modellen. Kalenderjahreszeiten dürfen ein Feature sein, sind aber nie die alleinige Entscheidungsgrundlage. Ein sonniger Februartag kann deshalb stärker einem milden Übergangstag ähneln als einem kalten, dunklen Wintertag.

SmartHeating trennt strikt:

- physikalische Modelle: DHW-Aufheizenergie und -dauer, Abkühlung, thermische Gebäudereaktion, Heiz-Lag, passive Solargewinne, Batterieeffizienz;
- Nutzungs-/Bedarfsmodelle: probabilistischer Warmwasserbedarf P50/P90, Uhrzeit, Wochentag, Feiertag und Anwesenheit.

Historische Beobachtungen werden mit `Kontextähnlichkeit × Aktualität × Datenqualität` gewichtet. Einzelne Ausreißer verändern kein Modell. Wiederkehrende systematische Abweichungen werden separat als Concept Drift bewertet. Globale und regimeabhängige Modelle müssen sich in zeitlich getrennten Backtests bewähren; das komplexere Modell wird nicht automatisch bevorzugt.

## Voreingestellte Anlage

- Batterie: 20 kWh, Mindest-SOC 5 %, Ladefaktor 0,87, Entladefaktor 0,995
- aktuelle Solarwerte: `ekd-solar.0.friendly.*`
- historische Solarwerte: alte `0_userdata.0.SolarPower.*`-Familie
- Innenraum primär: Sainlogic
- Innenraum-Fallback: Mittelwert frischer, gültiger ESPHome-Sensoren
- Heizkreis: HK1 (`heating.circuits.1`)
- kein separater Wärmepumpen-Stromzähler
- Planung alle 15 Minuten, maximal 36 Stunden

Alle bekannten IDs sind in den Adaptereinstellungen voreingestellt und über den ioBroker-Objektbrowser austauschbar.

## InfluxDB und Datenqualität

Die Admin-Oberfläche zeigt für jeden benötigten Datenpunkt:

- ob das Objekt existiert;
- ob ein frischer Wert vorliegt;
- ob die konfigurierte InfluxDB-Custom-Konfiguration aktiv ist;
- ob ein `getHistory`-Rücklesetest funktioniert.

Das Aktivieren fehlender Historisierung ist absichtlich eine gesonderte, ausdrücklich zu bestätigende Aktion. Der Adapter verändert keine fremde Objektkonfiguration allein durch Start oder Speichern. Forecast-Snapshots und deren Ausgabezeit müssen gemeinsam historisiert werden, damit Backtests keine zukünftigen Ist-Werte als vermeintlichen Forecast verwenden.

## vcontrold-Migration

Die lokalen Optolink/vcontrold-States werden semantischen Signalen zugeordnet. Vor einem Wechsel gelten folgende Gates:

1. alle benötigten lokalen States sind gemappt;
2. ihre InfluxDB-Historisierung ist aktiv;
3. Cloud und lokaler Wert wurden mindestens 14 Tage parallel beobachtet;
4. Bias, Korrelation, Abdeckung und Messgrenze sind bewertet;
5. Messgrenzenänderungen – insbesondere exakte elektrische Leistungsaufnahme statt Hauslast-Proxy – lösen eine Neukalibrierung abhängiger Modelle aus;
6. die Cloud bleibt nach einem späteren Cutover zunächst 30 Tage als Fallback erhalten.

Unbekannte vcontrold-IDs werden nicht geraten und sind deshalb standardmäßig leer.

## Entwicklung

Erforderlich ist Node.js 20.19 oder neuer. Damit läuft der Adapter auf der vorhandenen ioBroker-LTS-Laufzeit; Entwicklung und Release werden zusätzlich unter Node.js 22 und 24 geprüft.

```bash
npm install
npm run test:all
```

Der Backend-Build landet in `build/`, die React-Adminoberfläche in `admin/`.
