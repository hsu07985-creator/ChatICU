import { forwardRef, useMemo, useState } from 'react';
import { Check, ChevronsUpDown, X, Search } from 'lucide-react';
import { cn } from './utils';
import { buttonVariants } from './button';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

interface DrugComboboxProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  drugList: string[];
  disabled?: boolean;
  /** Optional function to check if a drug has interaction data */
  checkHasData?: (drug: string) => boolean;
}

const MAX_DISPLAY = 50;

const TriggerButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { hasValue: boolean }
>(({ hasValue, className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(
      buttonVariants({ variant: 'outline' }),
      'w-full justify-between font-normal h-9',
      !hasValue && 'text-muted-foreground',
      className,
    )}
    {...props}
  />
));
TriggerButton.displayName = 'TriggerButton';

export function DrugCombobox({
  value,
  onValueChange,
  placeholder = '選擇藥品...',
  drugList,
  disabled,
  checkHasData,
}: DrugComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const startsWith: string[] = [];
    const contains: string[] = [];
    for (const drug of drugList) {
      const lower = drug.toLowerCase();
      if (lower.startsWith(q)) {
        startsWith.push(drug);
      } else if (lower.includes(q)) {
        contains.push(drug);
      }
      if (startsWith.length + contains.length >= MAX_DISPLAY) break;
    }
    return [...startsWith, ...contains].slice(0, MAX_DISPLAY);
  }, [search, drugList]);

  const totalMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return 0;
    let count = 0;
    for (const drug of drugList) {
      if (drug.toLowerCase().includes(q)) count++;
    }
    return count;
  }, [search, drugList]);

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setSearch(''); }}>
      <PopoverTrigger asChild>
        <TriggerButton
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          hasValue={!!value}
        >
          <span className="truncate">{value || placeholder}</span>
          <div className="flex items-center gap-1 ml-2 shrink-0">
            {value && (
              <X
                className="h-3.5 w-3.5 opacity-50 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onValueChange('');
                }}
              />
            )}
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
          </div>
        </TriggerButton>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] max-h-[340px] overflow-hidden p-0"
        align="start"
        side="bottom"
        sideOffset={4}
        collisionPadding={8}
      >
        {/* Search input */}
        <div className="flex h-9 items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 opacity-50" />
          <input
            className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="輸入藥品名稱篩選..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          {search && (
            <X
              className="size-3.5 shrink-0 opacity-50 hover:opacity-100 cursor-pointer"
              onClick={() => setSearch('')}
            />
          )}
        </div>

        {/* Results */}
        <div className="max-h-[260px] overflow-y-auto scroll-py-1 p-1">
          {!search.trim() ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              請輸入藥品名稱開始搜尋
            </p>
          ) : filtered.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              找不到符合的藥品
            </p>
          ) : (
            <>
              {filtered.map((drug) => {
                const noData = checkHasData ? !checkHasData(drug) : false;
                return (
                  <button
                    key={drug}
                    type="button"
                    className={cn(
                      'relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none',
                      'hover:bg-accent hover:text-accent-foreground',
                      value?.toLowerCase() === drug.toLowerCase() && 'bg-accent',
                      noData && 'opacity-60',
                    )}
                    onClick={() => {
                      onValueChange(drug === value ? '' : drug);
                      setOpen(false);
                      setSearch('');
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-1 h-4 w-4 shrink-0',
                        value?.toLowerCase() === drug.toLowerCase()
                          ? 'opacity-100'
                          : 'opacity-0',
                      )}
                    />
                    <HighlightMatch text={drug} query={search.trim()} />
                    {noData && (
                      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        尚未有資料
                      </span>
                    )}
                  </button>
                );
              })}
              {totalMatches > MAX_DISPLAY && (
                <p className="py-2 text-center text-xs text-muted-foreground">
                  顯示前 {MAX_DISPLAY} 筆，共 {totalMatches} 筆符合，請輸入更多字元縮小範圍
                </p>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Highlight the matching substring in the drug name */
function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <span>{text}</span>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, idx)}
      <span className="font-semibold text-foreground">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </span>
  );
}
