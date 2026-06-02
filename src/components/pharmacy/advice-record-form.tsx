// "New advice record" form card for the advice-statistics page, extracted from
// src/pages/pharmacy/advice-statistics.tsx. Fully controlled: the page owns all
// state and submit handler. Behavior-preserving.

import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Loader2, Send } from 'lucide-react';
import { maskPatientName } from '../../lib/utils/patient-name';
import { PHARMACY_ADVICE_CATEGORIES, type AdviceCategoryItem } from '../../lib/pharmacy-master-data';
import type { Patient } from '../../lib/api/patients';

export interface AdviceRecordFormProps {
  patients: Patient[];
  patientsLoading: boolean;
  selectedPatientId: string;
  onSelectedPatientIdChange: (value: string) => void;
  selectedCategoryKey: string;
  onSelectedCategoryKeyChange: (value: string) => void;
  selectedCode: string;
  onSelectedCodeChange: (value: string) => void;
  accepted: string;
  onAcceptedChange: (value: string) => void;
  content: string;
  onContentChange: (value: string) => void;
  selectedCategory: AdviceCategoryItem | null;
  submitting: boolean;
  onSubmit: () => void;
}

export function AdviceRecordForm({
  patients,
  patientsLoading,
  selectedPatientId,
  onSelectedPatientIdChange,
  selectedCategoryKey,
  onSelectedCategoryKeyChange,
  selectedCode,
  onSelectedCodeChange,
  accepted,
  onAcceptedChange,
  content,
  onContentChange,
  selectedCategory,
  submitting,
  onSubmit,
}: AdviceRecordFormProps) {
  const { t } = useTranslation('pharmacy');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('adviceStats.newRecord')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-4">
          {/* 病患 */}
          <div className="space-y-1">
            <label className="text-xs font-medium">{t('adviceStats.patient')} *</label>
            {patientsLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground h-9">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('adviceStats.loading')}
              </div>
            ) : (
              <Select value={selectedPatientId} onValueChange={onSelectedPatientIdChange}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={t('adviceStats.selectPatient')} />
                </SelectTrigger>
                <SelectContent>
                  {patients.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.bedNumber} {maskPatientName(p.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* 類別 */}
          <div className="space-y-1">
            <label className="text-xs font-medium">{t('adviceStats.category')} *</label>
            <Select
              value={selectedCategoryKey}
              onValueChange={(v) => {
                onSelectedCategoryKeyChange(v);
                onSelectedCodeChange('');
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder={t('adviceStats.selectCategory')} />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PHARMACY_ADVICE_CATEGORIES).map(([key, cat]) => (
                  <SelectItem key={key} value={key}>
                    {t(cat.labelKey ?? cat.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 細項 */}
          <div className="space-y-1">
            <label className="text-xs font-medium">{t('adviceStats.subitem')} *</label>
            <Select
              value={selectedCode}
              onValueChange={onSelectedCodeChange}
              disabled={!selectedCategory}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder={selectedCategory ? t('adviceStats.selectSubitem') : t('adviceStats.pickCategoryFirst')} />
              </SelectTrigger>
              <SelectContent>
                {selectedCategory?.codes.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.code} {t(c.labelKey ?? c.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 醫師是否接受 */}
          <div className="space-y-1">
            <label className="text-xs font-medium">{t('adviceStats.doctorAccept')}</label>
            <Select value={accepted} onValueChange={onAcceptedChange}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder={t('adviceStats.selectAcceptance')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">{t('adviceStats.accepted')}</SelectItem>
                <SelectItem value="no">{t('adviceStats.rejected')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* 備註 + 送出 */}
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <Textarea
              placeholder={t('adviceStats.notePlaceholder')}
              value={content}
              onChange={(e) => onContentChange(e.target.value)}
              className="min-h-[60px] resize-none"
            />
          </div>
          <Button
            onClick={onSubmit}
            disabled={submitting || !selectedPatientId || !selectedCode}
            className="h-[60px] px-6"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                {t('adviceStats.submit')}
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
