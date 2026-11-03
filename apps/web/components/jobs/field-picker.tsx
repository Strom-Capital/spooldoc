'use client';

import { useState, type ReactNode } from 'react';
import { Hint } from '@/components/hint';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/** A field a document has, with its value in the page group shown: "" when empty, null when it is not in the data. */
export interface PickedField {
  path: string;
  value: string | null;
}

/**
 * A button that opens the fields of the definition, such as `pg.email`, to find one and
 * pick it, each with its value in the page group shown. The email step puts the picked
 * field at the cursor; a route's condition reads it.
 */
export function FieldPicker({
  fields,
  disabled,
  onPick,
  hint,
  children,
  label,
  className,
}: {
  fields: readonly PickedField[];
  disabled?: boolean;
  onPick(path: string): void;
  hint?: string;
  /** The button's content. */
  children: ReactNode;
  /** The button's accessible name, when its content does not say it. */
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint text={hint}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={disabled || fields.length === 0} aria-label={label} className={cn(className)}>
            {children}
          </Button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Find a field" />
          <CommandList>
            <CommandEmpty>No field matches.</CommandEmpty>
            <CommandGroup>
              {fields.map((field) => (
                <CommandItem
                  key={field.path}
                  value={field.path}
                  onSelect={() => {
                    onPick(field.path);
                    setOpen(false);
                  }}
                >
                  <span className="font-mono text-xs">{field.path}</span>
                  <span className="ml-auto max-w-32 truncate text-muted-foreground text-xs">
                    {field.value === null ? 'not in the data' : field.value || 'empty'}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
