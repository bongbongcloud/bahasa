import { firebaseConfig } from './firebase-config.js';
import { Sync } from './sync.js';

/* ───────────── helpers ───────────── */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => dstr(new Date());
const parseD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return dstr(d); };
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const now = () => Date.now();
const prettyDate = (s) => parseD(s).toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/[.,!?¿¡"'“”‘’()]/g, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function lev(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

/* ───────────── constants ───────────── */
const KEY = 'bb_state_v1';
const INTERVALS = [0, 1, 2, 4, 7, 14, 30]; // days per box
const MASTERED = 5;
const PASS = 0.7;
const MIN_FOR_CHECKIN = 10;
const STAGES = {
  1: { id: 'Bertahan', en: 'Survival' },
  2: { id: 'Sehari-hari', en: 'Everyday' },
  3: { id: 'Bercakap', en: 'Conversational' },
  4: { id: 'Percaya diri', en: 'Confident' },
};
const TAG_LABELS = { greetings: 'Greetings', politeness: 'Politeness', introductions: 'Introductions', survival: 'Survival', address: 'Address', faith: 'Faith', trap: 'Malay traps' };

/* ───────────── state ───────────── */
function blank() {
  return {
    v: 1,
    settings: { name: '', newPerDay: 5, reviewCap: 12, autoplay: true, updated: 0 },
    cards: {}, logs: {}, checkins: {}, lessonsRead: {},
    startedAt: today(), updatedAt: 0,
  };
}
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      const b = blank();
      return { ...b, ...s, settings: { ...b.settings, ...(s.settings || {}) } };
    }
  } catch (e) { /* fall through */ }
  return blank();
}
let S = load();
function save() {
  S.updatedAt = now();
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage full / private mode */ }
  Sync.schedulePush();
}
function mergeState(local, remote) {
  const out = JSON.parse(JSON.stringify(local));
  const newer = (a, b) => (!a ? b : !b ? a : (b.updated || 0) > (a.updated || 0) ? b : a);
  for (const f of ['cards', 'checkins']) {
    const keys = new Set([...Object.keys(local[f] || {}), ...Object.keys(remote[f] || {})]);
    for (const k of keys) out[f][k] = newer(local[f]?.[k], remote[f]?.[k]);
  }
  const days = new Set([...Object.keys(local.logs || {}), ...Object.keys(remote.logs || {})]);
  for (const d of days) {
    const a = local.logs?.[d] || {}, b = remote.logs?.[d] || {};
    out.logs[d] = {
      reviews: Math.max(a.reviews || 0, b.reviews || 0),
      correct: Math.max(a.correct || 0, b.correct || 0),
      newCount: Math.max(a.newCount || 0, b.newCount || 0),
      updated: Math.max(a.updated || 0, b.updated || 0),
    };
  }
  out.lessonsRead = { ...(remote.lessonsRead || {}), ...(local.lessonsRead || {}) };
  if ((remote.settings?.updated || 0) > (local.settings?.updated || 0)) out.settings = { ...local.settings, ...remote.settings };
  if (remote.startedAt && remote.startedAt < out.startedAt) out.startedAt = remote.startedAt;
  return out;
}

/* ───────────── content packs ───────────── */
let PACKS = [];
let ITEMS = {};
async function loadPacks() {
  const idx = await fetch('data/index.json', { cache: 'no-cache' }).then((r) => r.json());
  const packs = await Promise.all(idx.packs.map((f) => fetch('data/' + f, { cache: 'no-cache' }).then((r) => r.json())));
  packs.sort((a, b) => a.week - b.week);
  PACKS = packs;
  ITEMS = {};
  packs.forEach((p) => p.items.forEach((it, i) => { it.week = p.week; it.stage = p.stage; it.order = i; ITEMS[it.key] = it; }));
}
function unlockedWeeks() {
  const ws = [];
  for (let i = 0; i < PACKS.length; i++) {
    const p = PACKS[i];
    if (i === 0 || S.checkins[PACKS[i - 1].week]?.passed) ws.push(p.week); else break;
  }
  return ws;
}
const currentPack = () => { const ws = unlockedWeeks(); return PACKS.find((p) => p.week === ws[ws.length - 1]); };
const unlockedItems = () => { const ws = new Set(unlockedWeeks()); return Object.values(ITEMS).filter((i) => ws.has(i.week)); };
const seenItems = () => unlockedItems().filter((i) => S.cards[i.key]);

/* ───────────── progress ───────────── */
function logFor(d = today()) {
  S.logs[d] ||= { reviews: 0, correct: 0, newCount: 0, updated: 0 };
  return S.logs[d];
}
function streak() {
  let d = today();
  if (!(S.logs[d]?.reviews > 0)) d = addDays(d, -1);
  let n = 0;
  while (S.logs[d]?.reviews > 0) { n++; d = addDays(d, -1); }
  return n;
}
function stats() {
  let learned = 0, mastered = 0; const struggling = [];
  for (const [k, c] of Object.entries(S.cards)) {
    if (!ITEMS[k]) continue;
    learned++;
    if (c.box >= MASTERED) mastered++;
    if (c.lapses >= 2 && c.box < 3) struggling.push(k);
  }
  return { learned, mastered, struggling };
}
function dueItems() {
  const t = today();
  return unlockedItems()
    .filter((i) => S.cards[i.key] && S.cards[i.key].due <= t)
    .sort((a, b) => (S.cards[a.key].due < S.cards[b.key].due ? -1 : S.cards[a.key].due > S.cards[b.key].due ? 1 : S.cards[a.key].box - S.cards[b.key].box));
}
function newItems() {
  return unlockedItems().filter((i) => !S.cards[i.key]).sort((a, b) => a.week - b.week || a.order - b.order);
}
function grade(key, ok) {
  const t = today();
  const existed = !!S.cards[key];
  const c = S.cards[key] || { box: 0, due: t, lapses: 0, right: 0, wrong: 0, seenAt: t, updated: 0 };
  if (ok) { c.box = Math.min(c.box + 1, INTERVALS.length - 1); c.right++; }
  else { if (existed && c.box >= 1) c.lapses++; c.box = 1; c.wrong++; }
  c.due = addDays(t, INTERVALS[c.box]);
  c.updated = now();
  S.cards[key] = c;
  const L = logFor(); L.reviews++; if (ok) L.correct++; L.updated = now();
  save();
}

