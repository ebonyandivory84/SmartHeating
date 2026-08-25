import type { ContextSnapshot, HistoricalObservation, RegimeMembership, WeightedObservation } from './types';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const cold = (temperature: number): number => clamp01((10 - temperature) / 12);
const mild = (temperature: number): number => clamp01(1 - Math.abs(temperature - 12) / 10);
const warm = (temperature: number): number => clamp01((temperature - 16) / 10);
const sunny = (radiation: number): number => clamp01((radiation - 80) / 420);
const highPv = (pvKW: number): number => clamp01((pvKW - 1) / 7);

export function classifyRegimes(context: ContextSnapshot): RegimeMembership[] {
  const outside = context.outsideTemperatureC ?? context.outsideForecastC ?? 10;
  const radiation = context.solarRadiationWm2 ?? 0;
  const pv = context.pvForecastKW ?? context.pvActualKW ?? 0;
  const sun = sunny(radiation);
  const memberships: RegimeMembership[] = [
    { regime: 'cold_dark', weight: cold(outside) * (1 - sun), reasons: [`Außen ${outside.toFixed(1)} °C`, `Strahlung ${radiation.toFixed(0)} W/m²`] },
    { regime: 'cold_sunny', weight: cold(outside) * sun, reasons: [`Außen ${outside.toFixed(1)} °C`, `sonniger Kontext ${Math.round(sun * 100)} %`] },
    { regime: 'mild_cloudy', weight: mild(outside) * (1 - sun), reasons: [`milde Temperaturähnlichkeit ${Math.round(mild(outside) * 100)} %`, 'geringe passive Solargewinne'] },
    { regime: 'mild_sunny', weight: mild(outside) * sun, reasons: [`milde Temperaturähnlichkeit ${Math.round(mild(outside) * 100)} %`, 'passive Solargewinne wahrscheinlich'] },
    { regime: 'warm', weight: warm(outside), reasons: [`Außen ${outside.toFixed(1)} °C`] },
    { regime: 'high_pv', weight: highPv(pv), reasons: [`PV-Kontext ${pv.toFixed(1)} kW`] },
    { regime: 'low_pv', weight: 1 - highPv(pv), reasons: [`PV-Kontext ${pv.toFixed(1)} kW`] }
  ];
  const total = memberships.reduce((sum, item) => sum + item.weight, 0) || 1;
  return memberships
    .map(item => ({ ...item, weight: item.weight / total }))
    .filter(item => item.weight >= 0.03)
    .sort((a, b) => b.weight - a.weight);
}

function numericSimilarity(a: number | null, b: number | null, scale: number): number {
  if (a === null || b === null) return 0.65;
  return Math.exp(-Math.abs(a - b) / scale);
}

function circularHourSimilarity(a: number, b: number): number {
  const difference = Math.min(Math.abs(a - b), 24 - Math.abs(a - b));
  return Math.exp(-difference / 4);
}

export function contextSimilarity(current: ContextSnapshot, historical: ContextSnapshot): number {
  const components = [
    numericSimilarity(current.outsideTemperatureC, historical.outsideTemperatureC, 6),
    numericSimilarity(current.solarRadiationWm2, historical.solarRadiationWm2, 250),
    numericSimilarity(current.indoorTemperatureC, historical.indoorTemperatureC, 1.5),
    numericSimilarity(current.dhwTemperatureC, historical.dhwTemperatureC, 6),
    numericSimilarity(current.batterySocPercent, historical.batterySocPercent, 25),
    circularHourSimilarity(current.hour, historical.hour),
    current.weekday === historical.weekday ? 1 : 0.75,
    current.presenceCount === historical.presenceCount ? 1 : 0.7
  ];
  return components.reduce((product, value) => product * value, 1) ** (1 / components.length);
}

export function weightObservations(
  current: ContextSnapshot,
  observations: HistoricalObservation[],
  recencyHalfLifeDays: number,
  outlierZScore = 3.5
): WeightedObservation[] {
  const now = Date.parse(current.timestamp);
  const targets = observations.map(item => item.target).sort((a, b) => a - b);
  const median = targets.length ? targets[Math.floor(targets.length / 2)] : 0;
  const deviations = targets.map(value => Math.abs(value - median)).sort((a, b) => a - b);
  const mad = deviations.length ? deviations[Math.floor(deviations.length / 2)] : 0;
  return observations.map(observation => {
    const ageDays = Math.max(0, (now - Date.parse(observation.context.timestamp)) / 86_400_000);
    const similarity = contextSimilarity(current, observation.context);
    const recency = 0.5 ** (ageDays / Math.max(1, recencyHalfLifeDays));
    const robustZ = mad > 1e-9 ? (0.6745 * Math.abs(observation.target - median)) / mad : 0;
    const outlier = robustZ > outlierZScore;
    return {
      ...observation,
      similarity,
      recency,
      outlier,
      weight: outlier ? 0 : similarity * recency * clamp01(observation.quality) * clamp01(observation.context.quality)
    };
  });
}

export function weightedPrediction(observations: WeightedObservation[]): { value: number | null; effectiveSamples: number; confidence: number } {
  const usable = observations.filter(item => item.weight > 0);
  const weightSum = usable.reduce((sum, item) => sum + item.weight, 0);
  if (weightSum <= 0) return { value: null, effectiveSamples: 0, confidence: 0 };
  const value = usable.reduce((sum, item) => sum + item.target * item.weight, 0) / weightSum;
  const squaredWeightSum = usable.reduce((sum, item) => sum + item.weight ** 2, 0);
  const effectiveSamples = squaredWeightSum > 0 ? weightSum ** 2 / squaredWeightSum : 0;
  return { value, effectiveSamples, confidence: clamp01(effectiveSamples / 18) };
}

export function detectConceptDrift(residuals: number[], minimumSamples: number, relativeBiasThreshold: number): {
  detected: boolean;
  persistent: boolean;
  relativeBias: number;
  reason: string;
} {
  if (residuals.length < minimumSamples) {
    return { detected: false, persistent: false, relativeBias: 0, reason: `Noch ${minimumSamples - residuals.length} gültige Beobachtungen erforderlich` };
  }
  const window = residuals.slice(-minimumSamples);
  const mean = window.reduce((sum, value) => sum + value, 0) / window.length;
  const sameDirection = window.filter(value => Math.sign(value) === Math.sign(mean)).length / window.length;
  const detected = Math.abs(mean) >= relativeBiasThreshold && sameDirection >= 0.75;
  return {
    detected,
    persistent: detected,
    relativeBias: mean,
    reason: detected ? `Persistenter relativer Fehler ${(mean * 100).toFixed(1)} % über ${window.length} Beobachtungen` : 'Kein persistenter Drift nachweisbar'
  };
}
