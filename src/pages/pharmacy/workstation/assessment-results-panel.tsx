import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Separator } from '../../../components/ui/separator';
import { Textarea } from '../../../components/ui/textarea';
import {
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  XCircle,
  Droplets,
  Calculator,
  Lightbulb,
  User,
  Activity,
  ChevronDown,
  ChevronUp,
  Check,
  Edit3,
  BarChart3,
  FileText,
  BookOpen,
} from 'lucide-react';
import type { AssessmentResults, ExpandedSections, ExtendedPatientData } from './types';

interface PatientLite {
  name: string;
  bedNumber?: string;
}

interface AssessmentResultsPanelProps {
  selectedPatient: PatientLite | null;
  assessmentResults: AssessmentResults | null;
  drugList: string[];
  expandedSections: ExpandedSections;
  toggleSection: (section: keyof ExpandedSections) => void;
  extendedData: ExtendedPatientData | null;
  adviceContent: string;
  onAdviceContentChange: (value: string) => void;
  onGoToStatistics: () => void;
  onGenerateAdvice: () => void;
  onSaveAdvice: () => void;
}

function getSeverityIcon(severity: string) {
  switch (severity) {
    case 'high':
      return <AlertTriangle className="h-4 w-4" />;
    case 'medium':
      return <AlertCircle className="h-4 w-4" />;
    case 'low':
      return <Info className="h-4 w-4" />;
    default:
      return null;
  }
}

