// Scanner import: read Prowler (OCSF JSON) or AWS Security Hub (ASFF, which also carries AWS Config rule results)
// findings, map them to NIST SP 800-53 Rev. 5 controls, and plan the changes: one POA&M item per failing check,
// updates to items already open for that check, items to close because the check now passes, and controls whose
// status the failures contradict. Nothing changes until the plan is applied.
import type { Catalog, PoamItem, PoamSeverity, State } from './model.js';
import { addDays, assessmentOf, byId, inScope, isOpen, nextId, today } from './logic.js';

export type ScanTool = 'prowler' | 'securityhub';
export const TOOL_NAME: Record<ScanTool, string> = { prowler: 'Prowler', securityhub: 'AWS Security Hub' };

export interface Finding {
  key: string; // check or control id within the tool: 'kms_cmk_rotation_enabled', 'CloudTrail.2'
  title: string;
  severity: PoamSeverity;
  pass: boolean;
  resource: string;
  message: string;
  ids: string[]; // NIST ids as written by the tool, normalized: 'AC-2(3)'
}

export interface Parsed {
  tool: ScanTool;
  findings: Finding[];
  skipped: number; // findings that are not pass/fail, archived, or suppressed
  unmapped: number; // findings with no NIST SP 800-53 Rev. 5 mapping
}

// ---------- reading the files ----------
const SEV: Record<string, PoamSeverity> = { critical: 'high', high: 'high', medium: 'moderate', moderate: 'moderate', low: 'low', informational: 'low' };
const sev = (s: unknown): PoamSeverity => SEV[String(s || '').toLowerCase()] || 'low';

/** Prowler writes NIST requirements as 'ac_2_3_a': family, control, then an enhancement number if the next part is
 *  numeric; letters and later parts are statement items, which belong to the same control. */
export function prowlerId(req: string): string {
  const t = req.toLowerCase().split('_');
  if (t.length < 2 || !/^[a-z]{2}$/.test(t[0]) || !/^\d+$/.test(t[1])) return req.toUpperCase();
  return `${t[0].toUpperCase()}-${+t[1]}${t[2] && /^\d+$/.test(t[2]) ? `(${+t[2]})` : ''}`;
}
/** Security Hub writes 'NIST.800-53.r5 AC-2(1)'. */
export function asffId(req: string): string | null {
  const m = /^NIST\.800-53\.r5\s+([A-Z]{2})-0*(\d+)\s*(?:\(0*(\d+)\))?/i.exec(req.trim());
  return m ? `${m[1].toUpperCase()}-${m[2]}${m[3] ? `(${m[3]})` : ''}` : null;
}

export function parseScan(text: string): Parsed {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not JSON. Export Prowler results with "-M json-ocsf", or Security Hub findings as JSON.');
  }
  const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.Findings) ? data.Findings : [];
  if (!list.length) throw new Error('No findings in this file. Expected a Prowler OCSF JSON file or Security Hub findings ({"Findings": [...]}).');
  const isAsff = (x: any) => x && typeof x === 'object' && ('SchemaVersion' in x || 'Compliance' in x) && 'Title' in x;
  const isOcsf = (x: any) => x && typeof x === 'object' && 'status_code' in x && ('finding_info' in x || 'metadata' in x);
  const out: Parsed = { tool: isAsff(list[0]) ? 'securityhub' : 'prowler', findings: [], skipped: 0, unmapped: 0 };
  if (!isAsff(list[0]) && !isOcsf(list[0])) throw new Error('This does not look like Prowler OCSF output or Security Hub (ASFF) findings.');
  for (const x of list) {
    if (out.tool === 'securityhub') {
      const st = x?.Compliance?.Status;
      if (x?.RecordState === 'ARCHIVED' || ['SUPPRESSED', 'RESOLVED'].includes(x?.Workflow?.Status) || (st !== 'PASSED' && st !== 'FAILED')) {
        out.skipped++;
        continue;
      }
      const ids = ((x.Compliance.RelatedRequirements || []) as string[]).map(asffId).filter(Boolean) as string[];
      if (!ids.length) {
        out.unmapped++;
        continue;
      }
      out.findings.push({
        key: x.Compliance.SecurityControlId || x.ProductFields?.ControlId || x.GeneratorId || x.Title,
        title: String(x.Title || '').replace(/^[A-Za-z0-9]+\.\d+\s+/, ''),
        severity: sev(x.Severity?.Label || x.FindingProviderFields?.Severity?.Label),
        pass: st === 'PASSED',
        resource: x.Resources?.[0]?.Id || '',
        message: x.ProductFields?.['aws/securityhub/annotation'] || x.Description || x.Title || '',
        ids,
      });
    } else {
      const sc = String(x?.status_code || '').toUpperCase();
      if (sc !== 'PASS' && sc !== 'FAIL') {
        out.skipped++;
        continue;
      }
      const comp = x?.unmapped?.compliance || {};
      const reqKey = Object.keys(comp).find((k) => /^NIST-800-53-Revision-5/i.test(k));
      const ids = reqKey ? (comp[reqKey] as string[]).map(prowlerId) : [];
      if (!ids.length) {
        out.unmapped++;
        continue;
      }
      out.findings.push({
        key: x.metadata?.event_code || x.finding_info?.title || 'check',
        title: x.finding_info?.title || x.metadata?.event_code || '',
        severity: sev(x.severity),
        pass: sc === 'PASS',
        resource: x.resources?.[0]?.uid || x.resources?.[0]?.name || '',
        message: x.status_detail || x.message || '',
        ids,
      });
    }
  }
  return out;
}

