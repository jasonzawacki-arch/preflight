// Readiness logic: which controls are in scope, how ready the system is, and what blocks an authorization.
// Pure functions over the catalog and the saved state; the screens are in ui.ts.
import type { Blocker, Catalog, Control, ControlAssessment, FamilyScore, PoamItem, ReadinessSummary, State } from './model.js';
import { BASELINE_KEY } from './model.js';

export const today = (): string => new Date().toISOString().slice(0, 10);
export const addDays = (iso: string, n: number): string => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
/** Evidence older than this no longer shows the control works today (annual assessment cycle). */
export const STALE_DAYS = 365;

const EMPTY: ControlAssessment = { impl: '', role: '', notes: '' };
export const assessmentOf = (s: State, id: string): ControlAssessment => s.a[id] || EMPTY;

/** NIST orders controls by family, then number, then enhancement: AC-2 before AC-2(1) before AC-3 before AC-10. */
export function sortKey(id: string): string {
  const m = /^([A-Z]{2})-(\d+)(?:\((\d+)\))?$/.exec(id);
  return m ? `${m[1]}-${m[2].padStart(3, '0')}-${(m[3] || '').padStart(3, '0')}` : id;
}

export function byId(cat: Catalog): Map<string, Control> {
  const m = new Map<string, Control>();
  cat.controls.forEach((c) => m.set(c.id, c));
  return m;
}

/** Controls the system must address: its security baseline, plus the privacy baseline when the system handles PII. */
export function inScope(cat: Catalog, s: State): Control[] {
  const k = BASELINE_KEY[s.system.baseline];
  return cat.controls.filter((c) => c.b.includes(k) || (s.system.privacy && c.b.includes('P')));
}

export const isOpen = (p: PoamItem): boolean => p.status === 'open' || p.status === 'in-progress';
export const isOverdue = (p: PoamItem, now = today()): boolean =>
  isOpen(p) && (!!p.scheduledCompletion && p.scheduledCompletion < now || p.milestones.some((m) => !m.done && m.due && m.due < now));

export function evidenceFor(s: State, id: string) {
  return s.evidence.filter((e) => e.controlIds.includes(id));
}
export function poamsFor(s: State, id: string) {
  return s.poams.filter((p) => p.controlId === id);
}
export const isStale = (capturedAt: string, now = today()): boolean => !!capturedAt && daysBetween(capturedAt, now) > STALE_DAYS;

export function readiness(cat: Catalog, s: State, now = today()): ReadinessSummary {
  const scope = inScope(cat, s);
  const n = { satisfied: 0, partial: 0, notSatisfied: 0, na: 0, unassessed: 0 };
  const fam = new Map<string, FamilyScore>();
  cat.families.forEach((f) => fam.set(f.id, { id: f.id, name: f.name, total: 0, satisfied: 0, partial: 0, notSatisfied: 0, na: 0, unassessed: 0, percent: 0 }));
  const ids = { noPoam: [] as string[], noEvidence: [] as string[], noImpl: [] as string[], unassessed: [] as string[], stale: [] as string[], naNoReason: [] as string[] };
  let withEvidence = 0,
    withImpl = 0;
  for (const c of scope) {
    const a = assessmentOf(s, c.id),
      f = fam.get(c.f)!;
    f.total++;
    const ev = evidenceFor(s, c.id),
      hasPoam = poamsFor(s, c.id).some((p) => isOpen(p) || p.status === 'risk-accepted');
    switch (a.status) {
      case 'satisfied': n.satisfied++; f.satisfied++; break;
      case 'partial': n.partial++; f.partial++; break;
      case 'not-satisfied': n.notSatisfied++; f.notSatisfied++; break;
      case 'not-applicable': n.na++; f.na++; break;
      default: n.unassessed++; f.unassessed++; ids.unassessed.push(c.id);
    }
    if ((a.status === 'not-satisfied' || a.status === 'partial') && !hasPoam) ids.noPoam.push(c.id);
    if (a.status === 'satisfied' || a.status === 'partial') {
      if (ev.length) withEvidence++;
      else if (a.status === 'satisfied') ids.noEvidence.push(c.id);
      if (ev.length && ev.every((e) => isStale(e.capturedAt, now))) ids.stale.push(c.id);
    }
    if (a.status && a.status !== 'not-applicable') {
      if (a.impl.trim()) withImpl++;
      else ids.noImpl.push(c.id);
    }
    if (a.status === 'not-applicable' && !a.impl.trim()) ids.naNoReason.push(c.id);
  }
  const score = (x: { satisfied: number; partial: number; na: number }, total: number) =>
    total - x.na > 0 ? Math.round(((x.satisfied + x.partial / 2) / (total - x.na)) * 100) : 0;
  fam.forEach((f) => (f.percent = score(f, f.total)));

  const open = s.poams.filter(isOpen);
  const openPoams = { high: 0, moderate: 0, low: 0 };
  open.forEach((p) => openPoams[p.severity]++);
  const overdue = s.poams.filter((p) => isOverdue(p, now));
  const acceptedNoRisk = s.poams.filter((p) => p.status === 'risk-accepted' && !p.residualRisk.trim());

  const B: Blocker[] = [];
  const add = (key: string, kind: Blocker['kind'], list: string[], label: string, why: string) => list.length && B.push({ key, kind, ids: list, label, why });
  add('high', 'poam', open.filter((p) => p.severity === 'high').map((p) => p.id), 'Open high-risk findings',
    'Authorizing officials rarely sign with a high-risk weakness still open. Close it or get a documented risk acceptance.');
  add('nopoam', 'control', ids.noPoam, 'Gaps with no POA&M',
    'Every control that is not fully satisfied needs a POA&M entry. A gap without one is a finding in itself.');
  add('overdue', 'poam', overdue.map((p) => p.id), 'Overdue POA&M items',
    'Missed milestones are the first thing reviewers check in continuous monitoring. Update the dates or close the item.');
  add('unassessed', 'control', ids.unassessed, 'Not assessed yet', 'The package is incomplete until every control in the baseline has a status.');
  add('noevidence', 'control', ids.noEvidence, 'Satisfied with no evidence', 'An assessor will ask for proof. Attach the artifact that shows the control works.');
  add('noimpl', 'control', ids.noImpl, 'No implementation statement', 'This control\'s section of the System Security Plan would be empty.');
  add('stale', 'evidence', ids.stale, 'Evidence older than a year', 'Old evidence does not show the control works today. Capture it again.');
  add('nareason', 'control', ids.naNoReason, 'Not applicable with no justification', 'Reviewers expect a reason for every control marked not applicable.');
  add('accepted', 'poam', acceptedNoRisk.map((p) => p.id), 'Risk accepted with no residual risk statement', 'A risk acceptance needs the residual risk written down for the authorizing official.');

  const families = [...fam.values()].filter((f) => f.total > 0);
  return {
    baseline: s.system.baseline,
    total: scope.length,
    ...n,
    score: score(n, scope.length),
    withEvidence,
    withImpl,
    openPoams,
    overdue: overdue.length,
    families,
    blockers: B,
  };
}

export function nextId(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

export async function sha256(data: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function fmtSize(n: number): string {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

export function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso.slice(0, 10) + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
