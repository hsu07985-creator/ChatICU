import { useCallback, useEffect, useState } from 'react';
import { getAIReadiness, getRAGStatus, type AIReadiness, type RAGStatus } from '../lib/api/ai';

function createReadinessFallback(reason: string): AIReadiness {
  return {
    overall_ready: false,
    checked_at: new Date().toISOString(),
    llm: {
      ready: false,
      provider: 'unknown',
      model: 'unknown',
      reason: 'READINESS_CHECK_FAILED',
    },
    evidence: {
      reachable: false,
      ready: false,
      reason: 'READINESS_CHECK_FAILED',
      last_error: reason,
    },
    rag: {
      ready: false,
      is_indexed: false,
      total_chunks: 0,
      total_documents: 0,
      engine: 'unknown',
      clinical_rules_loaded: false,
    },
    feature_gates: {
      chat: false,
      clinical_summary: false,
      patient_explanation: false,
      guideline_interpretation: false,
      decision_support: false,
      clinical_polish: false,
      dose_calculation: false,
      drug_interactions: false,
      clinical_query: false,
    },
    blocking_reasons: ['READINESS_CHECK_FAILED'],
    display_reasons: ['AI 服務狀態檢查失敗，已暫時停用 AI 功能。'],
  };
}

export interface AiReadinessState {
  ragStatus: RAGStatus | null;
  aiReadiness: AIReadiness | null;
  isCheckingAiReadiness: boolean;
  refreshAiReadiness: () => Promise<void>;
}

export function useAiReadiness(): AiReadinessState {
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
    refreshAiReadiness();
  }, [refreshAiReadiness]);

  useEffect(() => {
    getRAGStatus().then(setRagStatus).catch(() => setRagStatus(null));
  }, []);

  return { ragStatus, aiReadiness, isCheckingAiReadiness, refreshAiReadiness };
}
