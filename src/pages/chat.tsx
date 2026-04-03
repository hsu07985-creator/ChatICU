import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Textarea } from '../components/ui/textarea';
import { ScrollArea } from '../components/ui/scroll-area';
import { Send, Pin, MessageSquare, RefreshCw, AtSign, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { useAuth } from '../lib/auth-context';
import { getTeamChatMessages, sendTeamChatMessage, postAnnouncement, togglePinMessage, TeamChatMessage } from '../lib/api/team-chat';
import { getMyMentions, type MentionGroup } from '../lib/api/messages';
import { LoadingSpinner } from '../components/ui/state-display';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

// ── Module-level cache for chat messages (30s) + mentions (2min) ──
let _msgsCache: TeamChatMessage[] | null = null;
let _msgsTimestamp = 0;
const MSGS_STALE_MS = 30 * 1000; // 30 seconds — chat is semi-realtime

interface MentionsCacheEntry { groups: MentionGroup[]; total: number; unreadOnly: boolean }
let _mentionsCache: MentionsCacheEntry | null = null;
let _mentionsTimestamp = 0;
const MENTIONS_STALE_MS = 2 * 60 * 1000; // 2 minutes
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';

// 角色顯示名稱
const roleDisplayName: Record<string, string> = {
  doctor: '醫師',
  nurse: '護理師',
  pharmacist: '藥師',
  admin: '管理者',
};

// 格式化時間戳
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ChatPage() {
  const { user } = useAuth();
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<TeamChatMessage[]>(_msgsCache ?? []);
  const [loading, setLoading] = useState(!_msgsCache);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // 公告對話框狀態
  const [announcementDialogOpen, setAnnouncementDialogOpen] = useState(false);
  const [announcementContent, setAnnouncementContent] = useState('');
  const [postingAnnouncement, setPostingAnnouncement] = useState(false);

  // 右側面板：tab 切換
  const [sidebarTab, setSidebarTab] = useState<'pinned' | 'mentions'>('mentions');
  const [mentionGroups, setMentionGroups] = useState<MentionGroup[]>(_mentionsCache?.groups ?? []);
  const [mentionsLoading, setMentionsLoading] = useState(!_mentionsCache);
  const [mentionsTotalCount, setMentionsTotalCount] = useState(_mentionsCache?.total ?? 0);
  const [expandedPatients, setExpandedPatients] = useState<Set<string>>(new Set());
  const [mentionsUnreadOnly, setMentionsUnreadOnly] = useState(false);
  const navigate = useNavigate();

  // 載入訊息（帶快取）
  const loadMessages = useCallback(async (force = false) => {
    if (!force && _msgsCache && Date.now() - _msgsTimestamp < MSGS_STALE_MS) {
      setMessages(_msgsCache);
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const response = await getTeamChatMessages({ limit: 50 });
      _msgsCache = response.messages;
      _msgsTimestamp = Date.now();
      setMessages(response.messages);
    } catch (err) {
      console.error('載入團隊聊天訊息失敗:', err);
      setError('無法載入聊天訊息');
    } finally {
      setLoading(false);
    }
  }, []);

  // 載入 @提及（帶快取，unreadOnly 切換時強制刷新）
  const loadMentions = useCallback(async (forceUnreadOnly?: boolean) => {
    const unread = forceUnreadOnly ?? mentionsUnreadOnly;
    // Check cache (must match unreadOnly flag)
    if (_mentionsCache && _mentionsCache.unreadOnly === unread && Date.now() - _mentionsTimestamp < MENTIONS_STALE_MS) {
      setMentionGroups(_mentionsCache.groups);
      setMentionsTotalCount(_mentionsCache.total);
      setMentionsLoading(false);
      return;
    }
    setMentionsLoading(true);
    try {
      const result = await getMyMentions({ hoursBack: 168, unreadOnly: unread });
      _mentionsCache = { groups: result.groups, total: result.totalMentions, unreadOnly: unread };
      _mentionsTimestamp = Date.now();
      setMentionGroups(result.groups);
      setMentionsTotalCount(result.totalMentions);
    } catch (err) {
      console.error('載入 @提及 失敗:', err);
    } finally {
      setMentionsLoading(false);
    }
  }, [mentionsUnreadOnly]);

  // Initial load: messages first (priority), mentions in parallel
  useEffect(() => {
    loadMessages();
    loadMentions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // unreadOnly 切換 → invalidate mentions cache + refetch
  useEffect(() => {
    _mentionsCache = null;
    _mentionsTimestamp = 0;
    loadMentions(mentionsUnreadOnly);
  }, [mentionsUnreadOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  // 自動滾動到底部
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages]);

  const handleSend = async () => {
    if (!message.trim() || sending) return;

    setSending(true);
    try {
      const newMessage = await sendTeamChatMessage(message.trim());
      const updated = [...messages, newMessage];
      _msgsCache = updated; _msgsTimestamp = Date.now();
      setMessages(updated);
      setMessage('');
      toast.success('訊息已發送');
    } catch (err) {
      console.error('發送訊息失敗:', err);
      toast.error('發送訊息失敗，請稍後再試');
    } finally {
      setSending(false);
    }
  };

  // 發布公告
  const handlePostAnnouncement = async () => {
    if (!announcementContent.trim() || postingAnnouncement) return;

    setPostingAnnouncement(true);
    try {
      const newAnnouncement = await postAnnouncement(announcementContent.trim());
      const updated = [...messages, newAnnouncement];
      _msgsCache = updated; _msgsTimestamp = Date.now();
      setMessages(updated);
      setAnnouncementContent('');
      setAnnouncementDialogOpen(false);
      toast.success('公告已發布');
    } catch (err) {
      console.error('發布公告失敗:', err);
      toast.error('發布公告失敗，請稍後再試');
    } finally {
      setPostingAnnouncement(false);
    }
  };

  // 切換釘選狀態
  const handleTogglePin = async (messageId: string) => {
    try {
      const result = await togglePinMessage(messageId);
      // 更新本地訊息狀態
      setMessages(prev => prev.map(msg =>
        msg.id === messageId ? { ...msg, pinned: result.pinned } : msg
      ));
      toast.success(result.pinned ? '訊息已釘選' : '已取消釘選');
    } catch (err) {
      console.error('切換釘選狀態失敗:', err);
      toast.error('操作失敗，請稍後再試');
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">團隊聊天室</h1>
          <p className="text-muted-foreground text-sm mt-1">團隊溝通與工作協調</p>
        </div>
        <div className="flex gap-2">
          {user?.role === 'admin' && (
            <Button
              className="bg-brand hover:bg-brand-hover"
              onClick={() => setAnnouncementDialogOpen(true)}
            >
              <Pin className="mr-2 h-4 w-4" />
              發布公告
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* 主聊天區 */}
        <Card className="md:col-span-2">
          <CardHeader className="bg-slate-50 border-b flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-6 w-6 text-brand" />
              全體頻道
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => loadMessages(true)}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 訊息列表 */}
            <ScrollArea className="h-[500px] pr-4" ref={scrollAreaRef}>
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <LoadingSpinner size="lg" />
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <p className="text-red-500 mb-2">{error}</p>
                  <Button variant="outline" onClick={() => loadMessages(true)}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    重新載入
                  </Button>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  目前沒有訊息，開始與團隊對話吧！
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      data-testid="team-chat-message"
                      className={`group space-y-2 p-3 rounded-lg ${msg.pinned ? 'border-l-4 border-[#f59e0b] bg-slate-50' : 'bg-white border border-slate-200'}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">{msg.userName}</span>
                          <Badge variant="outline" className="text-xs">
                            {roleDisplayName[msg.userRole] || msg.userRole}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{formatTimestamp(msg.timestamp)}</span>
                          {msg.pinned && (
                            <Badge className="bg-[#f59e0b] text-white">
                              <Pin className="h-3.5 w-3.5 mr-1" />
                              已釘選
                            </Badge>
                          )}
                        </div>
                        {/* 釘選按鈕 - hover 時顯示 */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`opacity-0 group-hover:opacity-100 transition-opacity ${msg.pinned ? 'text-[#f59e0b]' : 'text-muted-foreground hover:text-[#f59e0b]'}`}
                          onClick={() => handleTogglePin(msg.id)}
                          title={msg.pinned ? '取消釘選' : '釘選此訊息'}
                        >
                          <Pin className="h-4 w-4" />
                        </Button>
                      </div>
                      <p className="text-base text-foreground leading-relaxed">{msg.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>

            {/* 輸入區 */}
            <div className="space-y-2 border-t border-slate-200 pt-4">
              <div className="flex items-center gap-2">
                <Send className="h-5 w-5 text-brand" />
                <label className="font-semibold text-foreground">發送訊息給團隊</label>
              </div>
              <div className="flex gap-3">
                <Textarea
                  placeholder="例如：I-1 床病患血鉀偏低，已補充 KCl..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  disabled={sending}
                  className="min-h-[80px] border border-brand focus:border-brand focus:ring-2 focus:ring-brand/20 text-base"
                />
                <Button
                  onClick={handleSend}
                  size="icon"
                  className="h-[80px] w-[80px] bg-brand hover:bg-brand-hover"
                  disabled={sending || !message.trim()}
                >
                  {sending ? (
                    <LoadingSpinner size="sm" className="text-white" />
                  ) : (
                    <Send className="h-6 w-6" />
                  )}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">按 Enter 發送，Shift + Enter 換行</p>
            </div>
          </CardContent>
        </Card>

        {/* 側邊欄 — Tabs: @我的留言 / 釘選訊息 */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="bg-slate-50 pb-0">
              <div className="flex border-b border-slate-200">
                <button
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    sidebarTab === 'mentions'
                      ? 'border-brand text-brand'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setSidebarTab('mentions')}
                >
                  <AtSign className="h-4 w-4" />
                  @我的留言
                  {mentionsTotalCount > 0 && (
                    <Badge className="bg-brand text-white text-xs ml-1">{mentionsTotalCount}</Badge>
                  )}
                </button>
                <button
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    sidebarTab === 'pinned'
                      ? 'border-[#f59e0b] text-[#f59e0b]'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setSidebarTab('pinned')}
                >
                  <Pin className="h-4 w-4" />
                  釘選訊息
                  {messages.filter(m => m.pinned).length > 0 && (
                    <Badge className="bg-[#f59e0b] text-white text-xs ml-1">{messages.filter(m => m.pinned).length}</Badge>
                  )}
                </button>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {/* @我的留言 Panel */}
              {sidebarTab === 'mentions' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <button
                      className={`text-xs px-2 py-1 rounded ${mentionsUnreadOnly ? 'bg-brand text-white' : 'bg-slate-50 text-muted-foreground'}`}
                      onClick={() => setMentionsUnreadOnly(!mentionsUnreadOnly)}
                    >
                      {mentionsUnreadOnly ? '僅未讀' : '全部'}
                    </button>
                    <Button variant="ghost" size="sm" onClick={loadMentions} disabled={mentionsLoading}>
                      <RefreshCw className={`h-3.5 w-3.5 ${mentionsLoading ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                  <ScrollArea className="max-h-[500px]">
                    {mentionsLoading ? (
                      <div className="flex justify-center py-8"><LoadingSpinner size="sm" /></div>
                    ) : mentionGroups.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground text-sm">
                        <AtSign className="h-12 w-12 mx-auto mb-4 opacity-30" />
                        <p>目前沒有被 @到的留言</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {mentionGroups.map((group) => {
                          const isExpanded = expandedPatients.has(group.patientId);
                          return (
                            <div key={group.patientId} className="rounded-lg border border-slate-200 overflow-hidden">
                              {/* Patient header */}
                              <button
                                className="w-full flex items-center gap-2 px-3 py-2.5 bg-white hover:bg-slate-50 transition-colors text-left"
                                onClick={() => setExpandedPatients(prev => {
                                  const next = new Set(prev);
                                  if (next.has(group.patientId)) next.delete(group.patientId);
                                  else next.add(group.patientId);
                                  return next;
                                })}
                              >
                                {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                                <Badge variant="outline" className="text-xs shrink-0">{group.bedNumber || '—'}</Badge>
                                <span className="font-medium text-sm text-foreground truncate">{group.patientName}</span>
                                <span className="ml-auto flex items-center gap-1.5 shrink-0">
                                  {group.unreadCount > 0 && (
                                    <Badge className="bg-red-500 text-white text-xs">{group.unreadCount} 未讀</Badge>
                                  )}
                                  <span className="text-xs text-muted-foreground">{group.totalCount} 則</span>
                                </span>
                              </button>
                              {/* Expanded messages */}
                              {isExpanded && (
                                <div className="border-t border-slate-200 bg-slate-50">
                                  {group.messages.map((msg) => (
                                    <div
                                      key={msg.id}
                                      className={`px-3 py-2 border-b border-slate-200 last:border-b-0 ${!msg.isRead ? 'bg-orange-50/60' : ''}`}
                                    >
                                      <div className="flex items-center gap-1.5 mb-1">
                                        <span className="text-xs font-medium text-foreground">{msg.authorName}</span>
                                        <Badge variant="outline" className="text-xs px-1 py-0">{roleDisplayName[msg.authorRole] || msg.authorRole}</Badge>
                                        <span className="text-xs text-muted-foreground ml-auto">{formatTimestamp(msg.timestamp)}</span>
                                      </div>
                                      <p className="text-sm text-foreground leading-relaxed line-clamp-3">{msg.content}</p>
                                    </div>
                                  ))}
                                  <button
                                    className="w-full flex items-center justify-center gap-1 py-2 text-xs text-brand hover:bg-white transition-colors font-medium"
                                    onClick={() => navigate(`/patient/${group.patientId}?tab=messages`)}
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                    前往留言板
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </ScrollArea>
                </div>
              )}

              {/* 釘選訊息 Panel */}
              {sidebarTab === 'pinned' && (
                messages.filter(m => m.pinned).length > 0 ? (
                  <ScrollArea className="max-h-[500px]">
                    <div className="space-y-3">
                      {messages.filter(m => m.pinned).map((msg) => (
                        <div key={msg.id} className="group p-3 bg-white border border-[#f59e0b] rounded-lg relative">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-[#f59e0b] h-6 w-6 p-0"
                            onClick={() => handleTogglePin(msg.id)}
                            title="取消釘選"
                          >
                            <Pin className="h-3 w-3" />
                          </Button>
                          <div className="font-semibold mb-2 text-foreground">{msg.userName}</div>
                          <p className="text-foreground text-sm leading-relaxed">{msg.content}</p>
                          <p className="text-xs text-muted-foreground mt-2">{formatTimestamp(msg.timestamp)}</p>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    <Pin className="h-12 w-12 mx-auto mb-4 opacity-30" />
                    <p>目前沒有釘選訊息</p>
                  </div>
                )
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 發布公告對話框 */}
      <Dialog open={announcementDialogOpen} onOpenChange={setAnnouncementDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pin className="h-5 w-5 text-[#f59e0b]" />
              發布公告
            </DialogTitle>
            <DialogDescription>
              公告將會顯示在聊天室頂部，並以特殊樣式標示，方便團隊成員查看重要訊息。
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              placeholder="輸入公告內容..."
              value={announcementContent}
              onChange={(e) => setAnnouncementContent(e.target.value)}
              className="min-h-[120px] border border-[#f59e0b] focus:border-[#f59e0b] focus:ring-2 focus:ring-[#f59e0b]/20"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAnnouncementDialogOpen(false);
                setAnnouncementContent('');
              }}
              disabled={postingAnnouncement}
            >
              取消
            </Button>
            <Button
              className="bg-[#f59e0b] hover:bg-[#d97706]"
              onClick={handlePostAnnouncement}
              disabled={!announcementContent.trim() || postingAnnouncement}
            >
              {postingAnnouncement ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2" />
                  發布中...
                </>
              ) : (
                <>
                  <Pin className="mr-2 h-4 w-4" />
                  發布公告
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
