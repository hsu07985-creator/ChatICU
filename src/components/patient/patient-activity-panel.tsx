import { Activity, Clock, RefreshCw, User, ChevronRight, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
export interface PatientMessageActivityItem {
  patientId: string;
  patientName: string;
  bedNumber?: string;
  unreadCount: number;
  tags: string[];
  taggedCount: number;
  latestContent: string;
  latestAuthorName: string;
  latestAuthorRole: string;
  latestTimestamp: string;
}

// 標籤色彩映射
const TAG_STYLE: Record<string, string> = {
  '急件': 'bg-red-100 text-red-700 border-red-200',
  '急診優先': 'bg-red-100 text-red-700 border-red-200',
  'TDM': 'bg-amber-100 text-amber-700 border-amber-200',
  '需追蹤': 'bg-amber-100 text-amber-700 border-amber-200',
  '已處理': 'bg-green-100 text-green-700 border-green-200',
  '感控': 'bg-purple-100 text-purple-700 border-purple-200',
};
const DEFAULT_TAG_STYLE = 'bg-indigo-50 text-indigo-700 border-indigo-200';

const ROLE_LABEL: Record<string, string> = {
  doctor: '醫師',
  nurse: '護理師',
  pharmacist: '藥師',
  admin: '管理者',
};

const HOURS_OPTIONS = [
  { label: '24 小時', value: 24 },
  { label: '48 小時', value: 48 },
  { label: '7 天', value: 168 },
];

interface PatientActivityPanelProps {
  activity: PatientMessageActivityItem[];
  loading: boolean;
  hoursBack: number;
  onHoursBackChange: (hours: number) => void;
  onRefresh: () => void;
  selectedTag: string | null;
  onTagFilter: (tag: string | null) => void;
  onPatientClick: (patientId: string) => void;
}

export function PatientActivityPanel({
  activity,
  loading,
  hoursBack,
  onHoursBackChange,
  onRefresh,
  selectedTag,
  onTagFilter,
  onPatientClick,
}: PatientActivityPanelProps) {
  // Collect all unique tags for the filter bar
  const allTags = Array.from(new Set(activity.flatMap((a: PatientMessageActivityItem) => a.tags)));

  const filtered = selectedTag
    ? activity.filter((a) => a.tags.includes(selectedTag))
    : activity;

  return (
    <Card>
      <CardHeader className="bg-slate-50 dark:bg-slate-800 pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Activity className="h-4 w-4 text-brand" />
            病患留言動態
            {filtered.length > 0 && (
              <Badge className="bg-brand text-white text-xs ml-1">{filtered.length}</Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-1">
            <select
              className="text-xs border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400"
              value={hoursBack}
              onChange={(e) => onHoursBackChange(Number(e.target.value))}
            >
              {HOURS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onRefresh} disabled={loading}>
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-2 space-y-2">
        {/* Tag filter bar */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {allTags.map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className={`text-xs cursor-pointer transition-colors ${
                  selectedTag === tag
                    ? 'bg-brand text-white border-brand'
                    : TAG_STYLE[tag] || DEFAULT_TAG_STYLE
                }`}
                onClick={() => onTagFilter(selectedTag === tag ? null : tag)}
              >
                {tag}
              </Badge>
            ))}
            {selectedTag && (
              <Button variant="ghost" size="sm" className="h-5 text-xs px-1 text-slate-500" onClick={() => onTagFilter(null)}>
                <X className="h-2.5 w-2.5 mr-0.5" />
                清除
              </Button>
            )}
          </div>
        )}

        {/* Activity list */}
        <ScrollArea className="max-h-[300px]">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-sm text-slate-400 dark:text-slate-500">
              <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              載入中...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <Activity className="h-12 w-12 text-slate-300 mb-4" />
              <p className="text-xs text-slate-400 dark:text-slate-500">
                {selectedTag
                  ? `目前無「${selectedTag}」標籤的留言動態`
                  : `過去 ${HOURS_OPTIONS.find(o => o.value === hoursBack)?.label || hoursBack + 'h'} 內無標籤留言`}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((item) => (
                <button
                  key={item.patientId}
                  type="button"
                  className="w-full text-left rounded-lg border border-slate-200 dark:border-slate-700 p-2.5 hover:border-brand hover:bg-[#faf5f8] dark:hover:bg-slate-800 transition-colors group"
                  onClick={() => onPatientClick(item.patientId)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">{item.patientName}</span>
                      {item.bedNumber && (
                        <Badge variant="outline" className="text-xs">{item.bedNumber}</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {item.unreadCount > 0 && (
                        <Badge variant="destructive" className="text-xs">{item.unreadCount} 未讀</Badge>
                      )}
                      <ChevronRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-brand transition-colors" />
                    </div>
                  </div>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {item.tags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="outline"
                        className={`text-[9px] ${TAG_STYLE[tag] || DEFAULT_TAG_STYLE}`}
                      >
                        {tag}
                      </Badge>
                    ))}
                    <Badge variant="outline" className="text-[9px] bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700">
                      {item.taggedCount} 則
                    </Badge>
                  </div>

                  {/* Preview */}
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2">
                    {item.latestContent}
                  </p>

                  {/* Meta */}
                  <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-400 dark:text-slate-500">
                    <User className="h-2.5 w-2.5" />
                    <span>{item.latestAuthorName}</span>
                    <span className="text-slate-300">·</span>
                    <span>{ROLE_LABEL[item.latestAuthorRole] || item.latestAuthorRole}</span>
                    <span className="text-slate-300">·</span>
                    <Clock className="h-2.5 w-2.5" />
                    <span>{formatTimestamp(item.latestTimestamp)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  return date.toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
