import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { ErrorDisplay, LoadingSpinner } from '../ui/state-display';

type PatientDetailState = 'loading' | 'error' | 'notFound';

interface PatientDetailStateGuardProps {
  state: PatientDetailState;
  errorMessage?: string;
  onRetry: () => void;
  onBackToPatients: () => void;
}

export function PatientDetailStateGuard({
  state,
  errorMessage,
  onRetry,
  onBackToPatients,
}: PatientDetailStateGuardProps) {
  const { t } = useTranslation('patient-detail');
  if (state === 'loading') {
    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center p-6">
        <LoadingSpinner size="lg" text={t('state.loadingPatient')} />
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="p-6">
        <ErrorDisplay
          type="server"
          title={t('state.loadFailedTitle')}
          message={errorMessage || t('state.loadFailedMessage')}
          onRetry={onRetry}
        />
        <div className="flex justify-center mt-4">
          <Button onClick={onBackToPatients} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('header.backToList')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <ErrorDisplay
        type="notFound"
        title={t('state.notFoundTitle')}
        message={t('state.notFoundMessage')}
      />
      <div className="flex justify-center mt-4">
        <Button onClick={onBackToPatients} variant="outline">
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t('header.backToList')}
        </Button>
      </div>
    </div>
  );
}
