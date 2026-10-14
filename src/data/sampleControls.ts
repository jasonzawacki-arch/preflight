import type { Control } from '../model.js';

// SAMPLE controls demonstrating the data model shape. Titles below are real
// NIST SP 800-53 controls; baseline flags are illustrative only. Import the
// authoritative catalog from NIST OSCAL content
// (https://github.com/usnistgov/oscal-content) for production use.
export const SAMPLE_CONTROLS: Control[] = [
  {
    id: 'AC-2',
    familyId: 'AC',
    title: 'Account Management',
    description:
      'Manage system accounts: identify account types, assign account managers, ' +
      'establish conditions for group and role membership, and remove accounts ' +
      'when no longer required.',
    baselines: ['low', 'moderate', 'high'],
    enhancements: ['AC-2(1)', 'AC-2(2)', 'AC-2(3)'],
  },
  {
    id: 'AC-3',
    familyId: 'AC',
    title: 'Access Enforcement',
    description:
      'Enforce approved authorizations for logical access to information and ' +
      'system resources in accordance with applicable access control policies.',
    baselines: ['low', 'moderate', 'high'],
  },
  {
    id: 'AU-2',
    familyId: 'AU',
    title: 'Audit Events',
    description:
      'Determine which events require auditing, and configure the system to ' +
      'audit those events.',
    baselines: ['low', 'moderate', 'high'],
  },
  {
    id: 'AU-6',
    familyId: 'AU',
    title: 'Audit Review, Analysis, and Reporting',
    description:
      'Review and analyze system audit records for indications of inappropriate ' +
      'or unusual activity, and report findings to designated officials.',
    baselines: ['low', 'moderate', 'high'],
    enhancements: ['AU-6(1)', 'AU-6(3)', 'AU-6(4)'],
  },
  {
    id: 'CA-2',
    familyId: 'CA',
    title: 'Control Assessments',
    description:
      'Develop a security assessment plan, assess the controls in the system, ' +
      'and document assessment results and remediation actions.',
    baselines: ['low', 'moderate', 'high'],
    enhancements: ['CA-2(1)', 'CA-2(2)'],
  },
  {
    id: 'CM-2',
    familyId: 'CM',
    title: 'Baseline Configuration',
    description:
      'Develop, document, and maintain a current baseline configuration of the ' +
      'system under configuration control.',
    baselines: ['low', 'moderate', 'high'],
    enhancements: ['CM-2(2)'],
  },
  {
    id: 'IA-2',
    familyId: 'IA',
    title: 'Identification and Authentication (Organizational Users)',
    description:
      'Uniquely identify and authenticate organizational users before granting ' +
      'access to the system.',
    baselines: ['low', 'moderate', 'high'],
    enhancements: ['IA-2(1)', 'IA-2(2)', 'IA-2(8)'],
  },
  {
    id: 'IR-4',
    familyId: 'IR',
    title: 'Incident Handling',
    description:
      'Implement an incident handling capability covering preparation, ' +
      'detection and analysis, containment, eradication, and recovery.',
    baselines: ['low', 'moderate', 'high'],
    enhancements: ['IR-4(1)'],
  },
  {
    id: 'SC-7',
    familyId: 'SC',
    title: 'Boundary Protection',
    description:
      'Monitor and control communications at external and key internal ' +
      'boundaries of the system.',
    baselines: ['low', 'moderate', 'high'],
    enhancements: ['SC-7(3)', 'SC-7(4)', 'SC-7(5)'],
  },
  {
    id: 'SI-2',
    familyId: 'SI',
    title: 'Flaw Remediation',
    description:
      'Identify, report, and correct system flaws; install security-relevant ' +
      'updates within organization-defined time periods.',
    baselines: ['low', 'moderate', 'high'],
    enhancements: ['SI-2(2)'],
  },
];
