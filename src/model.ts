// Preflight data model — ATO readiness tracking.
//
// Control catalog rows in src/data are SAMPLE/illustrative data showing the
// shape of the model. Import the authoritative NIST SP 800-53 Rev. 5 catalog
// from NIST OSCAL content (https://github.com/usnistgov/oscal-content)
// for production use. Do not treat sample baselines as authoritative.

export type BaselineLevel = 'low' | 'moderate' | 'high';

export interface ControlFamily {
  id: string; // e.g. 'AC'
  name: string; // e.g. 'Access Control'
}

export interface Control {
  id: string; // e.g. 'AC-2'
  familyId: string; // e.g. 'AC'
  title: string; // e.g. 'Account Management'
  description: string; // plain-language summary
  baselines: BaselineLevel[]; // illustrative in sample data
  enhancements?: string[]; // e.g. ['AC-2(1)', 'AC-2(2)']
}

export type EvidenceType =
  | 'scan-report'
  | 'config-export'
  | 'policy-doc'
  | 'screenshot'
  | 'attestation'
  | 'other';

export interface EvidenceArtifact {
  id: string;
  controlId: string;
  type: EvidenceType;
  title: string;
  sha256: string; // integrity hash of the stored file
  capturedAt: string; // ISO date
  notes?: string;
}

export type PoamSeverity = 'high' | 'moderate' | 'low';
export type PoamStatus = 'open' | 'in-progress' | 'risk-accepted' | 'closed';

export interface PoamItem {
  id: string;
  controlId: string;
  title: string;
  severity: PoamSeverity;
  status: PoamStatus;
  scheduledCompletion: string; // ISO date
  milestones: string[];
  residualRisk?: string;
}

export type AssessmentStatus =
  | 'satisfied'
  | 'partial'
  | 'not-satisfied'
  | 'not-applicable';

export interface ControlAssessment {
  controlId: string;
  status: AssessmentStatus;
  assessedAt: string; // ISO date
  assessedBy?: string;
  notes?: string;
}

export interface ReadinessSummary {
  baseline: BaselineLevel;
  totalControls: number;
  satisfied: number;
  partial: number;
  notSatisfied: number;
  notApplicable: number;
  openFindings: { high: number; moderate: number; low: number };
  coverageByFamily: { familyId: string; percent: number }[];
}
