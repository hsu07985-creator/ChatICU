import { useTranslation } from 'react-i18next';
import { Brain, Copy, Sparkles, X, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Badge } from '../ui/badge';
import { isCmdEnter } from '../../lib/dom/key';
import type { RecordTypeConfig } from '../../lib/medical-records/templates';

export interface DraftPolishPanesProps {
  config: RecordTypeConfig;
  Icon: RecordTypeConfig['icon'];
  showDecorativeIcons: boolean;
  canPolish: boolean;
  polishReason: string;

  inputContent: string;
  setInputContent: (value: string) => void;
  polishedContent: string;
  setPolishedContent: (value: string) => void;
  isPolishedStale: boolean;
  canCopy: boolean;

  isPolishing: boolean;
  isRefining: boolean;
  onPolish: () => void;
  onStopPolish: () => void;
  onClearDraft: () => void;
  onCopy: () => void;
  lastCopiedHint: string | null;

  // Refinement panel
  refinementInstruction: string;
  setRefinementInstruction: (value: string) => void;
  onRefine: () => void;
  onStopRefine: () => void;

  // "Just-applied" undo chip + applied-template footer
  selectedTemplate: string;
  selectedTemplateSnapshot: string | null;
  hasStashedDraft: boolean;
  onUndoApply: () => void;
  onRemoveTemplate: () => void;
}

/**
 * Side-by-side 草稿 | AI 修飾 editor panes (non-pharmacist-SOAP path). Pure
 * presentation — all state, persistence, and streaming handlers are owned by
 * MedicalRecords / its hooks.
 */
