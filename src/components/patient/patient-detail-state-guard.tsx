import { ArrowLeft } from 'lucide-react';
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
  if (state === 'loading') {
    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center p-6">
        <LoadingSpinner size="lg" text="載入病人資料中..." />
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="p-6">
        <ErrorDisplay
          type="server"
          title="載入失敗"
          message={errorMessage || '無法載入病人資料'}
          onRetry={onRetry}
        />
        <div className="flex justify-center mt-4">
          <Button onClick={onBackToPatients} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            返回病人清單
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <ErrorDisplay
        type="notFound"
        title="找不到病患"
        message="您所查詢的病患資料不存在或已被刪除"
      />
      <div className="flex justify-center mt-4">
        <Button onClick={onBackToPatients} variant="outline">
          <ArrowLeft className="mr-2 h-4 w-4" />
          返回病人清單
        </Button>
      </div>
    </div>
  );
}
