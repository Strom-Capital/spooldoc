'use client';

import { useCallback, useState } from 'react';
import { ChatPanel } from '@/components/workbench/chat-panel';
import { DefinitionEditor } from '@/components/workbench/definition-editor';
import { HtmlPreview } from '@/components/workbench/html-preview';
import { JsonView } from '@/components/workbench/json-view';
import { PageGroupSelect, PageSelect } from '@/components/workbench/position-select';
import { PageView } from '@/components/workbench/page-view';
import { SaveStatus } from '@/components/workbench/save-status';
import { PaneTabs, SplitPanes } from '@/components/workbench/split-panes';
import { TemplateEditor } from '@/components/workbench/template-editor';
import { useWorkbench, WorkbenchProvider } from '@/components/workbench/workbench-provider';
import { Spinner } from '@/components/ui/spinner';
import { templateFileName, withContent, type TemplateContent } from '@/lib/job-spec';
import { useJob } from './job-provider';
import { TemplateControls } from './template-controls';
import { PreviewPicker } from './preview-picker';

/** The workbench state for the job's spec, the picked template and the preview spooled file, around the builder. */
export function JobWorkbench({ children }: { children: React.ReactNode }) {
  const { job, spec, readOnly, updateDraft, refresh } = useJob();
  const templates = spec.render.templates;
  const [picked, setPicked] = useState<string | null>(null);
  // A picked template that is gone (removed, or not in the version shown) falls back to the first.
  const template = templates.find((t) => t.id === picked) ?? templates[0]!;
  const setYaml = useCallback((yaml: string) => updateDraft({ extract: { definition: yaml } }), [updateDraft]);
  // Typing in the HTML editor saves after a pause; anything else (a kind, a file, the starter) at once.
  const setContent = useCallback(
    (content: TemplateContent) =>
      updateDraft(
        { render: { templates: templates.map((t) => (t.id === template.id ? withContent(t, content) : t)) } },
        { debounce: content.kind === 'html' && content.source !== null && template.kind === 'html' },
      ),
    [updateDraft, templates, template.id, template.kind],
  );
  return (
    <WorkbenchProvider
      jobId={job.id}
      sampleId={spec.preview.sampleId}
      yaml={spec.extract.definition}
      content={template}
      templateId={template.id}
      setTemplateId={setPicked}
      readOnly={readOnly}
      setYaml={setYaml}
      setContent={setContent}
      onDraftWritten={refresh}
    >
      {children}
    </WorkbenchProvider>
  );
}

/**
 * The bar above the Extract and Render panes: what is shown, as a path from the preview
 * spooled file to its page group, then on Extract the page and on Render the template.
 * Problems show under it.
 */
function StepHeader({ page, template }: { page?: boolean; template?: React.ReactNode }) {
  const { render, loading, error } = useWorkbench();
  const groups = (render?.extract?.pageGroups.length ?? 0) > 0;
  const pages = (render?.sample.pages.length ?? 0) > 0;
  return (
    <div className="shrink-0 border-b">
      <div className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-1.5">
        <PreviewPicker sample={render?.sample ?? null} />
        {groups && <PathSlash />}
        <PageGroupSelect />
        {page && pages && <PathSlash />}
        {page && <PageSelect />}
        {template && <PathSlash />}
        {template}
        {loading && <Spinner className="shrink-0 text-muted-foreground" />}
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

/** Whether the definition and template are saved to the draft, at the end of the tab row. */
function DraftStatus() {
  return (
    <span className="text-muted-foreground text-xs">
      <SaveStatus />
    </span>
  );
}

function PathSlash() {
  return (
    <span aria-hidden className="text-muted-foreground/60 text-sm">
      /
    </span>
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
      <StepHeader page />
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
                end={<DraftStatus />}
              />
              <div className="min-h-0 flex-1">{current === 'json' ? <JsonView /> : <DefinitionEditor />}</div>
            </div>
          }
        />
      </div>
    </div>
  );
}

/** Render: the picked template (and the JSON for field names) next to its preview, with downloads of each format. */
export function RenderStep() {
  const { tab, setTab, templateId, setTemplateId } = useWorkbench();
  const { spec } = useJob();
  const template = spec.render.templates.find((t) => t.id === templateId) ?? spec.render.templates[0]!;
  const current = tab === 'definition' ? 'template' : tab;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <StepHeader template={<TemplateControls template={template} onPick={setTemplateId} />} />
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
                end={<DraftStatus />}
              />
              <div className="min-h-0 flex-1">{current === 'json' ? <JsonView /> : <TemplateEditor />}</div>
            </div>
          }
          right={<HtmlPreview fileName={(name) => templateFileName(name, spec.render.templates, template)} />}
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
