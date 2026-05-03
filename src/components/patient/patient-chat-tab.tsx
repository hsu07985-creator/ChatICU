// Patient chat tab — extracted from patient-detail.tsx (Phase 3.2 refactor)
// Pure presentational component: all chat state, handlers, and lazy-loading
// effects remain owned by `PatientDetailPage` and are passed in as props.
import type { RefObject } from 'react';
import {
  AlertCircle,
  ArrowDown,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  History,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AdviceRef, Citation as AiCitation, DataFreshness } from '../../lib/api/ai';
import { SnapshotRefreshControl } from '../ai-chat/snapshot-refresh-control';
import { AdviceRefChips } from '../ai-chat/advice-ref-chips';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ButtonLoadingIndicator } from '../ui/button-loading-indicator';
import { Card, CardContent, CardHeader } from '../ui/card';
import { ScrollArea } from '../ui/scroll-area';
import { TabsContent } from '../ui/tabs';
import { Textarea } from '../ui/textarea';
import { AiMarkdown, SafetyWarnings } from '../ui/ai-markdown';
import { LoadingSpinner } from '../ui/state-display';
import { copyToClipboard } from '../../lib/clipboard-utils';

// Local mirrors of the parent's `ChatSession` / `ChatMessage` shapes. Kept as
// generic structural interfaces so the parent can keep its own types without
// forcing a shared `types.ts` move (out of scope for 3.2).
export interface PatientChatTabSession {
  id: string;
  patientId: string;
  sessionDate: string;
  sessionTime: string;
  title: string;
  messages: PatientChatTabMessage[];
  lastUpdated: string;
  messageCount?: number;
  labDataSnapshot?: {
    K?: number;
    Na?: number;
    Scr?: number;
    eGFR?: number;
    CRP?: number;
    WBC?: number;
  };
}

export interface PatientChatTabMessage {
  role: 'user' | 'assistant';
  content: string;
  messageId?: string;
  explanation?: string | null;
  timestamp?: string;
  references?: AiCitation[];
  warnings?: string[] | null;
  requiresExpertReview?: boolean;
  degraded?: boolean;
  degradedReason?: string | null;
  upstreamStatus?: string | null;
  dataFreshness?: DataFreshness | null;
  feedback?: 'up' | 'down' | null;
  /** F-PARITY (2026-05-03): live-only deep-link refs from this turn's
   *  prefetch (currently pharmacy advice). Empty when reload reads from DB
   *  or when no advice prefetch fired. */
  adviceRefs?: AdviceRef[];
}

interface PatientChatTabProps {
  // Session list state (owned by parent — lazy loaded on tab activation)
  chatSessions: PatientChatTabSession[];
  chatSessionsLoading: boolean;
  selectedSession: PatientChatTabSession | null;
  showSessionList: boolean;
  onToggleSessionList: () => void;

  // Session-list management
  isSelectMode: boolean;
  onToggleSelectMode: () => void;
  selectedSessionIds: string[];
  onToggleSessionSelection: (sessionId: string) => void;
  onSelectAllSessions: () => void;
  onBatchDelete: () => void | Promise<void>;
  isDeletingSessions: boolean;
  isStartingSession: boolean;
  onStartNewSession: () => void | Promise<void>;
  onOpenSession: (session: PatientChatTabSession) => void | Promise<void>;
  onDeleteSession: (event: React.MouseEvent, sessionId: string) => void | Promise<void>;
  deletingSessionId: string | null;

  // Chat thread state
  chatMessages: PatientChatTabMessage[];
  isSending: boolean;
  feedbackingMessageIndex: number | null;
  regeneratingMessageIndex: number | null;
  expandedExplanations: number[];
  expandedReferences: number[];
  expandedDataQuality: number[];
  onSetExpandedExplanations: React.Dispatch<React.SetStateAction<number[]>>;
  onSetExpandedReferences: React.Dispatch<React.SetStateAction<number[]>>;
  onSetExpandedDataQuality: React.Dispatch<React.SetStateAction<number[]>>;

  // Scroll
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  showScrollToBottom: boolean;
  onMessagesScroll: () => void;
  onJumpToLatest: () => void;

