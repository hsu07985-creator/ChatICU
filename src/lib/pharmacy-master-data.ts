import type { LucideIcon } from 'lucide-react';

export interface AdviceCodeItem {
  code: string;
  /** Source-of-truth Chinese label. Stored in DB as `record.adviceLabel`. Use t(labelKey) for display when available. */
  label: string;
  /**
   * i18n key for display. Format: `pharmacy:adviceCodes.<code>` (e.g. `1-A`).
   * Optional because response-code lists do not have i18n yet.
   */
  labelKey?: string;
}

export interface AdviceCategoryItem {
  key: string;
  /** Source-of-truth Chinese label. Stored in DB as `record.category`. Use t(labelKey) for display when available. */
  label: string;
  /** i18n key for display. Format: `pharmacy:adviceCategories.<key>`. Optional for legacy categories. */
  labelKey?: string;
  codes: AdviceCodeItem[];
}

// Helper to keep code definitions terse: builds the labelKey from the code.
const c = (code: string, label: string): AdviceCodeItem => ({
  code,
  label,
  labelKey: `pharmacy:adviceCodes.${code}`,
});

// 臨床藥事照護介入類別（4大類 23小項）— 依健保 VPN 登錄附件4。
// 項目 10-13 同時屬於「建議處方」和「主動建議」。
export const PHARMACY_ADVICE_CATEGORIES: Record<string, AdviceCategoryItem> = {
  prescription: {
    key: 'prescription',
    label: '1. 建議處方',
    labelKey: 'pharmacy:adviceCategories.prescription',
    codes: [
      c('1-A', '給藥問題(速率、輸注方式、濃度或稀釋液)'),
      c('1-B', '適應症問題'),
      c('1-C', '用藥禁忌問題(包括過敏史)'),
      c('1-D', '藥品併用問題'),
      c('1-E', '藥品交互作用'),
      c('1-F', '疑似藥品不良反應'),
      c('1-G', '藥品相容性問題'),
      c('1-H', '其他'),
      c('1-I', '不符健保給付規定'),
      c('1-J', '用藥劑量/頻次問題'),
      c('1-K', '用藥期間/數量問題(包含停藥)'),
      c('1-L', '用藥途徑或劑型問題'),
      c('1-M', '建議更適當用藥/配方組成'),
    ],
  },
  proactive: {
    key: 'proactive',
    label: '2. 主動建議',
    labelKey: 'pharmacy:adviceCategories.proactive',
    codes: [
      c('2-J', '用藥劑量/頻次問題'),
      c('2-K', '用藥期間/數量問題(包含停藥)'),
      c('2-L', '用藥途徑或劑型問題'),
      c('2-M', '建議更適當用藥/配方組成'),
      c('2-N', '藥品不良反應評估'),
      c('2-O', '建議用藥/建議增加用藥'),
      c('2-P', '建議藥物治療療程'),
      c('2-Q', '建議靜脈營養配方'),
    ],
  },
  monitoring: {
    key: 'monitoring',
    label: '3. 建議監測',
    labelKey: 'pharmacy:adviceCategories.monitoring',
    codes: [
      c('3-R', '建議藥品療效監測'),
      c('3-S', '建議藥品不良反應監測'),
      c('3-T', '建議藥品血中濃度監測'),
    ],
  },
  continuity: {
    key: 'continuity',
    label: '4. 用藥連貫性',
    labelKey: 'pharmacy:adviceCategories.continuity',
    codes: [
      c('4-U', '藥歷審核與整合'),
      c('4-V', '藥品辨識/自備藥辨識'),
      c('4-W', '病人用藥遵從性問題'),
    ],
  },
};

// Colour map keyed by category.key (English ID) — was previously keyed by Chinese label,
// which broke i18n by leaking display strings into lookups. Use getAdviceCategoryColor()
// when you only have the Chinese label coming back from the API.
export const PHARMACY_ADVICE_CATEGORY_COLORS: Record<string, string> = {
  prescription: 'var(--color-brand)',
  proactive: '#f59e0b',
  monitoring: '#1a1a1a',
  continuity: '#3b82f6',
};

