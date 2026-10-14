"""Exports: the SSP (Markdown and OSCAL), the POA&M (OSCAL and CSV) and the backup. The OSCAL files are validated
against NIST's OSCAL 1.2.1 JSON schemas (tests/schemas), for the sample system and for a nearly empty one.
The backup is restored into a clean browser, and a tampered evidence file is caught on restore.
Run: node build.mjs && python3 tests/exports.py"""
import base64, csv, hashlib, io, json, re, sys
from pathlib import Path
import jsonschema
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent))
from helpers import ROOT, Checks, download, page, serve

check, errs = Checks(), []
srv, BASE = serve()
UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')


def schema(name):
    # Python's re has no \p{L}; NIST's token pattern is the only place it appears
    text = (ROOT / 'tests' / 'schemas' / name).read_text()
    text = text.replace(r'^(\\p{L}|_)(\\p{L}|\\p{N}|[.\\-_])*$', r'^([^\\W\\d]|_)(\\w|[.\\-])*$')
    assert r'\\p{' not in text, 'unhandled \\p pattern in ' + name
    return json.loads(text)


SSP, POAM = schema('oscal_ssp_schema.json'), schema('oscal_poam_schema.json')


def valid(doc, sch):
    errors = sorted(jsonschema.Draft7Validator(sch).iter_errors(doc), key=lambda e: list(e.path))
    return [f"{'/'.join(map(str, e.path))}: {e.message[:160]}" for e in errors[:5]]


