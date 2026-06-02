import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Save, Sparkles } from 'lucide-react';
import { Button } from '../ui/button';
import { ButtonLoadingIndicator } from '../ui/button-loading-indicator';
import { Textarea } from '../ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import type { RecordTemplate } from '../../lib/api/record-templates';
import type { TemplateContent } from '../../lib/medical-records/templates';

export interface TemplatePopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Hide the decorative Sparkles icon (pharma-tool surface). */
  showDecorativeIcons: boolean;
  selectedTemplate: string;
  visibleBuiltins: Record<string, TemplateContent>;
  serverTemplates: RecordTemplate[];
  onApplyTemplate: (name: string) => void;
  deletingTemplateName: string | null;
  onDeleteTemplate: (name: string) => void;

  canOverwriteServerTemplate: boolean;
  updatingTemplateName: string | null;
  onUpdateTemplate: (name: string) => void;

  canSaveBuiltinAsCustom: boolean;
  inputContent: string;

  showNewTemplate: boolean;
  setShowNewTemplate: React.Dispatch<React.SetStateAction<boolean>>;
  newTemplateName: string;
  setNewTemplateName: (value: string) => void;
  newTemplateContent: string;
  setNewTemplateContent: (value: string) => void;
  isSavingTemplate: boolean;
  onSaveAsTemplate: () => void;
}

/**
 * Templates popover: built-in + server templates list, apply / delete /
 * overwrite / save-as-custom actions, and the inline new-template form.
 * Pure presentation — all state and handlers are owned by MedicalRecords.
 */
export function TemplatePopover({
  open,
  onOpenChange,
  showDecorativeIcons,
  selectedTemplate,
  visibleBuiltins,
  serverTemplates,
  onApplyTemplate,
  deletingTemplateName,
  onDeleteTemplate,
  canOverwriteServerTemplate,
  updatingTemplateName,
  onUpdateTemplate,
  canSaveBuiltinAsCustom,
  inputContent,
  showNewTemplate,
  setShowNewTemplate,
  newTemplateName,
  setNewTemplateName,
  newTemplateContent,
  setNewTemplateContent,
  isSavingTemplate,
  onSaveAsTemplate,
}: TemplatePopoverProps) {
  const { t } = useTranslation('medical-records');

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 max-w-[200px] items-center gap-1 rounded-md border border-slate-200 bg-background px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground dark:border-slate-700 dark:bg-input/30 dark:hover:bg-input/50"
        >
          {showDecorativeIcons && <Sparkles className="h-4 w-4 shrink-0" />}
          <span className="truncate">
            {selectedTemplate ? t('templates.popoverButtonLabelWith', { name: selectedTemplate }) : t('templates.popoverButtonLabel')}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="end">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {t('templates.popoverTitle')}
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setShowNewTemplate((v) => !v)}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t('templates.addNew')}
            </Button>
          </div>

          <div className="max-h-60 space-y-1 overflow-auto pr-1">
            <div className="px-1 text-[11px] uppercase tracking-wide text-slate-400">{t('templates.groupBuiltin')}</div>
            {Object.keys(visibleBuiltins).map((name) => (
              <Button
                key={`b-${name}`}
                type="button"
                variant="ghost"
                size="sm"
                className={`h-auto w-full justify-start py-1.5 text-left text-sm ${
                  selectedTemplate === name
                    ? 'bg-slate-100 dark:bg-slate-800'
                    : ''
                }`}
                onClick={() => onApplyTemplate(name)}
              >
                {name}
              </Button>
            ))}

            {serverTemplates.length > 0 && (
              <>
                <div className="mt-2 px-1 text-[11px] uppercase tracking-wide text-slate-400">
                  {t('templates.groupCustom')}
                </div>
                {serverTemplates.map((tpl) => (
                  <div key={tpl.id} className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={`h-auto flex-1 justify-start py-1.5 text-left text-sm ${
                        selectedTemplate === tpl.name
                          ? 'bg-slate-100 dark:bg-slate-800'
                          : ''
                      }`}
                      onClick={() => onApplyTemplate(tpl.name)}
                    >
                      {tpl.name}
                    </Button>
                    {tpl.canDelete && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 shrink-0 p-0 text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                        disabled={deletingTemplateName === tpl.name}
                        onClick={() => void onDeleteTemplate(tpl.name)}
                        title={t('templates.deleteCustomTitle', { name: tpl.name })}
                      >
                        {deletingTemplateName === tpl.name ? (
                          <ButtonLoadingIndicator compact />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>

          {canOverwriteServerTemplate && (
            <Button
              size="sm"
              variant="outline"
              className="w-full border-blue-300 text-blue-600 hover:bg-blue-50"
              disabled={updatingTemplateName === selectedTemplate}
              onClick={() => void onUpdateTemplate(selectedTemplate)}
            >
              <Save className="mr-1.5 h-3.5 w-3.5" />
              {t('templates.overwriteServerTemplate', { name: selectedTemplate })}
              {updatingTemplateName === selectedTemplate ? (
                <ButtonLoadingIndicator />
              ) : null}
            </Button>
          )}

          {canSaveBuiltinAsCustom && (
            <Button
              size="sm"
              variant="outline"
              className="w-full border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              onClick={() => {
                // Pre-fill new-template form with current draft + suggested name.
                setShowNewTemplate(true);
                setNewTemplateName(`${selectedTemplate}${t('templates.saveBuiltinSuffix')}`);
                setNewTemplateContent(inputContent);
              }}
            >
              <Save className="mr-1.5 h-3.5 w-3.5" />
              {t('templates.saveBuiltinAsCustom', { name: selectedTemplate })}
            </Button>
          )}

          {showNewTemplate && (
            <div className="space-y-2 rounded-md border border-dashed border-slate-300 p-2 dark:border-slate-600">
              <input
                type="text"
                placeholder={t('templates.newTemplateNamePlaceholder')}
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              />
              <Textarea
                placeholder={t('templates.newTemplateContentPlaceholder')}
                value={newTemplateContent}
                onChange={(e) => setNewTemplateContent(e.target.value)}
                className="min-h-[80px] text-sm"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={onSaveAsTemplate}
                  disabled={isSavingTemplate}
                >
                  <span>{isSavingTemplate ? t('templates.saveProcessing') : t('templates.saveButton')}</span>
                  {isSavingTemplate ? <ButtonLoadingIndicator /> : null}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isSavingTemplate}
                  onClick={() => {
                    setShowNewTemplate(false);
                    setNewTemplateName('');
                    setNewTemplateContent('');
                  }}
                >
                  {t('templates.cancelButton')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