// ---------- choosing the primary control ----------
// A check usually maps to many controls (Prowler maps some checks to 40+). The POA&M item lists all of them, and names
// the one the check is really about as its control, chosen by topic; otherwise the first mapped control in the baseline.
const TOPICS: [RegExp, string[]][] = [
  [/mfa|multi.?factor/i, ['IA-2(1)', 'IA-2(2)', 'IA-2']],
  [/password/i, ['IA-5(1)', 'IA-5']],
  [/access.?key|unused|inactive|credentials?_unused/i, ['AC-2(3)', 'AC-2']],
  [/rotation/i, ['SC-12']],
  [/log.?file.?validation|integrity/i, ['AU-9']],
  [/encrypt|kms|sse/i, ['SC-28(1)', 'SC-28', 'SC-13']],
  [/backup|snapshot|retention/i, ['CP-9']],
  [/flow.?log|cloudtrail|logging|trail|audit/i, ['AU-12', 'AU-2']],
  [/security.?group|ingress|public|0\.0\.0\.0|nacl|internet/i, ['SC-7', 'AC-3']],
  [/imds|metadata/i, ['AC-3', 'CM-7']],
  [/guardduty|securityhub|security.?hub|monitor|detector/i, ['SI-4']],
  [/config_?recorder|inventory/i, ['CM-8', 'CM-2']],
  [/patch|vulnerab|inspector/i, ['RA-5', 'SI-2']],
];
const base = (id: string) => id.replace(/\(\d+\)$/, '');

export function primaryControl(f: { key: string; title: string }, mapped: string[], scope: Set<string>): string {
  const text = `${f.key} ${f.title}`;
  for (const [re, prefs] of TOPICS) {
    if (!re.test(text)) continue;
    for (const p of prefs) if (mapped.some((m) => m === p || base(m) === p) && scope.has(p)) return p;
  }
  const inBaseline = mapped.find((m) => scope.has(m));
  if (inBaseline) return inBaseline;
  return mapped.map(base).find((b) => scope.has(b)) || mapped[0];
}

// ---------- planning ----------
export interface CheckPlan {
  key: string; // tool:check
  check: string;
  title: string;
  severity: PoamSeverity;
  control: string; // primary
  controls: string[]; // every catalog control the check maps to, NIST order
  failed: { resource: string; message: string }[];
  passed: number;
  existing?: string; // id of the open POA&M item this updates
}
export interface ImportPlan {
  tool: ScanTool;
  fileName: string;
  findings: number;
  skipped: number;
  unmapped: number;
  unknownIds: string[]; // ids the tool maps to that are not in the catalog (withdrawn or mistyped)
  failing: CheckPlan[];
  passing: CheckPlan[];
  close: string[]; // open POA&M items whose check now passes everywhere
  downgrade: string[]; // satisfied controls that a failing check contradicts
}

const ORDER = (cat: Catalog) => {
  const m = new Map<string, number>();
  cat.controls.forEach((c, i) => m.set(c.id, i));
  return m;
};
const WINDOW: Record<PoamSeverity, number> = { high: 30, moderate: 90, low: 180 };

