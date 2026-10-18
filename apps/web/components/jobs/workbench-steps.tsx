'use client';

import { useCallback } from 'react';
import { ChatPanel } from '@/components/workbench/chat-panel';
import { DefinitionEditor } from '@/components/workbench/definition-editor';
import { HtmlPreview } from '@/components/workbench/html-preview';
import { JsonView } from '@/components/workbench/json-view';
import { PageView } from '@/components/workbench/page-view';
import { PaneTabs, SplitPanes } from '@/components/workbench/split-panes';
import { TemplateEditor } from '@/components/workbench/template-editor';
import { useWorkbench, WorkbenchProvider } from '@/components/workbench/workbench-provider';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import { OUTPUT_FORMATS, type OutputFormat } from '@/lib/job-spec';
import { useJob } from './job-provider';
import { PreviewPicker } from './preview-picker';

/** The workbench state for the job's spec and preview spooled file, around the builder. */
export function JobWorkbench({ children }: { children: React.ReactNode }) {
  const { job, spec, readOnly, updateDraft, refresh } = useJob();
  const setYaml = useCallback((yaml: string) => updateDraft({ extract: { definition: yaml } }), [updateDraft]);
  const setHtml = useCallback(
    (html: string | null) => updateDraft({ render: { ...spec.render, template: html } }, { debounce: html !== null }),
    [updateDraft, spec.render],
  );
  return (
    <WorkbenchProvider
      jobId={job.id}
      sampleId={spec.preview.sampleId}
      yaml={spec.extract.definition}
      html={spec.render.template}
      readOnly={readOnly}
      setYaml={setYaml}
      setHtml={setHtml}
      onDraftWritten={refresh}
    >
      {children}
    </WorkbenchProvider>
  );
}

/** The bar above the Extract and Render panes: the preview spooled file, problems and extra controls. */
function StepHeader({ end }: { end?: React.ReactNode }) {
  const { render, loading, error } = useWorkbench();
  return (
    <div className="shrink-0 border-b">
      <div className="flex min-h-11 flex-wrap items-center gap-2 px-3 py-1.5">
        <span className="text-muted-foreground text-xs">Try on</span>
        <PreviewPicker sample={render?.sample ?? null} />
        {loading && <Spinner className="shrink-0 text-muted-foreground" />}
        {end && <div className="ml-auto flex items-center gap-3">{end}</div>}
      </div>
      {error && <p className="truncate px-3 pb-1.5 text-destructive text-xs">{error}</p>}
      {render?.mismatch && (
        <p className="px-3 pb-1.5 text-amber-700 text-xs dark:text-amber-400" title={render.mismatch.join('\n')}>
          The definition is not for this file ({render.mismatch.join('; ')}). Runs skip such files; change the match section or pick
          another file.
        </p>
      )}
      {render && render.errors.length > 0 && (
        <p className="truncate px-3 pb-1.5 text-destructive text-xs" title={render.errors.join('\n\n')}>
          {render.errors.length === 1 ? '1 problem' : `${render.errors.length} problems`}: {render.errors[0]?.split('\n')[0]}
        </p>
      )}
    </div>
  );
}

function NoSample() {
  const { spec } = useJob();
  const ready = spec.source.serverId && spec.source.queue;
  return (
    <p className="m-4 rounded-md border border-dashed p-4 text-muted-foreground text-sm">
      {ready ? 'Pick a spooled file from the source queue to try the definition on.' : 'Set the source server and queue first.'}
    </p>
  );
}

/** Extract: the spooled page with field hits next to the definition and the JSON. */
export function ExtractStep() {
  const { sampleId, tab, setTab } = useWorkbench();
  const current = tab === 'template' ? 'definition' : tab;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <StepHeader />
      <div className="min-h-0 flex-1">
        <SplitPanes
          labels={['Page', 'Definition and JSON']}
          initial={0.52}
          left={sampleId ? <PageView /> : <NoSample />}
          right={
            <div className="flex h-full min-h-0 flex-col">
              <PaneTabs
                tabs={[
                  { id: 'definition', label: 'Definition' },
                  { id: 'json', label: 'JSON' },
                ]}
                value={current}
                onChange={setTab}
              />
              <div className="min-h-0 flex-1">{current === 'json' ? <JsonView /> : <DefinitionEditor />}</div>
            </div>
          }
        />
      </div>
    </div>
  );
}

const FORMAT_LABEL: Record<OutputFormat, string> = { pdf: 'PDF', html: 'HTML' };

/** Which files each document becomes: PDF, HTML or both (at least one). */
function OutputFormats() {
  const { spec, readOnly, updateDraft } = useJob();
  const formats = spec.render.formats;
  const toggle = (format: OutputFormat, on: boolean) => {
    const next = on ? [...formats, format] : formats.filter((f) => f !== format);
    if (next.length > 0) updateDraft({ render: { ...spec.render, formats: OUTPUT_FORMATS.filter((f) => next.includes(f)) } }, { debounce: false });
  };
  return (
    <div role="group" aria-label="Output formats" className="flex items-center gap-3 text-sm">
      <span className="text-muted-foreground text-xs">Output</span>
      {OUTPUT_FORMATS.map((format) => {
        const checked = formats.includes(format);
        return (
          <label key={format} className="flex items-center gap-1.5">
            <Checkbox
              checked={checked}
              disabled={readOnly || (checked && formats.length === 1)}
              onCheckedChange={(on) => toggle(format, on === true)}
              aria-label={`Make ${FORMAT_LABEL[format]} files`}
            />
            {FORMAT_LABEL[format]}
          </label>
        );
      })}
    </div>
  );
}

/** Render: the template (and the JSON for field names) next to the HTML preview, with PDF and HTML downloads. */
export function RenderStep() {
  const { tab, setTab } = useWorkbench();
  const current = tab === 'definition' ? 'template' : tab;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <StepHeader end={<OutputFormats />} />
      <div className="min-h-0 flex-1">
        <SplitPanes
          labels={['Template and JSON', 'Preview']}
          left={
            <div className="flex h-full min-h-0 flex-col">
              <PaneTabs
                tabs={[
                  { id: 'template', label: 'Template' },
                  { id: 'json', label: 'JSON' },
                ]}
                value={current}
                onChange={setTab}
              />
              <div className="min-h-0 flex-1">{current === 'json' ? <JsonView /> : <TemplateEditor />}</div>
            </div>
          }
          right={<HtmlPreview />}
        />
      </div>
    </div>
  );
}

/** The chat, or why it cannot start yet. */
export function JobChat() {
  const { sampleId } = useWorkbench();
  if (!sampleId) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-10 shrink-0 items-center border-b px-3 font-medium text-sm">AI assistant</div>
        <p className="m-3 rounded-md border bg-muted/40 p-3 text-muted-foreground text-sm">
          Set the source server and queue. The assistant works on a spooled file from that queue.
        </p>
      </div>
    );
  }
  // A new chat per preview file: the model's context is that file.
  return <ChatPanel key={sampleId} header={<span className="font-medium">AI assistant</span>} />;
}
