// Delete-confirmation dialog for the advice-statistics page, extracted from
// src/pages/pharmacy/advice-statistics.tsx. Fully controlled. Behavior-preserving.

import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { Loader2, Trash2 } from 'lucide-react';
import type { PharmacyAdviceRecord } from '../../lib/api/pharmacy';

export interface AdviceDeleteDialogProps {
  record: PharmacyAdviceRecord | null;
  onOpenChange: (open: boolean) => void;
  deleting: boolean;
  onConfirm: () => void;
}

export function AdviceDeleteDialog({
  record,
  onOpenChange,
  deleting,
  onConfirm,
}: AdviceDeleteDialogProps) {
  const { t } = useTranslation('pharmacy');

  return (
    <AlertDialog
      open={record !== null}
      onOpenChange={(open) => {
        if (!open && !deleting) onOpenChange(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('adviceStats.deleteRecord')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('adviceStats.deleteDialogDesc', { code: record?.adviceCode ?? '', label: record?.adviceLabel ?? '' })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>{t('adviceStats.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-600 hover:bg-red-700 text-white"
            disabled={deleting}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
            {t('adviceStats.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
