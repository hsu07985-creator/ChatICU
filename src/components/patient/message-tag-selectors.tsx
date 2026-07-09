import { useState } from 'react';
import { ChevronRight, Pill, Plus, Tag, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Separator } from '../ui/separator';
import { getAdviceCategoryKeyByLabel } from '../../lib/pharmacy-master-data';

export interface PharmacyTagCategory {
  category: string;
  tags: string[];
}

export interface CustomTagInfo {
  id: string;
  name: string;
  createdByName: string;
}

export function TagSelector({
  presetTags,
  existingTags,
  onAdd,
  customTags,
  onCreateCustomTag,
  onDeleteCustomTag,
}: {
  presetTags: string[];
  existingTags: string[];
  onAdd: (tag: string) => void;
  customTags?: CustomTagInfo[];
  onCreateCustomTag?: (name: string) => void | Promise<void>;
  onDeleteCustomTag?: (tagId: string) => void | Promise<void>;
}) {
  const { t } = useTranslation('patient-chat');
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [showManage, setShowManage] = useState(false);

  const existingSet = new Set(existingTags);
  const customNameSet = new Set((customTags ?? []).map((t) => t.name));
  const suggestions = presetTags.filter((t) => !existingSet.has(t));

  const handleSelect = (tag: string) => {
    onAdd(tag);
    setInputValue('');
    setOpen(false);
  };

  const handleCustom = async () => {
    const trimmed = inputValue.trim();
    if (trimmed && !existingSet.has(trimmed) && trimmed.length <= 30) {
      // If it's not in preset tags, also save as shared custom tag
      if (!presetTags.includes(trimmed) && onCreateCustomTag) {
        await onCreateCustomTag(trimmed);
      }
      onAdd(trimmed);
      setInputValue('');
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setShowManage(false); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-2 h-7 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <Tag className="h-3.5 w-3.5" />
          {t('messages.tagSelectorTrigger')}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <div className="space-y-2">
          <div className="flex gap-1">
            <Input
              placeholder={t('messages.addTagPlaceholder')}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleCustom(); } }}
              className="h-7 text-xs"
            />
            <Button size="sm" className="h-7 px-2" onClick={() => void handleCustom()} disabled={!inputValue.trim()}>
              <Plus className="h-3 w-3" />
            </Button>
          </div>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {suggestions.map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className={`text-xs cursor-pointer ${
                    customNameSet.has(tag)
                      ? 'hover:bg-emerald-50 border-emerald-200 text-emerald-700'
                      : 'hover:bg-indigo-50'
                  }`}
                  onClick={() => handleSelect(tag)}
                >
                  <Plus className="h-2.5 w-2.5 mr-0.5" />
                  {tag}
                </Badge>
              ))}
            </div>
          )}
          {(customTags ?? []).length > 0 && onDeleteCustomTag && (
            <>
              <Separator />
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left"
                onClick={() => setShowManage(!showManage)}
              >
                {showManage ? t('messages.collapseManage') : t('messages.manageCustomTags')}
                {!showManage && ` (${customTags!.length})`}
              </button>
              {showManage && (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {customTags!.map((ct) => (
                    <div key={ct.id} className="flex items-center justify-between group px-1 py-0.5 rounded hover:bg-slate-50">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Badge variant="outline" className="text-xs border-emerald-200 text-emerald-700 shrink-0">
                          {ct.name}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground truncate">
                          {ct.createdByName}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-600 shrink-0 ml-1"
                        onClick={() => void onDeleteCustomTag(ct.id)}
                        title={t('messages.deleteCustomTagTitle')}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  '建議處方': { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  '主動建議': { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  '建議監測': { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300' },
  '用藥連貫性': { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
};

export function PharmacyTagSelector({
  categories,
  existingTags,
  onAdd,
}: {
  categories: PharmacyTagCategory[];
  existingTags: string[];
  onAdd: (tags: string[]) => void;
}) {
  const { t } = useTranslation('patient-chat');
  const { t: tp } = useTranslation('pharmacy');
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const existingSet = new Set(existingTags);
  const renderCatLabel = (chineseLabel: string) => {
    const key = getAdviceCategoryKeyByLabel(chineseLabel);
    return key ? tp(`adviceCategories.${key}`) : chineseLabel;
  };

  const toggleExpand = (cat: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handleSelect = (tag: string, category: string) => {
    const toAdd: string[] = [];
    if (!existingSet.has(category)) toAdd.push(category);
    if (!existingSet.has(tag)) toAdd.push(tag);
    if (toAdd.length > 0) onAdd(toAdd);
    setOpen(false);
  };

  if (categories.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-2 h-7 text-xs text-green-700 hover:bg-green-50 hover:text-green-800 transition-colors"
        >
          <Pill className="h-3.5 w-3.5" />
          {t('messages.pharmacyTagSelectorTrigger')}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0 max-h-80 overflow-y-auto" align="start">
        {categories.map((cat) => {
          const colors = CATEGORY_COLORS[cat.category] || CATEGORY_COLORS['建議處方'];
          const isExpanded = expanded.has(cat.category);
          const availableTags = cat.tags.filter((t) => !existingSet.has(t));
          return (
            <div key={cat.category} className="border-b last:border-b-0">
              <button
                type="button"
                className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium ${colors.bg} ${colors.text} hover:opacity-80 transition-opacity`}
                onClick={() => toggleExpand(cat.category)}
              >
                <span className="flex items-center gap-1.5">
                  {renderCatLabel(cat.category)}
                  <span className="text-[10px] opacity-60">({cat.tags.length})</span>
                </span>
                <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
              </button>
              {isExpanded && (
                <div className="px-2 py-1.5 space-y-0.5">
                  {availableTags.length === 0 ? (
                    <div className="text-[10px] text-slate-400 px-1 py-0.5">{t('messages.allSelected')}</div>
                  ) : (
                    availableTags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className={`w-full text-left px-2 py-1 rounded text-xs hover:${colors.bg} transition-colors`}
                        onClick={() => handleSelect(tag, cat.category)}
                      >
                        <Plus className="h-2.5 w-2.5 mr-1 inline" />
                        {tag}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
