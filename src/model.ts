// Preflight data model: one system, assessed against a NIST SP 800-53 Rev. 5 baseline.
// The control catalog itself comes from NIST's OSCAL content (src/data/catalog.json, built by tools/import_oscal.py).

export type BaselineLevel = 'low' | 'moderate' | 'high';
export const BASELINE_KEY: Record<BaselineLevel, string> = { low: 'L', moderate: 'M', high: 'H' };

export interface ControlFamily {
  id: string; // 'AC'
  name: string; // 'Access Control'
}

/** One control or enhancement from the catalog. Short keys keep the bundled catalog small. */
export interface Control {
  id: string; // 'AC-2' or 'AC-2(1)'
  o: string; // OSCAL id: 'ac-2', 'ac-2.1'
  f: string; // family id
  t: string; // title
  b: string; // baselines it belongs to: any of 'L', 'M', 'H', 'P' (privacy)
  s: [number, string, string][]; // statement lines: depth, label, text
  g: string; // discussion
  x: string[]; // SP 800-53A "Examine" objects: what an assessor looks at
  p?: string; // parent control id, for enhancements
}

export interface Catalog {
  source: string;
  version: string;
  published: string;
  families: ControlFamily[];
  controls: Control[];
}

export interface SystemInfo {
  name: string;
  short: string;
  description: string;
  baseline: BaselineLevel;
  privacy: boolean; // also track the privacy baseline
  owner: string; // system owner
  isso: string;
  boundary: string; // authorization boundary description
  status: 'operational' | 'under-development' | 'under-major-modification';
}

export type AssessmentStatus = 'satisfied' | 'partial' | 'not-satisfied' | 'not-applicable';
export type ImplementationOrigin = 'system' | 'inherited' | 'shared' | 'hybrid';

export interface ControlAssessment {
  status?: AssessmentStatus;
  impl: string; // implementation statement, goes into the SSP
  origin?: ImplementationOrigin;
  role: string; // responsible role
  notes: string; // assessor notes, not exported to the SSP
  assessedAt?: string; // ISO date
}

export type EvidenceType = 'scan-report' | 'config-export' | 'policy-doc' | 'screenshot' | 'log-extract' | 'attestation' | 'other';

export interface EvidenceArtifact {
  id: string; // 'EV-001'
  controlIds: string[]; // one artifact often supports several controls
  type: EvidenceType;
  title: string;
  fileName: string;
  size: number;
  mime: string;
  sha256: string; // fingerprint of the stored file, computed in the browser
  capturedAt: string; // ISO date the evidence was produced
  addedAt: string;
  notes: string;
}

export type PoamSeverity = 'high' | 'moderate' | 'low';
export type PoamStatus = 'open' | 'in-progress' | 'risk-accepted' | 'closed';
export type PoamSource = 'assessment' | 'scan' | 'pen-test' | 'self-identified';

export interface Milestone {
  text: string;
  due: string; // ISO date
  done: boolean;
}

export interface PoamItem {
  id: string; // 'POAM-001'
  controlId: string;
  title: string; // the weakness
  description: string;
  severity: PoamSeverity;
  status: PoamStatus;
  source: PoamSource;
  poc: string; // point of contact
  created: string;
  scheduledCompletion: string;
  milestones: Milestone[];
  residualRisk: string; // required when risk is accepted
  closedAt?: string;
  scan?: ScanLink; // set when the item came from a scanner import
}

/** Where an imported POA&M item came from, so a later scan updates or closes it instead of duplicating it. */
export interface ScanLink {
  key: string; // 'prowler:kms_cmk_rotation_enabled'
  tool: string; // 'Prowler'
  check: string;
  controls: string[]; // every control the check maps to
  resources: string[]; // affected resources at the last scan
  lastSeen: string; // date of the last scan that included the check
}

export interface State {
  v: 1;
  demo: boolean; // the sample system: shown with a banner
  system: SystemInfo;
  a: Record<string, ControlAssessment>; // by control id
  evidence: EvidenceArtifact[];
  poams: PoamItem[];
  seq: { ev: number; poam: number };
  updated: string;
}

export interface FamilyScore {
  id: string;
  name: string;
  total: number;
  satisfied: number;
  partial: number;
  notSatisfied: number;
  na: number;
  unassessed: number;
  percent: number; // readiness of the family, 0-100
}

export interface Blocker {
  key: string;
  label: string; // what is wrong, in plain words
  why: string; // why an authorizing official cares
  ids: string[]; // controls or POA&Ms involved
  kind: 'control' | 'poam' | 'evidence';
}

export interface ReadinessSummary {
  baseline: BaselineLevel;
  total: number;
  satisfied: number;
  partial: number;
  notSatisfied: number;
  na: number;
  unassessed: number;
  score: number; // 0-100: satisfied counts 1, partial 0.5; not applicable leaves the denominator
  withEvidence: number; // satisfied or partial controls with at least one evidence artifact
  withImpl: number; // assessed controls with an implementation statement
  openPoams: { high: number; moderate: number; low: number };
  overdue: number;
  families: FamilyScore[];
  blockers: Blocker[];
}
