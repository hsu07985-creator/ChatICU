import { useState, useCallback } from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle, FlaskConical, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { getIVCompatibility } from '../../lib/api/pharmacy';
import type { Medication } from '../../lib/api/medications';

// ─── 型別定義 ────────────────────────────────────────────────────────────────

export type IVCompatStatus = 'C' | 'I' | '-';

export interface IVCompatibilityResult {
  drug1: string;
  drug2: string;
  /** 'C'=相容, 'I'=不相容, '-'=無資料 */
  status: IVCompatStatus;
  compatible?: boolean;
  notes?: string;
  timeStability?: string;
  references?: string;
}

// ─── 輔助函式 ────────────────────────────────────────────────────────────────

/** 從後端回應轉換為 IVCompatStatus */
function toCompatStatus(compatible: boolean | undefined | null): IVCompatStatus {
  if (compatible === true) return 'C';
  if (compatible === false) return 'I';
  return '-';
}

/** 取得 IV 相容性資料（呼叫後端 /pharmacy/iv-compatibility） */
async function fetchCompatibility(drugA: string, drugB: string): Promise<IVCompatibilityResult> {
  try {
    const resp = await getIVCompatibility({ drugA: drugA.trim(), drugB: drugB.trim() });
    const rows = resp.compatibilities || [];
    if (rows.length === 0) {
      return { drug1: drugA, drug2: drugB, status: '-' };
    }
    const row = rows[0];
    return {
      drug1: row.drug1 || drugA,
      drug2: row.drug2 || drugB,
      status: toCompatStatus(row.compatible),
      compatible: row.compatible,
      notes: row.notes,
      timeStability: row.timeStability,
      references: row.references,
    };
  } catch {
    return { drug1: drugA, drug2: drugB, status: '-' };
  }
}

// ─── 單一結果卡片 ─────────────────────────────────────────────────────────────

interface CompatResultCardProps {
  result: IVCompatibilityResult;
}

function CompatResultCard({ result }: CompatResultCardProps) {
  const { status, drug1, drug2, notes, timeStability, references } = result;

  if (status === 'C') {
    return (
      <div className="rounded-lg border-2 border-green-400 bg-green-50 px-4 py-3 space-y-1">
        <div className="flex items-center gap-2 text-green-800 font-semibold text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
          <span>相容 (Compatible)</span>
        </div>
        <p className="text-xs text-green-700">
          <span className="font-medium">{drug1}</span>
          {' '}&{' '}
          <span className="font-medium">{drug2}</span>
          {' '}可經 Y-Site 共同輸注
        </p>
        {timeStability && (
          <p className="text-xs text-green-600">穩定時間：{timeStability}</p>
        )}
        {notes && <p className="text-xs text-green-600">{notes}</p>}
        {references && <p className="text-xs text-green-500">參考：{references}</p>}
      </div>
    );
  }

  if (status === 'I') {
    return (
      <div className="rounded-lg border-2 border-red-500 bg-red-50 px-4 py-3 space-y-1.5">
        <div className="flex items-center gap-2 text-red-800 font-bold text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-600 animate-pulse" />
          <span>不相容 (Incompatible)</span>
        </div>
        <Alert variant="destructive" className="py-2 border-red-400">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle className="text-sm font-bold">
            IV 相容性警示
          </AlertTitle>
          <AlertDescription className="text-xs mt-0.5">
            <span className="font-semibold">{drug1}</span>
            {' '}與{' '}
            <span className="font-semibold">{drug2}</span>
            {' '}不相容 — 請勿共用同一管路輸注，應使用不同靜脈通路或分開給藥時間。
          </AlertDescription>
        </Alert>
        {notes && <p className="text-xs text-red-700 mt-1">{notes}</p>}
        {references && <p className="text-xs text-red-500">參考：{references}</p>}
      </div>
    );
  }

  // status === '-'
  return (
    <div className="rounded-lg border border-gray-300 bg-gray-50 px-4 py-3 space-y-1">
      <div className="flex items-center gap-2 text-gray-600 font-medium text-sm">
        <HelpCircle className="h-4 w-4 shrink-0 text-gray-400" />
        <span>無資料</span>
      </div>
      <p className="text-xs text-gray-500">
        <span className="font-medium">{drug1}</span>
        {' '}&{' '}
        <span className="font-medium">{drug2}</span>
        {' '}的 Y-Site IV 相容性資料尚未收錄，請查閱 Trissel's 或製造商說明書。
      </p>
    </div>
  );
}

