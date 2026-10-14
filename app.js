(() => {
'use strict';
const C = window.CONFIG;
const LS_KEY = 'reflexions-studie-session-v1';
const API_URL = 'https://api.anthropic.com/v1/messages';
const STATUS = { open:'Offen', later:'Für später', discussed:'Schon besprochen', dismissed:'Verworfen' };
const DISMISS_REASONS = ['Schon bedacht', 'Frage passt nicht', 'Stelle passt nicht', 'Nicht relevant', 'Andere'];

let API_KEY = '';       // nur im Arbeitsspeicher, nie gespeichert oder geloggt
let S = null;           // Session-Zustand
let timerHandle = null;
let ui = {};            // Referenzen auf aktuelle DOM-Elemente

// ---------- kleine Helfer ----------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (['value', 'checked', 'disabled', 'selected', 'hidden'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const app = () => document.getElementById('app');
function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { /* Speicher voll/blockiert */ } }
function nowIso() { return new Date().toISOString(); }
function curStep() { return S.steps[S.stepIdx]; }
function curPhaseName() { const s = curStep(); return s ? (s.kind === 'phase' ? s.name : s.kind === 'break' ? 'break_' + s.after : s.kind) : 'setup'; }
function log(type, data) {
  S.events.push({ t: nowIso(), ms: Date.now() - S.startedMs, phase: curPhaseName(), type, data: data || {} });
  save();
}
function partNumber(name) { return name === 'pair' ? 3 : (S.order === 'AB' ? (name === 'baseline' ? 1 : 2) : (name === 'prompt' ? 1 : 2)); }
function pad(n) { return String(n).padStart(2, '0'); }
function fmtClock(ms) { const s = Math.max(0, Math.floor(ms / 1000)); return pad(Math.floor(s / 60)) + ':' + pad(s % 60); }
function cyrb53(str) { let h1 = 0xdeadbeef, h2 = 0x41c6ce57; for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); } h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909); return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16); }
async function hashText(t) {
  try { if (window.crypto && crypto.subtle) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return 'sha256:' + Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''); } } catch (e) { /* Fallback */ }
  return 'cyrb53:' + cyrb53(t);
}

// ---------- API ----------
function apiError(status, msg) {
  const map = { 401: 'API-Key ungültig oder fehlt.', 403: 'Zugriff verweigert (Key/Rechte prüfen).', 404: 'Modell nicht gefunden (MODEL in config.js prüfen).', 429: 'Rate-Limit oder Guthaben/Limit erreicht.', 529: 'API überlastet, bitte gleich nochmals versuchen.' };
  const e = new Error((map[status] || ('API-Fehler ' + status)) + (msg ? ' (' + msg + ')' : ''));
  e.status = status; return e;
}
async function callClaude({ system, messages, maxTokens, onDelta, onStatus, webSearch }) {
  if (!API_KEY) throw new Error('Kein API-Key im Speicher. Bitte Seite neu laden und Key eingeben.');
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify(Object.assign({ model: C.MODEL, max_tokens: maxTokens, messages, stream: true },
        system ? { system } : {}, C.EFFORT ? { output_config: { effort: C.EFFORT } } : {}, C.THINKING ? { thinking: { type: C.THINKING } } : {},
        webSearch && C.WEB_SEARCH ? { tools: [{ type: C.WEB_SEARCH.type, name: 'web_search', max_uses: C.WEB_SEARCH.max_uses }] } : {}))
    });
  } catch (e) { throw new Error('Netzwerkfehler oder vom Browser blockiert (CORS). Siehe README, Abschnitt «Lokaler Server».'); }
  if (!res.ok) { let m = ''; try { const j = await res.json(); m = (j.error && j.error.message) || ''; } catch (e) { /* ignorieren */ } throw apiError(res.status, m); }
  const reader = res.body.getReader(); const dec = new TextDecoder();
  let buf = '', text = '', stop = null; const usage = { input: 0, output: 0, cache_read: 0, cache_write: 0, web_searches: 0 }; const blocks = {}; const searches = [];
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const line = raw.split('\n').find(l => l.startsWith('data:')); if (!line) continue;
      let ev; try { ev = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
      if (ev.type === 'message_start' && ev.message && ev.message.usage) { const u = ev.message.usage; usage.input = u.input_tokens || 0; usage.cache_read = u.cache_read_input_tokens || 0; usage.cache_write = u.cache_creation_input_tokens || 0; }
      else if (ev.type === 'content_block_start' && ev.content_block) { const b = ev.content_block; blocks[ev.index] = { type: b.type, json: '' };
        if (b.type === 'thinking' || b.type === 'redacted_thinking') { if (onStatus && !text) onStatus('denkt nach …'); }
        else if (b.type === 'server_tool_use') { if (onStatus) onStatus('sucht im Web …'); }
        else if (b.type === 'text' && text && !/\n$/.test(text)) { text += '\n\n'; } }
      else if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') { text += ev.delta.text; if (onDelta) onDelta(text); }
      else if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'input_json_delta' && blocks[ev.index]) { blocks[ev.index].json += ev.delta.partial_json || ''; }
      else if (ev.type === 'content_block_stop' && blocks[ev.index] && blocks[ev.index].type === 'server_tool_use') { try { const q = JSON.parse(blocks[ev.index].json || '{}').query; if (q) searches.push(q); } catch (e) { /* ignorieren */ } }
      else if (ev.type === 'message_delta') { if (ev.usage) { usage.output = ev.usage.output_tokens || usage.output; if (ev.usage.server_tool_use) usage.web_searches = ev.usage.server_tool_use.web_search_requests || 0; } if (ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason; }
      else if (ev.type === 'error') { throw new Error('API-Stream-Fehler: ' + ((ev.error && ev.error.message) || 'unbekannt')); }
    }
  }
  text = text.replace(/^\n+/, '');
  if (!text.trim()) throw new Error(stop === 'max_tokens' ? 'Leere Antwort: Das Token-Limit wurde vom Denken aufgebraucht. MAX_TOKENS in config.js erhöhen oder EFFORT senken.' : 'Leere Antwort von der API (' + (stop || 'unbekannt') + ').');
  return { text, usage, stop, searches };
}
function systemBlocks(kind) {
  if (kind === 'baseline') return undefined; // Teil 1: kein System Prompt
  const instr = kind === 'generate' ? C.PROMPT_TEXT + '\n\n' + C.GENERATE_INSTRUCTION : C.PROMPT_TEXT + '\n\n' + C.CHAT_INSTRUCTION;
  // Arbeit zuerst (mit Cache-Marker), damit alle Aufrufe dieselbe gecachte Präfix-Basis nutzen
  return [
    { type: 'text', text: '<arbeit_der_studierenden>\n' + S.thesis + '\n</arbeit_der_studierenden>', cache_control: { type: 'ephemeral' } },
    { type: 'text', text: instr }
  ];
}

