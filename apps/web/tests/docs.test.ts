import { describe, expect, it } from 'vitest';
import { docsNav, docsPage, docsSections, docsVersion } from '@/lib/server/docs';
import { REPOSITORY } from '@/lib/repository';

// The reading is tested in @spooldoc/docs. This checks the app passes it the right folder,
// repository and version.
describe('docs', () => {
  it('reads the guides in docs/ with the repository and the version', () => {
    expect(docsNav().map(({ group }) => group)).toContain('Get started');
    expect(docsSections().length).toBeGreaterThan(0);
    const markdown = docsNav()
      .flatMap(({ pages }) => pages)
      .map(({ slug }) => docsPage(slug).markdown)
      .join('\n');
    expect(markdown).toContain(`](${REPOSITORY}/blob/v${docsVersion()}/`);
  });
});
