import { useMemo } from 'react';
import type React from 'react';
import { AlertCircle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Info, MessageSquare, Plus, Send, Trash2 } from 'lucide-react';
import type { Citation as AiCitation, DataFreshness } from '../../lib/api/ai';
import type { SessionChatMessage, SessionListItem } from '../../hooks/use-chat-sessions';
import { ChatMessageThread } from './chat-message-thread';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader } from '../ui/card';
import { ScrollArea } from '../ui/scroll-area';
import { TabsContent } from '../ui/tabs';
import { Textarea } from '../ui/textarea';

interface PatientChatTabProps {
  showSessionList: boolean;
  chatSessions: SessionListItem[];
  selectedSessionId?: string;
  onStartNewSession: () => void;
  onOpenSession: (session: SessionListItem) => void | Promise<void>;
  onDeleteSession: (sessionId: string) => void | Promise<void>;
  onCancelDeleteSession: () => void | Promise<void>;
  onConfirmDeleteSession: () => void | Promise<void>;
  deleteSessionDialogOpen: boolean;
  deleteSessionTargetId?: string | null;
  deletingSession: boolean;
  formatSnapshotValue: (value: number | undefined) => string;

  disclaimerCollapsed: boolean;
  onSetDisclaimerCollapsed: (value: boolean) => void;
  canSendAiChat: boolean;
  onToggleSessionList: () => void;

  chatMessages: SessionChatMessage[];
  isSending: boolean;
  thinkingStatus?: string | null;
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onMessagesScroll: () => void;
  showScrollToBottom: boolean;
  onJumpToLatest: () => void;
  expandedExplanations: Set<number>;
  expandedReferences: Set<number>;
  expandedDataQuality: Set<number>;
  onToggleExplanation: (index: number) => void;
  onToggleReferences: (index: number) => void;
  onToggleDataQuality: (index: number) => void;
  getDisplayFreshnessHints: (dataFreshness?: DataFreshness | null) => string[];
  formatAiDegradedReason: (reason?: string | null, upstreamStatus?: string | null) => string;
  formatCitationPageText: (citation: AiCitation) => string;
  compactSnippet: (snippet?: string) => string;
  avatarSrc: string;

  chatInputRef: React.RefObject<HTMLTextAreaElement | null>;
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSendMessage: () => void | Promise<void>;
  onSetMessageFeedback: (msgIndex: number, feedback: 'up' | 'down' | null) => void;
  onRegenerateMessage: (msgIndex: number) => void;
}

