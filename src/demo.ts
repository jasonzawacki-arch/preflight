// The sample system shown on first open: a fictional grants portal partway through its assessment against the
// Moderate baseline. Everything here is made up; the dates are relative to today so the demo never goes stale.
import type { Catalog, ControlAssessment, EvidenceArtifact, PoamItem, State } from './model.js';
import { addDays, inScope, sha256, today } from './logic.js';

export function blankState(): State {
  return {
    v: 1,
    demo: false,
    system: { name: '', short: '', description: '', baseline: 'moderate', privacy: false, owner: '', isso: '', boundary: '', status: 'under-development' },
    a: {},
    evidence: [],
    poams: [],
    seq: { ev: 0, poam: 0 },
    updated: new Date().toISOString(),
  };
}

// Small deterministic random numbers, so every visitor sees the same sample.
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// How far along each family is: [satisfied, partial, not satisfied, not applicable]; the rest is not assessed yet.
const PROGRESS: Record<string, number[]> = {
  AC: [0.78, 0.12, 0.04, 0], IA: [0.8, 0.1, 0.05, 0], AU: [0.75, 0.15, 0.05, 0], CM: [0.7, 0.15, 0.05, 0],
  SC: [0.68, 0.12, 0.06, 0.04], SI: [0.65, 0.15, 0.08, 0], RA: [0.7, 0.1, 0.1, 0], CA: [0.6, 0.2, 0.05, 0],
  PL: [0.8, 0.1, 0, 0], PS: [0.85, 0.05, 0, 0], AT: [0.85, 0.1, 0, 0], PE: [0.4, 0.05, 0, 0.5],
  MA: [0.5, 0.15, 0.05, 0.1], MP: [0.45, 0.1, 0, 0.3], IR: [0.55, 0.2, 0.1, 0], CP: [0.35, 0.3, 0.15, 0],
  SA: [0.5, 0.15, 0.05, 0], SR: [0.2, 0.2, 0.1, 0], PM: [0.3, 0.1, 0, 0], PT: [0.3, 0.1, 0, 0],
};

