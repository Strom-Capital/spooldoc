import { describe, expect, it } from 'vitest';
import {
  filterParams,
  findOutput,
  formatList,
  hasOwnTemplate,
  ibmiFilter,
  jobSpecSchema,
  labelTaken,
  missingParts,
  newOutput,
  outputFileName,
  outputSlug,
  withTemplate,
  type JobOutput,
} from '@/lib/job-spec';

describe('job spec', () => {
  const output = (fields: Partial<JobOutput> = {}): JobOutput => ({ id: 'main', label: 'Document', template: { kind: 'html', source: null }, formats: ['pdf'], ...fields });

  it('starts with one PDF output and keeps outputs as they are', () => {
    expect(jobSpecSchema.parse({}).render).toEqual({ outputs: [output()] });
    const two = { outputs: [output(), output({ id: 'lines', label: 'Lines', formats: ['html'] })] };
    expect(jobSpecSchema.parse({ render: two }).render).toEqual(two);
  });

  it('keeps formats in a fixed order and needs one format and one output', () => {
    expect(jobSpecSchema.parse({ render: { outputs: [output({ formats: ['html', 'pdf', 'html'] })] } }).render.outputs[0]!.formats).toEqual(['pdf', 'html']);
    expect(() => jobSpecSchema.parse({ render: { outputs: [output({ formats: [] })] } })).toThrow(/Pick at least one format/);
    expect(() => jobSpecSchema.parse({ render: { outputs: [] } })).toThrow(/Add at least one output/);
    expect(() => jobSpecSchema.parse({ render: { outputs: [output({ formats: ['docx' as never] })] } })).toThrow();
    expect(() => jobSpecSchema.parse({ render: { outputs: [output({ id: 'Main Output' })] } })).toThrow(/output id/);
    expect(() => jobSpecSchema.parse({ render: { outputs: [output({ label: '  ' })] } })).toThrow(/Name the output/);
  });

  it('reports outputs with the same id or name as a sentence each', () => {
    const spec = jobSpecSchema.parse({});
    const named = (outputs: JobOutput[]) => missingParts({ ...spec, render: { outputs } }).filter((line) => line.startsWith('Render'));
    expect(named([output(), output({ id: 'lines', label: 'Lines' })])).toEqual([]);
    expect(named([output(), output({ id: 'lines', label: 'document' }), output({ id: 'more', label: 'DOCUMENT' })])).toEqual([
      'Render: two outputs are named "document". Give each output its own name.',
      'Render: two outputs are named "DOCUMENT". Give each output its own name.',
    ]);
    expect(named([output(), output({ label: 'Lines' })])).toEqual(['Render: two outputs have the id "main". Give each output its own id.']);
  });

  it('finds an output by id or name, and the first without either', () => {
    const outputs = [output(), output({ id: 'lines', label: 'Order lines' })];
    expect(findOutput(outputs)?.id).toBe('main');
    expect(findOutput(outputs, 'lines')?.id).toBe('lines');
    expect(findOutput(outputs, 'order LINES')?.id).toBe('lines');
    expect(findOutput(outputs, 'nope')).toBeNull();
  });

  it('names the files of every output but the first after its label', () => {
    const outputs = [output(), output({ id: 'lines', label: 'Order lines' }), output({ id: 'x', label: '***' })];
    expect(outputFileName('invoice-260101', outputs, outputs[0]!)).toBe('invoice-260101');
    expect(outputFileName('invoice-260101', outputs, outputs[1]!)).toBe('invoice-260101-order-lines');
    expect(outputFileName('invoice-260101', outputs, outputs[2]!)).toBe('invoice-260101-x');
    expect(outputSlug({ id: 'a', label: 'Ääkkönen rivit' })).toBe('aakkonen-rivit');
  });

  it('makes new outputs with a free name and id', () => {
    const outputs = [output()];
    const second = newOutput(outputs);
    expect(second).toEqual(output({ id: 'output-2', label: 'Output 2' }));
    expect(newOutput([...outputs, second], 'Lines', ['html', 'pdf'])).toEqual(output({ id: 'lines', label: 'Lines', formats: ['pdf', 'html'] }));
    expect(newOutput([output({ id: 'lines', label: 'Old lines' })], 'Lines').id).toBe('lines-2');
    expect(labelTaken(outputs, ' document ')).toBe(true);
    expect(labelTaken(outputs, 'Document', 'main')).toBe(false);
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

describe('Word templates', () => {
  const html: JobOutput = { id: 'main', label: 'Document', template: { kind: 'html', source: '<p/>' }, formats: ['pdf', 'html'] };

  it('reads a Word output and refuses formats a Word template does not make', () => {
    const word = { ...html, template: { kind: 'docx', fileId: null }, formats: ['docx', 'pdf'] };
    expect(jobSpecSchema.parse({ render: { outputs: [word] } }).render.outputs[0]).toEqual({ ...word, formats: ['pdf', 'docx'] });
    const wrong = jobSpecSchema.safeParse({ render: { outputs: [{ ...word, formats: ['html'] }] } });
    expect(wrong.success).toBe(false);
    expect(wrong.error?.issues[0]?.message).toBe('A Word template makes PDF and DOCX files, not HTML.');
    expect(jobSpecSchema.safeParse({ render: { outputs: [{ ...html, formats: ['docx'] }] } }).error?.issues[0]?.message).toBe(
      'An HTML template makes PDF and HTML files, not DOCX.',
    );
  });

  it('switches a template, keeping the formats the new kind makes, else PDF', () => {
    expect(withTemplate(html, { kind: 'docx', fileId: null })).toEqual({ ...html, template: { kind: 'docx', fileId: null }, formats: ['pdf'] });
    expect(withTemplate({ ...html, formats: ['html'] }, { kind: 'docx', fileId: null }).formats).toEqual(['pdf']);
    expect(hasOwnTemplate({ kind: 'docx', fileId: null })).toBe(false);
    expect(hasOwnTemplate(html.template)).toBe(true);
    expect(formatList(['pdf', 'docx'])).toBe('PDF and DOCX');
  });
});
