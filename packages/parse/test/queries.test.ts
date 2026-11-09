import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '../src/languages.js';
import { loadLanguage } from '../src/treesitter/loader.js';
import { TAGS_QUERIES } from '../src/treesitter/queries.js';

describe('tags queries', () => {
  for (const lang of LANGUAGES) {
    it(`compiles for ${lang}`, async () => {
      const language = await loadLanguage(lang);
      const q = language.query(TAGS_QUERIES[lang]);
      expect(q.captureNames.length).toBeGreaterThan(2);
    });
  }
});