/* ───────────── audio (text-to-speech) ───────────── */
const TTS = {
  ok: 'speechSynthesis' in window,
  voice: null,
  pick() {
    if (!this.ok) return;
    const vs = speechSynthesis.getVoices();
    this.voice = vs.find((v) => /^id[-_]/i.test(v.lang)) || vs.find((v) => /indonesia/i.test(v.name)) || null;
  },
  speak(text) {
    if (!this.ok) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text).replace(/\s*\/\s*/g, ', '));
      u.lang = 'id-ID';
      u.rate = 0.85;
      if (this.voice) u.voice = this.voice;
      speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  },
};
if (TTS.ok) { TTS.pick(); speechSynthesis.onvoiceschanged = () => TTS.pick(); }
const speakBtn = (text, cls = '') => TTS.ok ? `<button class="speak ${cls}" data-say="${esc(text)}" aria-label="Play audio">${ICON.speaker}</button>` : '';

const ICON = {
  speaker: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>',
  home: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
  book: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 21.5A2.5 2.5 0 0 1 6.5 19H20v3H6.5"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 9h18"/><path d="m9 15 2 2 4-4"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  flame: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2c1 3.5 5 5.5 5 10.5A5 5 0 0 1 12 18a5 5 0 0 1-5-5.5c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5.5 1-9zm0 20a7 7 0 0 1-7-7h2a5 5 0 0 0 10 0h2a7 7 0 0 1-7 7z"/></svg>',
};

/* ───────────── greeting by time ───────────── */
function greeting() {
  const h = new Date().getHours();
  if (h < 11) return ['Selamat pagi', 'Good morning'];
  if (h < 15) return ['Selamat siang', 'Good day'];
  if (h < 18) return ['Selamat sore', 'Good afternoon'];
  return ['Selamat malam', 'Good evening'];
}

/* ───────────── router ───────────── */
const view = () => $('#view');
let SESSION = null;
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
function route() { return (location.hash || '#home').slice(1).split('/'); }
function render() {
  const [r, arg] = route();
  if (r !== 'session' && r !== 'checkin-run') SESSION = null;
  document.body.dataset.route = r;
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.r === r || (r === 'lesson' && a.dataset.r === 'home') || (r === 'report' && a.dataset.r === 'checkin')));
  if (r === 'session' || r === 'checkin-run') { if (!SESSION) return go('#home'); return renderStep(); }
  window.scrollTo(0, 0);
  ({ home: renderHome, phrases: renderPhrases, checkin: renderCheckin, settings: renderSettings, lesson: () => renderLesson(+arg || currentPack().week), report: () => renderReport(+arg) }[r] || renderHome)();
}

