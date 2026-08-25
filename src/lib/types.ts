export type OperationMode = 'observe' | 'shadow';

export type SignalCategory = 'energy' | 'heatpump' | 'climate' | 'forecast' | 'context' | 'migration';

export interface SignalDefinition {
  key: keyof ioBroker.AdapterConfig;
  semanticId: string;
  label: string;
  category: SignalCategory;
  required: boolean;
  historyRequired: boolean;
  unit?: string;
  historicalKey?: keyof ioBroker.AdapterConfig;
  description: string;
}

export interface SignalHealth {
  semanticId: string;
  label: string;
  stateId: string;
  required: boolean;
  historyRequired: boolean;
  exists: boolean;
  fresh: boolean;
  ageSeconds: number | null;
  value: ioBroker.StateValue | null;
  source: 'primary' | 'fallback' | 'missing';
  historyEnabled: boolean;
  historyReadable: boolean;
  historySamples: number;
  issue?: string;
}

export interface ContextSnapshot {
  timestamp: string;
  outsideTemperatureC: number | null;
  outsideForecastC: number | null;
  outsideTemperatureTrendC: number | null;
  solarRadiationWm2: number | null;
  solarForecastKW: number | null;
  pvActualKW: number | null;
  pvForecastKW: number | null;
  indoorTemperatureC: number | null;
  dhwTemperatureC: number | null;
  batterySocPercent: number | null;
  heatingActive: boolean;
  dhwActive: boolean;
  hour: number;
  weekday: number;
  holiday: boolean;
  presenceCount: number;
  daylight: boolean;
  quality: number;
  sources?: Record<string, string>;
  heatpumpPowerW?: number | null;
  compressorPowerW?: number | null;
  electricHeaterPowerW?: number | null;
}

export type RegimeName = 'cold_dark' | 'cold_sunny' | 'mild_cloudy' | 'mild_sunny' | 'warm' | 'high_pv' | 'low_pv';

export interface RegimeMembership {
  regime: RegimeName;
  weight: number;
  reasons: string[];
}

export interface HistoricalObservation {
  context: ContextSnapshot;
  target: number;
  quality: number;
}

export interface WeightedObservation extends HistoricalObservation {
  similarity: number;
  recency: number;
  weight: number;
  outlier: boolean;
}

export interface PlanResult {
  createdAt: string;
  validUntil: string;
  mode: OperationMode;
  recommendation: string;
  explanation: string;
  decisionTree: Array<{ gate: string; result: boolean | string | number; consequence: string }>;
  schedule: Array<{ start: string; end: string; action: string; reason: string; confidence: number }>;
  uncertainty: 'low' | 'medium' | 'high';
  executionAuthorized: false;
}
