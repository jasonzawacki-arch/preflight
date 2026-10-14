// The screens. Plain TypeScript over the DOM: each view renders from state, form fields save as you type, and
// links are hash routes (#/control/AC-2) so the back button and bookmarks work.
import type { AssessmentStatus, Catalog, Control, EvidenceArtifact, EvidenceType, PoamItem, ReadinessSummary, State, SystemInfo } from './model.js';
import { BASELINE_KEY } from './model.js';
import {
  addDays, assessmentOf, byId, esc, evidenceFor, fmtDate, fmtSize, inScope, isOpen, isOverdue, isStale, nextId, poamsFor, readiness, sha256, STALE_DAYS, today,
} from './logic.js';
import { backupJson, fileStem, poamCsv, poamOscal, readBackup, sspMarkdown, sspOscal } from './exports.js';
import { allFiles, clearFiles, delFile, getFile, putFile, saveState } from './store.js';
import { blankState, demoState } from './demo.js';

let cat: Catalog;
let ctl: Map<string, Control>;
let st: State;
const app = () => document.getElementById('app')!;

// ---------- vocabulary ----------
const STATUS: [AssessmentStatus | '', string][] = [
  ['satisfied', 'Satisfied'],
  ['partial', 'Partial'],
  ['not-satisfied', 'Not satisfied'],
  ['not-applicable', 'Not applicable'],
  ['', 'Not assessed'],
];
const statusName = (s?: string) => (STATUS.find((x) => x[0] === (s || '')) || STATUS[4])[1];
const stCls = (s?: string) => 'st-' + (s || 'none');
const EV_TYPES: [EvidenceType, string][] = [
  ['scan-report', 'Scan report'], ['config-export', 'Configuration export'], ['policy-doc', 'Policy or procedure'], ['screenshot', 'Screenshot or diagram'],
  ['log-extract', 'Log extract'], ['attestation', 'Attestation or review record'], ['other', 'Other'],
];
const evType = (t: string) => (EV_TYPES.find((x) => x[0] === t) || EV_TYPES[6])[1];
const SEV: [PoamItem['severity'], string][] = [['high', 'High'], ['moderate', 'Moderate'], ['low', 'Low']];
const PSTAT: [PoamItem['status'], string][] = [['open', 'Open'], ['in-progress', 'In progress'], ['risk-accepted', 'Risk accepted'], ['closed', 'Closed']];
const PSRC: [PoamItem['source'], string][] = [['assessment', 'Control assessment'], ['scan', 'Vulnerability scan'], ['pen-test', 'Penetration test'], ['self-identified', 'Self-identified']];
const label = <T extends string>(list: [T, string][], v: string) => (list.find((x) => x[0] === v) || [v, v])[1];
const BASE_NAME: Record<string, string> = { L: 'Low', M: 'Moderate', H: 'High', P: 'Privacy' };
const opts = <T extends string>(list: [T, string][], v: string) => list.map(([k, t]) => `<option value="${k}"${k === v ? ' selected' : ''}>${esc(t)}</option>`).join('');

