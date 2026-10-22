'use client';

import { BracesIcon, ChevronLeftIcon, ChevronRightIcon, FileIcon, FlaskConicalIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Hint } from '@/components/hint';
import { ErrorNote } from '@/components/page';
import { useWorkbench } from '@/components/workbench/workbench-provider';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { api, errorText } from '@/lib/client/api';
import { EMAIL_FIELDS, tagSegments, type EmailField } from '@/lib/email-fields';
import { emptyEmailSpec, FORMAT_FILES, FORMATS, type EmailSpec } from '@/lib/job-spec';
import type { DestinationView, EmailPreviewView, EmailSegment } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useJob } from './job-provider';

type EmailDestination = Extract<DestinationView, { kind: 'email' }>;

/** The text fields that hold addresses, in the order the form shows them. */
const ADDRESS_FIELDS = ['to', 'cc', 'bcc', 'replyTo'] as const;

/** How long the preview waits after typing before it asks again. */
const PREVIEW_DELAY_MS = 400;

/**
 * An input whose `{d.pg.field}` tags show highlighted, as in the template editor. The text
 * sits on a layer behind a transparent input, so the caret and the selection stay the
 * input's own.
 */
function TagInput({
  id,
  value,
  onChange,
  onFocus,
  inputRef,
  multiline,
  placeholder,
  disabled,
  invalid,
  describedBy,
}: {
  id: string;
  value: string;
  onChange(value: string): void;
  onFocus(): void;
  inputRef(element: HTMLInputElement | HTMLTextAreaElement | null): void;
  multiline?: boolean;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const box = cn(
    'w-full rounded-lg border px-2.5 text-base md:text-sm',
    multiline ? 'min-h-36 whitespace-pre-wrap break-words py-2 leading-6' : 'h-8 overflow-hidden whitespace-pre py-1 leading-6',
  );
  const common = {
    id,
    value,
    disabled,
    placeholder,
    spellCheck: false,
    'aria-invalid': invalid || undefined,
    'aria-describedby': describedBy,
    onFocus,
    onScroll: (event: React.UIEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (layer.current) {
        layer.current.scrollTop = event.currentTarget.scrollTop;
        layer.current.scrollLeft = event.currentTarget.scrollLeft;
      }
    },
    className: cn(
      box,
      'relative block resize-none border-input bg-transparent text-transparent caret-foreground outline-none transition-colors selection:bg-primary/25 selection:text-transparent placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20',
    ),
  };
  return (
    <div className="relative rounded-lg dark:bg-input/30">
      <div ref={layer} aria-hidden className={cn(box, 'pointer-events-none absolute inset-0 overflow-hidden border-transparent')}>
        {tagSegments(value).map((segment, index) =>
          segment.path ? (
            <span key={index} className="rounded-[2px] bg-[var(--syntax-template)] text-primary">
              {segment.text}
            </span>
          ) : (
            <span key={index}>{segment.text}</span>
          ),
        )}
        {multiline && '\n'}
      </div>
      {multiline ? (
        <textarea {...common} ref={inputRef} rows={6} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input {...common} ref={inputRef} onChange={(event) => onChange(event.target.value)} />
      )}
    </div>
  );
}

/** A label beside its field on wide screens, above it on narrow ones. */
function Row({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:gap-3">
      <Label htmlFor={htmlFor} className="sm:h-8 sm:justify-start">
        {label}
      </Label>
      <div className="flex min-w-0 flex-col gap-1">
        {children}
        {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
      </div>
    </div>
  );
}

/** The fields an email can read, to put one at the cursor of the field last in. */
function InsertField({ fields, disabled, onPick }: { fields: EmailPreviewView['fields']; disabled?: boolean; onPick(path: string): void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint text="Put a field of the definition at the cursor, in the field you were last in. Each email fills it in from its own page group.">
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={disabled || fields.length === 0}>
            <BracesIcon />
            Insert field
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
                  <span className="ml-auto max-w-32 truncate text-muted-foreground text-xs">{field.value || 'empty'}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** A filled-in field: values as text, each colored as the extraction report colors fields, a missing one by its tag. */
function Filled({ segments, flash }: { segments: EmailSegment[]; flash: boolean }) {
  if (segments.length === 0) return <span className="text-muted-foreground">None</span>;
  return (
    <span className={cn('min-w-0 break-words', flash && 'flash')}>
      {segments.map((segment, index) =>
        !segment.tag ? (
          <span key={index}>{segment.text}</span>
        ) : segment.state === 'found' ? (
          <span key={index}>{segment.text}</span>
        ) : (
          <span
            key={index}
            title={segment.state === 'empty' ? `${segment.tag} is empty in this page group` : `${segment.tag} is not in the data`}
            className="font-mono text-[0.8em] text-[var(--hit-missing)] underline decoration-[var(--hit-missing)] decoration-wavy underline-offset-4"
          >
            {segment.tag}
          </span>
        ),
      )}
    </span>
  );
}

const joined = (segments: EmailSegment[]): string => segments.map((segment) => segment.text || segment.tag || '').join('');

/** A row of the message header: From, To, Cc, Subject. */
function HeaderRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** Which email the preview shows: a page group's, or the whole spooled file's when `splf` is set and the run sends one. */
interface Shown {
  pageGroup: number;
  splf: boolean;
}

/**
 * The email of one page group, or of the whole spooled file, as the customer will get it:
 * the header, the files, and the message on paper. Previous and next step through the
 * page groups that get an email, then the whole spooled file's email last, and the values
 * that change get a short highlight.
 */
function EmailPreview({
  preview,
  previous,
  loading,
  error,
  onStep,
}: {
  preview: EmailPreviewView | null;
  previous: EmailPreviewView | null;
  loading: boolean;
  error: string | null;
  onStep(shown: Shown): void;
}) {
  const { sampleId } = useWorkbench();
  if (!sampleId) {
    return <p className="rounded-lg border border-dashed p-4 text-muted-foreground text-sm">Pick a preview spooled file to see the email.</p>;
  }
  if (error && !preview) return <ErrorNote>{error}</ErrorNote>;
  if (!preview) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border p-4" aria-busy="true" aria-label="Loading the email">
        {[0, 1, 2, 3].map((row) => (
          <Skeleton key={row} className="h-4 w-full" />
        ))}
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  // Only the values that changed since the last page group shown get the highlight.
  const stepped = previous !== null && previous.pageGroup !== preview.pageGroup;
  const changed = (pick: (view: EmailPreviewView) => EmailSegment[]) => stepped && joined(pick(previous)) !== joined(pick(preview));
  const from = preview.from;
  const key = preview.pageGroup ?? 'splf';
  const last = preview.pageGroups - 1;
  // Before and after the email shown, in the order a run sends them.
  const before: Shown | null =
    preview.pageGroup === null ? (preview.pageGroupEmails ? { pageGroup: last, splf: false } : null) : preview.pageGroup > 0 ? { pageGroup: preview.pageGroup - 1, splf: false } : null;
  const after: Shown | null =
    preview.pageGroup === null ? null : preview.pageGroup < last ? { pageGroup: preview.pageGroup + 1, splf: false } : preview.spooledFileEmail ? { pageGroup: last, splf: true } : null;
  const where = preview.pageGroup === null ? 'Whole spooled file' : `Page group ${preview.pageGroup + 1} of ${preview.pageGroups}`;
  return (
    <section aria-label="Email preview" className="overflow-hidden rounded-lg border bg-card">
      {preview.testAddress && (
        <p className="flex items-center gap-2 border-b bg-amber-500/10 px-4 py-2 text-amber-800 text-sm dark:text-amber-300">
          <FlaskConicalIcon className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">Test: this email goes to {preview.testAddress}.</span>
        </p>
      )}
      <dl className="border-b px-4 py-3 text-sm" aria-live="polite">
        <HeaderRow label="From">
          {from ? (
            <span className="break-words">{from.name ? `${from.name} <${from.address}>` : from.address}</span>
          ) : (
            <span className="text-muted-foreground">
              No mail server.{' '}
              <Link href="/settings#mail" className="text-primary hover:underline">
                Set one in Settings
              </Link>
            </span>
          )}
        </HeaderRow>
        <HeaderRow label="To">
          <Filled key={key} segments={preview.to} flash={changed((v) => v.to)} />
        </HeaderRow>
        {/* A test email goes to the test address only, so Cc and Bcc show as not sent. */}
        {preview.cc.length > 0 && (
          <HeaderRow label="Cc">
            {preview.testAddress ? (
              <span className="text-muted-foreground">
                <span className="line-through">
                  <Filled key={key} segments={preview.cc} flash={false} />
                </span>{' '}
                not sent in a test
              </span>
            ) : (
              <Filled key={key} segments={preview.cc} flash={changed((v) => v.cc)} />
            )}
          </HeaderRow>
        )}
        {preview.bcc.length > 0 && (
          <HeaderRow label="Bcc">
            {preview.testAddress ? (
              <span className="text-muted-foreground">
                <span className="line-through">
                  <Filled key={key} segments={preview.bcc} flash={false} />
                </span>{' '}
                not sent in a test
              </span>
            ) : (
              <Filled key={key} segments={preview.bcc} flash={changed((v) => v.bcc)} />
            )}
          </HeaderRow>
        )}
        {preview.replyTo.length > 0 && (
          <HeaderRow label="Reply-To">
            <Filled key={key} segments={preview.replyTo} flash={changed((v) => v.replyTo)} />
          </HeaderRow>
        )}
        <HeaderRow label="Subject">
          <span className="font-semibold">
            <Filled key={key} segments={preview.subject} flash={changed((v) => v.subject)} />
          </span>
        </HeaderRow>
      </dl>
      {preview.notices.length > 0 && (
        <ul className="flex flex-col gap-1 border-b bg-muted/40 px-4 py-2 text-muted-foreground text-sm">
          {preview.notices.map((notice) => (
            <li key={notice} className="flex items-start gap-2">
              <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              {notice}
            </li>
          ))}
        </ul>
      )}
      {preview.problems.length > 0 && (
        <ul className="flex flex-col gap-1 border-b bg-destructive/5 px-4 py-2 text-destructive text-sm">
          {preview.problems.map((problem) => (
            <li key={problem} className="flex items-start gap-2">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              {problem}
            </li>
          ))}
        </ul>
      )}
      {preview.attachments.length > 0 && (
        <ul aria-label="Attached files" className="flex flex-wrap gap-2 border-b px-4 py-2.5">
          {preview.attachments.map((file) => (
            <li key={file.name} className="flex min-w-0 items-center gap-2 rounded-md border bg-background px-2 py-1 text-xs">
              <FileIcon className="size-3.5 shrink-0 text-primary" aria-hidden />
              <span className="truncate">{file.name}</span>
              <span className="text-muted-foreground">{FORMAT_FILES[file.format].label}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="bg-muted/30 p-2">
        {preview.bodyError ? (
          <ErrorNote>{preview.bodyError}</ErrorNote>
        ) : (
          <iframe title="Message" sandbox="" srcDoc={preview.html} className="h-80 w-full rounded border bg-white" />
        )}
      </div>
      {preview.pageGroupEmails ? (
        <div className="flex items-center justify-between gap-2 border-t px-2 py-1.5">
          <Hint text="Show the email before this one.">
            <Button type="button" variant="ghost" size="sm" disabled={before === null} onClick={() => before && onStep(before)} aria-label="Previous email">
              <ChevronLeftIcon />
              Previous
            </Button>
          </Hint>
          <span className="tabular text-center text-muted-foreground text-sm" aria-live="polite">
            {where}
            {loading && <Spinner className="ml-1.5 inline size-3.5 align-[-2px]" aria-label="Loading the email" />}
          </span>
          <Hint text={after?.splf ? 'Show the email of the whole spooled file.' : 'Show the email after this one.'}>
            <Button type="button" variant="ghost" size="sm" disabled={after === null} onClick={() => after && onStep(after)} aria-label="Next email">
              Next
              <ChevronRightIcon />
            </Button>
          </Hint>
        </div>
      ) : (
        <p className="border-t px-4 py-2.5 text-center text-muted-foreground text-sm" aria-live="polite">
          {where}
          {loading && <Spinner className="ml-1.5 inline size-3.5 align-[-2px]" aria-label="Loading the email" />}
        </p>
      )}
    </section>
  );
}

/** The email shown, asked for again when the email changes (after a pause) or another one is picked. */
function useEmailPreview(email: EmailSpec, destinationId: string, shown: Shown) {
  const { pageGroup, splf } = shown;
  const { job } = useJob();
  const { sampleId, yaml } = useWorkbench();
  const [state, setState] = useState<{ preview: EmailPreviewView | null; previous: EmailPreviewView | null; error: string | null; loading: boolean }>({
    preview: null,
    previous: null,
    error: null,
    loading: false,
  });
  // The definition is part of the key, so the preview follows a change to it; the server reads it from the draft.
  const document = splf ? 'splf' : undefined;
  const body = useMemo(
    () => JSON.stringify({ request: { email, destinationId, pageGroup, document, sampleId: sampleId ?? undefined }, yaml }),
    [email, destinationId, pageGroup, document, sampleId, yaml],
  );
  const lastShown = useRef(`${pageGroup}/${splf}`);
  useEffect(() => {
    if (!sampleId) return;
    let cancelled = false;
    // Stepping to another email asks at once; typing waits for a pause.
    const delay = lastShown.current !== `${pageGroup}/${splf}` ? 0 : PREVIEW_DELAY_MS;
    lastShown.current = `${pageGroup}/${splf}`;
    const timer = setTimeout(() => {
      setState((current) => ({ ...current, loading: true }));
      const { request } = JSON.parse(body) as { request: Record<string, unknown> };
      api<EmailPreviewView>(`/api/jobs/${job.id}/email-preview`, { method: 'POST', body: request }).then(
        (preview) => !cancelled && setState((current) => ({ preview, previous: current.preview, error: null, loading: false })),
        (err: unknown) => !cancelled && setState((current) => ({ ...current, error: errorText(err), loading: false })),
      );
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [body, job.id, pageGroup, splf, sampleId]);
  return state;
}

/**
 * The email part of the destination step: To, Cc, Bcc, Reply-To, Subject and the message,
 * each with fields of the definition, what to attach, and the live preview of the email
 * of one page group, or of the whole spooled file, beside them.
 */
export function EmailStep({ destination }: { destination: EmailDestination }) {
  const { spec, updateDraft, readOnly } = useJob();
  const { pageGroupIndex } = useWorkbench();
  const email = spec.destination.email ?? emptyEmailSpec();
  const [shown, setShown] = useState<Shown>({ pageGroup: pageGroupIndex, splf: false });
  const { preview, previous, loading, error } = useEmailPreview(email, destination.id, shown);
  const [showMore, setShowMore] = useState(false);
  const inputs = useRef<Partial<Record<EmailField, HTMLInputElement | HTMLTextAreaElement | null>>>({});
  const lastField = useRef<EmailField>('subject');

  const set = (change: Partial<EmailSpec>, debounce = true) =>
    updateDraft({ destination: { ...spec.destination, email: { ...email, ...change } } }, { debounce });

  function insert(path: string) {
    const field = lastField.current === 'body' && email.bodyTemplateId !== null ? 'subject' : lastField.current;
    const element = inputs.current[field];
    const tag = `{d.${path}}`;
    const text = email[field];
    const start = element?.selectionStart ?? text.length;
    const end = element?.selectionEnd ?? text.length;
    set({ [field]: text.slice(0, start) + tag + text.slice(end) });
    if (field !== 'to' && field !== 'subject' && field !== 'body') setShowMore(true);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + tag.length, start + tag.length);
    });
  }

  const more = showMore || email.cc !== '' || email.bcc !== '' || email.replyTo !== '';
  const htmlTemplates = spec.render.templates.filter((template) => template.kind === 'html');
  const made = FORMATS.filter((format) => spec.render.templates.some((template) => template.formats.includes(format)) || email.attach.includes(format));
  const field = (name: EmailField, options: { placeholder?: string; multiline?: boolean } = {}) => (
    <TagInput
      id={`email-${name}`}
      value={email[name]}
      onChange={(value) => set({ [name]: value })}
      onFocus={() => (lastField.current = name)}
      inputRef={(element) => (inputs.current[name] = element)}
      disabled={readOnly}
      placeholder={options.placeholder}
      multiline={options.multiline}
      invalid={name === 'to' && !email.to.trim()}
    />
  );

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col gap-4">
        <Row label={EMAIL_FIELDS.to} htmlFor="email-to" hint="Separate addresses with commas. Fields and fixed addresses can be mixed.">
          {field('to', { placeholder: '{d.pg.email}, orders@example.com' })}
        </Row>
        {more ? (
          ADDRESS_FIELDS.slice(1).map((name) => (
            <Row key={name} label={EMAIL_FIELDS[name]} htmlFor={`email-${name}`} hint={name === 'replyTo' ? 'One address. Left out when it comes out empty.' : 'Optional. Left out when it comes out empty.'}>
              {field(name, { placeholder: name === 'bcc' ? 'archive@example.com' : undefined })}
            </Row>
          ))
        ) : (
          <div className="sm:pl-[calc(6.5rem+0.75rem)]">
            <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={() => setShowMore(true)} disabled={readOnly}>
              Add Cc, Bcc or Reply-To
            </Button>
          </div>
        )}
        <Row label={EMAIL_FIELDS.subject} htmlFor="email-subject" hint={email.subject.trim() ? undefined : "Empty: the subject is the document's name."}>
          {field('subject', { placeholder: 'Invoice {d.pg.invoiceNo}' })}
        </Row>
        <Row label="Message from" htmlFor="email-body-from">
          <Select
            value={email.bodyTemplateId ?? 'text'}
            onValueChange={(value) => set({ bodyTemplateId: value === 'text' ? null : value }, false)}
            disabled={readOnly}
          >
            <SelectTrigger id="email-body-from" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">Text written here</SelectItem>
              {htmlTemplates.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  The {template.name} template
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            {email.bodyTemplateId
              ? 'The email is the document itself: the HTML the template makes, with its styles inlined and its images in the email.'
              : htmlTemplates.length > 0
                ? 'Or make the email the document itself, with one of the HTML templates.'
                : 'Add an HTML template in the Render step to make the email the document itself.'}
          </p>
        </Row>
        {email.bodyTemplateId === null && (
          <Row label={EMAIL_FIELDS.body} htmlFor="email-body">
            {field('body', { multiline: true })}
          </Row>
        )}
        <div className="sm:pl-[calc(6.5rem+0.75rem)]">
          <InsertField fields={preview?.fields ?? []} disabled={readOnly} onPick={insert} />
        </div>
        <Row label="Attach">
          <div role="group" aria-label="Attach" className="flex flex-wrap gap-x-4 gap-y-2 sm:min-h-8 sm:items-center">
            {made.map((format) => (
              <div key={format} className="flex items-center gap-2">
                <Checkbox
                  id={`email-attach-${format}`}
                  checked={email.attach.includes(format)}
                  disabled={readOnly}
                  onCheckedChange={(checked) =>
                    set({ attach: checked === true ? [...email.attach, format] : email.attach.filter((other) => other !== format) }, false)
                  }
                />
                <Label htmlFor={`email-attach-${format}`} className="font-normal">
                  {FORMAT_FILES[format].label}
                </Label>
              </div>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">
            {email.attach.length === 0 ? 'No files: the message alone is sent.' : "Each email carries its document's files in these formats."}
          </p>
        </Row>
        {preview && preview.unknownTags.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-destructive text-sm">
            {preview.unknownTags.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="lg:sticky lg:top-0">
        <EmailPreview preview={preview} previous={previous} loading={loading} error={error} onStep={setShown} />
        {error && preview && <p className="mt-2 text-destructive text-xs">{error}</p>}
      </div>
    </div>
  );
}
