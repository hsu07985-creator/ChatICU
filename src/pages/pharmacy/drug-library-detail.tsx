import { ArrowLeft, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import {
  type DdiDetailItem,
  type DrugDetail,
  type IvCompatItem,
  getDrugDetail,
} from '../../lib/api/drug-library';

const RISK_META: Record<string, { cls: string; descr: string }> = {
  X: { cls: 'bg-rose-500/10 text-rose-400 border-rose-500/30', descr: 'Avoid combination' },
  D: { cls: 'bg-orange-500/10 text-orange-400 border-orange-500/30', descr: 'Consider therapy modification' },
  C: { cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30', descr: 'Monitor therapy' },
  B: { cls: 'bg-slate-500/10 text-slate-400 border-slate-500/30', descr: 'No action needed' },
  A: { cls: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30', descr: 'No known interaction' },
};

const RELIABILITY_META: Record<string, { cls: string; tip: string }> = {
  Excellent: { cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30', tip: '證據強度：優' },
  Good: { cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30', tip: '證據強度：良' },
  Fair: { cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30', tip: '證據強度：中等' },
  Poor: { cls: 'bg-rose-500/10 text-rose-400 border-rose-500/30', tip: '證據強度：弱' },
  Intermediate: { cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30', tip: '證據強度：中等' },
  'Intermediate-High': { cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30', tip: '證據強度：中-高' },
  'Intermediate-Low': { cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30', tip: '證據強度：中-低' },
};

function DdiCard({ item }: { item: DdiDetailItem }) {
  const reliability = item.reliability ? RELIABILITY_META[item.reliability] : null;
  return (
    <Card className="border-border/40">
      <CardContent className="py-3 space-y-2">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="font-medium">
            {item.other_drug}
            {item.other_drug_atc && (
              <span className="text-xs text-muted-foreground font-mono ml-2">{item.other_drug_atc}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            {item.severity_label && (
              <Badge variant="outline" className="text-[10px]">{item.severity_label}</Badge>
            )}
            {reliability && (
              <Badge variant="outline" className={`text-[10px] ${reliability.cls}`} title={reliability.tip}>
                {item.reliability}
              </Badge>
            )}
            {item.source && (
              <Badge variant="outline" className="text-[10px]">{item.source}</Badge>
            )}
          </div>
        </div>

        {item.mechanism && (
          <div className="text-xs">
            <span className="text-muted-foreground">機制：</span>
            <span>{item.mechanism}</span>
          </div>
        )}
        {item.management && (
          <div className="text-xs">
            <span className="text-muted-foreground">處置：</span>
            <span>{item.management}</span>
          </div>
        )}
        {item.discussion && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground">詳細討論</summary>
            <div className="mt-1 pl-2 border-l-2 border-border/40 whitespace-pre-wrap">
              {item.discussion}
            </div>
          </details>
        )}
        {item.pubmed_count > 0 && (
          <div className="text-xs text-muted-foreground">
            {item.pubmed_count} 篇文獻引用
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RiskGroup({
  risk,
  items,
  defaultOpen,
}: {
  risk: string;
  items: DdiDetailItem[];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const meta = RISK_META[risk];
  if (!meta || items.length === 0) return null;
  return (
    <div className="space-y-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-sm font-semibold hover:bg-accent rounded p-2 transition-colors"
      >
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        <span className={`px-2 py-0.5 rounded border ${meta.cls}`}>{risk}</span>
        <span className="text-muted-foreground font-normal">— {meta.descr} ({items.length})</span>
      </button>
      {open && (
        <div className="space-y-2 pl-6">
          {items.map((it) => <DdiCard key={it.id} item={it} />)}
        </div>
      )}
    </div>
  );
}

function IvCompatList({ items }: { items: IvCompatItem[] }) {
  if (items.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center">
        系統未收錄此藥的 IV 相容性資料
      </div>
    );
  }
  const compatible = items.filter((i) => i.compatible);
  const incompatible = items.filter((i) => !i.compatible);
  const sectionRender = (label: string, list: IvCompatItem[], cls: string) => (
    list.length > 0 && (
      <div className="space-y-1.5">
        <div className={`text-xs font-semibold ${cls}`}>{label} ({list.length})</div>
        <div className="space-y-1.5">
          {list.map((it) => (
            <Card key={it.id} className="border-border/40">
              <CardContent className="py-2.5 space-y-1">
                <div className="flex items-start justify-between gap-2 flex-wrap text-sm">
                  <span className="font-medium">{it.other_drug}</span>
                  <div className="flex items-center gap-1 text-[10px]">
                    {it.solution && <Badge variant="outline" className="text-[10px]">溶液 {it.solution}</Badge>}
                    {it.time_stability && (
                      <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                        穩定 {it.time_stability}
                      </Badge>
                    )}
                    {it.source && <Badge variant="outline" className="text-[10px]">{it.source}</Badge>}
                  </div>
                </div>
                {it.notes && (
                  <div className="text-xs text-muted-foreground">{it.notes}</div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  );
  return (
    <div className="space-y-3">
      {sectionRender('相容', compatible, 'text-emerald-400')}
      {sectionRender('不相容', incompatible, 'text-rose-400')}
    </div>
  );
}

type TabKey = 'ddi' | 'iv';

export function DrugLibraryDetailPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<DrugDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('ddi');
  const [riskFilter, setRiskFilter] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!name) return;
    setLoading(true);
    setError(null);
    getDrugDetail(name)
      .then((d) => setData(d))
      .catch((e) => setError(e?.message || '載入失敗'))
      .finally(() => setLoading(false));
  }, [name]);

  const grouped = useMemo(() => {
    const m: Record<string, DdiDetailItem[]> = { X: [], D: [], C: [], B: [], A: [] };
    data?.ddi.forEach((d) => {
      if (m[d.risk_rating]) m[d.risk_rating].push(d);
    });
    return m;
  }, [data]);

  const toggleRisk = (r: string) => {
    setRiskFilter((s) => {
      const next = new Set(s);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  };

  const visibleRisks = riskFilter.size === 0 ? ['X', 'D', 'C', 'B', 'A'] : Array.from(riskFilter);
  const ivCount = data?.iv_compatibility?.length || 0;

  const tabClass = (k: TabKey) =>
    `px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
      tab === k ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
    }`;

  return (
    <div className="container mx-auto p-4 lg:p-6 space-y-4 max-w-screen-xl">
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/pharmacy/drug-library')}
          className="-ml-2"
        >
          <ArrowLeft className="size-4 mr-1" /> 回藥物資料庫
        </Button>
      </div>

      {loading && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="size-4 animate-spin" /> 載入中
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-rose-500/40">
          <CardContent className="py-4 text-rose-400 text-sm">{error}</CardContent>
        </Card>
      )}

      {data && !data.exists && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            找不到藥物 <span className="font-mono">{name}</span> 的資料
          </CardContent>
        </Card>
      )}

      {data && data.exists && (
        <>
          <Card className="bg-card/60">
            <CardContent className="py-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-2xl font-bold">{data.name}</h1>
                    {data.atc && (
                      <Badge variant="outline" className="font-mono">{data.atc}</Badge>
                    )}
                    {data.in_formulary ? (
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30">院內 formulary</Badge>
                    ) : (
                      <Badge variant="outline" className="bg-zinc-500/10 text-zinc-400 border-zinc-500/30">院外</Badge>
                    )}
                  </div>
                  {data.atc_path.length > 0 && (
                    <div className="text-xs text-muted-foreground mt-2 flex items-center gap-1 flex-wrap">
                      ATC 階層：
                      {data.atc_path.map((p, i) => (
                        <span key={p.code} className="flex items-center gap-1">
                          {i > 0 && <span className="text-muted-foreground">/</span>}
                          <span className="font-mono">{p.code}</span>
                          {p.name && <span>{p.name}</span>}
                        </span>
                      ))}
                    </div>
                  )}
                  {(data.brand_names.length > 0 || data.hospital_codes.length > 0) && (
                    <div className="text-xs text-muted-foreground mt-2">
                      {data.brand_names.length > 0 && <>商品 {data.brand_names.join(' · ')}</>}
                      {data.brand_names.length > 0 && data.hospital_codes.length > 0 && ' · '}
                      {data.hospital_codes.length > 0 && <>院內代碼 {data.hospital_codes.join(' · ')}</>}
                    </div>
                  )}
                </div>
              </div>

              {data.sources.length > 0 && (
                <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                  資料源：
                  {data.sources.map((s) => (
                    <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-0 px-0">
              <div className="border-b border-border/40 flex items-center gap-2 px-3">
                <button onClick={() => setTab('ddi')} className={tabClass('ddi')}>
                  交互作用 ({data.ddi_total})
                </button>
                <button onClick={() => setTab('iv')} className={tabClass('iv')}>
                  IV 相容性 ({ivCount})
                </button>
              </div>

              <div className="py-4 px-4">
                {tab === 'ddi' && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5 text-xs flex-wrap">
                      {(['X', 'D', 'C', 'B', 'A'] as const).map((r) => {
                        const count = data.ddi_by_risk[r];
                        if (count === 0) return null;
                        const meta = RISK_META[r];
                        const active = riskFilter.has(r);
                        return (
                          <button
                            key={r}
                            onClick={() => toggleRisk(r)}
                            className={`px-2 py-0.5 rounded border text-[11px] transition-opacity ${meta.cls} ${active || riskFilter.size === 0 ? '' : 'opacity-30'}`}
                          >
                            {r} {count}
                          </button>
                        );
                      })}
                      {riskFilter.size > 0 && (
                        <button
                          onClick={() => setRiskFilter(new Set())}
                          className="text-xs text-muted-foreground hover:text-foreground ml-2"
                        >
                          清除篩選
                        </button>
                      )}
                    </div>

                    <div className="space-y-3">
                      {visibleRisks.map((r) => (
                        <RiskGroup
                          key={r}
                          risk={r}
                          items={grouped[r] || []}
                          defaultOpen={r === 'X' || r === 'D'}
                        />
                      ))}
                      {data.ddi_total === 0 && (
                        <div className="text-sm text-muted-foreground text-center py-4">
                          系統未收錄此藥的交互作用規則
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {tab === 'iv' && (
                  <IvCompatList items={data.iv_compatibility || []} />
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="py-3 text-xs text-amber-400">
              <span className="font-semibold">資料缺口提示：</span>
              未列規則 ≠ 安全。本系統來源主要為 Lexicomp + MICROMEDEX，罕見組合 / 中草藥 / 食物交互可能未涵蓋。IV 相容性以 Trissel's Handbook 為主，未列組合請諮詢藥劑科。
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
