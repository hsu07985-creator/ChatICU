import { useCallback, useEffect, useState } from 'react';
import { Bell, AtSign, MessageSquare, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';
import { useAuth } from '../lib/auth-context';
import { useRoleLabel } from '../lib/utils/user-role';
import { useNotificationSummary } from '../hooks/use-notification-summary';
import {
  getRecentNotifications,
  markAllNotificationsRead,
  type NotificationItem,
} from '../lib/api/notifications';

function useRelativeFormatter() {
  const { t, i18n } = useTranslation('common');
  return (ts: string): string => {
    const ms = new Date(ts).getTime();
    if (!ms) return '';
    const diffMin = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (diffMin < 1) return t('time.justNow');
    if (diffMin < 60) return t('time.minutesAgo', { count: diffMin });
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return t('time.hoursAgo', { count: diffHr });
    const diffDay = Math.round(diffHr / 24);
    if (diffDay < 7) return t('time.daysAgo', { count: diffDay });
    return new Date(ts).toLocaleDateString(i18n.language);
  };
}

export function NotificationBell() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { summary, refresh } = useNotificationSummary(isAuthenticated);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);

  const { t } = useTranslation(['notifications', 'common']);
  const roleLabel = useRoleLabel();
  const formatRelative = useRelativeFormatter();

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
    if (!open) return;
    void (async () => {
      await loadItems();
      // Clear the badge: mark every contributing message as read, then refetch
      // the summary so the red dot drops to 0 (covers alerts, which never
      // appear in the dropdown but still count toward `total`).
      try {
        await markAllNotificationsRead();
      } catch {
        // best-effort; summary will catch up on next 60s poll
      }
      refresh();
    })();
  }, [open, loadItems, refresh]);

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
          aria-label={count > 0 ? t('notifications:ariaWithCount', { count }) : t('notifications:ariaEmpty')}
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
          <span className="font-semibold text-sm">{t('notifications:title')}</span>
          <span className="text-xs text-muted-foreground">
            {t('notifications:summary', {
              mentions: summary?.mentions ?? 0,
              alerts: summary?.alerts ?? 0,
            })}
          </span>
        </div>
        <ScrollArea className="max-h-[420px]">
          {loading && items.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              {t('common:status.loading')}
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">
              <Bell className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p>{t('notifications:empty')}</p>
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
                          {t('notifications:labels.team')}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
                          <AtSign className="h-3 w-3" />
                          {item.bedNumber || t('notifications:labels.patient')}
                        </Badge>
                      )}
                      <span className="text-xs font-medium text-foreground truncate">
                        {item.authorName}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {roleLabel(item.authorRole)}
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
