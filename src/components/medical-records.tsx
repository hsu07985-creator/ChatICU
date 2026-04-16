import { useState, useEffect, useMemo, useCallback } from 'react';
import { getReadinessReason, polishClinicalText, type AIReadiness } from '../lib/api/ai';
import {
  listRecordTemplates,
  createRecordTemplate,
  updateRecordTemplate,
  deleteRecordTemplate,
  type RecordTemplate,
  type RecordTemplateType,
} from '../lib/api/record-templates';
import { copyToClipboard } from '../lib/clipboard-utils';
import { useAuth } from '../lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { ButtonLoadingIndicator } from './ui/button-loading-indicator';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import {
  FileText,
  Pill,
  ClipboardList,
  Brain,
  Copy,
  Sparkles,
  Plus,
  Trash2,
  X,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Wand2,
  Save,
} from 'lucide-react';
import { toast } from 'sonner';

interface MedicalRecordsProps {
  patientId: string;
  patientName?: string;
  aiReadiness?: AIReadiness | null;
}

type RecordType = 'progress-note' | 'medication-advice' | 'nursing-record';

const RECORD_TYPES: RecordType[] = ['progress-note', 'medication-advice', 'nursing-record'];

const RECORD_TYPE_CONFIG: Record<
  RecordType,
  { label: string; icon: typeof FileText; description: string; placeholder: string; polishLabel: string }
> = {
  'progress-note': {
    label: 'Progress Note',
    icon: FileText,
    description: '中文／半英文都行，AI 會轉成專業 Progress Note 格式',
    placeholder: '例：病人今天意識清楚，血壓穩定，繼續使用呼吸器...',
    polishLabel: 'AI 修飾',
  },
  'medication-advice': {
    label: '用藥建議',
    icon: Pill,
    description: '輸入用藥草稿，AI 協助整理為專業建議',
    placeholder: '例：建議調整 Morphine 劑量因為腎功能不全，注意呼吸抑制...',
    polishLabel: 'AI 修飾',
  },
  'nursing-record': {
    label: '護理記錄',
    icon: ClipboardList,
    description: '使用模板快速建立，AI 協助檢查錯字與格式',
    placeholder: '填寫護理記錄或套用模板...',
    polishLabel: 'AI 檢查',
  },
};

const BUILTIN_TEMPLATES: Record<RecordType, Record<string, string>> = {
  'progress-note': {
    'SOAP 格式': `S (Subjective):
O (Objective):
  Physical exam:
A (Assessment):
P (Plan):`,
    '簡要紀錄': `主訴:
目前狀況:
處置計畫:`,
  },
  'medication-advice': {
    '劑量調整建議': `藥品名稱:
目前劑量:
建議調整:
調整原因:
監測項目:`,
    '新增藥品建議': `建議藥品:
適應症:
建議劑量:
給藥途徑:
注意事項:`,
  },
  'nursing-record': {
    '一般交班': `病患意識:
生命徵象:
呼吸器設定:
管路:
輸液:
尿量:
特殊狀況:`,
    '鎮靜評估': `RASS Score:
CAM-ICU:
使用鎮靜劑:
劑量調整:
呼吸型態:
建議:`,
    '管路評估': `氣管內管:
中心靜脈導管:
動脈導管:
尿管:
鼻胃管:
其他管路:`,
    '傷口護理': `傷口位置:
傷口大小:
傷口深度:
滲液:
紅腫熱痛:
換藥頻率:
使用敷料:`,
  },
};

/* ---------------- localStorage 草稿 / 歷史 ---------------- */

type DraftEntry = { input: string; polished: string; polishedFrom: string };
type Drafts = Record<RecordType, DraftEntry>;

const EMPTY_DRAFT: DraftEntry = { input: '', polished: '', polishedFrom: '' };
const EMPTY_DRAFTS: Drafts = {
  'progress-note': { ...EMPTY_DRAFT },
  'medication-advice': { ...EMPTY_DRAFT },
  'nursing-record': { ...EMPTY_DRAFT },
};

const draftKey = (patientId: string) => `chaticu-draft-${patientId}`;

