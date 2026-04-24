import { useCallback, useEffect, useState } from 'react';
import { Bell, AtSign, MessageSquare, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';
import { useAuth } from '../lib/auth-context';
import { useNotificationSummary } from '../hooks/use-notification-summary';
import {
  getRecentNotifications,
  type NotificationItem,
} from '../lib/api/notifications';

const ROLE_LABEL: Record<string, string> = {
  doctor: '醫師',
  np: '專科護理師',
  nurse: '護理師',
  pharmacist: '藥師',
  admin: '管理者',
};

function formatRelative(ts: string): string {
  const t = new Date(ts).getTime();
  if (!t) return '';
  const diffMin = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (diffMin < 1) return '剛剛';
  if (diffMin < 60) return `${diffMin} 分鐘前`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小時前`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  return new Date(ts).toLocaleDateString('zh-TW');
}

export function NotificationBell() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { summary, refresh } = useNotificationSummary(isAuthenticated);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);

  const count = summary?.total ?? 0;

  // Tab title flash: prefix unread count when there is one.
  useEffect(() => {
    const base = 'ChatICU';
    document.title = count > 0 ? `(${count > 99 ? '99+' : count}) ${base}` : base;
    return () => {
      document.title = base;
    };
  }, [count]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await getRecentNotifications(30);
      setItems(resp.items);
    } catch {
      // best-effort UI; surfacing a toast would be noisy on a popover
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void loadItems();
  }, [open, loadItems]);

  const handleClickItem = (item: NotificationItem) => {
    setOpen(false);
    navigate(item.deepLink);
    // Refresh badge after a short delay so the count drops once the target
    // page has had a chance to mark its messages as read.
    setTimeout(() => refresh(), 1500);
  };

  if (!isAuthenticated) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-10 w-10 rounded-full bg-background/95 shadow-sm border border-border hover:bg-muted"
          aria-label={count > 0 ? `通知中心（${count} 則未讀）` : '通知中心'}
        >
          <Bell className="h-5 w-5" />
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-[10px] font-semibold text-white">
              {count > 99 ? '99+' : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="px-3 py-2 border-b flex items-center justify-between">
          <span className="font-semibold text-sm">通知中心</span>
          <span className="text-xs text-muted-foreground">
            未讀 {summary?.mentions ?? 0} 提及 · {summary?.alerts ?? 0} 警示
          </span>
        </div>
        <ScrollArea className="max-h-[420px]">
          {loading && items.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              載入中...
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">
              <Bell className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p>近 7 天沒有新通知</p>
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => handleClickItem(item)}
                    className={`w-full text-left px-3 py-2.5 hover:bg-muted transition-colors ${
                      item.isRead ? '' : 'bg-brand/5'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {item.source === 'team_chat' ? (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
                          <MessageSquare className="h-3 w-3" />
                          團隊
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
                          <AtSign className="h-3 w-3" />
                          {item.bedNumber || '病人'}
                        </Badge>
                      )}
                      <span className="text-xs font-medium text-foreground truncate">
                        {item.authorName}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {ROLE_LABEL[item.authorRole] || item.authorRole}
                      </span>
                      <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                        {formatRelative(item.timestamp)}
                      </span>
                    </div>
                    <p className="text-xs text-foreground line-clamp-2 leading-snug">
                      {item.preview}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
