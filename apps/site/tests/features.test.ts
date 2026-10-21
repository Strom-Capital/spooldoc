import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import FeaturesPage from '../src/pages/features.astro';
import { FEATURES, SHOTS } from '../src/lib/features';

describe('features page', () => {
  it('shows one screenshot on its own, and two or more in a carousel', async () => {
    const container = await AstroContainer.create({ astroConfig: { site: 'https://spooldoc.com' } });
    const html = await container.renderToString(FeaturesPage, { request: new Request('https://spooldoc.com/features/') });
    const sections = html.split('<section class="feature"').slice(1);
    expect(sections).toHaveLength(FEATURES.length);
    for (const [i, feature] of FEATURES.entries()) {
      const section = sections[i] ?? '';
      expect(section, feature.id).toContain(`id="${feature.id}"`);
      const carousels = section.match(/aria-roledescription="carousel"/g)?.length ?? 0;
      const slides = section.match(/aria-roledescription="slide"/g)?.length ?? 0;
      if (feature.shots.length > 1) {
        expect(carousels, feature.id).toBe(1);
        expect(slides, feature.id).toBe(feature.shots.length);
        expect(section).toContain(`role="region" aria-roledescription="carousel" aria-label="${feature.title}"`);
        expect(section).toContain('aria-label="Previous screenshot"');
        expect(section).toContain('aria-label="Next screenshot"');
        expect(section).toContain(`aria-label="1 of ${feature.shots.length}"`);
      } else {
        expect(carousels, feature.id).toBe(0);
      }
      for (const name of feature.shots) {
        expect(section, name).toContain(`src="/docs/assets/${name}-light.png"`);
        expect(section, name).toContain(`src="/docs/assets/${name}-dark.png"`);
        expect(section, name).toContain(`alt="${SHOTS[name]}"`);
      }
    }
  });
});