with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx, p = page(b, BASE, errs, viewport={'width': 1280, 'height': 900})
    p.evaluate("location.hash='#/export'"); p.wait_for_selector('[data-act=x-ssp-md]')

    name, md = download(p, '[data-act=x-ssp-md]'); md = md.decode()
    check('SSP Markdown file name', name == 'bgp-ssp.md', name)
    check('SSP has system information and the boundary', '## 1. System information' in md and 'Authorization boundary' in md and 'AWS GovCloud' in md)
    check('SSP has every control with its requirement', md.count('\n#### ') == 287 and 'Control requirement:' in md and '[Assignment: organization-defined' in md, md.count('\n#### '))
    check('SSP carries implementation statements and evidence fingerprints', 'Accounts are provisioned through the agency identity provider' in md and re.search(r'SHA-256 [0-9a-f]{64}', md))
    check('missing statements are marked', '_Implementation statement needed._' in md)

    name, raw = download(p, '[data-act=x-ssp-oscal]'); ssp = json.loads(raw)
    check('OSCAL SSP validates against the NIST schema', not valid(ssp, SSP), valid(ssp, SSP))
    broken = json.loads(json.dumps(ssp)); del broken['system-security-plan']['import-profile']
    broken['system-security-plan']['control-implementation']['implemented-requirements'][0]['uuid'] = 'not-a-uuid'
    check('the schema check catches a broken file', len(valid(broken, SSP)) >= 2, valid(broken, SSP))
    reqs = ssp['system-security-plan']['control-implementation']['implemented-requirements']
    check('OSCAL SSP has one requirement per control, in OSCAL ids', len(reqs) == 287 and reqs[0]['control-id'] == 'ac-1')
    ac2 = next(r for r in reqs if r['control-id'] == 'ac-2')
    check('statuses map to OSCAL implementation states', ac2['by-components'][0]['implementation-status']['state'] == 'implemented')
    check('UUIDs are well formed and stable', all(UUID.match(r['uuid']) for r in reqs))
    _, raw2 = download(p, '[data-act=x-ssp-oscal]')
    check('re-exporting gives the same UUIDs', [r['uuid'] for r in json.loads(raw2)['system-security-plan']['control-implementation']['implemented-requirements']] == [r['uuid'] for r in reqs])
    res = ssp['system-security-plan']['back-matter']['resources']
    check('evidence goes into back matter with SHA-256 hashes', len(res) == 12 and all(len(r['rlinks'][0]['hashes'][0]['value']) == 64 for r in res))
    check('it imports the NIST Moderate profile', 'MODERATE-baseline_profile.json' in ssp['system-security-plan']['import-profile']['href'])

    name, raw = download(p, '[data-act=x-poam-oscal]'); poam = json.loads(raw)
    check('OSCAL POA&M validates against the NIST schema', not valid(poam, POAM), valid(poam, POAM))
    risks = poam['plan-of-action-and-milestones']['risks']
    check('POA&M states map to OSCAL risk states', {r['status'] for r in risks} >= {'open', 'remediating', 'deviation-approved', 'closed'})
    check('milestones become dated tasks', any(t['type'] == 'milestone' and 'on-date' in t['timing'] for r in risks for rem in r.get('remediations', []) for t in rem['tasks']))

    name, raw = download(p, '[data-act=x-poam-csv]')
    rows = list(csv.DictReader(io.StringIO(raw.decode())))
    check('POA&M CSV has every item', len(rows) == 8 and rows[0]['POA&M ID'] == 'POAM-001')
    check('CSV flags overdue items', sum(r['Overdue'] == 'yes' for r in rows) == 2, [r['Overdue'] for r in rows])

    # change something, back up, restore into a fresh browser
    p.evaluate("location.hash='#/control/AC-5'"); p.wait_for_selector('[data-a=impl]')
    p.fill('[data-a=impl]', 'Restored statement.'); p.wait_for_timeout(500)
    p.evaluate("location.hash='#/export'"); p.wait_for_selector('[data-act=x-backup]')
    name, raw = download(p, '[data-act=x-backup]')
    bk = json.loads(raw)
    check('backup holds every evidence file', bk['format'] == 'preflight-backup' and len(bk['files']) == 12)
    ok_files = all(hashlib.sha256(base64.b64decode(bk['files'][e['id']])).hexdigest() == e['sha256'] for e in bk['state']['evidence'])
    check('backup files match their fingerprints', ok_files)
    ctx.close()

    bpath = ROOT / 'dist' / 'test-backup.json'
    bpath.write_bytes(raw)
    ctx, q = page(b, BASE, errs, viewport={'width': 1280, 'height': 900})
    q.evaluate("location.hash='#/system'"); q.wait_for_selector('[data-act=wipe]')
    q.click('[data-act=wipe]'); q.click('dialog [data-yes]'); q.wait_for_timeout(500)
    q.evaluate("location.hash='#/export'"); q.wait_for_selector('[data-act=restore]')
    q.set_input_files('[data-act=restore]', str(bpath)); q.click('dialog [data-yes]'); q.wait_for_timeout(1200)
    check('restore reports every file intact', 'Every evidence file matches' in q.inner_text('body'))
    q.evaluate("location.hash='#/control/AC-5'"); q.wait_for_selector('[data-a=impl]')
    check('restore brings back the assessment', q.input_value('[data-a=impl]') == 'Restored statement.')
    q.evaluate("location.hash='#/evidence/EV-003'"); q.wait_for_selector('[data-act=verify-ev]')
    q.click('[data-act=verify-ev]'); q.wait_for_timeout(300)
    check('restored files verify', 'still matches' in q.inner_text('#verify-out'))

    # tampered backup: one evidence file altered
    bk['files']['EV-003'] = base64.b64encode(b'severity,count\ncritical,0\nhigh,0\n').decode()
    bpath.write_text(json.dumps(bk))
    q.evaluate("location.hash='#/export'"); q.wait_for_selector('[data-act=restore]')
    q.set_input_files('[data-act=restore]', str(bpath)); q.click('dialog [data-yes]'); q.wait_for_timeout(1200)
    check('a tampered file is caught on restore', 'do not match their recorded fingerprints: EV-003' in q.inner_text('body'))
    bpath.write_text('{"hello": 1}')
    q.evaluate("location.hash='#/export'"); q.wait_for_selector('[data-act=restore]')
    q.set_input_files('[data-act=restore]', str(bpath)); q.wait_for_timeout(500)
    check('a file that is not a backup is refused', 'not a Preflight backup' in q.inner_text('body'))
    bpath.unlink()

    # a nearly empty system still exports valid OSCAL
    q.evaluate("location.hash='#/system'"); q.wait_for_selector('[data-act=wipe]')
    q.click('[data-act=wipe]'); q.click('dialog [data-yes]'); q.wait_for_timeout(500)
    q.fill('input[name=name]', 'New system'); q.check('input[name=baseline][value=low]'); q.click('form[data-form=system] button'); q.wait_for_timeout(400)
    q.evaluate("location.hash='#/export'"); q.wait_for_selector('[data-act=x-ssp-oscal]')
    _, raw = download(q, '[data-act=x-ssp-oscal]'); e_ssp = json.loads(raw)
    _, raw = download(q, '[data-act=x-poam-oscal]'); e_poam = json.loads(raw)
    check('empty system: SSP still valid OSCAL', not valid(e_ssp, SSP), valid(e_ssp, SSP))
    check('empty system: POA&M still valid OSCAL', not valid(e_poam, POAM), valid(e_poam, POAM))
    check('Low baseline exports 149 requirements', len(e_ssp['system-security-plan']['control-implementation']['implemented-requirements']) == 149)
    ctx.close()
    b.close()

check('no page errors', not errs, errs)
srv.shutdown()
sys.exit(1 if check.fails else 0)
