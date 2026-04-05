import apiClient, { ensureData } from '../api-client';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

// Markers matching backend _MAIN_SECTION_MARKERS / _DETAIL_SECTION_MARKERS
const _MAIN_MARKERS = ['【主回答】', '主回答：', '主回答:'];
const _DETAIL_MARKERS = ['【說明/補充】', '【說明】', '說明/補充：', '說明：', '補充：'];

/**
 * Extract only the main answer from raw streaming text, stripping LLM
 * section markers and cutting before the detail/explanation section.
 * This lets the frontend display clean content during streaming instead
 * of showing raw markers that get replaced on the `done` event.
 */
export function extractStreamMainContent(rawText: string): string {
  let text = rawText;
  for (const m of _MAIN_MARKERS) {
    if (text.startsWith(m)) {
      text = text.slice(m.length);
      break;
    }
  }
  for (const m of _DETAIL_MARKERS) {
    const idx = text.indexOf(m);
    if (idx >= 0) {
      text = text.slice(0, idx);
      break;
    }
  }
  return text.trimStart();
}

// 類型定義
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  explanation?: string | null;
  timestamp: string;
  patientContext?: {
    patientId: string;
    patientName: string;
  };
  citations?: Citation[];
  suggestedActions?: SuggestedAction[];
  safetyWarnings?: string[] | null;
  requiresExpertReview?: boolean;
  degraded?: boolean;
  degradedReason?: string | null;
  upstreamStatus?: string | null;
  evidenceGate?: EvidenceGate | null;
  dataFreshness?: DataFreshness | null;
}

export interface Citation {
  id: string;
  type: 'guideline' | 'literature' | 'protocol' | 'patient-data';
  title: string;
  source: string;
  url?: string;
  relevance: number;
  page?: number | null;
  pages?: number[];
  snippet?: string;
  snippets?: string[];
  snippetCount?: number;
  sourceFile?: string;
  chunkId?: string | null;
  summary?: string;
  keyQuote?: string;
  relevanceNote?: string;
}

export interface SuggestedAction {
  id: string;
  type: 'order' | 'assessment' | 'consultation' | 'documentation';
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
}

export interface EvidenceGate {
  passed: boolean;
  reason_code: string | null;
  display_reason: string | null;
  citation_count: number;
  confidence: number;
  thresholds: {
    min_citations: number;
    min_confidence: number;
  };
}

export interface DataFreshnessSection {
  status: 'fresh' | 'stale' | 'missing' | 'unknown';
  timestamp?: string | null;
  age_hours?: number | null;
  threshold_hours?: number | null;
}

export interface DataFreshness {
  mode: 'json' | 'db' | string;
  generated_at: string;
  as_of: string | null;
  sections: {
    lab_data: DataFreshnessSection;
    vital_signs: DataFreshnessSection;
    ventilator_settings: DataFreshnessSection;
    medications: {
      status: 'present' | 'missing';
      active_count: number;
    };
  };
  missing_fields: string[];
  hints: string[];
}

