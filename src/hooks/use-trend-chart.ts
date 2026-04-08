import { useEffect, useState } from 'react';
import { vitalSignsApi, ventilatorApi, type VitalSigns, type VentilatorSettings } from '../lib/api';
import type { LabTrendData } from '../components/lab-trend-chart';

export type TrendSource = 'vital' | 'ventilator';

export interface SelectedTrendMetric {
  name: string;
  nameChinese: string;
  unit: string;
  value: number;
  source: TrendSource;
}

export interface TrendChartState {
  selectedTrendMetric: SelectedTrendMetric | null;
  setSelectedTrendMetric: (metric: SelectedTrendMetric | null) => void;
  trendChartData: LabTrendData[];
}

function getVitalTrendValue(record: VitalSigns, itemName: string): number | undefined {
  switch (itemName) {
    case 'RespiratoryRate': return record.respiratoryRate ?? undefined;
    case 'Temperature': return record.temperature ?? undefined;
    case 'BloodPressureSystolic': return record.bloodPressure?.systolic ?? undefined;
    case 'BloodPressureDiastolic': return record.bloodPressure?.diastolic ?? undefined;
    case 'HeartRate': return record.heartRate ?? undefined;
    case 'SpO2': return record.spo2 ?? undefined;
    case 'EtCO2': return record.etco2 ?? undefined;
    case 'CVP': return record.cvp ?? undefined;
    case 'ICP': return record.icp ?? undefined;
    case 'BodyWeight': return record.bodyWeight ?? undefined;
    default: return undefined;
  }
}

function getVentilatorTrendValue(record: VentilatorSettings, itemName: string): number | undefined {
  switch (itemName) {
    case 'FiO2': return record.fio2;
    case 'PEEP': return record.peep;
    case 'TidalVolume': return record.tidalVolume;
    case 'VentRR': return record.respiratoryRate;
    case 'PIP': return record.pip ?? undefined;
    case 'Plateau': return record.plateau ?? undefined;
    case 'Compliance': return record.compliance ?? undefined;
    default: return undefined;
  }
}

function formatTrendAxisLabel(timestamp?: string | null): string {
  if (!timestamp) return '-';
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function useTrendChart(patientId: string | undefined): TrendChartState {
  const [selectedTrendMetric, setSelectedTrendMetric] = useState<SelectedTrendMetric | null>(null);
  const [trendChartData, setTrendChartData] = useState<LabTrendData[]>([]);

  useEffect(() => {
    if (!selectedTrendMetric || !patientId) {
      setTrendChartData([]);
      return;
    }

    const fetchTrend = async () => {
      try {
        const points: LabTrendData[] = [];

        if (selectedTrendMetric.source === 'vital') {
          const response = await vitalSignsApi.getVitalSignsTrends(patientId, { hours: 168 });
          for (const record of response.trends || []) {
            const trendValue = getVitalTrendValue(record, selectedTrendMetric.name);
            if (isFiniteNumber(trendValue)) {
              points.push({ date: formatTrendAxisLabel(record.timestamp), value: trendValue });
            }
          }
        } else if (selectedTrendMetric.source === 'ventilator') {
          const response = await ventilatorApi.getVentilatorTrends(patientId, { hours: 168 });
          for (const record of response.trends || []) {
            const trendValue = getVentilatorTrendValue(record, selectedTrendMetric.name);
            if (isFiniteNumber(trendValue)) {
              points.push({ date: formatTrendAxisLabel(record.timestamp), value: trendValue });
            }
          }
        }

        if (points.length === 0) {
          points.push({ date: '目前', value: selectedTrendMetric.value });
        }

        setTrendChartData(points);
      } catch {
        setTrendChartData([{
          date: '目前',
          value: selectedTrendMetric.value,
        }]);
      }
    };

    fetchTrend();
  }, [selectedTrendMetric, patientId]);

  return { selectedTrendMetric, setSelectedTrendMetric, trendChartData };
}
