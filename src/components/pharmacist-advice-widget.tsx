import { useState } from 'react';
import { copyToClipboard } from '../lib/clipboard-utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { toast } from 'sonner';
import { 
  Pill, 
  Brain, 
  Copy, 
  Download, 
  Send,
  CheckCircle2,
  AlertTriangle,
  Info,
  XCircle
} from 'lucide-react';

interface PharmacistAdviceWidgetProps {
  patientId: string;
  patientName: string;
  linkedMedication?: string;
  onSendToNotes?: (content: string, category: string, code: string) => void;
}

// 藥師建議分類定義（四大類）
const adviceCategories = {
  prescription: {
    label: '1. 建議處方',
    color: 'bg-purple-100 border-purple-300 hover:bg-purple-200',
    activeColor: 'bg-[#7f265b] text-white',
    icon: Pill,
    iconColor: 'text-[#7f265b]',
    codes: [
      { code: '1-1', label: '建議更適當用藥/配方組成' },
      { code: '1-2', label: '用藥途徑或劑型問題' },
      { code: '1-3', label: '用藥期間/數量問題（包含停藥）' },
      { code: '1-4', label: '用藥劑量/頻次問題' },
      { code: '1-5', label: '不符健保給付規定' },
      { code: '1-6', label: '其他' },
      { code: '1-7', label: '藥品相容性問題' },
      { code: '1-8', label: '疑似藥品不良反應' },
      { code: '1-9', label: '藥品交互作用' },
      { code: '1-10', label: '藥品併用問題' },
      { code: '1-11', label: '用藥替急問題（包括過敏史）' },
      { code: '1-12', label: '適應症問題' },
      { code: '1-13', label: '給藥問題（途徑、輸注方式、濃度或稀釋液）' }
    ]
  },
  proactive: {
    label: '2. 主動建議',
    color: 'bg-orange-100 border-orange-300 hover:bg-orange-200',
    activeColor: 'bg-orange-600 text-white',
    icon: AlertTriangle,
    iconColor: 'text-orange-600',
    codes: [
      { code: '2-1', label: '建議靜脈營養配方' },
      { code: '2-2', label: '建議藥物治療療程' },
      { code: '2-3', label: '建議用藥/建議增加用藥' },
      { code: '2-4', label: '藥品不良反應評估' }
    ]
  },
  monitoring: {
    label: '3. 建議監測',
    color: 'bg-gray-100 border-gray-300 hover:bg-gray-200',
    activeColor: 'bg-gray-700 text-white',
    icon: Info,
    iconColor: 'text-gray-700',
    codes: [
      { code: '3-1', label: '建議藥品由中適度監測' },
      { code: '3-2', label: '建議藥品不良反應監測' },
      { code: '3-3', label: '建議藥品療效監測' }
    ]
  },
  appropriateness: {
    label: '4. 用藥適真性',
    color: 'bg-blue-100 border-blue-300 hover:bg-blue-200',
    activeColor: 'bg-blue-600 text-white',
    icon: CheckCircle2,
    iconColor: 'text-blue-600',
    codes: [
      { code: '4-1', label: '病人用藥適從性問題' },
      { code: '4-2', label: '藥品辨識/自備藥辨識' },
      { code: '4-3', label: '藥證查核與整合' }
    ]
  }
};

// A-W 回應代碼（醫師回應）
const responseCategories = {
  accept: {
    label: 'Accept 接受',
    color: 'bg-green-100 border-green-300 hover:bg-green-200',
    activeColor: 'bg-green-600 text-white',
    icon: CheckCircle2,
    iconColor: 'text-green-600',
    codes: [
      { code: 'A-AC', label: '接受並執行 (Accept and Comply)' },
      { code: 'A-N', label: '已知悉（備註）(Acknowledge with Note)' },
      { code: 'A-AS', label: '同意並停藥 (Accept and Stop)' }
    ]
  },
  warning: {
    label: 'Warning 警示',
    color: 'bg-yellow-100 border-yellow-300 hover:bg-yellow-200',
    activeColor: 'bg-yellow-600 text-white',
    icon: AlertTriangle,
    iconColor: 'text-yellow-600',
    codes: [
      { code: 'W-N', label: '已知悉 (Noted)' },
      { code: 'W-M', label: '監測中 (Monitoring)' },
      { code: 'W-A', label: '調整劑量 (Adjust)' },
      { code: 'W-S', label: '停藥 (Stop)' }
    ]
  },
  controversy: {
    label: 'Controversy 爭議',
    color: 'bg-blue-100 border-blue-300 hover:bg-blue-200',
    activeColor: 'bg-blue-600 text-white',
    icon: Info,
    iconColor: 'text-blue-600',
    codes: [
      { code: 'C-N', label: '已知悉 (Noted)' },
      { code: 'C-C', label: '繼續使用 (Continue)' },
      { code: 'C-M', label: '修改處方 (Modify)' }
    ]
  },
  adverse: {
    label: 'Adverse 不良回應',
    color: 'bg-red-100 border-red-300 hover:bg-red-200',
    activeColor: 'bg-red-600 text-white',
    icon: XCircle,
    iconColor: 'text-red-600',
    codes: [
      { code: 'N-N', label: '不回應 (No Response)' },
      { code: 'N-NI', label: '資訊不足 (Not enough Information)' },
      { code: 'N-R', label: '拒絕建議 (Reject)' }
    ]
  }
};

