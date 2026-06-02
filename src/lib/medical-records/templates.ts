import { useTranslation } from 'react-i18next';
import { FileText, Pill, ClipboardList } from 'lucide-react';
import { EMPTY_SOAP, type SoapDraft } from '../../components/pharmacist-soap-editor';
import type { RecordType } from './draft-storage';

export type { RecordType };

export const RECORD_TYPES: RecordType[] = ['progress-note', 'medication-advice', 'nursing-record'];

export type RecordTypeConfig = {
  label: string;
  icon: typeof FileText;
  description: string;
  placeholder: string;
  polishLabel: string;
};

// Icons stay static; labels/strings come from t() so language switches re-render.
export const RECORD_TYPE_ICONS: Record<RecordType, typeof FileText> = {
  'progress-note': FileText,
  'medication-advice': Pill,
  'nursing-record': ClipboardList,
};

export function useRecordTypeConfig(): Record<RecordType, RecordTypeConfig> {
  const { t } = useTranslation('medical-records');
  return {
    'progress-note': {
      label: t('recordTypes.progressNote.label'),
      icon: RECORD_TYPE_ICONS['progress-note'],
      description: t('recordTypes.progressNote.description'),
      placeholder: t('recordTypes.progressNote.placeholder'),
      polishLabel: t('recordTypes.progressNote.polishLabel'),
    },
    'medication-advice': {
      label: t('recordTypes.medicationAdvice.label'),
      icon: RECORD_TYPE_ICONS['medication-advice'],
      description: t('recordTypes.medicationAdvice.description'),
      placeholder: t('recordTypes.medicationAdvice.placeholder'),
      polishLabel: t('recordTypes.medicationAdvice.polishLabel'),
    },
    'nursing-record': {
      label: t('recordTypes.nursingRecord.label'),
      icon: RECORD_TYPE_ICONS['nursing-record'],
      description: t('recordTypes.nursingRecord.description'),
      placeholder: t('recordTypes.nursingRecord.placeholder'),
      polishLabel: t('recordTypes.nursingRecord.polishLabel'),
    },
  };
}

export type TemplateContent = string | { soap: SoapDraft };

export const PHARMACIST_SOAP_TEMPLATE_NAME = '藥師 SOAP';

/** Maps the UI record-type onto the polish API's snake_case discriminator.
 *  Hoisted to a module const (was duplicated inside polish + refine). */
export const polishTypeMap: Record<RecordType, 'progress_note' | 'medication_advice' | 'nursing_record'> = {
  'progress-note': 'progress_note',
  'medication-advice': 'medication_advice',
  'nursing-record': 'nursing_record',
};

export function isSoapTemplate(tpl: TemplateContent | undefined): tpl is { soap: SoapDraft } {
  return !!tpl && typeof tpl !== 'string' && typeof tpl.soap === 'object';
}

export function flattenSoapTemplate(tpl: { soap: SoapDraft }): string {
  const { s, o, a, p } = tpl.soap;
  const sections = [
    { key: 'S', value: s },
    { key: 'O', value: o },
    { key: 'A', value: a },
    { key: 'P', value: p },
  ].filter(({ value }) => value && value.trim().length > 0);
  // When only one section has content, drop the section header. The polish
  // prompt expects no synthetic 'P:' / 'A:' prefix unless the pharmacist
  // wrote one — a leaked header would echo back into the AI output.
  if (sections.length === 1) return sections[0].value;
  return sections.map(({ key, value }) => `${key}:\n${value}`).join('\n\n');
}

export const BUILTIN_TEMPLATES: Record<RecordType, Record<string, TemplateContent>> = {
  'progress-note': {
    'SOAP 格式': `S (Subjective):
O (Objective):
  Physical exam:
A (Assessment):
P (Plan):`,
    '簡要紀錄': `主訴:
目前狀況:
處置計畫:`,
  },
  'medication-advice': {
    [PHARMACIST_SOAP_TEMPLATE_NAME]: {
      soap: {
        s: '',
        o: '',
        a: '',
        p: '1.Please consider...\n2.Continue to monitor...',
      },
    },
    '劑量調整建議': `藥品名稱:
目前劑量:
建議調整:
調整原因:
監測項目:`,
    '新增藥品建議': `建議藥品:
適應症:
建議劑量:
給藥途徑:
注意事項:`,
  },
  'nursing-record': {
    '一般交班': `病患意識:
生命徵象:
呼吸器設定:
管路:
輸液:
尿量:
特殊狀況:`,
    '鎮靜評估': `RASS Score:
CAM-ICU:
使用鎮靜劑:
劑量調整:
呼吸型態:
建議:`,
    '管路評估': `氣管內管:
中心靜脈導管:
動脈導管:
尿管:
鼻胃管:
其他管路:`,
    '傷口護理': `傷口位置:
傷口大小:
傷口深度:
滲液:
紅腫熱痛:
換藥頻率:
使用敷料:`,
  },
};
