import { describe, expect, it } from 'vitest';
import {
  filterParams,
  findTemplate,
  formatList,
  hasOwnContent,
  ibmiFilter,
  jobSpecSchema,
  nameTaken,
  missingParts,
  settledKind,
  newTemplate,
  templateFileName,
  templateSlug,
  triggerStatuses,
  kindSwitchNote,
  withContent,
  contentLabel,
  kindName,
  perSpooledFile,
  spooledFileName,
  starterContent,
  type JobTemplate,
} from '@/lib/job-spec';

describe('job spec', () => {
  const template = (fields: Partial<JobTemplate> = {}): JobTemplate =>
    ({ id: 'template-1', name: 'Template 1', kind: 'html', source: null, formats: ['pdf'], ...fields }) as JobTemplate;

  it('starts with one PDF template and keeps templates as they are', () => {
    expect(jobSpecSchema.parse({}).render).toEqual({ templates: [template()] });
    const two = { templates: [template(), template({ id: 'lines', name: 'Lines', formats: ['html'] })] };
    expect(jobSpecSchema.parse({ render: two }).render).toEqual(two);
  });

  it('keeps formats in a fixed order and needs one format and one template', () => {
    expect(jobSpecSchema.parse({ render: { templates: [template({ formats: ['html', 'pdf', 'html'] })] } }).render.templates[0]!.formats).toEqual(['pdf', 'html']);
    expect(() => jobSpecSchema.parse({ render: { templates: [template({ formats: [] })] } })).toThrow(/Pick at least one format/);
    expect(() => jobSpecSchema.parse({ render: { templates: [] } })).toThrow(/Add at least one template/);
    expect(() => jobSpecSchema.parse({ render: { templates: [template({ formats: ['docx' as never] })] } })).toThrow();
    expect(() => jobSpecSchema.parse({ render: { templates: [template({ id: 'Main Template' })] } })).toThrow(/template id/);
    expect(() => jobSpecSchema.parse({ render: { templates: [template({ name: '  ' })] } })).toThrow(/Name the template/);
  });

  it('reports templates with the same id or name as a sentence each', () => {
    const spec = jobSpecSchema.parse({});
    const named = (templates: JobTemplate[]) => missingParts({ ...spec, render: { templates } }).filter((line) => line.startsWith('Render'));
    expect(named([template(), template({ id: 'lines', name: 'Lines' })])).toEqual([]);
    expect(named([template(), template({ id: 'lines', name: 'template 1' }), template({ id: 'more', name: 'TEMPLATE 1' })])).toEqual([
      'Render: two templates are named "template 1". Give each template its own name.',
      'Render: two templates are named "TEMPLATE 1". Give each template its own name.',
    ]);
    expect(named([template(), template({ name: 'Lines' })])).toEqual(['Render: two templates have the id "template-1". Give each template its own id.']);
  });

  it('finds a template by id or name, and the first without either', () => {
    const templates = [template(), template({ id: 'lines', name: 'Order lines' })];
    expect(findTemplate(templates)?.id).toBe('template-1');
    expect(findTemplate(templates, 'lines')?.id).toBe('lines');
    expect(findTemplate(templates, 'order LINES')?.id).toBe('lines');
    expect(findTemplate(templates, 'nope')).toBeNull();
  });

  it('names the files of every template but the first after its name', () => {
    const templates = [template(), template({ id: 'lines', name: 'Order lines' }), template({ id: 'x', name: '***' })];
    expect(templateFileName('invoice-260101', templates, templates[0]!)).toBe('invoice-260101');
    expect(templateFileName('invoice-260101', templates, templates[1]!)).toBe('invoice-260101-order-lines');
    expect(templateFileName('invoice-260101', templates, templates[2]!)).toBe('invoice-260101-x');
    expect(templateSlug({ id: 'a', name: 'Ääkkönen rivit' })).toBe('aakkonen-rivit');
  });

  it('makes new templates with a free name and id', () => {
    const templates = [template()];
    const second = newTemplate(templates);
    expect(second).toEqual(template({ id: 'template-2', name: 'Template 2' }));
    expect(newTemplate([...templates, second], 'Lines', ['html', 'pdf'])).toEqual(template({ id: 'lines', name: 'Lines', formats: ['pdf', 'html'] }));
    expect(newTemplate([template({ id: 'lines', name: 'Old lines' })], 'Lines').id).toBe('lines-2');
    expect(nameTaken(templates, ' template 1 ')).toBe(true);
    expect(nameTaken(templates, 'Template 1', 'template-1')).toBe(false);
  });
});