  // Input
  chatInput: string;
  onChatInputChange: (value: string) => void;
  chatInputRef: RefObject<HTMLTextAreaElement | null>;
  onSendMessage: () => void | Promise<void>;
  canSendAiChat: boolean;

  // Feedback / regenerate
  onSetMessageFeedback: (msgIndex: number, feedback: 'up' | 'down' | null) => void | Promise<void>;
  onRegenerateMessage: (msgIndex: number) => void | Promise<void>;

  // Formatting helpers (shared utilities live in parent module)
  formatSnapshotValue: (value: number | undefined) => string;
  formatCitationPageText: (citation: AiCitation) => string;
  formatAiDegradedReason: (reason?: string | null, upstreamStatus?: string | null) => string;
  getDisplayFreshnessHints: (dataFreshness?: DataFreshness | null) => string[];
  compactSnippet: (snippet?: string) => string;

  chatBotAvatar: string;

  // F-PARITY (2026-05-03): F2 snapshot freshness pill — same backend
  // endpoint as the sidebar /ai-chat version uses. Visible when a
  // patient-bound session is selected and snapshotTakenAt is known.
  snapshotTakenAt?: string | null;
  refreshingSnapshot?: boolean;
  onRefreshSnapshot?: () => void;
}

export function PatientChatTab({
  chatSessions,
  chatSessionsLoading,
  selectedSession,
  showSessionList,
  onToggleSessionList,
  isSelectMode,
  onToggleSelectMode,
  selectedSessionIds,
  onToggleSessionSelection,
  onSelectAllSessions,
  onBatchDelete,
  isDeletingSessions,
  isStartingSession,
  onStartNewSession,
  onOpenSession,
  onDeleteSession,
  deletingSessionId,
  chatMessages,
  isSending,
  feedbackingMessageIndex,
  regeneratingMessageIndex,
  expandedExplanations,
  expandedReferences,
  expandedDataQuality,
  onSetExpandedExplanations,
  onSetExpandedReferences,
  onSetExpandedDataQuality,
  messagesContainerRef,
  messagesEndRef,
  showScrollToBottom,
  onMessagesScroll,
  onJumpToLatest,
  chatInput,
  onChatInputChange,
  chatInputRef,
  onSendMessage,
  canSendAiChat,
  onSetMessageFeedback,
  onRegenerateMessage,
  formatSnapshotValue,
  formatCitationPageText,
  formatAiDegradedReason,
  getDisplayFreshnessHints,
  compactSnippet,
  chatBotAvatar,
  snapshotTakenAt = null,
  refreshingSnapshot = false,
  onRefreshSnapshot,
}: PatientChatTabProps) {
  return (
    <TabsContent value="chat" className="space-y-2">
      <div className="grid grid-cols-12 gap-2">
        {/* 左側對話記錄列表 */}
        {showSessionList && (
          <div className="col-span-3">
            <Card className="border">
              <CardHeader className="bg-slate-50 dark:bg-slate-800 border-b py-1.5 px-3" style={{ paddingBottom: '6px' }}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-xs font-semibold text-[#374151]">
                    <History className="h-3.5 w-3.5 text-muted-foreground" />
                    對話記錄
                  </span>
                  <div className="flex items-center gap-1">
                    {chatSessions.length > 0 && (
                      <Button
                        size="sm"
                        variant={isSelectMode ? "outline" : "ghost"}
                        className="h-6 px-2 text-xs"
                        onClick={onToggleSelectMode}
                      >
                        {isSelectMode ? '完成' : '管理'}
                      </Button>
                    )}
                    {!isSelectMode && (
                      <Button
                        size="sm"
                        className="h-6 px-2 text-xs bg-gray-700 hover:bg-gray-700 dark:bg-gray-600 dark:hover:bg-gray-500 text-white"
                        onClick={() => void onStartNewSession()}
                        disabled={isStartingSession}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        <span>{isStartingSession ? '處理中' : '新對話'}</span>
                        {isStartingSession ? <ButtonLoadingIndicator compact /> : null}
                      </Button>
                    )}
                  </div>
                </div>
                {isSelectMode && (
                  <div className="flex items-center justify-between mt-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs"
                      onClick={onSelectAllSessions}
                    >
                      {selectedSessionIds.length === chatSessions.length ? '取消全選' : '全選'}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-6 px-2 text-xs"
                      disabled={isDeletingSessions || selectedSessionIds.length === 0}
                      onClick={() => void onBatchDelete()}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      <span>{isDeletingSessions ? '處理中' : `刪除 (${selectedSessionIds.length})`}</span>
                      {isDeletingSessions ? <ButtonLoadingIndicator compact /> : null}
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea style={{ height: 'calc(100vh - 220px)', minHeight: '400px' }}>
                  {chatSessionsLoading ? (
                    <div className="p-8 flex flex-col items-center gap-2 text-center text-muted-foreground">
                      <LoadingSpinner size="sm" text="載入對話記錄中..." />
                    </div>
                  ) : chatSessions.length === 0 ? (
                    <div className="p-8 flex flex-col items-center gap-2 text-center text-muted-foreground">
                      <MessageSquare className="h-10 w-10 opacity-30 text-[#9ca3af]" />
                      <p className="text-sm font-medium text-muted-foreground">尚無對話記錄</p>
                      <p className="text-xs text-[#9ca3af] leading-relaxed">點擊「新對話」開始<br/>向 AI 詢問照護問題</p>
                    </div>
                  ) : (
                    <div className="space-y-1 p-2">
                      {chatSessions.map((session) => (
                        <div
                          role="button"
                          tabIndex={0}
                          key={session.id}
                          onClick={() => {
                            if (isSelectMode) {
                              onToggleSessionSelection(session.id);
                              return;
                            }
                            void onOpenSession(session);
                          }}
                          className={`group w-full text-left px-2.5 py-2 rounded-lg border transition-all hover:bg-slate-50 dark:hover:bg-slate-800 ${
                            isSelectMode && selectedSessionIds.includes(session.id)
                              ? 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-700'
                              : selectedSession?.id === session.id
                                ? 'bg-slate-50 border-border dark:bg-slate-800'
                                : 'border-transparent'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            {isSelectMode && (
                              <div className="flex items-center pt-0.5 shrink-0">
                                <input
                                  type="checkbox"
                                  checked={selectedSessionIds.includes(session.id)}
                                  onChange={() => onToggleSessionSelection(session.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-3.5 w-3.5 rounded border-gray-300 accent-red-500 cursor-pointer"
                                />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-sm text-foreground truncate">
                                {session.title}
                              </p>
                              <span className="text-xs text-[#b0b0b0] mt-0.5">
                                {session.sessionDate === new Date().toISOString().slice(0, 10) ? session.sessionTime : `${session.sessionDate} ${session.sessionTime}`}
                              </span>
                              {session.labDataSnapshot && (
                                <div className="mt-1 text-xs text-muted-foreground">
                                  K: {formatSnapshotValue(session.labDataSnapshot.K)} • eGFR: {formatSnapshotValue(session.labDataSnapshot.eGFR)}
                                </div>
                              )}
                            </div>
                            {!isSelectMode && (
                              <div className="flex items-center gap-1 shrink-0">
                                <Badge className="text-xs bg-gray-100 dark:bg-gray-700 text-[#374151] dark:text-gray-200 border border-border">
                                  {session.messageCount ?? session.messages.length}
                                </Badge>
                                <span className="inline-flex items-center gap-1">
                                  <button
                                    onClick={(e) => void onDeleteSession(e, session.id)}
                                    disabled={deletingSessionId === session.id}
                                    className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-100 dark:hover:bg-red-900/30 text-muted-foreground hover:text-red-600 dark:hover:text-red-400 disabled:opacity-100 disabled:text-red-600"
                                    title="刪除對話"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                  {deletingSessionId === session.id ? <ButtonLoadingIndicator compact /> : null}
                                </span>
                              </div>
                            )}
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

        {/* 右側對話區 */}
        <div className={showSessionList ? "col-span-9" : "col-span-12"}>
          <Card className="border">
            <CardHeader className="bg-slate-50 dark:bg-slate-800 border-b py-1 px-3" style={{ paddingBottom: '4px' }}>
              <div className="flex items-center gap-1.5">
                <div className="flex-1" />
                {/* F-PARITY (2026-05-03): same F2 freshness pill the sidebar
                    /ai-chat carries. Visible once a session with snapshot
                    metadata is selected. */}
                {onRefreshSnapshot && (
                  <SnapshotRefreshControl
                    visible={Boolean(selectedSession && snapshotTakenAt)}
                    takenAt={snapshotTakenAt ?? null}
                    refreshing={refreshingSnapshot}
                    onRefresh={onRefreshSnapshot}
                  />
                )}
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-brand"
                    onClick={onToggleSessionList} title={showSessionList ? '隱藏記錄列表' : '顯示記錄列表'}>
                    <History className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="flex flex-col" style={{ height: 'max(calc(100vh - 260px), 480px)' }}>
                {/* 對話區 */}
                <div
                  ref={messagesContainerRef}
                  onScroll={onMessagesScroll}
                  className="relative flex-1 overflow-y-auto space-y-2 px-4 py-2"
                >
                  {chatMessages.length === 0 ? (
                    <div className="text-center text-muted-foreground py-12">
                      <MessageSquare className="h-16 w-16 mx-auto mb-4 opacity-30 text-[#9ca3af]" />
                      <p className="text-base font-medium">開始對話以獲得 AI 協助</p>
                      <p className="text-sm text-muted-foreground mt-2">可以詢問檢驗數據、用藥建議、治療指引等</p>
                    </div>
                  ) : (
                    chatMessages.map((msg, idx) => {
                      const isStreamingThis = isSending && idx === chatMessages.length - 1;
                      const isWaiting = isStreamingThis && !msg.content;
                      const displayContent = isStreamingThis && msg.content ? msg.content + '▌' : msg.content;
                      const references = msg.role === 'assistant' ? (msg.references || []) : [];
                      const freshnessHints = msg.role === 'assistant' ? getDisplayFreshnessHints(msg.dataFreshness) : [];
                      const hasDataQuality = msg.role === 'assistant' && (msg.degraded || freshnessHints.length > 0);
                      const isDetailExpanded = expandedExplanations.includes(idx);
                      const isRefsExpanded = expandedReferences.includes(idx);
                      const isQualityExpanded = expandedDataQuality.includes(idx);
                      const isFirstOfRound = idx > 0 && msg.role === 'user' && chatMessages[idx - 1].role === 'assistant';
                      return (
                        <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}${isFirstOfRound ? ' mt-3' : ''}`}>
                          {msg.role === 'user' ? (
                            <div className="max-w-[65%] w-fit rounded-2xl px-4 py-2.5 bg-white dark:bg-slate-900 border border-border">
                              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#1F2937]">{msg.content}</p>
                              {msg.timestamp && (
                                <p className="text-xs text-[#9ca3af] mt-1.5 text-right">{msg.timestamp}</p>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-start gap-2 max-w-[92%]">
                              {/* AI avatar */}
                              <img src={chatBotAvatar} alt="AI" className="h-8 w-8 rounded-full shadow-sm shrink-0 mt-0.5 object-cover" />
                              <div className="flex flex-1 min-w-0 rounded-2xl bg-white dark:bg-slate-900 border border-border overflow-hidden">
                                {/* Accent bar */}
                                <div className="w-[3px] shrink-0 rounded-l-full" style={{ backgroundColor: '#d1d5db' }} />
                                {/* Content */}
                                <div className="flex-1 min-w-0 px-3 py-2.5">
                                  {/* Summary / waiting state */}
                                  {isWaiting ? (
                                    <div className="flex items-center gap-1.5 py-1">
                                      <div className="h-2 w-2 rounded-full animate-bounce" style={{ backgroundColor: '#9ca3af', animationDelay: '0ms' }} />
                                      <div className="h-2 w-2 rounded-full animate-bounce" style={{ backgroundColor: '#9ca3af', animationDelay: '160ms' }} />
                                      <div className="h-2 w-2 rounded-full animate-bounce" style={{ backgroundColor: '#9ca3af', animationDelay: '320ms' }} />
                                    </div>
                                  ) : isStreamingThis ? (
                                    // During streaming render as plain whitespace-pre-wrap <p> so we
                                    // avoid re-parsing markdown on every delta — huge win for long answers.
                                    // Swaps to <AiMarkdown> automatically once isStreamingThis becomes false.
                                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#1F2937]">{displayContent}</p>
                                  ) : (
                                    <AiMarkdown content={displayContent} className="text-sm text-[#1F2937]" />
                                  )}

                                  {/* F-PARITY (2026-05-03): F3 advice chip group below the bubble. */}
                                  {!isStreamingThis && msg.role === 'assistant' && msg.adviceRefs && msg.adviceRefs.length > 0 && (
                                    <AdviceRefChips refs={msg.adviceRefs} />
                                  )}

                                  {/* Expandable panels — shown after streaming */}
                                  {!isStreamingThis && (<>
                                    {/* Detail / explanation panel */}
                                    {isDetailExpanded && msg.explanation && msg.explanation.trim().length > 0 && (
                                      <div className="mt-2 rounded-md bg-[#F7F8F9] border border-[#E5E7EB] px-3 py-2.5">
                                        <AiMarkdown content={msg.explanation} className="text-xs" />
                                        <SafetyWarnings warnings={msg.warnings} />
                                        {msg.requiresExpertReview && (
                                          <div className="mt-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700">
                                            此回覆包含潛在高風險資訊，建議醫師/藥師覆核。
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    {/* References panel */}
                                    {isRefsExpanded && (
                                      <div className="mt-2 rounded-md bg-slate-50 dark:bg-slate-800 border border-border p-2.5">
                                        {references.length === 0 ? (
                                          <p className="text-xs text-muted-foreground">本次回答未擷取到可顯示的文獻段落，可改用更具體關鍵詞再詢問。</p>
                                        ) : (
                                          <ul className="space-y-2">
                                            {references.map((ref, refIdx) => (
                                              <li key={`${ref.id || 'ref'}-${refIdx}`} className="text-xs text-muted-foreground">
                                                <div className="flex items-start gap-1">
                                                  <span className="mt-0.5 text-muted-foreground">•</span>
                                                  <div className="flex-1">
                                                    <p className="font-medium text-[#374151]">{ref.title || ref.sourceFile || 'unknown'}</p>
                                                    <p className="text-xs text-muted-foreground mt-0.5">
                                                      {(ref.sourceFile || ref.source || 'unknown')}
                                                      {' • '}
                                                      {formatCitationPageText(ref)}
                                                      {' • '}
                                                      相關度 {Number.isFinite(Number(ref.relevance)) ? Number(ref.relevance).toFixed(3) : 'N/A'}
                                                    </p>
                                                    {ref.summary ? (
                                                      <div className="mt-1 space-y-1">
                                                        <p className="text-xs text-[#374151] leading-relaxed">
                                                          <span className="font-medium text-[#374151]">重點：</span>{ref.summary}
                                                        </p>
                                                        {ref.keyQuote && (
                                                          <div className="rounded border border-[#d1d5db] dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs leading-relaxed text-muted-foreground italic">
                                                            「{ref.keyQuote}」
                                                          </div>
                                                        )}
                                                        {ref.relevanceNote && (
                                                          <p className="text-xs text-[#9ca3af]">{ref.relevanceNote}</p>
                                                        )}
                                                      </div>
                                                    ) : Array.isArray(ref.snippets) && ref.snippets.length > 1 ? (
                                                      <div className="mt-1 space-y-1.5">
                                                        {ref.snippets.map((s, si) => (
                                                          <div key={si} className="rounded border border-[#d1d5db] dark:border-slate-600 bg-white dark:bg-slate-900 p-2 text-xs leading-relaxed text-[#374151] dark:text-slate-200 whitespace-pre-wrap">
                                                            <span className="inline-block text-xs font-medium mb-0.5 text-muted-foreground">段落 {si + 1}</span>
                                                            <div>{compactSnippet(s)}</div>
                                                          </div>
                                                        ))}
                                                      </div>
                                                    ) : ref.snippet && ref.snippet.trim().length > 0 ? (
                                                      <div className="mt-1 rounded border border-[#d1d5db] dark:border-slate-600 bg-white dark:bg-slate-900 p-2 text-xs leading-relaxed text-[#374151] dark:text-slate-200 whitespace-pre-wrap max-h-32 overflow-y-auto">
                                                        {compactSnippet(ref.snippet)}
                                                      </div>
                                                    ) : (
                                                      <p className="text-xs text-[#9ca3af] mt-1">未提供原文段落。</p>
                                                    )}
                                                  </div>
                                                </div>
                                              </li>
                                            ))}
                                          </ul>
                                        )}
                                      </div>
                                    )}

                                    {/* Data quality panel */}
                                    {isQualityExpanded && hasDataQuality && (
                                      <div className="mt-2 rounded-md bg-amber-50 border border-amber-200 px-2.5 py-2 text-xs text-amber-700 flex items-start gap-1.5 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300">
                                        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                        <div className="space-y-0.5">
                                          {msg.degraded && <p>系統狀態：{formatAiDegradedReason(msg.degradedReason, msg.upstreamStatus)}</p>}
                                          {freshnessHints.length > 0 && <p>資料品質：{freshnessHints.join(' ')}</p>}
                                        </div>
                                      </div>
                                    )}
                                  </>)}

                                  {/* Inline toolbar */}
                                  {!isStreamingThis && (
                                    <div className="flex items-center gap-2.5 mt-2 pt-1.5 border-t border-[#F0F0F0] text-xs text-[#9CA3AF]">
                                      {msg.explanation && msg.explanation.trim().length > 0 && (
                                        <button
                                          onClick={() => onSetExpandedExplanations(prev => isDetailExpanded ? prev.filter(i => i !== idx) : [...prev, idx])}
                                          className="flex items-center gap-0.5 hover:text-[#4B5563] transition-colors"
                                          aria-label={isDetailExpanded ? '收合說明' : '展開說明'}
                                        >
                                          {isDetailExpanded ? <><ChevronDown className="h-3 w-3" />收合</> : <><ChevronRight className="h-3 w-3" />詳細</>}
                                        </button>
                                      )}
                                      {references.length > 0 && (
                                        <button
                                          onClick={() => onSetExpandedReferences(prev => isRefsExpanded ? prev.filter(i => i !== idx) : [...prev, idx])}
                                          className="flex items-center gap-0.5 hover:text-[#4B5563] cursor-pointer transition-colors"
                                          aria-label="參考依據"
                                        >
                                          <BookOpen className="h-3.5 w-3.5" />
                                          {references.length}
                                        </button>
                                      )}
                                      {hasDataQuality && (
                                        <button
                                          onClick={() => onSetExpandedDataQuality(prev => isQualityExpanded ? prev.filter(i => i !== idx) : [...prev, idx])}
                                          className="flex items-center gap-0.5 text-amber-500 hover:text-amber-700 transition-colors"
                                          aria-label="資料品質警告"
                                        >
                                          <AlertCircle className="h-3.5 w-3.5" />
                                        </button>
                                      )}
                                      {msg.timestamp && (
                                        <span className="flex items-center gap-0.5 text-xs text-[#9ca3af]">
                                          <Clock className="h-3.5 w-3.5" />
                                          {msg.timestamp}
                                        </span>
                                      )}
                                      <div className="flex-1" />
                                      <button
                                        onClick={async () => {
                                          const success = await copyToClipboard(msg.content);
                                          if (success) toast.success('已複製到剪貼簿');
                                          else toast.error('複製失敗，請手動複製');
                                        }}
                                        className="flex items-center gap-0.5 hover:text-[#4B5563] transition-colors"
                                        aria-label="複製回覆"
                                      >
                                        <Copy className="h-3 w-3" />
                                      </button>
                                      <span className="inline-flex items-center gap-1">
                                        <button
                                          onClick={() => void onSetMessageFeedback(idx, 'up')}
                                          className={`flex items-center gap-0.5 transition-colors ${
                                            msg.feedback === 'up' ? 'text-green-600' : 'hover:text-[#4B5563]'
                                          }`}
                                          aria-label="讚"
                                          disabled={feedbackingMessageIndex === idx || regeneratingMessageIndex === idx}
                                        >
                                          <ThumbsUp className="h-3 w-3" />
                                        </button>
                                        {feedbackingMessageIndex === idx ? <ButtonLoadingIndicator compact /> : null}
                                      </span>
                                      <span className="inline-flex items-center gap-1">
                                        <button
                                          onClick={() => void onSetMessageFeedback(idx, 'down')}
                                          className={`flex items-center gap-0.5 transition-colors ${
                                            msg.feedback === 'down' ? 'text-red-500' : 'hover:text-[#4B5563]'
                                          }`}
                                          aria-label="倒讚"
                                          disabled={feedbackingMessageIndex === idx || regeneratingMessageIndex === idx}
                                        >
                                          <ThumbsDown className="h-3 w-3" />
                                        </button>
                                        {feedbackingMessageIndex === idx ? <ButtonLoadingIndicator compact /> : null}
                                      </span>
                                      <span className="inline-flex items-center gap-1">
                                        <button
                                          onClick={() => void onRegenerateMessage(idx)}
                                          className="flex items-center gap-0.5 hover:text-[#4B5563] transition-colors"
                                          aria-label="重新生成"
                                          disabled={isSending || feedbackingMessageIndex === idx || regeneratingMessageIndex === idx}
                                        >
                                          <RefreshCw className={`h-3 w-3 ${isSending || regeneratingMessageIndex === idx ? 'opacity-40' : ''}`} />
                                        </button>
                                        {regeneratingMessageIndex === idx ? <ButtonLoadingIndicator compact /> : null}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                  {showScrollToBottom && (
                    <button
                      onClick={onJumpToLatest}
                      className="sticky bottom-2 ml-auto flex items-center gap-1 text-white text-xs rounded-full px-3 py-1.5 shadow-lg transition-colors z-10 bg-gray-700 hover:bg-gray-700 dark:bg-gray-600 dark:hover:bg-gray-500"
                      aria-label="跳到最新訊息"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                      跳到最新
                    </button>
                  )}
                </div>

                {/* 輸入區 */}
                <div className="flex-none px-4 pb-1.5 pt-0 border-t border-border bg-white dark:bg-slate-900">
                  <div className="flex gap-2 pt-1.5 items-end">
                    <Textarea
                      ref={chatInputRef}
                      placeholder={canSendAiChat ? "" : "AI 功能未就緒"}
                      value={chatInput}
                      onChange={(e) => onChatInputChange(e.target.value)}
                      onKeyDown={(e) => {
                        // Skip Enter while IME composition is active (zh-TW/zh-CN input methods)
                        // otherwise compositionend fires after we clear, re-populating the textarea
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          void onSendMessage();
                        }
                      }}
                      className={`min-h-[36px] border text-xs transition-colors rounded-xl ${
                        canSendAiChat
                          ? 'border-border'
                          : 'border-border bg-slate-50 dark:bg-slate-800 text-[#9ca3af] cursor-not-allowed'
                      }`}
                      disabled={!canSendAiChat}
                    />
                    <Button
                      onClick={() => void onSendMessage()}
                      size="icon"
                      className={`h-[36px] w-[36px] shrink-0 transition-colors rounded-xl ${
                        canSendAiChat
                          ? 'bg-gray-700 hover:bg-gray-700 dark:bg-gray-600 dark:hover:bg-gray-500'
                          : 'bg-[#d1d5db] dark:bg-gray-600 cursor-not-allowed'
                      }`}
                      disabled={isSending || !chatInput.trim() || !canSendAiChat}>
                      <Send className={`h-4.5 w-4.5 ${isSending ? 'opacity-40' : ''}`} />
                    </Button>
                  </div>
                  <p className="text-xs text-[#d0d0d0] mt-1">Enter 發送 · Shift+Enter 換行</p>
                </div>
              </div>{/* end flex column */}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Progress Note 功能已統一至「病歷記錄」tab */}

      {/* RAG 來源側欄 - 已移除 */}
    </TabsContent>
  );
}
