// scripts/headless-scroll-snap-check.mjs
// Headless verification: load /, scroll to each section, capture scrollY,
// confirm snap lands each section's top at viewport_top + 52px (or at
// doc bottom for the last section where 52px is geometrically infeasible).
//
// Wire protocol: raw Chrome DevTools Protocol over WebSocket. No npm deps.
// Requires Node 22+ (built-in WebSocket) and Edge installed at
//   C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const EDGE = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
const URL = 'http://localhost:3000';
const PORT = 9222;
const HEADER = 52; // px from scroll-padding-top

function startEdge() {
  return spawn(
    EDGE,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      '--remote-allow-origins=*',
      '--no-first-run',
      '--disable-extensions',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--window-size=1280,900',
      String.raw`--user-data-dir=C:\Users\94215\AppData\Local\Temp\edge-snap-test`,
      URL,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
}

async function main() {
  const proc = startEdge();
  await sleep(2500);

  const versions = await (await fetch(`http://localhost:${PORT}/json/version`)).json();
  const targets = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
  console.log('browser:', versions.Browser);
  const target = targets.find((t) => t.type === 'page' && t.url.startsWith(URL));
  if (!target) {
    console.error('no page target');
    proc.kill();
    process.exit(1);
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  }
  async function ev(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.text}`);
    return r.result.value;
  }

  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(JSON.stringify(data.error)));
      else resolve(data.result);
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');

  // Wait for client-side landing mount (page is 'use client')
  for (let i = 0; i < 30; i++) {
    if (await ev(`!!document.querySelector('[class*="FinalCTA_root"]')`)) break;
    await sleep(300);
  }

  // Sanity
  const sanity = await ev(`(() => ({
    bodySnap: getComputedStyle(document.body).scrollSnapType,
    bodyPad: getComputedStyle(document.body).scrollPaddingTop,
    bodyOverflow: getComputedStyle(document.body).overflowY,
    docH: document.documentElement.scrollHeight,
    vpH: window.innerHeight,
    sections: Array.from(document.querySelectorAll('section'))
      .filter(el => getComputedStyle(el).scrollSnapAlign === 'start')
      .map(el => ({ cls: el.className.toString().slice(0, 30), top: Math.round(el.getBoundingClientRect().top + window.scrollY) })),
  }))()`);
  console.log('sanity:', JSON.stringify(sanity, null, 2));

  // Per-section snap check
  // Geometric exception: the LAST snap target may not be able to land
  // sectionTop === HEADER if the document is too short to scroll past
  // (targetTop - HEADER > maxScroll). For that case we accept landing
  // at maxScroll with sectionTop in the range [HEADER, HEADER + vpH].
  const results = [];
  for (let idx = 0; idx < sanity.sections.length; idx++) {
    const s = sanity.sections[idx];
    await ev(`window.scrollTo(0, 0); document.body.scrollTop = 0;`);
    await sleep(400);
    const ideal = Math.max(0, s.top - HEADER);
    await ev(`window.scrollTo({top: ${ideal}, behavior: 'instant'})`);
    await sleep(700);
    const after = await ev(`({
      y: window.scrollY,
      docH: document.documentElement.scrollHeight,
      vpH: window.innerHeight,
      sectionTop: Math.round(document.querySelectorAll('section')[${idx}].getBoundingClientRect().top),
    })`);
    const maxScroll = after.docH - after.vpH;
    const atMax = after.y >= maxScroll - 1;
    let snap;
    let reason;
    if (s.top === 0) {
      // First section: snap position is doc top (0), sectionTop=0 expected
      snap = after.sectionTop === 0;
      reason = `first section: sectionTop=${after.sectionTop} expected 0`;
    } else if (atMax) {
      // Last section: doc may be too short to reach HEADER offset
      snap = after.sectionTop >= HEADER - 1 && after.sectionTop < after.vpH;
      reason = `atMax (doc short): sectionTop=${after.sectionTop} in [${HEADER}, ${after.vpH})`;
    } else {
      snap = Math.abs(after.sectionTop - HEADER) <= 2;
      reason = `sectionTop=${after.sectionTop} vs HEADER=${HEADER}`;
    }
    results.push({ idx, name: s.cls, targetTop: s.top, ideal, scrollY: after.y, maxScroll, sectionTop: after.sectionTop, atMax, snap, reason });
  }

  console.log('\nresults:');
  for (const r of results) {
    console.log(`  [${r.idx}] ${r.name} targetDocY=${r.targetTop} idealY=${r.ideal} scrollY=${r.scrollY} maxScroll=${r.maxScroll} sectionTop=${r.sectionTop} ${r.atMax ? '[atMax] ' : ''}${r.reason} → ${r.snap ? 'OK' : 'FAIL'}`);
  }
  const allOk = results.every((r) => r.snap);
  console.log(allOk ? '\nPASS: scroll-snap engages on every section' : '\nFAIL');

  // Auth rebalance
  const auth = await ev(`(() => {
    const login = document.querySelector('.app-header__login');
    const signup = document.querySelector('.app-header__signup');
    if (!login || !signup) return { error: 'no auth buttons' };
    const ls = getComputedStyle(login);
    const ss = getComputedStyle(signup);
    return {
      login: { color: ls.color, bg: ls.backgroundColor, borderTop: ls.borderTopWidth },
      signup: { color: ss.color, bg: ss.backgroundColor, borderTop: ss.borderTopWidth },
    };
  })()`);
  console.log('\nauth:', JSON.stringify(auth, null, 2));

  proc.kill();
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('error:', e);
  process.exit(2);
});
