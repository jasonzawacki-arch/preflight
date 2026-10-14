"""Scanner import: the sample Prowler scan (OCSF JSON) and an AWS Security Hub export (ASFF, built from AWS's
published NIST SP 800-53 Rev. 5 sample finding) become POA&M items mapped to controls. Re-importing updates instead
of duplicating, a passing check closes its open item, failing checks mark satisfied controls partial, the scan file
is kept as evidence, and files that are not scans are refused.
Run: node build.mjs && python3 tests/scan.py"""
import copy, json, re, sys, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent))
from helpers import ROOT, Checks, page, serve

check, errs = Checks(), []
srv, BASE = serve()
tmp = Path(tempfile.mkdtemp())

# AWS's sample NIST SP 800-53 Rev. 5 control finding (Security Hub user guide), trimmed to the fields that matter
NIST_SAMPLE = {
    "SchemaVersion": "2018-10-08",
    "Id": "arn:aws:securityhub:us-east-1:123456789012:subscription/nist-800-53/v/5.0.0/CloudTrail.2/finding/a1b2c3d4-5678-90ab-cdef-EXAMPLE11111",
    "GeneratorId": "nist-800-53/v/5.0.0/CloudTrail.2",
    "AwsAccountId": "123456789012",
    "Severity": {"Product": 40, "Label": "MEDIUM", "Normalized": 40, "Original": "MEDIUM"},
    "Title": "CloudTrail.2 CloudTrail should have encryption at-rest enabled",
    "Description": "This AWS control checks whether AWS CloudTrail is configured to use the server side encryption (SSE) AWS Key Management Service (AWS KMS) customer master key (CMK) encryption. The check will pass if the KmsKeyId is defined.",
    "ProductFields": {"ControlId": "CloudTrail.2", "RelatedAWSResources:0/type": "AWS::Config::ConfigRule"},
    "Resources": [{"Type": "AwsCloudTrailTrail", "Id": "arn:aws:cloudtrail:us-east-1:123456789012:trail/AWSMacieTrail-DO-NOT-EDIT", "Partition": "aws", "Region": "us-east-1"}],
    "Compliance": {"Status": "FAILED", "RelatedRequirements": ["NIST.800-53.r5 AU-9", "NIST.800-53.r5 CA-9(1)", "NIST.800-53.r5 CM-3(6)", "NIST.800-53.r5 SC-13",
                   "NIST.800-53.r5 SC-28", "NIST.800-53.r5 SC-28(1)", "NIST.800-53.r5 SC-7(10)", "NIST.800-53.r5 SI-7(6)"],
                   "SecurityControlId": "CloudTrail.2", "AssociatedStandards": [{"StandardsId": "standards/nist-800-53/v/5.0.0"}]},
    "Workflow": {"Status": "NEW"},
    "RecordState": "ACTIVE",
}


def asff_file():
    passing = copy.deepcopy(NIST_SAMPLE)
    passing.update(Title="IAM.6 Hardware MFA should be enabled for the root user", Severity={"Label": "CRITICAL"})
    passing["Compliance"] = {"Status": "PASSED", "SecurityControlId": "IAM.6", "RelatedRequirements": ["NIST.800-53.r5 IA-2(1)", "NIST.800-53.r5 AC-6(10)"]}
    archived = copy.deepcopy(NIST_SAMPLE)
    archived["RecordState"] = "ARCHIVED"
    fsbp_only = copy.deepcopy(NIST_SAMPLE)
    fsbp_only["Compliance"] = {"Status": "FAILED", "SecurityControlId": "EC2.44"}
    second = copy.deepcopy(NIST_SAMPLE)
    second["Resources"][0]["Id"] = "arn:aws:cloudtrail:us-east-1:123456789012:trail/second-trail"
    f = tmp / 'securityhub-findings.json'
    f.write_text(json.dumps({"Findings": [NIST_SAMPLE, second, passing, archived, fsbp_only], "NextToken": None}))
    return f


def go(p, h):
    p.evaluate(f"location.hash = {json.dumps(h)}")
    p.wait_for_timeout(250)


def rows(p):
    return [r.inner_text() for r in p.locator('.preview tbody tr').all()]


