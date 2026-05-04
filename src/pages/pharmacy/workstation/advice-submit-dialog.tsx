import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { Label } from '../../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { adviceCategories } from './types';
import { useTranslation } from 'react-i18next';

interface AdviceSubmitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCategory: string;
  selectedAdviceCode: string;
  onCategoryChange: (value: string) => void;
  onAdviceCodeChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AdviceSubmitDialog({
  open,
  onOpenChange,
  selectedCategory,
  selectedAdviceCode,
  onCategoryChange,
  onAdviceCodeChange,
  onConfirm,
  onCancel,
}: AdviceSubmitDialogProps) {
  const { t } = useTranslation('pharmacy');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t('workstation.submitDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('workstation.submitDialog.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('workstation.submitDialog.step1Label')}</Label>
            <Select value={selectedCategory} onValueChange={onCategoryChange}>
              <SelectTrigger>
                <SelectValue placeholder={t('workstation.submitDialog.step1Placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(adviceCategories).map(([key, category]) => (
                  <SelectItem key={key} value={key}>
                    {t(category.labelKey ?? category.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedCategory && (
            <div className="space-y-2">
              <Label>{t('workstation.submitDialog.step2Label')}</Label>
              <Select value={selectedAdviceCode} onValueChange={onAdviceCodeChange}>
                <SelectTrigger>
                  <SelectValue placeholder={t('workstation.submitDialog.step2Placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {adviceCategories[selectedCategory as keyof typeof adviceCategories].codes.map((item) => (
                    <SelectItem key={item.code} value={item.code}>
                      {t(item.labelKey ?? item.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={onConfirm}
            disabled={!selectedAdviceCode}
            className="bg-brand hover:bg-brand-hover"
          >
            {t('workstation.submitDialog.confirm')}
          </Button>
          <Button onClick={onCancel} variant="outline">
            {t('workstation.submitDialog.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
