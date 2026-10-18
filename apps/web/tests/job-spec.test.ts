import { describe, expect, it } from 'vitest';
import { draftPatchSchema, jobSpecSchema } from '@/lib/job-spec';

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
