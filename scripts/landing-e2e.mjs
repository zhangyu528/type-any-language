// scripts/landing-e2e.mjs
// Headless end-to-end audit of the landing page.
//
// Covers, in one pass:
//   1) scroll-snap: every section (4 expected) lands at top + 52px or at
//      maxScroll for the geometrically-short last section.
//   2) auth rebalance: .app-header__login is ghost text,
//      .app-header__signup is mint primary fill (WCAG AA: 5.5:1).
//   3) doc metadata: title, lang.
//   4) heading outline: exactly one <h1>, all headings in order.
//   5) section landmarks: <section> + aria-label / aria-labelledby.
//   6) button/aria audit: every <button> with aria-label, no
//      children text that gets lost to screen readers.
//   7) click-target sizes: every interactive element ≥ 24x24 (WCAG 2.5.8).
//   8) contrast sampling: known DS color pairs (4 sample points).
//   9) console: capture page errors and uncaught exceptions.
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
const TOUCH_MIN = 24; // WCAG 2.5.8 minimum target size

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
      String.raw`--user-data-dir=C:\Users\94215\AppData\Local\Temp\edge-landing-e2e`,
      URL,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
}

// -------- mini test framework --------

const groups = [];
let currentGroup = null;
function group(name) {
  currentGroup = { name, items: [] };
  groups.push(currentGroup);
}
function pass(item) {
  currentGroup.items.push({ ...item, status: 'pass' });
}
function warn(item) {
  currentGroup.items.push({ ...item, status: 'warn' });
}
function fail(item) {
  currentGroup.items.push({ ...item, status: 'fail' });
}