const IMPL: Record<string, [string, string]> = {
  'AC-2': ['Accounts are provisioned through the agency identity provider (Okta) from approved access requests in ServiceNow. Account types allowed are individual, privileged and service; shared and guest accounts are prohibited. Account managers review all accounts quarterly and the identity team disables accounts within 24 hours of separation, driven by the HR feed.', 'Identity and Access Lead'],
  'AC-2(1)': ['Provisioning, disabling and removal are automated through SCIM between the HR system, Okta and the application. Exceptions are tracked as ServiceNow tickets.', 'Identity and Access Lead'],
  'AC-3': ['The application enforces role-based access in its authorization service. Roles map to grant program functions (applicant, reviewer, program officer, administrator) and are checked on every API request.', 'Application Lead'],
  'AC-6': ['Privileged roles are limited to the operations team. Administrators use separate privileged accounts, and production access is granted just in time through AWS IAM Identity Center for at most four hours.', 'Cloud Operations Lead'],
  'AC-7': ['Okta locks an account for 30 minutes after five consecutive failed logon attempts within 15 minutes.', 'Identity and Access Lead'],
  'AC-17': ['There is no remote access to the system other than through the agency VPN and the AWS console behind single sign-on with phishing-resistant MFA.', 'Cloud Operations Lead'],
  'AU-2': ['The system logs authentication events, privileged actions, changes to roles, data exports and configuration changes. The event list is reviewed annually with the agency SOC and was last updated this year.', 'ISSO'],
  'AU-6': ['Logs are forwarded to the agency SIEM (Splunk). The SOC reviews correlated alerts daily and the ISSO reviews the privileged activity report weekly.', 'ISSO'],
  'AU-11': ['Audit records are retained for one year online and six years in archive storage (S3 Glacier with object lock), meeting NARA GRS 3.2.', 'Cloud Operations Lead'],
  'CA-7': ['The continuous monitoring strategy covers monthly vulnerability scanning, quarterly access reviews, annual assessment of one third of controls, and monthly POA&M reporting to the agency.', 'ISSO'],
  'CM-2': ['The baseline configuration is defined as code (Terraform and hardened AMIs built from CIS Level 1 benchmarks) and is version-controlled in GitHub. Drift is detected nightly by AWS Config.', 'Cloud Operations Lead'],
  'CM-6': ['Configuration settings follow CIS benchmarks for Amazon Linux 2023 and PostgreSQL. Deviations are documented in the configuration deviation register.', 'Cloud Operations Lead'],
  'CM-8': ['The component inventory is generated from AWS Config and tagged resources and is exported monthly. It includes all EC2 instances, RDS databases, load balancers and S3 buckets inside the boundary.', 'Cloud Operations Lead'],
  'IA-2': ['All users authenticate through Okta single sign-on. Privileged users must use phishing-resistant MFA (PIV or FIDO2); other users use Okta Verify.', 'Identity and Access Lead'],
  'IA-2(1)': ['MFA is required for every privileged account; Okta policy blocks privileged sign-in without PIV or FIDO2.', 'Identity and Access Lead'],
  'IA-5': ['Passwords follow NIST SP 800-63B: 12 characters minimum, checked against a breached-password list, no forced periodic change. Service credentials are stored in AWS Secrets Manager and rotated every 90 days.', 'Identity and Access Lead'],
  'IR-4': ['Incidents are handled under the agency incident response plan. The system team reports to the agency SOC within one hour of detection and supports containment through runbooks kept in the operations wiki.', 'ISSO'],
  'RA-5': ['Tenable scans all hosts weekly with credentials and the web application is scanned monthly. Findings are remediated within 30 days for critical and high, 90 days for moderate, and tracked in the POA&M when late.', 'ISSO'],
  'SC-7': ['The boundary is a dedicated VPC with public subnets only for the load balancer. Security groups deny by default and AWS WAF filters inbound web traffic.', 'Cloud Operations Lead'],
  'SC-8': ['All traffic is encrypted in transit with TLS 1.2 or higher using FIPS-validated modules; the load balancer policy rejects older protocols.', 'Cloud Operations Lead'],
  'SC-13': ['Cryptography uses FIPS 140-validated modules: AWS KMS for keys and the FIPS endpoints of AWS services.', 'Cloud Operations Lead'],
  'SC-28': ['Data at rest in RDS, EBS and S3 is encrypted with customer-managed KMS keys.', 'Cloud Operations Lead'],
  'SI-2': ['Operating system patches are applied monthly through rebuilt images; critical patches within 15 days. Application dependencies are updated through Dependabot pull requests.', 'Application Lead'],
  'SI-4': ['GuardDuty and the agency SIEM monitor the system. Alerts go to the SOC around the clock and to the operations on-call channel.', 'ISSO'],
  'PE-1': ['Inherited from AWS GovCloud (US) FedRAMP High authorization; physical and environmental protection is the provider\'s responsibility.', 'AWS GovCloud (US)'],
  'PE-2': ['Inherited from AWS GovCloud (US).', 'AWS GovCloud (US)'],
  'PE-3': ['Inherited from AWS GovCloud (US).', 'AWS GovCloud (US)'],
  'CP-9': ['RDS automated backups are taken daily and kept for 35 days; weekly snapshots are copied to a second region. Restore testing is not yet scheduled (see POA&M).', 'Cloud Operations Lead'],
  'PL-2': ['This System Security Plan is maintained in Preflight and reviewed annually and after significant changes.', 'ISSO'],
  'PS-3': ['All staff with access complete a background investigation at the Tier 2 level before access is granted, verified by the agency personnel security office.', 'Agency Personnel Security'],
  'AT-2': ['All users complete the agency security and privacy awareness course before access and annually after that; completion is tracked in the agency learning system.', 'ISSO'],
};