export function planImport(cat: Catalog, s: State, parsed: Parsed, fileName: string): ImportPlan {
  const known = byId(cat),
    order = ORDER(cat),
    scope = new Set(inScope(cat, s).map((c) => c.id));
  const unknown = new Set<string>();
  const checks = new Map<string, CheckPlan>();
  for (const f of parsed.findings) {
    const key = `${parsed.tool}:${f.key}`;
    let c = checks.get(key);
    if (!c) {
      const ids = [...new Set(f.ids)].filter((id) => (known.has(id) ? true : (unknown.add(id), false)));
      ids.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
      if (!ids.length) continue;
      c = { key, check: f.key, title: f.title, severity: f.severity, control: primaryControl(f, ids, scope), controls: ids, failed: [], passed: 0 };
      checks.set(key, c);
    }
    if (f.pass) c.passed++;
    else {
      c.failed.push({ resource: f.resource, message: f.message });
      if (['high', 'moderate', 'low'].indexOf(f.severity) < ['high', 'moderate', 'low'].indexOf(c.severity)) c.severity = f.severity;
    }
  }
  const openByKey = new Map(s.poams.filter((p) => isOpen(p) && p.scan).map((p) => [p.scan!.key, p.id] as const));
  const failing = [...checks.values()].filter((c) => c.failed.length);
  const passing = [...checks.values()].filter((c) => !c.failed.length);
  failing.forEach((c) => (c.existing = openByKey.get(c.key)));
  const rank = (x: PoamSeverity) => ['high', 'moderate', 'low'].indexOf(x);
  failing.sort((a, b) => rank(a.severity) - rank(b.severity) || b.failed.length - a.failed.length);
  return {
    tool: parsed.tool,
    fileName,
    findings: parsed.findings.length,
    skipped: parsed.skipped,
    unmapped: parsed.unmapped,
    unknownIds: [...unknown].sort(),
    failing,
    passing,
    close: passing.map((c) => openByKey.get(c.key)).filter(Boolean) as string[],
    downgrade: [...new Set(failing.map((c) => c.control))].filter((id) => assessmentOf(s, id).status === 'satisfied'),
  };
}

export interface ImportChoices {
  poams: boolean;
  close: boolean;
  downgrade: boolean;
}
export interface ImportResult {
  created: string[];
  updated: string[];
  closed: string[];
  downgraded: string[];
}

function describe(plan: ImportPlan, c: CheckPlan): string {
  const lines = c.failed.slice(0, 10).map((f) => `- ${f.message}${f.resource && !f.message.includes(f.resource) ? ` (${f.resource})` : ''}`);
  if (c.failed.length > 10) lines.push(`- and ${c.failed.length - 10} more`);
  return `${TOOL_NAME[plan.tool]} check ${c.check} failed on ${c.failed.length} ${c.failed.length === 1 ? 'resource' : 'resources'}:\n${lines.join('\n')}`;
}

/** Apply a plan to the state. Returns what changed; the caller saves. */
export function applyImport(s: State, plan: ImportPlan, ch: ImportChoices, now = today()): ImportResult {
  const r: ImportResult = { created: [], updated: [], closed: [], downgraded: [] };
  const toolName = TOOL_NAME[plan.tool];
  if (ch.poams)
    for (const c of plan.failing) {
      const scan = { key: c.key, tool: toolName, check: c.check, controls: c.controls, resources: c.failed.map((f) => f.resource).filter(Boolean).slice(0, 50), lastSeen: now };
      const existing = c.existing && s.poams.find((p) => p.id === c.existing);
      if (existing) {
        existing.description = describe(plan, c);
        existing.scan = scan;
        if (['high', 'moderate', 'low'].indexOf(c.severity) < ['high', 'moderate', 'low'].indexOf(existing.severity)) existing.severity = c.severity;
        r.updated.push(existing.id);
        continue;
      }
      const due = addDays(now, WINDOW[c.severity]);
      const p: PoamItem = {
        id: nextId('POAM', ++s.seq.poam),
        controlId: c.control,
        title: `Scan finding: ${c.title}`,
        description: describe(plan, c),
        severity: c.severity,
        status: 'open',
        source: 'scan',
        poc: assessmentOf(s, c.control).role,
        created: now,
        scheduledCompletion: due,
        milestones: [{ text: `Fix the ${c.failed.length === 1 ? 'affected resource' : `${c.failed.length} affected resources`} and scan again`, due, done: false }],
        residualRisk: '',
        scan,
      };
      s.poams.push(p);
      r.created.push(p.id);
    }
  if (ch.close)
    for (const id of plan.close) {
      const p = s.poams.find((x) => x.id === id);
      if (!p || !isOpen(p)) continue;
      p.status = 'closed';
      p.closedAt = now;
      p.milestones.forEach((m) => (m.done = true));
      p.description += `\n\nClosed ${now}: the check passed in ${toolName} scan ${plan.fileName}.`;
      if (p.scan) p.scan.lastSeen = now;
      r.closed.push(id);
    }
  if (ch.downgrade)
    for (const id of plan.downgrade) {
      const a = s.a[id];
      if (!a || a.status !== 'satisfied') continue;
      a.status = 'partial';
      a.assessedAt = now;
      const checks = plan.failing.filter((c) => c.control === id).map((c) => c.check);
      a.notes = `${a.notes ? a.notes + '\n' : ''}${now}: set to partial after ${toolName} scan (${checks.join(', ')} failed).`;
      r.downgraded.push(id);
    }
  return r;
}
