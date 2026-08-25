import { classifyRegimes } from './contextModel';
import type { ContextSnapshot, OperationMode, PlanResult } from './types';

export interface ForecastSlot {
  start: Date;
  pvKW: number;
}

export function parseForecast(value: ioBroker.StateValue): ForecastSlot[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    const records = Array.isArray(parsed) ? parsed : typeof parsed === 'object' && parsed !== null
      ? ((parsed as Record<string, unknown>).records ?? (parsed as Record<string, unknown>).forecast ?? (parsed as Record<string, unknown>).values)
      : [];
    if (!Array.isArray(records)) return [];
    return records.flatMap(record => {
      if (typeof record !== 'object' || record === null) return [];
      const item = record as Record<string, unknown>;
      const timestamp = item.start_utc ?? item.start ?? item.timestamp ?? item.time ?? item.ts;
      const power = item.pv_power_kW ?? item.pvKW ?? item.power_kW ?? item.value ?? item.kw;
      const start = new Date(typeof timestamp === 'number' ? timestamp : String(timestamp));
      const pvKW = Number(power);
      return Number.isFinite(start.getTime()) && Number.isFinite(pvKW) ? [{ start, pvKW: Math.max(0, pvKW) }] : [];
    }).sort((a, b) => a.start.getTime() - b.start.getTime());
  } catch {
    return [];
  }
}

export function buildPlan(
  context: ContextSnapshot,
  forecast: ForecastSlot[],
  config: Pick<ioBroker.AdapterConfig, 'operationMode' | 'scheduleIntervalMinutes' | 'dhwComfortMinimumC' | 'dhwNormalTargetC' | 'indoorComfortMinimumC' | 'minimumHeatingMinutes'>
): PlanResult {
  const now = new Date(context.timestamp);
  const regimes = classifyRegimes(context);
  const dominant = regimes[0];
  const decisionTree: PlanResult['decisionTree'] = [];
  const schedule: PlanResult['schedule'] = [];
  const dhw = context.dhwTemperatureC;
  const indoor = context.indoorTemperatureC;
  const emergencyDhw = dhw !== null && dhw < config.dhwComfortMinimumC;
  decisionTree.push({ gate: 'Warmwasser unter Komfortminimum', result: emergencyDhw, consequence: emergencyDhw ? 'Sofortige Aufheizung empfehlen' : 'PV-günstiges Zeitfenster prüfen' });

  let recommendation = 'Beobachten und in 15 Minuten neu planen';
  const reasons: string[] = [];
  if (emergencyDhw) {
    const end = new Date(now.getTime() + 60 * 60_000);
    schedule.push({ start: now.toISOString(), end: end.toISOString(), action: 'DHW normal aufheizen', reason: `Warmwasser ${dhw?.toFixed(1)} °C unter Mindestwert ${config.dhwComfortMinimumC.toFixed(1)} °C`, confidence: 0.95 });
    recommendation = 'Warmwasser jetzt auf Komfortminimum absichern';
    reasons.push(`Die Warmwassertemperatur liegt mit ${dhw?.toFixed(1)} °C unter der Fallback-Mindesttemperatur.`);
  } else if (dhw !== null && dhw < config.dhwNormalTargetC && forecast.length) {
    const best = forecast.reduce((winner, slot) => slot.pvKW > winner.pvKW ? slot : winner);
    const end = new Date(best.start.getTime() + 60 * 60_000);
    schedule.push({ start: best.start.toISOString(), end: end.toISOString(), action: 'DHW normal prüfen/planen', reason: `Bestes verfügbares PV-Fenster ${best.pvKW.toFixed(1)} kW`, confidence: Math.min(0.9, 0.45 + best.pvKW / 20) });
    recommendation = `Warmwasser bevorzugt ab ${best.start.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })} einplanen`;
    reasons.push(`Die aktuelle Warmwassertemperatur ${dhw.toFixed(1)} °C liegt unter dem Normalziel.`);
    reasons.push(`Das stärkste verfügbare PV-Zeitfenster liefert etwa ${best.pvKW.toFixed(1)} kW.`);
  } else {
    reasons.push(dhw === null ? 'Die Warmwassertemperatur fehlt; deshalb wird keine belastbare DHW-Zeit vorgeschlagen.' : `Warmwasser liegt mit ${dhw.toFixed(1)} °C aktuell nicht unter dem Planungsziel.`);
  }

  const heatingNeeded = indoor !== null && indoor < config.indoorComfortMinimumC;
  const sunnyRelief = (context.solarRadiationWm2 ?? 0) >= 250 || (context.pvForecastKW ?? 0) >= 4;
  decisionTree.push({ gate: 'Innenraum unter Komfortminimum', result: heatingNeeded, consequence: heatingNeeded ? 'Heizbedarf bewerten' : 'Kein unmittelbarer Heizbedarf' });
  decisionTree.push({ gate: 'Passive Solargewinne wahrscheinlich', result: sunnyRelief, consequence: sunnyRelief ? 'Heizstart zurückhaltend bewerten' : 'Keine Solarentlastung annehmen' });
  if (heatingNeeded && !sunnyRelief) {
    reasons.push(`Innen ${indoor?.toFixed(1)} °C liegt unter ${config.indoorComfortMinimumC.toFixed(1)} °C; mindestens ${config.minimumHeatingMinutes} Minuten Heizzeit wären im Steuerbetrieb zu prüfen.`);
  } else if (heatingNeeded) {
    reasons.push('Trotz niedriger Innentemperatur sind passive Solargewinne wahrscheinlich; der nächste Rolling-Horizon-Lauf prüft die Entwicklung erneut.');
  }

  if (dominant) reasons.push(`Dominanter Kontext: ${dominant.regime} (${Math.round(dominant.weight * 100)} % weiche Zugehörigkeit).`);
  reasons.push('Der Adapter arbeitet read-only; diese Empfehlung löst keinen Viessmann-Befehl aus.');
  return {
    createdAt: now.toISOString(),
    validUntil: new Date(now.getTime() + config.scheduleIntervalMinutes * 60_000).toISOString(),
    mode: config.operationMode as OperationMode,
    recommendation,
    explanation: reasons.join(' '),
    decisionTree,
    schedule,
    uncertainty: forecast.length && context.quality >= 0.8 ? 'medium' : 'high',
    executionAuthorized: false
  };
}