export function DraftPolishPanes({
  config,
  Icon,
  showDecorativeIcons,
  canPolish,
  polishReason,
  inputContent,
  setInputContent,
  polishedContent,
  setPolishedContent,
  isPolishedStale,
  canCopy,
  isPolishing,
  isRefining,
  onPolish,
  onStopPolish,
  onClearDraft,
  onCopy,
  lastCopiedHint,
  refinementInstruction,
  setRefinementInstruction,
  onRefine,
  onStopRefine,
  selectedTemplate,
  selectedTemplateSnapshot,
  hasStashedDraft,
  onUndoApply,
  onRemoveTemplate,
}: DraftPolishPanesProps) {
  const { t } = useTranslation('medical-records');

  return (
    /* Side-by-side: 草稿 | AI 修飾 */
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Left: 草稿 */}
      <Card className="flex flex-col border-slate-300 dark:border-slate-600">
        <CardHeader className="bg-slate-50 py-3 dark:bg-slate-800">
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon className="h-4 w-4" />
            {t('draftSection.title')}
          </CardTitle>
          <CardDescription className="text-xs">{config.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3 pt-4">
          <Textarea
            value={inputContent}
            onChange={(e) => setInputContent(e.target.value)}
            placeholder={config.placeholder}
            className="min-h-[280px] flex-1 resize-none border-slate-300 dark:border-slate-600"
            onKeyDown={(e) => {
              if (isCmdEnter(e) && !isPolishing && inputContent.trim() && canPolish) {
                e.preventDefault();
                onPolish();
              }
            }}
          />
          <div className="flex items-center gap-2">
            {isPolishing ? (
              <Button
                onClick={onStopPolish}
                variant="outline"
                className="flex-1 border-amber-500 text-amber-700 hover:bg-amber-50 dark:text-amber-300"
              >
                <X className="mr-2 h-4 w-4" />
                <span>{t('draftSection.stopPolish')}</span>
              </Button>
            ) : (
              <Button
                onClick={onPolish}
                disabled={!inputContent.trim() || !canPolish}
                style={{ backgroundColor: '#1e293b' }}
                className="flex-1"
                title={!canPolish ? polishReason : undefined}
              >
                {showDecorativeIcons && <Brain className="mr-2 h-4 w-4" />}
                <span>{config.polishLabel}</span>
                {showDecorativeIcons && <ArrowRight className="ml-2 h-4 w-4" />}
              </Button>
            )}
            {(inputContent || polishedContent) && (
              <Button
                variant="outline"
                size="sm"
                onClick={onClearDraft}
                title={t('draftSection.clearDraft')}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            {t('draftSection.polishHint')}
          </p>
          {(isPolishing || isRefining) && (
            <div className="rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-500 dark:bg-slate-800/40 dark:text-slate-400">
              {t('draftSection.polishingNotice')}
            </div>
          )}
          {/* "Just-applied" undo chip — visible while input still equals the
              snapshot (i.e. user hasn't started editing the template). */}
          {selectedTemplate
            && selectedTemplateSnapshot !== null
            && inputContent === selectedTemplateSnapshot
            && hasStashedDraft && (
            <div className="flex items-center justify-between rounded bg-blue-50 px-2 py-1 text-xs text-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
              <span>{t('templateApply.appliedHint', { name: selectedTemplate })}</span>
              <button
                type="button"
                className="font-medium underline"
                onClick={onUndoApply}
              >
                {t('templateApply.undoApply')}
              </button>
            </div>
          )}
          {selectedTemplate && (
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>
                {t('templateApply.appliedTemplatePrefix')}
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {selectedTemplate}
                </span>
              </span>
              <button
                className="hover:text-slate-700 dark:hover:text-slate-200"
                onClick={onRemoveTemplate}
              >
                {t('templateApply.removeTemplate')}
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Right: AI 修飾後 */}
      <Card className="flex flex-col border-slate-300 dark:border-slate-600">
        <CardHeader className="bg-slate-50 py-3 dark:bg-slate-800">
          <CardTitle className="flex items-center gap-2 text-base">
            {showDecorativeIcons && <Sparkles className="h-4 w-4" />}
            {t('polishedSection.title')}
            {polishedContent && (
              <Badge variant="secondary" className="text-[10px]">
                {t('polishedSection.editableBadge')}
              </Badge>
            )}
            {isPolishedStale && (
              <Badge
                variant="secondary"
                className="bg-amber-100 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-300"
              >
                {t('polishedSection.staleBadge')}
              </Badge>
            )}
          </CardTitle>
          <CardDescription className="text-xs">
            {polishedContent
              ? t('polishedSection.promptDescPolished')
              : t('polishedSection.promptDescBlank', { label: config.polishLabel })}
          </CardDescription>
        </CardHeader>
        <CardContent
          className="flex flex-1 flex-col gap-3 pt-4"
          role="status"
          aria-live="polite"
          aria-atomic="false"
        >
          <Textarea
            value={polishedContent}
            onChange={(e) => setPolishedContent(e.target.value)}
            placeholder={t('polishedSection.polishedPlaceholder')}
            className="min-h-[280px] flex-1 resize-none border-slate-300 font-mono text-sm dark:border-slate-600"
          />
          <Button
            onClick={onCopy}
            disabled={!canCopy}
            className={
              polishedContent.trim().length > 0
                ? 'w-full bg-brand hover:bg-brand-hover'
                : 'w-full border border-amber-500 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-300'
            }
            title={
              polishedContent.trim().length > 0
                ? undefined
                : t('polishedSection.copyDraftHisTitle')
            }
          >
            <Copy className="mr-2 h-4 w-4" />
            {polishedContent.trim().length > 0
              ? t('polishedSection.copyPolishedToHis')
              : t('polishedSection.copyDraftToHis')}
          </Button>
          {lastCopiedHint && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              {lastCopiedHint}
            </p>
          )}

          {polishedContent && (
            // Always-visible refine box. Compact by default — single-line
            // input + truncated preview chip — expands on focus (chat-input
            // pattern). Saves ~70px of vertical space when not in use,
            // restores full editor when the user actually needs it.
            <div className="group/refine space-y-2 rounded-md border-2 border-slate-300 bg-slate-50/60 p-3 dark:border-slate-600 dark:bg-slate-800/30">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {t('refine.title')}
                </h4>
                <p className="text-[11px] text-slate-400">{t('refine.shortcutHint')}</p>
              </div>
              {/* Single-line preview chip; full text shown on the polished
                  pane right above so truncation here is fine. */}
              <div className="truncate rounded bg-white px-2 py-1 text-[11px] text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
                {t('refine.previewLabel')}
                <span className="ml-1 font-mono">
                  {polishedContent.replace(/\s+/g, ' ').slice(0, 60)}
                  {polishedContent.length > 60 ? '…' : ''}
                </span>
              </div>
              <Textarea
                value={refinementInstruction}
                onChange={(e) => setRefinementInstruction(e.target.value)}
                placeholder={t('refine.placeholder')}
                className="min-h-[36px] resize-none border-slate-300 text-sm transition-[min-height] duration-150 focus:min-h-[80px] dark:border-slate-600"
                disabled={isRefining}
                onKeyDown={(e) => {
                  if (isCmdEnter(e) && !isRefining) {
                    e.preventDefault();
                    onRefine();
                  }
                }}
              />
              {isRefining ? (
                <Button
                  onClick={onStopRefine}
                  size="sm"
                  variant="outline"
                  className="w-full border-amber-500 text-amber-700 hover:bg-amber-50 dark:text-amber-300"
                >
                  <X className="mr-1.5 h-3.5 w-3.5" />
                  {t('refine.stop')}
                </Button>
              ) : (
                <Button
                  onClick={onRefine}
                  disabled={!refinementInstruction.trim()}
                  size="sm"
                  style={{ backgroundColor: '#1e293b' }}
                  className="w-full"
                >
                  {t('refine.submit')}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
