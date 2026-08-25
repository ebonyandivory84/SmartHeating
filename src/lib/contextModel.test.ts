import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyRegimes, contextSimilarity, detectConceptDrift, weightedPrediction, weightObservations } from './contextModel';
import type { ContextSnapshot } from './types';

const context = (overrides: Partial<ContextSnapshot> = {}): ContextSnapshot => ({
  timestamp: '2026-01-15T08:00:00.000Z',
  outsideTemperatureC: 2,
  outsideForecastC: 7,
  outsideTemperatureTrendC: 5,
  solarRadiationWm2: 400,
  solarForecastKW: 5,
  pvActualKW: 1,
  pvForecastKW: 6,
  indoorTemperatureC: 21.5,
  dhwTemperatureC: 42,
  batterySocPercent: 50,
  heatingActive: false,
  dhwActive: false,
  hour: 9,
  weekday: 4,
  holiday: false,
  presenceCount: 2,
  daylight: true,
  quality: 1,
  ...overrides
});

test('soft regimes distinguish cold sunny from cold dark without calendar cutoffs', () => {
  const sunny = classifyRegimes(context());
  const dark = classifyRegimes(context({ solarRadiationWm2: 0, pvForecastKW: 0 }));
  assert.ok((sunny.find(item => item.regime === 'cold_sunny')?.weight ?? 0) > (sunny.find(item => item.regime === 'cold_dark')?.weight ?? 0));
  assert.ok((dark.find(item => item.regime === 'cold_dark')?.weight ?? 0) > (dark.find(item => item.regime === 'cold_sunny')?.weight ?? 0));
});

test('similar historical contexts receive a higher score', () => {
  const current = context();
  const similar = context({ timestamp: '2026-01-14T08:00:00.000Z', outsideTemperatureC: 3 });
  const different = context({ timestamp: '2026-01-14T08:00:00.000Z', outsideTemperatureC: 24, solarRadiationWm2: 0, indoorTemperatureC: 18, hour: 23, presenceCount: 0 });
  assert.ok(contextSimilarity(current, similar) > contextSimilarity(current, different));
});

test('single robust outlier is excluded from learning weight', () => {
  const current = context({ timestamp: '2026-01-20T08:00:00.000Z' });
  const observations = [4, 4.1, 3.9, 4.2, 50].map((target, index) => ({
    context: context({ timestamp: `2026-01-${String(10 + index).padStart(2, '0')}T08:00:00.000Z` }),
    target,
    quality: 1
  }));
  const weighted = weightObservations(current, observations, 90, 3.5);
  assert.equal(weighted.at(-1)?.outlier, true);
  assert.equal(weighted.at(-1)?.weight, 0);
  const prediction = weightedPrediction(weighted);
  assert.ok(prediction.value !== null && prediction.value < 5);
});

test('concept drift requires persistent same-direction residuals', () => {
  assert.equal(detectConceptDrift([0.2, 0.2], 12, 0.08).detected, false);
  const drift = detectConceptDrift(Array.from({ length: 12 }, () => 0.12), 12, 0.08);
  assert.equal(drift.detected, true);
  assert.equal(drift.persistent, true);
});