with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx, p = page(b, BASE, errs, viewport={'width': 1280, 'height': 900})

    # entry point from the POA&M page
    go(p, '#/poam')
    p.click('a[href="#/import"]'); p.wait_for_selector('[data-act=scan-sample]')
    check('POA&M page links to the import', p.evaluate('location.hash') == '#/import')

    # ---- the sample Prowler scan ----
    p.click('[data-act=scan-sample]'); p.wait_for_selector('.preview')
    t = p.inner_text('.preview')
    check('reads Prowler OCSF: 22 findings, 17 checks, 6 failed', 'Prowler: 22 findings on 17 checks' in t and '6 checks failed' in t, t[:200])
    check('withdrawn or unknown mappings are reported, not imported', 'AC-3(1)' in t and 'not in SP 800-53 Rev. 5' in t)
    r = rows(p)
    check('one row per failing check, high severity first', len(r) == 6 and 'High' in r[0] and 'Moderate' in r[-1], r)
    def ctl_of(name):
        return next((x.split('\t')[3].strip() for x in r if name in x), None)
    check('primary control chosen by topic: key rotation -> SC-12', ctl_of('kms_cmk_rotation_enabled') == 'SC-12', ctl_of('kms_cmk_rotation_enabled'))
    check('unused access keys -> AC-2(3)', ctl_of('iam_user_accesskey_unused') == 'AC-2(3)')
    check('SSH open to the internet -> SC-7', ctl_of('tcp_port_22') == 'SC-7')
    check('log file validation -> AU-9', ctl_of('log_file_validation') == 'AU-9')
    check('the earlier GuardDuty item will close: its check now passes', 'Close 1 open item whose check now passes: POAM-008' in t)
    p.click('form[data-form=import] button.btn:not(.ghost)'); p.wait_for_timeout(800)
    toast = p.locator('.toast').last.inner_text()
    check('import reports what changed', '6 POA&M items created' in toast and '1 closed' in toast and 'Scan kept as EV-013' in toast, toast)
    go(p, '#/poam/POAM-008')
    check('the passing check closed its item', p.locator('[data-p=status]').input_value() == 'closed' and 'the check passed' in p.input_value('[data-p=description]'))
    go(p, '#/poam')
    p.check('input[name=pmshow][value=all]'); p.wait_for_timeout(200)
    items = p.locator('.tbl tbody tr').all_inner_texts()
    imdsv2 = next((x for x in items if 'IMDSv2' in x), '')
    check('IMDSv2 item: high, on AC-3, due in 30 days', 'AC-3' in imdsv2 and 'High' in imdsv2, imdsv2)
    iid = imdsv2.split('\t')[0]
    go(p, f'#/poam/{iid}')
    panel = p.inner_text('.scanfrom')
    check('imported item shows its scan source and resources', 'From a Prowler scan' in panel and '3 affected resources' in panel and 'Also maps to 14 other controls' in panel, panel)
    check('point of contact from the control', p.input_value('[data-p=poc]') == 'Application Lead', p.input_value('[data-p=poc]'))
    go(p, '#/control/SC-12')
    check('failing check marks a satisfied control partial, with a note', p.locator('.seg input[value=partial]').is_checked() and 'kms_cmk_rotation_enabled failed' in p.input_value('[data-a=notes]'))
    go(p, '#/evidence/EV-013')
    check('scan kept as evidence', 'Prowler scan' in p.inner_text('h1') and 'SC-12' in p.input_value('[data-e=controlIds]'))

    # ---- importing the same scan again updates, never duplicates ----
    go(p, '#/import')
    p.click('[data-act=scan-sample]'); p.wait_for_selector('.preview')
    check('second import: every failing check updates its open item', all('updates POAM-' in x for x in rows(p)), rows(p))
    p.click('form[data-form=import] button.btn:not(.ghost)'); p.wait_for_timeout(800)
    check('no duplicates created', '6 updated' in p.locator('.toast').last.inner_text() and 'created' not in p.locator('.toast').last.inner_text(), p.locator('.toast').last.inner_text())

    # ---- OSCAL POA&M carries the scan check ----
    go(p, '#/export')
    with p.expect_download() as d:
        p.click('[data-act=x-poam-oscal]')
    poam = json.loads(Path(d.value.path()).read_text())
    props = [pr for it in poam['plan-of-action-and-milestones']['poam-items'] for pr in it.get('props', []) if pr['name'] == 'scan-check']
    check('OSCAL POA&M records the scan check', any(pr['value'] == 'Prowler: kms_cmk_rotation_enabled' for pr in props), props[:2])

    # ---- Security Hub (ASFF) ----
    go(p, '#/import')
    p.set_input_files('[data-act=scan-file]', str(asff_file())); p.wait_for_selector('.preview')
    t = p.inner_text('.preview')
    check('reads Security Hub findings', 'AWS Security Hub: 3 findings on 2 checks' in t and '1 check failed' in t, t[:300])
    check('archived findings skipped, non-NIST findings counted as unmapped', 'Skipped 1 finding with no NIST SP 800-53 mapping' in t and 'Skipped 1 finding that was archived' in t, t[:400])
    r = rows(p)
    check('CloudTrail.2 encryption maps to SC-28(1), 2 resources, moderate', len(r) == 1 and 'SC-28(1)' in r[0] and '\t2\t' in r[0] and 'Moderate' in r[0], r)
    p.uncheck('input[name=evidence]')
    p.click('form[data-form=import] button.btn:not(.ghost)'); p.wait_for_timeout(800)
    check('Security Hub item created', '1 POA&M item created' in p.locator('.toast').last.inner_text(), p.locator('.toast').last.inner_text())

    # ---- files that are not scans ----
    bad = tmp / 'notes.json'
    for content, msg in [('hello', 'not JSON'), ('{"a": 1}', 'No findings'), ('[{"x": 1}]', 'does not look like')]:
        bad.write_text(content)
        go(p, '#/import')
        p.set_input_files('[data-act=scan-file]', str(bad)); p.wait_for_timeout(400)
        check(f'refuses a non-scan file ({msg})', msg in p.inner_text('body') and p.locator('.preview').count() == 0)
    ctx.close()
    b.close()

check('no page errors', not errs, errs)
srv.shutdown()
sys.exit(1 if check.fails else 0)