function loadDrafts(patientId: string): Drafts {
  try {
    const raw = localStorage.getItem(draftKey(patientId));
    if (!raw) return { ...EMPTY_DRAFTS };
    const parsed = JSON.parse(raw) as Partial<Drafts>;
    return {
      'progress-note': { ...EMPTY_DRAFT, ...(parsed['progress-note'] || {}) },
      'medication-advice': { ...EMPTY_DRAFT, ...(parsed['medication-advice'] || {}) },
      'nursing-record': { ...EMPTY_DRAFT, ...(parsed['nursing-record'] || {}) },
    };
  } catch {
    return { ...EMPTY_DRAFTS };
  }
}

function saveDrafts(patientId: string, drafts: Drafts) {
  try {
    localStorage.setItem(draftKey(patientId), JSON.stringify(drafts));
  } catch {
    /* ignore quota errors */
  }
}

/* ---------------- component ---------------- */

export function MedicalRecords({ patientId, aiReadiness = null }: MedicalRecordsProps) {
  const { user } = useAuth();
  const canPolish = aiReadiness ? aiReadiness.feature_gates.clinical_polish : true;
  const polishReason = getReadinessReason(aiReadiness, 'clinical_polish');

  const getDefaultRecordType = (): RecordType => {
    if (user?.role === 'pharmacist') return 'medication-advice';
    if (user?.role === 'nurse') return 'nursing-record';
    return 'progress-note';
  };

  const [recordType, setRecordType] = useState<RecordType>(getDefaultRecordType());

  // Drafts (per-type, per-patient, persisted)
  const [drafts, setDraftsState] = useState<Drafts>(() => loadDrafts(patientId));
  const [hydratedPatient, setHydratedPatient] = useState<string>(patientId);
  if (hydratedPatient !== patientId) {
    // Reload drafts when patient switches (render-phase derived state, supported pattern)
    setHydratedPatient(patientId);
    setDraftsState(loadDrafts(patientId));
  }

  const updateDraft = useCallback(
    (type: RecordType, patch: Partial<DraftEntry>) => {
      setDraftsState((prev) => {
        const next: Drafts = {
          ...prev,
          [type]: { ...prev[type], ...patch },
        };
        saveDrafts(patientId, next);
        return next;
      });
    },
    [patientId],
  );

  const currentDraft = drafts[recordType];
  const inputContent = currentDraft.input;
  const polishedContent = currentDraft.polished;
  const polishedFrom = currentDraft.polishedFrom;
  const isPolishedStale = polishedContent.length > 0 && polishedFrom !== inputContent;

  const setInputContent = (value: string) => updateDraft(recordType, { input: value });
  const setPolishedContent = (value: string) => updateDraft(recordType, { polished: value });

  const clearDraft = () => {
    updateDraft(recordType, { input: '', polished: '', polishedFrom: '' });
    setSelectedTemplate('');
  };

  // Templates (server-backed)
  const [serverTemplates, setServerTemplates] = useState<RecordTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [templatePopoverOpen, setTemplatePopoverOpen] = useState(false);
  const [showNewTemplate, setShowNewTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateContent, setNewTemplateContent] = useState('');

  // Loading flags
  const [isPolishing, setIsPolishing] = useState(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isRefining, setIsRefining] = useState(false);

  // Refinement panel (per-type UI state — not persisted)
  const [refinementOpen, setRefinementOpen] = useState(false);
  const [refinementInstruction, setRefinementInstruction] = useState('');
  const [deletingTemplateName, setDeletingTemplateName] = useState<string | null>(null);
  const [updatingTemplateName, setUpdatingTemplateName] = useState<string | null>(null);

  const fetchTemplates = useCallback(async (type: RecordTemplateType) => {
    try {
      const templates = await listRecordTemplates(type);
      setServerTemplates(templates);
    } catch {
      setServerTemplates([]);
    }
  }, []);

  useEffect(() => {
    fetchTemplates(recordType as RecordTemplateType);
  }, [recordType, fetchTemplates]);

  const allTemplates = useMemo(() => {
    const merged: Record<string, string> = { ...BUILTIN_TEMPLATES[recordType] };
    for (const t of serverTemplates) merged[t.name] = t.content;
    return merged;
  }, [recordType, serverTemplates]);

  /* -------- actions -------- */

  const handleApplyTemplate = (name: string) => {
    const tpl = allTemplates[name];
    if (!tpl) return;
    setSelectedTemplate(name);
    setInputContent(tpl);
    setTemplatePopoverOpen(false);
  };

  const handlePolishContent = async () => {
    if (!inputContent.trim()) return;
    if (!canPolish) {
      toast.error(polishReason);
      return;
    }
    setIsPolishing(true);
    try {
      const polishTypeMap: Record<RecordType, 'progress_note' | 'medication_advice' | 'nursing_record'> = {
        'progress-note': 'progress_note',
        'medication-advice': 'medication_advice',
        'nursing-record': 'nursing_record',
      };
      const templateContent = selectedTemplate ? allTemplates[selectedTemplate] : undefined;
      const result = await polishClinicalText({
        patientId,
        content: inputContent,
        polishType: polishTypeMap[recordType],
        templateContent,
      });
      updateDraft(recordType, { polished: result.polished, polishedFrom: inputContent });
    } catch {
      toast.error('AI 修飾失敗，請稍後再試');
    } finally {
      setIsPolishing(false);
    }
  };

  const handleRefine = async () => {
    const instruction = refinementInstruction.trim();
    if (!instruction) {
      toast.error('請輸入要怎麼調整');
      return;
    }
    if (!polishedContent.trim()) return;
    if (!canPolish) {
      toast.error(polishReason);
      return;
    }
    setIsRefining(true);
    try {
      const polishTypeMap: Record<RecordType, 'progress_note' | 'medication_advice' | 'nursing_record'> = {
        'progress-note': 'progress_note',
        'medication-advice': 'medication_advice',
        'nursing-record': 'nursing_record',
      };
      const result = await polishClinicalText({
        patientId,
        content: inputContent,
        polishType: polishTypeMap[recordType],
        instruction,
        previousPolished: polishedContent,
      });
      updateDraft(recordType, { polished: result.polished, polishedFrom: inputContent });
      setRefinementInstruction('');
      toast.success('已依指示重新修飾');
    } catch {
      toast.error('再修一次失敗，請稍後再試');
    } finally {
      setIsRefining(false);
    }
  };

  const handleCopy = async () => {
    const text = (polishedContent || inputContent).trim();
    if (!text) return;
    const ok = await copyToClipboard(text);
    if (ok) toast.success('已複製，可貼到 HIS');
    else toast.error('複製失敗，請手動複製');
  };

  const handleSaveAsTemplate = async () => {
    const name = newTemplateName.trim();
    if (!name) {
      toast.error('請輸入模板名稱');
      return;
    }
    if (!newTemplateContent.trim()) {
      toast.error('請輸入模板內容');
      return;
    }
    if (name in BUILTIN_TEMPLATES[recordType]) {
      toast.error(`「${name}」與內建模板名稱重複，請使用其他名稱`);
      return;
    }
    setIsSavingTemplate(true);
    try {
      const roleMap: Record<string, RecordTemplate['roleScope']> = {
        doctor: 'doctor',
        np: 'np',
        nurse: 'nurse',
        pharmacist: 'pharmacist',
        admin: 'admin',
      };
      await createRecordTemplate({
        name,
        recordType: recordType as RecordTemplateType,
        roleScope: roleMap[user?.role || ''] || 'all',
        content: newTemplateContent,
      });
      setNewTemplateName('');
      setNewTemplateContent('');
      setShowNewTemplate(false);
      toast.success(`模板「${name}」已儲存`);
      fetchTemplates(recordType as RecordTemplateType);
    } catch {
      toast.error('儲存模板失敗，請稍後再試');
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const handleDeleteTemplate = async (name: string) => {
    const tpl = serverTemplates.find((t) => t.name === name);
    if (!tpl) {
      toast.error('無法刪除內建模板');
      return;
    }
    if (!tpl.canDelete) {
      toast.error('您沒有刪除此模板的權限');
      return;
    }
    setDeletingTemplateName(name);
    try {
      await deleteRecordTemplate(tpl.id);
      if (selectedTemplate === name) setSelectedTemplate('');
      toast.success(`模板「${name}」已刪除`);
      fetchTemplates(recordType as RecordTemplateType);
    } catch {
      toast.error('刪除模板失敗，請稍後再試');
    } finally {
      setDeletingTemplateName(null);
    }
  };

  const handleUpdateTemplate = async (name: string) => {
    const tpl = serverTemplates.find((template) => template.name === name);
    if (!tpl) return;
    setUpdatingTemplateName(name);
    try {
      await updateRecordTemplate(tpl.id, { content: inputContent });
      toast.success(`模板「${name}」已更新`);
      fetchTemplates(recordType as RecordTemplateType);
    } catch {
      toast.error('更新模板失敗，請稍後再試');
    } finally {
      setUpdatingTemplateName(null);
    }
  };

  /* -------- derived -------- */

  const config = RECORD_TYPE_CONFIG[recordType];
  const Icon = config.icon;
  const canCopy = (polishedContent || inputContent).trim().length > 0;
  const editableSelectedTemplate = serverTemplates.find(
    (t) => t.name === selectedTemplate && t.canEdit,
  );
  const templateDirty =
    !!selectedTemplate &&
    !!editableSelectedTemplate &&
    inputContent.trim() !== '' &&
    inputContent !== allTemplates[selectedTemplate];

  /* -------- render -------- */

  return (
    <div className="space-y-4">
      {/* Top bar: type chips + template popover + history trigger */}
      <div className="flex flex-wrap items-center gap-2">
        {RECORD_TYPES.map((type) => {
          const TypeIcon = RECORD_TYPE_CONFIG[type].icon;
          const active = recordType === type;
          const draftLen = drafts[type].input.length;
          return (
            <Button
              key={type}
              variant="outline"
              size="sm"
              className="transition-colors"
              style={
                active
                  ? { backgroundColor: '#1e293b', color: '#fff', borderColor: '#1e293b' }
                  : undefined
              }
              onClick={() => {
                setRecordType(type);
                setSelectedTemplate('');
                setRefinementOpen(false);
                setRefinementInstruction('');
              }}
            >
              <TypeIcon className="mr-1.5 h-4 w-4" />
              {RECORD_TYPE_CONFIG[type].label}
              {draftLen > 0 && !active && (
                <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
              )}
            </Button>
          );
        })}

        <div className="ml-auto flex items-center gap-2">
          {/* Templates popover */}
          <Popover open={templatePopoverOpen} onOpenChange={setTemplatePopoverOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-background px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground dark:border-slate-700 dark:bg-input/30 dark:hover:bg-input/50"
              >
                <Sparkles className="h-4 w-4" />
                模板
                {selectedTemplate && (
                  <Badge variant="secondary" className="ml-1 max-w-[120px] truncate">
                    {selectedTemplate}
                  </Badge>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-3" align="end">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    選擇模板
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setShowNewTemplate((v) => !v)}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    新增
                  </Button>
                </div>

                <div className="max-h-60 space-y-1 overflow-auto pr-1">
                  <div className="px-1 text-[11px] uppercase tracking-wide text-slate-400">內建</div>
                  {Object.keys(BUILTIN_TEMPLATES[recordType]).map((name) => (
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
                      onClick={() => handleApplyTemplate(name)}
                    >
                      {name}
                    </Button>
                  ))}

                  {serverTemplates.length > 0 && (
                    <>
                      <div className="mt-2 px-1 text-[11px] uppercase tracking-wide text-slate-400">
                        自訂
                      </div>
                      {serverTemplates.map((t) => (
                        <div key={t.id} className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className={`h-auto flex-1 justify-start py-1.5 text-left text-sm ${
                              selectedTemplate === t.name
                                ? 'bg-slate-100 dark:bg-slate-800'
                                : ''
                            }`}
                            onClick={() => handleApplyTemplate(t.name)}
                          >
                            {t.name}
                          </Button>
                          {t.canDelete && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 shrink-0 p-0 text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                              disabled={deletingTemplateName === t.name}
                              onClick={() => void handleDeleteTemplate(t.name)}
                              title={`刪除「${t.name}」`}
                            >
                              {deletingTemplateName === t.name ? (
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

                {templateDirty && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full border-blue-300 text-blue-600 hover:bg-blue-50"
                    disabled={updatingTemplateName === selectedTemplate}
                    onClick={() => void handleUpdateTemplate(selectedTemplate)}
                  >
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                    將目前草稿覆蓋模板「{selectedTemplate}」
                    {updatingTemplateName === selectedTemplate ? (
                      <ButtonLoadingIndicator />
                    ) : null}
                  </Button>
                )}

                {showNewTemplate && (
                  <div className="space-y-2 rounded-md border border-dashed border-slate-300 p-2 dark:border-slate-600">
                    <input
                      type="text"
                      placeholder="模板名稱"
                      value={newTemplateName}
                      onChange={(e) => setNewTemplateName(e.target.value)}
                      className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                    />
                    <Textarea
                      placeholder="模板內容（用 ___ 表示待填空位）"
                      value={newTemplateContent}
                      onChange={(e) => setNewTemplateContent(e.target.value)}
                      className="min-h-[80px] text-sm"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleSaveAsTemplate}
                        disabled={isSavingTemplate}
                      >
                        <span>{isSavingTemplate ? '處理中' : '儲存'}</span>
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
                        取消
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>

        </div>
      </div>

      {!canPolish && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
          {polishReason}
        </div>
      )}

      {/* Side-by-side: 草稿 | AI 修飾 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Left: 草稿 */}
        <Card className="flex flex-col border-slate-300 dark:border-slate-600">
          <CardHeader className="bg-slate-50 py-3 dark:bg-slate-800">
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon className="h-4 w-4" />
              你的草稿
            </CardTitle>
            <CardDescription className="text-xs">{config.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3 pt-4">
            <Textarea
              value={inputContent}
              onChange={(e) => setInputContent(e.target.value)}
              placeholder={config.placeholder}
              className="min-h-[280px] flex-1 resize-none border-slate-300 dark:border-slate-600"
            />
            <div className="flex items-center gap-2">
              <Button
                onClick={handlePolishContent}
                disabled={isPolishing || !inputContent.trim() || !canPolish}
                style={{ backgroundColor: '#1e293b' }}
                className="flex-1"
                title={!canPolish ? polishReason : undefined}
              >
                <Brain className="mr-2 h-4 w-4" />
                <span>{isPolishing ? 'AI 修飾中...' : config.polishLabel}</span>
                <ArrowRight className="ml-2 h-4 w-4" />
                {isPolishing ? <ButtonLoadingIndicator /> : null}
              </Button>
              {(inputContent || polishedContent) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearDraft}
                  title="清空草稿"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            {selectedTemplate && (
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>
                  已套用模板：
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {selectedTemplate}
                  </span>
                </span>
                <button
                  className="hover:text-slate-700 dark:hover:text-slate-200"
                  onClick={() => setSelectedTemplate('')}
                >
                  取消套用
                </button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: AI 修飾後 */}
        <Card className="flex flex-col border-slate-300 dark:border-slate-600">
          <CardHeader className="bg-slate-50 py-3 dark:bg-slate-800">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4" />
              AI 修飾後
              {polishedContent && (
                <Badge variant="secondary" className="text-[10px]">
                  可直接修改
                </Badge>
              )}
              {isPolishedStale && (
                <Badge
                  variant="secondary"
                  className="bg-amber-100 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                >
                  草稿已變動
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="text-xs">
              {polishedContent
                ? '可直接修改後按「複製貼到 HIS」'
                : '按左側的「AI 修飾」生成結果'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3 pt-4">
            <Textarea
              value={polishedContent}
              onChange={(e) => setPolishedContent(e.target.value)}
              placeholder="（尚未生成）"
              className="min-h-[280px] flex-1 resize-none border-slate-300 font-mono text-sm dark:border-slate-600"
            />
            <Button
              onClick={handleCopy}
              disabled={!canCopy}
              className="w-full bg-brand hover:bg-brand-hover"
            >
              <Copy className="mr-2 h-4 w-4" />
              複製貼到 HIS
            </Button>

            {polishedContent && !isPolishedStale && (
              <div className="rounded-md border border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setRefinementOpen((v) => !v)}
                  className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Wand2 className="h-3.5 w-3.5" />
                    想再調整嗎？
                  </span>
                  {refinementOpen ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>
                {refinementOpen && (
                  <div className="space-y-2 border-t border-slate-200 p-3 dark:border-slate-700">
                    <Textarea
                      value={refinementInstruction}
                      onChange={(e) => setRefinementInstruction(e.target.value)}
                      placeholder="例如：再簡短一點 / 把劑量細節拿掉 / 用條列式 / 加上腎功能調整的理由"
                      className="min-h-[60px] resize-none border-slate-300 text-sm dark:border-slate-600"
                      disabled={isRefining}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !isRefining) {
                          e.preventDefault();
                          void handleRefine();
                        }
                      }}
                    />
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] text-slate-400">
                        修改後會覆蓋上方結果 · ⌘/Ctrl + Enter 送出
                      </p>
                      <Button
                        onClick={handleRefine}
                        disabled={isRefining || !refinementInstruction.trim()}
                        size="sm"
                        variant="outline"
                      >
                        <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                        {isRefining ? '修改中...' : '再修一次'}
                        {isRefining ? <ButtonLoadingIndicator /> : null}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

