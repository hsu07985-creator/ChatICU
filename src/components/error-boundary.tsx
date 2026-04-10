import React from 'react';
import { ErrorDisplay } from './ui/state-display';
import { Button } from './ui/button';
import { RefreshCw, Home } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary 組件
 * 捕獲子組件中的 JavaScript 錯誤並顯示備用 UI
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // 可以在這裡記錄錯誤到錯誤報告服務
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

      return (
        <div className="min-h-[400px] flex flex-col items-center justify-center p-8">
          <ErrorDisplay
            type="generic"
            title="發生錯誤"
            message={this.state.error?.message || '頁面發生未預期的錯誤'}
          />
          <div className="flex gap-3 mt-6">
            <Button onClick={this.handleRetry} className="bg-brand hover:bg-brand-hover">
              <RefreshCw className="mr-2 h-4 w-4" />
              重新載入
            </Button>
            <Button onClick={this.handleGoHome} variant="outline">
              <Home className="mr-2 h-4 w-4" />
              返回首頁
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * 用於包裝單一區塊的 ErrorBoundary
 */
export function SectionErrorBoundary({ 
  children, 
  sectionName = '區塊' 
}: { 
  children: React.ReactNode; 
  sectionName?: string;
}) {
  return (
    <ErrorBoundary
      fallback={
        <div className="p-4 border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 rounded-lg">
          <p className="text-red-600 dark:text-red-400 text-center">
            {sectionName}載入失敗，請重新整理頁面
          </p>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}