// ---------- saving ----------
let saveTimer = 0;
function save() {
  st.updated = new Date().toISOString();
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => saveState(st).then(() => flash('Saved in this browser')), 250);
  header();
}
function flash(msg: string) {
  const el = document.getElementById('saved');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout((el as any)._t);
  (el as any)._t = setTimeout(() => el.classList.remove('on'), 1600);
}
export function toast(msg: string, kind: 'ok' | 'warn' = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}
function confirmBox(title: string, body: string, yes: string): Promise<boolean> {
  return new Promise((res) => {
    const d = document.createElement('dialog');
    d.className = 'confirm';
    d.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2><p>${esc(body)}</p><div class="row end"><button value="no" class="btn ghost">Cancel</button><button value="yes" class="btn danger" data-yes>${esc(yes)}</button></div></form>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => {
      res(d.returnValue === 'yes');
      d.remove();
    });
    d.showModal();
  });
}
function download(name: string, text: string | Blob, mime = 'application/json') {
  const blob = typeof text === 'string' ? new Blob([text], { type: mime }) : text;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

// ---------- shell ----------
const NAV: [string, string][] = [['dashboard', 'Readiness'], ['controls', 'Controls'], ['evidence', 'Evidence'], ['poam', 'POA&M'], ['export', 'Export'], ['system', 'System']];
function header() {
  const r = readiness(cat, st);
  const el = document.getElementById('top');
  if (!el) return;
  el.innerHTML = `<a class="brand" href="#/dashboard" aria-label="Preflight, readiness"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13.5 21 4l-5.5 17-3.6-6.6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m11.9 14.4 9.1-10.4" stroke="currentColor" stroke-width="1.8"/></svg>Preflight</a>
    <div class="sys"><span class="sysname">${esc(st.system.name || 'No system yet')}</span><span class="chip">${esc(baselineTitle())}</span></div>
    <div class="score" title="Readiness score"><b>${r.score}%</b> ready</div><span id="saved" class="saved" aria-live="polite"></span>`;
  const view = route().view;
  document.querySelectorAll<HTMLAnchorElement>('#nav a').forEach((a) => a.setAttribute('aria-current', String(a.dataset.v === view || (view === 'control' && a.dataset.v === 'controls') || (view === 'evidence-item' && a.dataset.v === 'evidence') || (view === 'poam-item' && a.dataset.v === 'poam'))));
  const b = document.getElementById('banner')!;
  b.hidden = !st.demo;
  b.innerHTML = st.demo
    ? `<p><b>Sample data.</b> Bayview Grants Portal is a fictional system, partway through its assessment against the Moderate baseline. Change anything you like; it stays in this browser.</p><div class="row"><button class="btn small" data-act="start-own">Start your own system</button><button class="btn small ghost" data-act="reset-demo">Reset the sample</button></div>`
    : '';
}
const baselineTitle = () => `${st.system.baseline[0].toUpperCase()}${st.system.baseline.slice(1)} baseline${st.system.privacy ? ' + privacy' : ''}`;

export function mountShell() {
  document.body.innerHTML = `<a class="skip" href="#app">Skip to content</a>
  <header id="top" class="top"></header>
  <div id="banner" class="banner" hidden></div>
  <div class="frame">
    <nav id="nav" aria-label="Sections">${NAV.map(([v, t]) => `<a href="#/${v}" data-v="${v}">${t}</a>`).join('')}</nav>
    <main id="app" tabindex="-1"></main>
  </div>`;
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  window.addEventListener('hashchange', () => render(true));
}

interface Route {
  view: string;
  arg: string;
}
function route(): Route {
  const [view, ...rest] = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/');
  const arg = decodeURIComponent(rest.join('/'));
  if (view === 'evidence' && arg) return { view: 'evidence-item', arg };
  if (view === 'poam' && arg) return { view: 'poam-item', arg };
  return { view: view || 'dashboard', arg };
}
const go = (h: string) => (location.hash === h ? render(false) : (location.hash = h));

export function start(c: Catalog, s: State) {
  cat = c;
  ctl = byId(c);
  st = s;
  render(false);
}

function render(scrollTop: boolean) {
  const r = route();
  header();
  const views: Record<string, () => string> = {
    dashboard, controls: () => controls(''), control: () => controls(r.arg), evidence: () => evidenceList(), 'evidence-item': () => evidenceItem(r.arg),
    poam: poamList, 'poam-item': () => poamItem(r.arg), export: exportView, system: systemView,
  };
  app().innerHTML = (views[r.view] || dashboard)();
  document.title = `${(NAV.find((n) => r.view.startsWith(n[0])) || ['', 'Preflight'])[1]} · Preflight`;
  if (scrollTop) {
    window.scrollTo(0, 0);
    const d = document.querySelector('.detail');
    if (d && r.view === 'control') d.scrollTop = 0;
  }
  if (r.view === 'control' && r.arg) document.querySelector(`.clist [data-id="${CSS.escape(r.arg)}"]`)?.scrollIntoView({ block: 'nearest' });
}

// ---------- readiness ----------
function dashboard(): string {
  const r = readiness(cat, st);
  if (!st.system.name) return `<section class="empty"><h1>Set up your system</h1><p>Name the system and choose its baseline, and Preflight lists the controls you need to address.</p><a class="btn" href="#/system">Set up the system</a></section>`;
  const assessed = r.total - r.unassessed;
  return `<section class="hero">
      <h1><span class="big">${r.score}%</span> ready for a ${esc(st.system.baseline)} assessment</h1>
      <p class="lede">${esc(st.system.name)} has ${r.total} controls in scope. ${assessed} are assessed, ${r.withEvidence} have evidence attached, and ${r.openPoams.high + r.openPoams.moderate + r.openPoams.low} POA&M items are open${r.overdue ? `, ${r.overdue} of them overdue` : ''}.</p>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Control map</h2><ul class="legend">${STATUS.map(([k, t]) => `<li><i class="cell ${stCls(k)}"></i>${t} <b>${countOf(r, k)}</b></li>`).join('')}</ul></div>
      <p class="hint">Every control in the baseline, by family. Select one to assess it.</p>
      ${controlMap()}
    </section>
    <div class="cols">
      <section class="panel">
        <h2>What blocks authorization</h2>
        ${r.blockers.length ? `<ol class="blockers">${r.blockers.map(blocker).join('')}</ol>` : '<p class="good">Nothing is blocking. Every control is assessed, evidenced and either satisfied or on the POA&M.</p>'}
      </section>
      <section class="panel">
        <h2>By family</h2>
        <table class="fam"><thead><tr><th scope="col">Family</th><th scope="col">Ready</th><th scope="col" class="num">Controls</th></tr></thead><tbody>
        ${r.families.map((f) => `<tr><th scope="row"><a href="#/controls" data-act="fam" data-v="${f.id}">${f.id}</a> <span>${esc(f.name)}</span></th><td><span class="bar" role="img" aria-label="${f.percent}%"><i style="width:${f.percent}%"></i></span> ${f.percent}%</td><td class="num">${f.total}</td></tr>`).join('')}
        </tbody></table>
        <p class="hint">Satisfied counts fully and partial counts half. Controls marked not applicable leave the count.</p>
      </section>
    </div>`;
}
const countOf = (r: ReadinessSummary, k: string) => ({ satisfied: r.satisfied, partial: r.partial, 'not-satisfied': r.notSatisfied, 'not-applicable': r.na, '': r.unassessed } as Record<string, number>)[k];

function controlMap(): string {
  const scope = inScope(cat, st);
  return `<div class="map">${cat.families
    .map((f) => {
      const cs = scope.filter((c) => c.f === f.id);
      if (!cs.length) return '';
      return `<div class="mrow"><a class="mfam" href="#/controls" data-act="fam" data-v="${f.id}" title="${esc(f.name)}">${f.id}</a><div class="cells">${cs
        .map((c) => {
          const a = assessmentOf(st, c.id);
          return `<a class="cell ${stCls(a.status)}${c.p ? ' sub' : ''}" href="#/control/${encodeURIComponent(c.id)}" tabindex="-1" aria-label="${esc(c.id)} ${esc(c.t)}: ${statusName(a.status)}" data-tip="${esc(c.id)} ${esc(c.t)}\n${statusName(a.status)}"></a>`;
        })
        .join('')}</div></div>`;
    })
    .join('')}</div>`;
}

function blocker(b: ReadinessSummary['blockers'][0]): string {
  const link = (id: string) => (b.kind === 'poam' ? `<a href="#/poam/${id}">${id}</a>` : `<a href="#/control/${encodeURIComponent(id)}">${esc(id)}</a>`);
  const shown = b.ids.slice(0, 10);
  const more = b.ids.length - shown.length;
  const all = b.kind === 'poam' ? `<a href="#/poam">see all</a>` : `<a href="#/controls" data-act="attn" data-v="${b.key}">see all ${b.ids.length}</a>`;
  return `<li data-key="${b.key}"><div class="bh"><b class="n">${b.ids.length}</b><span>${esc(b.label)}</span></div><p>${esc(b.why)}</p><p class="ids">${shown.map(link).join(' ')}${more > 0 ? ` and ${more} more, ${all}` : ''}</p></li>`;
}

// ---------- controls ----------
const F = { q: '', fam: '', status: 'any', attn: '', all: false };
function filtered(): Control[] {
  const r = F.attn ? readiness(cat, st).blockers.find((b) => b.key === F.attn) : null;
  const attnIds = r ? new Set(r.ids) : null;
  const base = F.all ? cat.controls : inScope(cat, st);
  const q = F.q.trim().toLowerCase();
  return base.filter((c) => {
    if (F.fam && c.f !== F.fam) return false;
    const a = assessmentOf(st, c.id);
    if (F.status !== 'any' && (a.status || '') !== (F.status === 'none' ? '' : F.status)) return false;
    if (attnIds && !attnIds.has(c.id)) return false;
    if (q) {
      const idq = q.replace(/\s+/g, '');
      if (!(c.id.toLowerCase().replace(/\s+/g, '').startsWith(idq) || c.t.toLowerCase().includes(q) || c.s.some((x) => x[2].toLowerCase().includes(q)) || a.impl.toLowerCase().includes(q))) return false;
    }
    return true;
  });
}

function controls(sel: string): string {
  const list = filtered();
  const attn = F.attn ? readiness(cat, st).blockers.find((b) => b.key === F.attn) : null;
  const c = sel ? ctl.get(sel) : null;
  return `<div class="split${c ? ' has-detail' : ''}">
    <section class="listcol" aria-label="Control list">
      <div class="filters">
        <label class="sr" for="q">Search controls</label><input id="q" type="search" placeholder="Search by ID, title or text" value="${esc(F.q)}" data-filter="q" autocomplete="off">
        <div class="row">
          <label class="sr" for="ff">Family</label><select id="ff" data-filter="fam"><option value="">All families</option>${cat.families.map((f) => `<option value="${f.id}"${F.fam === f.id ? ' selected' : ''}>${f.id} ${esc(f.name)}</option>`).join('')}</select>
          <label class="sr" for="fs">Status</label><select id="fs" data-filter="status"><option value="any">Any status</option>${STATUS.map(([k, t]) => `<option value="${k || 'none'}"${F.status === (k || 'none') ? ' selected' : ''}>${t}</option>`).join('')}</select>
        </div>
        <label class="check"><input type="checkbox" data-filter="all"${F.all ? ' checked' : ''}> Include controls outside the baseline</label>
        ${attn ? `<p class="attn">Showing: ${esc(attn.label)} <button class="link" data-act="attn" data-v="">Clear</button></p>` : ''}
      </div>
      <p class="count" aria-live="polite">${list.length} ${list.length === 1 ? 'control' : 'controls'}</p>
      <ul class="clist">${list.slice(0, 600).map((x) => crow(x, sel)).join('')}</ul>
      ${list.length > 600 ? '<p class="hint">Showing the first 600. Narrow the search to see the rest.</p>' : ''}
    </section>
    <section class="detail" aria-label="Control detail">${c ? controlDetail(c) : '<div class="pick"><p>Select a control to assess it, write its implementation statement and attach evidence.</p></div>'}</section>
  </div>`;
}
function crow(c: Control, sel: string): string {
  const a = assessmentOf(st, c.id),
    ne = evidenceFor(st, c.id).length,
    np = poamsFor(st, c.id).filter(isOpen).length;
  return `<li><a href="#/control/${encodeURIComponent(c.id)}" data-id="${esc(c.id)}"${c.id === sel ? ' aria-current="true"' : ''}><i class="dot ${stCls(a.status)}" title="${statusName(a.status)}"></i><span class="cid">${esc(c.id)}</span><span class="ct">${esc(c.t)}</span><span class="tags">${ne ? `<span title="Evidence">${ne} ev</span>` : ''}${np ? `<span class="p" title="Open POA&M items">${np} poam</span>` : ''}</span></a></li>`;
}

function controlDetail(c: Control): string {
  const a = assessmentOf(st, c.id),
    k = BASELINE_KEY[st.system.baseline],
    inBase = c.b.includes(k) || (st.system.privacy && c.b.includes('P')),
    ev = evidenceFor(st, c.id),
    pm = poamsFor(st, c.id),
    openP = pm.filter((p) => isOpen(p) || p.status === 'risk-accepted');
  const gap = (a.status === 'partial' || a.status === 'not-satisfied') && !openP.length;
  const roles = [...new Set(Object.values(st.a).map((x) => x.role).filter(Boolean))].sort();
  const unlinked = st.evidence.filter((e) => !e.controlIds.includes(c.id));
  const parent = c.p ? ctl.get(c.p) : null;
  const enh = cat.controls.filter((x) => x.p === c.id);
  return `<article class="ctl" data-control="${esc(c.id)}">
    <a class="back" href="#/controls">Back to controls</a>
    <header><h1><span class="cid">${esc(c.id)}</span> ${esc(c.t)}</h1>
      <p class="meta">${esc(cat.families.find((f) => f.id === c.f)?.name || '')}${parent ? `, enhancement of <a href="#/control/${encodeURIComponent(parent.id)}">${esc(parent.id)}</a>` : ''}.
      ${c.b ? `Baselines: ${c.b.split('').map((x) => `<span class="bl${x === k || (x === 'P' && st.system.privacy) ? ' on' : ''}">${BASE_NAME[x]}</span>`).join(' ')}` : 'In no baseline.'}</p>
      ${inBase ? '' : `<p class="note">Not in this system's ${esc(st.system.baseline)} baseline. You can still assess it if you have chosen to include it.</p>`}
    </header>
    <fieldset class="status"><legend>Assessment</legend>
      <div class="seg" role="radiogroup" aria-label="Status">${STATUS.map(([kk, t]) => `<label class="${stCls(kk)}"><input type="radio" name="status" value="${kk}" data-a="status"${(a.status || '') === kk ? ' checked' : ''}><span>${t}</span></label>`).join('')}</div>
      ${a.assessedAt ? `<p class="hint">Status set ${fmtDate(a.assessedAt)}.</p>` : ''}
      ${gap ? `<div class="callout"><p>This control is ${a.status === 'partial' ? 'partly' : 'not'} satisfied and has no POA&M item. Every gap needs one.</p><button class="btn small" data-act="poam-from" data-v="${esc(c.id)}">Add a POA&M item</button></div>` : ''}
    </fieldset>
    <div class="grid2">
      <label>Responsible role<input data-a="role" value="${esc(a.role)}" list="roles" placeholder="e.g. Cloud Operations Lead"></label>
      <label>Implementation<select data-a="origin"><option value="">Not stated</option>${opts([['system', 'System specific'], ['inherited', 'Inherited'], ['shared', 'Shared with a provider'], ['hybrid', 'Hybrid']], a.origin || '')}</select></label>
    </div>
    <datalist id="roles">${roles.map((r) => `<option value="${esc(r)}">`).join('')}</datalist>
    <label class="block">${a.status === 'not-applicable' ? 'Why this control does not apply' : 'Implementation statement'} <span class="hint">goes into the System Security Plan</span>
      <textarea data-a="impl" rows="6" placeholder="${a.status === 'not-applicable' ? 'Explain why the control does not apply to this system.' : 'Describe how the system meets each part of the requirement below: who does what, with which tools, how often.'}">${esc(a.impl)}</textarea></label>
    <label class="block">Assessor notes <span class="hint">kept out of the SSP</span><textarea data-a="notes" rows="2">${esc(a.notes)}</textarea></label>

    <section class="req"><h2>Control requirement</h2>${c.s.map(([d, l, t]) => `<p class="d${d}">${l ? `<b>${esc(l)}</b> ` : ''}${hiParams(t)}</p>`).join('')}</section>

    <section><h2>Evidence <span class="n">${ev.length}</span></h2>
      ${ev.length ? `<ul class="evl">${ev.map((e) => evRow(e, c.id)).join('')}</ul>` : '<p class="hint">No evidence yet.</p>'}
      <div class="row wrap">
        <label class="btn small file">Attach a file<input type="file" data-act="attach" data-v="${esc(c.id)}"></label>
        ${unlinked.length ? `<label class="sr" for="link-ev">Link existing evidence</label><select id="link-ev" data-act="link-ev" data-v="${esc(c.id)}"><option value="">Link existing evidence…</option>${unlinked.map((e) => `<option value="${e.id}">${e.id} ${esc(e.title)}</option>`).join('')}</select>` : ''}
      </div>
      ${c.x.length ? `<details class="examine"><summary>What assessors examine (SP 800-53A)</summary><p class="hint">NIST's assessment procedure lists these. Use it as a checklist of evidence to gather.</p><ul>${c.x.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
    </section>

    <section><h2>POA&M <span class="n">${pm.length}</span></h2>
      ${pm.length ? `<ul class="pml">${pm.map(pmRow).join('')}</ul>` : '<p class="hint">No POA&M items for this control.</p>'}
      <button class="btn small ghost" data-act="poam-from" data-v="${esc(c.id)}">Add a POA&M item</button>
    </section>

    ${enh.length ? `<section><h2>Enhancements</h2><ul class="enh">${enh.map((x) => `<li><a href="#/control/${encodeURIComponent(x.id)}"><i class="dot ${stCls(assessmentOf(st, x.id).status)}"></i>${esc(x.id)} ${esc(x.t)}</a>${x.b.includes(k) ? '' : ' <span class="hint">not in baseline</span>'}</li>`).join('')}</ul></section>` : ''}
    ${c.g ? `<details class="disc"><summary>Discussion from NIST</summary>${c.g.split(/\n\n+/).map((p) => `<p>${esc(p)}</p>`).join('')}</details>` : ''}
  </article>`;
}
const hiParams = (t: string) => esc(t).replace(/\[(Assignment|Selection)[^\]]*\]/g, (m) => `<span class="param">${m}</span>`);

function evRow(e: EvidenceArtifact, controlId?: string): string {
  const stale = isStale(e.capturedAt);
  return `<li><a href="#/evidence/${e.id}"><b>${e.id}</b> ${esc(e.title)}</a><span class="hint">${esc(e.fileName)}, captured ${fmtDate(e.capturedAt)}${stale ? ' <span class="warn">older than a year</span>' : ''}</span>
    <span class="fp" title="SHA-256 ${e.sha256}">SHA-256 ${e.sha256.slice(0, 12)}…</span>${controlId ? `<button class="link" data-act="unlink-ev" data-v="${e.id}" data-c="${esc(controlId)}">Unlink</button>` : ''}</li>`;
}
function pmRow(p: PoamItem): string {
  return `<li><a href="#/poam/${p.id}"><b>${p.id}</b> ${esc(p.title)}</a> <span class="sev ${p.severity}">${label(SEV, p.severity)}</span> <span class="hint">${label(PSTAT, p.status)}, due ${fmtDate(p.scheduledCompletion)}</span>${isOverdue(p) ? ' <span class="warn">overdue</span>' : ''}</li>`;
}

// ---------- evidence ----------
function evidenceList(): string {
  const ev = [...st.evidence].sort((a, b) => (a.id < b.id ? 1 : -1));
  return `<section class="page">
    <h1>Evidence</h1>
    <p class="lede">Files that show a control works: scan results, configuration exports, review records. Each file stays in this browser with its SHA-256 fingerprint, so you can show later that it has not changed.</p>
    <div class="cols2">
      <form class="panel addev" data-form="add-ev">
        <h2>Add evidence</h2>
        <label>File<input type="file" name="file" required></label>
        <label>Title<input name="title" required placeholder="e.g. Quarterly account review, Q4"></label>
        <div class="grid2"><label>Type<select name="type">${opts(EV_TYPES, 'other')}</select></label><label>Captured on<input type="date" name="captured" value="${today()}" max="${today()}" required></label></div>
        <label>Controls it supports<input name="controls" placeholder="e.g. AC-2, AC-2(3)" required></label>
        <label>Notes<textarea name="notes" rows="2"></textarea></label>
        <button class="btn">Add evidence</button>
      </form>
      <section class="panel check">
        <h2>Check a file</h2>
        <p>Choose a file to see whether it matches evidence on record. Use this when an assessor asks if an artifact has changed since you collected it.</p>
        <label class="btn small ghost file">Choose a file to check<input type="file" data-act="check-file"></label>
        <div id="check-out" aria-live="polite"></div>
      </section>
    </div>
    <section class="panel">
      <h2>On record <span class="n">${ev.length}</span></h2>
      ${ev.length ? `<div class="tw"><table class="tbl"><thead><tr><th scope="col">ID</th><th scope="col">Title</th><th scope="col">Type</th><th scope="col">Captured</th><th scope="col">Controls</th><th scope="col">SHA-256</th></tr></thead><tbody>
      ${ev.map((e) => `<tr><td><a href="#/evidence/${e.id}">${e.id}</a></td><td>${esc(e.title)}<div class="hint">${esc(e.fileName)}, ${fmtSize(e.size)}</div></td><td>${evType(e.type)}</td><td>${fmtDate(e.capturedAt)}${isStale(e.capturedAt) ? '<div class="warn">older than a year</div>' : ''}</td><td>${e.controlIds.map((id) => `<a href="#/control/${encodeURIComponent(id)}">${esc(id)}</a>`).join(', ')}</td><td class="fp" title="${e.sha256}">${e.sha256.slice(0, 12)}…</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="hint">No evidence yet. Add a file above, or attach one from a control.</p>'}
    </section>
  </section>`;
}

function evidenceItem(id: string): string {
  const e = st.evidence.find((x) => x.id === id);
  if (!e) return `<section class="page"><h1>Evidence not found</h1><p><a href="#/evidence">Back to evidence</a></p></section>`;
  return `<section class="page narrow" data-ev="${e.id}">
    <a class="back" href="#/evidence">Back to evidence</a>
    <h1><span class="cid">${e.id}</span> ${esc(e.title)}</h1>
    <dl class="facts"><dt>File</dt><dd>${esc(e.fileName)}, ${fmtSize(e.size)}</dd><dt>SHA-256</dt><dd class="fp full">${e.sha256}</dd><dt>Added</dt><dd>${fmtDate(e.addedAt)}</dd></dl>
    <div class="row wrap"><button class="btn small" data-act="dl-ev" data-v="${e.id}">Download the file</button><button class="btn small ghost" data-act="verify-ev" data-v="${e.id}">Check the stored file</button></div>
    <div id="verify-out" aria-live="polite"></div>
    <label>Title<input data-e="title" value="${esc(e.title)}"></label>
    <div class="grid2"><label>Type<select data-e="type">${opts(EV_TYPES, e.type)}</select></label><label>Captured on<input type="date" data-e="capturedAt" value="${e.capturedAt}" max="${today()}"></label></div>
    ${isStale(e.capturedAt) ? `<p class="warn">Captured more than ${STALE_DAYS} days ago. Collect it again to show the control still works.</p>` : ''}
    <label>Controls it supports<input data-e="controlIds" value="${esc(e.controlIds.join(', '))}"></label>
    <p class="ids">${e.controlIds.map((c) => `<a href="#/control/${encodeURIComponent(c)}">${esc(c)}</a>`).join(' ')}</p>
    <label>Notes<textarea data-e="notes" rows="3">${esc(e.notes)}</textarea></label>
    <button class="btn small danger" data-act="del-ev" data-v="${e.id}">Delete this evidence</button>
  </section>`;
}

/** "ac-2 (3), AC-2(3) au-6" -> ['AC-2(3)', 'AU-6'], plus anything that is not a catalog id. */
function parseIds(text: string): { ok: string[]; bad: string[] } {
  const ok: string[] = [],
    bad: string[] = [];
  for (const raw of text.split(/[,;\s]+(?![(\d])/)) {
    const t = raw.trim().toUpperCase().replace(/\s+/g, '');
    if (!t) continue;
    const id = t.replace(/^([A-Z]{2})-?0*(\d+)(?:\(0*(\d+)\))?$/, (_m, f, n, e) => `${f}-${n}${e ? `(${e})` : ''}`);
    if (ctl.has(id)) ok.includes(id) || ok.push(id);
    else bad.push(raw.trim());
  }
  return { ok, bad };
}

async function addEvidence(file: File, meta: { title: string; type: EvidenceType; captured: string; controls: string[]; notes: string }): Promise<EvidenceArtifact> {
  const buf = await file.arrayBuffer();
  const e: EvidenceArtifact = {
    id: nextId('EV', ++st.seq.ev), controlIds: meta.controls, type: meta.type, title: meta.title || file.name, fileName: file.name, size: file.size,
    mime: file.type || 'application/octet-stream', sha256: await sha256(buf), capturedAt: meta.captured || today(), addedAt: today(), notes: meta.notes,
  };
  await putFile(e.id, new Blob([buf], { type: e.mime }));
  st.evidence.push(e);
  save();
  return e;
}

// ---------- POA&M ----------
let pmShow: 'open' | 'all' = 'open';
function poamList(): string {
  const r = readiness(cat, st);
  const list = st.poams.filter((p) => pmShow === 'all' || isOpen(p)).sort((a, b) => sevRank(a) - sevRank(b) || (a.scheduledCompletion < b.scheduledCompletion ? -1 : 1));
  return `<section class="page">
    <div class="row between"><h1>Plan of action and milestones</h1><button class="btn" data-act="poam-new">New POA&M item</button></div>
    <p class="lede">${r.openPoams.high + r.openPoams.moderate + r.openPoams.low} open: ${r.openPoams.high} high, ${r.openPoams.moderate} moderate, ${r.openPoams.low} low. ${r.overdue ? `<span class="warn">${r.overdue} overdue.</span>` : 'None overdue.'}</p>
    <div class="seg small" role="radiogroup" aria-label="Show"><label><input type="radio" name="pmshow" value="open" data-act="pmshow"${pmShow === 'open' ? ' checked' : ''}><span>Open</span></label><label><input type="radio" name="pmshow" value="all" data-act="pmshow"${pmShow === 'all' ? ' checked' : ''}><span>All, including closed and accepted</span></label></div>
    ${list.length ? `<div class="tw"><table class="tbl pm"><thead><tr><th scope="col">ID</th><th scope="col">Weakness</th><th scope="col">Control</th><th scope="col">Severity</th><th scope="col">Status</th><th scope="col">Due</th><th scope="col">Point of contact</th></tr></thead><tbody>
    ${list.map((p) => `<tr${isOverdue(p) ? ' class="late"' : ''}><td><a href="#/poam/${p.id}">${p.id}</a></td><td>${esc(p.title)}</td><td><a href="#/control/${encodeURIComponent(p.controlId)}">${esc(p.controlId)}</a></td><td><span class="sev ${p.severity}">${label(SEV, p.severity)}</span></td><td>${label(PSTAT, p.status)}</td><td>${fmtDate(p.scheduledCompletion)}${isOverdue(p) ? '<div class="warn">overdue</div>' : ''}</td><td>${esc(p.poc)}</td></tr>`).join('')}
    </tbody></table></div>` : `<p class="hint">${pmShow === 'open' ? 'No open items.' : 'No POA&M items yet.'} Add one when a control is not fully satisfied, or when a scan or test finds a weakness.</p>`}
  </section>`;
}
const sevRank = (p: PoamItem) => ['high', 'moderate', 'low'].indexOf(p.severity) + (isOpen(p) ? 0 : 10);

function newPoam(controlId: string): PoamItem {
  const p: PoamItem = {
    id: nextId('POAM', ++st.seq.poam), controlId, title: '', description: '', severity: 'moderate', status: 'open', source: 'assessment', poc: assessmentOf(st, controlId).role,
    created: today(), scheduledCompletion: addDays(today(), 90), milestones: [{ text: '', due: addDays(today(), 30), done: false }], residualRisk: '',
  };
  st.poams.push(p);
  save();
  return p;
}

function poamItem(id: string): string {
  const p = st.poams.find((x) => x.id === id);
  if (!p) return `<section class="page"><h1>POA&M item not found</h1><p><a href="#/poam">Back to the POA&M</a></p></section>`;
  const c = ctl.get(p.controlId);
  return `<section class="page narrow" data-poam="${p.id}">
    <a class="back" href="#/poam">Back to the POA&M</a>
    <h1><span class="cid">${p.id}</span> ${esc(p.title || 'New item')}</h1>
    ${isOverdue(p) ? '<p class="warn">Overdue: a milestone or the completion date has passed.</p>' : ''}
    <label>Weakness<input data-p="title" value="${esc(p.title)}" placeholder="What is wrong, in one line" required></label>
    <label>Control<input data-p="controlId" value="${esc(p.controlId)}" list="ctl-ids"></label>
    <p class="hint" id="pm-ctl">${c ? `<a href="#/control/${encodeURIComponent(c.id)}">${esc(c.id)} ${esc(c.t)}</a>` : 'Not a control in the catalog.'}</p>
    <datalist id="ctl-ids">${inScope(cat, st).map((x) => `<option value="${esc(x.id)}">${esc(x.t)}</option>`).join('')}</datalist>
    <label>Description<textarea data-p="description" rows="3">${esc(p.description)}</textarea></label>
    <div class="grid3">
      <label>Severity<select data-p="severity">${opts(SEV, p.severity)}</select></label>
      <label>Status<select data-p="status">${opts(PSTAT, p.status)}</select></label>
      <label>Found by<select data-p="source">${opts(PSRC, p.source)}</select></label>
    </div>
    <div class="grid3">
      <label>Point of contact<input data-p="poc" value="${esc(p.poc)}"></label>
      <label>Detected<input type="date" data-p="created" value="${p.created}"></label>
      <label>Scheduled completion<input type="date" data-p="scheduledCompletion" value="${p.scheduledCompletion}"></label>
    </div>
    <fieldset class="ms"><legend>Milestones</legend>
      ${p.milestones.map((m, i) => `<div class="msr"><label class="check"><input type="checkbox" data-m="done" data-i="${i}"${m.done ? ' checked' : ''}><span class="sr">Done</span></label><label class="sr" for="mt${i}">Milestone ${i + 1}</label><input id="mt${i}" data-m="text" data-i="${i}" value="${esc(m.text)}" placeholder="What will be done"><label class="sr" for="md${i}">Due</label><input id="md${i}" type="date" data-m="due" data-i="${i}" value="${m.due}"${!m.done && m.due && m.due < today() ? ' class="late"' : ''}><button class="link" data-act="ms-del" data-v="${i}" aria-label="Remove milestone ${i + 1}">Remove</button></div>`).join('')}
      <button class="btn small ghost" data-act="ms-add">Add a milestone</button>
    </fieldset>
    <label class="block">Residual risk ${p.status === 'risk-accepted' ? '<span class="warn">required for a risk acceptance</span>' : '<span class="hint">what risk remains, for the authorizing official</span>'}<textarea data-p="residualRisk" rows="2">${esc(p.residualRisk)}</textarea></label>
    <button class="btn small danger" data-act="del-poam" data-v="${p.id}">Delete this item</button>
  </section>`;
}

// ---------- export ----------
function exportView(): string {
  const r = readiness(cat, st);
  return `<section class="page">
    <h1>Export</h1>
    <p class="lede">Take the assessment out of Preflight. Every file is built in this browser.</p>
    <div class="exports">
      <div class="panel"><h2>System Security Plan</h2><p>A draft SSP: system information, then each control's requirement, implementation statement, evidence and open POA&M items. ${r.total - r.withImpl - r.na} controls still need an implementation statement.</p>
        <div class="row wrap"><button class="btn" data-act="x-ssp-md">Download as Markdown</button><button class="btn ghost" data-act="x-ssp-oscal">Download as OSCAL JSON</button></div>
        <p class="hint">OSCAL is NIST's machine-readable format for security plans. The file follows OSCAL ${'1.2.1'} and imports the NIST ${esc(st.system.baseline)} baseline profile.</p></div>
      <div class="panel"><h2>POA&M</h2><p>All ${st.poams.length} items with severity, status, milestones and residual risk.</p>
        <div class="row wrap"><button class="btn" data-act="x-poam-csv">Download as CSV</button><button class="btn ghost" data-act="x-poam-oscal">Download as OSCAL JSON</button></div></div>
      <div class="panel"><h2>Backup</h2><p>Everything, including the evidence files, in one file you can restore here or on another computer.</p>
        <div class="row wrap"><button class="btn" data-act="x-backup">Download backup</button><label class="btn ghost file">Restore a backup<input type="file" accept=".json,application/json" data-act="restore"></label></div>
        <p class="hint">Restoring replaces what is in this browser now.</p></div>
    </div>
  </section>`;
}

// ---------- system ----------
function systemView(): string {
  const s = st.system,
    setup = !s.name;
  const counts = (['low', 'moderate', 'high'] as const).map((b) => [b, cat.controls.filter((c) => c.b.includes(BASELINE_KEY[b])).length] as const);
  return `<section class="page narrow">
    <h1>${setup ? 'Set up your system' : 'System'}</h1>
    <p class="lede">${setup ? 'Name the system and choose its baseline. You can change any of this later.' : 'What goes on the cover of the System Security Plan.'}</p>
    <form data-form="system" class="sysform">
      <div class="grid2"><label>System name<input name="name" value="${esc(s.name)}" required></label><label>Short name<input name="short" value="${esc(s.short)}" placeholder="e.g. BGP"></label></div>
      <fieldset class="baseline"><legend>Baseline, from the FIPS 199 categorization</legend>
        ${counts.map(([b, n]) => `<label><input type="radio" name="baseline" value="${b}"${s.baseline === b ? ' checked' : ''}><span><b>${b[0].toUpperCase() + b.slice(1)}</b> ${n} controls</span></label>`).join('')}
        <label class="check"><input type="checkbox" name="privacy"${s.privacy ? ' checked' : ''}> The system processes personally identifiable information: add the privacy baseline (${cat.controls.filter((c) => c.b.includes('P')).length} controls)</label>
      </fieldset>
      <div class="grid2"><label>System owner<input name="owner" value="${esc(s.owner)}"></label><label>ISSO<input name="isso" value="${esc(s.isso)}"></label></div>
      <label>Status<select name="status">${opts([['under-development', 'Under development'], ['operational', 'Operational'], ['under-major-modification', 'Under major modification']], s.status)}</select></label>
      <label>Description<textarea name="description" rows="3">${esc(s.description)}</textarea></label>
      <label>Authorization boundary<textarea name="boundary" rows="3" placeholder="What is inside the boundary: components, networks, data stores, interconnections.">${esc(s.boundary)}</textarea></label>
      <button class="btn">${setup ? 'Create the system' : 'Save'}</button>
    </form>
    <section class="panel quiet">
      <h2>Your data</h2>
      <p>Preflight keeps everything in this browser's storage on this device. Nothing is uploaded. Download a backup from Export to move it or keep a copy.</p>
      <p>Controls: ${esc(cat.source)}, published ${fmtDate(cat.published)}, ${cat.controls.length} controls and enhancements.</p>
      <div class="row wrap">${st.demo ? '' : '<button class="btn small ghost" data-act="load-demo">Load the sample system</button>'}<button class="btn small danger" data-act="wipe">Erase everything</button></div>
    </section>
  </section>`;
}

// ---------- events ----------
async function onClick(ev: MouseEvent) {
  const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!t || t.tagName === 'INPUT' || t.tagName === 'SELECT') return;
  const v = t.dataset.v || '';
  switch (t.dataset.act) {
    case 'fam':
      ev.preventDefault();
      Object.assign(F, { fam: v, attn: '', q: '', status: 'any' });
      go('#/controls');
      break;
    case 'attn':
      ev.preventDefault();
      Object.assign(F, { attn: v, fam: '', q: '', status: 'any' });
      go(route().view === 'control' ? location.hash : '#/controls');
      break;
    case 'start-own':
      go('#/system');
      if (await confirmBox('Start your own system?', 'This erases the sample system from this browser so you can set up yours.', 'Erase the sample')) await reset(blankState(), {}, '#/system');
      break;
    case 'reset-demo':
    case 'load-demo': {
      if (!st.demo && !(await confirmBox('Load the sample system?', 'This replaces your system, its evidence and POA&M in this browser. Download a backup first if you want to keep them.', 'Replace with the sample'))) return;
      const d = await demoState(cat);
      await reset(d.state, d.files, '#/dashboard');
      toast('Sample system loaded.');
      break;
    }
    case 'wipe':
      if (await confirmBox('Erase everything?', 'This deletes the system, assessments, evidence files and POA&M from this browser. It cannot be undone.', 'Erase everything')) {
        await reset(blankState(), {}, '#/system');
        toast('Erased.');
      }
      break;
    case 'poam-from':
    case 'poam-new': {
      const p = newPoam(t.dataset.act === 'poam-from' ? v : route().arg || '');
      go(`#/poam/${p.id}`);
      setTimeout(() => (document.querySelector('[data-p=title]') as HTMLInputElement)?.focus(), 50);
      break;
    }
    case 'ms-add': {
      const p = curPoam();
      if (!p) return;
      p.milestones.push({ text: '', due: p.scheduledCompletion || addDays(today(), 30), done: false });
      save();
      render(false);
      (document.querySelectorAll('[data-m=text]')[p.milestones.length - 1] as HTMLInputElement)?.focus();
      break;
    }
    case 'ms-del': {
      const p = curPoam();
      if (!p) return;
      p.milestones.splice(+v, 1);
      save();
      render(false);
      break;
    }
    case 'del-poam':
      if (await confirmBox(`Delete ${v}?`, 'The item is removed from the POA&M. To keep a record, set its status to Closed instead.', 'Delete')) {
        st.poams = st.poams.filter((p) => p.id !== v);
        save();
        go('#/poam');
      }
      break;
    case 'unlink-ev': {
      const e = st.evidence.find((x) => x.id === v);
      if (!e) return;
      e.controlIds = e.controlIds.filter((c) => c !== t.dataset.c);
      save();
      render(false);
      toast(`${v} unlinked from ${t.dataset.c}. The file is still on record.`);
      break;
    }
    case 'del-ev':
      if (await confirmBox(`Delete ${v}?`, 'The file and its fingerprint are removed from this browser.', 'Delete')) {
        st.evidence = st.evidence.filter((e) => e.id !== v);
        await delFile(v);
        save();
        go('#/evidence');
      }
      break;
    case 'dl-ev': {
      const e = st.evidence.find((x) => x.id === v),
        b = await getFile(v);
      if (e && b) download(e.fileName, b);
      else toast('The file is not in this browser.', 'warn');
      break;
    }
    case 'verify-ev': {
      const e = st.evidence.find((x) => x.id === v),
        b = await getFile(v),
        out = document.getElementById('verify-out')!;
      if (!e || !b) {
        out.innerHTML = '<p class="warn">The file is not in this browser.</p>';
        return;
      }
      const h = await sha256(await b.arrayBuffer());
      out.innerHTML = h === e.sha256 ? `<p class="good">The stored file still matches its fingerprint from ${fmtDate(e.addedAt)}.</p>` : `<p class="warn">The stored file does not match its recorded fingerprint. It is now ${h}.</p>`;
      break;
    }
    case 'x-ssp-md':
      download(`${fileStem(st)}-ssp.md`, sspMarkdown(cat, st), 'text/markdown');
      break;
    case 'x-ssp-oscal':
      download(`${fileStem(st)}-ssp.oscal.json`, JSON.stringify(sspOscal(cat, st), null, 2));
      break;
    case 'x-poam-oscal':
      download(`${fileStem(st)}-poam.oscal.json`, JSON.stringify(poamOscal(st), null, 2));
      break;
    case 'x-poam-csv':
      download(`${fileStem(st)}-poam.csv`, poamCsv(st), 'text/csv');
      break;
    case 'x-backup':
      download(`${fileStem(st)}-preflight-backup-${today()}.json`, await backupJson(st, await allFiles()));
      toast('Backup downloaded, with every evidence file.');
      break;
  }
}

const curPoam = () => st.poams.find((p) => p.id === route().arg);

function onInput(ev: Event) {
  const el = ev.target as HTMLInputElement;
  if (el.dataset.filter === 'q') {
    F.q = el.value;
    refreshList();
    return;
  }
  if (el.dataset.a && el.type !== 'radio' && el.tagName !== 'SELECT') return setA(el.dataset.a, el.value, false);
  if (el.dataset.p && el.tagName !== 'SELECT' && el.type !== 'date') return setP(el.dataset.p, el.value, false);
  if (el.dataset.m === 'text') {
    const p = curPoam();
    if (p) {
      p.milestones[+el.dataset.i!].text = el.value;
      save();
    }
    return;
  }
  if (el.dataset.e && el.tagName !== 'SELECT' && el.type !== 'date' && el.dataset.e !== 'controlIds') return setE(el.dataset.e, el.value);
}

async function onChange(ev: Event) {
  const el = ev.target as HTMLInputElement;
  if (el.dataset.filter) {
    if (el.dataset.filter === 'all') F.all = el.checked;
    else if (el.dataset.filter !== 'q') (F as any)[el.dataset.filter] = el.value;
    return refreshList();
  }
  if (el.dataset.a) return setA(el.dataset.a, el.value, el.dataset.a === 'status' || el.dataset.a === 'origin');
  if (el.dataset.p) return setP(el.dataset.p, el.value, el.tagName === 'SELECT' || el.type === 'date' || el.dataset.p === 'controlId');
  if (el.dataset.m) {
    const p = curPoam();
    if (!p) return;
    const m = p.milestones[+el.dataset.i!];
    if (el.dataset.m === 'done') m.done = el.checked;
    else if (el.dataset.m === 'due') m.due = el.value;
    else m.text = el.value;
    save();
    if (el.dataset.m !== 'text') render(false);
    return;
  }
  if (el.dataset.e) {
    const e = st.evidence.find((x) => x.id === route().arg);
    if (!e) return;
    if (el.dataset.e === 'controlIds') {
      const { ok, bad } = parseIds(el.value);
      if (bad.length) toast(`Not a control ID: ${bad.join(', ')}`, 'warn');
      e.controlIds = ok;
      save();
      render(false);
      return;
    }
    setE(el.dataset.e, el.value);
    if (el.tagName === 'SELECT' || el.type === 'date') render(false);
    return;
  }
  switch (el.dataset.act) {
    case 'attach': {
      const f = el.files && el.files[0];
      if (!f) return;
      const e = await addEvidence(f, { title: f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '), type: 'other', captured: today(), controls: [el.dataset.v!], notes: '' });
      render(false);
      toast(`${e.id} attached to ${el.dataset.v}. Give it a title and capture date on its page.`);
      return;
    }
    case 'link-ev': {
      const e = st.evidence.find((x) => x.id === el.value);
      if (!e) return;
      e.controlIds.push(el.dataset.v!);
      save();
      render(false);
      toast(`${e.id} linked to ${el.dataset.v}.`);
      return;
    }
    case 'check-file': {
      const f = el.files && el.files[0],
        out = document.getElementById('check-out')!;
      if (!f) return;
      const h = await sha256(await f.arrayBuffer());
      const hit = st.evidence.filter((e) => e.sha256 === h);
      out.innerHTML = hit.length
        ? `<p class="good">${esc(f.name)} matches ${hit.map((e) => `<a href="#/evidence/${e.id}">${e.id} ${esc(e.title)}</a>`).join(', ')}, unchanged since it was added on ${fmtDate(hit[0].addedAt)}.</p>`
        : `<p class="warn">${esc(f.name)} does not match any evidence on record. If it is meant to be one of them, it has changed.</p><p class="fp full">SHA-256 ${h}</p>`;
      el.value = '';
      return;
    }
    case 'pmshow':
      pmShow = el.value as 'open' | 'all';
      render(false);
      return;
    case 'restore': {
      const f = el.files && el.files[0];
      el.value = '';
      if (!f) return;
      try {
        const r = await readBackup(await f.text());
        if (!(await confirmBox('Restore this backup?', `It holds ${r.state.system.name || 'a system'} with ${r.state.evidence.length} evidence files and ${r.state.poams.length} POA&M items, and replaces what is in this browser now.`, 'Restore'))) return;
        await reset(r.state, r.files, '#/dashboard');
        if (r.mismatched.length) toast(`Restored. These files do not match their recorded fingerprints: ${r.mismatched.join(', ')}.`, 'warn');
        else if (r.missing.length) toast(`Restored. The backup had no file for ${r.missing.join(', ')}.`, 'warn');
        else toast('Backup restored. Every evidence file matches its fingerprint.');
      } catch (e: any) {
        toast(e.message || String(e), 'warn');
      }
      return;
    }
  }
}

document.addEventListener('submit', async (ev) => {
  const form = ev.target as HTMLFormElement;
  if (!form.dataset.form) return;
  ev.preventDefault();
  const fd = new FormData(form);
  if (form.dataset.form === 'system') {
    const was = st.system.name;
    const s: SystemInfo = {
      name: String(fd.get('name') || '').trim(), short: String(fd.get('short') || '').trim(), description: String(fd.get('description') || '').trim(),
      baseline: fd.get('baseline') as SystemInfo['baseline'], privacy: fd.get('privacy') === 'on', owner: String(fd.get('owner') || '').trim(),
      isso: String(fd.get('isso') || '').trim(), boundary: String(fd.get('boundary') || '').trim(), status: fd.get('status') as SystemInfo['status'],
    };
    st.system = s;
    save();
    if (!was) {
      toast(`${s.name} created. Start with the controls on the readiness page.`);
      go('#/dashboard');
    } else {
      toast('System saved.');
      render(false);
    }
  }
  if (form.dataset.form === 'add-ev') {
    const f = (form.elements.namedItem('file') as HTMLInputElement).files?.[0];
    const { ok, bad } = parseIds(String(fd.get('controls') || ''));
    if (!f) return toast('Choose a file.', 'warn');
    if (bad.length || !ok.length) return toast(bad.length ? `Not a control ID: ${bad.join(', ')}` : 'Name at least one control, e.g. AC-2.', 'warn');
    const e = await addEvidence(f, { title: String(fd.get('title') || '').trim(), type: fd.get('type') as EvidenceType, captured: String(fd.get('captured') || today()), controls: ok, notes: String(fd.get('notes') || '').trim() });
    toast(`${e.id} added, linked to ${ok.join(', ')}.`);
    render(false);
  }
});

function setA(field: string, value: string, rerender: boolean) {
  const id = (document.querySelector('[data-control]') as HTMLElement)?.dataset.control;
  if (!id) return;
  const a = st.a[id] || (st.a[id] = { impl: '', role: '', notes: '' });
  if (field === 'status') {
    a.status = (value || undefined) as AssessmentStatus | undefined;
    a.assessedAt = value ? today() : undefined;
  } else if (field === 'origin') a.origin = (value || undefined) as any;
  else (a as any)[field] = value;
  if (!a.status && !a.impl && !a.role && !a.notes && !a.origin) delete st.a[id];
  save();
  if (rerender) {
    render(false);
    refreshRow(id);
  }
}
function setP(field: string, value: string, rerender: boolean) {
  const p = curPoam();
  if (!p) return;
  if (field === 'controlId') {
    const { ok } = parseIds(value);
    p.controlId = ok[0] || value.trim().toUpperCase();
  } else (p as any)[field] = value;
  if (field === 'status') p.closedAt = value === 'closed' ? today() : undefined;
  save();
  if (rerender) render(false);
  else if (field === 'title') {
    const h = document.querySelector('[data-poam] h1');
    if (h) h.innerHTML = `<span class="cid">${p.id}</span> ${esc(p.title || 'New item')}`;
  }
}
function setE(field: string, value: string) {
  const e = st.evidence.find((x) => x.id === route().arg);
  if (!e) return;
  (e as any)[field] = value;
  save();
}

function refreshList() {
  const r = route();
  const col = document.querySelector('.listcol');
  if (!col) return go('#/controls');
  const list = filtered();
  col.querySelector('.count')!.textContent = `${list.length} ${list.length === 1 ? 'control' : 'controls'}`;
  col.querySelector('.clist')!.innerHTML = list.slice(0, 600).map((x) => crow(x, r.arg)).join('');
}
function refreshRow(id: string) {
  const a = document.querySelector(`.clist [data-id="${CSS.escape(id)}"]`);
  const c = ctl.get(id);
  if (a && c) a.parentElement!.outerHTML = crow(c, id);
}

async function reset(s: State, files: Record<string, Blob>, to: string) {
  await clearFiles();
  for (const [id, b] of Object.entries(files)) await putFile(id, b);
  st = s;
  Object.assign(F, { q: '', fam: '', status: 'any', attn: '', all: false });
  await saveState(st);
  location.hash === to ? render(true) : (location.hash = to);
}