export function AssessmentResultsPanel({
  selectedPatient,
  assessmentResults,
  drugList,
  expandedSections,
  toggleSection,
  extendedData,
  adviceContent,
  onAdviceContentChange,
  onGoToStatistics,
  onGenerateAdvice,
  onSaveAdvice,
}: AssessmentResultsPanelProps) {
  return (
    <div className="lg:col-span-3 space-y-4">
      {!selectedPatient && (
        <Card>
          <CardContent className="py-16">
            <div className="text-center space-y-3">
              <User className="h-12 w-12 mx-auto text-muted-foreground" />
              <div>
                <h3 className="font-semibold text-lg">請先選擇病患</h3>
                <p className="text-muted-foreground text-sm">選擇病患後即可管理用藥並執行評估</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {selectedPatient && !assessmentResults && (
        <Card>
          <CardContent className="py-16">
            <div className="text-center space-y-3">
              <Activity className="h-12 w-12 mx-auto text-muted-foreground" />
              <div>
                <h3 className="font-semibold text-lg">準備執行評估</h3>
                <p className="text-muted-foreground text-sm">
                  目前已載入 {drugList.length} 項藥品，點擊「執行全面評估」開始分析
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {selectedPatient && assessmentResults && (
        <>
          <Card className={assessmentResults.interactions.length > 0 ? 'border-l-4 border-l-[#f59e0b]' : 'border-l-4 border-l-[#7f265b]'}>
            <CardHeader
              className="cursor-pointer bg-[#f8f9fa] py-3"
              onClick={() => toggleSection('interactions')}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className={`h-5 w-5 ${assessmentResults.interactions.length > 0 ? 'text-[#f59e0b]' : 'text-[#7f265b]'}`} />
                  <CardTitle className="text-base">藥物交互作用</CardTitle>
                  {assessmentResults.interactions.length > 0 ? (
                    <Badge variant="secondary" className="bg-[#f59e0b] text-white">
                      {assessmentResults.interactions.length} 項
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">
                      無異常
                    </Badge>
                  )}
                </div>
                {expandedSections.interactions ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </CardHeader>
            {expandedSections.interactions && (
              <CardContent className="space-y-2.5 pt-3">
                {assessmentResults.interactions.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>未發現藥物交互作用</span>
                  </div>
                ) : (
                  assessmentResults.interactions.map((interaction, idx) => (
                    <div key={idx} className="border rounded-lg p-3 space-y-2 bg-[#f8f9fa]">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          {getSeverityIcon(interaction.severity)}
                          <p className="font-semibold text-sm">
                            {interaction.drugA} + {interaction.drugB}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {interaction.severity === 'high' ? '高風險' : interaction.severity === 'medium' ? '中風險' : '低風險'}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{interaction.description}</p>
                      <Separator />
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">機轉說明</p>
                        <p className="text-sm">{interaction.mechanism}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">臨床影響</p>
                        <p className="text-sm">{interaction.clinicalEffect}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">處理建議</p>
                        <p className="text-sm">{interaction.management}</p>
                      </div>
                      {interaction.references && (
                        <>
                          <Separator />
                          <div className="bg-white rounded p-2 border border-[#e5e7eb]">
                            <div className="flex items-center gap-1 mb-1">
                              <BookOpen className="h-3 w-3 text-[#7f265b]" />
                              <p className="text-xs font-medium text-[#7f265b]">參考依據</p>
                            </div>
                            <p className="text-xs text-muted-foreground">{interaction.references}</p>
                          </div>
                        </>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            )}
          </Card>

          <Card className={assessmentResults.compatibility.some(c => !c.compatible) ? 'border-l-4 border-l-[#f59e0b]' : 'border-l-4 border-l-[#7f265b]'}>
            <CardHeader
              className="cursor-pointer bg-[#f8f9fa] py-3"
              onClick={() => toggleSection('compatibility')}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Droplets className={`h-5 w-5 ${assessmentResults.compatibility.some(c => !c.compatible) ? 'text-[#f59e0b]' : 'text-[#7f265b]'}`} />
                  <CardTitle className="text-base">靜脈注射相容性</CardTitle>
                  {assessmentResults.compatibility.length > 0 ? (
                    <Badge variant="secondary" className="text-xs">
                      {assessmentResults.compatibility.length} 組
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">
                      無資料
                    </Badge>
                  )}
                </div>
                {expandedSections.compatibility ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </CardHeader>
            {expandedSections.compatibility && (
              <CardContent className="space-y-2.5 pt-3">
                {assessmentResults.compatibility.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>無相容性資料或所有組合皆相容</span>
                  </div>
                ) : (
                  assessmentResults.compatibility.map((comp, idx) => (
                    <div key={idx} className="border rounded-lg p-3 space-y-2 bg-[#f8f9fa]">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {comp.compatible ? (
                            <CheckCircle2 className="h-4 w-4 text-[#7f265b]" />
                          ) : (
                            <XCircle className="h-4 w-4 text-[#f59e0b]" />
                          )}
                          <p className="font-semibold text-sm">
                            {comp.drugA} + {comp.drugB}
                          </p>
                        </div>
                        <Badge className={comp.compatible ? 'bg-[#7f265b]' : 'bg-[#f59e0b]'}>
                          {comp.compatible ? '相容' : '不相容'}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">溶劑：</span>
                          <span className="font-medium">{comp.solution}</span>
                        </div>
                        {comp.timeStability && (
                          <div>
                            <span className="text-muted-foreground">穩定時間：</span>
                            <span className="font-medium">{comp.timeStability}</span>
                          </div>
                        )}
                      </div>
                      {comp.concentration && (
                        <div className="text-xs">
                          <span className="text-muted-foreground">濃度：</span>
                          <span>{comp.concentration}</span>
                        </div>
                      )}
                      {comp.notes && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">注意事項</p>
                          <p className="text-sm">{comp.notes}</p>
                        </div>
                      )}
                      {comp.references && (
                        <>
                          <Separator />
                          <div className="bg-white rounded p-2 border border-[#e5e7eb]">
                            <div className="flex items-center gap-1 mb-1">
                              <BookOpen className="h-3 w-3 text-[#7f265b]" />
                              <p className="text-xs font-medium text-[#7f265b]">參考依據</p>
                            </div>
                            <p className="text-xs text-muted-foreground">{comp.references}</p>
                          </div>
                        </>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            )}
          </Card>

          <Card className="border-l-4 border-l-[#7f265b]">
            <CardHeader
              className="cursor-pointer bg-[#f8f9fa] py-3"
              onClick={() => toggleSection('dosage')}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calculator className="h-5 w-5 text-[#7f265b]" />
                  <CardTitle className="text-base">劑量調整建議</CardTitle>
                  <Badge variant="secondary" className="text-xs">
                    {assessmentResults.dosage.length} 項
                  </Badge>
                </div>
                {expandedSections.dosage ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </CardHeader>
            {expandedSections.dosage && (
              <CardContent className="space-y-2.5 pt-3">
                {assessmentResults.dosage.map((dose, idx) => (
                  <div key={idx} className="border rounded-lg p-3 space-y-2 bg-[#f8f9fa]">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-sm">{dose.drugName}</p>
                      {typeof extendedData?.egfr === 'number' && extendedData.egfr < 60 && (
                        <Badge variant="outline" className="text-xs border-[#f59e0b] text-[#f59e0b]">
                          需調整
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="text-muted-foreground">標準劑量</p>
                        <p className="font-medium">{dose.normalDose}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">建議劑量</p>
                        <p className="font-medium text-[#7f265b]">{dose.adjustedDose}</p>
                      </div>
                    </div>
                    <Separator />
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">腎功能調整</p>
                      <p className="text-sm">{dose.renalAdjustment}</p>
                    </div>
                    {dose.hepaticWarning && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">肝功能評估</p>
                        <p className="text-sm">{dose.hepaticWarning}</p>
                      </div>
                    )}
                    {dose.warnings && dose.warnings.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">注意事項</p>
                        <ul className="list-disc list-inside space-y-0.5 text-xs">
                          {dose.warnings.map((warning, wIdx) => (
                            <li key={wIdx}>{warning}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {dose.references && (
                      <>
                        <Separator />
                        <div className="bg-white rounded p-2 border border-[#e5e7eb]">
                          <div className="flex items-center gap-1 mb-1">
                            <BookOpen className="h-3 w-3 text-[#7f265b]" />
                            <p className="text-xs font-medium text-[#7f265b]">參考依據</p>
                          </div>
                          <p className="text-xs text-muted-foreground">{dose.references}</p>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </CardContent>
            )}
          </Card>

          <Card className="border-l-4 border-l-[#7f265b]">
            <CardHeader className="bg-[#f8f9fa] py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lightbulb className="h-5 w-5 text-[#7f265b]" />
                  <CardTitle className="text-base">用藥建議</CardTitle>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={onGoToStatistics}
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                  >
                    <BarChart3 className="mr-1 h-3 w-3" />
                    統計
                  </Button>
                  <Button
                    onClick={onGenerateAdvice}
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                  >
                    <FileText className="mr-1 h-3 w-3" />
                    產生報告
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 pt-3">
              {assessmentResults.adviceRecommendations.length > 0 && (
                <div className="border rounded-lg p-3 bg-[#f8f9fa]">
                  <p className="font-semibold text-sm mb-2 flex items-center gap-1">
                    <Lightbulb className="h-4 w-4 text-[#7f265b]" />
                    重點提示
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-xs text-muted-foreground">
                    {assessmentResults.adviceRecommendations.map((rec, idx) => (
                      <li key={idx}>{rec}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="space-y-2">
                <Textarea
                  value={adviceContent}
                  onChange={(e) => onAdviceContentChange(e.target.value)}
                  placeholder="點擊「產生報告」自動產生完整建議，或手動輸入..."
                  className="min-h-[180px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  onClick={onSaveAdvice}
                  disabled={!adviceContent.trim()}
                  className="bg-[#7f265b] hover:bg-[#631e4d]"
                >
                  <Check className="mr-1 h-4 w-4" />
                  接受並送出
                </Button>
                <Button
                  onClick={() => {
                    toast.info('您可以直接在上方編輯建議內容');
                  }}
                  disabled={!adviceContent.trim()}
                  variant="outline"
                >
                  <Edit3 className="mr-1 h-4 w-4" />
                  修正內容
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
