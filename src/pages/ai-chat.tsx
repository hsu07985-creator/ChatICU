import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Info,
  MessageSquare,
  Plus,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  deleteChatSession,
  extractStreamMainContent,
  getChatSession,
  getChatSessions,
  streamChatMessage,
  updateChatSessionTitle,
  type ChatResponse,
  type ChatSession as ApiChatSession,
  type Citation as AiCitation,
  type DataFreshness,
} from '../lib/api/ai';
import type { SessionChatMessage } from '../hooks/use-chat-sessions';
import { useAiReadiness } from '../hooks/use-ai-readiness';
import { getReadinessReason } from '../lib/api/ai';
import { ChatMessageThread } from '../components/patient/chat-message-thread';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { ButtonLoadingIndicator } from '../components/ui/button-loading-indicator';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { ScrollArea } from '../components/ui/scroll-area';
import { Textarea } from '../components/ui/textarea';

interface SessionItem {
  id: string;
  title: string;
  sessionDate: string;
  sessionTime: string;
  lastUpdated: string;
  messageCount?: number;
}

function toLocalDateKey(value: string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function mapApiSession(item: ApiChatSession): SessionItem {
  const created = new Date(item.createdAt);
  return {
    id: item.id,
    title: item.title,
    sessionDate: toLocalDateKey(created),
    sessionTime: created.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
    lastUpdated: new Date(item.updatedAt).toLocaleString('zh-TW'),
    messageCount: item.messageCount,
  };
}

function formatAiDegradedReason(reason?: string | null, upstreamStatus?: string | null): string {
  if (reason === 'insufficient_evidence') return '目前可用證據有限';
  if (reason === 'llm_unavailable') return 'LLM 服務不可用';
  return reason || upstreamStatus || 'unknown';
}

function getDisplayFreshnessHints(dataFreshness?: DataFreshness | null): string[] {
  if (!dataFreshness) return [];
  const hints: string[] = [];
  const seen = new Set<string>();
  for (const raw of dataFreshness.hints || []) {
    const hint = String(raw || '').trim();
    if (!hint || seen.has(hint)) continue;
    if (hint.includes('JSON 離線模式') || hint.includes('資料快照時間')) continue;
    seen.add(hint);
    hints.push(hint);
  }
  return hints;
}

function formatCitationPageText(citation: AiCitation): string {
  const pages = Array.isArray(citation.pages)
    ? citation.pages.filter((p): p is number => Number.isFinite(Number(p))).map((p) => Number(p))
    : [];
  if (pages.length > 1) {
    const uniq = Array.from(new Set(pages)).sort((a, b) => a - b);
    return `第 ${uniq.join('、')} 頁`;
  }
  if (typeof citation.page === 'number') return `第 ${citation.page} 頁`;
  if (pages.length === 1) return `第 ${pages[0]} 頁`;
  return '頁碼待補';
}

function compactSnippet(snippet?: string): string {
  return String(snippet || '').trim();
}

function mapApiMessage(item: {
  role: string;
  content: string;
  explanation?: string | null;
  timestamp?: string | null;
  citations?: AiCitation[];
  safetyWarnings?: string[] | null;
  requiresExpertReview?: boolean;
  degraded?: boolean;
  degradedReason?: string | null;
  upstreamStatus?: string | null;
  dataFreshness?: DataFreshness | null;
  graphMeta?: import('../lib/api/ai').GraphMeta | null;
}): SessionChatMessage {
  let timestamp: string | undefined;
  if (item.timestamp) {
    try {
      timestamp = new Date(item.timestamp).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    } catch {
      timestamp = undefined;
    }
  }
  return {
    role: item.role === 'assistant' ? 'assistant' : 'user',
    content: item.content,
    explanation: item.explanation || null,
    timestamp,
    references: item.citations || [],
    warnings: item.safetyWarnings || null,
    requiresExpertReview: item.requiresExpertReview || false,
    degraded: item.degraded || false,
    degradedReason: item.degradedReason || null,
    upstreamStatus: item.upstreamStatus || null,
    dataFreshness: item.dataFreshness || null,
    graphMeta: item.graphMeta || null,
  };
}

export function AiChatPage() {
  const { aiReadiness } = useAiReadiness();
  const canSendAiChat = aiReadiness ? aiReadiness.feature_gates.chat : true;
  const aiChatGateReason = getReadinessReason(aiReadiness, 'chat');

  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>(undefined);
  const [chatMessages, setChatMessages] = useState<SessionChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [thinkingStatus, setThinkingStatus] = useState<string | null>(null);
  const [showSessionList, setShowSessionList] = useState(true);
  const [disclaimerCollapsed, setDisclaimerCollapsed] = useState(false);

  const [expandedExplanations, setExpandedExplanations] = useState<Set<number>>(new Set());
  const [expandedReferences, setExpandedReferences] = useState<Set<number>>(new Set());
  const [expandedDataQuality, setExpandedDataQuality] = useState<Set<number>>(new Set());
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  const refreshSessions = useCallback(async () => {
    try {
      const data = await getChatSessions({ noPatient: true });
      setSessions(data.sessions.map(mapApiSession));
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollToBottom(distFromBottom > 200);
  }, []);

  const jumpToLatest = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const toggleExplanation = useCallback((index: number) => {
    setExpandedExplanations((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const toggleReferences = useCallback((index: number) => {
    setExpandedReferences((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const toggleDataQuality = useCallback((index: number) => {
    setExpandedDataQuality((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const openSession = useCallback(async (session: SessionItem) => {
    setSelectedSessionId(session.id);
    try {
      const detail = await getChatSession(session.id);
      setChatMessages((detail.messages || []).map(mapApiMessage));
    } catch {
      setChatMessages([]);
    }
  }, []);

  const startNewSession = useCallback(() => {
    setSelectedSessionId(undefined);
    setChatMessages([]);
    setChatInput('');
    chatInputRef.current?.focus();
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteTargetId) return;
    setDeleting(true);
    try {
      await deleteChatSession(deleteTargetId);
      if (selectedSessionId === deleteTargetId) {
        setSelectedSessionId(undefined);
        setChatMessages([]);
      }
      await refreshSessions();
      toast.success('對話記錄已刪除');
    } catch {
      toast.error('刪除對話記錄失敗');
    } finally {
      setDeleting(false);
      setDeleteTargetId(null);
    }
  }, [deleteTargetId, refreshSessions, selectedSessionId]);

  const sendMessage = useCallback(async () => {
    if (!chatInput.trim() || isSending) return;
    if (!canSendAiChat) {
      toast.error(aiChatGateReason);
      return;
    }
    const userMessage = chatInput.trim();
    const nowTime = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    const messagesWithUser: SessionChatMessage[] = [
      ...chatMessages,
      { role: 'user', content: userMessage, timestamp: nowTime },
    ];
    setChatMessages(messagesWithUser);
    setChatInput('');
    setIsSending(true);

    try {
      setChatMessages([...messagesWithUser, { role: 'assistant', content: '' }]);
      setThinkingStatus('正在準備回覆…');

      const response = await new Promise<ChatResponse>((resolve, reject) => {
        let rawBuffer = '';
        let rafId: number | null = null;
        const flush = () => {
          rafId = null;
          const mainContent = extractStreamMainContent(rawBuffer);
          setChatMessages((prev) => {
            if (prev.length === 0) return prev;
            const next = [...prev];
            const lastIndex = next.length - 1;
            const last = next[lastIndex];
            if (last?.role !== 'assistant') return prev;
            next[lastIndex] = { ...last, content: mainContent };
            return next;
          });
        };
        streamChatMessage({
          message: userMessage,
          sessionId: selectedSessionId,
          onThinking: (detail) => setThinkingStatus(detail),
          onMessage: (chunk) => {
            if (!chunk) return;
            rawBuffer += chunk;
            if (rafId === null) rafId = requestAnimationFrame(flush);
          },
          onComplete: (streamResult) => {
            if (rafId !== null) {
              cancelAnimationFrame(rafId);
              rafId = null;
            }
            const mainContent = extractStreamMainContent(rawBuffer);
            setChatMessages((prev) => {
              if (prev.length === 0) return prev;
              const next = [...prev];
              const lastIndex = next.length - 1;
              const last = next[lastIndex];
              if (last?.role !== 'assistant') return prev;
              next[lastIndex] = { ...last, content: mainContent };
              return next;
            });
            setThinkingStatus(null);
            resolve(streamResult);
          },
          onError: (error) => {
            if (rafId !== null) cancelAnimationFrame(rafId);
            setThinkingStatus(null);
            reject(error);
          },
        });
      });

      const assistantMsg: SessionChatMessage = {
        role: 'assistant',
        content: response.message.content,
        messageId: response.message.id,
        explanation: response.message.explanation || null,
        references: response.message.citations || [],
        warnings: response.message.safetyWarnings || null,
        requiresExpertReview: response.message.requiresExpertReview || false,
        degraded: response.message.degraded || false,
        degradedReason: response.message.degradedReason || null,
        upstreamStatus: response.message.upstreamStatus || null,
        dataFreshness: response.message.dataFreshness || null,
        graphMeta: response.message.graphMeta || null,
        feedback: null,
        timestamp: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
      };

      setChatMessages([...messagesWithUser, assistantMsg]);

      if (!selectedSessionId) {
        const fallbackTitle = userMessage.slice(0, 50);
        try {
          await updateChatSessionTitle(response.sessionId, fallbackTitle);
        } catch {
          // Non-blocking
        }
        setSelectedSessionId(response.sessionId);
        await refreshSessions();
      } else {
        await refreshSessions();
      }
    } catch (err) {
      const errorMessage = err instanceof Error && err.message
        ? `AI 回覆失敗：${err.message}`
        : 'AI 助手目前無法回應，請稍後再試。';
      setChatMessages([...messagesWithUser, { role: 'assistant', content: errorMessage }]);
    } finally {
      setIsSending(false);
      setThinkingStatus(null);
    }
  }, [aiChatGateReason, canSendAiChat, chatInput, chatMessages, isSending, refreshSessions, selectedSessionId]);

  const now = new Date();
  const todayDateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const noop = useMemo(() => () => {}, []);

  return (
    <div className="p-4 md:p-6 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-brand" />
        <h1 className="text-xl font-semibold text-foreground">AI 問答</h1>
      </div>

      {!disclaimerCollapsed && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
          <Info className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
          <span className="flex-1">
            此為通用醫療問答助手，無病歷背景；請勿輸入可識別個資（姓名／病歷號）。
          </span>
          <button
            type="button"
            onClick={() => setDisclaimerCollapsed(true)}
            className="shrink-0 text-amber-700 hover:text-amber-900"
            title="收合提示"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex gap-3">
        {showSessionList && (
          <div className="w-[320px] shrink-0">
            <Card className="border">
              <CardHeader className="border-b bg-slate-50 dark:bg-slate-800 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-[#374151] dark:text-slate-300">
                    <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                    對話記錄
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-[#374151] dark:hover:text-slate-200"
                      onClick={() => setShowSessionList(false)}
                      title="收合對話記錄"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 px-2.5 text-xs bg-gray-700 hover:bg-gray-700 text-white"
                      onClick={startNewSession}
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      <span>新對話</span>
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea style={{ height: 'calc(100vh - 260px)', minHeight: '400px' }}>
                  {sessions.length === 0 ? (
                    <div className="p-8 flex flex-col items-center gap-2 text-center text-muted-foreground">
                      <MessageSquare className="h-10 w-10 opacity-30 text-[#9ca3af]" />
                      <p className="text-sm font-medium text-muted-foreground">尚無對話記錄</p>
                      <p className="text-xs text-[#9ca3af] leading-relaxed">點擊「新對話」開始<br />向 AI 詢問通用醫療問題</p>
                    </div>
                  ) : (
                    <div className="space-y-2 p-2.5">
                      {sessions.map((session) => (
                        <div
                          role="button"
                          tabIndex={0}
                          key={session.id}
                          onClick={() => void openSession(session)}
                          className={`group w-full rounded-xl border px-3 py-2.5 text-left transition-all hover:bg-slate-50 dark:hover:bg-slate-800 ${
                            selectedSessionId === session.id
                              ? 'border-[#d7dce5] dark:border-slate-600 bg-slate-50 dark:bg-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.05)]'
                              : 'border-[#edf0f4] dark:border-slate-700 bg-white dark:bg-slate-900'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="break-words pr-1 text-sm font-semibold leading-5 text-foreground">
                                {session.title}
                              </p>
                              <p className="mt-1 text-xs leading-4 text-[#9ca3af]">
                                {session.sessionDate === todayDateKey
                                  ? session.sessionTime
                                  : `${session.sessionDate} ${session.sessionTime}`}
                              </p>
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1.5">
                              <Badge className="h-5 min-w-[1.5rem] justify-center border border-border bg-gray-100 dark:bg-slate-800 px-1.5 text-xs text-[#374151] dark:text-slate-300">
                                {session.messageCount ?? 0}
                              </Badge>
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setDeleteTargetId(session.id);
                                }}
                                className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-red-100 hover:text-red-600 group-hover:opacity-100"
                                title="刪除對話"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        )}

        <div className="min-w-0 flex-1">
          <Card className="border">
            <CardHeader className="bg-slate-50 dark:bg-slate-800 border-b py-1 px-3" style={{ paddingBottom: '4px' }}>
              <div className="flex items-center gap-1.5">
                {!showSessionList && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-[#374151] dark:hover:text-slate-200"
                    onClick={() => setShowSessionList(true)}
                    title="顯示對話記錄"
                  >
                    <ChevronRight className="mr-1 h-3.5 w-3.5" />
                    對話記錄
                  </Button>
                )}
                {disclaimerCollapsed ? (
                  <button
                    onClick={() => setDisclaimerCollapsed(false)}
                    className="flex items-center gap-1 text-xs text-[#9CA3AF] hover:text-[#6B7280] transition-colors"
                  >
                    <Info className="h-3.5 w-3.5" />
                    <span>無病歷背景 · 勿輸入個資</span>
                    <ChevronDown className="h-2.5 w-2.5" />
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ChevronUp className="h-3 w-3 text-[#9CA3AF]" />
                    <span>通用問答模式</span>
                  </div>
                )}
                <div className="flex-1" />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="flex flex-col" style={{ height: 'max(calc(100vh - 280px), 480px)' }}>
                {!canSendAiChat && (
                  <div className="flex-none mx-4 mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 flex items-start gap-2">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">AI 對話功能暫時無法使用</p>
                      <p className="text-amber-700 mt-0.5">{aiChatGateReason || '請聯繫系統管理員或稍後重試。'}</p>
                    </div>
                  </div>
                )}

                <ChatMessageThread
                  chatMessages={chatMessages}
                  isSending={isSending}
                  thinkingStatus={thinkingStatus}
                  containerRef={messagesContainerRef}
                  endRef={messagesEndRef}
                  onScroll={handleMessagesScroll}
                  showScrollToBottom={showScrollToBottom}
                  onJumpToLatest={jumpToLatest}
                  expandedExplanations={expandedExplanations}
                  expandedReferences={expandedReferences}
                  expandedDataQuality={expandedDataQuality}
                  onToggleExplanation={toggleExplanation}
                  onToggleReferences={toggleReferences}
                  onToggleDataQuality={toggleDataQuality}
                  getDisplayFreshnessHints={getDisplayFreshnessHints}
                  formatAiDegradedReason={formatAiDegradedReason}
                  formatCitationPageText={formatCitationPageText}
                  compactSnippet={compactSnippet}
                  avatarSrc=""
                  onSetMessageFeedback={noop}
                  onRegenerateMessage={noop}
                />

                <div className="flex-none px-4 pb-1.5 pt-0 border-t border-border bg-white dark:bg-slate-900">
                  <div className="flex gap-2 pt-1.5 items-end">
                    <Textarea
                      ref={chatInputRef}
                      placeholder={canSendAiChat ? '例如：SGLT2 抑制劑在心衰竭患者的應用建議？' : 'AI 功能未就緒'}
                      value={chatInput}
                      onChange={(event) => setChatInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          void sendMessage();
                        }
                      }}
                      className={`min-h-[120px] border text-sm transition-colors rounded-xl ${
                        canSendAiChat
                          ? 'border-border'
                          : 'border-border bg-slate-50 dark:bg-slate-800 text-[#9ca3af] cursor-not-allowed'
                      }`}
                      disabled={!canSendAiChat}
                    />
                    <Button
                      onClick={() => void sendMessage()}
                      size="icon"
                      className={`h-[120px] w-[36px] shrink-0 transition-colors rounded-xl ${
                        canSendAiChat ? 'bg-gray-700 hover:bg-gray-700' : 'bg-[#d1d5db] cursor-not-allowed'
                      }`}
                      disabled={isSending || !chatInput.trim() || !canSendAiChat}
                    >
                      <Send className={`h-4.5 w-4.5 ${isSending ? 'opacity-40' : ''}`} />
                    </Button>
                  </div>
                  <p className="text-[9px] text-[#d0d0d0] mt-1">Enter 發送 · Shift+Enter 換行</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog
        open={deleteTargetId !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTargetId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>刪除對話記錄</AlertDialogTitle>
            <AlertDialogDescription>此操作無法復原，確定要刪除？</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              <span>{deleting ? '處理中' : '確認刪除'}</span>
              {deleting ? <ButtonLoadingIndicator /> : null}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