describe('job filters', () => {
  it('fill in missing filters for specs saved before job and form filters', () => {
    const spec = jobSpecSchema.parse({ source: { serverId: null, library: 'L', queue: 'Q', filter: { splf: 'INV', userData: '' } } });
    expect(spec.source.filter).toEqual({ splf: 'INV', userData: '', jobName: '', jobUser: '', formType: '' });
  });

  it('turn into query parameters and an IBM i filter, leaving out empty ones', () => {
    const filter = { splf: 'INV ', userData: '', jobName: 'INVPRT', jobUser: '', formType: '*STD' };
    expect(filterParams(filter).toString()).toBe('name=INV&jobName=INVPRT&formType=*STD');
    expect(ibmiFilter(filter)).toEqual({ name: 'INV', userData: undefined, jobName: 'INVPRT', jobUser: undefined, formType: '*STD' });
  });
});

describe('trigger statuses', () => {
  it('are ready files, and held ones when the trigger includes them', () => {
    expect(triggerStatuses({ includeHeld: false })).toEqual(['READY']);
    expect(triggerStatuses({ includeHeld: true })).toEqual(['READY', 'HELD']);
  });
});

describe('Word templates', () => {
  const html: JobTemplate = { id: 'main', name: 'Document', kind: 'html', source: '<p/>', formats: ['pdf', 'html'] };

  it('reads a Word template and refuses formats a Word template does not make', () => {
    const word = { id: 'main', name: 'Document', kind: 'docx', fileId: null, formats: ['docx', 'pdf'] };
    expect(jobSpecSchema.parse({ render: { templates: [word] } }).render.templates[0]).toEqual({ ...word, formats: ['pdf', 'docx'] });
    const wrong = jobSpecSchema.safeParse({ render: { templates: [{ ...word, formats: ['html'] }] } });
    expect(wrong.success).toBe(false);
    expect(wrong.error?.issues[0]?.message).toBe('A Word template makes PDF and DOCX files, not HTML.');
    expect(jobSpecSchema.safeParse({ render: { templates: [{ ...html, formats: ['docx'] }] } }).error?.issues[0]?.message).toBe(
      'An HTML template makes PDF and HTML files, not DOCX.',
    );
  });

  it('switches content: the same kind keeps its formats, another kind makes its default', () => {
    expect(withContent(html, { kind: 'docx', fileId: null })).toEqual({ id: 'main', name: 'Document', kind: 'docx', fileId: null, formats: ['pdf'] });
    expect(withContent({ ...html, formats: ['html'] }, { kind: 'docx', fileId: null }).formats).toEqual(['pdf']);
    expect(withContent({ ...html, formats: ['pdf', 'html'] }, { kind: 'html', source: '<p>y</p>' }).formats).toEqual(['pdf', 'html']);
    expect(hasOwnContent({ kind: 'docx', fileId: null })).toBe(false);
    expect(hasOwnContent(html)).toBe(true);
    expect(formatList(['pdf', 'docx'])).toBe('PDF and DOCX');
  });

  it('settles the kind of a template with content of its own, a Word one, or formats only one kind makes', () => {
    const starter: JobTemplate = { id: 'main', name: 'Document', kind: 'html', source: null, formats: ['pdf'] };
    expect(settledKind(starter)).toBeNull();
    expect(settledKind(html)).toEqual({ kind: 'html', reason: 'content' });
    expect(settledKind({ ...starter, formats: ['pdf', 'html'] })).toEqual({ kind: 'html', reason: 'formats' });
    expect(settledKind({ id: 'main', name: 'Document', kind: 'docx', fileId: null, formats: ['pdf'] })).toEqual({ kind: 'docx', reason: 'chosen' });
    const file = '00000000-0000-4000-8000-000000000001';
    expect(settledKind({ id: 'main', name: 'Document', kind: 'docx', fileId: file, formats: ['pdf', 'docx'] })).toEqual({ kind: 'docx', reason: 'content' });
  });

  it('says which files a switch to the other kind stops making', () => {
    expect(kindSwitchNote({ ...html, formats: ['pdf', 'html'] }, 'docx')).toBe('It makes PDF files, not HTML. A Word template makes PDF and DOCX.');
    expect(kindSwitchNote({ ...html, formats: ['html'] }, 'docx')).toBe('It makes PDF files, not HTML. A Word template makes PDF and DOCX.');
    expect(kindSwitchNote({ ...html, formats: ['pdf'] }, 'docx')).toBeNull();
    expect(kindSwitchNote(withContent({ ...html, formats: ['pdf'] }, { kind: 'docx', fileId: null }), 'html')).toBeNull();
    expect(kindSwitchNote({ id: 'main', name: 'Document', kind: 'docx', fileId: null, formats: ['pdf', 'docx'] }, 'html')).toBe(
      'It makes PDF files, not DOCX. An HTML template makes PDF and HTML.',
    );
  });
});

