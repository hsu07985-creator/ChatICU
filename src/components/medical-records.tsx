import { useState } from 'react';
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
  Sparkles
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

export function MedicalRecords({ patientId, patientName, aiReadiness = null }: MedicalRecordsProps) {
  const { user } = useAuth();
  const canPolish = aiReadiness ? aiReadiness.feature_gates.clinical_polish : true;
  const polishReason = getReadinessReason(aiReadiness, 'clinical_polish');
  
  // 根據角色設定預設記錄類型
  const getDefaultRecordType = (): 'progress-note' | 'medication-advice' | 'nursing-record' => {
    if (user?.role === 'pharmacist') return 'medication-advice';
    if (user?.role === 'nurse') return 'nursing-record';
    return 'progress-note'; // doctor, admin
  };
  
  const [recordType, setRecordType] = useState<'progress-note' | 'medication-advice' | 'nursing-record'>(getDefaultRecordType());
  const [inputContent, setInputContent] = useState('');
  const [polishedContent, setPolishedContent] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  
  const [isPolishing, setIsPolishing] = useState(false);

  // 儲存的病歷記錄
  const [records, setRecords] = useState<MedicalRecord[]>([]);

  // 護理記錄模板
  const nursingTemplates = {
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
使用敷料: ___`
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
        polishedContent: polishedContent || undefined
      };

      setRecords([newRecord, ...records]);
      setInputContent('');
      setPolishedContent('');
      toast.success('病歷記錄已儲存！');
    } catch {
      toast.error('儲存病歷記錄失敗，請稍後再試');
    }
  };

  const applyTemplate = (template: string) => {
    setInputContent(nursingTemplates[template as keyof typeof nursingTemplates] || '');
  };

  const getRecordTypeLabel = (type: string) => {
    switch (type) {
      case 'progress-note': return 'Progress Note';
      case 'medication-advice': return '用藥建議';
      case 'nursing-record': return '護理記錄';
      default: return type;
    }
  };

  const getRecordTypeColor = (type: string) => {
    switch (type) {
      case 'progress-note': return 'bg-blue-100 text-blue-800';
      case 'medication-advice': return 'bg-green-100 text-green-800';
      case 'nursing-record': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // 根據角色過濾顯示的記錄
  const getFilteredRecords = () => {
    if (user?.role === 'admin') {
      return records; // 管理者可以看到所有類型
    }
    
    if (user?.role === 'pharmacist') {
      return records.filter(r => r.type === 'medication-advice');
    }
    
    if (user?.role === 'nurse') {
      return records.filter(r => r.type === 'nursing-record');
    }
    
    // doctor 和其他角色只看 progress-note
    return records.filter(r => r.type === 'progress-note');
  };

  const filteredRecords = getFilteredRecords();

  return (
    <div className="space-y-6">
      {/* 記錄類型選擇 */}
      <Card className="border-[#7f265b]">
        <CardHeader className="bg-[#f8f9fa]">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-6 w-6 text-[#7f265b]" />
            新增病歷記錄
          </CardTitle>
          <CardDescription>
            {user?.role === 'pharmacist' && '撰寫用藥建議並使用 AI 協助修飾'}
            {user?.role === 'nurse' && '撰寫護理記錄並使用 AI 協助檢查'}
            {(user?.role === 'doctor' || user?.role === 'admin') && '撰寫 Progress Note 並使用 AI 協助修飾'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canPolish && (
            <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {polishReason}
            </div>
          )}
          {/* 記錄類型選擇器 - 只在管理者時顯示 */}
          {user?.role === 'admin' && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Button
                  variant={recordType === 'progress-note' ? 'default' : 'outline'}
                  className={recordType === 'progress-note' ? 'bg-blue-600 hover:bg-blue-700' : ''}
                  onClick={() => setRecordType('progress-note')}
                >
                  <FileText className="mr-2 h-5 w-5" />
                  Progress Note
                </Button>
                
                <Button
                  variant={recordType === 'medication-advice' ? 'default' : 'outline'}
                  className={recordType === 'medication-advice' ? 'bg-green-600 hover:bg-green-700' : ''}
                  onClick={() => setRecordType('medication-advice')}
                >
                  <Pill className="mr-2 h-5 w-5" />
                  用藥建議
                </Button>
                
                <Button
                  variant={recordType === 'nursing-record' ? 'default' : 'outline'}
                  className={recordType === 'nursing-record' ? 'bg-purple-600 hover:bg-purple-700' : ''}
                  onClick={() => setRecordType('nursing-record')}
                >
                  <ClipboardList className="mr-2 h-5 w-5" />
                  護理記錄
                </Button>
              </div>

              <Separator />
            </>
          )}
          
          {/* Progress Note 表單 */}
          {recordType === 'progress-note' && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-3 mb-3">
                  <FileText className="h-6 w-6 text-blue-600 mt-1" />
                  <div>
                    <h3 className="font-semibold text-blue-900">Progress Note 輔助</h3>
                    <p className="text-sm text-blue-700 mt-1">
                      可以使用中文或不完整的英文描述，AI 會協助修飾為專業的 Progress Note 格式
                    </p>
                  </div>
                </div>
                
                <div className="space-y-3">
                  <div>
                    <Label>輸入草稿或中文描述</Label>
                    <Textarea
                      placeholder="例如：病人今天意識清楚，血壓穩定，繼續使用呼吸器..."
                      value={inputContent}
                      onChange={(e) => setInputContent(e.target.value)}
                      className="min-h-[150px] mt-2 border border-blue-300"
                    />
                  </div>
                  
                  <Button
                    onClick={handlePolishContent}
                    className="bg-blue-600 hover:bg-blue-700"
                    disabled={isPolishing || !inputContent.trim() || !canPolish}
                  >
                    <Brain className="mr-2 h-5 w-5" />
                    {isPolishing ? 'AI 修飾中...' : 'AI 修飾 Progress Note'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* 用藥建議表單 */}
          {recordType === 'medication-advice' && (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-start gap-3 mb-3">
                  <Pill className="h-6 w-6 text-green-600 mt-1" />
                  <div>
                    <h3 className="font-semibold text-green-900">用藥建議修飾</h3>
                    <p className="text-sm text-green-700 mt-1">
                      輸入建議草稿，AI 會協助修飾為專業的用藥建議格式
                    </p>
                  </div>
                </div>
                
                <div className="space-y-3">
                  <div>
                    <Label>輸入用藥建議草稿</Label>
                    <Textarea
                      placeholder="例如：建議調整 Morphine 劑量因為腎功能不全，同時注意監測呼吸抑制..."
                      value={inputContent}
                      onChange={(e) => setInputContent(e.target.value)}
                      className="min-h-[150px] mt-2 border border-green-300"
                    />
                  </div>
                  
                  <Button
                    onClick={handlePolishContent}
                    className="bg-green-600 hover:bg-green-700"
                    disabled={isPolishing || !inputContent.trim() || !canPolish}
                  >
                    <Brain className="mr-2 h-5 w-5" />
                    {isPolishing ? 'AI 修飾中...' : 'AI 修飾用藥建議'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* 護理記錄表單 */}
          {recordType === 'nursing-record' && (
            <div className="space-y-4">
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <div className="flex items-start gap-3 mb-3">
                  <ClipboardList className="h-6 w-6 text-purple-600 mt-1" />
                  <div>
                    <h3 className="font-semibold text-purple-900">護理記錄輔助</h3>
                    <p className="text-sm text-purple-700 mt-1">
                      使用模板快速建立記錄，AI 會協助檢查錯字並整理格式
                    </p>
                  </div>
                </div>
                
                <div className="space-y-3">
                  <div>
                    <Label>選擇模板（可選）</Label>
                    <Select value={selectedTemplate} onValueChange={(value) => {
                      setSelectedTemplate(value);
                      applyTemplate(value);
                    }}>
                      <SelectTrigger className="mt-2 border border-purple-300">
                        <SelectValue placeholder="請選擇記錄模板" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="一般交班">一般交班記錄</SelectItem>
                        <SelectItem value="鎮靜評估">鎮靜評估記錄</SelectItem>
                        <SelectItem value="管路評估">管路評估記錄</SelectItem>
                        <SelectItem value="傷口護理">傷口護理記錄</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <Label>護理記錄內容</Label>
                    <Textarea
                      placeholder="填寫護理記錄或使用上方模板..."
                      value={inputContent}
                      onChange={(e) => setInputContent(e.target.value)}
                      className="min-h-[200px] mt-2 border border-purple-300 font-mono"
                    />
                  </div>
                  
                  <Button
                    onClick={handlePolishContent}
                    className="bg-purple-600 hover:bg-purple-700"
                    disabled={isPolishing || !inputContent.trim() || !canPolish}
                  >
                    <Sparkles className="mr-2 h-5 w-5" />
                    {isPolishing ? 'AI 檢查中...' : 'AI 檢查錯字與格式'}
                  </Button>
                </div>
              </div>
            </div>
          )}

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
                <div className={`mt-2 p-4 rounded-lg border ${
                  recordType === 'progress-note' ? 'bg-blue-50 border-blue-300' :
                  recordType === 'medication-advice' ? 'bg-green-50 border-green-300' :
                  'bg-purple-50 border-purple-300'
                }`}>
                  <AiMarkdown content={polishedContent} className="text-sm" />
                </div>
                
                <div className="flex gap-2 mt-3">
                  <Button 
                    variant="outline"
                    onClick={async () => {
                      const success = await copyToClipboard(polishedContent);
                      if (success) {
                        toast.success('已複製到剪貼簿');
                      } else {
                        toast.error('複製失敗，請手動複製');
                      }
                    }}
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    複製
                  </Button>
                  <Button 
                    onClick={handleSaveRecord}
                    className="bg-[#7f265b] hover:bg-[#631e4d]"
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
        <CardHeader className="bg-[#f8f9fa]">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-6 w-6 text-[#7f265b]" />
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
                      <Badge className={getRecordTypeColor(record.type)}>
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
                  <div className="bg-[#f8f9fa] p-3 rounded-lg">
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
