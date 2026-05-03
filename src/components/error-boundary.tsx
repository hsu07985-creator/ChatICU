import React from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorDisplay } from './ui/state-display';
import { Button } from './ui/button';
import { RefreshCw, Home } from 'lucide-react';
import i18n from '../i18n/config';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// Class-based ErrorBoundary cannot use hooks; render() reads i18n.t directly.
// Translations refresh on next render (e.g. when language toggle re-renders
// the parent tree).
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Error info:', errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/dashboard';
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const t = (key: string) => i18n.t(key, { ns: 'errors' });

      return (
        <div className="min-h-[400px] flex flex-col items-center justify-center p-8">
          <ErrorDisplay
            type="generic"
            title={t('boundary.title')}
            message={this.state.error?.message || t('boundary.fallbackMessage')}
          />
          <div className="flex gap-3 mt-6">
            <Button onClick={this.handleRetry} className="bg-brand hover:bg-brand-hover">
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('boundary.reload')}
            </Button>
            <Button onClick={this.handleGoHome} variant="outline">
              <Home className="mr-2 h-4 w-4" />
              {t('boundary.goHome')}
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function SectionErrorBoundary({
  children,
  sectionName,
}: {
  children: React.ReactNode;
  sectionName?: string;
}) {
  const { t } = useTranslation('errors');
  const name = sectionName ?? t('boundary.sectionDefaultName');
  return (
    <ErrorBoundary
      fallback={
        <div className="p-4 border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 rounded-lg">
          <p className="text-red-600 dark:text-red-400 text-center">
            {t('boundary.sectionFailed', { section: name })}
          </p>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}