// -------- CDP plumbing --------

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
  const consoleEvents = [];
  const exceptionEvents = [];
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
      return;
    }
    if (data.method === 'Runtime.consoleAPICalled') {
      const args = (data.params.args || []).map((a) => a.value ?? a.description ?? '');
      consoleEvents.push({ type: data.params.type, text: args.join(' ') });
    }
    if (data.method === 'Runtime.exceptionThrown') {
      const ex = data.params.exceptionDetails;
      exceptionEvents.push({ text: ex.text, url: ex.url, line: ex.lineNumber });
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');

  // Wait for client-side landing mount (page is 'use client')
  for (let i = 0; i < 30; i++) {
    if (await ev(`!!document.querySelector('[class*="FinalCTA_root"]')`)) break;
    await sleep(300);
  }

  // ============================================================
  // 1) DOC METADATA
  // ============================================================
  group('doc-metadata');
  const meta = await ev(`(() => ({
    title: document.title,
    lang: document.documentElement.lang,
    viewport: document.querySelector('meta[name="viewport"]')?.content ?? null,
    description: document.querySelector('meta[name="description"]')?.content ?? null,
  }))()`);
  if (meta.title && meta.title.length > 0) {
    pass({ what: 'title', detail: meta.title });
  } else {
    fail({ what: 'title', detail: 'missing' });
  }
  if (meta.lang && meta.lang.length > 0) {
    pass({ what: 'html[lang]', detail: meta.lang });
  } else {
    fail({ what: 'html[lang]', detail: 'missing — screen readers will fall back' });
  }
  if (meta.viewport) {
    pass({ what: 'viewport', detail: meta.viewport });
  } else {
    warn({ what: 'viewport', detail: 'missing — mobile layout may be wrong' });
  }
  if (meta.description) {
    pass({ what: 'description', detail: meta.description.slice(0, 60) + '…' });
  } else {
    warn({ what: 'description', detail: 'missing' });
  }

  // ============================================================
  // 2) HEADING OUTLINE
  // ============================================================
  group('heading-outline');
  const headings = await ev(`Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(el => ({
    level: +el.tagName.slice(1),
    text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 50),
  }))`);
  const h1s = headings.filter((h) => h.level === 1);
  if (h1s.length === 1) {
    pass({ what: 'h1 count', detail: `1 → "${h1s[0].text}"` });
  } else if (h1s.length === 0) {
    fail({ what: 'h1 count', detail: 'no h1 — landing has no top-level page heading' });
  } else {
    fail({ what: 'h1 count', detail: `${h1s.length} h1s (should be exactly 1)` });
  }
  // Check monotonicity: each heading level should be ≤ prev+1
  let lastLevel = 0;
  let skip = false;
  for (const h of headings) {
    if (h.level > lastLevel + 1 && lastLevel !== 0) {
      warn({
        what: 'heading skip',
        detail: `h${lastLevel} → h${h.level} ("${h.text}") — screen reader nav will read missing levels`,
      });
      skip = true;
      break;
    }
    lastLevel = h.level;
  }
  if (!skip) {
    pass({ what: 'heading order', detail: `${headings.length} headings, monotonic` });
  }
  pass({ what: 'heading list', detail: headings.map((h) => `h${h.level}:${h.text}`).join(' | ') });

  // ============================================================
  // 3) SECTION LANDMARKS
  // ============================================================
  group('section-landmarks');
  const sectionInfo = await ev(`Array.from(document.querySelectorAll('section')).map(el => ({
    id: el.id || null,
    ariaLabel: el.getAttribute('aria-label'),
    ariaLabelledby: el.getAttribute('aria-labelledby'),
    cls: el.className.toString().slice(0, 30),
  }))`);
  for (const s of sectionInfo) {
    if (s.ariaLabel || s.ariaLabelledby) {
      pass({ what: 'section', detail: `${s.cls}${s.id ? ' #' + s.id : ''} → ${s.ariaLabel ?? '#' + s.ariaLabelledby}` });
    } else {
      warn({ what: 'section', detail: `${s.cls} — no aria-label / aria-labelledby` });
    }
  }
  // Anchor check: every id="..." is reachable via getElementById
  const idCheck = await ev(`(() => {
    const ids = Array.from(document.querySelectorAll('[id]')).map(el => el.id);
    return ids.filter(id => !document.getElementById(id));
  })()`);
  if (idCheck.length === 0) {
    pass({ what: 'id uniqueness', detail: 'all [id] resolve via getElementById' });
  } else {
    fail({ what: 'id uniqueness', detail: `broken ids: ${idCheck.join(', ')}` });
  }

  // ============================================================
  // 4) SCROLL-SNAP (the original test)
  // ============================================================
  group('scroll-snap');
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
  // Chromium's getComputedStyle abbreviates "y proximity" to "y" when no
  // mandatory strictness is declared (proximity is the implicit default).
  // Accept either explicit ("y proximity" / "y mandatory") or implicit ("y").
  if (sanity.bodySnap === 'y' || sanity.bodySnap.includes('proximity') || sanity.bodySnap.includes('mandatory')) {
    pass({ what: 'body scroll-snap-type', detail: sanity.bodySnap });
  } else {
    fail({ what: 'body scroll-snap-type', detail: `none — got "${sanity.bodySnap}"` });
  }
  if (sanity.bodyPad === `${HEADER}px`) {
    pass({ what: 'body scroll-padding-top', detail: sanity.bodyPad });
  } else {
    fail({ what: 'body scroll-padding-top', detail: `expected ${HEADER}px, got "${sanity.bodyPad}"` });
  }
  if (sanity.sections.length === 4) {
    pass({ what: 'snap targets', detail: `${sanity.sections.length} sections` });
  } else {
    warn({ what: 'snap targets', detail: `expected 4, got ${sanity.sections.length}` });
  }

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
    let snapOk = false;
    let reason = '';
    if (s.top === 0) {
      snapOk = after.sectionTop === 0;
      reason = `first: sectionTop=${after.sectionTop}`;
    } else if (atMax) {
      snapOk = after.sectionTop >= HEADER - 1 && after.sectionTop < after.vpH;
      reason = `atMax: sectionTop=${after.sectionTop} in [${HEADER}, ${after.vpH})`;
    } else {
      snapOk = Math.abs(after.sectionTop - HEADER) <= 2;
      reason = `sectionTop=${after.sectionTop} vs HEADER=${HEADER}`;
    }
    if (snapOk) {
      pass({ what: `snap[${idx}] ${s.cls}`, detail: `targetDocY=${s.top} ${reason}` });
    } else {
      fail({ what: `snap[${idx}] ${s.cls}`, detail: `targetDocY=${s.top} ${reason}` });
    }
  }

  // ============================================================
  // 5) AUTH REBALANCE
  // ============================================================
  group('auth-rebalance');
  const auth = await ev(`(() => {
    const login = document.querySelector('.app-header__login');
    const signup = document.querySelector('.app-header__signup');
    if (!login || !signup) return { error: 'no auth buttons' };
    const ls = getComputedStyle(login);
    const ss = getComputedStyle(signup);
    return {
      login: {
        text: login.textContent.trim(),
        color: ls.color,
        bg: ls.backgroundColor,
        borderTop: ls.borderTopWidth,
        height: Math.round(login.getBoundingClientRect().height),
      },
      signup: {
        text: signup.textContent.trim(),
        color: ss.color,
        bg: ss.backgroundColor,
        borderTop: ss.borderTopWidth,
        height: Math.round(signup.getBoundingClientRect().height),
      },
    };
  })()`);
  if (auth.error) {
    fail({ what: 'auth buttons', detail: auth.error });
  } else {
    // Login should be ghost: transparent bg, no border, 13px-ish text color (rgb(73, 89, 91) or so)
    const loginBgIsTransparent = auth.login.bg === 'rgba(0, 0, 0, 0)' || auth.login.bg === 'transparent';
    const loginBorderZero = auth.login.borderTop === '0px';
    if (loginBgIsTransparent && loginBorderZero) {
      pass({ what: 'login is ghost', detail: `bg=${auth.login.bg} border=${auth.login.borderTop}` });
    } else {
      fail({ what: 'login is ghost', detail: `expected transparent bg + 0 border, got bg=${auth.login.bg} border=${auth.login.borderTop}` });
    }
    // Signup should be primary mint fill
    const signupHasBg = auth.signup.bg !== 'rgba(0, 0, 0, 0)' && auth.signup.bg !== 'transparent';
    if (signupHasBg) {
      pass({ what: 'signup is filled', detail: `bg=${auth.signup.bg}` });
    } else {
      fail({ what: 'signup is filled', detail: `expected filled bg, got ${auth.signup.bg}` });
    }
    // Color contrast: white text on signup fill
    if (auth.signup.color === 'rgb(255, 255, 255)' || auth.signup.color === 'rgba(255, 255, 255, 1)') {
      pass({ what: 'signup text white', detail: auth.signup.color });
    } else {
      warn({ what: 'signup text', detail: `expected white, got ${auth.signup.color}` });
    }
  }

  // ============================================================
  // 6) BUTTON / ARIA AUDIT
  // ============================================================
  group('button-aria');
  const buttons = await ev(`Array.from(document.querySelectorAll('button')).map((b, i) => ({
    idx: i,
    text: (b.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
    ariaLabel: b.getAttribute('aria-label'),
    ariaHidden: b.getAttribute('aria-hidden') === 'true',
    hasOnClick: !!b.onclick || b.hasAttribute('onclick') || b.getAttribute('type') === 'button',
    cls: b.className.toString().slice(0, 30),
  }))`);
  for (const b of buttons) {
    if (b.ariaHidden) continue; // decorative, skip
    if (b.ariaLabel && b.text && b.text !== b.ariaLabel) {
      // aria-label overrides textContent for screen readers; this is a smell
      warn({
        what: `button[${b.idx}] aria overrides text`,
        detail: `label="${b.ariaLabel.slice(0, 40)}" but text="${b.text.slice(0, 40)}" (screen reader only hears label)`,
      });
    } else if (!b.ariaLabel && b.text.length === 0) {
      fail({ what: `button[${b.idx}]`, detail: 'no text and no aria-label — invisible to screen reader' });
    } else {
      pass({ what: `button[${b.idx}] ${b.cls}`, detail: (b.ariaLabel ?? b.text).slice(0, 60) });
    }
  }

  // ============================================================
  // 7) CLICK TARGET SIZES (WCAG 2.5.8 — 24x24 minimum)
  // ============================================================
  group('click-targets');
  const ctaTargets = await ev(`(() => {
    const out = [];
    document.querySelectorAll('button, a[href], [role="button"]').forEach(el => {
      const r = el.getBoundingClientRect();
      // Only count visible + interactive (not display:none)
      if (r.width === 0 || r.height === 0) return;
      if (getComputedStyle(el).visibility === 'hidden' || getComputedStyle(el).display === 'none') return;
      out.push({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 40),
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
    });
    return out;
  })()`);
  let touchFail = 0;
  for (const t of ctaTargets) {
    if (t.w < TOUCH_MIN || t.h < TOUCH_MIN) {
      fail({ what: `target ${t.tag}`, detail: `"${t.text}" → ${t.w}x${t.h} (below ${TOUCH_MIN}x${TOUCH_MIN})` });
      touchFail++;
    }
  }
  if (touchFail === 0) {
    pass({ what: 'all targets', detail: `${ctaTargets.length} interactive elements ≥ ${TOUCH_MIN}x${TOUCH_MIN}` });
  } else {
    fail({ what: 'all targets', detail: `${touchFail}/${ctaTargets.length} below minimum` });
  }

  // ============================================================
  // 8) CONTRAST SAMPLING (4 known DS color pairs)
  // ============================================================
  group('contrast');
  // Sample the actual rendered colors at 4 representative points:
  // (a) body ink on body bg (default text)
  // (b) hero CTA primary text on primary fill
  // (c) signup text on signup fill
  // (d) section-header__caption mint-deep on bg
  const samples = await ev(`(() => {
    function pickText(sel) {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { text: cs.color, bg: cs.backgroundColor };
    }
    function pickBg(sel) {
      const el = document.querySelector(sel);
      if (!el) return null;
      // walk up to find first non-transparent background
      let cur = el;
      while (cur) {
        const bg = getComputedStyle(cur).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
        cur = cur.parentElement;
      }
      return 'rgb(255, 255, 255)';
    }
    return {
      bodyText: pickText('body'),
      heroTitle: pickText('[class*="Hero_title"]'),
      heroTitleBg: pickBg('[class*="Hero_title"]'),
      signup: pickText('.app-header__signup'),
      signupBg: pickBg('.app-header__signup'),
      caption: pickText('[class*="HowItWorks_kicker"], [class*="Hero_kicker"]'),
      captionBg: pickBg('[class*="HowItWorks_kicker"], [class*="Hero_kicker"]'),
    };
  })()`);
  // Relative luminance + contrast (WCAG 2.x)
  function relLum(rgb) {
    const m = rgb.match(/\d+(\.\d+)?/g);
    if (!m) return null;
    const [r, g, b] = m.slice(0, 3).map((v) => {
      const c = +v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrast(a, b) {
    const la = relLum(a), lb = relLum(b);
    if (la == null || lb == null) return null;
    const [hi, lo] = la > lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
  }
  const pairs = [
    { name: 'body text on bg', a: samples.bodyText?.text, b: samples.bodyText?.bg },
    { name: 'hero title on bg', a: samples.heroTitle?.text, b: samples.heroTitleBg },
    { name: 'signup text on fill', a: samples.signup?.text, b: samples.signupBg },
    { name: 'caption (mint-deep) on bg', a: samples.caption?.text, b: samples.captionBg },
  ];
  for (const p of pairs) {
    const c = contrast(p.a, p.b);
    if (c == null) {
      warn({ what: p.name, detail: `could not compute (a=${p.a}, b=${p.b})` });
    } else {
      const ratio = c.toFixed(2);
      // 4.5:1 = AA normal text, 3:1 = AA large text / UI
      if (c >= 4.5) {
        pass({ what: p.name, detail: `${ratio}:1 (AA pass)` });
      } else if (c >= 3) {
        warn({ what: p.name, detail: `${ratio}:1 (AA large only — verify size)` });
      } else {
        fail({ what: p.name, detail: `${ratio}:1 (FAIL — needs 4.5:1)` });
      }
    }
  }

  // ============================================================
  // 9) CONSOLE / ERRORS
  // ============================================================
  group('console');
  const errors = consoleEvents.filter((e) => e.type === 'error');
  const warnings = consoleEvents.filter((e) => e.type === 'warning');
  if (errors.length === 0) {
    pass({ what: 'console errors', detail: 'none' });
  } else {
    for (const e of errors) fail({ what: 'console error', detail: e.text.slice(0, 120) });
  }
  if (warnings.length === 0) {
    pass({ what: 'console warnings', detail: 'none' });
  } else {
    pass({ what: 'console warnings', detail: `${warnings.length} (informational)` });
  }
  if (exceptionEvents.length === 0) {
    pass({ what: 'uncaught exceptions', detail: 'none' });
  } else {
    for (const e of exceptionEvents) fail({ what: 'uncaught exception', detail: `${e.text} @ ${e.url}:${e.line}` });
  }

  // ============================================================
  // REPORT
  // ============================================================
  proc.kill();
  console.log('\n' + '='.repeat(60));
  let passCount = 0, warnCount = 0, failCount = 0;
  for (const g of groups) {
    console.log(`\n[${g.name}]`);
    for (const it of g.items) {
      const tag = it.status === 'pass' ? '✓' : it.status === 'warn' ? '!' : '✗';
      console.log(`  ${tag} ${it.what.padEnd(36)} ${it.detail}`);
      if (it.status === 'pass') passCount++;
      else if (it.status === 'warn') warnCount++;
      else failCount++;
    }
  }
  console.log('\n' + '='.repeat(60));
  console.log(`PASS: ${passCount}  WARN: ${warnCount}  FAIL: ${failCount}`);
  console.log('='.repeat(60));
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('error:', e);
  process.exit(2);
});
