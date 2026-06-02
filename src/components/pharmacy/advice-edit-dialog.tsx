// Edit-record dialog for the advice-statistics page, extracted from
// src/pages/pharmacy/advice-statistics.tsx. Fully controlled: the page owns all
// state and handlers; this component only renders. Behavior-preserving.

import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Edit2, Loader2 } from 'lucide-react';
import { PHARMACY_ADVICE_CATEGORIES, type AdviceCategoryItem } from '../../lib/pharmacy-master-data';

export type EditAcceptedValue = 'yes' | 'no' | 'pending';

export interface AdviceEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryKey: string;
  onCategoryKeyChange: (value: string) => void;
  code: string;
  onCodeChange: (value: string) => void;
  accepted: EditAcceptedValue;
  onAcceptedChange: (value: EditAcceptedValue) => void;
  content: string;
  onContentChange: (value: string) => void;
  linkedMedications: string;
  onLinkedMedicationsChange: (value: string) => void;
  selectedCategory: AdviceCategoryItem | null;
  /** Whether the currently-selected (category, code) pair resolves to a code item. */
  hasSelectedCode: boolean;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}

export function AdviceEditDialog({
  open,
  onOpenChange,
  categoryKey,
  onCategoryKeyChange,
  code,
  onCodeChange,
  accepted,
  onAcceptedChange,
  content,
  onContentChange,
  linkedMedications,
  onLinkedMedicationsChange,
  selectedCategory,
  hasSelectedCode,
  saving,
  onSave,
  onCancel,
}: AdviceEditDialogProps) {
  const { t } = useTranslation('pharmacy');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit2 className="h-5 w-5 text-brand" />
            {t('adviceStats.editDialogTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('adviceStats.editDialogDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">{t('adviceStats.category')} *</label>
              <Select
                value={categoryKey}
                onValueChange={(value) => {
                  onCategoryKeyChange(value);
                  onCodeChange('');
                }}
              >
                <SelectTrigger>
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

            <div className="space-y-1">
              <label className="text-xs font-medium">{t('adviceStats.subitem')} *</label>
              <Select value={code} onValueChange={onCodeChange} disabled={!selectedCategory}>
                <SelectTrigger>
                  <SelectValue placeholder={selectedCategory ? t('adviceStats.selectSubitem') : t('adviceStats.pickCategoryFirst')} />
                </SelectTrigger>
                <SelectContent>
                  {selectedCategory?.codes.map((item) => (
                    <SelectItem key={item.code} value={item.code}>
                      {item.code} {t(item.labelKey ?? item.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium">{t('adviceStats.doctorAccept')}</label>
              <Select value={accepted} onValueChange={(value) => onAcceptedChange(value as EditAcceptedValue)}>
                <SelectTrigger>
                  <SelectValue placeholder={t('adviceStats.selectStatus')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">{t('adviceStats.statusPending')}</SelectItem>
                  <SelectItem value="yes">{t('adviceStats.accepted')}</SelectItem>
                  <SelectItem value="no">{t('adviceStats.rejected')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">{t('adviceStats.recordContent')} *</label>
            <Textarea
              value={content}
              onChange={(event) => onContentChange(event.target.value)}
              className="min-h-[140px]"
              placeholder={t('adviceStats.recordContentPlaceholder')}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">{t('adviceStats.linkedDrugs')}</label>
            <Input
              value={linkedMedications}
              onChange={(event) => onLinkedMedicationsChange(event.target.value)}
              placeholder={t('adviceStats.linkedDrugsPlaceholder')}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            {t('adviceStats.cancel')}
          </Button>
          <Button
            onClick={onSave}
            disabled={saving || !selectedCategory || !hasSelectedCode || !content.trim()}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Edit2 className="mr-2 h-4 w-4" />}
            {t('adviceStats.saveChanges')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