/* ───────────── home ───────────── */
function ring(frac) {
  const r = 34, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, frac));
  return `<svg class="ring" viewBox="0 0 80 80" width="80" height="80" aria-hidden="true">
    <circle cx="40" cy="40" r="${r}" class="ring-bg"/>
    <circle cx="40" cy="40" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - f)}" transform="rotate(-90 40 40)"/>
  </svg>`;
}
function renderHome() {
  const [g, gEn] = greeting();
  const name = S.settings.name;
  const pack = currentPack();
  const L = S.logs[today()] || { reviews: 0, newCount: 0 };
  const due = dueItems().length;
  const newLeft = Math.min(Math.max(0, S.settings.newPerDay - (L.newCount || 0)), newItems().length);
  const todo = Math.min(due, S.settings.reviewCap) + newLeft * 2;
  const done = L.reviews || 0;
  const finished = todo === 0 && done > 0;
  const st = stats();
  const weekItems = Object.values(ITEMS).filter((i) => i.week === pack.week);
  const weekSeen = weekItems.filter((i) => S.cards[i.key]).length;
  const stage = STAGES[pack.stage] || { id: `Tahap ${pack.stage}`, en: '' };
  const isSat = new Date().getDay() === 6;
  const ci = S.checkins[pack.week];
  const nextMissing = ci?.passed && !PACKS.find((p) => p.week === pack.week + 1);

  let banners = '';
  if (!S.lessonsRead[pack.week]) banners += `<a class="banner" href="#lesson/${pack.week}"><b>New lesson ready</b><span>Week ${pack.week}: ${esc(pack.title)} — 2 min read</span></a>`;
  if (nextMissing) banners += `<a class="banner gold" href="#report/${pack.week}"><b>Week ${pack.week} passed 🎉</b><span>Send your report to Claude to get Week ${pack.week + 1}.</span></a>`;
  else if (isSat && !ci) banners += `<a class="banner gold" href="#checkin"><b>Hari Sabtu — check-in day</b><span>About 10 minutes. Then send the report to Claude.</span></a>`;
  else if (ci && !ci.passed) banners += `<a class="banner" href="#checkin"><b>Retake Week ${pack.week} check-in</b><span>Last score ${Math.round(ci.pct * 100)}% — you need ${PASS * 100}% to unlock the next week.</span></a>`;

  view().innerHTML = `
    <header class="hello">
      <h1>${g}${name ? `, ${esc(name)}` : ''}</h1>
      <p>${gEn}${name ? `, ${esc(name)}` : ''} · ${speakBtn(g, 'inline')}</p>
    </header>
    ${banners}
    <section class="card today">
      ${ring(finished ? 1 : done / Math.max(1, done + todo))}
      <div class="today-body">
        <h2>${finished ? 'Selesai! Done for today' : 'Latihan hari ini'}</h2>
        <p class="muted">${finished ? `${done} answers · come back tomorrow` : `About 5 min · ${Math.min(due, S.settings.reviewCap)} review${due === 1 ? '' : 's'} · ${newLeft} new`}</p>
        ${finished
          ? (newItems().length ? `<button class="btn ghost" id="more">Learn ${Math.min(S.settings.newPerDay, newItems().length)} more</button>` : '')
          : (todo > 0 ? `<button class="btn primary" id="start">Mulai · Start</button>` : `<p class="muted">Nothing left in this week's pack. ${ci?.passed ? '' : 'Do your check-in!'}</p>`)}
      </div>
    </section>
    <section class="stats">
      <div class="stat"><span class="num">${streak()}${ICON.flame}</span><span class="lbl">day streak</span></div>
      <div class="stat"><span class="num">${st.learned}</span><span class="lbl">words learned</span></div>
      <div class="stat"><span class="num">${st.mastered}</span><span class="lbl">mastered</span></div>
    </section>
    <section class="card week">
      <div class="eyebrow">Tahap ${pack.stage} · ${esc(stage.id)}${stage.en ? ` <span class="muted">(${esc(stage.en)})</span>` : ''}</div>
      <h2>Week ${pack.week}: ${esc(pack.title)}</h2>
      <p class="muted">${esc(pack.focus || '')}</p>
      <div class="bar"><span style="width:${(100 * weekSeen) / Math.max(1, weekItems.length)}%"></span></div>
      <p class="small muted">${weekSeen} of ${weekItems.length} introduced${ci ? ` · check-in ${Math.round(ci.pct * 100)}%` : ''}</p>
      <div class="row"><a class="btn ghost" href="#lesson/${pack.week}">Read lesson</a><a class="btn ghost" href="#phrases">Phrasebook</a></div>
    </section>
    ${st.struggling.length ? `<section class="card"><h3>Kata sulit · tricky words</h3><div class="chips">${st.struggling.slice(0, 8).map((k) => `<button class="chip" data-say="${esc(ITEMS[k].text)}">${esc(ITEMS[k].text)}</button>`).join('')}</div></section>` : ''}
  `;
  $('#start')?.addEventListener('click', () => startSession('daily'));
  $('#more')?.addEventListener('click', () => startSession('extra'));
}

/* ───────────── sessions ───────────── */
function startSession(mode) {
  const steps = [];
  let reviews = [], fresh = [];
  if (mode === 'daily') {
    reviews = shuffle(dueItems().slice(0, S.settings.reviewCap));
    const L = S.logs[today()] || {};
    fresh = newItems().slice(0, Math.max(0, S.settings.newPerDay - (L.newCount || 0)));
  } else {
    fresh = newItems().slice(0, S.settings.newPerDay);
  }
  for (const it of fresh) {
    steps.push({ kind: 'intro', key: it.key });
    for (let i = 0; i < 2 && reviews.length; i++) { const r = reviews.shift(); steps.push({ kind: 'quiz', key: r.key, type: pickType(r), graded: true }); }
    steps.push({ kind: 'quiz', key: it.key, type: 'id2en', graded: true, fresh: true });
  }
  for (const r of reviews) steps.push({ kind: 'quiz', key: r.key, type: pickType(r), graded: true });
  if (!steps.length) return;
  SESSION = { mode, steps, i: 0, results: [], started: now() };
  go('#session');
}
function startCheckin() {
  const pack = currentPack();
  const seen = seenItems();
  const thisWeek = shuffle(seen.filter((i) => i.week === pack.week));
  const older = shuffle(seen.filter((i) => i.week !== pack.week));
  const struggling = new Set(stats().struggling);
  // Struggling words first, then this week, then earlier weeks.
  const ordered = [...thisWeek.filter((i) => struggling.has(i.key)), ...thisWeek.filter((i) => !struggling.has(i.key))];
  const picks = [...ordered.slice(0, older.length ? 11 : 15), ...older.slice(0, 4)];
  const more = ordered.slice(older.length ? 11 : 15);
  while (picks.length < 15 && more.length) picks.push(more.shift());
  const steps = shuffle(picks).map((it) => ({ kind: 'quiz', key: it.key, type: pickType(it, false, true), graded: true }));
  SESSION = { mode: 'checkin', week: pack.week, steps, i: 0, results: [], started: now() };
  go('#checkin-run');
}
function pickType(item, first = false, exam = false) {
  if (first) return 'id2en';
  const words = item.text.split(/\s+/).length;
  const box = S.cards[item.key]?.box || 0;
  const t = ['id2en', 'en2id'];
  if (TTS.ok && TTS.voice && !exam) t.push('listen');
  if (words >= 3 && !item.text.includes('/')) t.push('tiles', 'tiles');
  if (words <= 2 && (box >= 2 || exam)) t.push('type');
  if (item.malay) t.push('trap', 'trap');
  return t[Math.floor(Math.random() * t.length)];
}
function distractors(item, field, n = 3) {
  const pool = shuffle(unlockedItems().filter((o) => o.key !== item.key && norm(o[field]) !== norm(item[field])));
  const same = pool.filter((o) => o.tags?.some((t) => item.tags?.includes(t)));
  const out = [];
  for (const o of [...same, ...pool]) {
    if (out.length >= n) break;
    if (!out.includes(o[field])) out.push(o[field]);
  }
  return out;
}

function progressHeader() {
  const s = SESSION;
  const label = s.mode === 'checkin' ? `Check-in · Week ${s.week}` : s.mode === 'extra' ? 'Extra round' : 'Latihan';
  return `<div class="sess-top">
    <button class="icon-btn" id="quit" aria-label="Quit">${ICON.close}</button>
    <div class="bar thin"><span style="width:${(100 * s.i) / s.steps.length}%"></span></div>
    <span class="small muted">${label}</span>
  </div>`;
}
function renderStep() {
  const s = SESSION;
  if (s.i >= s.steps.length) return s.mode === 'checkin' ? finishCheckin() : finishSession();
  const step = s.steps[s.i];
  const item = ITEMS[step.key];
  let body = '';
  if (step.kind === 'intro') {
    body = `
      <div class="qcard intro">
        <div class="eyebrow">Kata baru · new ${item.text.includes(' ') ? 'phrase' : 'word'}</div>
        <div class="big">${esc(item.text)} ${speakBtn(item.text)}</div>
        <div class="pron">${esc(item.pron)}</div>
        <div class="meaning">${esc(item.en)}</div>
        ${badges(item)}
        ${item.malay ? `<div class="trapnote">Not <s>${esc(item.malay)}</s> (Malay). ${esc(item.note || '')}</div>` : item.note ? `<div class="note">${esc(item.note)}</div>` : ''}
      </div>
      <button class="btn primary wide" id="next">Got it</button>`;
  } else {
    body = renderQuestion(step, item);
  }
  view().innerHTML = progressHeader() + `<div class="step">${body}</div><div id="feedback"></div>`;
  $('#quit').addEventListener('click', () => {
    if (s.mode === 'checkin' && s.i > 0 && !confirm('Quit the check-in? Your answers so far will be lost.')) return;
    SESSION = null; go(s.mode === 'checkin' ? '#checkin' : '#home');
  });
  if (step.kind === 'intro') {
    const L = logFor(); L.newCount++; L.updated = now(); save();
    if (S.settings.autoplay) TTS.speak(item.text);
    $('#next').addEventListener('click', () => { s.i++; renderStep(); });
  } else {
    wireQuestion(step, item);
  }
}
function badges(item) {
  const b = [];
  if (item.register === 'formal') b.push('<span class="badge formal">formal</span>');
  if (item.register === 'casual') b.push('<span class="badge casual">casual</span>');
  if (item.tags?.includes('faith')) b.push('<span class="badge faith">faith</span>');
  if (item.malay) b.push('<span class="badge trap">Malay trap</span>');
  return b.length ? `<div class="badges">${b.join('')}</div>` : '';
}
function renderQuestion(step, item) {
  const t = step.type;
  if (t === 'id2en' || t === 'listen') {
    const opts = shuffle([item.en, ...distractors(item, 'en')]);
    step.answer = item.en;
    return `<div class="qcard">
        <div class="eyebrow">${t === 'listen' ? 'Listen — what does it mean?' : 'What does this mean?'}</div>
        ${t === 'listen'
          ? `<button class="speak hero" data-say="${esc(item.text)}" aria-label="Play again">${ICON.speaker}</button>`
          : `<div class="big">${esc(item.text)} ${speakBtn(item.text)}</div>${step.fresh || SESSION.mode !== 'checkin' ? `<div class="pron">${esc(item.pron)}</div>` : ''}`}
      </div>
      <div class="options">${opts.map((o) => `<button class="opt" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
  }
  if (t === 'en2id') {
    const opts = shuffle([item.text, ...distractors(item, 'text')]);
    step.answer = item.text;
    return `<div class="qcard"><div class="eyebrow">How do you say…</div><div class="big en">${esc(item.en)}</div></div>
      <div class="options">${opts.map((o) => `<button class="opt id" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
  }
  if (t === 'trap') {
    const opts = shuffle([item.text, item.malay]);
    step.answer = item.text;
    return `<div class="qcard"><div class="eyebrow">Which is Indonesian (not Malay)?</div><div class="big en">${esc(item.en)}</div></div>
      <div class="options two">${opts.map((o) => `<button class="opt id" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
  }
  if (t === 'tiles') {
    const words = item.text.split(/\s+/);
    let order = shuffle(words.map((w, i) => i));
    for (let k = 0; k < 5 && order.every((v, i) => v === i); k++) order = shuffle(order);
    step.tiles = order.map((i) => words[i]);
    step.answer = item.text;
    return `<div class="qcard"><div class="eyebrow">Build the sentence</div><div class="big en">${esc(item.en)}</div></div>
      <div class="built" id="built" aria-live="polite"></div>
      <div class="tiles" id="tiles">${step.tiles.map((w, i) => `<button class="tile" data-i="${i}">${esc(w)}</button>`).join('')}</div>
      <button class="btn primary wide" id="check" disabled>Check</button>`;
  }
  if (t === 'type') {
    step.answer = item.text;
    return `<div class="qcard"><div class="eyebrow">Type it in Indonesian</div><div class="big en">${esc(item.en)}</div></div>
      <form id="typeform" class="typeform" autocomplete="off">
        <input id="typed" type="text" inputmode="text" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Ketik di sini…" enterkeyhint="done">
        <button class="btn primary wide" type="submit">Check</button>
      </form>`;
  }
  return '';
}
function wireQuestion(step, item) {
  const t = step.type;
  if (t === 'listen') TTS.speak(item.text);
  else if (t === 'id2en' && S.settings.autoplay && SESSION.mode !== 'checkin') TTS.speak(item.text);
  $$('.opt').forEach((b) => b.addEventListener('click', () => {
    const ok = b.dataset.v === step.answer;
    $$('.opt').forEach((x) => { x.disabled = true; if (x.dataset.v === step.answer) x.classList.add('right'); });
    if (!ok) b.classList.add('wrong');
    answer(step, item, ok, b.dataset.v);
  }));
  if (t === 'tiles') {
    const built = [];
    const draw = () => {
      $('#built').innerHTML = built.map((i, pos) => `<button class="tile in" data-pos="${pos}">${esc(step.tiles[i])}</button>`).join('') || '<span class="muted small">Tap the words in order</span>';
      $$('#tiles .tile').forEach((b) => { b.disabled = built.includes(+b.dataset.i); });
      $('#check').disabled = built.length !== step.tiles.length;
      $$('#built .tile').forEach((b) => b.addEventListener('click', () => { built.splice(+b.dataset.pos, 1); draw(); }));
    };
    $$('#tiles .tile').forEach((b) => b.addEventListener('click', () => { built.push(+b.dataset.i); draw(); }));
    $('#check').addEventListener('click', () => {
      const given = built.map((i) => step.tiles[i]).join(' ');
      const ok = norm(given) === norm(item.text);
      $$('.tile').forEach((x) => (x.disabled = true));
      $('#check').remove();
      $('#built').classList.add(ok ? 'right' : 'wrong');
      answer(step, item, ok, given);
    });
    draw();
  }
  if (t === 'type') {
    const inp = $('#typed');
    setTimeout(() => inp.focus(), 50);
    $('#typeform').addEventListener('submit', (e) => {
      e.preventDefault();
      const given = inp.value;
      if (!given.trim()) return;
      const targets = [item.text, ...(item.accept || [])].map(norm);
      const g = norm(given);
      let ok = targets.includes(g), typo = false;
      if (!ok && targets.some((x) => x.length > 4 && lev(x, g) === 1)) { ok = true; typo = true; }
      inp.disabled = true; $('#typeform button').remove();
      inp.classList.add(ok ? 'right' : 'wrong');
      answer(step, item, ok, given, typo);
    });
  }
  $$('[data-say]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); TTS.speak(b.dataset.say); }));
}
function answer(step, item, ok, given, typo = false) {
  const s = SESSION;
  if (step.graded) {
    if (s.mode === 'checkin') s.results.push({ key: item.key, type: step.type, ok, given });
    else { grade(item.key, ok); s.results.push({ key: item.key, ok }); }
  }
  if (!ok && s.mode !== 'checkin') {
    // Ask again later in this session (doesn't affect scheduling).
    const at = Math.min(s.steps.length, s.i + 4);
    s.steps.splice(at, 0, { kind: 'quiz', key: item.key, type: step.type === 'listen' ? 'id2en' : step.type, graded: false });
  }
  if (s.mode !== 'checkin' || !ok) if (S.settings.autoplay && step.type !== 'id2en' && step.type !== 'listen') TTS.speak(item.text);
  const exam = s.mode === 'checkin';
  $('#feedback').innerHTML = `
    <div class="fb ${ok ? 'ok' : 'no'}">
      <div class="fb-head">${ok ? (typo ? 'Betul! Watch the spelling.' : ['Betul!', 'Bagus!', 'Mantap!', 'Pintar!'][Math.floor(Math.random() * 4)]) : 'Belum tepat — not quite'}</div>
      ${!ok || !exam ? `<div class="fb-ans"><span class="id">${esc(item.text)}</span> ${speakBtn(item.text, 'inline')}<span class="pron">${esc(item.pron)}</span><span>${esc(item.en)}</span>${item.malay && !ok ? `<span class="trapnote">Not ${esc(item.malay)} — ${esc(item.note || '')}</span>` : !ok && item.note ? `<span class="note">${esc(item.note)}</span>` : ''}</div>` : ''}
      <button class="btn ${ok ? 'primary' : 'dark'} wide" id="cont">Lanjut · Continue</button>
    </div>`;
  $$('#feedback [data-say]').forEach((b) => b.addEventListener('click', () => TTS.speak(b.dataset.say)));
  const cont = $('#cont');
  cont.focus({ preventScroll: true });
  $('#feedback').scrollIntoView({ behavior: 'smooth', block: 'end' });
  cont.addEventListener('click', () => { s.i++; renderStep(); });
}
function finishSession() {
  const s = SESSION;
  const total = s.results.length, right = s.results.filter((r) => r.ok).length;
  const mins = Math.max(1, Math.round((now() - s.started) / 60000));
  view().innerHTML = `
    <div class="done">
      <div class="done-mark">✓</div>
      <h1>Kerja bagus!</h1>
      <p class="muted">Good work · ${mins} min</p>
      <section class="stats">
        <div class="stat"><span class="num">${total}</span><span class="lbl">answered</span></div>
        <div class="stat"><span class="num">${total ? Math.round((100 * right) / total) : 0}%</span><span class="lbl">first-try correct</span></div>
        <div class="stat"><span class="num">${streak()}${ICON.flame}</span><span class="lbl">day streak</span></div>
      </section>
      <a class="btn primary wide" href="#home">Selesai · Done</a>
    </div>`;
  SESSION = null;
  history.replaceState(null, '', '#done');
}

/* ───────────── check-in ───────────── */
function renderCheckin() {
  const pack = currentPack();
  const seen = seenItems().length;
  const list = Object.entries(S.checkins).sort((a, b) => b[0] - a[0]);
  const ci = S.checkins[pack.week];
  view().innerHTML = `
    <header class="page-h"><h1>Check-in mingguan</h1><p class="muted">Weekly check-in · Saturdays</p></header>
    <section class="card">
      <div class="eyebrow">Week ${pack.week} · ${esc(pack.title)}</div>
      ${seen < MIN_FOR_CHECKIN
        ? `<h2>Learn a few more first</h2><p class="muted">You've met ${seen} of the ${MIN_FOR_CHECKIN} words needed for a meaningful check-in. Keep up the daily practice — or use "Learn more" on the home screen.</p>`
        : `<h2>${ci ? (ci.passed ? 'Passed — want to retake?' : 'Try again') : 'Ready when you are'}</h2>
           <p class="muted">Up to 15 questions on words you've learned, no pronunciation hints. Score ${PASS * 100}% to unlock the next week. Afterwards you'll get a report to paste into Claude.</p>
           <button class="btn primary wide" id="go">Start check-in</button>`}
    </section>
    ${list.length ? `<h3 class="section-h">Past check-ins</h3>${list.map(([w, c]) => `
      <a class="card row-link" href="#report/${w}">
        <div><b>Week ${w}</b><div class="small muted">${prettyDate(c.date)}</div></div>
        <div class="score ${c.passed ? 'pass' : 'fail'}">${Math.round(c.pct * 100)}%</div>
      </a>`).join('')}` : ''}
  `;
  $('#go')?.addEventListener('click', startCheckin);
}
function finishCheckin() {
  const s = SESSION;
  const total = s.results.length, right = s.results.filter((r) => r.ok).length;
  const pct = total ? right / total : 0;
  const passed = pct >= PASS;
  const missed = s.results.filter((r) => !r.ok);
  view().innerHTML = `
    <div class="done">
      <div class="done-mark ${passed ? '' : 'fail'}">${Math.round(pct * 100)}%</div>
      <h1>${passed ? 'Lulus! You passed' : 'Hampir! Almost'}</h1>
      <p class="muted">${right} of ${total} correct${passed ? '' : ` · ${PASS * 100}% needed to move on`}</p>
      ${missed.length ? `<section class="card left"><h3>To review</h3><ul class="plain">${missed.map((m) => `<li><b>${esc(ITEMS[m.key].text)}</b> — ${esc(ITEMS[m.key].en)}</li>`).join('')}</ul></section>` : ''}
      <section class="card left">
        <h3>Note for Claude <span class="muted small">(optional)</span></h3>
        <p class="small muted">How did the week feel? Anything you want more of — church words, numbers, conversations?</p>
        <textarea id="note" rows="4" placeholder="e.g. Greetings felt easy. Want to learn how to pray a short prayer."></textarea>
      </section>
      <button class="btn primary wide" id="savec">Save & get report</button>
    </div>`;
  $('#savec').addEventListener('click', () => {
    const t = today();
    S.checkins[s.week] = {
      date: t, score: right, total, pct, passed,
      missed: missed.map((m) => ({ key: m.key, type: m.type, given: m.given || '' })),
      note: $('#note').value.trim(), updated: now(),
    };
    // Missed words come back tomorrow.
    for (const m of missed) {
      const c = S.cards[m.key];
      if (c) { c.box = 1; c.lapses++; c.due = addDays(t, 1); c.updated = now(); }
    }
    const L = logFor(); L.reviews += total; L.correct += right; L.updated = now();
    save();
    SESSION = null;
    go(`#report/${s.week}`);
  });
}
const TYPE_LABEL = { id2en: 'Indo→English', en2id: 'English→Indo', listen: 'listening', tiles: 'sentence build', type: 'typing', trap: 'Malay trap' };
function buildReport(week) {
  const c = S.checkins[week];
  if (!c) return '';
  const pack = PACKS.find((p) => p.week === week) || { stage: '?', title: '' };
  const prev = Object.entries(S.checkins).filter(([w]) => +w < week).sort((a, b) => b[0] - a[0])[0];
  const from = prev ? addDays(prev[1].date, 1) : S.startedAt;
  let days = 0, rev = 0, cor = 0;
  for (let d = from; d <= c.date; d = addDays(d, 1)) {
    const L = S.logs[d];
    if (L?.reviews > 0) { days++; rev += L.reviews; cor += L.correct; }
  }
  const span = Math.round((parseD(c.date) - parseD(from)) / 86400000) + 1;
  const st = stats();
  const lines = [
    'BELAJAR BAHASA — WEEKLY REPORT',
    `Week ${week} · Stage ${pack.stage} (${STAGES[pack.stage]?.en || ''}) · "${pack.title}"`,
    `Check-in: ${prettyDate(c.date)} — ${c.score}/${c.total} (${Math.round(c.pct * 100)}%) ${c.passed ? 'PASSED' : 'NOT PASSED'}`,
    `Practice: ${days} of ${span} days · ${rev} answers · ${rev ? Math.round((100 * cor) / rev) : 0}% correct · streak ${streak()}`,
    `Totals: ${st.learned} learned · ${st.mastered} mastered · ${newItems().length} not yet introduced`,
    '',
    'Missed in check-in:',
    ...(c.missed.length ? c.missed.map((m) => `- ${ITEMS[m.key]?.text} (${ITEMS[m.key]?.en}) — ${TYPE_LABEL[m.type] || m.type}${m.given ? `; I answered "${m.given}"` : ''}`) : ['- none']),
    '',
    'Struggling words (missed 2+ times):',
    ...(st.struggling.length ? st.struggling.slice(0, 10).map((k) => `- ${ITEMS[k].text} (${ITEMS[k].en}) — missed ${S.cards[k].lapses}x`) : ['- none']),
    '',
    `My note: ${c.note || '(none)'}`,
    '',
    c.passed
      ? `Please write the Week ${week + 1} pack (data/week${String(week + 1).padStart(2, '0')}.json) for my Belajar Bahasa app.`
      : `I didn't pass yet — please tell me what to focus on before I retake Week ${week}.`,
  ];
  return lines.join('\n');
}
function renderReport(week) {
  const text = buildReport(week);
  if (!text) return go('#checkin');
  view().innerHTML = `
    <header class="page-h"><h1>Laporan · Report</h1><p class="muted">Week ${week} — paste this into your Claude Bahasa chat</p></header>
    <pre class="report" id="rep">${esc(text)}</pre>
    <div class="row stack">
      <button class="btn primary wide" id="copy">Copy report</button>
      ${navigator.share ? '<button class="btn ghost wide" id="share">Share…</button>' : ''}
    </div>
    <p class="small muted center">Claude will reply with next week's pack. Add it to <code>data/</code> in your repo and list it in <code>data/index.json</code>.</p>`;
  $('#copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text); toast('Copied — now paste it to Claude'); }
    catch (e) { const r = document.createRange(); r.selectNodeContents($('#rep')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast('Selected — tap Copy'); }
  });
  $('#share')?.addEventListener('click', () => navigator.share({ title: `Belajar Bahasa — Week ${week} report`, text }).catch(() => {}));
}

/* ───────────── lesson ───────────── */
function renderLesson(week) {
  const pack = PACKS.find((p) => p.week === week) || currentPack();
  const L = pack.lesson || { title: pack.title, sections: [] };
  view().innerHTML = `
    <header class="page-h"><div class="eyebrow">Pelajaran · Week ${pack.week}</div><h1>${esc(L.title)}</h1></header>
    ${L.sections.map((s) => `
      <section class="card lesson">
        <h2>${esc(s.h)}</h2>
        ${(s.p || []).map((p) => `<p>${esc(p)}</p>`).join('')}
        ${s.list ? `<ul>${s.list.map((li) => `<li>${esc(li)}</li>`).join('')}</ul>` : ''}
      </section>`).join('')}
    <button class="btn primary wide" id="read">${S.lessonsRead[pack.week] ? 'Back home' : 'Mengerti! Got it'}</button>`;
  $('#read').addEventListener('click', () => { S.lessonsRead[pack.week] = true; save(); go('#home'); });
}

/* ───────────── phrasebook ───────────── */
let PB_FILTER = 'all', PB_Q = '';
function renderPhrases() {
  const items = unlockedItems();
  const tags = [...new Set(items.flatMap((i) => i.tags || []))];
  view().innerHTML = `
    <header class="page-h"><h1>Kamus saku</h1><p class="muted">Pocket phrasebook · tap 🔊 to hear</p></header>
    <input id="q" class="search" type="search" placeholder="Cari… search Indonesian or English" value="${esc(PB_Q)}" autocapitalize="off">
    <div class="chips filters">
      ${['all', ...tags, 'formal', 'casual'].map((t) => `<button class="chip ${PB_FILTER === t ? 'on' : ''}" data-f="${t}">${t === 'all' ? 'All' : TAG_LABELS[t] || t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
    </div>
    <div id="pblist"></div>`;
  const draw = () => {
    const q = norm(PB_Q);
    const list = items.filter((i) =>
      (PB_FILTER === 'all' || i.tags?.includes(PB_FILTER) || i.register === PB_FILTER) &&
      (!q || norm(i.text).includes(q) || norm(i.en).includes(q) || norm(i.malay).includes(q)));
    $('#pblist').innerHTML = list.length ? list.map((i) => `
      <div class="pb">
        <div class="pb-main">
          <div class="pb-id">${esc(i.text)} ${!S.cards[i.key] ? '<span class="badge new">new</span>' : ''}</div>
          <div class="pron">${esc(i.pron)}</div>
          <div class="pb-en">${esc(i.en)}</div>
          ${badges(i)}
          ${i.malay ? `<div class="trapnote small">Not ${esc(i.malay)} (Malay). ${esc(i.note || '')}</div>` : i.note ? `<div class="note small">${esc(i.note)}</div>` : ''}
        </div>
        ${speakBtn(i.text)}
      </div>`).join('') : '<p class="muted center">Tidak ada — nothing found.</p>';
    $$('#pblist [data-say]').forEach((b) => b.addEventListener('click', () => TTS.speak(b.dataset.say)));
  };
  $('#q').addEventListener('input', (e) => { PB_Q = e.target.value; draw(); });
  $$('.filters .chip').forEach((b) => b.addEventListener('click', () => { PB_FILTER = b.dataset.f; $$('.filters .chip').forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
  draw();
}

/* ───────────── settings ───────────── */
function renderSettings() {
  const u = Sync.user;
  const syncLabel = { off: '', 'signed-out': 'Not signed in', syncing: 'Syncing…', synced: `Synced ${Sync.lastSync ? new Date(Sync.lastSync).toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit' }) : ''}`, error: 'Sync error', offline: 'Offline — will sync later' }[Sync.status] || '';
  view().innerHTML = `
    <header class="page-h"><h1>Pengaturan</h1><p class="muted">Settings</p></header>
    <section class="card">
      <label class="field"><span>Your name</span><input id="name" value="${esc(S.settings.name)}" placeholder="Bryan" autocapitalize="words"></label>
      <label class="field"><span>New words per day</span>
        <select id="npd">${[3, 5, 8].map((n) => `<option value="${n}" ${S.settings.newPerDay === n ? 'selected' : ''}>${n}${n === 5 ? ' (about 5 min)' : ''}</option>`).join('')}</select></label>
      <label class="field check"><input type="checkbox" id="auto" ${S.settings.autoplay ? 'checked' : ''}><span>Play audio automatically</span></label>
    </section>
    <section class="card">
      <h3>Audio</h3>
      <p class="small muted">${!TTS.ok ? 'This browser has no speech support.' : TTS.voice ? `Using voice: ${esc(TTS.voice.name)}` : 'No Indonesian voice found on this device. On iPhone: Settings → Accessibility → Spoken Content → Voices → Indonesian (download Damayanti). On Android: install Indonesian in Google text-to-speech.'}</p>
      ${TTS.ok ? `<button class="btn ghost" data-say="Selamat pagi, apa kabar?">Test: Selamat pagi, apa kabar?</button>` : ''}
    </section>
    <section class="card">
      <h3>Account & sync</h3>
      ${!Sync.enabled ? `<p class="small muted">Cloud sync isn't set up yet — your progress is saved on this phone. Add your Firebase config to <code>js/firebase-config.js</code> to turn on Google sign-in.</p>`
        : !Sync.ready ? `<p class="small muted">Couldn't reach Firebase (${esc(Sync.status)}). Your progress is still saved on this phone.</p>`
        : u ? `<p>Signed in as <b>${esc(u.displayName || u.email)}</b></p><p class="small muted">${esc(syncLabel)}${Sync.status === 'error' ? ` — ${esc(Sync.error)}` : ''}</p>
               <div class="row"><button class="btn ghost" id="syncnow">Sync now</button><button class="btn ghost" id="signout">Sign out</button></div>`
        : `<p class="small muted">Sign in to back up progress and use it on more than one device. Works offline either way.</p><button class="btn primary" id="signin">Sign in with Google</button>`}
    </section>
    <section class="card">
      <h3>Backup</h3>
      <div class="row"><button class="btn ghost" id="export">Download backup</button><label class="btn ghost">Restore<input type="file" id="import" accept="application/json" hidden></label></div>
    </section>
    <section class="card">
      <h3>Danger zone</h3>
      <button class="btn danger" id="reset">Reset all progress</button>
    </section>
    <p class="small muted center">Belajar Bahasa · ${PACKS.length} week pack${PACKS.length === 1 ? '' : 's'} loaded</p>`;
  const setS = (k, v) => { S.settings[k] = v; S.settings.updated = now(); save(); };
  $('#name').addEventListener('change', (e) => setS('name', e.target.value.trim()));
  $('#npd').addEventListener('change', (e) => setS('newPerDay', +e.target.value));
  $('#auto').addEventListener('change', (e) => setS('autoplay', e.target.checked));
  $$('[data-say]').forEach((b) => b.addEventListener('click', () => TTS.speak(b.dataset.say)));
  $('#signin')?.addEventListener('click', async () => { try { await Sync.signIn(); } catch (e) { toast(e.message || 'Sign-in failed'); } });
  $('#signout')?.addEventListener('click', async () => { await Sync.signOut(); renderSettings(); });
  $('#syncnow')?.addEventListener('click', () => Sync.pull().then(renderSettings));
  $('#export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `belajar-bahasa-backup-${today()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $('#import').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const data = JSON.parse(await f.text()); S = mergeState(S, data); save(); toast('Backup restored'); renderSettings(); }
    catch (err) { toast('That file is not a valid backup'); }
  });
  $('#reset').addEventListener('click', () => {
    if (!confirm('Reset ALL progress? This cannot be undone.')) return;
    const keep = S.settings; S = blank(); S.settings = { ...keep, updated: now() }; save(); toast('Progress reset'); go('#home');
  });
}

/* ───────────── toast ───────────── */
let toastT;
function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ───────────── boot ───────────── */
document.addEventListener('click', (e) => {
  const b = e.target.closest('.chip[data-say], .speak.inline[data-say]');
  if (b && !b.closest('#feedback') && !b.closest('.step')) TTS.speak(b.dataset.say);
});
window.addEventListener('hashchange', render);

(async function boot() {
  try {
    await loadPacks();
  } catch (e) {
    view().innerHTML = `<div class="card"><h2>Couldn't load lessons</h2><p class="muted">${esc(e.message)}. Check your connection and reload.</p></div>`;
    return;
  }
  if (route()[0] === 'session' || route()[0] === 'checkin-run' || route()[0] === 'done') history.replaceState(null, '', '#home');
  render();
  Sync.init(firebaseConfig, {
    getState: () => S,
    mergeRemote: (remote) => { S = mergeState(S, remote); try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} },
    onChange: () => { const r = route()[0]; if (r === 'settings' || r === 'home') render(); },
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
