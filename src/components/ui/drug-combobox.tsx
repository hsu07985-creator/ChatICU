import { forwardRef, useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { cn } from './utils';
import { buttonVariants } from './button';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './command';

interface DrugComboboxProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  drugList: string[];
  disabled?: boolean;
}

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
}: DrugComboboxProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
        className="w-[--radix-popover-trigger-width] max-h-[300px] overflow-hidden p-0"
        align="start"
        side="bottom"
        sideOffset={4}
        collisionPadding={8}
      >
        <Command>
          <CommandInput placeholder="輸入藥品名稱篩選..." />
          <CommandList style={{ maxHeight: 240, overflowY: 'auto' }}>
            <CommandEmpty>找不到符合的藥品</CommandEmpty>
            <CommandGroup>
              {drugList.map((drug) => (
                <CommandItem
                  key={drug}
                  value={drug}
                  onSelect={(selected) => {
                    onValueChange(selected === value ? '' : selected);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value?.toLowerCase() === drug.toLowerCase()
                        ? 'opacity-100'
                        : 'opacity-0',
                    )}
                  />
                  {drug}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