// ---------- Passage finden & Fragen parsen ----------
function escRe(c) { return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function locate(thesis, passage) {
  const p = (passage || '').trim(); if (p.length < 8) return null;
  let i = thesis.indexOf(p); if (i >= 0) return [i, i + p.length];
  const toRe = (s) => { let out = '', ws = false; for (const ch of s) { if (/\s/.test(ch)) { if (!ws) out += '\\s+'; ws = true; continue; } ws = false; if (/["“”„«»]/.test(ch)) out += '["“”„«»]'; else if (/['‘’‚`´]/.test(ch)) out += "['‘’‚`´]"; else if (ch === '-' || ch === '–' || ch === '—') out += '[-–—]'; else out += escRe(ch); } return out; };
  const tryRe = (s) => { try { const m = new RegExp(toRe(s)).exec(thesis); return m ? [m.index, m.index + m[0].length] : null; } catch (e) { return null; } };
  let r = tryRe(p); if (r) return r;
  const parts = p.split(/…|\.\.\./).map(x => x.trim()).filter(x => x.length >= 20);
  for (const part of parts) { r = tryRe(part); if (r) return r; }
  return null;
}
function parseQuestions(text) {
  const a = text.indexOf('['), b = text.lastIndexOf(']');
  if (a < 0 || b <= a) throw new Error('Die Antwort enthielt kein JSON-Array.');
  const arr = JSON.parse(text.slice(a, b + 1));
  return arr.filter(x => x && typeof x.question === 'string' && x.question.trim());
}

// ---------- Export ----------
async function buildExport() {
  const thesisHash = await hashText(S.thesis);
  return {
    schema: 'reflexion-eval-log-v1', exportedAt: nowIso(),
    participantId: S.id, pairId: S.pairId, order: S.order, orderMeaning: 'Teil 1 Baseline (freies Prompten, kein System Prompt, eigener Chat), Teil 2 Prompt (neuer Chat), Teil 3 Paar',
    model: C.MODEL, effort: C.EFFORT, thinking: C.THINKING || 'adaptive (Standard)', webSearch: C.WEB_SEARCH, promptVersion: C.PROMPT_VERSION, phaseMinutes: C.PHASE_MINUTES,
    prompts: { baseline: null, prompt: C.PROMPT_TEXT, generateInstruction: C.GENERATE_INSTRUCTION, chatInstruction: C.CHAT_INSTRUCTION },
    startedAt: new Date(S.startedMs).toISOString(), phases: S.phaseTimes,
    thesisChars: S.thesis.length, thesisHash: S.thesis ? thesisHash : null, thesis: S.includeThesis ? S.thesis : null,
    questions: S.questions, chats: S.includeThesis ? S.chats : stripAttachments(S.chats), events: S.events, usage: S.usage
  };
}
function stripAttachments(chats) { const o = {}; for (const k of Object.keys(chats)) o[k] = chats[k].map(m => m.attachment ? Object.assign({}, m, { attachment: { name: m.attachment.name, chars: m.attachment.chars, text: null } }) : m); return o; }
async function doExport(label) {
  const data = await buildExport(); const d = new Date();
  const name = `${S.id}_log_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${label ? '_' + label : ''}.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  S.exportedAtEvents = S.events.length; log('export', { name }); S.exportedAtEvents = S.events.length; save();
}
window.addEventListener('beforeunload', (e) => { if (S && S.events && S.events.length > (S.exportedAtEvents || 0) + 1 && curStep() && curStep().kind !== 'setup') { e.preventDefault(); e.returnValue = ''; } });

// ---------- Rendering: Grundgerüst ----------
function render() {
  if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
  ui = {}; const root = app(); root.replaceChildren();
  if (!S) return renderSetup(root);
  const st = curStep();
  if (st.kind === 'phase') return st.name === 'pair' ? renderPair(root) : renderChatPhase(root, st.name);
  if (st.kind === 'break') return renderBreak(root, st.after);
  return renderEnd(root);
}

// ---------- Setup ----------
function renderSetup(root) {
  const q = new URLSearchParams(location.search);
  let saved = null; try { saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { saved = null; }
  const placeholder = /PLATZHALTER/.test(C.PROMPT_TEXT);
  const f = { id: h('input', { value: q.get('id') || '', placeholder: 'z. B. P03' }), pair: h('input', { value: q.get('pair') || '', placeholder: 'z. B. Paar2' }),
    key: h('input', { type: 'password', placeholder: 'sk-ant-…', autocomplete: 'off' }),
    incl: h('input', { type: 'checkbox', style: 'width:auto' }) };
  const msg = h('div'); const info = (t, cls) => { msg.replaceChildren(h('div', { class: cls || 'hint', text: t })); };
  const testBtn = h('button', { text: 'Key & Verbindung testen', onclick: async () => {
    API_KEY = f.key.value.trim(); if (!API_KEY) return info('Bitte zuerst Key eingeben.', 'err');
    info('Teste …'); try { const ws = !!(C.WEB_SEARCH && (C.WEB_SEARCH.prompt || C.WEB_SEARCH.baseline)); await callClaude({ system: 'Antworte nur mit dem Wort ok. Nutze keine Tools.', messages: [{ role: 'user', content: 'Test' }], maxTokens: 2000, webSearch: ws }); info('Verbindung ok (Modell, Effort' + (ws ? ', Websuche-Tool' : '') + ' akzeptiert).', 'hint'); } catch (e) { info(e.message, 'err'); }
  } });
  const start = h('button', { class: 'primary', text: 'Session starten', onclick: async () => {
    API_KEY = f.key.value.trim(); const id = f.id.value.trim();
    if (!id) return info('Bitte Teilnehmer-ID eingeben.', 'err'); if (!API_KEY) return info('Bitte API-Key eingeben.', 'err');
    S = { v: 1, id, pairId: f.pair.value.trim(), order: 'AB', thesis: '', includeThesis: f.incl.checked, steps: buildSteps('AB'), stepIdx: 0, startedMs: Date.now(), phaseTimes: {}, events: [], chats: { baseline: [], prompt: [] }, questions: [], usage: [], genRounds: 0 };
    log('session_start', { model: C.MODEL, promptVersion: C.PROMPT_VERSION, order: S.order, placeholderPrompt: placeholder }); enterStep(); render();
  } });
  const resume = saved && saved.events ? h('div', { class: 'warn' }, h('b', { text: 'Gespeicherte Session gefunden: ' + saved.id }), h('div', { class: 'small', text: 'Schritt ' + (saved.stepIdx + 1) + ' von ' + saved.steps.length + '. Zum Fortsetzen oben den API-Key eingeben.' }),
    h('div', { class: 'row', style: 'margin-top:6px' },
      h('button', { text: 'Fortsetzen', onclick: () => { API_KEY = f.key.value.trim(); if (!API_KEY) return info('Bitte API-Key eingeben.', 'err'); S = saved; log('session_resume'); render(); } }),
      h('button', { text: 'Verwerfen', onclick: () => { if (confirm('Gespeicherte Session löschen? Nicht exportierte Daten gehen verloren.')) { localStorage.removeItem(LS_KEY); render(); } } }))) : null;
  root.append(h('div', { class: 'wrap' }, h('div', { class: 'box' },
    h('h1', { text: 'Reflexions-Studie – Setup (Versuchsleitung)' }),
    placeholder ? h('div', { class: 'warn', text: 'Achtung: In config.js ist noch der Platzhalter-Prompt aktiv.' }) : null,
    resume,
    h('label', {}, 'Teilnehmer-ID'), f.id, h('label', {}, 'Paar-ID (optional)'), f.pair,
    h('label', {}, 'API-Key ', h('span', { class: 'hint', text: '(wird nur im Arbeitsspeicher gehalten, nie gespeichert oder geloggt)' })), f.key,
    h('label', { style: 'font-weight:400;display:flex;gap:8px;align-items:center' }, f.incl, 'Hochgeladene/eingefügte Arbeitstexte im exportierten Log mitspeichern (sonst nur Name, Länge und Hash)'),
    h('div', { class: 'row', style: 'margin-top:14px' }, testBtn, start), msg)));
}
function buildSteps(order) {
  const seq = order === 'AB' ? ['baseline', 'prompt'] : ['prompt', 'baseline'];
  return [{ kind: 'phase', name: seq[0] }, { kind: 'break', after: seq[0] }, { kind: 'phase', name: seq[1] }, { kind: 'break', after: seq[1] }, { kind: 'phase', name: 'pair' }, { kind: 'break', after: 'pair' }, { kind: 'end' }];
}
function enterStep() { const st = curStep(); if (st.kind === 'phase' && !S.phaseTimes[st.name]) { S.phaseTimes[st.name] = { start: nowIso(), startMs: Date.now(), end: null }; log('phase_start', { name: st.name }); } }
function endPhase(name) { const t = S.phaseTimes[name]; if (t && !t.end) { t.end = nowIso(); t.durationSec = Math.round((Date.now() - t.startMs) / 1000); } log('phase_end', { name, durationSec: t && t.durationSec }); S.stepIdx++; enterStep(); save(); render(); }
function loadScript(src) { return new Promise((res, rej) => { const s = h('script', { src }); s.onload = res; s.onerror = () => rej(new Error('Skript nicht ladbar')); document.head.append(s); }); }
async function readFileText(file) { return /\.pdf$/i.test(file.name) ? loadPdfText(file) : file.text(); }
async function loadPdfText(file) {
  const base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  if (!window.pdfjsLib) await loadScript(base + 'pdf.min.js');
  const w = await (await fetch(base + 'pdf.worker.min.js')).text();
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([w], { type: 'text/javascript' }));
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise; const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) { const c = await (await pdf.getPage(n)).getTextContent(); let t = ''; for (const it of c.items) { t += it.str + (it.hasEOL ? '\n' : ' '); } pages.push(t.replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ').trim()); }
  return pages.join('\n\n');
}

// ---------- Kopfzeile & Timer ----------
function header(name, withTimer) {
  const t = S.phaseTimes[name]; const limit = C.PHASE_MINUTES * 60000;
  const timer = h('span', { class: 'timer' });
  const tick = () => { if (!t) return; const el = Date.now() - t.startMs; timer.textContent = withTimer ? fmtClock(el) + ' / ' + C.PHASE_MINUTES + ':00' : fmtClock(el); timer.classList.toggle('over', withTimer && el > limit); if (withTimer && el > limit && !S.overtimeLogged?.[name]) { (S.overtimeLogged = S.overtimeLogged || {})[name] = true; log('time_limit_reached', { name }); } };
  tick(); timerHandle = setInterval(tick, 1000);
  return h('header', { class: 'top' }, h('h1', { text: 'Teil ' + partNumber(name) + (name === 'pair' ? ': Gespräch zu zweit' : ': Reflexion mit KI') }), h('span', { class: 'small', text: 'ID ' + S.id }), h('span', { class: 'spacer' }), timer,
    h('button', { text: 'Teil beenden', onclick: () => { if (confirm('Diesen Teil jetzt beenden?')) endPhase(name); } }));
}

// ---------- Chat-Teile (Baseline / Prompt) ----------
function renderChatPhase(root, name) {
  const isPrompt = name === 'prompt';
  root.append(header(name, true));
  if (!isPrompt) { root.append(h('div', { class: 'grid one' }, chatColumn(name))); return; }
  if (!S.thesis) return renderThesisLoad(root);
  const thesisBody = h('div', { class: 'body' }, h('div', { class: 'thesis', id: 'thesis' }));
  const cols = [h('section', { class: 'col' }, h('h2', { text: 'Deine Arbeit' }), thesisBody)];
  if (isPrompt) cols.push(questionsColumn());
  cols.push(chatColumn(name));
  root.append(h('div', { class: 'grid three' }, cols));
  ui.thesisEl = thesisBody.firstChild; refreshThesis();
}
function renderThesisLoad(root) {
  const ta = h('textarea', { rows: 12, placeholder: 'Text deiner Arbeit hier einfügen …' }); const file = h('input', { type: 'file', accept: '.txt,.md,.pdf' }); const msg = h('div'); let src = 'paste', fname = '';
  file.addEventListener('change', async () => { const f = file.files[0]; if (!f) return; msg.replaceChildren(h('div', { class: 'hint', text: 'Lese Datei …' }));
    try { ta.value = await readFileText(f); src = 'upload'; fname = f.name; msg.replaceChildren(h('div', { class: 'hint', text: 'Datei geladen (' + ta.value.length + ' Zeichen). Bitte kurz prüfen, ob der Text vollständig ist.' })); }
    catch (e) { msg.replaceChildren(h('div', { class: 'err', text: 'Datei konnte nicht gelesen werden (' + e.message + '). Bitte Text einfügen.' })); } });
  root.append(h('div', { class: 'wrap' }, h('div', { class: 'box' }, h('h1', { text: 'Neuer Chat: Lade deine Arbeit' }),
    h('p', { class: 'hint', text: 'Dies ist ein neuer Chat. Die KI weiss nichts aus dem vorherigen Teil. Lade deine Arbeit hoch oder füge den Text ein.' }),
    file, h('div', { style: 'height:8px' }), ta, msg,
    h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'primary', text: 'Weiter', onclick: async () => { const t = ta.value.trim(); if (t.length < 200) { msg.replaceChildren(h('div', { class: 'err', text: 'Der Text fehlt oder ist sehr kurz.' })); return; }
      S.thesis = t; log('thesis_loaded', { source: src === 'upload' && t === ta.value.trim() ? 'upload' : 'paste', fileName: fname, chars: t.length, hash: await hashText(t) }); save(); render(); } })))));
}
function refreshThesis() {
  const el = ui.thesisEl; if (!el) return; el.replaceChildren(); ui.marks = {};
  const qs = S.questions.filter(q => q.found && !q.overlap).sort((a, b) => a.start - b.start); let pos = 0;
  for (const q of qs) { if (q.start > pos) el.append(S.thesis.slice(pos, q.start)); const m = h('mark', { onclick: () => focusQuestion(q.id, 'card') }, S.thesis.slice(q.start, q.end)); ui.marks[q.id] = m; el.append(m); pos = q.end; }
  el.append(S.thesis.slice(pos));
}
function focusQuestion(id, target) {
  const q = S.questions.find(x => x.id === id); if (!q) return;
  log('focus', { questionId: id, from: target === 'card' ? 'passage' : 'card' });
  Object.values(ui.marks || {}).forEach(m => m.classList.remove('active'));
  Object.values(ui.cards || {}).forEach(c => c.classList.remove('active'));
  if (ui.marks && ui.marks[id]) { ui.marks[id].classList.add('active'); if (target === 'mark') ui.marks[id].scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  if (ui.cards && ui.cards[id]) { ui.cards[id].classList.add('active'); if (target === 'card') ui.cards[id].scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
}
function chatColumn(name) {
  const list = h('div', { class: 'body' }); const input = h('textarea', { rows: 2, placeholder: 'Nachricht schreiben … (Enter = senden, Shift+Enter = Zeilenumbruch)' });
  const send = h('button', { class: 'primary', text: 'Senden' });
  ui.chat = { name, list, input, send, busy: false, pending: null };
  const addMsg = (m) => { const el = h('div', { class: 'msg ' + m.role }, m.attachment ? h('div', {}, h('span', { class: 'att', text: '📎 ' + (m.attachment.name || 'Eingefügter Text') + ' (' + m.attachment.chars + ' Zeichen)' })) : null, m.content); list.append(el); list.scrollTop = list.scrollHeight; return el; };
  ui.chat.addMsg = addMsg; S.chats[name].forEach(addMsg);
  const chip = h('span', { class: 'small' }); const fileIn = h('input', { type: 'file', accept: '.txt,.md,.pdf', style: 'display:none' });
  const attBtn = name === 'baseline' ? h('button', { title: 'Datei anhängen', text: '📎', onclick: () => fileIn.click() }) : null;
  fileIn.addEventListener('change', async () => { const f = fileIn.files[0]; fileIn.value = ''; if (!f) return; chip.textContent = 'Lese ' + f.name + ' …';
    try { const t = (await readFileText(f)).trim(); ui.chat.pending = { name: f.name, chars: t.length, text: t }; chip.replaceChildren(h('span', { class: 'att', text: '📎 ' + f.name + ' (' + t.length + ' Zeichen)' }), ' ', h('button', { style: 'padding:0 6px;font-size:12px', text: '×', onclick: () => { ui.chat.pending = null; chip.textContent = ''; } })); }
    catch (e) { chip.textContent = 'Datei nicht lesbar: ' + e.message; } });
  const doSend = () => { const t = input.value.trim(); const att = ui.chat.pending; if ((!t && !att) || ui.chat.busy) return; input.value = ''; ui.chat.pending = null; chip.textContent = ''; sendUserMessage(name, t, 'typed', null, att); };
  send.addEventListener('click', doSend); input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } });
  const hint = name === 'baseline' ? h('div', { class: 'hint', style: 'padding:10px 14px;border-bottom:1px solid var(--line)', text: 'Reflektiere mit der KI über deine Arbeit, so wie du es sonst auch tun würdest. Du kannst deine Arbeit mit 📎 hochladen (.pdf, .txt, .md) oder Text einfügen.' }) : null;
  return h('section', { class: 'col' }, ...[h('h2', { text: 'Chat' }), hint, list, name === 'baseline' ? h('div', { style: 'padding:0 10px' }, chip, fileIn) : null, h('div', { class: 'composer' }, ...[attBtn, input, send].filter(Boolean))].filter(Boolean));
}
function setBusy(b) { ui.chat.busy = b; ui.chat.send.disabled = b; ui.chat.input.disabled = b; }
function sendUserMessage(name, text, source, questionId, attachment) {
  const msg = { role: 'user', content: text, t: nowIso(), source: source || 'typed', questionId: questionId || null };
  if (attachment) msg.attachment = attachment;
  S.chats[name].push(msg); log('chat_user', { chars: text.length, source: msg.source, questionId: msg.questionId, attachment: attachment ? { name: attachment.name, chars: attachment.chars } : null }); ui.chat.addMsg(msg); runAssistant(name);
}
async function runAssistant(name) {
  const chat = ui.chat; setBusy(true); chat.list.querySelectorAll('.err').forEach(e => e.remove());
  const el = h('div', { class: 'msg assistant', text: '…' }); chat.list.append(el); chat.list.scrollTop = chat.list.scrollHeight;
  const t0 = Date.now();
  try {
    const r = await callClaude({ webSearch: !!(C.WEB_SEARCH && C.WEB_SEARCH[name]), onStatus: (s) => { if (el.dataset.started !== '1') el.textContent = '… ' + s; }, system: systemBlocks(name === 'baseline' ? 'baseline' : 'chat'), messages: S.chats[name].map(m => ({ role: m.role, content: m.attachment ? '<dokument name="' + m.attachment.name + '">\n' + m.attachment.text + '\n</dokument>' + (m.content ? '\n\n' + m.content : '') : m.content })), maxTokens: C.MAX_TOKENS_CHAT, onDelta: (t) => { el.dataset.started = '1'; el.textContent = t; chat.list.scrollTop = chat.list.scrollHeight; } });
    const msg = { role: 'assistant', content: r.text, t: nowIso(), latencyMs: Date.now() - t0, stop: r.stop, webSearches: r.searches }; S.chats[name].push(msg);
    S.usage.push({ t: msg.t, kind: 'chat_' + name, ...r.usage }); log('chat_assistant', { chars: r.text.length, latencyMs: msg.latencyMs, stop: r.stop, webSearches: r.searches });
  } catch (e) {
    el.remove(); log('api_error', { where: 'chat', message: e.message });
    chat.list.append(h('div', { class: 'err' }, e.message + ' ', h('button', { text: 'Erneut versuchen', onclick: () => runAssistant(name) }))); chat.list.scrollTop = chat.list.scrollHeight;
  } finally { setBusy(false); chat.input.focus(); }
}

// ---------- Fragen-Spalte (Prompt-Teil) ----------
function questionsColumn() {
  const body = h('div', { class: 'body' }); const counts = h('div', { class: 'small' }); const msg = h('div');
  const gen = h('button', { class: 'primary', text: S.questions.length ? 'Weitere Fragen' : 'Stellen markieren & Fragen erzeugen' });
  ui.cards = {}; ui.qBody = body;
  const updateCounts = () => { const c = { open: 0, later: 0, discussed: 0, dismissed: 0 }; S.questions.forEach(q => c[q.status]++); counts.textContent = Object.keys(STATUS).map(k => STATUS[k] + ' ' + c[k]).join(' · '); };
  ui.updateCounts = updateCounts;
  gen.addEventListener('click', async () => {
    gen.disabled = true; msg.replaceChildren(h('div', { class: 'hint', text: 'Die KI liest deine Arbeit … das dauert einen Moment.' })); const t0 = Date.now(); const round = ++S.genRounds;
    const already = S.questions.map(q => '- ' + q.passage.slice(0, 120)).join('\n');
    const userMsg = round === 1 ? 'Bitte markiere jetzt passende Stellen in meiner Arbeit und stelle dazu Reflexionsfragen.' : 'Bitte markiere weitere passende Stellen, die noch nicht abgedeckt sind, und stelle dazu Reflexionsfragen. Bereits verwendete Stellen:\n' + already;
    log('generate_start', { round });
    try {
      const r = await callClaude({ system: systemBlocks('generate'), messages: [{ role: 'user', content: userMsg }], maxTokens: C.MAX_TOKENS_GENERATE });
      S.usage.push({ t: nowIso(), kind: 'generate', ...r.usage }); const items = parseQuestions(r.text); let found = 0;
      for (const it of items) {
        const loc = locate(S.thesis, it.passage); const q = { id: 'q' + (S.questions.length + 1), round, passage: String(it.passage || ''), question: it.question.trim(), type: String(it.type || ''), found: !!loc, start: loc ? loc[0] : null, end: loc ? loc[1] : null, overlap: false, status: 'open', reason: '', reasonText: '', createdAt: nowIso() };
        if (loc) { found++; q.overlap = S.questions.some(o => o.found && !o.overlap && o.start < q.end && q.start < o.end); }
        S.questions.push(q);
      }
      log('generate_done', { round, items: items.length, passagesFound: found, latencyMs: Date.now() - t0, stop: r.stop });
      msg.replaceChildren(found < items.length ? h('div', { class: 'hint', text: (items.length - found) + ' Frage(n) ohne auffindbare Textstelle (werden ohne Markierung gezeigt).' }) : '');
      gen.textContent = 'Weitere Fragen'; renderCards(); refreshThesis();
    } catch (e) { S.genRounds--; log('api_error', { where: 'generate', message: e.message }); msg.replaceChildren(h('div', { class: 'err', text: e.message + ' – bitte nochmals versuchen.' })); }
    finally { gen.disabled = false; }
  });
  ui.renderCards = renderCards;
  function renderCards() { body.replaceChildren(); ui.cards = {}; S.questions.forEach((q, i) => { const c = questionCard(q, i + 1); ui.cards[q.id] = c; body.append(c); }); updateCounts(); }
  renderCards();
  return h('section', { class: 'col' }, h('h2', { text: 'Fragen' }), h('div', { style: 'padding:10px 14px;border-bottom:1px solid var(--line)' }, h('div', { class: 'row' }, gen, h('span', { class: 'spacer' })), msg, counts), body);
}
function questionCard(q, n) {
  const card = h('div', { class: 'q' + (q.status !== 'open' ? ' done' : '') });
  const more = h('div', { class: 'more' });
  const setStatus = (s) => {
    const from = q.status; q.status = (q.status === s) ? 'open' : s; if (q.status !== 'dismissed') q.reason = ''; log('question_status', { questionId: q.id, from, to: q.status }); save();
    card.className = 'q' + (q.status !== 'open' ? ' done' : '') + (card.classList.contains('active') ? ' active' : ''); drawBtns(); drawMore(); ui.updateCounts && ui.updateCounts();
  };
  const btns = h('div', { class: 'btns' });
  const drawBtns = () => { btns.replaceChildren(h('button', { text: 'Im Chat vertiefen', onclick: () => { if (ui.chat && !ui.chat.busy) sendUserMessage('prompt', 'Ich möchte diese Frage vertiefen:\n«' + q.question + '»\n(Stelle in meiner Arbeit: «' + q.passage + '»)', 'question', q.id); } }),
    ...['discussed', 'later', 'dismissed'].map(s => h('button', { class: q.status === s ? 'active' : '', text: STATUS[s], onclick: () => setStatus(s) }))); };
  const drawMore = () => {
    more.replaceChildren(); if (q.status === 'open') return;
    if (q.status === 'dismissed') more.append(h('div', { class: 'chips' }, DISMISS_REASONS.map(r => h('button', { class: q.reason === r ? 'active' : '', text: r, onclick: () => { q.reason = q.reason === r ? '' : r; log('question_reason', { questionId: q.id, reason: q.reason }); save(); drawMore(); } }))));
    const ph = q.status === 'discussed' ? 'Wo / mit wem besprochen? (optional)' : q.status === 'later' ? 'Notiz (optional)' : 'Kurz begründen (optional)';
    more.append(h('textarea', { rows: 1, placeholder: ph, value: q.reasonText, onchange: (e) => { q.reasonText = e.target.value; log('question_note', { questionId: q.id, chars: q.reasonText.length }); save(); } }));
  };
  card.append(h('div', { class: 'small', text: 'Frage ' + n }), q.found && !q.overlap ? h('div', { class: 'cite', text: '«' + (q.passage.length > 160 ? q.passage.slice(0, 160) + '…' : q.passage) + '»', onclick: () => focusQuestion(q.id, 'mark') }) : h('div', { class: 'cite', text: q.found ? '(Stelle überlappt mit einer anderen Markierung) «' + q.passage.slice(0, 100) + '…»' : '(Keine Markierung möglich) «' + q.passage.slice(0, 100) + '»' }), h('div', { class: 'text', text: q.question }), btns, more);
  drawBtns(); drawMore(); return card;
}

// ---------- Paar-Teil: Reflection Map ----------
function renderPair(root) {
  root.append(header('pair', false));
  const cols = {}; const body = {};
  const map = h('div', { class: 'map' }, Object.keys(STATUS).map(k => { body[k] = h('div', { class: 'body' }); cols[k] = h('section', { class: 'col' }, h('h2', { text: STATUS[k] }), body[k]); return cols[k]; }));
  const draw = () => {
    Object.keys(body).forEach(k => body[k].replaceChildren());
    S.questions.forEach((q, i) => {
      if (!q.pairOrigStatus) q.pairOrigStatus = null;
      const card = h('div', { class: 'card' + (q.pairDiscussed ? ' taken' : '') });
      const sel = h('select', { style: 'width:auto;font-size:12px;padding:2px 4px' }, Object.keys(STATUS).map(k => h('option', { value: k, text: STATUS[k], selected: k === q.status })));
      sel.addEventListener('change', () => { const from = q.status; if (!q.pairOrigStatus) q.pairOrigStatus = from; q.status = sel.value; log('pair_status_change', { questionId: q.id, from, to: q.status }); save(); draw(); });
      const tk = h('button', { class: q.pairDiscussed ? 'active' : '', style: 'font-size:12px;padding:2px 8px', text: q.pairDiscussed ? 'Im Gespräch aufgegriffen ✓' : 'Im Gespräch aufgegriffen', onclick: () => { q.pairDiscussed = !q.pairDiscussed; log('pair_discussed', { questionId: q.id, value: q.pairDiscussed }); save(); draw(); } });
      card.append(...[h('div', { class: 'small', text: 'Frage ' + (i + 1) }), h('div', { style: 'font-weight:600;margin:2px 0 4px', text: q.question }),
        h('div', { class: 'small', text: '«' + (q.passage.length > 140 ? q.passage.slice(0, 140) + '…' : q.passage) + '»' }),
        q.reason ? h('div', {}, h('span', { class: 'tag', text: q.reason })) : null, q.reasonText ? h('div', { class: 'small', text: 'Notiz: ' + q.reasonText }) : null,
        q.pairOrigStatus ? h('div', { class: 'small', text: 'Ursprünglich: ' + STATUS[q.pairOrigStatus] }) : null,
        h('div', { class: 'row', style: 'margin-top:6px' }, tk, h('span', { class: 'spacer' }), sel)].filter(Boolean));
      body[q.status].append(card);
    });
    Object.keys(STATUS).forEach(k => { cols[k].querySelector('h2').textContent = STATUS[k] + ' (' + S.questions.filter(q => q.status === k).length + ')'; });
  };
  root.append(map); draw();
  if (!S.questions.length) root.append(h('div', { class: 'wrap' }, h('div', { class: 'warn', text: 'Auf diesem Gerät wurden keine Fragen erzeugt.' })));
}

// ---------- Pause / Ende ----------
function renderBreak(root, after) {
  const url = C.QUESTIONNAIRE && C.QUESTIONNAIRE['after_' + after]; const n = partNumber(after);
  root.append(h('div', { class: 'wrap' }, h('div', { class: 'box' }, h('h1', { text: 'Teil ' + n + ' beendet' }),
    h('p', { text: 'Bitte jetzt den Fragebogen zu diesem Teil ausfüllen. Danach geht es weiter.' }),
    url ? h('p', {}, h('a', { href: url, target: '_blank', rel: 'noopener', text: 'Fragebogen öffnen' })) : h('div', { class: 'warn', text: 'Kein Fragebogen-Link in config.js hinterlegt (QUESTIONNAIRE.after_' + after + ').' }),
    h('div', { class: 'row' }, h('button', { text: 'Log sichern (Zwischenstand)', onclick: () => doExport('teil' + n) }), h('button', { class: 'primary', text: 'Weiter', onclick: () => { log('break_continue', { after }); S.stepIdx++; enterStep(); save(); render(); if (curStep().kind === 'end' && !S.finalExported) { S.finalExported = true; doExport('final'); } } })))));
}
function renderEnd(root) {
  root.append(h('div', { class: 'wrap' }, h('div', { class: 'box' }, h('h1', { text: 'Fertig – danke!' }),
    h('p', { text: 'Das Log wurde automatisch als JSON-Datei heruntergeladen (Downloads-Ordner).' }),
    h('p', { class: 'hint', text: 'Versuchsleitung: Datei prüfen, dann alle lokalen Daten löschen. Falls kein Download erschien, hier nochmals herunterladen.' }),
    h('div', { class: 'row' }, h('button', { text: 'Log nochmals herunterladen', onclick: () => doExport('final') }),
      h('button', { text: 'Alle lokalen Daten auf diesem Gerät löschen', onclick: () => { if (confirm('Wirklich alles löschen? Nicht exportierte Daten sind danach weg.')) { localStorage.removeItem(LS_KEY); S = null; API_KEY = ''; render(); } } })))));
}

render();
})();