const NA_REASON = 'Not applicable: the system runs entirely in AWS GovCloud (US) and has no facility, media or equipment of its own.';

interface DemoEv {
  title: string;
  type: EvidenceArtifact['type'];
  file: string;
  mime: string;
  ago: number;
  ids: string[];
  body: string;
  notes?: string;
}
const EVIDENCE: DemoEv[] = [
  { title: 'Quarterly account review, Q3', type: 'attestation', file: 'account-review-q3.csv', mime: 'text/csv', ago: 21, ids: ['AC-2', 'AC-2(3)', 'AC-6(7)'],
    body: 'account,type,manager,decision,reviewed_on\njdoe,individual,mlee,keep,\nsvc-batch,service,dops,keep,\nabrown,individual,mlee,disable,\n' },
  { title: 'Okta sign-on and lockout policy export', type: 'config-export', file: 'okta-policies.json', mime: 'application/json', ago: 40, ids: ['AC-7', 'IA-2', 'IA-2(1)', 'IA-2(2)', 'IA-5'],
    body: '{"policies":[{"name":"Privileged","factors":["piv","fido2"]},{"name":"Lockout","maxAttempts":5,"windowMinutes":15,"lockMinutes":30}]}\n' },
  { title: 'Weekly credentialed vulnerability scan', type: 'scan-report', file: 'tenable-scan-summary.csv', mime: 'text/csv', ago: 6, ids: ['RA-5', 'SI-2'],
    body: 'severity,count,oldest_days\ncritical,0,0\nhigh,2,41\nmedium,14,63\nlow,30,120\n', notes: 'Two highs are past 30 days: see POAM-001.' },
  { title: 'AWS Config conformance pack results', type: 'config-export', file: 'aws-config-conformance.json', mime: 'application/json', ago: 3, ids: ['CM-2', 'CM-6', 'CM-8', 'SC-28'],
    body: '{"pack":"Operational-Best-Practices-for-NIST-800-53-rev5","compliant":212,"noncompliant":9}\n' },
  { title: 'Audit event list and SIEM forwarding', type: 'policy-doc', file: 'audit-events.txt', mime: 'text/plain', ago: 120, ids: ['AU-2', 'AU-3', 'AU-6', 'AU-12'],
    body: 'Logged events: authentication success and failure; role changes; data export; privileged commands; configuration changes.\nForwarded to: agency Splunk, index bgp_prod.\n' },
  { title: 'Load balancer TLS policy', type: 'config-export', file: 'alb-tls-policy.txt', mime: 'text/plain', ago: 55, ids: ['SC-8', 'SC-13'],
    body: 'Policy: ELBSecurityPolicy-TLS13-1-2-FIPS-2023-04\nProtocols: TLSv1.2, TLSv1.3\n' },
  { title: 'Network diagram and security groups', type: 'screenshot', file: 'boundary-diagram.txt', mime: 'text/plain', ago: 400, ids: ['SC-7', 'CA-9'],
    body: 'Boundary: VPC vpc-0bayview; public subnets: ALB only; app and data subnets private; egress through NAT with allow list.\n', notes: 'Diagram predates the move to private API endpoints.' },
  { title: 'Incident response plan, system annex', type: 'policy-doc', file: 'ir-annex.txt', mime: 'text/plain', ago: 300, ids: ['IR-1', 'IR-4', 'IR-6', 'IR-8'],
    body: 'Report to the agency SOC within one hour. Runbooks: credential compromise, data exposure, ransomware, denial of service.\n' },
  { title: 'Security awareness completion report', type: 'attestation', file: 'awareness-completion.csv', mime: 'text/csv', ago: 30, ids: ['AT-2', 'AT-3'],
    body: 'user,course,completed\njdoe,Security and Privacy Awareness 2026,yes\nabrown,Security and Privacy Awareness 2026,yes\n' },
  { title: 'Backup configuration and retention', type: 'config-export', file: 'rds-backup.json', mime: 'application/json', ago: 90, ids: ['CP-9', 'CP-6'],
    body: '{"BackupRetentionPeriod":35,"CrossRegionCopy":"us-gov-east-1","SnapshotSchedule":"weekly"}\n' },
  { title: 'GuardDuty and SIEM alert routing', type: 'config-export', file: 'alert-routing.txt', mime: 'text/plain', ago: 75, ids: ['SI-4', 'SI-4(4)', 'IR-5'],
    body: 'GuardDuty findings -> EventBridge -> agency SIEM and #bgp-oncall. Severity 7+ pages on-call.\n' },
  { title: 'AWS GovCloud FedRAMP High customer responsibility matrix', type: 'policy-doc', file: 'aws-crm-extract.txt', mime: 'text/plain', ago: 200, ids: ['PE-1', 'PE-2', 'PE-3', 'PE-6', 'MA-2'],
    body: 'Extract: PE family fully inherited from AWS GovCloud (US) FedRAMP High P-ATO.\n' },
];

