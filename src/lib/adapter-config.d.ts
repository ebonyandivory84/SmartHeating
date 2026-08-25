declare global {
  namespace ioBroker {
    interface AdapterConfig {
      operationMode: 'observe' | 'shadow';
      scheduleIntervalMinutes: number;
      planningHorizonHours: number;
      port: number;
      influxInstance: string;
      historyLookbackDays: number;
      expertMode: boolean;
      controlEnabled: boolean;
      batteryCapacityKWh: number;
      batteryMinimumSocPercent: number;
      batteryChargeEfficiency: number;
      batteryDischargeEfficiency: number;
      maximumPlanningPowerKW: number;
      dhwComfortMinimumC: number;
      dhwNormalTargetC: number;
      dhwTemp2TargetC: number;
      indoorComfortMinimumC: number;
      minimumHeatingMinutes: number;
      overrideUntil: string;
      overrideMode: 'none' | 'comfort' | 'economy' | 'pause';
      learningEnabled: boolean;
      recencyHalfLifeDays: number;
      minimumLearningSamples: number;
      driftMinimumSamples: number;
      driftRelativeBiasThreshold: number;
      outlierZScore: number;
      pvPowerState: string;
      housePowerState: string;
      gridPowerState: string;
      batteryPowerState: string;
      batterySocState: string;
      historicalPvPowerState: string;
      historicalHousePowerState: string;
      historicalGridImportState: string;
      historicalGridExportState: string;
      historicalBatterySocState: string;
      historicalBatteryChargeState: string;
      historicalBatteryDischargeState: string;
      dhwTemperatureState: string;
      dhwNormalTargetState: string;
      dhwTemp2TargetState: string;
      dhwChargingState: string;
      compressorActiveState: string;
      compressorModulationState: string;
      hk1SupplyTemperatureState: string;
      returnTemperatureState: string;
      hk1PumpState: string;
      hk1ScheduleState: string;
      indoorTemperatureState: string;
      indoorFallbackStates: string[];
      indoorFallbackMaxAgeMinutes: number;
      outsideTemperatureState: string;
      solarRadiationState: string;
      pvForecastState: string;
      pvForecastIssuedAtState: string;
      weatherForecastState: string;
      presenceStates: string[];
      holidayState: string;
      vcontroldDhwTemperatureState: string;
      vcontroldHk1SupplyTemperatureState: string;
      vcontroldReturnTemperatureState: string;
      vcontroldHk1PumpState: string;
      vcontroldHeatpumpPowerState: string;
      vcontroldCompressorPowerState: string;
      vcontroldElectricHeaterPowerState: string;
      vcontroldCompressorModulationState: string;
    }
  }
}

export {};
