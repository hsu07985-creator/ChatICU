import { Library, Search, Loader2, ExternalLink, AlertTriangle, ShieldCheck, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Checkbox } from '../../components/ui/checkbox';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import {
  type DrugListItem,
  type DrugListResponse,
  type DrugLibraryStats,
  getDrugLibraryStats,
  listDrugs,
} from '../../lib/api/drug-library';

const PAGE_SIZE = 50;

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  green: { label: '🟢 完整', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  yellow: { label: '🟡 缺資料', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  red: { label: '🔴 待補 ATC', cls: 'bg-rose-500/10 text-rose-400 border-rose-500/30' },
};

function StatsBanner({ stats }: { stats: DrugLibraryStats | null }) {
  if (!stats) {
    return (
      <Card className="bg-card/40 border-border/40">
        <CardContent className="py-4 flex items-center gap-3 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin" /> 載入系統覆蓋總覽…
        </CardContent>
      </Card>
    );
  }

  const updated = stats.last_updated
    ? new Date(stats.last_updated).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })
    : '—';

  return (
    <Card className="bg-card/60 border-border/40">
      <CardContent className="py-4 space-y-3">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="size-4" />
            <span>系統覆蓋總覽</span>
          </div>
          <div className="text-xs text-muted-foreground">最後更新 {updated}</div>
        </div>
        <div className="flex items-center gap-4 flex-wrap text-sm">
          <span className="font-semibold">{stats.total_drugs.toLocaleString()}</span>
          <span className="text-muted-foreground">種藥物</span>
          <span className="text-muted-foreground">·</span>
          <span className="font-semibold">{stats.total_ddi.toLocaleString()}</span>
          <span className="text-muted-foreground">條交互作用</span>
          {stats.recently_added > 0 && (
            <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30">
              <Sparkles className="size-3 mr-1" /> 近期新增 {stats.recently_added.toLocaleString()} 條
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <Badge variant="outline" className="bg-rose-500/10 text-rose-400 border-rose-500/30">🚫 X {stats.ddi_by_risk.X.toLocaleString()}</Badge>
          <Badge variant="outline" className="bg-orange-500/10 text-orange-400 border-orange-500/30">⚠️ D {stats.ddi_by_risk.D.toLocaleString()}</Badge>
          <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30">👁 C {stats.ddi_by_risk.C.toLocaleString()}</Badge>
          <Badge variant="outline" className="bg-slate-500/10 text-slate-400 border-slate-500/30">○ B {stats.ddi_by_risk.B.toLocaleString()}</Badge>
          <Badge variant="outline" className="bg-zinc-500/10 text-zinc-400 border-zinc-500/30">─ A {stats.ddi_by_risk.A.toLocaleString()}</Badge>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
          資料源：
          {Object.entries(stats.sources).map(([src, n]) => (
            <span key={src} className="ml-1">
              {src} <span className="font-medium text-foreground">{n.toLocaleString()}</span>
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function DrugCard({ item, onClick }: { item: DrugListItem; onClick: () => void }) {
  const status = STATUS_LABEL[item.status] || STATUS_LABEL.yellow;
  return (
    <Card
      className="cursor-pointer hover:border-primary/40 transition-colors"
      onClick={onClick}
    >
      <CardContent className="py-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-base">{item.name}</h3>
              {item.atc && (
                <Badge variant="outline" className="text-xs font-mono">{item.atc}</Badge>
              )}
              {item.in_formulary ? (
                <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                  ✅ 院內
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs bg-zinc-500/10 text-zinc-400 border-zinc-500/30">
                  ❌ 院外
                </Badge>
              )}
              {item.recently_added && (
                <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/30">
                  <Sparkles className="size-3 mr-1" />新增
                </Badge>
              )}
            </div>
            {item.brand_names.length > 0 && (
              <div className="text-xs text-muted-foreground mt-1">
                商品 {item.brand_names.slice(0, 3).join(' · ')}
                {item.brand_names.length > 3 && ` 等 ${item.brand_names.length} 種`}
                {item.hospital_codes.length > 0 && (
                  <> · 院內代碼 {item.hospital_codes.slice(0, 2).join(' · ')}</>
                )}
              </div>
            )}
          </div>
          <Badge variant="outline" className={`text-xs ${status.cls}`}>{status.label}</Badge>
        </div>

        {item.icu_30d_rx > 0 && (
          <div className="text-xs text-muted-foreground">
            ICU 30 天開立 <span className="font-semibold text-foreground">{item.icu_30d_rx}</span> 次 ·{' '}
            <span className="font-semibold text-foreground">{item.icu_active_beds}</span> 床在用
          </div>
        )}

        <div className="flex items-center gap-2 text-xs flex-wrap">
          <span className="text-muted-foreground">💊</span>
          <span className="font-medium">{item.ddi_counts.total} 條 DDI</span>
          {item.ddi_counts.X > 0 && <span className="text-rose-400">🚫 {item.ddi_counts.X}</span>}
          {item.ddi_counts.D > 0 && <span className="text-orange-400">⚠️ {item.ddi_counts.D}</span>}
          {item.ddi_counts.C > 0 && <span className="text-amber-400">👁 {item.ddi_counts.C}</span>}
          {item.ddi_counts.B > 0 && <span className="text-slate-400">○ {item.ddi_counts.B}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

export function DrugLibraryPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [stats, setStats] = useState<DrugLibraryStats | null>(null);
  const [data, setData] = useState<DrugListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = searchParams.get('q') || '';
  const atc = searchParams.get('atc') || '';
  const sort = (searchParams.get('sort') as 'icu_usage' | 'name' | 'ddi_count') || 'icu_usage';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const inFormularyOnly = searchParams.get('in_formulary') === '1';
  const hasXOnly = searchParams.get('has_x') === '1';
  const missingAtcOnly = searchParams.get('missing_atc') === '1';
  const recentlyAddedOnly = searchParams.get('recently_added') === '1';

  const [qInput, setQInput] = useState(q);

  // Sync local search input to URL after debounce
  useEffect(() => {
    const t = setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (qInput) next.set('q', qInput);
      else next.delete('q');
      next.delete('page');
      setSearchParams(next, { replace: true });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  // Load stats once
  useEffect(() => {
    getDrugLibraryStats().then(setStats).catch(() => setStats(null));
  }, []);

  // Load list whenever filters change
  useEffect(() => {
    setLoading(true);
    setError(null);
    listDrugs({
      q: q || undefined,
      atc: atc || undefined,
      sort,
      page,
      size: PAGE_SIZE,
      in_formulary_only: inFormularyOnly || undefined,
      has_x_only: hasXOnly || undefined,
      missing_atc_only: missingAtcOnly || undefined,
      recently_added_only: recentlyAddedOnly || undefined,
    })
      .then(setData)
      .catch((e) => setError(e?.message || '載入失敗'))
      .finally(() => setLoading(false));
  }, [q, atc, sort, page, inFormularyOnly, hasXOnly, missingAtcOnly, recentlyAddedOnly]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const updateParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value == null || value === '') next.delete(key);
    else next.set(key, value);
    if (key !== 'page') next.delete('page');
    setSearchParams(next, { replace: true });
  };

  const toggleParam = (key: string) => {
    const next = new URLSearchParams(searchParams);
    if (next.get(key) === '1') next.delete(key);
    else next.set(key, '1');
    next.delete('page');
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="container mx-auto p-4 lg:p-6 space-y-4 max-w-screen-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Library className="size-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">藥物資料庫</h1>
          <p className="text-sm text-muted-foreground">
            系統涵蓋的所有藥物與交互作用規則總覽 · 藥師/管理者專用
          </p>
        </div>
      </div>

      {/* Stats banner */}
      <StatsBanner stats={stats} />

      {/* Search + filters */}
      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[280px]">
              <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="搜尋學名 / 商品名 / 院內代碼 / ATC"
                className="pl-9"
              />
            </div>
            <Select value={sort} onValueChange={(v) => updateParam('sort', v)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="icu_usage">🔥 ICU 30 天熱度</SelectItem>
                <SelectItem value="name">名稱 A → Z</SelectItem>
                <SelectItem value="ddi_count">DDI 條數多 → 少</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3 text-xs flex-wrap">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <Checkbox checked={inFormularyOnly} onCheckedChange={() => toggleParam('in_formulary')} />
              <span>院內藥</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <Checkbox checked={hasXOnly} onCheckedChange={() => toggleParam('has_x')} />
              <span>含 X 級規則</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <Checkbox checked={missingAtcOnly} onCheckedChange={() => toggleParam('missing_atc')} />
              <span>缺 ATC</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <Checkbox checked={recentlyAddedOnly} onCheckedChange={() => toggleParam('recently_added')} />
              <span>近期新增 (Lexicomp)</span>
            </label>
            {atc && (
              <Badge variant="outline" className="gap-1">
                ATC: {atc}
                <button onClick={() => updateParam('atc', null)} className="ml-1 hover:text-destructive">×</button>
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Body: ATC sidebar + cards */}
      <div className="grid grid-cols-1 lg:grid-cols-[180px_1fr] gap-4">
        {/* ATC sidebar */}
        <Card className="h-fit lg:sticky lg:top-4">
          <CardContent className="py-3 space-y-1">
            <div className="text-xs font-semibold text-muted-foreground mb-2">ATC 分類</div>
            <button
              onClick={() => updateParam('atc', null)}
              className={`w-full text-left px-2 py-1 rounded text-sm hover:bg-accent ${!atc ? 'bg-accent font-semibold' : ''}`}
            >
              全部
            </button>
            {data?.atc_classes.map((c) => (
              <button
                key={c.code}
                onClick={() => updateParam('atc', c.code)}
                className={`w-full text-left px-2 py-1 rounded text-sm hover:bg-accent flex items-center justify-between ${atc === c.code ? 'bg-accent font-semibold' : ''}`}
              >
                <span>
                  <span className="font-mono">{c.code}</span> {c.name}
                </span>
                <span className="text-xs text-muted-foreground">{c.count}</span>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Drug list */}
        <div className="space-y-3 min-w-0">
          {error && (
            <Card className="border-rose-500/40">
              <CardContent className="py-3 text-sm text-rose-400 flex items-center gap-2">
                <AlertTriangle className="size-4" /> {error}
              </CardContent>
            </Card>
          )}

          {loading && !data && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="size-4 animate-spin" /> 載入中…
              </CardContent>
            </Card>
          )}

          {data && (
            <div className="text-xs text-muted-foreground flex items-center justify-between">
              <span>
                共 <span className="font-semibold text-foreground">{data.total.toLocaleString()}</span> 種 ·
                第 {page} / {totalPages} 頁
              </span>
              {loading && <Loader2 className="size-3 animate-spin" />}
            </div>
          )}

          <div className="space-y-2">
            {data?.items.map((item) => (
              <DrugCard
                key={item.name}
                item={item}
                onClick={() => navigate(`/pharmacy/drug-library/${encodeURIComponent(item.name)}`)}
              />
            ))}
          </div>

          {data && data.total === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground text-sm">
                沒有符合條件的藥物
              </CardContent>
            </Card>
          )}

          {/* Pagination */}
          {data && totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || loading}
                onClick={() => updateParam('page', String(page - 1))}
              >
                ◀ 上一頁
              </Button>
              <span className="text-sm text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || loading}
                onClick={() => updateParam('page', String(page + 1))}
              >
                下一頁 ▶
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