interface DemoPoam {
  c: string; title: string; d: string; sev: PoamItem['severity']; st: PoamItem['status']; src: PoamItem['source']; poc: string;
  created: number; due: number; ms: [string, number, boolean][]; rr?: string;
}
const POAMS: DemoPoam[] = [
  { c: 'RA-5', title: 'Two high vulnerabilities past the 30-day remediation window', d: 'OpenSSL and kernel findings on the batch worker image remain after the August image rebuild was deferred.', sev: 'high', st: 'in-progress', src: 'scan', poc: 'Cloud Operations Lead', created: -45, due: 10, ms: [['Rebuild batch worker image with patched packages', -5, true], ['Redeploy and rescan', 7, false]] },
  { c: 'CP-4', title: 'Contingency plan has never been tested', d: 'No tabletop or functional exercise of the contingency plan has been run since the system went live.', sev: 'moderate', st: 'open', src: 'assessment', poc: 'ISSO', created: -60, due: 45, ms: [['Schedule tabletop exercise with agency COOP office', -10, false], ['Run exercise and write after-action report', 40, false]] },
  { c: 'CP-9', title: 'Backup restores are not tested', d: 'Backups are taken but no restore has been performed to show they work.', sev: 'moderate', st: 'open', src: 'assessment', poc: 'Cloud Operations Lead', created: -60, due: 30, ms: [['Restore last weekly snapshot to an isolated account', 20, false]] },
  { c: 'SR-3', title: 'No supply chain risk management plan for the system', d: 'Third-party components and SaaS dependencies are not covered by a documented supply chain plan.', sev: 'moderate', st: 'open', src: 'self-identified', poc: 'ISSO', created: -30, due: 120, ms: [['Inventory third-party components and SaaS', 30, false], ['Draft SCRM plan', 90, false]] },
  { c: 'AC-2(3)', title: 'Inactive accounts disabled after 120 days instead of 90', d: 'Okta inactivity rule is set to 120 days; the agency standard is 90.', sev: 'low', st: 'in-progress', src: 'assessment', poc: 'Identity and Access Lead', created: -20, due: 15, ms: [['Change Okta inactivity rule and notify users', 15, false]] },
  { c: 'IR-3', title: 'Incident response capability not tested this year', d: 'Annual incident response test is overdue.', sev: 'moderate', st: 'open', src: 'assessment', poc: 'ISSO', created: -100, due: -12, ms: [['Run phishing-to-compromise tabletop with the SOC', -12, false]] },
  { c: 'SC-7(4)', title: 'Egress allow list includes broad vendor ranges', d: 'The NAT egress allow list permits whole vendor CIDR ranges rather than specific endpoints.', sev: 'low', st: 'risk-accepted', src: 'pen-test', poc: 'Cloud Operations Lead', created: -150, due: 200, ms: [], rr: 'Low: outbound traffic is limited to TLS to three named vendors and is logged; the AO accepted the risk until the private endpoint migration.' },
  { c: 'SI-10', title: 'File upload type checking relied on extension only', d: 'Grant attachments were accepted by file extension without content checks.', sev: 'moderate', st: 'closed', src: 'pen-test', poc: 'Application Lead', created: -120, due: -30, ms: [['Add content-type sniffing and malware scanning on upload', -35, true]] },
];

