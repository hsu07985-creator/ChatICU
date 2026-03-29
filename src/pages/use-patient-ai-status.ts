import { useCallback, useEffect, useState } from 'react';
import { getAIReadiness, getRAGStatus, type AIReadiness, type RAGStatus } from '../lib/api/ai';
import { createReadinessFallback } from './patient-detail-utils';

export function usePatientAiStatus() {
  const [ragStatus, setRagStatus] = useState<RAGStatus | null>(null);
  const [aiReadiness, setAiReadiness] = useState<AIReadiness | null>(null);
  const [isCheckingAiReadiness, setIsCheckingAiReadiness] = useState(false);

  const refreshAiReadiness = useCallback(async () => {
    setIsCheckingAiReadiness(true);
    try {
      const readiness = await getAIReadiness();
      setAiReadiness(readiness);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error('[INTG][AI][API][AO-01] readiness check failed:', reason);
      setAiReadiness(createReadinessFallback(reason));
    } finally {
      setIsCheckingAiReadiness(false);
    }
  }, []);

  useEffect(() => {
    void refreshAiReadiness();
  }, [refreshAiReadiness]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void refreshAiReadiness();
    }, 5 * 60 * 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [refreshAiReadiness]);

  useEffect(() => {
    getRAGStatus().then(setRagStatus).catch(() => setRagStatus(null));
  }, []);

  return {
    ragStatus,
    aiReadiness,
    isCheckingAiReadiness,
    refreshAiReadiness,
  };
}
