import type { RefObject } from 'react';
import { toast } from 'sonner';
import {
  ArrowDown,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  MessageSquare,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { AiMarkdown, SafetyWarnings } from '../ui/ai-markdown';
import { copyToClipboard } from '../../lib/clipboard-utils';
import type { Citation as AiCitation, DataFreshness } from '../../lib/api/ai';
import type { SessionChatMessage } from '../../hooks/use-chat-sessions';
import { AdviceRefChips } from '../ai-chat/advice-ref-chips';
import { DrugInteractionBadges } from './drug-interaction-badges';
import { ExpertReviewWarning } from './expert-review-warning';
import { ButtonLoadingIndicator } from '../ui/button-loading-indicator';
import { useTranslation } from 'react-i18next';

interface ChatMessageThreadProps {
  chatMessages: SessionChatMessage[];
  isSending: boolean;
  thinkingStatus?: string | null;
  containerRef: RefObject<HTMLDivElement | null>;
  endRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  showScrollToBottom: boolean;
  onJumpToLatest: () => void;
  expandedExplanations: Set<number>;
  expandedReferences: Set<number>;
  onToggleExplanation: (index: number) => void;
  onToggleReferences: (index: number) => void;
  formatCitationPageText: (citation: AiCitation) => string;
  compactSnippet: (snippet?: string) => string;
  avatarSrc: string;
  onSetMessageFeedback: (msgIndex: number, feedback: 'up' | 'down' | null) => void;
  feedbackingMessageIndex?: number | null;
}

export function ChatMessageThread({
  chatMessages,
  isSending,
  thinkingStatus,
  containerRef,
  endRef,
  onScroll,
  showScrollToBottom,
  onJumpToLatest,
  expandedExplanations,
  expandedReferences,
  onToggleExplanation,
  onToggleReferences,
  formatCitationPageText,
  compactSnippet,
  avatarSrc,
  onSetMessageFeedback,
  feedbackingMessageIndex = null,
}: ChatMessageThreadProps) {
  const { t } = useTranslation('patient-chat');
  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="relative flex-1 overflow-y-auto space-y-2 px-4 py-2"
    >
      {chatMessages.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          <MessageSquare className="h-16 w-16 mx-auto mb-4 opacity-30 text-[#9ca3af]" />
          <p className="text-base font-medium">{t('thread.emptyTitle')}</p>
          <p className="text-sm text-muted-foreground mt-2">{t('thread.emptyHint')}</p>
        </div>
      ) : (
        chatMessages.map((msg, idx) => {
          const isStreamingThis = isSending && idx === chatMessages.length - 1;
          const isWaiting = isStreamingThis && !msg.content;
          const displayContent = isStreamingThis && msg.content ? msg.content + '▌' : msg.content;
          const references = msg.role === 'assistant' ? msg.references || [] : [];
          const isDetailExpanded = expandedExplanations.has(idx);
          const isRefsExpanded = expandedReferences.has(idx);
          const isFirstOfRound =
            idx > 0 && msg.role === 'user' && chatMessages[idx - 1].role === 'assistant';
          const isProcessingFeedback = feedbackingMessageIndex === idx;

          return (
            <div
              key={idx}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}${
                isFirstOfRound ? ' mt-3' : ''
              }`}
            >
              {msg.role === 'user' ? (
                <div className="max-w-[65%] w-fit rounded-2xl px-4 py-2.5 bg-white dark:bg-slate-900 border border-border">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#1F2937] dark:text-slate-200">
                    {msg.content}
                  </p>
                  {msg.timestamp && (
                    <p className="text-xs text-[#9ca3af] mt-1.5 text-right">{msg.timestamp}</p>
                  )}
                </div>
              ) : (
                <div className="flex items-start gap-2 max-w-[82%]">
                  <img
                    src={avatarSrc}
                    alt="AI"
                    className="h-8 w-8 rounded-full shadow-sm shrink-0 mt-0.5 object-cover"
                  />
                  <div className="flex flex-1 min-w-0 rounded-2xl bg-white dark:bg-slate-900 border border-border overflow-hidden">
                    <div
                      className="w-[3px] shrink-0 rounded-l-full"
                      style={{ backgroundColor: '#d1d5db' }}
                    />
                    <div className="flex-1 min-w-0 px-3 py-2.5">
                      {isWaiting ? (
                        <div className="flex items-center py-1.5">
                          <div>
                            <div className="chat-thinking-dots" role="status" aria-label="AI 思考中">
                              <span
                                className="chat-thinking-dot"
                                style={{ animationDelay: '0ms' }}
                              />
                              <span
                                className="chat-thinking-dot"
                                style={{ animationDelay: '180ms' }}
                              />
                              <span
                                className="chat-thinking-dot"
                                style={{ animationDelay: '360ms' }}
                              />
                            </div>
                            {thinkingStatus && (
                              <p className="text-xs text-muted-foreground mt-1">{thinkingStatus}</p>
                            )}
                          </div>
                        </div>
                      ) : (
                        <>
                          {msg.graphMeta && msg.graphMeta.interactions && msg.graphMeta.interactions.length > 0 && (
                            <DrugInteractionBadges
                              interactions={msg.graphMeta.interactions}
                              hasRiskX={msg.graphMeta.has_risk_x}
                            />
                          )}
                          <AiMarkdown content={displayContent} className="text-sm leading-relaxed text-[#1F2937] dark:text-slate-200" />
                          {msg.requiresExpertReview && (
                            <ExpertReviewWarning show={msg.requiresExpertReview} />
                          )}
                          {!isStreamingThis && msg.role === 'assistant' && msg.adviceRefs && msg.adviceRefs.length > 0 && (
                            <AdviceRefChips refs={msg.adviceRefs} />
                          )}
                        </>
                      )}

                      {!isStreamingThis && (
                        <>
                          {isDetailExpanded && msg.explanation && msg.explanation.trim().length > 0 && (
                            <div className="mt-2 rounded-md bg-[#F7F8F9] dark:bg-slate-800 border border-[#E5E7EB] dark:border-slate-700 px-3 py-2.5">
                              <AiMarkdown content={msg.explanation} className="text-sm" />
                              <SafetyWarnings warnings={msg.warnings} />
                              {msg.requiresExpertReview && (
                                <div className="mt-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                                  {t('thread.expertReviewWarning')}
                                </div>
                              )}
                            </div>
                          )}

                          {isRefsExpanded && (
                            <div className="mt-2 rounded-md bg-slate-50 dark:bg-slate-800 border border-border p-2.5">
                              {references.length === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                  {t('thread.noReferences')}
                                </p>
                              ) : (
                                <ul className="space-y-2">
                                  {references.map((ref, refIdx) => (
                                    <li
                                      key={`${ref.id || 'ref'}-${refIdx}`}
                                      className="text-xs text-muted-foreground"
                                    >
                                      <div className="flex items-start gap-1">
                                        <span className="mt-0.5 text-muted-foreground">•</span>
                                        <div className="flex-1">
                                          <p className="font-medium text-[#374151] dark:text-slate-300">
                                            {ref.title || ref.sourceFile || 'unknown'}
                                          </p>
                                          <p className="text-xs text-muted-foreground mt-0.5">
                                            {ref.sourceFile || ref.source || 'unknown'}
                                            {' • '}
                                            {formatCitationPageText(ref)}
                                            {' • '}
                                            {t('thread.relevanceLabel')}{' '}
                                            {Number.isFinite(Number(ref.relevance))
                                              ? Number(ref.relevance).toFixed(3)
                                              : 'N/A'}
                                          </p>
                                          {ref.summary ? (
                                            <div className="mt-1 space-y-1">
                                              <p className="text-xs text-[#374151] dark:text-slate-300 leading-relaxed">
                                                <span className="font-medium text-[#374151] dark:text-slate-300">{t('thread.highlightLabel')}</span>
                                                {ref.summary}
                                              </p>
                                              {ref.keyQuote && (
                                                <div className="rounded border border-[#d1d5db] dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs leading-relaxed text-muted-foreground italic">
                                                  {t('thread.quotedSnippet', { quote: ref.keyQuote })}
                                                </div>
                                              )}
                                              {ref.relevanceNote && (
                                                <p className="text-xs text-[#9ca3af]">
                                                  {ref.relevanceNote}
                                                </p>
                                              )}
                                            </div>
                                          ) : Array.isArray(ref.snippets) && ref.snippets.length > 1 ? (
                                            <div className="mt-1 space-y-1.5">
                                              {ref.snippets.map((snippet, snippetIndex) => (
                                                <div
                                                  key={snippetIndex}
                                                  className="rounded border border-[#d1d5db] dark:border-slate-600 bg-white dark:bg-slate-800 p-2 text-xs leading-relaxed text-[#374151] dark:text-slate-300 whitespace-pre-wrap"
                                                >
                                                  <span className="inline-block text-xs font-medium mb-0.5 text-muted-foreground">
                                                    {t('thread.snippetLabel', { index: snippetIndex + 1 })}
                                                  </span>
                                                  <div>{compactSnippet(snippet)}</div>
                                                </div>
                                              ))}
                                            </div>
                                          ) : ref.snippet && ref.snippet.trim().length > 0 ? (
                                            <div className="mt-1 rounded border border-[#d1d5db] dark:border-slate-600 bg-white dark:bg-slate-800 p-2 text-xs leading-relaxed text-[#374151] dark:text-slate-300 whitespace-pre-wrap max-h-32 overflow-y-auto">
                                              {compactSnippet(ref.snippet)}
                                            </div>
                                          ) : (
                                            <p className="text-xs text-[#9ca3af] mt-1">
                                              {t('thread.noOriginalSnippet')}
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}

                        </>
                      )}

                      {!isStreamingThis && (
                        <div className="mt-2 flex items-center gap-2.5 border-t border-[#F0F0F0] dark:border-slate-700 pt-1.5 text-xs text-[#9CA3AF]">
                          {msg.explanation && msg.explanation.trim().length > 0 && (
                            <button
                              onClick={() => onToggleExplanation(idx)}
                              className="flex items-center gap-0.5 hover:text-[#4B5563] transition-colors"
                              aria-label={isDetailExpanded ? t('thread.collapseDetail') : t('thread.expandDetail')}
                            >
                              {isDetailExpanded ? (
                                <>
                                  <ChevronDown className="h-3 w-3" />
                                  {t('thread.shortCollapse')}
                                </>
                              ) : (
                                <>
                                  <ChevronRight className="h-3 w-3" />
                                  {t('thread.shortDetail')}
                                </>
                              )}
                            </button>
                          )}
                          {references.length > 0 && (
                            <button
                              onClick={() => onToggleReferences(idx)}
                              className="flex items-center gap-0.5 hover:text-[#4B5563] cursor-pointer transition-colors"
                              aria-label={t('thread.referencesAria')}
                            >
                              <BookOpen className="h-3.5 w-3.5" />
                              {references.length}
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
                              if (success) toast.success(t('thread.copySuccess'));
                              else toast.error(t('thread.copyError'));
                            }}
                            className="flex items-center gap-0.5 hover:text-[#4B5563] transition-colors"
                            aria-label={t('thread.copyAria')}
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                          <span className="inline-flex items-center gap-1">
                            <button
                              onClick={() => void onSetMessageFeedback(idx, 'up')}
                              className={`flex items-center gap-0.5 transition-colors ${
                                msg.feedback === 'up'
                                  ? 'text-green-600'
                                  : 'hover:text-[#4B5563]'
                              }`}
                              aria-label={t('thread.thumbsUpAria')}
                              disabled={isProcessingFeedback}
                            >
                              <ThumbsUp className="h-3 w-3" />
                            </button>
                            {isProcessingFeedback ? <ButtonLoadingIndicator compact /> : null}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <button
                              onClick={() => void onSetMessageFeedback(idx, 'down')}
                              className={`flex items-center gap-0.5 transition-colors ${
                                msg.feedback === 'down'
                                  ? 'text-red-500'
                                  : 'hover:text-[#4B5563]'
                              }`}
                              aria-label={t('thread.thumbsDownAria')}
                              disabled={isProcessingFeedback}
                            >
                              <ThumbsDown className="h-3 w-3" />
                            </button>
                            {isProcessingFeedback ? <ButtonLoadingIndicator compact /> : null}
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
      <div ref={endRef} />
      {showScrollToBottom && (
        <button
          onClick={onJumpToLatest}
          className="sticky bottom-2 ml-auto flex items-center gap-1 text-white text-xs rounded-full px-3 py-1.5 shadow-lg transition-colors z-10 bg-gray-700 hover:bg-gray-700"
          aria-label={t('thread.scrollToLatestAria')}
        >
          <ArrowDown className="h-3.5 w-3.5" />
          {t('thread.scrollToLatest')}
        </button>
      )}
    </div>
  );
}

