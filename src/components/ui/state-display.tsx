import { AlertCircle, RefreshCw, Inbox, Loader2, WifiOff, ServerCrash, ShieldX, FileWarning } from 'lucide-react';
import { Button } from './button';
import { Card, CardContent } from './card';
import { cn } from './utils';

// ========== Loading States ==========

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  text?: string;
}

export function LoadingSpinner({ size = 'md', className, text }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12'
  };

  return (
    <div className={cn('flex items-center justify-center gap-3', className)}>
      <Loader2 className={cn('animate-spin text-brand', sizeClasses[size])} />
      {text && <span className="text-muted-foreground">{text}</span>}
    </div>
  );
}

interface LoadingCardProps {
  title?: string;
  description?: string;
  className?: string;
}

export function LoadingCard({ title = '載入中', description, className }: LoadingCardProps) {
  return (
    <Card className={cn('border-dashed', className)}>
      <CardContent className="flex flex-col items-center justify-center py-12">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-brand/20 rounded-full"></div>
          <div className="w-16 h-16 border-4 border-brand border-t-transparent rounded-full animate-spin absolute top-0"></div>
        </div>
        <p className="mt-4 font-medium text-foreground">{title}</p>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </CardContent>
    </Card>
  );
}

export function LoadingOverlay({ text = '載入中...' }: { text?: string }) {
  return (
    <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-50 rounded-lg">
      <LoadingSpinner size="lg" text={text} />
    </div>
  );
}

// ========== Error States ==========

type ErrorType = 'network' | 'server' | 'permission' | 'notFound' | 'generic';

interface ErrorDisplayProps {
  type?: ErrorType;
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryText?: string;
  className?: string;
}

const errorConfig: Record<ErrorType, { icon: React.ElementType; defaultTitle: string; color: string }> = {
  network: { icon: WifiOff, defaultTitle: '網路連線失敗', color: 'text-orange-500' },
  server: { icon: ServerCrash, defaultTitle: '伺服器錯誤', color: 'text-red-500' },
  permission: { icon: ShieldX, defaultTitle: '權限不足', color: 'text-yellow-600' },
  notFound: { icon: FileWarning, defaultTitle: '找不到資源', color: 'text-gray-500' },
  generic: { icon: AlertCircle, defaultTitle: '發生錯誤', color: 'text-red-500' }
};

export function ErrorDisplay({ 
  type = 'generic', 
  title, 
  message, 
  onRetry, 
  retryText = '重新載入',
  className 
}: ErrorDisplayProps) {
  const config = errorConfig[type];
  const Icon = config.icon;

  return (
    <div className={cn('flex flex-col items-center justify-center py-12 px-4', className)}>
      <div className={cn('p-4 rounded-full bg-gray-100 mb-4', config.color)}>
        <Icon className="h-12 w-12" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">{title || config.defaultTitle}</h3>
      {message && <p className="text-sm text-muted-foreground text-center max-w-md mb-4">{message}</p>}
      {onRetry && (
        <Button onClick={onRetry} variant="outline" className="border-brand text-brand hover:bg-brand hover:text-white">
          <RefreshCw className="mr-2 h-4 w-4" />
          {retryText}
        </Button>
      )}
    </div>
  );
}

export function ErrorCard({ type, title, message, onRetry, className }: ErrorDisplayProps) {
  return (
    <Card className={cn('border-red-200 bg-red-50/50', className)}>
      <CardContent className="p-0">
        <ErrorDisplay type={type} title={title} message={message} onRetry={onRetry} />
      </CardContent>
    </Card>
  );
}

// ========== Empty States ==========

interface EmptyStateProps {
  icon?: React.ElementType;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12 px-4', className)}>
      <div className="p-4 rounded-full bg-gray-100 mb-4">
        <Icon className="h-12 w-12 text-gray-400" />
      </div>
      <h3 className="text-lg font-medium text-foreground mb-1">{title}</h3>
      {description && <p className="text-sm text-muted-foreground text-center max-w-md mb-4">{description}</p>}
      {action && (
        <Button onClick={action.onClick} className="bg-brand hover:bg-brand-hover">
          {action.label}
        </Button>
      )}
    </div>
  );
}

