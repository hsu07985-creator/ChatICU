import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { getLatestScores, recordScore, deleteScore, getScoreTrends, type ScoreEntry } from '../lib/api/scores';

export interface PatientScoresState {
  painScoreValue: number | null;
  rassScoreValue: number | null;
  scoreTrendOpen: boolean;
  scoreTrendType: 'pain' | 'rass';
  scoreTrendData: { date: string; value: number }[];
  scoreEntries: ScoreEntry[];
  handleRecordScore: (scoreType: 'pain' | 'rass', value: number) => Promise<void>;
  handleOpenScoreTrend: (scoreType: 'pain' | 'rass') => Promise<void>;
  handleDeleteScoreEntry: (scoreId: string) => Promise<void>;
  closeScoreTrend: () => void;
  loadLatestScores: () => Promise<void>;
}

export function usePatientScores(patientId: string | undefined): PatientScoresState {
  const [painScoreValue, setPainScoreValue] = useState<number | null>(null);
  const [rassScoreValue, setRassScoreValue] = useState<number | null>(null);
  const [scoreTrendOpen, setScoreTrendOpen] = useState(false);
  const [scoreTrendType, setScoreTrendType] = useState<'pain' | 'rass'>('pain');
  const [scoreTrendData, setScoreTrendData] = useState<{ date: string; value: number }[]>([]);
  const [scoreEntries, setScoreEntries] = useState<ScoreEntry[]>([]);

  const loadScoreTrends = useCallback(async (scoreType: 'pain' | 'rass') => {
    if (!patientId) return;
    try {
      const result = await getScoreTrends(patientId, scoreType, 72);
      setScoreEntries(result.trends);
      setScoreTrendData(
        result.trends.map((t) => ({
          date: new Date(t.timestamp).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }),
          value: t.value,
        }))
      );
    } catch {
      setScoreEntries([]);
      setScoreTrendData([]);
    }
  }, [patientId]);

  const handleRecordScore = useCallback(async (scoreType: 'pain' | 'rass', value: number) => {
    if (!patientId) return;
    await recordScore(patientId, { score_type: scoreType, value });
    if (scoreType === 'pain') setPainScoreValue(value);
    else setRassScoreValue(value);
    toast.success(`已記錄 ${scoreType === 'pain' ? 'Pain' : 'RASS'} = ${value}`);
    setScoreTrendType(scoreType);
    setScoreTrendOpen(true);
    await loadScoreTrends(scoreType);
  }, [patientId, loadScoreTrends]);

  const handleOpenScoreTrend = useCallback(async (scoreType: 'pain' | 'rass') => {
    if (!patientId) return;
    setScoreTrendType(scoreType);
    setScoreTrendOpen(true);
    await loadScoreTrends(scoreType);
  }, [patientId, loadScoreTrends]);

  const handleDeleteScoreEntry = useCallback(async (scoreId: string) => {
    if (!patientId) return;
    await deleteScore(patientId, scoreId);
    toast.success('已刪除紀錄');
    await loadScoreTrends(scoreTrendType);
  }, [patientId, scoreTrendType, loadScoreTrends]);

  const closeScoreTrend = useCallback(() => setScoreTrendOpen(false), []);

  const loadLatestScores = useCallback(async () => {
    if (!patientId) return;
    try {
      const latest = await getLatestScores(patientId);
      setPainScoreValue(latest.pain?.value ?? null);
      setRassScoreValue(latest.rass?.value ?? null);
    } catch {
      // scores endpoint may not exist yet
    }
  }, [patientId]);

  return {
    painScoreValue,
    rassScoreValue,
    scoreTrendOpen,
    scoreTrendType,
    scoreTrendData,
    scoreEntries,
    handleRecordScore,
    handleOpenScoreTrend,
    handleDeleteScoreEntry,
    closeScoreTrend,
    loadLatestScores,
  };
}