describe('Excel templates', () => {
  const excel: JobTemplate = { id: 'lines', name: 'Lines', kind: 'xlsx', fileId: null, scope: 'splf', formats: ['xlsx'] };
  const file = '00000000-0000-4000-8000-000000000001';

  it('holds the whole spooled file unless it says one page group, and makes XLSX and PDF only', () => {
    const parsed = jobSpecSchema.parse({ render: { templates: [{ id: 'lines', name: 'Lines', kind: 'xlsx', formats: ['pdf', 'xlsx'] }] } }).render.templates[0]!;
    expect(parsed).toEqual({ id: 'lines', name: 'Lines', kind: 'xlsx', fileId: null, scope: 'splf', formats: ['pdf', 'xlsx'] });
    expect(perSpooledFile(parsed)).toBe(true);
    expect(perSpooledFile({ ...excel, scope: 'pageGroup' })).toBe(false);
    expect(perSpooledFile({ kind: 'docx', fileId: null })).toBe(false);
    const html = jobSpecSchema.safeParse({ render: { templates: [{ ...excel, formats: ['html'] }] } });
    expect(html.success ? null : html.error.issues[0]?.message).toBe('An Excel template makes XLSX and PDF files, not HTML.');
    expect(jobSpecSchema.safeParse({ render: { templates: [{ ...excel, scope: 'page' }] } }).success).toBe(false);
  });

  it('switches to Excel making XLSX, and from Excel making PDF', () => {
    const html: JobTemplate = { id: 'lines', name: 'Lines', kind: 'html', source: '<p>x</p>', formats: ['pdf', 'html'] };
    expect(withContent(html, starterContent('xlsx'))).toEqual(excel);
    expect(withContent({ ...html, formats: ['pdf'] }, { kind: 'xlsx', fileId: file, scope: 'splf' }).formats).toEqual(['xlsx']);
    expect(withContent({ ...excel, formats: ['xlsx', 'pdf'] }, { kind: 'xlsx', fileId: file, scope: 'splf' }).formats).toEqual(['xlsx', 'pdf']);
    expect(withContent(excel, starterContent('docx')).formats).toEqual(['pdf']);
    expect(kindSwitchNote(html, 'xlsx')).toBe('It makes XLSX files, not PDF and HTML. An Excel template makes XLSX and PDF.');
    expect(kindSwitchNote({ ...html, formats: ['pdf'] }, 'xlsx')).toBe('It makes XLSX files, not PDF. An Excel template makes XLSX and PDF.');
    expect(kindSwitchNote(excel, 'html')).toBe('It makes PDF files, not XLSX. An HTML template makes PDF and HTML.');
    expect(kindSwitchNote({ ...excel, formats: ['pdf', 'xlsx'] }, 'docx')).toBe('It makes PDF files, not XLSX. A Word template makes PDF and DOCX.');
    expect(kindSwitchNote({ ...excel, formats: ['pdf'] }, 'html')).toBeNull();
  });

  it('settles the kind of an Excel template, and names each kind the same way everywhere', () => {
    expect(settledKind(excel)).toEqual({ kind: 'xlsx', reason: 'chosen' });
    expect(settledKind({ ...excel, fileId: file })).toEqual({ kind: 'xlsx', reason: 'content' });
    expect(hasOwnContent({ ...excel, fileId: file })).toBe(true);
    expect([kindName('html'), kindName('docx', true), kindName('xlsx', true)]).toEqual(['An HTML template', 'a Word template', 'an Excel template']);
    expect([contentLabel('xlsx', false), contentLabel('xlsx', true), contentLabel('html', false)]).toEqual(['Starter Excel template', 'Excel template', 'Starter template']);
    expect(formatList(['xlsx', 'pdf'])).toBe('XLSX and PDF');
  });

  it("names a document of the whole spooled file after the spooled file, and later templates' files after their name", () => {
    expect(spooledFileName({ splf: { name: 'SPDINVOICE' } })).toBe('spdinvoice');
    expect(spooledFileName({ splf: { name: 'INV#1' } })).toBe('inv_1');
    expect(templateFileName('spdinvoice', [{ id: 'main' }, excel], excel)).toBe('spdinvoice-lines');
  });
});
