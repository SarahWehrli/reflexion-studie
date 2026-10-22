(() => {
'use strict';
const C = window.CONFIG;
const LS_KEY = 'reflexions-studie-session-v1';
const API_URL = 'https://api.mammouth.ai/v1/chat/completions';
const VISUAL_DB_NAME = 'reflexion-study-visual-files';
const MAX_VISUAL_BYTES = 18 * 1024 * 1024;
const STATUS = { open:'Open', later:'For later', discussed:'Discussed', dismissed:'Dismissed' };
const DISMISS_REASONS = ['Already considered', 'Question does not fit', 'Passage does not fit', 'Not relevant', 'Other'];

let API_KEY = '';       // Kept in memory only; never stored or logged
let S = null;           // Session state
let timerHandle = null;
let visualDbPromise = null;
let ui = {};            // References to current DOM elements

// ---------- Helpers ----------
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
function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { /* Storage full or blocked */ } }
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
function isPdfFile(file) { return file.type === 'application/pdf' || /\.pdf$/i.test(file.name); }
function visualFileMediaType(file) {
  if (isPdfFile(file)) return null;
  const byExtension = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
  const ext = file.name.split('.').pop().toLowerCase();
  return byExtension[ext] || (Object.values(byExtension).includes(file.type) ? file.type : null);
}
function openVisualDb() {
  if (!window.indexedDB) return Promise.reject(new Error('This browser cannot store visual files for the session.'));
  if (!visualDbPromise) visualDbPromise = new Promise((resolve, reject) => {
    const req = window.indexedDB.open(VISUAL_DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('files')) req.result.createObjectStore('files'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { visualDbPromise = null; reject(req.error || new Error('Could not open visual file storage.')); };
  });
  return visualDbPromise;
}
function visualDbRequest(mode, method, key, value) {
  return openVisualDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('files', mode); const store = tx.objectStore('files');
    const req = method === 'put' ? store.put(value, key) : method === 'get' ? store.get(key) : method === 'delete' ? store.delete(key) : store.clear();
    let result;
    if (method === 'get') req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('Could not access visual file storage.'));
    tx.onabort = () => reject(tx.error || new Error('Visual file storage was interrupted.'));
  }));
}
async function storeVisualFile(file, existingBytes) {
  if (file.size + (existingBytes || 0) > MAX_VISUAL_BYTES) throw new Error('Images must total no more than 18 MB per chat. Please compress the image or use text only.');
  const id = 'visual-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  await visualDbRequest('readwrite', 'put', id, file);
  return id;
}
async function deleteVisualFile(id) { if (id) await visualDbRequest('readwrite', 'delete', id); }
async function clearVisualFiles() { await visualDbRequest('readwrite', 'clear'); }
async function visualBlock(ref) {
  const file = await visualDbRequest('readonly', 'get', ref.id);
  if (!file) throw new Error('The visual file is no longer available in this browser. Please upload it again.');
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',').pop());
    reader.onerror = () => reject(reader.error || new Error('Could not read the visual file.')); reader.readAsDataURL(file);
  });
  return { type: 'image', source: { type: 'base64', media_type: ref.mediaType, data: dataUrl } };
}
function isImageRef(ref) { return !!(ref && ref.mediaType && ref.mediaType.startsWith('image/')); }
async function messageContent(text, attachment, extraVisual) {
  const blocks = []; const visual = [attachment && attachment.visual, extraVisual].find(isImageRef);
  if (visual) blocks.push(await visualBlock(visual));
  if (attachment && attachment.text) blocks.push({ type: 'text', text: '<document name="' + attachment.name + '">\n' + attachment.text + '\n</document>' });
  if (text) blocks.push({ type: 'text', text });
  if (!blocks.length) return '';
  return blocks.length === 1 && blocks[0].type === 'text' ? blocks[0].text : blocks;
}
function attachmentLabel(attachment) {
  const detail = isImageRef(attachment.visual) ? 'image' : attachment.pdf ? 'PDF text extracted, ' + attachment.chars + ' characters' : attachment.chars + ' characters';
  return '📎 ' + attachment.name + ' (' + detail + ')';
}