// ─── 矩陣格子 ────────────────────────────────────────────────────────────────

interface MatrixCellProps {
  status: IVCompatStatus | 'self' | 'loading';
}

function MatrixCell({ status }: MatrixCellProps) {
  if (status === 'self') {
    return (
      <div className="flex h-8 w-full items-center justify-center rounded bg-gray-100 text-gray-400 text-xs font-bold">
        —
      </div>
    );
  }
  if (status === 'loading') {
    return (
      <div className="flex h-8 w-full items-center justify-center rounded bg-gray-50">
        <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
      </div>
    );
  }
  if (status === 'C') {
    return (
      <div className="flex h-8 w-full items-center justify-center rounded bg-green-100 text-green-800 text-xs font-bold border border-green-300">
        C
      </div>
    );
  }
  if (status === 'I') {
    return (
      <div className="flex h-8 w-full items-center justify-center rounded bg-red-100 text-red-800 text-xs font-bold border-2 border-red-500">
        I
      </div>
    );
  }
  // '-'
  return (
    <div className="flex h-8 w-full items-center justify-center rounded bg-gray-50 text-gray-400 text-xs border border-gray-200">
      ?
    </div>
  );
}

// ─── 矩陣模式（病人 IV 藥物） ─────────────────────────────────────────────────

interface IVCompatibilityMatrixProps {
  drugs: string[];
}

type MatrixState = Record<string, IVCompatStatus | 'loading'>;

