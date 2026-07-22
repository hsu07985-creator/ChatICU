// patient-detail 頁的前端型別與常數(D1 page-split,2026-07-20)。
import type { LabData, Patient } from '../lib/api';
import type { AdviceRef, Citation as AiCitation, DataFreshness } from '../lib/api/ai';
import type { MedicationGroups } from '../lib/patient-detail-format';

export interface PatientWithFrontendFields extends Patient {
  sedation?: string[];
  analgesia?: string[];
  nmb?: string[];
  hasUnreadMessages?: boolean;
}


// 對話會話介面（前端管理用）
export interface ChatSession {
  id: string;
  patientId: string;
  sessionDate: string;
  sessionTime: string;
  title: string;
  messages: ChatMessage[];
  lastUpdated: string;
  messageCount?: number;
  labDataSnapshot?: {
    K?: number;
    Na?: number;
    Scr?: number;
    eGFR?: number;
    CRP?: number;
    WBC?: number;
  };
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  messageId?: string;
  explanation?: string | null;
  timestamp?: string;
  references?: AiCitation[];
  warnings?: string[] | null;
  requiresExpertReview?: boolean;
  degraded?: boolean;
  degradedReason?: string | null;
  upstreamStatus?: string | null;
  dataFreshness?: DataFreshness | null;
  feedback?: 'up' | 'down' | null;
  /** F-PARITY (2026-05-03): live-only deep-link refs from this turn's
   *  prefetch (currently pharmacy advice). Empty/undefined when reload
   *  reads from DB or when no advice prefetch fired. */
  adviceRefs?: AdviceRef[];
}

export const EMPTY_MEDICATION_GROUPS: MedicationGroups = {
  sedation: [],
  analgesia: [],
  nmb: [],
  other: [],
  outpatient: [],
};

export const DEFAULT_LAB_DATA: LabData = {
  id: '',
  patientId: '',
  timestamp: '',
  biochemistry: {},
  hematology: {},
  coagulation: {},
  bloodGas: {},
  inflammatory: {},
};
