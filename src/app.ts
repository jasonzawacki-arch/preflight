// Entry point: read the bundled NIST catalog, load this browser's saved assessment (or the sample system on first
// open), and start the screens. Registers the service worker so the hosted app works offline once loaded.
import type { Catalog, State } from './model.js';
import { loadState, putFile, saveState } from './store.js';
import { demoState } from './demo.js';
import { mountShell, start, toast } from './ui.js';

async function boot() {
  const cat = JSON.parse(document.getElementById('catalog')!.textContent || '{}') as Catalog;
  mountShell();
  let st: State | undefined;
  try {
    st = await loadState();
  } catch {
    toast('This browser is blocking storage, so changes will not be kept. A private window can do this.', 'warn');
  }
  if (!st) {
    const d = await demoState(cat);
    st = d.state;
    try {
      for (const [id, b] of Object.entries(d.files)) await putFile(id, b);
      await saveState(st);
    } catch {
      /* storage blocked: the sample still works for this visit */
    }
  }
  start(cat, st);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
}
boot();