// ---------- API ----------
function apiError(status, msg) {
  const map = { 401: 'API key is invalid or missing.', 403: 'Access denied (check the key and permissions).', 404: 'Model not found (check MODEL in config.js).', 429: 'Rate limit or account quota reached.', 529: 'API is overloaded. Please try again shortly.' };
  const e = new Error((map[status] || ('API error ' + status)) + (msg ? ' (' + msg + ')' : ''));
  e.status = status; return e;
}
function mammouthContent(content) {
  if (typeof content === 'string') return content;
  const parts = (Array.isArray(content) ? content : []).flatMap(block => {
    if (block.type === 'text') return [block.text];
    if (block.type === 'image' && block.source && block.source.type === 'base64' && block.source.media_type.startsWith('image/')) {
      return [{ type: 'image_url', image_url: { url: 'data:' + block.source.media_type + ';base64,' + block.source.data } }];
    }
    return [];
  });
  if (parts.every(part => typeof part === 'string')) return parts.join('\n');
  return parts;
}
function reconstructAbstract(index) {
  if (!index) return '';
  const words = [];
  for (const [word, positions] of Object.entries(index)) for (const position of positions) words[position] = word;
  return words.filter(Boolean).join(' ');
}
async function searchOpenAlex(query, limit) {
  const url = new URL('https://api.openalex.org/works');
  url.searchParams.set('search', String(query).trim().slice(0, 300));
  url.searchParams.set('per-page', String(Math.max(1, Math.min(Number(limit) || 5, 5))));
  url.searchParams.set('select', 'id,doi,title,publication_year,authorships,primary_location,abstract_inverted_index');
  let response;
  try { response = await fetch(url); } catch (e) { throw new Error('OpenAlex search failed (network or CORS error).'); }
  if (!response.ok) throw new Error('OpenAlex search failed with HTTP ' + response.status + '.');
  const data = await response.json();
  const works = (data.results || []).map(work => ({
    title: work.title || 'Untitled',
    year: work.publication_year || null,
    authors: (work.authorships || []).map(item => item.author && item.author.display_name).filter(Boolean).slice(0, 4),
    venue: work.primary_location && work.primary_location.source ? work.primary_location.source.display_name : null,
    doi: work.doi || null,
    url: work.doi || (work.primary_location && work.primary_location.landing_page_url) || work.id,
    abstract: reconstructAbstract(work.abstract_inverted_index).slice(0, 3000),
    abstractAvailable: !!work.abstract_inverted_index
  }));
  return { query, works };
}
async function callMammouth({ system, messages, maxTokens, onDelta, onStatus, webSearch }) {
  if (!API_KEY) throw new Error('No API key in memory. Reload the page and enter the key.');
  const requestMessages = (system ? [{ role: 'system', content: mammouthContent(system) }] : [])
    .concat(messages.map(message => ({ role: message.role, content: mammouthContent(message.content) })));
  const tools = webSearch ? [{ type: 'function', function: {
    name: 'search_openalex',
    description: 'Search OpenAlex for published academic works. Call this only for Focus 2 (Consider Alternatives), when you need two published studies that made a decision comparable to the student\'s. Do not call it for clarifications, follow-ups, Focus 1 or Focus 3, or when studies for this decision were already shown.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Focused academic search phrase' }, limit: { type: 'integer', minimum: 1, maximum: 5 } }, required: ['query'], additionalProperties: false }
  } }] : [];
  const searches = []; const usage = { input: 0, output: 0, cache_read: 0, cache_write: 0, web_searches: 0 };
  let text = '', stop = null, toolCallCount = 0;
  for (;;) {
    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + API_KEY },
        body: JSON.stringify({ model: C.MODEL, max_tokens: maxTokens, messages: requestMessages, stream: true, stream_options: { include_usage: true }, ...(webSearch ? { tools, tool_choice: 'auto' } : {}) })
      });
    } catch (e) { throw new Error('Network error or blocked by the browser (CORS). See the "Local server" section in README.'); }
    if (!res.ok) { let m = ''; try { const j = await res.json(); m = (j.error && j.error.message) || ''; } catch (e) { /* ignorieren */ } throw apiError(res.status, m); }
    const reader = res.body.getReader(); const dec = new TextDecoder();
    let buf = '', roundText = '', roundStop = null; const pendingCalls = {};
    const readEvent = raw => {
      for (const line of raw.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim(); if (!data || data === '[DONE]') continue;
        let event; try { event = JSON.parse(data); } catch (e) { continue; }
        if (event.error) throw new Error('API stream error: ' + (event.error.message || 'unknown'));
        if (event.usage) { usage.input += event.usage.prompt_tokens || 0; usage.output += event.usage.completion_tokens || 0; }
        const choice = event.choices && event.choices[0]; if (!choice) continue;
        const delta = choice.delta || {};
        const before = roundText.length;
        if (typeof delta.content === 'string') roundText += delta.content;
        else if (Array.isArray(delta.content)) for (const part of delta.content) if (part.type === 'text') roundText += part.text || '';
        if (onDelta && roundText.length > before && roundText.trim()) onDelta(roundText.replace(/^\n+/, ''));
        for (const call of delta.tool_calls || []) {
          const item = pendingCalls[call.index] || (pendingCalls[call.index] = { id: '', type: 'function', function: { name: '', arguments: '' } });
          if (call.id) item.id = call.id;
          if (call.function && call.function.name) item.function.name += call.function.name;
          if (call.function && call.function.arguments) item.function.arguments += call.function.arguments;
        }
        if (choice.finish_reason) roundStop = choice.finish_reason;
      }
    };
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, idx); buf = buf.slice(idx + 2); readEvent(raw);
      }
    }
    if (buf.trim()) readEvent(buf);
    const calls = Object.keys(pendingCalls).sort((a, b) => Number(a) - Number(b)).map(index => pendingCalls[index]);
    stop = roundStop;
    if (!calls.length) { text = roundText; break; }
    if (!webSearch) throw new Error('The model requested an unavailable tool.');
    toolCallCount += calls.length;
    if (toolCallCount > 4) throw new Error('OpenAlex search limit reached for this response. Please ask a narrower question.');
    requestMessages.push({ role: 'assistant', content: roundText || null, tool_calls: calls });
    for (const call of calls) {
      if (!call.id || call.function.name !== 'search_openalex') throw new Error('The model requested an unsupported tool.');
      let args;
      try { args = JSON.parse(call.function.arguments || '{}'); } catch (e) { throw new Error('The model returned invalid OpenAlex search arguments.'); }
      if (typeof args.query !== 'string' || !args.query.trim()) throw new Error('OpenAlex search requires a non-empty query.');
      if (onStatus) onStatus('searching OpenAlex ...');
      const result = await searchOpenAlex(args.query, args.limit);
      searches.push({ query: result.query, works: result.works.map(({ abstract, ...work }) => work) });
      usage.web_searches++;
      requestMessages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ...result, note: 'OpenAlex metadata and indexed abstracts only; the full papers were not retrieved or read.' }) });
    }
    if (onStatus) onStatus('reading sources ...');
  }
  text = text.replace(/^\n+/, '');
  if (!text.trim()) throw new Error(stop === 'length' ? 'Empty response: the token limit was reached. Increase MAX_TOKENS in config.js.' : 'Empty response from the API (' + (stop || 'unknown') + ').');
  return { text, usage, stop, searches };
}
function systemBlocks(kind) {
  if (kind === 'baseline') return undefined; // Part 1: no system prompt
  const instr = kind === 'generate' ? C.PROMPT_TEXT + '\n\n' + C.GENERATE_INSTRUCTION : C.PROMPT_TEXT + '\n\n' + C.CHAT_INSTRUCTION;
  // Put the thesis first so calls share the same cached prefix.
  return [
    { type: 'text', text: '<student_thesis>\n' + S.thesis + '\n</student_thesis>', cache_control: { type: 'ephemeral' } },
    { type: 'text', text: instr }
  ];
}

