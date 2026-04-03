import { useState } from 'react';
import { getReadinessReason, polishClinicalText, type AIReadiness } from '../lib/api/ai';
import { copyToClipboard } from '../lib/clipboard-utils';
import { PHARMACY_ADVICE_CATEGORIES, PHARMACY_RESPONSE_CODE_CATEGORIES } from '../lib/pharmacy-master-data';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { AiMarkdown } from './ui/ai-markdown';
import { toast } from 'sonner';
import { createAdviceRecord } from '../lib/api/pharmacy';
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
  aiReadiness?: AIReadiness | null;
}

// 藥師建議分類定義（四大類）— 代碼/標籤來自固定 master data
const adviceCategories = {
  prescription: {
    label: PHARMACY_ADVICE_CATEGORIES.prescription.label,
    color: 'bg-purple-100 border-purple-300 hover:bg-purple-200',
    activeColor: 'bg-brand text-white',
    icon: Pill,
    iconColor: 'text-brand',
    codes: PHARMACY_ADVICE_CATEGORIES.prescription.codes,
  },
  proactive: {
    label: PHARMACY_ADVICE_CATEGORIES.proactive.label,
    color: 'bg-orange-100 border-orange-300 hover:bg-orange-200',
    activeColor: 'bg-orange-600 text-white',
    icon: AlertTriangle,
    iconColor: 'text-orange-600',
    codes: PHARMACY_ADVICE_CATEGORIES.proactive.codes,
  },
  monitoring: {
    label: PHARMACY_ADVICE_CATEGORIES.monitoring.label,
    color: 'bg-gray-100 border-gray-300 hover:bg-gray-200',
    activeColor: 'bg-gray-700 text-white',
    icon: Info,
    iconColor: 'text-gray-700',
    codes: PHARMACY_ADVICE_CATEGORIES.monitoring.codes,
  },
  appropriateness: {
    label: PHARMACY_ADVICE_CATEGORIES.appropriateness.label,
    color: 'bg-blue-100 border-blue-300 hover:bg-blue-200',
    activeColor: 'bg-blue-600 text-white',
    icon: CheckCircle2,
    iconColor: 'text-blue-600',
    codes: PHARMACY_ADVICE_CATEGORIES.appropriateness.codes,
  },
};

// A/W/C/N 回應代碼（醫師回應）— 代碼/標籤來自固定 master data
const responseCategories = {
  accept: {
    label: PHARMACY_RESPONSE_CODE_CATEGORIES.accept.label,
    color: 'bg-green-100 border-green-300 hover:bg-green-200',
    activeColor: 'bg-green-600 text-white',
    icon: CheckCircle2,
    iconColor: 'text-green-600',
    codes: PHARMACY_RESPONSE_CODE_CATEGORIES.accept.codes,
  },
  warning: {
    label: PHARMACY_RESPONSE_CODE_CATEGORIES.warning.label,
    color: 'bg-yellow-100 border-yellow-300 hover:bg-yellow-200',
    activeColor: 'bg-yellow-600 text-white',
    icon: AlertTriangle,
    iconColor: 'text-yellow-600',
    codes: PHARMACY_RESPONSE_CODE_CATEGORIES.warning.codes,
  },
  controversy: {
    label: PHARMACY_RESPONSE_CODE_CATEGORIES.controversy.label,
    color: 'bg-blue-100 border-blue-300 hover:bg-blue-200',
    activeColor: 'bg-blue-600 text-white',
    icon: Info,
    iconColor: 'text-blue-600',
    codes: PHARMACY_RESPONSE_CODE_CATEGORIES.controversy.codes,
  },
  adverse: {
    label: PHARMACY_RESPONSE_CODE_CATEGORIES.adverse.label,
    color: 'bg-red-100 border-red-300 hover:bg-red-200',
    activeColor: 'bg-red-600 text-white',
    icon: XCircle,
    iconColor: 'text-red-600',
    codes: PHARMACY_RESPONSE_CODE_CATEGORIES.adverse.codes,
  },
};