export async function demoState(cat: Catalog): Promise<{ state: State; files: Record<string, Blob> }> {
  const t = today();
  const s = blankState();
  s.demo = true;
  s.system = {
    name: 'Bayview Grants Portal',
    short: 'BGP',
    description: 'A fictional web application where applicants submit grant proposals and program officers review and award them. Hosted in AWS GovCloud (US).',
    baseline: 'moderate',
    privacy: false,
    owner: 'Dana Ruiz, Grants Program Office',
    isso: 'Marcus Lee',
    boundary: 'One AWS GovCloud (US) account: a VPC with an application load balancer, the web and API services on EC2, a PostgreSQL database on RDS and S3 buckets for attachments. Identity is provided by the agency Okta tenant and is outside the boundary.',
    status: 'under-development',
  };
  const r = rng(53);
  for (const c of inScope(cat, s)) {
    const p = PROGRESS[c.f] || [0.5, 0.1, 0.05, 0],
      x = r();
    let status: ControlAssessment['status'];
    if (x < p[0]) status = 'satisfied';
    else if (x < p[0] + p[1]) status = 'partial';
    else if (x < p[0] + p[1] + p[2]) status = 'not-satisfied';
    else if (x < p[0] + p[1] + p[2] + p[3]) status = 'not-applicable';
    if (!status) continue;
    const im = IMPL[c.id];
    s.a[c.id] = {
      status,
      impl: im ? im[0] : status === 'not-applicable' ? NA_REASON : '',
      role: im ? im[1] : '',
      origin: c.f === 'PE' ? 'inherited' : undefined,
      notes: '',
      assessedAt: addDays(t, -Math.floor(r() * 90)),
    };
  }
  // the handwritten controls get the status their text describes
  for (const id of Object.keys(IMPL)) {
    const a = s.a[id] || (s.a[id] = { impl: IMPL[id][0], role: IMPL[id][1], notes: '', assessedAt: addDays(t, -14) });
    a.status = id === 'CP-9' ? 'partial' : 'satisfied';
    if (id.startsWith('PE')) a.origin = 'inherited';
  }
  const files: Record<string, Blob> = {};
  for (const e of EVIDENCE) {
    const id = `EV-${String(++s.seq.ev).padStart(3, '0')}`,
      blob = new Blob([e.body], { type: e.mime });
    files[id] = blob;
    s.evidence.push({
      id, controlIds: e.ids, type: e.type, title: e.title, fileName: e.file, size: blob.size, mime: e.mime,
      sha256: await sha256(await blob.arrayBuffer()), capturedAt: addDays(t, -e.ago), addedAt: addDays(t, -Math.max(0, e.ago - 2)), notes: e.notes || '',
    });
  }
  for (const p of POAMS) {
    s.poams.push({
      id: `POAM-${String(++s.seq.poam).padStart(3, '0')}`, controlId: p.c, title: p.title, description: p.d, severity: p.sev, status: p.st, source: p.src, poc: p.poc,
      created: addDays(t, p.created), scheduledCompletion: addDays(t, p.due), milestones: p.ms.map(([text, due, done]) => ({ text, due: addDays(t, due), done })),
      residualRisk: p.rr || '', closedAt: p.st === 'closed' ? addDays(t, p.due) : undefined,
    });
    // the weakness shows on its control
    const a = s.a[p.c] || (s.a[p.c] = { impl: '', role: '', notes: '' });
    if (p.st === 'closed') a.status = a.status || 'satisfied';
    else if (a.status !== 'not-satisfied') a.status = 'partial';
  }
  return { state: s, files };
}
