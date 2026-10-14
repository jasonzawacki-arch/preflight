import type { ReadinessSummary } from './model.js';
import { FAMILIES } from './data/families.js';
import { SAMPLE_CONTROLS } from './data/sampleControls.js';

// Minimal scaffold entry point: summarizes the sample catalog.
// The UI layer (single-file TypeScript app, local-first IndexedDB) builds on
// the model in ./model.ts.
export function summarizeSampleCatalog(): ReadinessSummary {
  const byFamily = new Map<string, { total: number; satisfied: number }>();
  for (const c of SAMPLE_CONTROLS) {
    const e = byFamily.get(c.familyId) ?? { total: 0, satisfied: 0 };
    e.total += 1;
    byFamily.set(c.familyId, e);
  }
  return {
    baseline: 'moderate',
    totalControls: SAMPLE_CONTROLS.length,
    satisfied: 0,
    partial: 0,
    notSatisfied: SAMPLE_CONTROLS.length,
    notApplicable: 0,
    openFindings: { high: 0, moderate: 0, low: 0 },
    coverageByFamily: FAMILIES.filter((f) => byFamily.has(f.id)).map((f) => ({
      familyId: f.id,
      percent: 0,
    })),
  };
}

const s = summarizeSampleCatalog();
console.log(
  `Preflight scaffold: ${FAMILIES.length} control families, ` +
    `${s.totalControls} sample controls loaded. ` +
    `Import the NIST OSCAL catalog for production data.`,
);