export interface ChatSession {
  id: string;
  userId: string;
  patientId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ChatSessionsResponse {
  sessions: ChatSession[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ChatResponse {
  message: ChatMessage;
  sessionId: string;
}

export interface StreamChatOptions {
  sessionId?: string;
  patientId?: string;
  message: string;
  onThinking?: (detail: string) => void;
  onMessage: (chunk: string) => void;
  onComplete: (response: ChatResponse) => void;
  onError: (error: Error) => void;
}

// API 回應類型
interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

export interface AIReadinessFeatureGates {
  chat: boolean;
  clinical_summary: boolean;
  patient_explanation: boolean;
  guideline_interpretation: boolean;
  decision_support: boolean;
  clinical_polish: boolean;
  dose_calculation: boolean;
  drug_interactions: boolean;
  clinical_query: boolean;
}

export interface AIReadiness {
  overall_ready: boolean;
  checked_at: string;
  llm: {
    ready: boolean;
    provider: string;
    model: string;
    reason: string | null;
  };
  evidence: {
    reachable: boolean;
    ready: boolean;
    reason: string | null;
    last_error: string | null;
  };
  rag: {
    ready: boolean;
    is_indexed: boolean;
    total_chunks: number;
    total_documents: number;
    engine: string;
    clinical_rules_loaded: boolean;
  };
  feature_gates: AIReadinessFeatureGates;
  blocking_reasons: string[];
  display_reasons: string[];
}

export async function getAIReadiness(): Promise<AIReadiness> {
  const response = await apiClient.get<ApiResponse<AIReadiness>>('/api/v1/ai/readiness');
  return ensureData(response.data, 'API contract');
}

export function getReadinessReason(
  readiness: AIReadiness | null,
  feature: keyof AIReadinessFeatureGates,
  fallback = 'AI 服務尚未就緒，請稍後重試。'
): string {
  if (!readiness) return fallback;
  if (readiness.feature_gates[feature]) return '';
  if (Array.isArray(readiness.display_reasons) && readiness.display_reasons.length > 0) {
    return readiness.display_reasons.join(' ');
  }
  return fallback;
}

// 發送聊天訊息
export async function sendChatMessage(
  message: string,
  options: { sessionId?: string; patientId?: string } = {}
): Promise<ChatResponse> {
  const response = await apiClient.post<ApiResponse<ChatResponse>>('/ai/chat', {
    message,
    sessionId: options.sessionId,
    patientId: options.patientId,
  });
  return ensureData(response.data, 'API contract');
}

function createStreamRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `fe_stream_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
  return `fe_stream_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function parseSseFrame(frame: string): { event: string; data: string } | null {
  const trimmed = frame.trim();
  if (!trimmed) return null;
  const lines = trimmed.split('\n');
  let event = 'message';
  let data = '';
  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      const value = line.slice(5);
      data += value.startsWith(' ') ? value.slice(1) : value;
    }
  }
  return { event, data };
}

// 串流聊天訊息（AO-04）— SSE /ai/chat/stream
export async function streamChatMessage(options: StreamChatOptions): Promise<void> {
  let streamStarted = false;
  try {
    const requestId = createStreamRequestId();
    // AbortController with 60s timeout — prevents indefinite hang if backend/proxy stalls
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/ai/chat/stream`, {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'X-Request-ID': requestId,
          'X-Trace-ID': requestId,
        },
        body: JSON.stringify({
          message: options.message,
          sessionId: options.sessionId,
          patientId: options.patientId,
        }),
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) {
      throw new Error(`AI 串流請求失敗（HTTP ${response.status}）`);
    }
    if (!response.body) {
      throw new Error('AI 串流連線失敗：無可讀取內容。');
    }

    streamStarted = true;
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let completed = false;

    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: !done });
      }
      buffer = buffer.replace(/\r\n/g, '\n');
      if (done && buffer.trim()) {
        buffer += '\n\n';
      }

      let boundaryIndex = buffer.indexOf('\n\n');
      while (boundaryIndex !== -1) {
        const frame = buffer.slice(0, boundaryIndex);
        buffer = buffer.slice(boundaryIndex + 2);
        boundaryIndex = buffer.indexOf('\n\n');

        const parsed = parseSseFrame(frame);
        if (!parsed) continue;

        let payload: any = {};
        if (parsed.data) {
          try {
            payload = JSON.parse(parsed.data);
          } catch {
            payload = {};
          }
        }

        if (parsed.event === 'thinking' && typeof payload.detail === 'string') {
          options.onThinking?.(payload.detail);
          continue;
        }
        if (parsed.event === 'delta' && typeof payload.chunk === 'string') {
          options.onMessage(payload.chunk);
          continue;
        }
        if (parsed.event === 'done') {
          if (!payload?.message || !payload?.sessionId) {
            throw new Error('AI 串流回應格式錯誤：缺少 message/sessionId');
          }
          options.onComplete({
            message: payload.message,
            sessionId: payload.sessionId,
          });
          completed = true;
          continue;
        }
        if (parsed.event === 'error') {
          throw new Error(
            typeof payload?.message === 'string' && payload.message
              ? payload.message
              : 'AI 串流服務發生錯誤。'
          );
        }
      }

      if (done) break;
    }

    if (!completed) {
      throw new Error('AI 串流中斷，請重試。');
    }
  } catch (err) {
    if (!streamStarted) {
      try {
        const fallback = await sendChatMessage(options.message, {
          sessionId: options.sessionId,
          patientId: options.patientId,
        });
        options.onMessage(fallback.message.content);
        options.onComplete(fallback);
        return;
      } catch (fallbackErr) {
        options.onError(fallbackErr instanceof Error ? fallbackErr : new Error(String(fallbackErr)));
        return;
      }
    }
    options.onError(err instanceof Error ? err : new Error(String(err)));
  }
}

// 取得聊天歷史
export async function getChatSessions(
  options: { page?: number; limit?: number; patientId?: string } = {}
): Promise<ChatSessionsResponse> {
  const params = new URLSearchParams();
  if (options.page) params.append('page', String(options.page));
  if (options.limit) params.append('limit', String(options.limit));
  if (options.patientId) params.append('patientId', options.patientId);

  const response = await apiClient.get<ApiResponse<ChatSessionsResponse>>(`/ai/sessions?${params}`);
  return ensureData(response.data, 'API contract');
}

// 取得單一聊天會話
export async function getChatSession(sessionId: string): Promise<{ session: ChatSession; messages: ChatMessage[] }> {
  const response = await apiClient.get<ApiResponse<{ session: ChatSession; messages: ChatMessage[] }>>(
    `/ai/sessions/${sessionId}`
  );
  return ensureData(response.data, 'API contract');
}

// 刪除聊天會話
export async function deleteChatSession(sessionId: string): Promise<void> {
  await apiClient.delete(`/ai/sessions/${sessionId}`);
}

export async function updateChatSessionTitle(sessionId: string, title: string): Promise<void> {
  await apiClient.patch(`/ai/sessions/${sessionId}`, { title });
}

// ─── Clinical Polish ────────────────────────────────────────

export interface PolishResponse {
  patient_id: string;
  polish_type: string;
  original: string;
  polished: string;
  metadata: Record<string, unknown>;
  safetyWarnings?: string[] | null;
  dataFreshness?: DataFreshness | null;
}

// ─── Clinical Summary ────────────────────────────────────────

export interface ClinicalSummaryResponse {
  patient_id?: string;
  summary: string;
  summary_structured?: {
    schema_version: string;
    overview: string;
    key_findings: string[];
    recommended_actions: string[];
  };
  metadata: Record<string, unknown>;
  safetyWarnings?: string[] | null;
  dataFreshness?: DataFreshness | null;
}

export async function getClinicalSummary(patientId: string): Promise<ClinicalSummaryResponse> {
  const response = await apiClient.post<ApiResponse<ClinicalSummaryResponse>>('/api/v1/clinical/summary', {
    patient_id: patientId,
  }, { timeout: 90_000 });
  return ensureData(response.data, 'API contract');
}

// ─── Patient Explanation ─────────────────────────────────────

export interface ExplanationResponse {
  patient_id: string;
  topic: string;
  explanation: string;
  explanation_structured?: {
    schema_version: string;
    topic: string;
    reading_level: string;
    plain_language_summary: string;
    key_points: string[];
    care_advice: string[];
  };
  metadata: Record<string, unknown>;
  safetyWarnings?: string[] | null;
  dataFreshness?: DataFreshness | null;
}

export async function getPatientExplanation(
  patientId: string,
  topic: string,
  readingLevel?: 'simple' | 'moderate' | 'detailed',
): Promise<ExplanationResponse> {
  const response = await apiClient.post<ApiResponse<ExplanationResponse>>('/api/v1/clinical/explanation', {
    patient_id: patientId,
    topic,
    reading_level: readingLevel || undefined,
  }, { timeout: 90_000 });
  return ensureData(response.data, 'API contract');
}

// ─── Guideline Interpretation ────────────────────────────────

export interface GuidelineSource {
  doc_id: string;
  score: number;
  category: string;
}

export interface GuidelineResponse {
  patient_id: string;
  scenario: string;
  interpretation: string;
  sources: GuidelineSource[];
  metadata: Record<string, unknown>;
  safetyWarnings?: string[] | null;
  dataFreshness?: DataFreshness | null;
}

export async function getGuidelineInterpretation(data: {
  patientId: string;
  scenario: string;
  guidelineTopic?: string;
}): Promise<GuidelineResponse> {
  const response = await apiClient.post<ApiResponse<GuidelineResponse>>('/api/v1/clinical/guideline', {
    patient_id: data.patientId,
    scenario: data.scenario,
    guideline_topic: data.guidelineTopic,
  }, { timeout: 90_000 });
  return ensureData(response.data, 'API contract');
}

// ─── Multi-Agent Decision ────────────────────────────────────

export interface DecisionResponse {
  patient_id: string;
  question: string;
  recommendation: string;
  decision_structured?: {
    schema_version: string;
    question: string;
    recommendation: string;
    rationale_points: string[];
    action_items: string[];
    assessments_count: number;
  };
  metadata: Record<string, unknown>;
  safetyWarnings?: string[] | null;
  dataFreshness?: DataFreshness | null;
}

export async function getDecisionSupport(data: {
  patientId: string;
  question: string;
  assessments?: Array<Record<string, unknown>>;
}): Promise<DecisionResponse> {
  const response = await apiClient.post<ApiResponse<DecisionResponse>>('/api/v1/clinical/decision', {
    patient_id: data.patientId,
    question: data.question,
    assessments: data.assessments,
  }, { timeout: 90_000 });
  return ensureData(response.data, 'API contract');
}

// ─── Clinical Polish ────────────────────────────────────────

export async function polishClinicalText(data: {
  patientId: string;
  content: string;
  polishType: 'progress_note' | 'medication_advice' | 'nursing_record' | 'pharmacy_advice';
  templateContent?: string;
}): Promise<PolishResponse> {
  const body: Record<string, string> = {
    patient_id: data.patientId,
    content: data.content,
    polish_type: data.polishType,
  };
  if (data.templateContent) {
    body.template_content = data.templateContent;
  }
  const response = await apiClient.post<ApiResponse<PolishResponse>>('/api/v1/clinical/polish', body, {
    timeout: 90_000,
  });
  return ensureData(response.data, 'API contract');
}

// ─── RAG Status ─────────────────────────────────────────────

export interface RAGStatus {
  is_indexed: boolean;
  total_chunks: number;
  total_documents: number;
  categories?: Record<string, number>;
  embedding_dim?: number;
  embedding_model?: string;
}

export async function getRAGStatus(): Promise<RAGStatus> {
  const response = await apiClient.get<ApiResponse<RAGStatus>>('/api/v1/rag/status');
  return ensureData(response.data, 'API contract');
}

// ─── Dose Calculation (P3-1) ────────────────────────────────────────

export interface PatientContext {
  age_years?: number;
  weight_kg?: number;
  sex?: string;
  crcl_ml_min?: number;
  hepatic_class?: string;
  sbp_mmHg?: number;
  hr_bpm?: number;
  rr_bpm?: number;
  qtc_ms?: number;
  k_mmol_l?: number;
  mg_mmol_l?: number;
}

export interface DoseCalculateResponse {
  request_id: string;
  status: string;
  result_type: string;
  drug?: string;
  error_code?: string;
  message?: string;
  computed_values: Record<string, unknown>;
  calculation_steps: string[];
  applied_rules: Record<string, unknown>[];
  safety_warnings: string[];
  citations: Record<string, unknown>[];
  confidence: number;
  rag?: Record<string, unknown> | null;
}

export async function calculateDose(data: {
  drug: string;
  patientContext: PatientContext;
  indication?: string;
  doseTarget?: Record<string, unknown>;
}, options?: { suppressErrorToast?: boolean }): Promise<DoseCalculateResponse> {
  const response = await apiClient.post<ApiResponse<DoseCalculateResponse>>('/api/v1/clinical/dose', {
    drug: data.drug,
    patient_context: data.patientContext,
    indication: data.indication,
    dose_target: data.doseTarget,
  }, { suppressErrorToast: options?.suppressErrorToast } as any);
  return ensureData(response.data, 'API contract');
}

// ─── Drug Interaction Check (P3-2) ──────────────────────────────────

export interface InteractionCheckResponse {
  request_id: string;
  status: string;
  result_type: string;
  overall_severity: string;
  findings: Array<{
    drugA?: string;
    drugB?: string;
    drug_a?: string;
    drug_b?: string;
    severity?: string;
    mechanism?: string;
    clinical_effect?: string;
    recommended_action?: string;
    dose_adjustment_hint?: string;
    monitoring?: string[];
    risk_rating?: string;
    risk_rating_description?: string;
    severity_label?: string;
    reliability_rating?: string;
    route_dependency?: string;
    discussion?: string;
    footnotes?: string;
    dependencies?: string[];
    dependency_types?: string[];
    interacting_members?: Array<{
      group_name: string;
      members: string[];
      exceptions: string[];
      exceptions_note: string;
    }>;
    pubmed_ids?: string[];
  }>;
  applied_rules: Record<string, unknown>[];
  citations: Record<string, unknown>[];
  conflicts: Record<string, unknown>[];
  confidence: number;
  rag?: Record<string, unknown> | null;
}

export async function checkInteractions(data: {
  drugList: string[];
  patientContext?: PatientContext;
}, options?: { suppressErrorToast?: boolean }): Promise<InteractionCheckResponse> {
  const payload: Record<string, unknown> = {
    drug_list: data.drugList,
  };
  if (data.patientContext) {
    payload.patient_context = data.patientContext;
  }
  const response = await apiClient.post<ApiResponse<InteractionCheckResponse>>(
    '/api/v1/clinical/interactions',
    payload,
    { suppressErrorToast: options?.suppressErrorToast } as any,
  );
  return ensureData(response.data, 'API contract');
}

// ─── Clinical Query with Intent Routing (P3-3) ─────────────────────

export interface ClinicalQueryResponse {
  request_id: string;
  intent: string;
  status: string;
  result_type: string;
  confidence: number;
  warnings: string[];
  rag?: Record<string, unknown> | null;
  dose_result?: DoseCalculateResponse | null;
  interaction_result?: InteractionCheckResponse | null;
  citations: Record<string, unknown>[];
}

export async function clinicalQuery(data: {
  question: string;
  intent?: string;
  drug?: string;
  drugList?: string[];
  patientContext?: PatientContext;
  doseTarget?: Record<string, unknown>;
}): Promise<ClinicalQueryResponse> {
  const payload: Record<string, unknown> = {
    question: data.question,
  };
  if (data.intent) payload.intent = data.intent;
  if (data.drug) payload.drug = data.drug;
  if (data.drugList) payload.drug_list = data.drugList;
  if (data.patientContext) payload.patient_context = data.patientContext;
  if (data.doseTarget) payload.dose_target = data.doseTarget;
  const response = await apiClient.post<ApiResponse<ClinicalQueryResponse>>('/api/v1/clinical/clinical-query', payload);
  return ensureData(response.data, 'API contract');
}


// ── Message feedback (thumbs up/down) ──────────────────────────────

export async function updateMessageFeedback(
  messageId: string,
  feedback: 'up' | 'down' | null,
): Promise<void> {
  await apiClient.patch(`/ai/chat/messages/${messageId}/feedback`, { feedback });
}