/** Look up category.key from a Chinese label (back from API responses). */
export function getAdviceCategoryKeyByLabel(label: string): string | undefined {
  return Object.values(PHARMACY_ADVICE_CATEGORIES).find((c) => c.label === label)?.key;
}

/** Get color by Chinese label (from API record.category). Falls back to brand color. */
export function getAdviceCategoryColor(labelOrKey: string): string {
  // If passed a key directly, use it; otherwise resolve key from Chinese label.
  if (PHARMACY_ADVICE_CATEGORY_COLORS[labelOrKey]) return PHARMACY_ADVICE_CATEGORY_COLORS[labelOrKey];
  const key = getAdviceCategoryKeyByLabel(labelOrKey);
  return (key && PHARMACY_ADVICE_CATEGORY_COLORS[key]) || 'var(--color-brand)';
}

export function getAdviceCodeInfo(code: string): { category: string; categoryKey: string; categoryLabelKey?: string; label: string; labelKey?: string } | null {
  for (const cat of Object.values(PHARMACY_ADVICE_CATEGORIES)) {
    const found = cat.codes.find((it) => it.code === code);
    if (found) return {
      category: cat.label,
      categoryKey: cat.key,
      categoryLabelKey: cat.labelKey,
      label: found.label,
      labelKey: found.labelKey,
    };
  }
  return null;
}

// Doctor response codes — fixed master data (used for pharmacist documentation).
export interface ResponseCodeCategory {
  key: string;
  label: string;
  codes: AdviceCodeItem[];
  icon?: LucideIcon;
}

export const PHARMACY_RESPONSE_CODE_CATEGORIES: Record<string, ResponseCodeCategory> = {
  accept: {
    key: 'accept',
    label: 'Accept 接受',
    codes: [
      { code: 'A-AC', label: '接受並執行 (Accept and Comply)' },
      { code: 'A-N', label: '已知悉（備註）(Acknowledge with Note)' },
      { code: 'A-AS', label: '同意並停藥 (Accept and Stop)' },
    ],
  },
  warning: {
    key: 'warning',
    label: 'Warning 警示',
    codes: [
      { code: 'W-N', label: '已知悉 (Noted)' },
      { code: 'W-M', label: '監測中 (Monitoring)' },
      { code: 'W-A', label: '調整劑量 (Adjust)' },
      { code: 'W-S', label: '停藥 (Stop)' },
    ],
  },
  controversy: {
    key: 'controversy',
    label: 'Controversy 爭議',
    codes: [
      { code: 'C-N', label: '已知悉 (Noted)' },
      { code: 'C-C', label: '繼續使用 (Continue)' },
      { code: 'C-M', label: '修改處方 (Modify)' },
    ],
  },
  adverse: {
    key: 'adverse',
    label: 'Adverse 不良回應',
    codes: [
      { code: 'N-N', label: '不回應 (No Response)' },
      { code: 'N-NI', label: '資訊不足 (Not enough Information)' },
      { code: 'N-R', label: '拒絕建議 (Reject)' },
    ],
  },
};

export const IV_COMPATIBILITY_SOLUTIONS: Array<{ value: string; label: string }> = [
  { value: 'none', label: '不限定' },
  { value: 'NS', label: 'NS (Normal Saline)' },
  { value: 'D5W', label: 'D5W (5% Dextrose)' },
  { value: 'LR', label: "LR (Lactated Ringer's)" },
  { value: 'D5NS', label: 'D5NS' },
];

export const ERROR_REPORT_TYPES: Array<{ value: string; label: string }> = [
  { value: '開立錯誤', label: '開立錯誤' },
  { value: '劑量錯誤', label: '劑量錯誤' },
  { value: '重複給藥', label: '重複給藥' },
  { value: '路徑錯誤', label: '路徑錯誤' },
  { value: '頻次錯誤', label: '頻次錯誤' },
  { value: '藥品辨識錯誤', label: '藥品辨識錯誤' },
  { value: '其他', label: '其他' },
];

export const ERROR_REPORT_SEVERITIES: Array<{ value: 'low' | 'moderate' | 'high'; label: string }> = [
  { value: 'low', label: '輕微 - 未到達病患' },
  { value: 'moderate', label: '中度 - 無明顯傷害' },
  { value: 'high', label: '嚴重 - 可能造成傷害' },
];