// ---------- Find passages and parse questions ----------
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
  if (a < 0 || b <= a) throw new Error('The response did not contain a JSON array.');
  const arr = JSON.parse(text.slice(a, b + 1));
  return arr.filter(x => x && typeof x.question === 'string' && x.question.trim());
}

// ---------- Export ----------
async function buildExport() {
  const questionById = (id) => S.questions.find(q => q.id === id);
  const partSpecs = [
    { name: 'baseline', title: 'Free reflection' },
    { name: 'prompt', title: 'Prompt-guided reflection' },
    { name: 'pair', title: 'Pair discussion' }
  ];
  const parts = partSpecs.map(({ name, title }) => {
    const interactions = [];
    if (name !== 'pair') {
      S.chats[name].forEach(m => interactions.push({
        at: m.t, type: 'chat_message', role: m.role, content: m.content,
        ...(m.webSearches && m.webSearches.length ? { webSearches: m.webSearches } : {}),
        ...(m.source ? { source: m.source } : {}),
        ...(m.questionId ? { questionId: m.questionId } : {}),
        ...(m.attachment ? { attachment: { name: m.attachment.name, chars: m.attachment.chars, visualMediaType: m.attachment.visual ? m.attachment.visual.mediaType : null, text: S.includeThesis ? m.attachment.text : null } } : {})
      }));
    }
    if (name === 'prompt') {
      S.questions.forEach(q => interactions.push({
        at: q.createdAt, type: 'generated_question', questionId: q.id,
        question: q.question, passage: q.passage, category: q.type, round: q.round
      }));
    }
    const eventTypes = name === 'prompt'
      ? ['generate_start', 'focus', 'question_status', 'question_reason', 'question_note']
      : name === 'pair' ? ['pair_status_change', 'pair_discussed'] : [];
    S.events.filter(e => e.phase === name && eventTypes.includes(e.type)).forEach(e => {
      const question = questionById(e.data.questionId);
      interactions.push({
        at: e.t, type: e.type, data: e.data,
        ...(question ? { question: { id: question.id, text: question.question, passage: question.passage } } : {})
      });
    });
    interactions.sort((a, b) => a.at.localeCompare(b.at));
    return { part: partNumber(name), name, title, interactions };
  }).sort((a, b) => a.part - b.part);
  return {
    schema: 'reflexion-interaction-log-v1', exportedAt: nowIso(),
    participantId: S.id, parts
  };
}
async function doExport(label) {
  const data = await buildExport(); const d = new Date();
  const name = `${S.id}_log_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${label ? '_' + label : ''}.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  S.exportedAtEvents = S.events.length; log('export', { name }); S.exportedAtEvents = S.events.length; save();
}
window.addEventListener('beforeunload', (e) => { if (S && S.events && S.events.length > (S.exportedAtEvents || 0) + 1 && curStep() && curStep().kind !== 'setup') { e.preventDefault(); e.returnValue = ''; } });

// ---------- Rendering ----------
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
  const placeholder = /PLACEHOLDER/.test(C.PROMPT_TEXT);
  const f = { id: h('input', { value: q.get('id') || '', placeholder: 'e.g. P03' }), pair: h('input', { value: q.get('pair') || '', placeholder: 'e.g. Pair2' }),
    key: h('input', { type: 'password', placeholder: 'Mammouth API key', autocomplete: 'off' }),
    incl: h('input', { type: 'checkbox', style: 'width:auto' }) };
  const msg = h('div'); const info = (t, cls) => { msg.replaceChildren(h('div', { class: cls || 'hint', text: t })); };
  const testBtn = h('button', { text: 'Test key and connection', onclick: async () => {
    API_KEY = f.key.value.trim(); if (!API_KEY) return info('Enter the API key first.', 'err');
    info('Testing ...'); try { await callMammouth({ system: 'Reply only with the word ok.', messages: [{ role: 'user', content: 'Test' }], maxTokens: 8000 }); info('Connection successful (Mammouth API and model).', 'hint'); } catch (e) { info(e.message, 'err'); }
  } });
  const start = h('button', { class: 'primary', text: 'Start session', onclick: async () => {
    API_KEY = f.key.value.trim(); const id = f.id.value.trim();
    if (!id) return info('Enter the participant ID.', 'err'); if (!API_KEY) return info('Enter the API key.', 'err');
    S = { v: 1, id, pairId: f.pair.value.trim(), order: 'AB', thesis: '', thesisVisual: null, includeThesis: f.incl.checked, steps: buildSteps('AB'), stepIdx: 0, startedMs: Date.now(), phaseTimes: {}, events: [], chats: { baseline: [], prompt: [] }, questions: [], usage: [], genRounds: 0 };
    log('session_start', { model: C.MODEL, promptVersion: C.PROMPT_VERSION, order: S.order, placeholderPrompt: placeholder }); enterStep(); render();
  } });
  const resume = saved && saved.events ? h('div', { class: 'warn' }, h('b', { text: 'Saved session found: ' + saved.id }), h('div', { class: 'small', text: 'Step ' + (saved.stepIdx + 1) + ' of ' + saved.steps.length + '. Enter the API key above to resume.' }),
    h('div', { class: 'row', style: 'margin-top:6px' },
      h('button', { text: 'Resume', onclick: () => { API_KEY = f.key.value.trim(); if (!API_KEY) return info('Enter the API key.', 'err'); S = saved; log('session_resume'); render(); } }),
      h('button', { text: 'Discard', onclick: async () => { if (confirm('Delete the saved session? Any data not exported will be lost.')) { localStorage.removeItem(LS_KEY); await clearVisualFiles().catch(() => {}); render(); } } }))) : null;
  root.append(h('div', { class: 'wrap' }, h('div', { class: 'box' },
    h('h1', { text: 'Reflection Study' }),
    placeholder ? h('div', { class: 'warn', text: 'Warning: The placeholder prompt is still active in config.js.' }) : null,
    resume,
    h('label', {}, 'Participant ID'), f.id, h('label', {}, 'Pair ID (optional)'), f.pair,
    h('label', {}, 'API key ', h('span', { class: 'hint', text: '(kept in memory only; never stored or logged)' })), f.key,
    h('label', { style: 'font-weight:400;display:flex;gap:8px;align-items:center' }, f.incl, 'Include uploaded/pasted thesis text in the exported log (otherwise only the filename and length are saved)'),
    h('div', { class: 'row', style: 'margin-top:14px' }, testBtn, start), msg)));
}
function buildSteps(order) {
  const seq = order === 'AB' ? ['baseline', 'prompt'] : ['prompt', 'baseline'];
  return [{ kind: 'phase', name: seq[0] }, { kind: 'break', after: seq[0] }, { kind: 'phase', name: seq[1] }, { kind: 'break', after: seq[1] }, { kind: 'phase', name: 'pair' }, { kind: 'break', after: 'pair' }, { kind: 'end' }];
}
function enterStep() {
  const st = curStep();
  if (st.kind !== 'phase') return;
  let t = S.phaseTimes[st.name];
  if (!t) { t = S.phaseTimes[st.name] = { start: nowIso(), startMs: Date.now(), elapsedMs: 0, end: null }; log('phase_start', { name: st.name }); }
  else if (t.end || !t.startMs) { t.elapsedMs = t.elapsedMs ?? (t.durationSec || 0) * 1000; t.startMs = Date.now(); t.end = null; log('phase_resume', { name: st.name }); }
}
function endPhase(name) {
  if ((ui.chat && ui.chat.busy) || ui.generating) { alert('Please wait until the current AI request has finished.'); return; }
  const t = S.phaseTimes[name];
  if (t && !t.end) {
    if (t.startMs) { t.elapsedMs = (t.elapsedMs || 0) + Date.now() - t.startMs; t.startMs = null; }
    t.end = nowIso(); t.durationSec = Math.round((t.elapsedMs || 0) / 1000);
  }
  log('phase_end', { name, durationSec: t && t.durationSec }); S.stepIdx++; enterStep(); save(); render();
}
function goBack() {
  if (S.stepIdx <= 0) return;
  if ((ui.chat && ui.chat.busy) || ui.generating) { alert('Please wait until the current AI request has finished.'); return; }
  const st = curStep();
  if (st.kind === 'phase') {
    const t = S.phaseTimes[st.name];
    if (t && t.startMs) { t.elapsedMs = (t.elapsedMs || 0) + Date.now() - t.startMs; t.startMs = null; log('phase_pause', { name: st.name }); }
  }
  S.stepIdx--; enterStep(); save(); render();
}
function loadScript(src) { return new Promise((res, rej) => { const s = h('script', { src }); s.onload = res; s.onerror = () => rej(new Error('Could not load script')); document.head.append(s); }); }
async function readFileText(file) { return isPdfFile(file) ? loadPdfText(file) : visualFileMediaType(file) ? '' : file.text(); }
function pdfStatus(chars) { return 'PDF text extracted (' + chars + ' characters). Figures and layout are not included.'; }
async function loadPdfText(file) {
  const base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  if (!window.pdfjsLib) await loadScript(base + 'pdf.min.js');
  const w = await (await fetch(base + 'pdf.worker.min.js')).text();
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([w], { type: 'text/javascript' }));
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise; const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) { const c = await (await pdf.getPage(n)).getTextContent(); let t = ''; for (const it of c.items) { t += it.str + (it.hasEOL ? '\n' : ' '); } pages.push(t.replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ').trim()); }
  return pages.join('\n\n');
}

// ---------- Header and timer ----------
function header(name, withTimer) {
  const t = S.phaseTimes[name]; const limit = C.PHASE_MINUTES * 60000;
  const timer = h('span', { class: 'timer' });
  const tick = () => { if (!t) return; const el = (t.elapsedMs || 0) + (t.startMs ? Date.now() - t.startMs : 0); timer.textContent = withTimer ? fmtClock(el) + ' / ' + C.PHASE_MINUTES + ':00' : fmtClock(el); timer.classList.toggle('over', withTimer && el > limit); if (withTimer && el > limit && !S.overtimeLogged?.[name]) { (S.overtimeLogged = S.overtimeLogged || {})[name] = true; log('time_limit_reached', { name }); } };
  tick(); timerHandle = setInterval(tick, 1000);
  return h('header', { class: 'top' }, h('h1', { text: 'Part ' + partNumber(name) + (name === 'pair' ? ': Pair discussion' : ': Reflection with AI') }), h('span', { class: 'small', text: 'ID ' + S.id }), h('span', { class: 'spacer' }), timer,
    S.stepIdx > 0 ? h('button', { text: 'Back', onclick: goBack }) : null,
    h('button', { text: 'End part', onclick: () => { if (confirm('End this part now?')) endPhase(name); } }));
}

// ---------- Chat parts (baseline / prompt) ----------
function renderChatPhase(root, name) {
  const isPrompt = name === 'prompt';
  root.append(header(name, true));
  if (!isPrompt) { root.append(h('div', { class: 'grid one' }, chatColumn(name))); return; }
  if (!S.thesis) return renderThesisLoad(root);
  const thesisBody = h('div', { class: 'body' }, h('div', { class: 'thesis', id: 'thesis' }));
  const cols = [h('section', { class: 'col' }, h('h2', { text: 'Your thesis' }), thesisBody)];
  if (isPrompt) cols.push(questionsColumn());
  cols.push(chatColumn(name));
  root.append(h('div', { class: 'grid three' }, cols));
  ui.thesisEl = thesisBody.firstChild; refreshThesis();
}
function renderThesisLoad(root) {
  const ta = h('textarea', { rows: 12, placeholder: 'Paste your thesis text here ...' }); const file = h('input', { type: 'file', accept: '.txt,.md,.pdf,.png,.jpg,.jpeg,.gif,.webp' }); const msg = h('div'); let src = 'paste', fname = '', visual = S.thesisVisual || null;
  file.addEventListener('change', async () => { const f = file.files[0]; if (!f) return; msg.replaceChildren(h('div', { class: 'hint', text: 'Reading file ...' }));
    try {
      const mediaType = visualFileMediaType(f); const text = await readFileText(f); const id = mediaType ? await storeVisualFile(f, 0) : null;
      const nextVisual = id ? { id, name: f.name, mediaType, bytes: f.size } : null;
      if (visual && visual.id !== (nextVisual && nextVisual.id)) await deleteVisualFile(visual.id).catch(() => {});
      visual = nextVisual; S.thesisVisual = visual; save(); ta.value = text; src = 'upload'; fname = f.name;
      const status = visual ? 'Image ready for AI analysis. Paste the thesis text below.' : isPdfFile(f) ? pdfStatus(text.length) : 'File loaded (' + text.length + ' characters).';
      msg.replaceChildren(h('div', { class: 'hint', text: status }));
    } catch (e) { msg.replaceChildren(h('div', { class: 'err', text: 'Could not read or store file (' + e.message + '). Please paste the text instead.' })); } });
  root.append(h('div', { class: 'wrap' }, h('div', { class: 'box' }, h('h1', { text: 'New chat: Add your thesis' }),
    h('p', { class: 'hint', text: 'This is a new chat. The AI does not know anything from the previous part. Upload your thesis or paste the text you want to reflect on.' }),
    h('p', { class: 'hint', text: 'Only the text of a PDF is extracted in the browser; figures and layout are not included. Images are sent for visual analysis when supported by the selected model.' }),
    isImageRef(visual) ? h('div', { class: 'hint', text: 'Visual file ready: ' + visual.name }) : null,
    file, h('div', { style: 'height:8px' }), ta, msg,
    h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'primary', text: 'Continue', onclick: async () => { const t = ta.value.trim(); if (t.length < 200) { msg.replaceChildren(h('div', { class: 'err', text: 'The text is missing or very short.' })); return; }
      S.thesis = t; S.thesisVisual = visual; log('thesis_loaded', { source: src === 'upload' && t === ta.value.trim() ? 'upload' : 'paste', fileName: fname, chars: t.length, hash: await hashText(t), visualMediaType: visual ? visual.mediaType : null }); save(); render(); } })))));
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
  const list = h('div', { class: 'body' }); const input = h('textarea', { rows: 2, placeholder: 'Write a message ... (Enter to send, Shift+Enter for a new line)' });
  const send = h('button', { class: 'primary', text: 'Send' });
  ui.chat = { name, list, input, send, busy: false, pending: null };
  const addMsg = (m) => { const el = h('div', { class: 'msg ' + m.role }, m.attachment ? h('div', {}, h('span', { class: 'att', text: attachmentLabel(m.attachment) })) : null, m.content); list.append(el); list.scrollTop = list.scrollHeight; return el; };
  ui.chat.addMsg = addMsg; S.chats[name].forEach(addMsg);
  const chip = h('span', { class: 'small' }); const fileIn = h('input', { type: 'file', accept: '.txt,.md,.pdf,.png,.jpg,.jpeg,.gif,.webp', style: 'display:none' });
  const attBtn = name === 'baseline' ? h('button', { title: 'Attach a file', text: '📎', onclick: () => fileIn.click() }) : null;
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; fileIn.value = ''; if (!f) return;
    const previous = ui.chat.pending; ui.chat.pending = null; if (previous && previous.visual) deleteVisualFile(previous.visual.id).catch(() => {});
    chip.textContent = 'Reading ' + f.name + ' ...';
    try {
      const mediaType = visualFileMediaType(f); const existingBytes = S.chats[name].reduce((total, m) => total + (m.attachment && m.attachment.visual ? m.attachment.visual.bytes || 0 : 0), 0);
      const text = (await readFileText(f)).trim(); const id = mediaType ? await storeVisualFile(f, existingBytes) : null;
      const attachment = { name: f.name, chars: text.length, text, ...(isPdfFile(f) ? { pdf: true } : {}), ...(id ? { visual: { id, name: f.name, mediaType, bytes: f.size } } : {}) };
      ui.chat.pending = attachment;
      chip.replaceChildren(h('span', { class: 'att', text: attachmentLabel(attachment) }), ' ', h('button', { style: 'padding:0 6px;font-size:12px', text: '×', onclick: async () => { ui.chat.pending = null; if (attachment.visual) await deleteVisualFile(attachment.visual.id).catch(() => {}); chip.textContent = ''; } }));
    } catch (e) { chip.textContent = 'Could not read or store file: ' + e.message; }
  });
  const doSend = () => { const t = input.value.trim(); const att = ui.chat.pending; if ((!t && !att) || ui.chat.busy) return; input.value = ''; ui.chat.pending = null; chip.textContent = ''; sendUserMessage(name, t, 'typed', null, att); };
  send.addEventListener('click', doSend); input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } });
  const hint = name === 'baseline' ? h('div', { class: 'hint', style: 'padding:10px 14px;border-bottom:1px solid var(--line);font-size:14px', text: 'Use this chat as you normally would to reflect on your thesis with an AI chat. You can think about the whole thesis or individual parts, ask questions, examine your ideas, or discuss uncertainties. Choose for yourself what to discuss and how. Upload your thesis with 📎 (.pdf, .txt, .md, .png, .jpg, .jpeg, .gif, .webp) or paste the relevant text. Only the text of a PDF is extracted in the browser; figures and layout are not included. Supported image files are sent for visual analysis.' }) : null;
  return h('section', { class: 'col' }, ...[h('h2', { text: 'Chat' }), hint, list, name === 'baseline' ? h('div', { style: 'padding:0 10px' }, chip, fileIn) : null, h('div', { class: 'composer' }, ...[attBtn, input, send].filter(Boolean))].filter(Boolean));
}
function setBusy(b) { ui.chat.busy = b; ui.chat.send.disabled = b; ui.chat.input.disabled = b; }
function sendUserMessage(name, text, source, questionId, attachment) {
  const msg = { role: 'user', content: text, t: nowIso(), source: source || 'typed', questionId: questionId || null };
  if (attachment) msg.attachment = attachment;
  S.chats[name].push(msg); log('chat_user', { chars: text.length, source: msg.source, questionId: msg.questionId, attachment: attachment ? { name: attachment.name, chars: attachment.chars, visualMediaType: attachment.visual ? attachment.visual.mediaType : null } : null }); ui.chat.addMsg(msg); runAssistant(name);
}
async function runAssistant(name) {
  const chat = ui.chat; setBusy(true); chat.list.querySelectorAll('.err').forEach(e => e.remove());
  const el = h('div', { class: 'msg assistant', text: '…' }); chat.list.append(el); chat.list.scrollTop = chat.list.scrollHeight;
  const t0 = Date.now();
  try {
    const messages = []; let thesisVisualSent = false;
    for (const m of S.chats[name]) {
      let extraVisual = null;
      if (name === 'prompt' && m.role === 'user' && !thesisVisualSent && S.thesisVisual) { extraVisual = S.thesisVisual; thesisVisualSent = true; }
      messages.push({ role: m.role, content: await messageContent(m.content, m.attachment, extraVisual) });
    }
    const r = await callMammouth({ system: systemBlocks(name === 'baseline' ? 'baseline' : 'chat'), messages, maxTokens: C.MAX_TOKENS_CHAT, webSearch: name === 'prompt' && !!(C.WEB_SEARCH && C.WEB_SEARCH.prompt), onStatus: (s) => { el.textContent = '… ' + s; }, onDelta: (t) => { el.textContent = t; chat.list.scrollTop = chat.list.scrollHeight; } });
    const msg = { role: 'assistant', content: r.text, t: nowIso(), latencyMs: Date.now() - t0, stop: r.stop, webSearches: r.searches }; S.chats[name].push(msg);
    S.usage.push({ t: msg.t, kind: 'chat_' + name, ...r.usage }); log('chat_assistant', { chars: r.text.length, latencyMs: msg.latencyMs, stop: r.stop, webSearches: r.searches });
  } catch (e) {
    el.remove(); log('api_error', { where: 'chat', message: e.message });
    chat.list.append(h('div', { class: 'err' }, e.message + ' ', h('button', { text: 'Try again', onclick: () => runAssistant(name) }))); chat.list.scrollTop = chat.list.scrollHeight;
  } finally { setBusy(false); chat.input.focus(); }
}

// ---------- Questions column (prompt part) ----------
function questionsColumn() {
  const body = h('div', { class: 'body' }); const counts = h('div', { class: 'small' }); const msg = h('div');
  const gen = h('button', { class: 'primary', text: S.questions.length ? 'Generate more questions' : 'Mark passages & generate questions' });
  ui.cards = {}; ui.qBody = body;
  const updateCounts = () => { const c = { open: 0, later: 0, discussed: 0, dismissed: 0 }; S.questions.forEach(q => c[q.status]++); counts.textContent = Object.keys(STATUS).map(k => STATUS[k] + ' ' + c[k]).join(' · '); };
  ui.updateCounts = updateCounts;
  gen.addEventListener('click', async () => {
    gen.disabled = true; ui.generating = true; msg.replaceChildren(h('div', { class: 'hint', text: 'The AI is reading your thesis ... this may take a moment.' })); const t0 = Date.now(); const round = ++S.genRounds;
    const already = S.questions.map(q => '- ' + q.passage.slice(0, 120)).join('\n');
    const userMsg = round === 1 ? 'Please identify relevant passages in my thesis and ask reflection questions about them.' : 'Please identify additional relevant passages that have not been covered yet and ask reflection questions about them. Passages already used:\n' + already;
    log('generate_start', { round });
    try {
      const r = await callMammouth({ system: systemBlocks('generate'), messages: [{ role: 'user', content: await messageContent(userMsg, null, S.thesisVisual) }], maxTokens: C.MAX_TOKENS_GENERATE });
      S.usage.push({ t: nowIso(), kind: 'generate', ...r.usage }); let items;
      try { items = parseQuestions(r.text); } catch (e) { throw r.stop === 'length' ? new Error('The response was cut off because the token limit was reached. Increase MAX_TOKENS_GENERATE in config.js.') : e; }
      let found = 0;
      for (const it of items) {
        const loc = locate(S.thesis, it.passage); const q = { id: 'q' + (S.questions.length + 1), round, passage: String(it.passage || ''), question: it.question.trim(), type: String(it.type || ''), found: !!loc, start: loc ? loc[0] : null, end: loc ? loc[1] : null, overlap: false, status: 'open', reason: '', reasonText: '', createdAt: nowIso() };
        if (loc) { found++; q.overlap = S.questions.some(o => o.found && !o.overlap && o.start < q.end && q.start < o.end); }
        S.questions.push(q);
      }
      log('generate_done', { round, items: items.length, passagesFound: found, latencyMs: Date.now() - t0, stop: r.stop });
      msg.replaceChildren(found < items.length ? h('div', { class: 'hint', text: (items.length - found) + ' question(s) without a matching passage (shown without a highlight).' }) : '');
      gen.textContent = 'Generate more questions'; renderCards(); refreshThesis();
    } catch (e) { S.genRounds--; log('api_error', { where: 'generate', message: e.message }); msg.replaceChildren(h('div', { class: 'err', text: e.message + ' - please try again.' })); }
    finally { gen.disabled = false; ui.generating = false; }
  });
  ui.renderCards = renderCards;
  function renderCards() { body.replaceChildren(); ui.cards = {}; S.questions.forEach((q, i) => { const c = questionCard(q, i + 1); ui.cards[q.id] = c; body.append(c); }); updateCounts(); }
  renderCards();
  return h('section', { class: 'col' }, h('h2', { text: 'Questions' }), h('div', { style: 'padding:10px 14px;border-bottom:1px solid var(--line)' },
    h('p', { class: 'hint', text: 'The goal is to reflect on your thesis and the decisions you have made. Generate questions about relevant passages, discuss them in the chat, mark them as "Discussed" or "For later", or dismiss them with a suitable reason.' }),
    h('div', { class: 'row' }, gen, h('span', { class: 'spacer' })), msg, counts), body);
}
function questionCard(q, n) {
  const card = h('div', { class: 'q' + (q.status !== 'open' ? ' done' : '') });
  const more = h('div', { class: 'more' });
  const setStatus = (s) => {
    const from = q.status; q.status = (q.status === s) ? 'open' : s; if (q.status !== 'dismissed') q.reason = ''; log('question_status', { questionId: q.id, from, to: q.status }); save();
    card.className = 'q' + (q.status !== 'open' ? ' done' : '') + (card.classList.contains('active') ? ' active' : ''); drawBtns(); drawMore(); ui.updateCounts && ui.updateCounts();
  };
  const btns = h('div', { class: 'btns' });
  const drawBtns = () => { btns.replaceChildren(h('button', { text: 'Discuss in chat', onclick: () => { if (ui.chat && !ui.chat.busy) sendUserMessage('prompt', 'I would like to explore this question further:\n"' + q.question + '"\n(Passage from my thesis: "' + q.passage + '")', 'question', q.id); } }),
    ...['discussed', 'later', 'dismissed'].map(s => h('button', { class: q.status === s ? 'active' : '', text: STATUS[s], onclick: () => setStatus(s) }))); };
  const drawMore = () => {
    more.replaceChildren(); if (q.status === 'open') return;
    if (q.status === 'dismissed') more.append(h('div', { class: 'chips' }, DISMISS_REASONS.map(r => h('button', { class: q.reason === r ? 'active' : '', text: r, onclick: () => { q.reason = q.reason === r ? '' : r; log('question_reason', { questionId: q.id, reason: q.reason }); save(); drawMore(); } }))));
    const ph = q.status === 'discussed' ? 'Where / with whom did you discuss it? (optional)' : q.status === 'later' ? 'Note (optional)' : 'Brief reason (optional)';
    more.append(h('textarea', { rows: 1, placeholder: ph, value: q.reasonText, onchange: (e) => { q.reasonText = e.target.value; log('question_note', { questionId: q.id, chars: q.reasonText.length, text: q.reasonText }); save(); } }));
  };
  card.append(h('div', { class: 'small', text: 'Question ' + n }), q.found && !q.overlap ? h('div', { class: 'cite', text: '"' + (q.passage.length > 160 ? q.passage.slice(0, 160) + '...' : q.passage) + '"', onclick: () => focusQuestion(q.id, 'mark') }) : h('div', { class: 'cite', text: q.found ? '(Passage overlaps with another highlight) "' + q.passage.slice(0, 100) + '..."' : '(Could not highlight passage) "' + q.passage.slice(0, 100) + '"' }), h('div', { class: 'text', text: q.question }), btns, more);
  drawBtns(); drawMore(); return card;
}

// ---------- Pair part: reflection map ----------
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
      const tk = h('button', { class: q.pairDiscussed ? 'active' : '', style: 'font-size:12px;padding:2px 8px', text: q.pairDiscussed ? 'Discussed ✓' : 'Discussed', onclick: () => { q.pairDiscussed = !q.pairDiscussed; log('pair_discussed', { questionId: q.id, value: q.pairDiscussed }); save(); draw(); } });
      card.append(...[h('div', { class: 'small', text: 'Question ' + (i + 1) }), h('div', { style: 'font-weight:600;margin:2px 0 4px', text: q.question }),
        h('div', { class: 'small', text: '"' + (q.passage.length > 140 ? q.passage.slice(0, 140) + '...' : q.passage) + '"' }),
        q.reason ? h('div', {}, h('span', { class: 'tag', text: q.reason })) : null, q.reasonText ? h('div', { class: 'small', text: 'Note: ' + q.reasonText }) : null,
        q.pairOrigStatus ? h('div', { class: 'small', text: 'Originally: ' + STATUS[q.pairOrigStatus] }) : null,
        h('div', { class: 'row', style: 'margin-top:6px' }, tk, h('span', { class: 'spacer' }), sel)].filter(Boolean));
      body[q.status].append(card);
    });
    Object.keys(STATUS).forEach(k => { cols[k].querySelector('h2').textContent = STATUS[k] + ' (' + S.questions.filter(q => q.status === k).length + ')'; });
  };
  root.append(map); draw();
  if (!S.questions.length) root.append(h('div', { class: 'wrap' }, h('div', { class: 'warn', text: 'No questions were generated on this device.' })));
}

// ---------- Break / end ----------
function renderBreak(root, after) {
  const url = C.QUESTIONNAIRE && C.QUESTIONNAIRE['after_' + after]; const n = partNumber(after);
  const hasQuestionnaire = after !== 'pair' && url;
  const nextStepHint = after === 'pair'
    ? 'Continue to finish the study.'
    : after === 'prompt'
      ? 'Please complete the questionnaire for this part first, then contact me. After that, click "Continue" to begin Part 3.'
    : 'Please complete the questionnaire for this part first. Then return here and click "Continue" to begin the next part.';
  root.append(h('div', { class: 'wrap' }, h('div', { class: 'box' }, h('h1', { text: 'Part ' + n + ' complete' }),
    h('p', { text: nextStepHint }),
    hasQuestionnaire ? h('p', {}, h('a', { href: url, target: '_blank', rel: 'noopener', text: 'Open questionnaire' })) : after === 'pair' ? null : h('div', { class: 'warn', text: 'No questionnaire link configured in config.js (QUESTIONNAIRE.after_' + after + ').' }),
    h('div', { class: 'row' }, h('button', { text: 'Back', onclick: goBack }), h('button', { class: 'primary', text: 'Continue', onclick: () => { log('break_continue', { after }); S.stepIdx++; enterStep(); save(); render(); if (curStep().kind === 'end' && !S.finalExported) { S.finalExported = true; doExport('final'); } } })))));
}
function renderEnd(root) {
  root.append(h('div', { class: 'wrap' }, h('div', { class: 'box' }, h('h1', { text: 'Complete - thank you!' }),
    h('p', { text: 'A short interview with the researcher will follow now.' }),
    h('p', { text: 'The log was automatically downloaded as a JSON file to your Downloads folder.' }),
    h('p', { class: 'hint', text: 'Researcher: check the file, then delete all local data. If the download did not appear, download it again here.' }),
    h('div', { class: 'row' }, h('button', { text: 'Back', onclick: goBack }), h('button', { text: 'Download log again', onclick: () => doExport('final') }),
      h('button', { text: 'Delete all local data on this device', onclick: async () => { if (confirm('Delete everything? Any data not exported will be lost.')) { localStorage.removeItem(LS_KEY); await clearVisualFiles().catch(() => {}); S = null; API_KEY = ''; render(); } } })))));
}

render();
})();