function IVCompatibilityMatrix({ drugs }: IVCompatibilityMatrixProps) {
  const [matrix, setMatrix] = useState<MatrixState>({});
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [incompatiblePairs, setIncompatiblePairs] = useState<IVCompatibilityResult[]>([]);

  const matrixKey = (a: string, b: string) => {
    const [x, y] = [a, b].sort();
    return `${x}|||${y}`;
  };

  const handleCheckMatrix = useCallback(async () => {
    if (drugs.length < 2) return;
    setIsLoading(true);
    setHasLoaded(false);
    setIncompatiblePairs([]);

    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < drugs.length; i++) {
      for (let j = i + 1; j < drugs.length; j++) {
        pairs.push([drugs[i], drugs[j]]);
      }
    }

    // 限制最多 15 組以避免過多請求
    const limitedPairs = pairs.slice(0, 15);

    // 先把所有格子設成 loading
    const initialMatrix: MatrixState = {};
    for (const [a, b] of limitedPairs) {
      initialMatrix[matrixKey(a, b)] = 'loading';
    }
    setMatrix(initialMatrix);

    const results = await Promise.all(
      limitedPairs.map(([a, b]) => fetchCompatibility(a, b))
    );

    const newMatrix: MatrixState = {};
    const incompatible: IVCompatibilityResult[] = [];
    for (const result of results) {
      newMatrix[matrixKey(result.drug1, result.drug2)] = result.status;
      if (result.status === 'I') {
        incompatible.push(result);
      }
    }
    setMatrix(newMatrix);
    setIncompatiblePairs(incompatible);
    setIsLoading(false);
    setHasLoaded(true);
  }, [drugs]);

  if (drugs.length < 2) {
    return (
      <p className="text-xs text-muted-foreground">
        病患目前登錄的 IV 藥物不足 2 種，無法產生矩陣。
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <Button
        size="sm"
        variant="outline"
        onClick={handleCheckMatrix}
        disabled={isLoading}
        className="text-xs h-8"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
            矩陣查詢中...
          </>
        ) : (
          <>
            <FlaskConical className="h-3 w-3 mr-1.5" />
            產生 IV 相容性矩陣（{drugs.length} 種藥物）
          </>
        )}
      </Button>

      {hasLoaded && (
        <>
          {/* 不相容警示摘要 */}
          {incompatiblePairs.length > 0 && (
            <Alert variant="destructive" className="py-2 border-red-400">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle className="text-sm font-bold">
                發現 {incompatiblePairs.length} 組不相容組合
              </AlertTitle>
              <AlertDescription className="text-xs mt-0.5 space-y-0.5">
                {incompatiblePairs.map((p) => (
                  <p key={`${p.drug1}-${p.drug2}`}>
                    <span className="font-semibold">{p.drug1}</span>
                    {' '}與{' '}
                    <span className="font-semibold">{p.drug2}</span>
                    {' '}— 請分管路給藥
                  </p>
                ))}
              </AlertDescription>
            </Alert>
          )}

          {/* 矩陣表格 */}
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs border-collapse">
              <thead>
                <tr>
                  <th className="w-28 min-w-[7rem] px-1 py-1 text-left text-muted-foreground font-normal" />
                  {drugs.map((drug) => (
                    <th
                      key={drug}
                      className="px-1 py-1 text-center font-medium max-w-[6rem] whitespace-nowrap overflow-hidden text-ellipsis"
                      title={drug}
                    >
                      {drug.length > 8 ? drug.slice(0, 7) + '…' : drug}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {drugs.map((rowDrug, rowIdx) => (
                  <tr key={rowDrug}>
                    <td
                      className="px-1 py-0.5 font-medium text-left max-w-[7rem] whitespace-nowrap overflow-hidden text-ellipsis"
                      title={rowDrug}
                    >
                      {rowDrug.length > 9 ? rowDrug.slice(0, 8) + '…' : rowDrug}
                    </td>
                    {drugs.map((colDrug, colIdx) => (
                      <td key={colDrug} className="px-0.5 py-0.5 min-w-[2.5rem]">
                        {rowIdx === colIdx ? (
                          <MatrixCell status="self" />
                        ) : (
                          <MatrixCell
                            status={
                              (matrix[matrixKey(rowDrug, colDrug)] as IVCompatStatus | 'loading') || '-'
                            }
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 圖例 */}
          <div className="flex flex-wrap gap-3 pt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block w-4 h-4 rounded bg-green-100 border border-green-300 text-center text-green-800 font-bold leading-4">C</span>
              相容
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-4 h-4 rounded bg-red-100 border-2 border-red-500 text-center text-red-800 font-bold leading-4">I</span>
              不相容
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-4 h-4 rounded bg-gray-50 border border-gray-200 text-center text-gray-400 font-bold leading-4">?</span>
              無資料
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── 快速檢查模式（2 藥手動輸入） ────────────────────────────────────────────

interface QuickCheckState {
  drug1: string;
  drug2: string;
  result: IVCompatibilityResult | null;
  loading: boolean;
  error: string | null;
}

function QuickCheckPanel() {
  const [state, setState] = useState<QuickCheckState>({
    drug1: '',
    drug2: '',
    result: null,
    loading: false,
    error: null,
  });

  const canCheck = state.drug1.trim().length > 0 && state.drug2.trim().length > 0;

  const handleCheck = useCallback(async () => {
    if (!canCheck) return;
    setState((prev) => ({ ...prev, loading: true, result: null, error: null }));
    try {
      const result = await fetchCompatibility(state.drug1.trim(), state.drug2.trim());
      setState((prev) => ({ ...prev, loading: false, result }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : '查詢失敗，請稍後再試';
      setState((prev) => ({ ...prev, loading: false, error: msg }));
    }
  }, [state.drug1, state.drug2, canCheck]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canCheck && !state.loading) {
      void handleCheck();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1">
          <label className="text-xs font-medium text-muted-foreground">藥品 A</label>
          <Input
            placeholder="輸入藥品名稱（例：Vancomycin）"
            value={state.drug1}
            onChange={(e) => setState((prev) => ({ ...prev, drug1: e.target.value, result: null }))}
            onKeyDown={handleKeyDown}
            className="h-9 text-sm"
            disabled={state.loading}
          />
        </div>
        <div className="flex-1 space-y-1">
          <label className="text-xs font-medium text-muted-foreground">藥品 B</label>
          <Input
            placeholder="輸入藥品名稱（例：Piperacillin）"
            value={state.drug2}
            onChange={(e) => setState((prev) => ({ ...prev, drug2: e.target.value, result: null }))}
            onKeyDown={handleKeyDown}
            className="h-9 text-sm"
            disabled={state.loading}
          />
        </div>
        <Button
          onClick={handleCheck}
          disabled={!canCheck || state.loading}
          className="h-9 shrink-0 bg-[var(--color-brand)] hover:bg-[var(--color-brand-hover)] sm:mt-0 mt-1"
          size="sm"
        >
          {state.loading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              查詢中...
            </>
          ) : (
            <>
              <FlaskConical className="h-3.5 w-3.5 mr-1.5" />
              檢查 IV 相容性
            </>
          )}
        </Button>
      </div>

      {state.error && (
        <p className="text-xs text-destructive">{state.error}</p>
      )}

      {state.result && (
        <CompatResultCard result={state.result} />
      )}
    </div>
  );
}

// ─── 主要匯出元件 ─────────────────────────────────────────────────────────────

export interface IvCompatibilityCheckerProps {
  /**
   * 選擇性傳入病患目前的 IV 藥物清單，供矩陣模式使用。
   * 若未提供，僅顯示快速檢查模式。
   */
  ivMedications?: Medication[];
}

export function IvCompatibilityChecker({ ivMedications }: IvCompatibilityCheckerProps) {
  const [activeMode, setActiveMode] = useState<'quick' | 'matrix'>('quick');

  // 從 ivMedications 中篩選出靜脈（IV）給藥路徑的藥物名稱（去重）
  const ivDrugNames: string[] = (() => {
    if (!ivMedications || ivMedications.length === 0) return [];
    const ivRoutes = new Set(['iv', 'intravenous', 'ivdrip', 'iv drip', 'ivpb', 'ivp', '靜脈注射', '靜注', '靜滴']);
    const seen = new Set<string>();
    const names: string[] = [];
    for (const med of ivMedications) {
      const route = (med.routeNormalized || med.route || '').toLowerCase().replace(/[-_\s]/g, '');
      const isIV = ivRoutes.has(route) || route.includes('iv') || route.includes('intra');
      if (isIV && med.name && !seen.has(med.name)) {
        seen.add(med.name);
        names.push(med.name);
      }
    }
    return names;
  })();

  const hasIVMeds = ivDrugNames.length >= 2;

  return (
    <Card className="border-border">
      <CardHeader className="pb-2 space-y-1">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-[var(--color-brand)]" />
            <CardTitle className="text-base font-semibold leading-tight text-slate-800">IV 相容性快速檢查</CardTitle>
          </div>
          {hasIVMeds && (
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={activeMode === 'quick' ? 'default' : 'outline'}
                className={`h-7 px-2.5 text-xs ${activeMode === 'quick' ? 'bg-[var(--color-brand)] hover:bg-[var(--color-brand-hover)]' : ''}`}
                onClick={() => setActiveMode('quick')}
              >
                快速檢查
              </Button>
              <Button
                size="sm"
                variant={activeMode === 'matrix' ? 'default' : 'outline'}
                className={`h-7 px-2.5 text-xs ${activeMode === 'matrix' ? 'bg-[var(--color-brand)] hover:bg-[var(--color-brand-hover)]' : ''}`}
                onClick={() => setActiveMode('matrix')}
              >
                矩陣模式
              </Button>
            </div>
          )}
        </div>
        <CardDescription className="text-sm leading-tight">
          Y-Site IV 相容性查詢 — 資料來源：藥物相容性資料庫（Drug Graph Source C）
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {activeMode === 'quick' || !hasIVMeds ? (
          <QuickCheckPanel />
        ) : (
          <IVCompatibilityMatrix drugs={ivDrugNames} />
        )}
      </CardContent>
    </Card>
  );
}