export function PharmacistAdviceWidget({
  patientId,
  patientName,
  linkedMedication,
  aiReadiness = null,
}: PharmacistAdviceWidgetProps) {
  const [adviceInput, setAdviceInput] = useState('');
  const [polishedAdvice, setPolishedAdvice] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<keyof typeof adviceCategories | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [selectedResponse, setSelectedResponse] = useState<keyof typeof responseCategories | null>(null);
  const [selectedResponseCode, setSelectedResponseCode] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [isPolishing, setIsPolishing] = useState(false);
  const canPolish = aiReadiness ? aiReadiness.feature_gates.clinical_polish : true;
  const polishReason = getReadinessReason(aiReadiness, 'clinical_polish');

  const handlePolishAdvice = async () => {
    if (!adviceInput.trim()) return;
    if (!canPolish) {
      toast.error(polishReason);
      return;
    }
    setIsPolishing(true);
    try {
      const result = await polishClinicalText({
        patientId,
        content: linkedMedication
          ? `${adviceInput}\n\nRegarding: ${linkedMedication}`
          : adviceInput,
        polishType: 'pharmacy_advice',
      });
      setPolishedAdvice(result.polished);
    } catch {
      toast.error('AI 修飾失敗，請稍後再試');
    } finally {
      setIsPolishing(false);
    }
  };

  const handleSaveAdvice = async () => {
    if (!polishedAdvice || !selectedCode || !selectedResponseCode) {
      toast.error('請先修飾建議內容並選擇分類代碼');
      return;
    }

    if (!selectedCategory) {
      toast.error('請選擇用藥建議分類');
      return;
    }
    const categoryInfo = adviceCategories[selectedCategory];
    const codeInfo = categoryInfo.codes.find(c => c.code === selectedCode);
    if (!codeInfo) {
      toast.error('建議代碼無效，請重新選擇');
      return;
    }

    const contentToSave =
      selectedResponseCode
        ? `${polishedAdvice}\n\n【醫師回應代碼】${selectedResponseCode}`
        : polishedAdvice;

    try {
      await createAdviceRecord({
        patientId,
        adviceCode: selectedCode,
        adviceLabel: codeInfo.label,
        category: categoryInfo.label,
        content: contentToSave,
        linkedMedications: linkedMedication ? [linkedMedication] : undefined,
      });

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
    } catch (err) {
      console.error('儲存用藥建議失敗:', err);
      toast.error('儲存用藥建議失敗，請稍後再試');
    }
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
              撰寫用藥建議並標記分類，儲存後將自動記錄至統計資料並同步到留言板
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
        {!canPolish && (
          <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {polishReason}
          </div>
        )}
        {/* 輸入與修飾區 */}
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="font-semibold text-foreground">輸入用藥建議草稿（中文或英文）</label>
            <Textarea
              placeholder="例如：建議調整 Morphine 劑量因為腎功能不全（eGFR < 30），同時注意監測呼吸抑制..."
              value={adviceInput}
              onChange={(e) => setAdviceInput(e.target.value)}
              className="min-h-[120px] border-2 text-[16px]"
            />
            <Button
              onClick={handlePolishAdvice}
              className="bg-green-600 hover:bg-green-700"
              disabled={isPolishing || !adviceInput.trim() || !canPolish}
            >
              <Brain className="mr-2 h-5 w-5" />
              {isPolishing ? 'AI 修飾中...' : 'AI 修飾藥師建議'}
            </Button>
          </div>

          {polishedAdvice && (
            <>
              <Separator />
              <div className="space-y-3">
                <label className="font-semibold text-foreground">修飾後的用藥建議</label>
                <div className="bg-slate-50 border-2 border-green-600 rounded-lg p-4">
                  <AiMarkdown content={polishedAdvice} className="text-[15px]" />
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
                      ? 'ring-4 ring-offset-2 ring-brand/50 bg-brand text-white'
                      : 'bg-purple-100 border-purple-300 hover:bg-purple-200'
                  }`}
                  onClick={() => {
                    setSelectedCategory('prescription');
                    setSelectedCode(null);
                  }}
                >
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Pill className={`h-6 w-6 ${selectedCategory === 'prescription' ? 'text-white' : 'text-brand'}`} />
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
                                ? 'bg-white text-brand hover:bg-white/90' 
                                : 'bg-purple-50 text-foreground border-purple-200 hover:bg-purple-100'
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
                                : 'bg-orange-50 text-foreground border-orange-200 hover:bg-orange-100'
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
                                : 'bg-gray-50 text-foreground border-gray-200 hover:bg-gray-100'
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
                                : 'bg-blue-50 text-foreground border-blue-200 hover:bg-blue-100'
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
                onClick={async () => {
                  const ok = await copyToClipboard(polishedAdvice);
                  if (ok) toast.success('已複製到剪貼簿');
                  else toast.error('複製失敗，請手動複製');
                }}
              >
                <Copy className="mr-2 h-5 w-5" />
                複製內容
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="h-12"
                onClick={() => {
                  const exportData = {
                    patient_id: patientId,
                    patient_name: patientName,
                    advice_type: 'pharmacy_advice',
                    category: selectedCategory,
                    category_code: selectedCode,
                    response: selectedResponse,
                    response_code: selectedResponseCode,
                    content: polishedAdvice,
                    linked_medication: linkedMedication,
                    created_at: new Date().toISOString(),
                  };
                  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${patientId}_pharmacy_advice_${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download className="mr-2 h-5 w-5" />
                匯出 JSON
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
                    已記錄至統計資料，並已同步至病患留言板（用藥建議）
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
