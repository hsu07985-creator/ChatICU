import { ArrowLeft, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { useAuth } from '../../../lib/auth-context';
import { useEditMode } from '../../../lib/drug-library-edit-mode';
import {
  type DdiDetailItem,
  type DrugDetail,
  type IvCompatItem,
  getDrugDetail,
} from '../../../lib/api/drug-library';
import { RiskGroup } from './ddi-card';
import { RISK_META } from './shared';

function IvCompatList({ items }: { items: IvCompatItem[] }) {
  const { t } = useTranslation('pharmacy');
  if (items.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center">
        {t('library.detail.iv.noData')}
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
                    {it.solution && <Badge variant="outline" className="text-[10px]">{t('library.detail.iv.solution', { value: it.solution })}</Badge>}
                    {it.time_stability && (
                      <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                        {t('library.detail.iv.stable', { value: it.time_stability })}
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
      {sectionRender(t('library.detail.compatibility.compatibleHeading'), compatible, 'text-emerald-400')}
      {sectionRender(t('library.detail.compatibility.incompatibleHeading'), incompatible, 'text-rose-400')}
    </div>
  );
}

type TabKey = 'ddi' | 'iv';

export function DrugLibraryDetailPage() {
  const { t } = useTranslation('pharmacy');
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isPharmOrAdmin = user?.role === 'pharmacist' || user?.role === 'admin';
  const [editMode, setEditMode] = useEditMode();

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
      .catch((e) => setError(e?.message || t('library.detail.header.loadError')))
      .finally(() => setLoading(false));
  }, [name]);

  // Local optimistic update so a saved note/verify doesn't require full reload
  const onItemChange = (id: string, updates: Partial<DdiDetailItem>) => {
    setData((cur) => {
      if (!cur) return cur;
      return {
        ...cur,
        ddi: cur.ddi.map((d) => (d.id === id ? { ...d, ...updates } : d)),
      };
    });
  };

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
      <div className="flex items-center justify-between gap-2 flex-wrap pr-12 lg:pr-14">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/pharmacy/drug-library')}
          className="-ml-2"
        >
          <ArrowLeft className="size-4 mr-1" /> {t('library.detail.header.back')}
        </Button>
        {isPharmOrAdmin && (
          <div className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">{t('library.detail.header.modeLabel')}</span>
            <Button
              size="sm"
              variant={editMode ? 'outline' : 'default'}
              onClick={() => setEditMode(false)}
              className="h-7 text-xs"
            >
              {t('library.detail.header.modeView')}
            </Button>
            <Button
              size="sm"
              variant={editMode ? 'default' : 'outline'}
              onClick={() => setEditMode(true)}
              className="h-7 text-xs"
            >
              {t('library.detail.header.modeEdit')}
            </Button>
          </div>
        )}
      </div>

      {loading && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="size-4 animate-spin" /> {t('library.detail.page.loading')}
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
            {t('library.detail.page.notFound', { name: '' })}<span className="font-mono">{name}</span>
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
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30">{t('library.detail.header.inFormularyBadge')}</Badge>
                    ) : (
                      <Badge variant="outline" className="bg-zinc-500/10 text-zinc-400 border-zinc-500/30">{t('library.detail.header.externalBadge')}</Badge>
                    )}
                  </div>
                  {data.atc_path.length > 0 && (
                    <div className="text-xs text-muted-foreground mt-2 flex items-center gap-1 flex-wrap">
                      {t('library.detail.page.atcPath')}
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
                      {data.brand_names.length > 0 && <>{t('library.detail.page.brand')} {data.brand_names.join(' · ')}</>}
                      {data.brand_names.length > 0 && data.hospital_codes.length > 0 && ' · '}
                      {data.hospital_codes.length > 0 && <>{t('library.detail.page.hospitalCode')} {data.hospital_codes.join(' · ')}</>}
                    </div>
                  )}
                </div>
              </div>

              {data.sources.length > 0 && (
                <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                  {t('library.detail.page.sourcesLabel')}
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
                  {t('library.detail.page.ddiTab', { count: data.ddi_total })}
                </button>
                <button onClick={() => setTab('iv')} className={tabClass('iv')}>
                  {t('library.detail.page.ivTab', { count: ivCount })}
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
                          {t('library.detail.page.clearFilter')}
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
                          editMode={editMode && isPharmOrAdmin}
                          onItemChange={onItemChange}
                        />
                      ))}
                      {data.ddi_total === 0 && (
                        <div className="text-sm text-muted-foreground text-center py-4">
                          {t('library.detail.page.noDdi')}
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
              <span className="font-semibold">{t('library.detail.gap.title')}</span>
              {t('library.detail.gap.body')}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