export function PatientChatTab({
  showSessionList,
  chatSessions,
  selectedSessionId,
  onStartNewSession,
  onOpenSession,
  onDeleteSession,
  onCancelDeleteSession,
  onConfirmDeleteSession,
  deleteSessionDialogOpen,
  deleteSessionTargetId,
  deletingSession,
  formatSnapshotValue,
  disclaimerCollapsed,
  onSetDisclaimerCollapsed,
  canSendAiChat,
  onToggleSessionList,
  chatMessages,
  isSending,
  thinkingStatus,
  messagesContainerRef,
  messagesEndRef,
  onMessagesScroll,
  showScrollToBottom,
  onJumpToLatest,
  expandedExplanations,
  expandedReferences,
  expandedDataQuality,
  onToggleExplanation,
  onToggleReferences,
  onToggleDataQuality,
  getDisplayFreshnessHints,
  formatAiDegradedReason,
  formatCitationPageText,
  compactSnippet,
  avatarSrc,
  chatInputRef,
  chatInput,
  onChatInputChange,
  onSendMessage,
  onSetMessageFeedback,
  onRegenerateMessage,
}: PatientChatTabProps) {
  const deleteTargetSession = useMemo(
    () => chatSessions.find((session) => session.id === deleteSessionTargetId) || null,
    [chatSessions, deleteSessionTargetId],
  );

  const now = new Date();
  const todayDateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  return (
    <TabsContent value="chat" className="space-y-2">
      <div className="flex gap-3">
        {/* 左側對話記錄列表 */}
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
                      onClick={onToggleSessionList}
                      title="收合對話記錄"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 px-2.5 text-xs bg-gray-700 hover:bg-gray-700 text-white"
                      onClick={onStartNewSession}
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      新對話
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea style={{ height: 'calc(100vh - 220px)', minHeight: '400px' }}>
                  {chatSessions.length === 0 ? (
                    <div className="p-8 flex flex-col items-center gap-2 text-center text-muted-foreground">
                      <MessageSquare className="h-10 w-10 opacity-30 text-[#9ca3af]" />
                      <p className="text-sm font-medium text-muted-foreground">尚無對話記錄</p>
                      <p className="text-xs text-[#9ca3af] leading-relaxed">點擊「新對話」開始<br />向 AI 詢問照護問題</p>
                    </div>
                  ) : (
                    <div className="space-y-2 p-2.5">
                      {chatSessions.map((session) => (
                        <div
                          role="button"
                          tabIndex={0}
                          key={session.id}
                          onClick={() => {
                            void onOpenSession(session);
                          }}
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
                                {session.sessionDate === todayDateKey ? session.sessionTime : `${session.sessionDate} ${session.sessionTime}`}
                              </p>
                              {session.labDataSnapshot && (
                                <div className="mt-1.5 text-xs leading-4 text-muted-foreground">
                                  K: {formatSnapshotValue(session.labDataSnapshot.K)} • eGFR: {formatSnapshotValue(session.labDataSnapshot.eGFR)}
                                </div>
                              )}
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1.5">
                              <Badge className="h-5 min-w-[1.5rem] justify-center border border-border bg-gray-100 dark:bg-slate-800 px-1.5 text-xs text-[#374151] dark:text-slate-300">
                                {session.messageCount ?? session.messages.length}
                              </Badge>
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void onDeleteSession(session.id);
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

        {/* 右側對話區 */}
        <div className="min-w-0 flex-1">
          <Card className="border">
            <CardHeader className="bg-slate-50 dark:bg-slate-800 border-b py-1 px-3" style={{ paddingBottom: '4px' }}>
              <div className="flex items-center gap-1.5">
                {!showSessionList && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-[#374151] dark:hover:text-slate-200"
                    onClick={onToggleSessionList}
                    title="顯示對話記錄"
                  >
                    <ChevronRight className="mr-1 h-3.5 w-3.5" />
                    對話記錄
                  </Button>
                )}
                {/* Disclaimer inline */}
                {disclaimerCollapsed ? (
                  <button
                    onClick={() => onSetDisclaimerCollapsed(false)}
                    className="flex items-center gap-1 text-xs text-[#9CA3AF] hover:text-[#6B7280] transition-colors"
                  >
                    <Info className="h-3.5 w-3.5" />
                    <span>AI 僅供參考</span>
                    <ChevronDown className="h-2.5 w-2.5" />
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded px-2 py-1">
                    <Info className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                    <span>AI 輔助產生，僅供臨床參考，不可取代醫師專業判斷。</span>
                    <button onClick={() => onSetDisclaimerCollapsed(true)} className="shrink-0 text-[#9CA3AF] hover:text-[#6B7280]">
                      <ChevronUp className="h-3 w-3" />
                    </button>
                  </div>
                )}
                <div className="flex-1" />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="flex flex-col" style={{ height: 'max(calc(100vh - 260px), 480px)' }}>
                {/* AI 未就緒 warning */}
                {!canSendAiChat && (
                  <div className="flex-none mx-4 mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 flex items-start gap-2">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">AI 對話功能暫時無法使用</p>
                      <p className="text-amber-700 mt-0.5">請聯繫系統管理員或稍後重試。</p>
                    </div>
                  </div>
                )}

                <ChatMessageThread
                  chatMessages={chatMessages}
                  isSending={isSending}
                  thinkingStatus={thinkingStatus}
                  containerRef={messagesContainerRef}
                  endRef={messagesEndRef}
                  onScroll={onMessagesScroll}
                  showScrollToBottom={showScrollToBottom}
                  onJumpToLatest={onJumpToLatest}
                  expandedExplanations={expandedExplanations}
                  expandedReferences={expandedReferences}
                  expandedDataQuality={expandedDataQuality}
                  onToggleExplanation={onToggleExplanation}
                  onToggleReferences={onToggleReferences}
                  onToggleDataQuality={onToggleDataQuality}
                  getDisplayFreshnessHints={getDisplayFreshnessHints}
                  formatAiDegradedReason={formatAiDegradedReason}
                  formatCitationPageText={formatCitationPageText}
                  compactSnippet={compactSnippet}
                  avatarSrc={avatarSrc}
                  onSetMessageFeedback={onSetMessageFeedback}
                  onRegenerateMessage={onRegenerateMessage}
                />

                {/* 輸入區 */}
                <div className="flex-none px-4 pb-1.5 pt-0 border-t border-border bg-white dark:bg-slate-900">
                  <div className="flex gap-2 pt-1.5 items-end">
                    <Textarea
                      ref={chatInputRef}
                      placeholder={canSendAiChat ? '例如：這位病患的鎮靜深度是否適當？' : 'AI 功能未就緒'}
                      value={chatInput}
                      onChange={(event) => onChatInputChange(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          void onSendMessage();
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
                      onClick={onSendMessage}
                      size="icon"
                      className={`h-[120px] w-[36px] shrink-0 transition-colors rounded-xl ${
                        canSendAiChat
                          ? 'bg-gray-700 hover:bg-gray-700'
                          : 'bg-[#d1d5db] cursor-not-allowed'
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
        open={deleteSessionDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            void onCancelDeleteSession();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>刪除對話記錄</AlertDialogTitle>
            <AlertDialogDescription>
              {`確定要刪除「${deleteTargetSession?.title || '這筆對話'}」嗎？此操作無法復原。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingSession}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={deletingSession}
              onClick={() => {
                void onConfirmDeleteSession();
              }}
            >
              {deletingSession ? '刪除中...' : '確認刪除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div aria-hidden="true" style={{ height: '10rem' }} />
    </TabsContent>
  );
}
