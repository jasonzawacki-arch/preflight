"""Build src/data/catalog.json from NIST's OSCAL content for SP 800-53 Rev. 5.

Usage: python3 tools/import_oscal.py PATH/TO/oscal-content/nist.gov/SP800-53/rev5/json

Reads the catalog and the LOW, MODERATE, HIGH and PRIVACY baseline profiles, and writes one compact JSON file:
every control and enhancement that is not withdrawn, with its statement (parameters rendered as NIST prints them,
"[Assignment: organization-defined ...]"), discussion, the SP 800-53A "Examine" objects (what an assessor looks
at, which doubles as an evidence checklist), and the baselines it belongs to. NIST content is public domain."""
import json, re, sys
from pathlib import Path

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
OUT = Path(__file__).resolve().parent.parent / 'src' / 'data' / 'catalog.json'
INSERT = re.compile(r'\{\{\s*insert:\s*param,\s*([\w.-]+)\s*\}\}')


def prop(o, name, cls=None):
    for p in o.get('props', []):
        if p['name'] == name and (cls is None or p.get('class') == cls) and (cls is not None or 'class' not in p):
            return p['value']
    return None


def main():
    cat = json.loads((SRC / 'NIST_SP-800-53_rev5_catalog.json').read_text())['catalog']
    base = {}
    for lvl, key in (('LOW', 'L'), ('MODERATE', 'M'), ('HIGH', 'H'), ('PRIVACY', 'P')):
        prof = json.loads((SRC / f'NIST_SP-800-53_rev5_{lvl}-baseline_profile.json').read_text())['profile']
        for imp in prof['imports']:
            for inc in imp.get('include-controls', []):
                for cid in inc.get('with-ids', []):
                    base[cid] = base.get(cid, '') + key

    params = {}

    def collect(c):
        for p in c.get('params', []):
            params[p['id']] = p
        for s in c.get('controls', []):
            collect(s)

    for g in cat['groups']:
        for c in g['controls']:
            collect(c)

    def render_param(pid, depth=0):
        p = params.get(pid)
        if not p or depth > 4:
            return '[Assignment: organization-defined value]'
        if 'select' in p:
            sel = p['select']
            how = {'one-or-more': ' (one or more)'}.get(sel.get('how-many', ''), '')
            ch = '; '.join(fill(x, depth + 1) for x in sel.get('choice', []))
            return f'[Selection{how}: {ch}]'
        label = fill(p.get('label', 'value'), depth + 1)
        return f"[Assignment: {label if label.startswith('organization-defined') else 'organization-defined ' + label}]"

    def fill(text, depth=0):
        return INSERT.sub(lambda m: render_param(m.group(1), depth), text or '').strip()

    def lines(part, depth, out):
        for sub in part.get('parts', []):
            if sub['name'] != 'item':
                continue
            out.append([depth, prop(sub, 'label') or '', fill(sub.get('prose', ''))])
            lines(sub, depth + 1, out)
        return out

    controls, families = [], []
    order = 0

    def add(c, fam, parent=None):
        nonlocal order
        if prop(c, 'status') == 'withdrawn':
            return
        stmt = next((p for p in c.get('parts', []) if p['name'] == 'statement'), {})
        gdn = next((p for p in c.get('parts', []) if p['name'] == 'guidance'), {})
        exm = next((p for p in c.get('parts', []) if p['name'] == 'assessment-method' and prop(p, 'method') == 'EXAMINE'), None)
        examine = []
        if exm:
            for sp in exm.get('parts', []):
                examine += [x.strip() for x in sp.get('prose', '').split('\n') if x.strip()]
        st = []
        if stmt.get('prose'):
            st.append([0, '', fill(stmt['prose'])])
        lines(stmt, 0, st)
        order += 1
        row = {
            'id': prop(c, 'label'),
            'o': c['id'],
            'f': fam,
            't': c['title'],
            'b': ''.join(sorted(set(base.get(c['id'], '')), key='LMHP'.index)),
            's': st,
            'g': (gdn.get('prose') or '').strip(),
            'x': examine,
        }
        if parent:
            row['p'] = parent
        controls.append(row)
        for e in c.get('controls', []):
            add(e, fam, row['id'])

    for g in cat['groups']:
        families.append({'id': g['id'].upper(), 'name': g['title']})
        for c in g['controls']:
            add(c, g['id'].upper())

    meta = cat['metadata']
    out = {
        'source': meta['title'],
        'version': meta.get('version'),
        'published': (meta.get('last-modified') or '')[:10],
        'families': families,
        'controls': controls,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(',', ':'), ensure_ascii=False))
    counts = {k: sum(1 for c in controls if k in c['b']) for k in 'LMHP'}
    print(f"{OUT}: {len(controls)} controls and enhancements, baselines {counts}, {OUT.stat().st_size // 1024} KB")


main()
