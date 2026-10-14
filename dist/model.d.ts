export type BaselineLevel = 'low' | 'moderate' | 'high';
export interface ControlFamily {
    id: string;
    name: string;
}
export interface Control {
    id: string;
    familyId: string;
    title: string;
    description: string;
    baselines: BaselineLevel[];
    enhancements?: string[];
}
export type EvidenceType = 'scan-report' | 'config-export' | 'policy-doc' | 'screenshot' | 'attestation' | 'other';
export interface EvidenceArtifact {
    id: string;
    controlId: string;
    type: EvidenceType;
    title: string;
    sha256: string;
    capturedAt: string;
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
    scheduledCompletion: string;
    milestones: string[];
    residualRisk?: string;
}
export type AssessmentStatus = 'satisfied' | 'partial' | 'not-satisfied' | 'not-applicable';
export interface ControlAssessment {
    controlId: string;
    status: AssessmentStatus;
    assessedAt: string;
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
    openFindings: {
        high: number;
        moderate: number;
        low: number;
    };
    coverageByFamily: {
        familyId: string;
        percent: number;
    }[];
}
