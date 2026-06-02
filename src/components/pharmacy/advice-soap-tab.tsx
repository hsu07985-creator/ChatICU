// SOAP tab body for the advice-statistics page, extracted from
// src/pages/pharmacy/advice-statistics.tsx (TC-FU-T2). Presentational: the page
// owns the data fetch and search state. Behavior-preserving.

import { useTranslation } from 'react-i18next';
import i18n from '../../i18n/config';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { LoadingSpinner, EmptyState } from '../ui/state-display';
import { NotebookPen, User } from 'lucide-react';
import { maskPatientName } from '../../lib/utils/patient-name';
import type { PharmacySoapRecord } from '../../lib/api/pharmacy';

export interface AdviceSoapTabProps {
  soapRecords: PharmacySoapRecord[];
  soapLoading: boolean;
  soapSearch: string;
  onSoapSearchChange: (value: string) => void;
  monthLabel: string;
}

export function AdviceSoapTab({
  soapRecords,
  soapLoading,
  soapSearch,
  onSoapSearchChange,
  monthLabel,
}: AdviceSoapTabProps) {
  const { t } = useTranslation('pharmacy');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <NotebookPen className="h-4 w-4" />
          {t('adviceStats.soapTitle')}
          <Badge variant="secondary">{t('adviceStats.soapCount', { count: soapRecords.length })}</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t('adviceStats.soapSubtitle')}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={soapSearch}
            onChange={(e) => onSoapSearchChange(e.target.value)}
            placeholder={t('adviceStats.soapSearchPlaceholder')}
            className="flex-1 h-9 rounded-md border border-slate-300 bg-white dark:bg-slate-900 dark:border-slate-700 px-3 text-sm"
          />
          {soapSearch && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9"
              onClick={() => onSoapSearchChange('')}
            >
              {t('adviceStats.clear')}
            </Button>
          )}
        </div>

        {soapLoading ? (
          <LoadingSpinner text={t('adviceStats.loadingSoap')} />
        ) : soapRecords.length > 0 ? (
          <ScrollArea className="h-[520px] pr-4">
            <div className="space-y-3">
              {soapRecords.map((record) => (
                <div
                  key={record.id}
                  className="border rounded-lg p-3 hover:shadow-md transition-shadow bg-white dark:bg-slate-900 dark:border-slate-700"
                >
                  <div className="flex items-start justify-between mb-2 flex-wrap gap-2">
                    <div className="flex items-center gap-2 text-sm">
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-medium">
                        {record.bedNumber || '—'} {maskPatientName(record.patientName || '')}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {record.pharmacistName}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(record.createdAt).toLocaleString(i18n.language, {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Asia/Taipei',
                      })}
                    </span>
                  </div>

                  <div className="grid gap-2 md:grid-cols-2">
                    {record.subjective && (
                      <div className="rounded border border-slate-200 dark:border-slate-700 p-2">
                        <div className="text-xs font-semibold text-slate-500 mb-1">{t('adviceStats.soapSections.subjective')}</div>
                        <p className="text-sm whitespace-pre-line line-clamp-4">{record.subjective}</p>
                      </div>
                    )}
                    {record.objective && (
                      <div className="rounded border border-slate-200 dark:border-slate-700 p-2">
                        <div className="text-xs font-semibold text-slate-500 mb-1">{t('adviceStats.soapSections.objective')}</div>
                        <p className="text-sm whitespace-pre-line line-clamp-4 font-mono">{record.objective}</p>
                      </div>
                    )}
                    {record.assessment && (
                      <div className="rounded border border-sky-200 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/20 p-2">
                        <div className="text-xs font-semibold text-sky-700 dark:text-sky-300 mb-1">{t('adviceStats.soapSections.assessment')}</div>
                        <p className="text-sm whitespace-pre-line line-clamp-4">{record.assessment}</p>
                      </div>
                    )}
                    {record.plan && (
                      <div className="rounded border border-sky-200 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/20 p-2">
                        <div className="text-xs font-semibold text-sky-700 dark:text-sky-300 mb-1">{t('adviceStats.soapSections.plan')}</div>
                        <p className="text-sm whitespace-pre-line line-clamp-4 font-mono">{record.plan}</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <EmptyState
            icon={NotebookPen}
            title={t('adviceStats.noSoapTitle', { label: monthLabel })}
            description={t('adviceStats.noSoapDesc')}
          />
        )}
      </CardContent>
    </Card>
  );
}
