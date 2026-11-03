'use client';

import { CheckIcon, PlusIcon, XIcon } from 'lucide-react';
import { Hint } from '@/components/hint';
import { TagInput } from '@/components/tag-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CONDITION_OPS, ROUTE_LIMITS, type ConditionOp, type RouteCondition } from '@/lib/job-spec';
import { OP_LABELS, patternProblem } from '@/lib/routes';
import type { RouteCheckView } from '@/lib/types';
import { cn } from '@/lib/utils';
import { FieldPicker, type PickedField } from './field-picker';

/** A new condition: no field yet, "is not empty". */
export const newCondition = (): RouteCondition => ({ field: '', op: 'notEmpty' });

/** The condition with another operator, keeping its field and what it can of its value. */
function withOp(condition: RouteCondition, op: ConditionOp): RouteCondition {
  const text = condition.op === 'equals' ? condition.value : condition.op === 'oneOf' ? (condition.values[0] ?? '') : condition.op === 'matches' ? condition.pattern : '';
  const { field } = condition;
  if (op === 'equals') return { field, op, value: text };
  if (op === 'oneOf') return { field, op, values: condition.op === 'oneOf' ? condition.values : text ? [text] : [] };
  if (op === 'matches') return { field, op, pattern: text };
  return { field, op };
}

/** The value a field has in the page group shown, short. */
const shortValue = (value: string): string => (value.length > 24 ? `${value.slice(0, 23)}…` : value);

/**
 * The conditions of one route, one row each: the field, the operator, the value, the
 * field's value in the page group shown and whether the condition matches it. Every
 * condition must match for the route to take a document.
 */
export function RouteConditions({
  route,
  conditions,
  fields,
  check,
  readOnly,
  onChange,
}: {
  /** The route's number, counted from 0, for the labels. */
  route: number;
  conditions: RouteCondition[];
  /** The fields of the page group shown, with their values; null before the preview. */
  fields: readonly PickedField[] | null;
  /** The route checked against the page group shown; null before the preview. */
  check: RouteCheckView | null;
  readOnly: boolean;
  onChange(conditions: RouteCondition[], debounce?: boolean): void;
}) {
  const set = (at: number, condition: RouteCondition, debounce = false) => onChange(conditions.map((c, i) => (i === at ? condition : c)), debounce);
  const id = (at: number, part: string) => `route-${route}-condition-${at}-${part}`;
  const full = conditions.length >= ROUTE_LIMITS.conditions;
  return (
    <div className="flex flex-col gap-2">
      {conditions.length > 0 && (
        <ul className="flex flex-col gap-2">
          {conditions.map((condition, at) => {
            const found = fields?.find((field) => field.path === condition.field);
            const value = !condition.field || fields === null ? null : found && found.value !== null ? (found.value ? `‹${shortValue(found.value)}›` : 'empty') : 'Not in the data';
            const result = check?.conditions[at];
            const invalidPattern = condition.op === 'matches' && !!condition.pattern && patternProblem(condition.pattern) !== null;
            return (
              <li key={at} className="flex flex-wrap items-center gap-2">
                {at > 0 && <span className="w-full text-muted-foreground text-xs sm:w-auto">and</span>}
                <FieldPicker
                  fields={fields ?? []}
                  disabled={readOnly}
                  onPick={(path) => set(at, { ...condition, field: path })}
                  label={condition.field ? `Field of condition ${at + 1}: ${condition.field}` : `Pick the field of condition ${at + 1}`}
                  hint={fields === null ? 'Pick a sample spooled file to see the fields.' : undefined}
                  className={cn('max-w-56 justify-start font-mono', !condition.field && 'font-sans text-muted-foreground')}
                >
                  <span className="truncate">{condition.field || 'Pick a field'}</span>
                </FieldPicker>
                <Select value={condition.op} onValueChange={(op) => set(at, withOp(condition, op as ConditionOp))} disabled={readOnly}>
                  <SelectTrigger aria-label={`Operator of condition ${at + 1}`} className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONDITION_OPS.map((op) => (
                      <SelectItem key={op} value={op}>
                        {OP_LABELS[op]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {condition.op === 'equals' && (
                  <Input
                    id={id(at, 'value')}
                    value={condition.value}
                    onChange={(event) => set(at, { ...condition, value: event.target.value.slice(0, ROUTE_LIMITS.valueLength) }, true)}
                    placeholder="SE"
                    aria-label={`Value of condition ${at + 1}`}
                    aria-invalid={!condition.value.trim() || undefined}
                    disabled={readOnly}
                    spellCheck={false}
                    className="w-40 flex-1 font-mono"
                  />
                )}
                {condition.op === 'oneOf' && (
                  <Hint text={condition.values.length >= ROUTE_LIMITS.values ? `A condition takes up to ${ROUTE_LIMITS.values} values.` : undefined}>
                    <div className="min-w-48 flex-1">
                      <TagInput
                        id={id(at, 'values')}
                        value={condition.values}
                        onChange={(values) => set(at, { ...condition, values })}
                        placeholder="SE, FI, NO"
                        maxLength={ROUTE_LIMITS.valueLength}
                        max={ROUTE_LIMITS.values}
                        text
                        disabled={readOnly}
                        label={`Values of condition ${at + 1}`}
                      />
                    </div>
                  </Hint>
                )}
                {condition.op === 'matches' && (
                  <Input
                    id={id(at, 'pattern')}
                    value={condition.pattern}
                    onChange={(event) => set(at, { ...condition, pattern: event.target.value.slice(0, ROUTE_LIMITS.valueLength) }, true)}
                    placeholder="^INV"
                    aria-label={`Pattern of condition ${at + 1}, a regular expression`}
                    aria-invalid={!condition.pattern || invalidPattern || undefined}
                    title={invalidPattern ? 'Not a valid regular expression' : undefined}
                    disabled={readOnly}
                    spellCheck={false}
                    className="w-40 flex-1 font-mono"
                  />
                )}
                {value && (
                  <span className={cn('rounded px-1 font-mono text-xs', value === 'Not in the data' ? 'text-destructive' : 'bg-muted text-muted-foreground')}>{value}</span>
                )}
                {result && (
                  <Hint text={result.ok ? 'The page group shown matches this condition.' : result.reason}>
                    <span
                      className={cn('inline-flex size-5 items-center justify-center rounded-full', result.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive')}
                      role="img"
                      aria-label={result.ok ? 'Matches' : `Does not match: ${result.reason}`}
                      tabIndex={0}
                    >
                      {result.ok ? <CheckIcon className="size-4" /> : <XIcon className="size-4" />}
                    </span>
                  </Hint>
                )}
                {!readOnly && (
                  <Hint text="Removes this condition from the route.">
                    <Button size="icon-sm" variant="ghost" aria-label={`Remove condition ${at + 1}`} onClick={() => onChange(conditions.filter((_, i) => i !== at))}>
                      <XIcon />
                    </Button>
                  </Hint>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!readOnly && (
        <div>
          <Hint text={full ? `A route has up to ${ROUTE_LIMITS.conditions} conditions. Add another route for more.` : undefined}>
            <Button size="xs" variant="outline" onClick={() => onChange([...conditions, newCondition()])} disabled={full}>
              <PlusIcon />
              Add a condition
            </Button>
          </Hint>
        </div>
      )}
    </div>
  );
}
