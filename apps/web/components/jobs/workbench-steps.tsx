'use client';

import { useCallback, useState } from 'react';
import { ChatPanel } from '@/components/workbench/chat-panel';
import { DefinitionEditor } from '@/components/workbench/definition-editor';
import { HtmlPreview } from '@/components/workbench/html-preview';
import { JsonView } from '@/components/workbench/json-view';
import { PageView } from '@/components/workbench/page-view';
import { PaneTabs, SplitPanes } from '@/components/workbench/split-panes';
import { TemplateEditor } from '@/components/workbench/template-editor';
import { useWorkbench, WorkbenchProvider } from '@/components/workbench/workbench-provider';
import { Spinner } from '@/components/ui/spinner';
import { outputFileName, withTemplate, type OutputTemplate } from '@/lib/job-spec';
import { useJob } from './job-provider';
import { OutputControls } from './output-controls';
import { PreviewPicker } from './preview-picker';

/** The workbench state for the job's spec, the picked output and the preview spooled file, around the builder. */
export function JobWorkbench({ children }: { children: React.ReactNode }) {
  const { job, spec, readOnly, updateDraft, refresh } = useJob();
  const outputs = spec.render.outputs;
  const [picked, setPicked] = useState<string | null>(null);
  // A picked output that is gone (removed, or not in the version shown) falls back to the first.
  const output = outputs.find((o) => o.id === picked) ?? outputs[0]!;
  const setYaml = useCallback((yaml: string) => updateDraft({ extract: { definition: yaml } }), [updateDraft]);
  // Typing in the HTML editor saves after a pause; anything else (a kind, a file, the starter) at once.
  const setTemplate = useCallback(
    (template: OutputTemplate) =>
      updateDraft(
        { render: { outputs: outputs.map((o) => (o.id === output.id ? withTemplate(o, template) : o)) } },
        { debounce: template.kind === 'html' && template.source !== null && output.template.kind === 'html' },
      ),
    [updateDraft, outputs, output.id, output.template.kind],
  );
  return (
    <WorkbenchProvider
      jobId={job.id}
      sampleId={spec.preview.sampleId}
      yaml={spec.extract.definition}
      template={output.template}
      outputId={output.id}
      setOutputId={setPicked}
      readOnly={readOnly}
      setYaml={setYaml}
      setTemplate={setTemplate}
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

/** Render: the picked output's template (and the JSON for field names) next to its preview, with downloads of each format. */
export function RenderStep() {
  const { tab, setTab, outputId, setOutputId } = useWorkbench();
  const { spec } = useJob();
  const output = spec.render.outputs.find((o) => o.id === outputId) ?? spec.render.outputs[0]!;
  const current = tab === 'definition' ? 'template' : tab;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <StepHeader end={<OutputControls output={output} onPick={setOutputId} />} />
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
          right={<HtmlPreview fileName={(name) => outputFileName(name, spec.render.outputs, output)} />}
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
