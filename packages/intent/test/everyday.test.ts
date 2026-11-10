import { describe, expect, it } from 'vitest';
import { classify } from '../src/classify.js';
import { normalizedEntropy } from '../src/entropy.js';

/**
 * Requests worded the way people actually type them in the console. Each must land on its intent with
 * a confident reading (normalised entropy below the 0.70 probe threshold), so the console shows the
 * right kind of prompt instead of "not clear yet".
 */
const CASES: [string, string][] = [
  ['Build a new feature, which enhances the ISS tracking better', 'feature'],
  ['Build a new feature for ISS tracking', 'feature'],
  ['New feature: show the next ISS pass over my city', 'feature'],
  ['Enhance the globe so the ISS orbit trail is smoother', 'feature'],
  ['Improve the ISS tracking with predicted passes', 'feature'],
  ['Extend the launch feed to include upcoming SpaceX launches', 'feature'],
  ['I want a feature that alerts me when the ISS is overhead', 'feature'],
  ['Create a dashboard page for debris tracking', 'feature'],
  ['Refactor the ISS crew server into smaller modules', 'refactor'],
  ['Improve the readability of the propagation code', 'refactor'],
  ['Optimize the globe rendering code without changing behaviour', 'refactor'],
  ['The ISS marker is not updating after the first minute', 'bugfix'],
  ['There is a bug in the country highlight on the globe', 'bugfix'],
  ['Fix the build: npm run build fails with a missing import', 'bugfix'],
  ['The build is broken after the last merge', 'bugfix'],
  ['Explain how the ISS propagation works', 'onboarding'],
  ['Review my changes to the launch feed server', 'review'],
  ['Resolve the merge conflicts in package.json', 'merge'],
];

describe('everyday wording', () => {
  it.each(CASES)('“%s” reads as %s', (text, intent) => {
    const w = classify({ text });
    const top = Object.entries(w).sort((a, b) => b[1] - a[1])[0]![0];
    expect(top).toBe(intent);
    expect(normalizedEntropy(w)).toBeLessThan(0.7);
  });

  it('does not mistake build failures for feature work or a past merge for a merge task', () => {
    for (const t of ['The build fails on CI', 'Build is broken since yesterday']) expect(classify({ text: t }).feature).toBeLessThan(0.2);
    expect(classify({ text: 'Tests started failing after the latest merge' }).merge).toBeLessThan(0.2);
  });
});