export function PharmacistAdviceWidget({ patientId, patientName, linkedMedication, onSendToNotes }: PharmacistAdviceWidgetProps) {
  const [adviceInput, setAdviceInput] = useState('');
  const [polishedAdvice, setPolishedAdvice] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<keyof typeof adviceCategories | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [selectedResponse, setSelectedResponse] = useState<keyof typeof responseCategories | null>(null);
  const [selectedResponseCode, setSelectedResponseCode] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const handlePolishAdvice = () => {
    if (!adviceInput.trim()) return;
    
    const polished = `Medication Recommendation for ${patientName}

Current Assessment:
${adviceInput}

Recommendation:
Based on current clinical status and laboratory findings, recommend adjusting medication regimen accordingly. Close monitoring of therapeutic effects and potential adverse reactions is advised.${linkedMedication ? `\n\nRegarding: ${linkedMedication}` : ''}

Please monitor renal function and adjust doses for renally cleared medications as appropriate.`;
    
    setPolishedAdvice(polished);
  };

  const handleSaveAdvice = () => {
    if (!polishedAdvice || !selectedCode || !selectedResponseCode) {
      alert('請先修飾建議內容並選擇分類代碼');
      return;
    }
    
    // 這裡會將建議儲存到資料庫
    console.log('儲存用藥建議:', {
      patientId,
      content: polishedAdvice,
      category: selectedCategory,
      code: selectedCode,
      linkedMedication
    });
    
    if (onSendToNotes) {
      onSendToNotes(polishedAdvice, selectedCategory!, selectedResponseCode);
    }
    
    setShowSuccess(true);
    setTimeout(() => {
      setShowSuccess(false);
      setAdviceInput('');
      setPolishedAdvice('');
      setSelectedCategory(null);
      setSelectedCode(null);
      setSelectedResponse(null);
      setSelectedResponseCode(null);
    }, 2000);
  };

  return (
    <Card className="border-2 border-green-600">
      <CardHeader className="bg-green-50 border-b-2 border-green-200">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl text-green-900">
              <Pill className="h-6 w-6 text-green-600" />
              藥師用藥建議
            </CardTitle>
            <CardDescription className="text-[15px] mt-2 text-green-700">
              撰寫用藥建議並標記分類，系統將自動記錄至統計資料
            </CardDescription>
          </div>
          {linkedMedication && (
            <Badge className="bg-green-600 text-white text-sm px-3 py-1.5">
              關聯藥品：{linkedMedication}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        {/* 輸入與修飾區 */}
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="font-semibold text-[#1a1a1a]">輸入用藥建議草稿（中文或英文）</label>
            <Textarea
              placeholder="例如：建議調整 Morphine 劑量因為腎功能不全（eGFR < 30），同時注意監測呼吸抑制..."
              value={adviceInput}
              onChange={(e) => setAdviceInput(e.target.value)}
              className="min-h-[120px] border-2 text-[16px]"
            />
            <Button 
              onClick={handlePolishAdvice}
              className="bg-green-600 hover:bg-green-700"
              disabled={!adviceInput.trim()}
            >
              <Brain className="mr-2 h-5 w-5" />
              AI 修飾 & 翻譯成英文
            </Button>
          </div>

          {polishedAdvice && (
            <>
              <Separator />
              <div className="space-y-3">
                <label className="font-semibold text-[#1a1a1a]">修飾後的用藥建議</label>
                <div className="bg-[#f8f9fa] border-2 border-green-600 rounded-lg p-4">
                  <pre className="whitespace-pre-wrap text-[15px] font-mono leading-relaxed">{polishedAdvice}</pre>
                </div>
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={async () => {
                      const success = await copyToClipboard(polishedAdvice);
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
                    size="sm"
                    className="bg-[#7f265b] hover:bg-[#6a1f4d]"
                    onClick={() => {
                      if (onSendToNotes) {
                        onSendToNotes(polishedAdvice, '藥師建議', selectedCode || '未分類');
                        alert('已成功連動到病患留言！');
                      } else {
                        alert('已複製到剪貼簿，可手動貼上到病患留言');
                        copyToClipboard(polishedAdvice);
                      }
                    }}
                  >
                    <Send className="mr-2 h-4 w-4" />
                    連動到病患留言
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* 分類選擇區 */}
        {polishedAdvice && (
          <>
            <Separator className="my-6" />
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-[18px] mb-2">選擇建議分類</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  步驟一：先選擇建議類型｜步驟二：選擇醫師回應代碼（A-W）
                </p>
              </div>

              {/* 建議處方類別（全寬） */}
              {(selectedCategory === 'prescription' || !selectedCategory) && (
                <Card 
                  className={`border-2 cursor-pointer transition-all ${
                    selectedCategory === 'prescription'
                      ? 'ring-4 ring-offset-2 ring-[#7f265b]/50 bg-[#7f265b] text-white'
                      : 'bg-purple-100 border-purple-300 hover:bg-purple-200'
                  }`}
                  onClick={() => {
                    setSelectedCategory('prescription');
                    setSelectedCode(null);
                  }}
                >
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Pill className={`h-6 w-6 ${selectedCategory === 'prescription' ? 'text-white' : 'text-[#7f265b]'}`} />
                      1. 建議處方
                    </CardTitle>
                  </CardHeader>
                  
                  {selectedCategory === 'prescription' && (
                    <CardContent className="space-y-2">
                      <p className="text-sm text-white/80 mb-3">選擇具體建議類型：</p>
                      <div className="grid grid-cols-2 gap-2">
                        {adviceCategories.prescription.codes.map((codeItem) => (
                          <Button
                            key={codeItem.code}
                            variant={selectedCode === codeItem.code ? 'default' : 'outline'}
                            className={`justify-start text-left h-auto py-2.5 text-sm ${
                              selectedCode === codeItem.code 
                                ? 'bg-white text-[#7f265b] hover:bg-white/90' 
                                : 'bg-purple-50 text-[#1a1a1a] border-purple-200 hover:bg-purple-100'
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCode(codeItem.code);
                            }}
                          >
                            <div className="flex items-start gap-2 w-full">
                              <span className="font-bold shrink-0">{codeItem.code}</span>
                              <span className="opacity-90 text-xs leading-relaxed">{codeItem.label}</span>
                            </div>
                          </Button>
                        ))}
                      </div>
                    </CardContent>
                  )}
                </Card>
              )}

              {/* 主動建議類別（全寬） */}
              {(selectedCategory === 'proactive' || !selectedCategory) && (
                <Card 
                  className={`border-2 cursor-pointer transition-all ${
                    selectedCategory === 'proactive'
                      ? 'ring-4 ring-offset-2 ring-[#ff9900]/50 bg-[#ff9900] text-white'
                      : 'bg-orange-100 border-orange-300 hover:bg-orange-200'
                  }`}
                  onClick={() => {
                    setSelectedCategory('proactive');
                    setSelectedCode(null);
                  }}
                >
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <AlertTriangle className={`h-6 w-6 ${selectedCategory === 'proactive' ? 'text-white' : 'text-[#ff9900]'}`} />
                      2. 主動建議
                    </CardTitle>
                  </CardHeader>
                  
                  {selectedCategory === 'proactive' && (
                    <CardContent className="space-y-2">
                      <p className="text-sm text-white/80 mb-3">選擇具體建議類型：</p>
                      <div className="grid grid-cols-2 gap-2">
                        {adviceCategories.proactive.codes.map((codeItem) => (
                          <Button
                            key={codeItem.code}
                            variant={selectedCode === codeItem.code ? 'default' : 'outline'}
                            className={`justify-start text-left h-auto py-2.5 text-sm ${
                              selectedCode === codeItem.code 
                                ? 'bg-white text-[#ff9900] hover:bg-white/90' 
                                : 'bg-orange-50 text-[#1a1a1a] border-orange-200 hover:bg-orange-100'
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCode(codeItem.code);
                            }}
                          >
                            <div className="flex items-start gap-2 w-full">
                              <span className="font-bold shrink-0">{codeItem.code}</span>
                              <span className="opacity-90 text-xs leading-relaxed">{codeItem.label}</span>
                            </div>
                          </Button>
                        ))}
                      </div>
                    </CardContent>
                  )}
                </Card>
              )}

              {/* 建議監測類別（全寬） */}
              {(selectedCategory === 'monitoring' || !selectedCategory) && (
                <Card 
                  className={`border-2 cursor-pointer transition-all ${
                    selectedCategory === 'monitoring'
                      ? 'ring-4 ring-offset-2 ring-gray-500/50 bg-gray-700 text-white'
                      : 'bg-gray-100 border-gray-300 hover:bg-gray-200'
                  }`}
                  onClick={() => {
                    setSelectedCategory('monitoring');
                    setSelectedCode(null);
                  }}
                >
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Info className={`h-6 w-6 ${selectedCategory === 'monitoring' ? 'text-white' : 'text-gray-700'}`} />
                      3. 建議監測
                    </CardTitle>
                  </CardHeader>
                  
                  {selectedCategory === 'monitoring' && (
                    <CardContent className="space-y-2">
                      <p className="text-sm text-white/80 mb-3">選擇具體建議類型：</p>
                      <div className="grid grid-cols-2 gap-2">
                        {adviceCategories.monitoring.codes.map((codeItem) => (
                          <Button
                            key={codeItem.code}
                            variant={selectedCode === codeItem.code ? 'default' : 'outline'}
                            className={`justify-start text-left h-auto py-2.5 text-sm ${
                              selectedCode === codeItem.code 
                                ? 'bg-white text-gray-700 hover:bg-white/90' 
                                : 'bg-gray-50 text-[#1a1a1a] border-gray-200 hover:bg-gray-100'
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCode(codeItem.code);
                            }}
                          >
                            <div className="flex items-start gap-2 w-full">
                              <span className="font-bold shrink-0">{codeItem.code}</span>
                              <span className="opacity-90 text-xs leading-relaxed">{codeItem.label}</span>
                            </div>
                          </Button>
                        ))}
                      </div>
                    </CardContent>
                  )}
                </Card>
              )}

              {/* 用藥適真性類別（全寬） */}
              {(selectedCategory === 'appropriateness' || !selectedCategory) && (
                <Card 
                  className={`border-2 cursor-pointer transition-all ${
                    selectedCategory === 'appropriateness'
                      ? 'ring-4 ring-offset-2 ring-[#007bff]/50 bg-[#007bff] text-white'
                      : 'bg-blue-100 border-blue-300 hover:bg-blue-200'
                  }`}
                  onClick={() => {
                    setSelectedCategory('appropriateness');
                    setSelectedCode(null);
                  }}
                >
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <CheckCircle2 className={`h-6 w-6 ${selectedCategory === 'appropriateness' ? 'text-white' : 'text-[#007bff]'}`} />
                      4. 用藥適真性
                    </CardTitle>
                  </CardHeader>
                  
                  {selectedCategory === 'appropriateness' && (
                    <CardContent className="space-y-2">
                      <p className="text-sm text-white/80 mb-3">選擇具體建議類型：</p>
                      <div className="grid grid-cols-2 gap-2">
                        {adviceCategories.appropriateness.codes.map((codeItem) => (
                          <Button
                            key={codeItem.code}
                            variant={selectedCode === codeItem.code ? 'default' : 'outline'}
                            className={`justify-start text-left h-auto py-2.5 text-sm ${
                              selectedCode === codeItem.code 
                                ? 'bg-white text-[#007bff] hover:bg-white/90' 
                                : 'bg-blue-50 text-[#1a1a1a] border-blue-200 hover:bg-blue-100'
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCode(codeItem.code);
                            }}
                          >
                            <div className="flex items-start gap-2 w-full">
                              <span className="font-bold shrink-0">{codeItem.code}</span>
                              <span className="opacity-90 text-xs leading-relaxed">{codeItem.label}</span>
                            </div>
                          </Button>
                        ))}
                      </div>
                    </CardContent>
                  )}
                </Card>
              )}

              {/* A-W 回應代碼（四類，2x2網格） */}
              {selectedCode && (
                <>
                  <Separator className="my-4" />
                  <div>
                    <h3 className="font-semibold text-base mb-2">步驟二：選擇醫師/醫療團隊的回應代碼（A-W）</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      根據醫師對建議的回應，選擇適當的 A-W 代碼
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {(['accept', 'warning', 'controversy', 'adverse'] as Array<keyof typeof responseCategories>).map((categoryKey) => {
                      const category = responseCategories[categoryKey];
                      const Icon = category.icon;
                      const isSelected = selectedResponse === categoryKey;
                      
                      return (
                        <Card 
                          key={categoryKey}
                          className={`border-2 cursor-pointer transition-all ${
                            isSelected 
                              ? 'ring-4 ring-offset-2 ' + category.activeColor.replace('text-white', 'ring-opacity-50')
                              : category.color
                          }`}
                          onClick={() => {
                            setSelectedResponse(categoryKey);
                          }}
                        >
                          <CardHeader className="pb-3">
                            <CardTitle className="flex items-center gap-2 text-base">
                              <Icon className={`h-5 w-5 ${isSelected ? 'text-white' : category.iconColor}`} />
                              {category.label}
                            </CardTitle>
                          </CardHeader>
                          
                          {isSelected && (
                            <CardContent className="space-y-2">
                              <p className="text-sm text-muted-foreground mb-3">選擇具體代碼：</p>
                              {category.codes.map((codeItem) => (
                                <Button
                                  key={codeItem.code}
                                  variant={selectedResponseCode === codeItem.code ? 'default' : 'outline'}
                                  className={`w-full justify-start text-left h-auto py-3 ${
                                    selectedResponseCode === codeItem.code 
                                      ? category.activeColor 
                                      : 'hover:' + category.color
                                  }`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedResponseCode(codeItem.code);
                                  }}
                                >
                                  <div className="flex flex-col items-start gap-1 w-full">
                                    <span className="font-bold text-sm">{codeItem.code}</span>
                                    <span className="text-xs opacity-90">{codeItem.label}</span>
                                  </div>
                                </Button>
                              ))}
                            </CardContent>
                          )}
                        </Card>
                      );
                    })}
                  </div>
                </>
              )}

              {/* 已選擇的代碼顯示 */}
              {selectedCode && (
                <Card className="bg-green-50 border-2 border-green-400">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="h-6 w-6 text-green-600" />
                        <div>
                          <p className="font-semibold text-green-900">已選擇分類代碼</p>
                          <p className="text-sm text-green-700">
                            <span className="font-bold">{selectedCode}</span> - {adviceCategories[selectedCategory!].codes.find(c => c.code === selectedCode)?.label}
                          </p>
                        </div>
                      </div>
                      <Badge className="bg-green-600 text-white">
                        {adviceCategories[selectedCategory!].label}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </>
        )}

        {/* 儲存按鈕 */}
        {polishedAdvice && selectedCode && selectedResponseCode && (
          <>
            <Separator />
            <div className="flex gap-3">
              <Button 
                onClick={handleSaveAdvice}
                size="lg"
                className="flex-1 bg-green-600 hover:bg-green-700 text-[16px] h-12"
              >
                <Send className="mr-2 h-5 w-5" />
                儲存用藥建議並記錄分類
              </Button>
              <Button 
                variant="outline"
                size="lg"
                className="h-12"
                onClick={() => {
                  if (onSendToNotes) {
                    onSendToNotes(polishedAdvice, selectedCategory!, selectedResponseCode);
                    alert('已成功匯入留言板！');
                  } else {
                    alert('已複製到剪貼簿，可手動貼上到留言板');
                    copyToClipboard(polishedAdvice);
                  }
                }}
              >
                <Send className="mr-2 h-5 w-5" />
                匯入留言板
              </Button>
              <Button 
                variant="outline"
                size="lg"
                className="h-12"
              >
                <Download className="mr-2 h-5 w-5" />
                匯入 HIS
              </Button>
            </div>
          </>
        )}

        {/* 成功訊息 */}
        {showSuccess && (
          <Card className="bg-green-100 border-2 border-green-400 animate-in fade-in duration-300">
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
                <div>
                  <p className="font-semibold text-green-900">用藥建議已成功儲存！</p>
                  <p className="text-sm text-green-700">
                    已記錄至統計資料，可至藥師專區查看分析報告
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
}