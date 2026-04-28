import apiClient, { ensureData } from '../api-client';

export interface DdiCounts {
  X: number;
  D: number;
  C: number;
  B: number;
  A: number;
  total: number;
}

export interface DrugLibraryStats {
  total_drugs: number;
  total_ddi: number;
  ddi_by_risk: Omit<DdiCounts, 'total'>;
  missing_atc: number;
  sources: Record<string, number>;
  recently_added: number;
  last_updated: string | null;
}

export interface AtcClass {
  code: string;
  name: string;
  count: number;
}

export interface DrugListItem {
  name: string;
  aliases: string[];
  atc: string | null;
  atc_chapter: string | null;
  atc_codes: string[];
  brand_names: string[];
  hospital_codes: string[];
  in_formulary: boolean;
  ddi_counts: DdiCounts;
  sources: string[];
  recently_added: boolean;
  status: 'green' | 'yellow' | 'red';
}

export interface DrugListResponse {
  total: number;
  page: number;
  size: number;
  items: DrugListItem[];
  atc_classes: AtcClass[];
}

export interface DrugListParams {
  q?: string;
  atc?: string;
  sort?: 'name' | 'ddi_count';
  page?: number;
  size?: number;
  in_formulary_only?: boolean;
  has_x_only?: boolean;
  missing_atc_only?: boolean;
  recently_added_only?: boolean;
}

export interface DdiDetailItem {
  id: string;
  other_drug: string;
  other_drug_atc: string | null;
  risk_rating: string;
  severity: string | null;
  severity_label: string | null;
  reliability: string | null;
  mechanism: string | null;
  clinical_effect: string | null;
  management: string | null;
  discussion: string | null;
  source: string | null;
  pubmed_count: number;
  // Phase 4a editor metadata
  pharmacist_note?: string | null;
  last_verified_at?: string | null;
  verified_by?: string | null;
  etag?: number;
}

export interface RuleHistoryEntry {
  action: string;
  actor_id: string;
  actor_name: string;
  actor_role: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
}

export interface IvCompatItem {
  id: string;
  other_drug: string;
  solution: string | null;
  compatible: boolean;
  time_stability: string | null;
  notes: string | null;
  source: string | null;
}

export interface AtcPathNode {
  code: string;
  name: string;
}

export interface DrugDetail {
  name: string;
  exists: boolean;
  atc: string | null;
  atc_path: AtcPathNode[];
  brand_names: string[];
  hospital_codes: string[];
  in_formulary: boolean;
  sources: string[];
  ddi_total: number;
  ddi_by_risk: Omit<DdiCounts, 'total'>;
  ddi: DdiDetailItem[];
  iv_compatibility?: IvCompatItem[];
}

export async function getDrugLibraryStats(): Promise<DrugLibraryStats> {
  const r = await apiClient.get('/pharmacy/drug-library/stats');
  return ensureData(r.data, '藥物資料庫總覽');
}

export async function listDrugs(params: DrugListParams = {}): Promise<DrugListResponse> {
  const r = await apiClient.get('/pharmacy/drug-library/drugs', { params });
  return ensureData(r.data, '藥物清單');
}

export async function getDrugDetail(name: string, params?: { scope?: 'all' | 'icu'; risk?: string }): Promise<DrugDetail> {
  const r = await apiClient.get(`/pharmacy/drug-library/drugs/${encodeURIComponent(name)}`, { params });
  return ensureData(r.data, `藥物詳情: ${name}`);
}

// ── Phase 4a editor endpoints ───────────────────────────────────────

export async function updateRuleNote(ruleId: string, note: string | null): Promise<{ pharmacist_note: string | null; etag: number }> {
  const r = await apiClient.patch(
    `/pharmacy/drug-library/rules/${encodeURIComponent(ruleId)}/note`,
    { note },
  );
  return ensureData(r.data, '更新藥師備註');
}

export async function verifyRule(ruleId: string): Promise<{ last_verified_at: string; verified_by: string; verified_by_name: string; etag: number }> {
  const r = await apiClient.post(
    `/pharmacy/drug-library/rules/${encodeURIComponent(ruleId)}/verify`,
    {},
  );
  return ensureData(r.data, '標記已核對');
}

export async function deprecateRule(ruleId: string, reason: string): Promise<{ id: string; is_active: boolean }> {
  const r = await apiClient.post(
    `/pharmacy/drug-library/rules/${encodeURIComponent(ruleId)}/deprecate`,
    { reason },
  );
  return ensureData(r.data, '標記 deprecated');
}

export async function restoreRule(ruleId: string, reason: string): Promise<{ id: string; is_active: boolean }> {
  const r = await apiClient.post(
    `/pharmacy/drug-library/rules/${encodeURIComponent(ruleId)}/restore`,
    { reason },
  );
  return ensureData(r.data, '還原規則');
}

export async function getRuleHistory(ruleId: string): Promise<{ rule_id: string; history: RuleHistoryEntry[] }> {
  const r = await apiClient.get(
    `/pharmacy/drug-library/rules/${encodeURIComponent(ruleId)}/history`,
  );
  return ensureData(r.data, '規則歷史');
}
