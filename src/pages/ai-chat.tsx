import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertCircle,
  Archive,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Info,
  MessageSquare,
  Plus,
  Send,
  Sparkles,
  Square,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { SnapshotRefreshControl } from '../components/ai-chat/snapshot-refresh-control';
import { patientsApi, type Patient } from '../lib/api';
// FIX-AVATAR (2026-05-03): same ChatICU logo the app sidebar / login /
// patient-detail chat tab uses. Was previously avatarSrc="" which fell
// back to the browser's broken-image rendering ("AI" placeholder icon).
import chatBotAvatar from 'figma:asset/f438047691c382addfed5c99dfc97977dea5c831.png';
import { maskPatientName } from '../lib/utils/patient-name';
import {
  deleteChatSession,
  extractStreamMainContent,
  getChatSession,
  getChatSessions,
  refreshChatSessionSnapshot,
  splitMainAndDetail,
  streamChatMessage,
  updateMessageFeedback,
  type ChatResponse,
  type ChatSession as ApiChatSession,
  type Citation as AiCitation,
  type DataFreshness,
} from '../lib/api/ai';
import type { SessionChatMessage } from '../hooks/use-chat-sessions';
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
import { useTranslation } from 'react-i18next';
import i18n from '../i18n/config';

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

function formatCitationPageText(citation: AiCitation): string {
  const tr = (k: string, opts?: Record<string, unknown>) => i18n.t(k, { ns: 'chat', ...(opts ?? {}) }) as string;
  const pages = Array.isArray(citation.pages)
    ? citation.pages.filter((p): p is number => Number.isFinite(Number(p))).map((p) => Number(p))
    : [];
  if (pages.length > 1) {
    const uniq = Array.from(new Set(pages)).sort((a, b) => a - b);
    return tr('ai.citation.pages', { pages: uniq.join('、') });
  }
  if (typeof citation.page === 'number') return tr('ai.citation.page', { page: citation.page });
  if (pages.length === 1) return tr('ai.citation.page', { page: pages[0] });
  return tr('ai.citation.pageMissing');
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
  // FIX-LOAD-SPLIT (2026-05-03): assistant `content` from the backend is
  // the raw concatenated string with 【說明/補充】 inline. Without this
  // split, the bubble shows main + detail in one block on session reload
  // (the 詳細 collapse button only appears for live-sent messages because
  // the send path was the only one calling splitMainAndDetail). Match
  // patient-detail.tsx's send-time logic so live and reloaded views are
  // identical — backend `explanation` takes precedence if it ever arrives
  // populated (no current path emits it, but contract preserved).
  let mainContent = item.content || '';
  let detailContent: string | null = item.explanation || null;
  if (!detailContent && item.role === 'assistant' && mainContent) {
    const split = splitMainAndDetail(mainContent);
    mainContent = split.main;
    detailContent = split.detail;
  }
  return {
    role: item.role === 'assistant' ? 'assistant' : 'user',
    content: mainContent,
    explanation: detailContent,
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
  const { t } = useTranslation('chat');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // patientId / patientIds URL params
  const urlPatientId = searchParams.get('patientId') ?? undefined;
  const urlPatientIds = useMemo(() => {
    const raw = searchParams.get('patientIds');
    if (!raw) return [] as string[];
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }, [searchParams]);

  const effectivePatientId = urlPatientId ?? (urlPatientIds.length >= 1 ? urlPatientIds[0] : undefined);
  const isMultiPatientRequested = urlPatientIds.length > 1;

  const [contextPatient, setContextPatient] = useState<Patient | null>(null);
  const [contextLoading, setContextLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!effectivePatientId) {
      setContextPatient(null);
      return;
    }
    setContextLoading(true);
    patientsApi
      .getPatient(effectivePatientId)
      .then((p) => {
        if (!cancelled) setContextPatient(p);
      })
      .catch(() => {
        if (!cancelled) setContextPatient(null);
      })
      .finally(() => {
        if (!cancelled) setContextLoading(false);
      });
    return () => { cancelled = true; };
  }, [effectivePatientId]);

  const clearPatientContext = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('patientId');
    next.delete('patientIds');
    navigate({ pathname: '/ai-chat', search: next.toString() ? `?${next}` : '' }, { replace: true });
  }, [navigate, searchParams]);

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
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [feedbackingMessageIndex, setFeedbackingMessageIndex] = useState<number | null>(null);

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // F2: snapshot freshness indicator + manual refresh button.
  // snapshotTakenAt is the ISO-8601 of when the LLM-facing snapshot was
  // last (re)built. Null when the session has no patient context yet
  // (general chat) or when the first turn hasn't fired. The chat header
  // shows the age and highlights the refresh button at >30min so the
  // user knows the LLM may be reasoning off stale vent/lab/score data.
  const [snapshotTakenAt, setSnapshotTakenAt] = useState<string | null>(null);
  const [refreshingSnapshot, setRefreshingSnapshot] = useState(false);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  // W2-T1: AbortController for the in-flight stream so the Send→Stop button
  // can cancel mid-stream without leaving stale state.
  const streamAbortRef = useRef<AbortController | null>(null);
  const stopStream = useCallback(() => {
    streamAbortRef.current?.abort();
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      const data = effectivePatientId
        ? await getChatSessions({ patientId: effectivePatientId })
        : await getChatSessions({ noPatient: true });
      setSessions(data.sessions.map(mapApiSession));
    } catch {
      setSessions([]);
    }
  }, [effectivePatientId]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  // W3-T7: only auto-scroll when the user is already near the bottom.
  // IntersectionObserver tracks whether endRef is in view; when the user
  // scrolls up to read history, new chunks no longer yank them back.
  // The "跳到最新" floating pill now actually serves a purpose instead of
  // fighting the auto-scroll loop.
  const isNearBottomRef = useRef(true);
  useEffect(() => {
    const target = messagesEndRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          isNearBottomRef.current = entry.isIntersecting;
          setShowScrollToBottom(!entry.isIntersecting);
        }
      },
      { root: messagesContainerRef.current, threshold: 0, rootMargin: '0px 0px 200px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isNearBottomRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Scroll handler retained as a safety net for browsers / cases where
  // IntersectionObserver fires late; effectively a no-op when the
  // observer's state is already authoritative.
  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distFromBottom <= 200;
    isNearBottomRef.current = near;
    setShowScrollToBottom(!near);
  }, []);

  const jumpToLatest = useCallback(() => {
    isNearBottomRef.current = true;
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

  // W3-T6: feedback writes through updateMessageFeedback API with optimistic
  // UI. Toggle clears when clicking the same direction (up→null, down→null).
  const setMessageFeedback = useCallback(
    async (msgIndex: number, feedback: 'up' | 'down' | null) => {
      const target = chatMessages[msgIndex];
      if (!target?.messageId || target.role !== 'assistant') return;
      const next = target.feedback === feedback ? null : feedback;
      const prevFeedback = target.feedback ?? null;
      // Optimistic
      setChatMessages((prev) => {
        const arr = [...prev];
        const m = arr[msgIndex];
        if (!m) return prev;
        arr[msgIndex] = { ...m, feedback: next };
        return arr;
      });
      setFeedbackingMessageIndex(msgIndex);
      try {
        await updateMessageFeedback(target.messageId, next);
      } catch {
        toast.error(t('ai.toasts.feedbackError'));
        setChatMessages((prev) => {
          const arr = [...prev];
          const m = arr[msgIndex];
          if (!m) return prev;
          arr[msgIndex] = { ...m, feedback: prevFeedback };
          return arr;
        });
      } finally {
        setFeedbackingMessageIndex(null);
      }
    },
    [chatMessages],
  );

  const openSession = useCallback(async (session: SessionItem) => {
    // W2-T2: don't switch session while a stream is in flight — its onMessage
    // / onComplete callbacks would write into the freshly-loaded session.
    if (isSending) {
      toast.error(t('ai.toasts.stopBeforeSwitch'));
      return;
    }
    setSelectedSessionId(session.id);
    setSnapshotTakenAt(null);
    try {
      const detail = await getChatSession(session.id);
      setChatMessages((detail.messages || []).map(mapApiMessage));
      setSnapshotTakenAt(detail.session?.snapshotTakenAt ?? null);
    } catch {
      setChatMessages([]);
    }
  }, [isSending]);

  const startNewSession = useCallback(() => {
    if (isSending) {
      toast.error(t('ai.toasts.stopBeforeNew'));
      return;
    }
    setSelectedSessionId(undefined);
    setChatMessages([]);
    setChatInput('');
    setSnapshotTakenAt(null);
    chatInputRef.current?.focus();
  }, [isSending]);

  const refreshSnapshot = useCallback(async () => {
    if (!selectedSessionId) return;
    if (isSending) {
      toast.error(t('ai.toasts.stopBeforeRefresh'));
      return;
    }
    setRefreshingSnapshot(true);
    try {
      const result = await refreshChatSessionSnapshot(selectedSessionId);
      setSnapshotTakenAt(result.snapshotTakenAt);
      toast.success(t('ai.toasts.snapshotRefreshSuccess'));
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('ai.toasts.snapshotRefreshError');
      toast.error(msg);
    } finally {
      setRefreshingSnapshot(false);
    }
  }, [isSending, selectedSessionId]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTargetId) return;
    if (isSending) {
      toast.error(t('ai.toasts.stopBeforeDelete'));
      return;
    }
    setDeleting(true);
    try {
      await deleteChatSession(deleteTargetId);
      if (selectedSessionId === deleteTargetId) {
        setSelectedSessionId(undefined);
        setChatMessages([]);
      }
      await refreshSessions();
      toast.success(t('ai.toasts.deleteSuccess'));
    } catch {
      toast.error(t('ai.toasts.deleteError'));
    } finally {
      setDeleting(false);
      setDeleteTargetId(null);
    }
  }, [deleteTargetId, isSending, refreshSessions, selectedSessionId]);

  const sendMessage = useCallback(async () => {
    if (!chatInput.trim() || isSending) return;
    const userMessage = chatInput.trim();
    const nowTime = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    const messagesWithUser: SessionChatMessage[] = [
      ...chatMessages,
      { role: 'user', content: userMessage, timestamp: nowTime },
    ];
    setChatMessages(messagesWithUser);
    setChatInput('');
    setIsSending(true);

    // W2-T1: arm a new AbortController per send so Stop can cancel it.
    const abortController = new AbortController();
    streamAbortRef.current = abortController;
    let aborted = false;

    try {
      setChatMessages([...messagesWithUser, { role: 'assistant', content: '' }]);
      setThinkingStatus(t('ai.toasts.thinking'));

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
          patientId: effectivePatientId,
          signal: abortController.signal,
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
          onAbort: () => {
            // User pressed Stop. Mark the placeholder so they see what they got.
            aborted = true;
            if (rafId !== null) cancelAnimationFrame(rafId);
            const mainContent = extractStreamMainContent(rawBuffer);
            const annotated = mainContent
              ? `${mainContent}\n\n（已中止）`
              : '（已中止，未產生內容）';
            setChatMessages((prev) => {
              if (prev.length === 0) return prev;
              const next = [...prev];
              const lastIndex = next.length - 1;
              const last = next[lastIndex];
              if (last?.role !== 'assistant') return prev;
              next[lastIndex] = { ...last, content: annotated };
              return next;
            });
            setThinkingStatus(null);
            reject(new Error('__aborted__'));
          },
          onError: (error) => {
            if (rafId !== null) cancelAnimationFrame(rafId);
            setThinkingStatus(null);
            reject(error);
          },
        });
      });

      // FIX-LOAD-SPLIT: same split as mapApiMessage. Backend currently
      // doesn't pre-split, so we must split client-side to populate the
      // 詳細 collapse panel. Live + reload paths must converge on the
      // same shape — otherwise the user sees inline 【說明/補充】 in the
      // bubble on the second render (e.g. after sidebar refresh).
      const rawContent = response.message.content || '';
      let mainContent = rawContent;
      let detailContent: string | null = response.message.explanation || null;
      if (!detailContent && rawContent) {
        const split = splitMainAndDetail(rawContent);
        mainContent = split.main;
        detailContent = split.detail;
      }
      const assistantMsg: SessionChatMessage = {
        role: 'assistant',
        content: mainContent,
        messageId: response.message.id,
        explanation: detailContent,
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
        // F3: deep-link refs (currently pharmacy advice). Live-only — gone
        // after page reload, but valuable in the moment for "回看那一床建議"
        // workflows. ChatMessageThread renders chips beneath the bubble.
        adviceRefs: response.prefetchRefs?.adviceRefs ?? [],
      };

      setChatMessages([...messagesWithUser, assistantMsg]);

      // W3-T8: backend now sets the title on first turn from body.message[:50],
      // so we just adopt the new sessionId and refresh the sidebar list.
      if (!selectedSessionId) {
        setSelectedSessionId(response.sessionId);
      }
      // F2: first turn just built the snapshot — show the freshness pill
      // immediately so the user can see the "0 minutes ago" baseline. The
      // exact timestamp differs from server-side by a few ms, which doesn't
      // matter for the "N 分鐘前" display.
      if (effectivePatientId && !snapshotTakenAt) {
        setSnapshotTakenAt(new Date().toISOString());
      }
      await refreshSessions();
    } catch (err) {
      // W2-T1: aborts are handled by onAbort which already updated the bubble
      // and set a sentinel error. Don't overwrite with a generic error message.
      if (aborted || (err instanceof Error && err.message === '__aborted__')) {
        // Sessions list won't have new entries anyway; skip refresh.
      } else {
        const errorMessage = err instanceof Error && err.message
          ? `AI 回覆失敗：${err.message}`
          : 'AI 助手目前無法回應，請稍後再試。';
        setChatMessages([...messagesWithUser, { role: 'assistant', content: errorMessage }]);
      }
    } finally {
      streamAbortRef.current = null;
      setIsSending(false);
      setThinkingStatus(null);
    }
  }, [chatInput, chatMessages, effectivePatientId, isSending, refreshSessions, selectedSessionId, snapshotTakenAt]);

  const now = new Date();
  const todayDateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  return (
    <div className="p-4 md:p-6 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-brand" />
        <h1 className="text-xl font-semibold text-foreground">{t('ai.header.title')}</h1>
        {effectivePatientId && (
          <Badge variant="outline" className="ml-2 text-xs">{t('ai.header.patientLoadedBadge')}</Badge>
        )}
      </div>

      {/* 病人病歷 context banner */}
      {effectivePatientId && (
        <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-900/40 dark:bg-sky-900/20 dark:text-sky-200">
          <User className="h-4 w-4 shrink-0 mt-0.5 text-sky-600" />
          <div className="flex-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {contextLoading ? (
              <span>{t('ai.header.loadingPatient')}</span>
            ) : contextPatient ? (
              <>
                <span className="font-medium">
                  正在詢問：{contextPatient.bedNumber ? `${contextPatient.bedNumber} · ` : ''}
                  {maskPatientName(contextPatient.name)}
                </span>
                {contextPatient.archived && (
                  <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700">
                    <Archive className="h-3 w-3 mr-1" />
                    已出院{contextPatient.dischargeDate ? ` · ${contextPatient.dischargeDate}` : ''}
                  </Badge>
                )}
                {contextPatient.diagnosis && (
                  <span className="text-muted-foreground truncate max-w-md">{contextPatient.diagnosis}</span>
                )}
              </>
            ) : (
              <span>找不到病人資料（ID: {effectivePatientId}）</span>
            )}
          </div>
          <button
            type="button"
            onClick={clearPatientContext}
            className="shrink-0 text-sky-700 hover:text-sky-900 underline text-xs"
            title={t('ai.header.removePatientContext')}
          >
            移除
          </button>
        </div>
      )}

      {/* 多病人問答尚未支援的提示 */}
      {isMultiPatientRequested && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-700" />
          <span className="flex-1">
            您選取了 {urlPatientIds.length} 位病人，但多病人同時問答功能開發中。目前僅載入第一位病人作為背景。
          </span>
        </div>
      )}

      {!disclaimerCollapsed && !effectivePatientId && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
          <Info className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
          <span className="flex-1">
            此為通用醫療問答助手，無病歷背景；請勿輸入可識別個資（姓名／病歷號）。
          </span>
          <button
            type="button"
            onClick={() => setDisclaimerCollapsed(true)}
            className="shrink-0 text-amber-700 hover:text-amber-900"
            title={t('ai.header.collapseHint')}
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
                      title={t('ai.session.collapseList')}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 px-2.5 text-xs bg-gray-700 hover:bg-gray-700 text-white"
                      onClick={startNewSession}
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      <span>{t('ai.session.newSession')}</span>
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea style={{ height: 'calc(100vh - 260px)', minHeight: '400px' }}>
                  {sessions.length === 0 ? (
                    <div className="p-8 flex flex-col items-center gap-2 text-center text-muted-foreground">
                      <MessageSquare className="h-10 w-10 opacity-30 text-[#9ca3af]" />
                      <p className="text-sm font-medium text-muted-foreground">{t('ai.session.noSessions')}</p>
                      <p className="text-xs text-[#9ca3af] leading-relaxed">{t('ai.session.newSessionHintTop')}<br />{t('ai.session.newSessionHintBottom')}</p>
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
                                title={t('ai.session.deleteTitle')}
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
                    title={t('ai.session.showList')}
                  >
                    <ChevronRight className="mr-1 h-3.5 w-3.5" />
                    對話記錄
                  </Button>
                )}
                {effectivePatientId ? (
                  // F-UI1 (2026-05-03 prod feedback): when a patient is bound
                  // to this chat the panel header used to still say
                  // "通用問答模式" / "無病歷背景 · 勿輸入個資", which contradicts
                  // the patient-context badge above the panel and confuses
                  // pharmacists. Switch the badge to a 病歷模式 indicator.
                  <div className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
                    <Info className="h-3.5 w-3.5" />
                    <span>{t('ai.mode.patient')}</span>
                  </div>
                ) : disclaimerCollapsed ? (
                  <button
                    onClick={() => setDisclaimerCollapsed(false)}
                    className="flex items-center gap-1 text-xs text-[#9CA3AF] hover:text-[#6B7280] transition-colors"
                  >
                    <Info className="h-3.5 w-3.5" />
                    <span>{t('ai.mode.noContext')}</span>
                    <ChevronDown className="h-2.5 w-2.5" />
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ChevronUp className="h-3 w-3 text-[#9CA3AF]" />
                    <span>{t('ai.mode.general')}</span>
                  </div>
                )}
                <div className="flex-1" />
                <SnapshotRefreshControl
                  visible={Boolean(selectedSessionId && effectivePatientId && snapshotTakenAt)}
                  takenAt={snapshotTakenAt}
                  refreshing={refreshingSnapshot}
                  onRefresh={() => void refreshSnapshot()}
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="flex flex-col" style={{ height: 'max(calc(100vh - 280px), 480px)' }}>
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
                  onToggleExplanation={toggleExplanation}
                  onToggleReferences={toggleReferences}
                  formatCitationPageText={formatCitationPageText}
                  compactSnippet={compactSnippet}
                  avatarSrc={chatBotAvatar}
                  onSetMessageFeedback={setMessageFeedback}
                  feedbackingMessageIndex={feedbackingMessageIndex}
                />

                <div className="flex-none px-4 pb-1.5 pt-0 border-t border-border bg-white dark:bg-slate-900">
                  <div className="flex gap-2 pt-1.5 items-end">
                    <Textarea
                      ref={chatInputRef}
                      placeholder={t('ai.input.placeholder')}
                      value={chatInput}
                      onChange={(event) => setChatInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          void sendMessage();
                        }
                      }}
                      className="min-h-[120px] border border-border text-sm transition-colors rounded-xl"
                    />
                    {isSending ? (
                      <Button
                        onClick={stopStream}
                        size="icon"
                        className="h-[120px] w-[36px] shrink-0 transition-colors rounded-xl bg-red-600 hover:bg-red-700"
                        title={t('ai.input.stopGeneration')}
                      >
                        <Square className="h-4.5 w-4.5 fill-white text-white" />
                      </Button>
                    ) : (
                      <Button
                        onClick={() => void sendMessage()}
                        size="icon"
                        className="h-[120px] w-[36px] shrink-0 transition-colors rounded-xl bg-gray-700 hover:bg-gray-700"
                        disabled={!chatInput.trim()}
                      >
                        <Send className="h-4.5 w-4.5" />
                      </Button>
                    )}
                  </div>
                  <p className="text-[9px] text-[#d0d0d0] mt-1">{t('ai.input.shortcutHint')}</p>
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
            <AlertDialogTitle>{t('ai.deleteDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('ai.deleteDialog.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('ai.deleteDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              <span>{deleting ? t('ai.deleteDialog.submitting') : t('ai.deleteDialog.submit')}</span>
              {deleting ? <ButtonLoadingIndicator /> : null}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
