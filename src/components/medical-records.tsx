import { useState, useEffect } from 'react';
import { getReadinessReason, polishClinicalText, type AIReadiness } from '../lib/api/ai';
import { sendMessage } from '../lib/api/messages';
import { copyToClipboard } from '../lib/clipboard-utils';
import { useAuth } from '../lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { Label } from './ui/label';
import { AiMarkdown } from './ui/ai-markdown';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import {
  FileText,
  Pill,
  ClipboardList,
  Brain,
  Copy,
  Download,
  Calendar,
  Send,
  Sparkles,
  Plus,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

interface MedicalRecordsProps {
  patientId: string;
  patientName: string;
  aiReadiness?: AIReadiness | null;
}

interface MedicalRecord {
  id: string;
  type: 'progress-note' | 'medication-advice' | 'nursing-record';
  date: string;
  author: string;
  content: string;
  polishedContent?: string;
}

type RecordType = 'progress-note' | 'medication-advice' | 'nursing-record';

const RECORD_TYPE_CONFIG: Record<RecordType, { label: string; icon: typeof FileText; description: string; placeholder: string; polishLabel: string }> = {
  'progress-note': {
    label: 'Progress Note',
    icon: FileText,
    description: '可以使用中文或不完整的英文描述，AI 會協助修飾為專業的 Progress Note 格式',
    placeholder: '例如：病人今天意識清楚，血壓穩定，繼續使用呼吸器...',
    polishLabel: 'AI 修飾 Progress Note',
  },
  'medication-advice': {
    label: '用藥建議',
    icon: Pill,
    description: '輸入建議草稿，AI 會協助修飾為專業的用藥建議格式',
    placeholder: '例如：建議調整 Morphine 劑量因為腎功能不全，同時注意監測呼吸抑制...',
    polishLabel: 'AI 修飾用藥建議',
  },
  'nursing-record': {
    label: '護理記錄',
    icon: ClipboardList,
    description: '使用模板快速建立記錄，AI 會協助檢查錯字並整理格式',
    placeholder: '填寫護理記錄或使用上方模板...',
    polishLabel: 'AI 檢查錯字與格式',
  },
};

const STORAGE_KEY = 'chaticu-record-templates';
const RECORDS_STORAGE_KEY = 'chaticu-medical-records';

function loadRecords(patientId: string): MedicalRecord[] {
  try {
    const saved = localStorage.getItem(`${RECORDS_STORAGE_KEY}-${patientId}`);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function saveRecords(patientId: string, records: MedicalRecord[]) {
  localStorage.setItem(`${RECORDS_STORAGE_KEY}-${patientId}`, JSON.stringify(records));
}

function loadCustomTemplates(): Record<RecordType, Record<string, string>> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : { 'progress-note': {}, 'medication-advice': {}, 'nursing-record': {} };
  } catch {
    return { 'progress-note': {}, 'medication-advice': {}, 'nursing-record': {} };
  }
}

function saveCustomTemplates(templates: Record<RecordType, Record<string, string>>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

const BUILTIN_TEMPLATES: Record<RecordType, Record<string, string>> = {
  'progress-note': {
    'SOAP 格式': `S (Subjective): ___
O (Objective):
  Vitals: BP ___ / ___ mmHg, HR ___ bpm, RR ___ rpm, T ___ °C
  Labs: ___
  Physical exam: ___
A (Assessment): ___
P (Plan): ___`,
    '簡要紀錄': `主訴: ___
目前狀況: ___
處置計畫: ___`,
  },
  'medication-advice': {
    '劑量調整建議': `藥品名稱: ___
目前劑量: ___
建議調整: ___
調整原因: ___
監測項目: ___`,
    '新增藥品建議': `建議藥品: ___
適應症: ___
建議劑量: ___
給藥途徑: ___
注意事項: ___`,
  },
  'nursing-record': {
    '一般交班': `病患意識: ___
生命徵象: BP ___ / ___ mmHg, HR ___ bpm, RR ___ rpm, T ___ °C
呼吸器設定: Mode ___, FiO2 ___ %, PEEP ___ cmH2O
管路: ___ (位置、狀況)
輸液: ___ ml/hr
尿量: ___ ml/8hr
特殊狀況: ___`,
    '鎮靜評估': `RASS Score: ___
CAM-ICU: Positive / Negative
使用鎮靜劑: ___
劑量調整: ___
呼吸型態: ___
建議: ___`,
    '管路評估': `氣管內管: ___ cm (固定位置)
中心靜脈導管: ___ (位置、天數)
動脈導管: ___ (位置、天數)
尿管: ___ (尿液顏色、量)
鼻胃管: ___ (位置、引流量)
其他管路: ___`,
    '傷口護理': `傷口位置: ___
傷口大小: ___ cm x ___ cm
傷口深度: ___
滲液: 有 / 無 (量: ___, 顏色: ___)
紅腫熱痛: ___
換藥頻率: ___
使用敷料: ___`,
  },
};

export function MedicalRecords({ patientId, patientName, aiReadiness = null }: MedicalRecordsProps) {
  const { user } = useAuth();
  const canPolish = aiReadiness ? aiReadiness.feature_gates.clinical_polish : true;
  const polishReason = getReadinessReason(aiReadiness, 'clinical_polish');

  const getDefaultRecordType = (): RecordType => {
    if (user?.role === 'pharmacist') return 'medication-advice';
    if (user?.role === 'nurse') return 'nursing-record';
    return 'progress-note';
  };

  const [recordType, setRecordType] = useState<RecordType>(getDefaultRecordType());
  const [inputContent, setInputContent] = useState('');
  const [polishedContent, setPolishedContent] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [isPolishing, setIsPolishing] = useState(false);
  const [records, setRecords] = useState<MedicalRecord[]>(() => loadRecords(patientId));

  // Custom templates
  const [customTemplates, setCustomTemplates] = useState(loadCustomTemplates);
  const [showNewTemplate, setShowNewTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateContent, setNewTemplateContent] = useState('');

  useEffect(() => {
    saveCustomTemplates(customTemplates);
  }, [customTemplates]);

  useEffect(() => {
    saveRecords(patientId, records);
  }, [patientId, records]);

  const allTemplates = {
    ...BUILTIN_TEMPLATES[recordType],
    ...customTemplates[recordType],
  };

  const handlePolishContent = async () => {
    if (!inputContent.trim()) return;
    if (!canPolish) {
      toast.error(polishReason);
      return;
    }
    setIsPolishing(true);
    try {
      const polishTypeMap: Record<string, 'progress_note' | 'medication_advice' | 'nursing_record'> = {
        'progress-note': 'progress_note',
        'medication-advice': 'medication_advice',
        'nursing-record': 'nursing_record',
      };
      const result = await polishClinicalText({
        patientId,
        content: inputContent,
        polishType: polishTypeMap[recordType],
      });
      setPolishedContent(result.polished);
    } catch {
      toast.error('AI 修飾失敗，請稍後再試');
    } finally {
      setIsPolishing(false);
    }
  };

  const handleSaveRecord = async () => {
    const contentToSave = polishedContent || inputContent;
    const authorName = user?.name || user?.username || '未知';

    try {
      await sendMessage(patientId, {
        content: contentToSave,
        messageType: recordType,
      });

      const newRecord: MedicalRecord = {
        id: Date.now().toString(),
        type: recordType,
        date: new Date().toLocaleString('zh-TW'),
        author: authorName,
        content: inputContent,
        polishedContent: polishedContent || undefined,
      };

      setRecords([newRecord, ...records]);
      setInputContent('');
      setPolishedContent('');
      toast.success('病歷記錄已儲存！');
    } catch {
      toast.error('儲存病歷記錄失敗，請稍後再試');
    }
  };

  const handleSaveAsTemplate = () => {
    const name = newTemplateName.trim();
    if (!name) { toast.error('請輸入模板名稱'); return; }
    if (!newTemplateContent.trim()) { toast.error('請輸入模板內容'); return; }
    if (name in BUILTIN_TEMPLATES[recordType]) { toast.error(`「${name}」與內建模板名稱重複，請使用其他名稱`); return; }
    setCustomTemplates((prev) => ({
      ...prev,
      [recordType]: { ...prev[recordType], [name]: newTemplateContent },
    }));
    setNewTemplateName('');
    setNewTemplateContent('');
    setShowNewTemplate(false);
    toast.success(`模板「${name}」已儲存`);
  };

  const handleDeleteTemplate = (name: string) => {
    setCustomTemplates((prev) => {
      const copy = { ...prev[recordType] };
      delete copy[name];
      return { ...prev, [recordType]: copy };
    });
    if (selectedTemplate === name) setSelectedTemplate('');
    toast.success(`模板「${name}」已刪除`);
  };

  const config = RECORD_TYPE_CONFIG[recordType];
  const Icon = config.icon;

  const getRecordTypeLabel = (type: string) => RECORD_TYPE_CONFIG[type as RecordType]?.label || type;

  const getFilteredRecords = () => {
    if (user?.role === 'admin') return records;
    if (user?.role === 'pharmacist') return records.filter((r) => r.type === 'medication-advice');
    if (user?.role === 'nurse') return records.filter((r) => r.type === 'nursing-record');
    return records.filter((r) => r.type === 'progress-note');
  };

  const filteredRecords = getFilteredRecords();
  const customTemplateNames = Object.keys(customTemplates[recordType]);

  return (
    <div className="space-y-6">
      {/* 記錄類型選擇 */}
      <Card className="border-slate-300">
        <CardHeader className="bg-slate-50">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-6 w-6 text-slate-700" />
            新增病歷記錄
          </CardTitle>
          <CardDescription>{config.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canPolish && (
            <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {polishReason}
            </div>
          )}

          {/* 記錄類型選擇器 */}
          <div className="grid grid-cols-3 gap-3">
            {(Object.keys(RECORD_TYPE_CONFIG) as RecordType[]).map((type) => {
              const TypeIcon = RECORD_TYPE_CONFIG[type].icon;
              return (
                <Button
                  key={type}
                  variant="outline"
                  className="transition-colors"
                  style={recordType === type ? { backgroundColor: '#1e293b', color: '#fff', borderColor: '#1e293b' } : undefined}
                  onClick={() => { setRecordType(type); setSelectedTemplate(''); setInputContent(''); setPolishedContent(''); }}
                >
                  <TypeIcon className="mr-2 h-5 w-5" />
                  {RECORD_TYPE_CONFIG[type].label}
                </Button>
              );
            })}
          </div>
          <Separator />

          {/* 統一表單 */}
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start gap-3 mb-3">
                <Icon className="h-6 w-6 text-slate-700 mt-1" />
                <div>
                  <h3 className="font-semibold text-slate-900">{config.label} 輔助</h3>
                  <p className="text-sm text-slate-600 mt-1">{config.description}</p>
                </div>
              </div>

              <div className="space-y-3">
                {/* 模板選擇 */}
                <div>
                  <Label>選擇模板（可選）</Label>
                  <div className="flex items-center gap-2 mt-2">
                    <Select value={selectedTemplate} onValueChange={(value) => {
                      if (inputContent.trim() && !confirm('目前已有輸入內容，選擇模板將會取代。確定要繼續嗎？')) return;
                      setSelectedTemplate(value);
                      setInputContent(allTemplates[value] || '');
                    }}>
                      <SelectTrigger className="border-slate-300">
                        <SelectValue placeholder="請選擇記錄模板" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.keys(BUILTIN_TEMPLATES[recordType]).map((name) => (
                          <SelectItem key={name} value={name}>{name}</SelectItem>
                        ))}
                        {customTemplateNames.length > 0 && (
                          <>
                            <div className="px-2 py-1.5 text-xs font-semibold text-slate-500 border-t mt-1 pt-2">自訂模板</div>
                            {customTemplateNames.map((name) => (
                              <SelectItem key={`custom-${name}`} value={name}>{name}</SelectItem>
                            ))}
                          </>
                        )}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => setShowNewTemplate(!showNewTemplate)}
                      title="新增自訂模板"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* 新增模板面板（獨立區塊） */}
                {showNewTemplate && (
                  <div className="rounded-md border border-dashed border-slate-300 bg-white p-3 space-y-2">
                    <p className="text-sm font-semibold text-slate-700">建立自訂模板</p>
                    <input
                      type="text"
                      placeholder="模板名稱"
                      value={newTemplateName}
                      onChange={(e) => setNewTemplateName(e.target.value)}
                      className="w-full h-9 rounded-md border border-slate-300 px-3 text-sm"
                    />
                    <Textarea
                      placeholder="模板內容（欄位用 ___ 表示待填空位）"
                      value={newTemplateContent}
                      onChange={(e) => setNewTemplateContent(e.target.value)}
                      className="min-h-[100px] border-slate-300"
                    />
                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={handleSaveAsTemplate}>儲存模板</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setShowNewTemplate(false); setNewTemplateName(''); setNewTemplateContent(''); }}>取消</Button>
                    </div>
                    {customTemplateNames.length > 0 && (
                      <div className="border-t border-slate-200 pt-2 mt-1">
                        <p className="text-xs text-slate-500 mb-1">已建立的自訂模板</p>
                        <div className="flex flex-wrap gap-1.5">
                          {customTemplateNames.map((name) => (
                            <span key={name} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">
                              {name}
                              <button
                                type="button"
                                className="ml-0.5 text-slate-400 hover:text-red-500 transition-colors"
                                onClick={() => handleDeleteTemplate(name)}
                                title={`刪除模板「${name}」`}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 輸入區 */}
                <div>
                  <Label>輸入內容</Label>
                  <Textarea
                    placeholder={config.placeholder}
                    value={inputContent}
                    onChange={(e) => setInputContent(e.target.value)}
                    className="min-h-[150px] mt-2 border-slate-300"
                  />
                </div>

                {/* AI 修飾 */}
                <div>
                  <Button
                    onClick={handlePolishContent}
                    style={{ backgroundColor: '#1e293b' }}
                    disabled={isPolishing || !inputContent.trim() || !canPolish}
                  >
                    <Brain className="mr-2 h-5 w-5" />
                    {isPolishing ? 'AI 修飾中...' : config.polishLabel}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* 顯示修飾後的內容 */}
          {polishedContent && (
            <div className="space-y-3">
              <Separator />
              <div>
                <Label className="text-lg">
                  {recordType === 'progress-note' && '修飾後的 Progress Note'}
                  {recordType === 'medication-advice' && '修飾後的用藥建議'}
                  {recordType === 'nursing-record' && '檢查後的護理記錄'}
                </Label>
                <div className="mt-2 rounded-lg border border-slate-300 bg-slate-50 p-4">
                  <AiMarkdown content={polishedContent} className="text-sm" />
                </div>

                <div className="flex gap-2 mt-3">
                  <Button
                    variant="outline"
                    onClick={async () => {
                      const success = await copyToClipboard(polishedContent);
                      success ? toast.success('已複製到剪貼簿') : toast.error('複製失敗，請手動複製');
                    }}
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    複製
                  </Button>
                  <Button
                    onClick={handleSaveRecord}
                    className="bg-[var(--color-brand)] hover:bg-[var(--color-brand-hover)]"
                  >
                    <Send className="mr-2 h-4 w-4" />
                    儲存記錄
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const exportData = {
                        patient_id: patientId,
                        patient_name: patientName,
                        record_type: recordType,
                        content: polishedContent,
                        created_at: new Date().toISOString(),
                        created_by: user?.name || '',
                        role: user?.role || '',
                      };
                      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${patientId}_${recordType}_${new Date().toISOString().slice(0, 10)}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                      toast.success('已匯出 JSON 檔案');
                    }}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    匯出 JSON
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 歷史記錄 */}
      <Card>
        <CardHeader className="bg-slate-50">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-6 w-6 text-slate-700" />
            病歷記錄歷史
          </CardTitle>
          <CardDescription>
            {patientName} 的所有病歷記錄
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {filteredRecords.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <FileText className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">尚無病歷記錄</p>
            </div>
          ) : (
            filteredRecords.map((record) => (
              <Card key={record.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-slate-100 text-slate-800 border border-slate-200">
                        {getRecordTypeLabel(record.type)}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {record.author} · {record.date}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => copyToClipboard(record.polishedContent || record.content)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const exportData = {
                            patient_id: patientId,
                            patient_name: patientName,
                            record_type: record.type,
                            content: record.polishedContent || record.content,
                            created_at: record.date,
                            created_by: record.author,
                          };
                          const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `${patientId}_${record.type}_${record.id}.json`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="bg-slate-50 p-3 rounded-lg">
                    <AiMarkdown content={record.polishedContent || record.content} className="text-sm" />
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
