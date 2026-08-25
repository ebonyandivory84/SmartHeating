import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlan, parseForecast } from './planner';
import type { ContextSnapshot } from './types';

const baseContext: ContextSnapshot = {
  timestamp: '2026-08-25T08:00:00.000Z',
  outsideTemperatureC: 12,
  outsideForecastC: null,
  outsideTemperatureTrendC: null,
  solarRadiationWm2: 100,
  solarForecastKW: null,
  pvActualKW: 1,
  pvForecastKW: 6,
  indoorTemperatureC: 21.5,
  dhwTemperatureC: 42,
  batterySocPercent: 50,
  heatingActive: false,
  dhwActive: false,
  hour: 10,
  weekday: 2,
  holiday: false,
  presenceCount: 2,
  daylight: true,
  quality: 1
};

const config = {
  operationMode: 'shadow' as const,
  scheduleIntervalMinutes: 15,
  dhwComfortMinimumC: 37,
  dhwNormalTargetC: 50,
  indoorComfortMinimumC: 20.5,
  minimumHeatingMinutes: 60
};

test('forecast parser accepts the established record contract', () => {
  const slots = parseForecast(JSON.stringify({ records: [
    { start_utc: '2026-08-25T10:00:00Z', pv_power_kW: 2 },
    { start_utc: '2026-08-25T11:00:00Z', pv_power_kW: 6 }
  ] }));
  assert.equal(slots.length, 2);
  assert.equal(slots[1].pvKW, 6);
});

test('comfort minimum overrides PV deferral', () => {
  const plan = buildPlan({ ...baseContext, dhwTemperatureC: 35 }, [], config);
  assert.match(plan.recommendation, /jetzt/);
  assert.equal(plan.schedule[0]?.action, 'DHW normal aufheizen');
  assert.equal(plan.executionAuthorized, false);
});

test('normal DHW demand selects strongest available PV window', () => {
  const forecast = parseForecast(JSON.stringify([
    { start: '2026-08-25T10:00:00Z', value: 2 },
    { start: '2026-08-25T12:00:00Z', value: 7 },
    { start: '2026-08-25T13:00:00Z', value: 4 }
  ]));
  const plan = buildPlan(baseContext, forecast, config);
  assert.equal(plan.schedule[0]?.start, '2026-08-25T12:00:00.000Z');
  assert.match(plan.explanation, /7\.0 kW/);
  assert.equal(plan.uncertainty, 'medium');
});
