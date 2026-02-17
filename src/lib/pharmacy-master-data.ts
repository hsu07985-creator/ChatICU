import type { LucideIcon } from 'lucide-react';

export interface AdviceCodeItem {
  code: string;
  label: string;
}

export interface AdviceCategoryItem {
  key: string;
  label: string;
  codes: AdviceCodeItem[];
}

// Pharmacist care intervention codes (4 categories, 23 sub-codes) — fixed master data.
export const PHARMACY_ADVICE_CATEGORIES: Record<string, AdviceCategoryItem> = {
  prescription: {
    key: 'prescription',
    label: '1. 建議處方',
    codes: [
      { code: '1-1', label: '建議更適當用藥/配方組成' },
      { code: '1-2', label: '用藥途徑或劑型問題' },
      { code: '1-3', label: '用藥期間/數量問題（包含停藥）' },
      { code: '1-4', label: '用藥劑量/頻次問題' },
      { code: '1-5', label: '不符健保給付規定' },
      { code: '1-6', label: '其他' },
      { code: '1-7', label: '藥品相容性問題' },
      { code: '1-8', label: '疑似藥品不良反應' },
      { code: '1-9', label: '藥品交互作用' },
      { code: '1-10', label: '藥品併用問題' },
      { code: '1-11', label: '用藥替急問題（包括過敏史）' },
      { code: '1-12', label: '適應症問題' },
      { code: '1-13', label: '給藥問題（途徑、輸注方式、濃度或稀釋液）' },
    ],
  },
  proactive: {
    key: 'proactive',
    label: '2. 主動建議',
    codes: [
      { code: '2-1', label: '建議靜脈營養配方' },
      { code: '2-2', label: '建議藥物治療療程' },
      { code: '2-3', label: '建議用藥/建議增加用藥' },
      { code: '2-4', label: '藥品不良反應評估' },
    ],
  },
  monitoring: {
    key: 'monitoring',
    label: '3. 建議監測',
    codes: [
      { code: '3-1', label: '建議藥品濃度監測' },
      { code: '3-2', label: '建議藥品不良反應監測' },
      { code: '3-3', label: '建議藥品療效監測' },
    ],
  },
  appropriateness: {
    key: 'appropriateness',
    label: '4. 用藥適從性',
    codes: [
      { code: '4-1', label: '病人用藥適從性問題' },
      { code: '4-2', label: '藥品辨識/自備藥辨識' },
      { code: '4-3', label: '藥歷查核與整合' },
    ],
  },
};

export const PHARMACY_ADVICE_CATEGORY_COLORS: Record<string, string> = {
  '1. 建議處方': '#7f265b',
  '2. 主動建議': '#f59e0b',
  '3. 建議監測': '#1a1a1a',
  '4. 用藥適從性': '#3b82f6',
};

export function getAdviceCodeInfo(code: string): { category: string; label: string } | null {
  for (const cat of Object.values(PHARMACY_ADVICE_CATEGORIES)) {
    const found = cat.codes.find((c) => c.code === code);
    if (found) return { category: cat.label, label: found.label };
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

