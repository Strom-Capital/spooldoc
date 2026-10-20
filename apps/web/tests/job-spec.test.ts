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
  newTemplate,
  templateFileName,
  templateSlug,
  triggerStatuses,
  kindSwitchNote,
  withContent,
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

  it('switches content, keeping the formats the new kind makes, else PDF', () => {
    expect(withContent(html, { kind: 'docx', fileId: null })).toEqual({ id: 'main', name: 'Document', kind: 'docx', fileId: null, formats: ['pdf'] });
    expect(withContent({ ...html, formats: ['html'] }, { kind: 'docx', fileId: null }).formats).toEqual(['pdf']);
    expect(hasOwnContent({ kind: 'docx', fileId: null })).toBe(false);
    expect(hasOwnContent(html)).toBe(true);
    expect(formatList(['pdf', 'docx'])).toBe('PDF and DOCX');
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
