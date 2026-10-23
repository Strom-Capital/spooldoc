import type { Lookup } from '@spooldoc/core';
import { jobSpecSchema, withContent, type FileTemplateContent, type JobTemplate, type XlsxScope } from '@/lib/job-spec';
import { switchProblem, type DraftStore } from '@/lib/server/chat';
import type { TemplateFileView } from '@/lib/types';

/** A file the agent saved, as the database would keep it. */
export interface MemoryFile {
  name: string;
  content: Uint8Array;
  previousId: string | null;
}

/** A template's HTML; undefined for a Word or Excel template. */
export const htmlOf = (template: JobTemplate): string | null | undefined => (template.kind === 'html' ? template.source : undefined);

/**
 * A job draft in memory: a definition and templates, checked by the spec schema as the
 * draft store does, and the Word and Excel files the agent saved. The chat tool tests use
 * it, and so can a script that runs the agent without a database.
 */
export class MemoryDraft implements DraftStore {
  yaml = '';
  templates: JobTemplate[] = jobSpecSchema.parse({}).render.templates;
  lookups: Lookup[] = [];
  /** The files the agent saved, by id. */
  files = new Map<string, MemoryFile>();

  /** The first template's HTML. */
  get html(): string | null | undefined {
    return htmlOf(this.templates[0]!);
  }
  async readDefinition() {
    return this.yaml;
  }
  async readTemplates() {
    return this.templates;
  }
  async readLookups() {
    return this.lookups;
  }
  async writeDefinition(yaml: string) {
    this.yaml = yaml;
  }
  async writeHtml(templateId: string, html: string) {
    await this.changeTemplates((templates) => templates.map((t) => (t.id === templateId ? withContent(t, { kind: 'html', source: html }) : t)));
  }
  async changeTemplates(change: (templates: JobTemplate[]) => JobTemplate[]) {
    this.templates = jobSpecSchema.shape.render.parse({ templates: change(this.templates) }).templates;
    return this.templates;
  }
  async writeTemplateFile(templateId: string, kind: FileTemplateContent['kind'], file: MemoryFile, scope?: XlsxScope): Promise<TemplateFileView> {
    const template = this.templates.find((t) => t.id === templateId);
    if (!template) throw new Error('The template is gone.');
    const problem = switchProblem(template, kind);
    if (problem) throw new Error(problem);
    const id = `00000000-0000-4000-8000-${String(this.files.size + 1).padStart(12, '0')}`;
    this.files.set(id, file);
    const content: FileTemplateContent =
      kind === 'xlsx' ? { kind, fileId: id, scope: template.kind === 'xlsx' ? template.scope : (scope ?? 'splf') } : { kind, fileId: id };
    await this.changeTemplates((templates) => templates.map((t) => (t.id === templateId ? withContent(t, content) : t)));
    return { id, name: file.name, size: file.content.length, createdAt: new Date(0).toISOString(), madeBy: 'assistant', previousId: file.previousId };
  }
  /** Reads a file the agent saved, as the chat route's `templateFile` does. */
  readFile = async (id: string) => this.files.get(id) ?? null;
}
