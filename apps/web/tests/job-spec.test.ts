import { describe, expect, it } from 'vitest';
import { draftPatchSchema, filterParams, ibmiFilter, jobSpecSchema } from '@/lib/job-spec';

describe('job spec', () => {
  it('reads specs saved with the single PDF format', () => {
    const spec = jobSpecSchema.parse({ render: { template: null, format: 'pdf' } });
    expect(spec.render).toEqual({ template: null, formats: ['pdf'] });
    expect(draftPatchSchema.parse({ render: { template: '<p/>', format: 'pdf' } }).render).toEqual({ template: '<p/>', formats: ['pdf'] });
  });

  it('defaults to PDF, keeps a fixed order and needs one format', () => {
    expect(jobSpecSchema.parse({}).render.formats).toEqual(['pdf']);
    expect(jobSpecSchema.parse({ render: { formats: ['html', 'pdf', 'html'] } }).render.formats).toEqual(['pdf', 'html']);
    expect(() => jobSpecSchema.parse({ render: { formats: [] } })).toThrow(/at least one output format/);
    expect(() => jobSpecSchema.parse({ render: { formats: ['docx'] } })).toThrow();
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
