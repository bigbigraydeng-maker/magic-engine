import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createBlankBrochure } from '../brochure-types';
import { createBlankItinerary, productEyebrow } from '../types';
import { renderItineraryHtml } from '../render';

describe('product type (tailor-made / SIC)', () => {
  it('defaults to tailor-made wording when the field is missing (old records)', () => {
    expect(productEyebrow(undefined)).toBe('Tailor-made journey');
    expect(productEyebrow('tailor-made')).toBe('Tailor-made journey');
  });

  it('uses Seat-in-coach (SIC) wording for sic', () => {
    expect(productEyebrow('sic')).toBe('Seat-in-coach (SIC) journey');
  });

  it('brochure cover eyebrow follows the itinerary product type', () => {
    const it = createBlankItinerary('Q-1');
    expect(createBlankBrochure(it).cover.eyebrow).toBe('TAILOR-MADE JOURNEY');
    it.trip.productType = 'sic';
    expect(createBlankBrochure(it).cover.eyebrow).toBe('SEAT-IN-COACH (SIC) JOURNEY');
  });

  it('the itinerary template carries the same wording as productEyebrow', async () => {
    const html = await readFile(
      path.join(process.cwd(), 'templates/tailor-made-itinerary/itinerary-template.html'),
      'utf8',
    );
    expect(html).toContain(`'${productEyebrow('sic')}'`);
    expect(html).toContain(`'${productEyebrow('tailor-made')}'`);
  });

  it('rendered html embeds productType in the injected data', async () => {
    const it = createBlankItinerary('Q-2');
    it.trip.productType = 'sic';
    expect(await renderItineraryHtml(it)).toContain('"productType":"sic"');
  });
});
