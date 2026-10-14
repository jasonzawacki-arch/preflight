"""End to end in a real browser: the sample system, assessing a control, POA&M items, evidence with SHA-256
fingerprints, filters, starting your own system, and the phone layout.
Run: node build.mjs && python3 tests/app.py"""
import hashlib, json, re, sys, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent))
from helpers import ROOT, Checks, page, serve

check, errs = Checks(), []
srv, BASE = serve()
cat = json.loads((ROOT / 'src' / 'data' / 'catalog.json').read_text())
tmp = Path(tempfile.mkdtemp())


def go(p, h):
    p.evaluate(f"location.hash = {json.dumps(h)}")
    p.wait_for_timeout(250)


def score(p):
    return int(re.search(r'(\d+)%', p.inner_text('.score')).group(1))


def blocker_ids(p, key):
    go(p, '#/dashboard')
    li = p.locator(f'.blockers li[data-key={key}]')
    return set(li.locator('.ids a[href^="#/"]').all_inner_texts()) if li.count() else set()


with sync_playwright() as pw:
    b = pw.chromium.launch()

    # ---- the catalog: NIST's published baseline sizes ----
    counts = {k: sum(1 for c in cat['controls'] if k in c['b']) for k in 'LMHP'}
    check('catalog matches NIST baseline sizes (149, 287, 370, privacy 96)', counts == {'L': 149, 'M': 287, 'H': 370, 'P': 96}, counts)
    ac2 = next(c for c in cat['controls'] if c['id'] == 'AC-2')
    check('statements carry rendered parameters', any('[Assignment: organization-defined' in x[2] for x in ac2['s']))
    check('withdrawn controls left out', not any(c['id'] in ('AC-13', 'AC-15') for c in cat['controls']))

    # ---- first open: the sample system ----
    ctx, p = page(b, BASE, errs, viewport={'width': 1360, 'height': 900})
    check('opens on the sample system with a banner', 'Sample data' in p.inner_text('#banner') and 'Bayview Grants Portal' in p.inner_text('.top'))
    check('control map shows every Moderate control', p.locator('.map .cell').count() == 287, p.locator('.map .cell').count())
    s0 = score(p)
    check('readiness score shown', 0 < s0 < 100, s0)
    check('blockers listed', p.locator('.blockers li').count() >= 5)

    # ---- assess a control ----
    go(p, '#/control/AC-5')
    def legend():
        go(p, '#/dashboard')
        return {m.group(1): int(m.group(2)) for m in (re.match(r'(.*?)\s+(\d+)$', t.strip()) for t in p.locator('.legend li').all_inner_texts())}
    l0 = legend()
    go(p, '#/control/AC-5')
    was = p.evaluate("document.querySelector('.seg input:checked').value") or 'none'
    p.locator('.seg label.st-not-satisfied').click(); p.wait_for_timeout(300)
    l1 = legend()
    check('setting a status updates the control map', was == 'not-satisfied' or l1['Not satisfied'] == l0['Not satisfied'] + 1, (was, l0, l1))
    go(p, '#/control/AC-5')
    check('a gap with no POA&M is called out', p.locator('.callout').count() == 1)
    check('it appears under "Gaps with no POA&M"', 'AC-5' in blocker_ids(p, 'nopoam') or p.locator('.blockers li[data-key=nopoam] .bh .n').count() == 1)
    go(p, '#/control/AC-5')
    p.fill('[data-a=impl]', 'Duties are separated between developers and operators.')
    p.fill('[data-a=role]', 'Cloud Operations Lead')
    p.click('.callout [data-act=poam-from]'); p.wait_for_timeout(300)
    check('Add a POA&M item opens a new item for the control', p.input_value('[data-p=controlId]') == 'AC-5' and re.match(r'#/poam/POAM-\d{3}', p.evaluate('location.hash')))
    pid = p.evaluate('location.hash').split('/')[-1]
    check('the role becomes the point of contact', p.input_value('[data-p=poc]') == 'Cloud Operations Lead')
    p.fill('[data-p=title]', 'Developers can deploy to production')
    p.select_option('[data-p=severity]', 'high')
    p.wait_for_timeout(400)
    check('the gap is no longer flagged once it has a POA&M', 'AC-5' not in blocker_ids(p, 'nopoam'))
    check('a high item shows as an open high-risk finding', pid in blocker_ids(p, 'high'))

    # milestones and overdue
    go(p, f'#/poam/{pid}')
    p.fill('#md0', '2020-01-01'); p.locator('#md0').dispatch_event('change'); p.wait_for_timeout(300)
    check('a past milestone makes the item overdue', 'Overdue' in p.inner_text('[data-poam]') and pid in blocker_ids(p, 'overdue'))
    go(p, f'#/poam/{pid}')
    p.check('[data-m=done][data-i="0"]'); p.wait_for_timeout(300)
    check('finishing the milestone clears it', pid not in blocker_ids(p, 'overdue'))
    go(p, f'#/poam/{pid}')
    p.select_option('[data-p=status]', 'risk-accepted'); p.wait_for_timeout(300)
    check('risk accepted with no residual risk is flagged', pid in blocker_ids(p, 'accepted'))
    go(p, f'#/poam/{pid}')
    p.fill('[data-p=residualRisk]', 'Low: deploys are logged and reviewed weekly.'); p.wait_for_timeout(400)
    check('writing the residual risk clears it', pid not in blocker_ids(p, 'accepted'))

    # saved across a reload
    p.reload(); p.wait_for_selector('.hero')
    go(p, '#/control/AC-5')
    check('the assessment is kept after a reload', p.input_value('[data-a=impl]').startswith('Duties are separated') and p.locator('.seg input[value=not-satisfied]').is_checked())

    # ---- evidence ----
    f1 = tmp / 'separation-of-duties.txt'
    f1.write_text('Role matrix: developers have no production deploy rights.\n')
    p.set_input_files('[data-act=attach]', str(f1)); p.wait_for_timeout(600)
    ev = p.evaluate("Object.values(document.querySelectorAll('.evl a')).map(a => a.textContent)")
    check('attaching a file adds evidence to the control', any('EV-013' in x for x in ev), ev)
    go(p, '#/evidence/EV-013')
    shown = p.inner_text('.facts .fp')
    check('the fingerprint is the real SHA-256 of the file', shown == hashlib.sha256(f1.read_bytes()).hexdigest(), shown)
    p.click('[data-act=verify-ev]'); p.wait_for_timeout(300)
    check('the stored file checks out', 'still matches' in p.inner_text('#verify-out'))
    go(p, '#/evidence')
    p.set_input_files('[data-act=check-file]', str(f1)); p.wait_for_timeout(400)
    check('Check a file recognises it', 'matches' in p.inner_text('#check-out') and 'EV-013' in p.inner_text('#check-out'))
    f2 = tmp / 'separation-of-duties-edited.txt'
    f2.write_text('Role matrix: developers DO have production deploy rights.\n')
    p.set_input_files('[data-act=check-file]', str(f2)); p.wait_for_timeout(400)
    check('a changed file does not match', 'does not match' in p.inner_text('#check-out'))
    # the add form: forgiving IDs, refuses unknown ones
    p.set_input_files('form[data-form=add-ev] input[name=file]', str(f2))
    p.fill('form[data-form=add-ev] input[name=title]', 'Role matrix')
    p.fill('form[data-form=add-ev] input[name=controls]', 'ac-6, ZZ-9')
    p.click('form[data-form=add-ev] button'); p.wait_for_timeout(400)
    check('an unknown control ID is refused', 'Not a control ID: ZZ-9' in p.inner_text('body') and p.locator('text=EV-014').count() == 0)
    p.fill('form[data-form=add-ev] input[name=controls]', 'ac-6 (1), AU-06')
    p.click('form[data-form=add-ev] button'); p.wait_for_timeout(500)
    go(p, '#/evidence/EV-014')
    check('IDs are normalised: ac-6 (1) and AU-06', p.input_value('[data-e=controlIds]') == 'AC-6(1), AU-6', p.input_value('[data-e=controlIds]'))
    go(p, '#/evidence/EV-007')
    check('evidence older than a year is flagged', 'older than a year' in p.inner_text('main') or 'more than 365 days' in p.inner_text('main'))

    # ---- filters ----
    go(p, '#/controls')
    p.fill('#q', 'AC-2(13)'); p.wait_for_timeout(200)
    check('search by ID', p.locator('.clist li').count() == 1 and 'AC-2(13)' in p.inner_text('.clist'))
    p.fill('#q', 'least privilege'); p.wait_for_timeout(200)
    check('search by title', 'AC-6' in p.inner_text('.clist'))
    p.fill('#q', ''); p.select_option('#ff', 'SR'); p.wait_for_timeout(200)
    check('filter by family', all(t.startswith('SR-') for t in p.locator('.clist .cid').all_inner_texts()))
    p.check('[data-filter=all]'); p.wait_for_timeout(200)
    n_all = p.locator('.clist li').count()
    check('include controls outside the baseline', n_all == sum(1 for c in cat['controls'] if c['f'] == 'SR'), n_all)
    go(p, '#/dashboard')
    p.locator('.blockers li[data-key=unassessed] [data-act=attn]').click(); p.wait_for_timeout(300)
    check('"see all" from a blocker filters the list', 'Not assessed yet' in p.inner_text('.attn') and p.locator('.clist .dot.st-none').count() == p.locator('.clist li').count() > 0)

    # ---- start your own system ----
    go(p, '#/dashboard')
    p.click('[data-act=start-own]'); p.click('dialog [data-yes]'); p.wait_for_timeout(600)
    check('starting your own system clears the sample', not p.is_visible('#banner') and 'Set up your system' in p.inner_text('main'))
    p.fill('input[name=name]', 'Harbor Case System')
    p.check('input[name=baseline][value=high]')
    p.check('input[name=privacy]')
    p.click('form[data-form=system] button'); p.wait_for_timeout(500)
    hp = sum(1 for c in cat['controls'] if 'H' in c['b'] or 'P' in c['b'])
    check('High plus privacy scopes the right controls', p.locator('.map .cell').count() == hp, (p.locator('.map .cell').count(), hp))
    check('a new system starts at 0%', score(p) == 0)
    go(p, '#/evidence')
    check('no evidence carried over', 'No evidence yet' in p.inner_text('main'))
    go(p, '#/system')
    p.click('[data-act=load-demo]'); p.click('dialog [data-yes]'); p.wait_for_timeout(800)
    check('the sample can be loaded again', p.is_visible('#banner') and p.locator('.map .cell').count() == 287)
    ctx.close()

    # ---- phone layout ----
    ctx, m = page(b, BASE, errs, viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    check('no sideways scrolling on a phone', m.evaluate('document.documentElement.scrollWidth') <= 390)
    go(m, '#/controls')
    m.locator('.clist a[data-id="AC-3"]').tap(); m.wait_for_timeout(300)
    check('on a phone a control opens on its own', m.is_visible('.ctl') and not m.is_visible('.listcol'))
    m.locator('.ctl .back').tap(); m.wait_for_timeout(300)
    check('and Back returns to the list', m.is_visible('.listcol'))
    check('no sideways scrolling on the control page', m.evaluate('document.documentElement.scrollWidth') <= 390)
    ctx.close()
    b.close()

check('no page errors', not errs, errs)
srv.shutdown()
sys.exit(1 if check.fails else 0)
