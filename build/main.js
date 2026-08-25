"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmartHeating = void 0;
const utils = __importStar(require("@iobroker/adapter-core"));
const contextModel_1 = require("./lib/contextModel");
const defaultSignals_1 = require("./lib/defaultSignals");
const planner_1 = require("./lib/planner");
const HISTORY_OUTPUT_STATES = [
    'context.snapshot',
    'context.regimes',
    'planning.currentPlan',
    'planning.recommendation',
    'learning.optimizationEvidence',
    'learning.drift',
    'audit.timeline'
];
const MAX_AUDIT_ENTRIES = 100;
const HISTORY_CONFIRMATION = 'SMARTHEATING_ENABLE_INFLUX';
class SmartHeating extends utils.Adapter {
    timer;
    running = false;
    lastContext = null;
    lastPlan = null;
    lastHistoryMatrix = [];
    lastReadiness = null;
    auditEntries = [];
    constructor(options = {}) {
        super({ ...options, name: 'smartheating' });
        this.on('ready', this.onReady.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }
    async onReady() {
        await this.setStateAsync('info.connection', true, true);
        await this.setStateAsync('status.lastError', '', true);
        if (this.config.controlEnabled) {
            this.log.warn('controlEnabled is ignored in version 0.1.0: productive control is intentionally unavailable.');
        }
        await this.runCycle('startup');
        const intervalMinutes = Math.max(1, Number(this.config.scheduleIntervalMinutes) || 15);
        this.timer = setInterval(() => void this.runCycle('rolling_horizon'), intervalMinutes * 60_000);
    }
    onUnload(callback) {
        if (this.timer)
            clearInterval(this.timer);
        void this.setStateAsync('info.connection', false, true).finally(callback);
    }
    async onMessage(message) {
        if (!message.callback)
            return;
        try {
            if (message.command === 'getDiagnostics') {
                this.sendTo(message.from, message.command, this.buildDiagnostics(), message.callback);
                return;
            }
            if (message.command === 'runNow' || message.command === 'checkReadiness') {
                await this.runCycle(`message:${message.command}`);
                this.sendTo(message.from, message.command, { ok: true, readiness: this.lastReadiness }, message.callback);
                return;
            }
            if (message.command === 'getHistoryMatrix') {
                this.sendTo(message.from, message.command, { ok: true, matrix: this.lastHistoryMatrix }, message.callback);
                return;
            }
            if (message.command === 'enableHistory') {
                const payload = (message.message ?? {});
                if (payload.confirmation !== HISTORY_CONFIRMATION) {
                    throw new Error(`Explicit confirmation required: ${HISTORY_CONFIRMATION}`);
                }
                const allowed = new Set(this.historyTargetIds());
                const requested = (payload.stateIds ?? []).filter(id => allowed.has(id));
                if (!requested.length)
                    throw new Error('No valid configured history targets supplied');
                const changed = await this.enableInfluxHistory(requested);
                await this.appendAudit('history_enabled', { stateIds: changed, requestedBy: message.from });
                await this.runCycle('history_configuration_changed');
                this.sendTo(message.from, message.command, { ok: true, changed }, message.callback);
                return;
            }
            this.sendTo(message.from, message.command, { ok: false, error: `Unknown command: ${message.command}` }, message.callback);
        }
        catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            this.log.warn(`Message ${message.command} failed: ${text}`);
            this.sendTo(message.from, message.command, { ok: false, error: text }, message.callback);
        }
    }
    buildDiagnostics() {
        return {
            generatedAt: new Date().toISOString(),
            adapter: { version: this.version ?? '0.1.8', mode: this.config.operationMode, executionAuthorized: false },
            readiness: this.lastReadiness,
            history: this.lastHistoryMatrix,
            context: this.lastContext,
            plan: this.lastPlan,
            vcontrold: this.buildVcontroldStatus()
        };
    }
    async runCycle(trigger) {
        if (this.running)
            return;
        this.running = true;
        try {
            const health = await this.inspectSignals();
            this.lastHistoryMatrix = health;
            const readiness = this.calculateReadiness(health);
            this.lastReadiness = readiness;
            const context = await this.collectContext(health);
            this.lastContext = context;
            const forecastState = this.findHealth(health, 'forecast.pv')?.value ?? null;
            const forecast = (0, planner_1.parseForecast)(forecastState);
            const plan = (0, planner_1.buildPlan)(context, forecast, this.config);
            this.lastPlan = plan;
            const regimes = (0, contextModel_1.classifyRegimes)(context);
            const vcontrold = this.buildVcontroldStatus();
            const quality = this.buildQualityReport(health, context);
            const learning = this.buildLearningStatus(health);
            const optimization = this.buildOptimizationEvidence();
            await Promise.all([
                this.setStateAsync('status.readinessScore', readiness.score, true),
                this.setStateAsync('status.summary', JSON.stringify(readiness), true),
                this.setStateAsync('status.historyMatrix', JSON.stringify(health), true),
                this.setStateAsync('status.dataQuality', JSON.stringify(quality), true),
                this.setStateAsync('status.lastRun', context.timestamp, true),
                this.setStateAsync('status.lastError', '', true),
                this.setStateAsync('context.snapshot', JSON.stringify(context), true),
                this.setStateAsync('context.regimes', JSON.stringify(regimes), true),
                this.setStateAsync('planning.recommendation', plan.recommendation, true),
                this.setStateAsync('planning.explanation', plan.explanation, true),
                this.setStateAsync('planning.currentPlan', JSON.stringify(plan), true),
                this.setStateAsync('planning.decisionTree', JSON.stringify(plan.decisionTree), true),
                this.setStateAsync('learning.status', JSON.stringify(learning), true),
                this.setStateAsync('learning.learnedParameters', JSON.stringify(this.initialLearnedParameters()), true),
                this.setStateAsync('learning.optimizationEvidence', JSON.stringify(optimization), true),
                this.setStateAsync('learning.drift', JSON.stringify({ detected: false, reason: 'Noch keine abgeschlossenen Online-Lernereignisse im Adapter', automaticAdjustment: false }), true),
                this.setStateAsync('vcontrold.status', JSON.stringify(vcontrold), true)
            ]);
            await this.appendAudit('planning_cycle', { trigger, readinessScore: readiness.score, recommendation: plan.recommendation, dominantRegime: regimes[0]?.regime ?? null });
        }
        catch (error) {
            const text = error instanceof Error ? error.stack ?? error.message : String(error);
            this.log.error(text);
            await this.setStateAsync('status.lastError', text, true);
        }
        finally {
            this.running = false;
        }
    }
    async inspectSignals() {
        const definitions = [...defaultSignals_1.SIGNAL_DEFINITIONS, ...defaultSignals_1.HISTORICAL_ONLY_SIGNALS, ...defaultSignals_1.VCONTROLD_SIGNALS];
        const results = [];
        for (const definition of definitions) {
            const stateId = String(this.config[definition.key] ?? '').trim();
            results.push(await this.inspectSignal(definition, stateId, 'primary'));
            if (definition.historicalKey) {
                const historicalId = String(this.config[definition.historicalKey] ?? '').trim();
                if (historicalId && historicalId !== stateId) {
                    results.push(await this.inspectSignal({ ...definition, semanticId: `${definition.semanticId}.legacy`, label: `${definition.label} (Historie)`, required: false }, historicalId, 'primary'));
                }
            }
        }
        for (const [index, id] of (this.config.indoorFallbackStates ?? []).entries()) {
            results.push(await this.inspectSignal({
                key: 'indoorTemperatureState', semanticId: `climate.indoor_temperature.fallback.${index + 1}`, label: `Innen-Fallback ${index + 1}`,
                category: 'climate', required: false, historyRequired: true, unit: '°C', description: 'ESPHome-Sensor für den Mittelwert-Fallback.'
            }, id, 'fallback'));
        }
        for (const [index, id] of (this.config.presenceStates ?? []).entries()) {
            results.push(await this.inspectSignal({
                key: 'holidayState', semanticId: `context.presence.${index + 1}`, label: `Anwesenheit ${index + 1}`,
                category: 'context', required: false, historyRequired: true, description: 'Anwesenheitskontext des Bedarfsmodells.'
            }, id, 'primary'));
        }
        for (const stateId of HISTORY_OUTPUT_STATES) {
            results.push(await this.inspectSignal({
                key: 'holidayState', semanticId: `smartheating.${stateId}`, label: `SmartHeating ${stateId}`,
                category: 'context', required: false, historyRequired: true, description: 'Adaptereigener Audit-/Modell-State für nachvollziehbare Backtests.'
            }, `${this.namespace}.${stateId}`, 'primary'));
        }
        return results;
    }
    async inspectSignal(definition, stateId, source) {
        if (!stateId)
            return this.missingHealth(definition, stateId, 'Kein Datenpunkt konfiguriert');
        const [object, state] = await Promise.all([
            this.getForeignObjectAsync(stateId).catch(() => null),
            this.getForeignStateAsync(stateId).catch(() => null)
        ]);
        const ageSeconds = state ? Math.max(0, (Date.now() - state.ts) / 1000) : null;
        const fresh = ageSeconds !== null && ageSeconds <= this.maximumAgeSeconds(definition);
        const custom = object?.common && 'custom' in object.common
            ? object.common.custom
            : undefined;
        const historyEnabled = Boolean(custom?.[this.config.influxInstance]?.enabled);
        const history = historyEnabled ? await this.readHistory(stateId) : { readable: false, samples: 0 };
        return {
            semanticId: definition.semanticId,
            label: definition.label,
            stateId,
            required: definition.required,
            historyRequired: definition.historyRequired,
            exists: Boolean(object),
            fresh,
            ageSeconds,
            value: state?.val ?? null,
            source: object ? source : 'missing',
            historyEnabled,
            historyReadable: history.readable,
            historySamples: history.samples,
            issue: !object ? 'Objekt fehlt' : !state ? 'Kein aktueller Wert' : !fresh ? 'Wert ist veraltet' : definition.historyRequired && !historyEnabled ? 'InfluxDB-Historisierung fehlt' : undefined
        };
    }
    missingHealth(definition, stateId, issue) {
        return { semanticId: definition.semanticId, label: definition.label, stateId, required: definition.required, historyRequired: definition.historyRequired, exists: false, fresh: false, ageSeconds: null, value: null, source: 'missing', historyEnabled: false, historyReadable: false, historySamples: 0, issue };
    }
    maximumAgeSeconds(definition) {
        if (definition.category === 'forecast')
            return 30 * 60 * 60;
        if (definition.semanticId.includes('schedule'))
            return 7 * 24 * 60 * 60;
        if (definition.semanticId.startsWith('smartheating.'))
            return 20 * 60;
        return 15 * 60;
    }
    readHistory(stateId) {
        const end = Date.now();
        const start = end - Math.max(1, this.config.historyLookbackDays || 30) * 86_400_000;
        return new Promise(resolve => {
            this.sendTo(this.config.influxInstance, 'getHistory', { id: stateId, options: { start, end, count: 2, aggregate: 'none', addId: false } }, response => {
                const result = response;
                resolve({ readable: !result?.error && Array.isArray(result?.result), samples: Array.isArray(result?.result) ? result.result.length : 0 });
            });
        });
    }
    calculateReadiness(health) {
        const required = health.filter(item => item.required);
        const requiredHistory = health.filter(item => item.required && item.historyRequired);
        const liveReady = required.filter(item => item.exists && item.fresh).length;
        const historyReady = requiredHistory.filter(item => item.historyEnabled && item.historyReadable).length;
        const liveScore = required.length ? liveReady / required.length : 0;
        const historyScore = requiredHistory.length ? historyReady / requiredHistory.length : 0;
        const score = Math.round((liveScore * 0.6 + historyScore * 0.4) * 100);
        const blockers = health.filter(item => item.required && (!item.exists || !item.fresh || (item.historyRequired && !item.historyEnabled))).map(item => ({ semanticId: item.semanticId, issue: item.issue }));
        return {
            score,
            state: score >= 90 ? 'ready_for_shadow_learning' : score >= 65 ? 'partially_ready' : 'not_ready',
            liveSignals: { ready: liveReady, required: required.length },
            historizedSignals: { ready: historyReady, required: requiredHistory.length },
            blockers,
            executionAuthorized: false
        };
    }
    findHealth(health, semanticId) {
        return health.find(item => item.semanticId === semanticId);
    }
    numberValue(health, semanticId) {
        const item = this.findHealth(health, semanticId);
        const number = Number(item?.value);
        return item?.fresh && Number.isFinite(number) ? number : null;
    }
    preferredNumber(health, localSemanticId, cloudSemanticId) {
        const local = this.numberValue(health, localSemanticId);
        if (local !== null)
            return { value: local, source: localSemanticId };
        if (cloudSemanticId) {
            const cloud = this.numberValue(health, cloudSemanticId);
            if (cloud !== null)
                return { value: cloud, source: cloudSemanticId };
        }
        return { value: null, source: 'missing' };
    }
    booleanValue(health, semanticId) {
        const value = this.findHealth(health, semanticId)?.value;
        return value === true || value === 1 || value === '1' || value === 'true' || value === 'on' || value === 'active';
    }
    indoorTemperature(health) {
        const primary = this.numberValue(health, 'climate.indoor_temperature');
        if (primary !== null && primary >= 10 && primary <= 35)
            return { value: primary, source: 'sainlogic', contributors: [this.config.indoorTemperatureState] };
        const valid = health.filter(item => item.semanticId.startsWith('climate.indoor_temperature.fallback.') && item.fresh)
            .map(item => ({ id: item.stateId, value: Number(item.value) }))
            .filter(item => Number.isFinite(item.value) && item.value >= 10 && item.value <= 35);
        if (!valid.length)
            return { value: null, source: 'missing', contributors: [] };
        return { value: valid.reduce((sum, item) => sum + item.value, 0) / valid.length, source: 'esphome_mean_fallback', contributors: valid.map(item => item.id) };
    }
    async collectContext(health) {
        const now = new Date();
        const indoor = this.indoorTemperature(health);
        const forecast = (0, planner_1.parseForecast)(this.findHealth(health, 'forecast.pv')?.value ?? null);
        const future = forecast.filter(slot => slot.start.getTime() >= now.getTime());
        const pvForecastKW = future.length ? Math.max(...future.slice(0, 24).map(slot => slot.pvKW)) : null;
        const present = (this.config.presenceStates ?? []).filter((_, index) => this.booleanValue(health, `context.presence.${index + 1}`)).length;
        const qualityRelevant = health.filter(item => item.required);
        const quality = qualityRelevant.length ? qualityRelevant.filter(item => item.exists && item.fresh).length / qualityRelevant.length : 0;
        const dhw = this.preferredNumber(health, 'vcontrold.dhw.temperature', 'dhw.temperature');
        const heatpumpPower = this.preferredNumber(health, 'vcontrold.heatpump.total_power');
        const compressorPower = this.preferredNumber(health, 'vcontrold.heatpump.compressor_power');
        const electricHeaterPower = this.preferredNumber(health, 'vcontrold.heatpump.electric_heater_power');
        return {
            timestamp: now.toISOString(),
            outsideTemperatureC: this.numberValue(health, 'climate.outside_temperature'),
            outsideForecastC: null,
            outsideTemperatureTrendC: null,
            solarRadiationWm2: this.numberValue(health, 'climate.solar_radiation'),
            solarForecastKW: null,
            pvActualKW: this.toKW(this.numberValue(health, 'pv.power')),
            pvForecastKW,
            indoorTemperatureC: indoor.value,
            dhwTemperatureC: dhw.value,
            batterySocPercent: this.numberValue(health, 'battery.soc'),
            heatingActive: this.booleanValue(health, 'hk1.pump'),
            dhwActive: this.booleanValue(health, 'dhw.charging'),
            hour: Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Berlin' }).format(now)),
            weekday: new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Berlin' })).getDay(),
            holiday: this.booleanValue(health, 'context.holiday'),
            presenceCount: present,
            daylight: (this.numberValue(health, 'climate.solar_radiation') ?? 0) > 5,
            quality,
            heatpumpPowerW: heatpumpPower.value,
            compressorPowerW: compressorPower.value,
            electricHeaterPowerW: electricHeaterPower.value,
            sources: {
                dhwTemperature: dhw.source,
                indoorTemperature: indoor.source,
                heatpumpPower: heatpumpPower.source,
                compressorPower: compressorPower.source,
                electricHeaterPower: electricHeaterPower.source
            }
        };
    }
    toKW(value) {
        return value === null ? null : value / 1000;
    }
    buildQualityReport(health, context) {
        const stale = health.filter(item => item.exists && !item.fresh).map(item => item.semanticId);
        const missing = health.filter(item => item.required && !item.exists).map(item => item.semanticId);
        return {
            score: Math.round(context.quality * 100),
            missingRequired: missing,
            stale,
            indoorTemperatureSource: this.indoorTemperature(health),
            freezeDetection: { status: 'pending_history_window', note: 'Aktive Freeze-Erkennung startet, sobald genügend Adapterzyklen historisiert sind.' }
        };
    }
    buildLearningStatus(health) {
        const configuredHistory = health.filter(item => item.historyRequired && Boolean(item.stateId));
        const historicalReady = configuredHistory.filter(item => item.historyEnabled && item.historyReadable).length;
        const historicalTotal = configuredHistory.length;
        return {
            enabled: this.config.learningEnabled,
            mode: 'bounded_contextual_learning',
            physicalModels: ['dhw_heating_energy', 'dhw_cooling', 'building_thermal_response', 'battery_efficiency', 'pv_forecast_bias'],
            usageModels: ['probabilistic_dhw_demand_p50_p90', 'occupancy_and_time_context'],
            weighting: 'context_similarity × recency × data_quality',
            outliers: 'single anomalies receive zero learning weight; recurrent changes enter drift evaluation',
            historyCoverage: { ready: historicalReady, total: historicalTotal },
            globalVsRegimeValidation: 'required before challenger promotion',
            automaticAdjustment: false,
            executionAuthorized: false
        };
    }
    initialLearnedParameters() {
        return [
            { id: 'dhw_energy_factor_by_context', class: 'physical', status: 'waiting_for_samples', minimumSamples: this.config.minimumLearningSamples },
            { id: 'dhw_demand_p50_p90', class: 'usage', status: 'waiting_for_samples', minimumSamples: this.config.minimumLearningSamples },
            { id: 'building_thermal_response', class: 'physical', status: 'waiting_for_hk1_history', minimumSamples: this.config.minimumLearningSamples },
            { id: 'heating_lag', class: 'physical', status: 'locked_until_data_ready', condition: 'HK1 Vorlauf + Pumpe + Innen/Außen-Historie mit vollständigen Ereignissen' },
            { id: 'solar_gain_coefficient', class: 'physical', status: 'waiting_for_samples' },
            { id: 'pv_forecast_bias', class: 'forecast', status: 'waiting_for_historical_forecast_snapshots' }
        ];
    }
    buildOptimizationEvidence() {
        return {
            status: 'baseline_collection',
            champion: 'existing_schedule_read_only',
            challenger: 'smartheating_contextual_shadow',
            metrics: ['grid_import_kWh', 'battery_throughput_kWh', 'direct_pv_kWh', 'dhw_comfort_violations', 'room_comfort_violations', 'prediction_mae'],
            requiredEvaluationDays: 14,
            requiredPairedEvents: 20,
            seasonalBacktests: ['winter', 'spring_transition', 'summer', 'autumn_transition'],
            weatherRegimeBacktests: ['cold_dark', 'cold_sunny', 'mild_sunny', 'mild_cloudy', 'warm'],
            promotionRecommended: false,
            promotionExecuted: false,
            executionAuthorized: false
        };
    }
    buildVcontroldStatus() {
        const mappings = defaultSignals_1.VCONTROLD_SIGNALS.map(definition => {
            const stateId = String(this.config[definition.key] ?? '');
            const health = this.lastHistoryMatrix.find(item => item.semanticId === definition.semanticId);
            return {
                semanticId: definition.semanticId.replace(/^vcontrold\./, ''),
                stateId,
                mapped: Boolean(stateId),
                exists: health?.exists ?? false,
                fresh: health?.fresh ?? false,
                historyEnabled: health?.historyEnabled ?? false,
                preferredNow: Boolean(stateId && health?.fresh)
            };
        });
        const mapped = mappings.filter(item => item.mapped).length;
        return {
            phase: mapped ? 'mapping_incomplete_or_overlap_pending' : 'not_mapped',
            mappings,
            gates: {
                allRequiredMappingsPresent: mapped === mappings.length,
                influxEnabledBeforeOverlap: mappings.filter(item => item.mapped).every(item => item.historyEnabled),
                minimumCloudOverlapDays: 14,
                overlapValidated: false,
                measurementBoundaryChangesRequireRecalibration: true
            },
            cloudFallbackRetentionDaysAfterCutover: 30,
            automaticCutover: false,
            executionAuthorized: false
        };
    }
    async appendAudit(type, details) {
        this.auditEntries.push({ timestamp: new Date().toISOString(), type, details, executionAuthorized: false });
        this.auditEntries = this.auditEntries.slice(-MAX_AUDIT_ENTRIES);
        await this.setStateAsync('audit.timeline', JSON.stringify(this.auditEntries), true);
    }
    historyTargetIds() {
        const ids = new Set();
        for (const definition of [...defaultSignals_1.SIGNAL_DEFINITIONS, ...defaultSignals_1.HISTORICAL_ONLY_SIGNALS, ...defaultSignals_1.VCONTROLD_SIGNALS]) {
            const id = String(this.config[definition.key] ?? '').trim();
            if (id && definition.historyRequired)
                ids.add(id);
            if (definition.historicalKey) {
                const historicalId = String(this.config[definition.historicalKey] ?? '').trim();
                if (historicalId)
                    ids.add(historicalId);
            }
        }
        for (const id of this.config.indoorFallbackStates ?? [])
            if (id)
                ids.add(id);
        for (const id of this.config.presenceStates ?? [])
            if (id)
                ids.add(id);
        for (const id of HISTORY_OUTPUT_STATES)
            ids.add(`${this.namespace}.${id}`);
        return [...ids];
    }
    async enableInfluxHistory(stateIds) {
        const changed = [];
        for (const id of stateIds) {
            const object = await this.getForeignObjectAsync(id);
            if (!object?.common)
                continue;
            const custom = ('custom' in object.common ? object.common.custom : {});
            object.common.custom = {
                ...(custom ?? {}),
                [this.config.influxInstance]: {
                    enabled: true,
                    changesOnly: false,
                    debounce: 0,
                    retention: 0,
                    maxLength: 10,
                    changesRelogInterval: 0,
                    changesMinDelta: 0,
                    storageType: ''
                }
            };
            await this.setForeignObjectAsync(id, object);
            changed.push(id);
        }
        return changed;
    }
}
exports.SmartHeating = SmartHeating;
if (require.main !== module) {
    module.exports = (options) => new SmartHeating(options);
}
else {
    (() => new SmartHeating())();
}
//# sourceMappingURL=main.js.map