import type { Patient } from './api/patients';

// ─── 欄位定義 ────────────────────────────────────────────────────────────────

export type PatientFieldPriority = 'high' | 'medium' | 'low';

export interface PatientFieldMeta {
  label: string;
  /** high = 影響計算（劑量、呼吸器天數）
   *  medium = 影響藥局頁面顯示
   *  low = 純顯示用
   */
  priority: PatientFieldPriority;
}

/** 追蹤 diff 的欄位（跳過 id、lastUpdate、bmi、ventilatorDays 等衍生欄位） */
const TRACKED_FIELDS: Partial<Record<keyof Patient, PatientFieldMeta>> = {
  // 高優先（影響計算）
  height:          { label: '身高',     priority: 'high'   },
  weight:          { label: '體重',     priority: 'high'   },
  intubated:       { label: '插管狀態', priority: 'high'   },
  intubationDate:  { label: '插管日期', priority: 'high'   },
  tracheostomy:    { label: '氣切狀態', priority: 'high'   },
  tracheostomyDate:{ label: '氣切日期', priority: 'high'   },
  // 中優先（影響藥局頁面）
  sedation:        { label: '鎮靜劑',   priority: 'medium' },
  analgesia:       { label: '止痛劑',   priority: 'medium' },
  nmb:             { label: '肌肉鬆弛劑', priority: 'medium' },
  // 低優先（顯示用）
  name:            { label: '姓名',     priority: 'low'    },
  bedNumber:       { label: '床號',     priority: 'low'    },
  gender:          { label: '性別',     priority: 'low'    },
  age:             { label: '年齡',     priority: 'low'    },
  diagnosis:       { label: '入院診斷', priority: 'low'    },
  admissionDate:   { label: '入院日期', priority: 'low'    },
  icuAdmissionDate:{ label: 'ICU入院日期', priority: 'low' },
  attendingPhysician: { label: '主治醫師', priority: 'low' },
  department:      { label: '科別',     priority: 'low'    },
  consentStatus:   { label: '同意書狀態', priority: 'low'  },
  hasDNR:          { label: 'DNR',      priority: 'low'    },
  isIsolated:      { label: '隔離狀態', priority: 'low'    },
  codeStatus:      { label: 'Code狀態', priority: 'low'    },
  criticalStatus:  { label: '危急狀態', priority: 'low'    },
  bloodType:       { label: '血型',     priority: 'low'    },
};

// ─── 型別 ────────────────────────────────────────────────────────────────────

export interface ChangedField {
  field: keyof Patient;
  label: string;
  priority: PatientFieldPriority;
  oldValue: unknown;
  newValue: unknown;
}

export interface PatientDiffResult {
  hasChanges: boolean;
  changed: ChangedField[];
  /** 只有 high/medium 的欄位，即「影響計算或藥局頁面」的變動 */
  hasClinicalChanges: boolean;
}

// ─── 比較工具 ─────────────────────────────────────────────────────────────────

/** 陣列比較：排序後逐一比對（處理順序不同的情況） */
function arraysEqual(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

/** 統一 null / undefined → null，避免 null vs undefined 誤報差異 */
function normalize(value: unknown): unknown {
  return value === undefined ? null : value;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (Array.isArray(na) || Array.isArray(nb)) return arraysEqual(na, nb);
  return na === nb;
}

// ─── 主函數 ───────────────────────────────────────────────────────────────────

/**
 * 比較兩個 Patient 物件，回傳有差異的欄位清單。
 *
 * @param oldPatient - 舊的（目前頁面持有的）病人資料
 * @param newPatient - 新的（從 shared cache 拿到的）病人資料
 */
export function diffPatient(
  oldPatient: Patient,
  newPatient: Patient,
): PatientDiffResult {
  const changed: ChangedField[] = [];

  for (const [field, meta] of Object.entries(TRACKED_FIELDS) as [keyof Patient, PatientFieldMeta][]) {
    const oldVal = oldPatient[field];
    const newVal = newPatient[field];
    if (!valuesEqual(oldVal, newVal)) {
      changed.push({
        field,
        label: meta.label,
        priority: meta.priority,
        oldValue: normalize(oldVal),
        newValue: normalize(newVal),
      });
    }
  }

  return {
    hasChanges: changed.length > 0,
    changed,
    hasClinicalChanges: changed.some(c => c.priority === 'high' || c.priority === 'medium'),
  };
}

// ─── 顯示工具 ─────────────────────────────────────────────────────────────────

/** 把 ChangedField[] 轉成可顯示的摘要文字，例如「身高、插管日期」 */
export function formatChangedFieldLabels(changed: ChangedField[]): string {
  return changed.map(c => c.label).join('、');
}

/** 只取 high priority 的變動（用於 dosage 表單同步判斷） */
export function getHighPriorityChanges(changed: ChangedField[]): ChangedField[] {
  return changed.filter(c => c.priority === 'high');
}
