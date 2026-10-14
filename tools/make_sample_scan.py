"""Build src/data/sample-scan.json: a small Prowler scan of the fictional Bayview Grants Portal, in Prowler's OCSF
JSON output format, for the demo's "Try a sample scan" button.

Usage: python3 tools/make_sample_scan.py PATH/TO/prowler   (a checkout of github.com/prowler-cloud/prowler)

Check IDs, titles, severities and the NIST SP 800-53 Rev. 5 mappings come from Prowler's own files
(check metadata and prowler/compliance/aws/nist_800_53_revision_5_aws.json). The account, resources and results
are made up."""
import json, sys
from pathlib import Path

PROWLER = Path(sys.argv[1] if len(sys.argv) > 1 else 'prowler')
OUT = Path(__file__).resolve().parent.parent / 'src' / 'data' / 'sample-scan.json'
ACCT, REGION = '111122223333', 'us-gov-west-1'
arn = lambda svc, rest, region=REGION: f'arn:aws-us-gov:{svc}:{region}:{ACCT}:{rest}'

# check -> (status, [(resource uid, resource name)])
RESULTS = {
    'iam_user_accesskey_unused': ('FAIL', [(arn('iam', 'user/svc-reporting', ''), 'svc-reporting'), (arn('iam', 'user/jdoe-admin', ''), 'jdoe-admin')]),
    'ec2_instance_imdsv2_enabled': ('FAIL', [(arn('ec2', f'instance/i-0b{n}9e2c4d7a1f3', ), f'bgp-batch-worker-{n}') for n in (1, 2, 3)]),
    'ec2_securitygroup_allow_ingress_from_internet_to_tcp_port_22': ('FAIL', [(arn('ec2', 'security-group/sg-04c1d2e3f4a5b6c7d'), 'bgp-legacy-bastion')]),
    'kms_cmk_rotation_enabled': ('FAIL', [(arn('kms', 'key/7f3a1c2e-0d4b-4e8f-9a6b-5c2d1e0f9a8b'), 'bgp-attachments-key')]),
    'vpc_flow_logs_enabled': ('FAIL', [(arn('ec2', 'vpc/vpc-0a1b2c3d4e5f6a7b8'), 'bgp-prod-vpc')]),
    'cloudtrail_log_file_validation_enabled': ('FAIL', [(arn('cloudtrail', 'trail/bgp-app-trail'), 'bgp-app-trail')]),
    'iam_root_mfa_enabled': ('PASS', [(arn('iam', 'root', ''), '<root_account>')]),
    'iam_user_mfa_enabled_console_access': ('PASS', [(arn('iam', 'user/mlee', ''), 'mlee'), (arn('iam', 'user/druiz', ''), 'druiz')]),
    'iam_password_policy_minimum_length_14': ('PASS', [(arn('iam', 'password-policy', ''), 'password-policy')]),
    'cloudtrail_multi_region_enabled': ('PASS', [(arn('cloudtrail', 'trail/org-trail'), 'org-trail')]),
    'cloudtrail_kms_encryption_enabled': ('PASS', [(arn('cloudtrail', 'trail/org-trail'), 'org-trail')]),
    'rds_instance_storage_encrypted': ('PASS', [(arn('rds', 'db:bgp-prod'), 'bgp-prod')]),
    'rds_instance_backup_enabled': ('PASS', [(arn('rds', 'db:bgp-prod'), 'bgp-prod')]),
    'ec2_ebs_default_encryption': ('PASS', [(arn('ec2', 'ebs-default-encryption'), 'ebs-default-encryption')]),
    'guardduty_is_enabled': ('PASS', [(arn('guardduty', 'detector/2cb1a3d4e5f6'), '2cb1a3d4e5f6')]),
    's3_bucket_public_access': ('PASS', [(f'arn:aws-us-gov:s3:::bgp-{b}', f'bgp-{b}') for b in ('attachments', 'exports')]),
    'securityhub_enabled': ('PASS', [(arn('securityhub', 'hub/default'), 'default')]),
}


FAIL_MSG = {
    'iam_user_accesskey_unused': 'User {n} has an access key that has not been used in more than 45 days.',
    'ec2_instance_imdsv2_enabled': 'Instance {n} does not require IMDSv2.',
    'ec2_securitygroup_allow_ingress_from_internet_to_tcp_port_22': 'Security group {n} allows SSH (TCP 22) from 0.0.0.0/0.',
    'kms_cmk_rotation_enabled': 'KMS key {n} does not have automatic rotation enabled.',
    'vpc_flow_logs_enabled': 'VPC {n} does not have flow logs enabled.',
    'cloudtrail_log_file_validation_enabled': 'Trail {n} does not have log file validation enabled.',
}


def main():
    nist = json.loads((PROWLER / 'prowler/compliance/aws/nist_800_53_revision_5_aws.json').read_text())
    reqs = {}
    for r in nist['Requirements']:
        for c in r['Checks']:
            reqs.setdefault(c, []).append(r['Id'])
    out = []
    for check, (status, resources) in RESULTS.items():
        meta = json.loads(next((PROWLER / 'prowler/providers/aws/services').rglob(f'{check}.metadata.json')).read_text())
        for uid, name in resources:
            msg = FAIL_MSG[check].format(n=name) if status == 'FAIL' else f"{name} passed: {meta['CheckTitle']}."
            out.append({
                'message': msg,
                'metadata': {'event_code': check, 'product': {'name': 'Prowler', 'vendor_name': 'Prowler'}, 'version': '1.4.0'},
                'severity': meta['Severity'].capitalize(),
                'status': 'New',
                'status_code': status,
                'status_detail': msg,
                'unmapped': {'compliance': {'NIST-800-53-Revision-5': sorted(reqs.get(check, []))}},
                'finding_info': {'title': meta['CheckTitle'], 'desc': meta.get('Description', ''), 'uid': f'prowler-aws-{check}-{ACCT}-{REGION}-{name}',
                                 'created_time_dt': '2026-10-12T09:15:00'},
                'resources': [{'uid': uid, 'name': name, 'region': REGION, 'type': meta.get('ResourceType', 'Other')}],
                'cloud': {'provider': 'aws', 'account': {'uid': ACCT, 'type': 'AWS Account'}, 'region': REGION},
                'remediation': {'desc': (meta.get('Remediation', {}).get('Recommendation', {}) or {}).get('Text', '')},
                'class_name': 'Detection Finding',
            })
    OUT.write_text(json.dumps(out, indent=1))
    print(OUT, len(out), 'findings')


main()
