// AF3x Input Generator — page logic.
//
// The page is the state. collect() reads it into a model (see af_json.js);
// refresh() validates the model, marks problems, redraws the diagram and the
// sequence views, rebuilds the JSON and autosaves it.

import { CROSSLINKERS, PTM_DATABASE, XL_GROUP_COLORS, XL_DASH_PATTERNS } from './data.js';
import { drawArcDiagram } from './viz.js';
import { openImportModal, initImportModal, shortProteinName } from './csv_import.js';
import { openPdbModal, initPdbModal, extractAtomSequences, buildTemplate } from './pdb_import.js';
import { openInteractiveTopology, initInteractiveTopology } from './topology_interactive.js';
import {
  esc, readFileText, plural, cleanSeq, ALPHABET, parseFasta, shortHeader, guessSeqType, parseUniprotIds, fetchUniprot,
  sniffFile, validateA3m, needlemanWunsch, alignmentToMapping, parseIntList, formatRanges, parseRanges,
} from './util.js';
import { findXl, checkPair, validate, toJson, detectJsonDialect, convertServerJson, sanitisedName } from './af_json.js';
import { toast, openMenu, openPopover, closePopover, showModal, hideModal, initModals, anyModalOpen, initDropdowns, syncDropdowns } from './ui.js';

const $ = id => document.getElementById(id);

const LS_STATE = 'af3x_autosave';
const LS_THEME = 'af3x_theme';
const LS_JSON_OPEN = 'af3x_json_open';
const TYPE_LABEL = { protein: 'Protein', rna: 'RNA', dna: 'DNA', ligand: 'Ligand' };
const UNIT = { protein: 'aa', rna: 'nt', dna: 'nt' };
const SEQ_PLACEHOLDER = {
  protein: 'Paste sequence, FASTA or UniProt ID',
  rna: 'Paste RNA sequence or FASTA',
  dna: 'Paste DNA sequence or FASTA',
};

let uid = 0;
let pending = null;    // residue action in progress: { kind: 'xl'|'ss'|'mod', card, pos, ccd, target }
let activeXl = null;   // crosslinker group that receives clicked pairs
let seedMode = 'count';
let version = 4;
let current = { model: null, issues: [], json: null };
let nagged = false;    // Download was pressed while blocked: empty required fields are marked too

const ICON = {
  edit: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.5 2.5l2 2L5 13l-2.7.7L3 11z"/></svg>',
  more: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="13" cy="8" r="1.4"/></svg>',
  grip: '<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true"><circle cx="2.5" cy="2.5" r="1.2"/><circle cx="7.5" cy="2.5" r="1.2"/><circle cx="2.5" cy="7" r="1.2"/><circle cx="7.5" cy="7" r="1.2"/><circle cx="2.5" cy="11.5" r="1.2"/><circle cx="7.5" cy="11.5" r="1.2"/></svg>',
  x: '<svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><path d="M1 1l6 6M7 1 1 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
};

// ─── Refresh loop ────────────────────────────────────────────────────────────

let _dirty = false;

/** Schedule one refresh for the next frame. */
function touch() {
  if (_dirty) return;
  _dirty = true;
  requestAnimationFrame(refresh);
}

function refresh() {
  _dirty = false;
  const model = collect();
  const issues = validate(model);
  const json = toJson(model);
  current = { model, issues, json };
  annotate(model, issues);
  renderIssues(issues);
  renderJson();
  renderSeqViews(model);
  drawDiagram(model);
  syncSections(model);
  syncDropdowns();
  scheduleSave();
}

// ─── Chains ──────────────────────────────────────────────────────────────────

const CHAIN_HTML = `
  <div class="chain-head">
    <span class="grip" title="Drag to reorder">${ICON.grip}</span>
    <input class="chain-id" maxlength="4" spellcheck="false" autocomplete="off" aria-label="Chain ID" title="Chain ID">
    <button class="chain-type" title="Change type"></button>
    <input class="chain-label" placeholder="name" spellcheck="false" autocomplete="off" aria-label="Chain name" title="Name (optional)">
    <span class="chain-len"></span>
    <span class="chain-tools">
      <button class="icon-btn chain-edit" title="Edit sequence" aria-label="Edit sequence">${ICON.edit}</button>
      <button class="icon-btn chain-more" title="Modifications, MSA, templates, duplicate" aria-label="Chain options" aria-haspopup="menu">${ICON.more}</button>
      <button class="icon-btn chain-del" title="Remove chain" aria-label="Remove chain">×</button>
    </span>
  </div>
  <div class="chain-body">
    <div class="seq-wrap">
      <pre class="seq-view" hidden></pre>
      <textarea class="seq-edit" rows="2" spellcheck="false" autocomplete="off"></textarea>
    </div>
    <div class="seq-msg" hidden></div>
    <div class="lig-row" hidden>
      <div class="seg lig-kind"><button data-v="ccd" class="on">CCD</button><button data-v="smiles">SMILES</button></div>
      <input class="lig-input" spellcheck="false" autocomplete="off">
    </div>
  </div>
  <div class="chain-opts">
    <div class="opt opt-mods" hidden>
      <span class="opt-name">Modifications</span>
      <span class="chips"></span>
      <button class="chip chip-add" title="Add modification" aria-label="Add modification">+</button>
    </div>
    <div class="opt opt-msa" hidden>
      <span class="opt-name">MSA</span>
      <div class="seg" data-seg="msa"><button data-v="auto" title="AF3 searches the databases">Auto</button><button data-v="none" title="Run without an MSA">None</button><button data-v="custom" title="Use your own A3M">Custom</button></div>
      <button class="icon-btn opt-x" title="Back to automatic" aria-label="Back to automatic">×</button>
      <div class="opt-body" data-body="msa" hidden>
        <div class="file-row" data-slot="unpaired">
          <span class="file-name">Unpaired</span>
          <input class="msa-path" placeholder="path to .a3m on the machine that runs AF3x" spellcheck="false">
          <label class="btn sm" title="Store the file in the JSON">Upload<input type="file" accept=".a3m,.txt,.fasta" hidden></label>
        </div>
        <div class="file-row" data-slot="paired">
          <span class="file-name">Paired</span>
          <input class="msa-path" placeholder="optional" spellcheck="false">
          <label class="btn sm" title="Store the file in the JSON">Upload<input type="file" accept=".a3m,.txt,.fasta" hidden></label>
        </div>
        <div class="opt-msg" hidden></div>
      </div>
    </div>
    <div class="opt opt-tpl" hidden>
      <span class="opt-name">Templates</span>
      <div class="seg" data-seg="tpl"><button data-v="auto" title="AF3 searches the PDB">Auto</button><button data-v="none" title="Run without templates">None</button><button data-v="custom" title="Use your own structures">Custom</button></div>
      <button class="icon-btn opt-x" title="Back to automatic" aria-label="Back to automatic">×</button>
      <div class="opt-body" data-body="tpl" hidden>
        <div class="tpl-list"></div>
        <button class="btn add sm add-tpl">+ Template</button>
      </div>
    </div>
  </div>`;

const chainCards = () => [...$('chains').querySelectorAll('.chain')];
const cardId = card => card.querySelector('.chain-id').value.trim();
const cardByChainId = id => chainCards().find(c => cardId(c) === id) || null;

function intToId(i) {
  let s = '';
  for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

function nextChainId() {
  const used = new Set(chainCards().map(cardId));
  for (let i = 0; ; i++) if (!used.has(intToId(i))) return intToId(i);
}

/**
 * Add a chain card. d: { id, label, sequence, ccd, smiles }.
 * opts: { after: card, guess: true to detect RNA/DNA from the sequence }.
 */
function addChain(type, d = {}, opts = {}) {
  const card = document.createElement('div');
  card.className = 'chain';
  card.dataset.uid = `c${++uid}`;
  card.innerHTML = CHAIN_HTML;
  card._seq = '';
  card._guess = !!opts.guess;
  const id = d.id || nextChainId();
  card.querySelector('.chain-id').value = id;
  card._id = id;
  if (opts.after?.isConnected) opts.after.after(card);
  else $('chains').appendChild(card);
  setType(card, type);
  if (d.label) card.querySelector('.chain-label').value = d.label;
  if (type === 'ligand') {
    if (d.smiles) { setLigKind(card, 'smiles'); card.querySelector('.lig-input').value = d.smiles; }
    else if (d.ccd) card.querySelector('.lig-input').value = [].concat(d.ccd).join(', ');
  } else if (d.sequence) {
    setSeq(card, d.sequence);
  }
  refreshChainSels();
  touch();
  return card;
}

function setType(card, type) {
  card.dataset.type = type;
  const lig = type === 'ligand';
  const typeBtn = card.querySelector('.chain-type');
  typeBtn.textContent = TYPE_LABEL[type];
  typeBtn.disabled = lig;
  card.querySelector('.seq-wrap').hidden = lig;
  card.querySelector('.lig-row').hidden = !lig;
  card.querySelector('.chain-edit').hidden = lig;
  if (lig) {
    setLigKind(card, card.dataset.lig || 'ccd');
    card.querySelector('.chips').innerHTML = '';
    card.querySelector('.opt-mods').hidden = true;
  } else {
    card.querySelector('.seq-edit').placeholder = SEQ_PLACEHOLDER[type];
  }
  if (lig || type === 'dna') setMode(card, 'msa', 'auto');
  if (type !== 'protein') setMode(card, 'tpl', 'auto');
  card.querySelector('.file-row[data-slot="paired"]').hidden = type !== 'protein';
  card._sig = null;
}

function setLigKind(card, kind) {
  card.dataset.lig = kind;
  card.querySelectorAll('.lig-kind button').forEach(b => b.classList.toggle('on', b.dataset.v === kind));
  card.querySelector('.lig-input').placeholder = kind === 'smiles' ? 'CC(=O)Oc1ccccc1C(=O)O' : 'ATP';
}

function removeChain(card) {
  if (pending?.card === card) clearPending();
  card.remove();
  refreshChainSels();
  touch();
}

function duplicateChain(card) {
  const c = collect().chains.find(x => x.el === card);
  const entry = toJson({ ...emptyModel(), version: 4, chains: [c] }).sequences[0];
  addChainFromEntry(entry, { newId: true, after: card });
}

// ── Sequence text ────────────────────────────────────────────────────────────

function setSeq(card, seq) {
  card._seq = cleanSeq(seq);
  card.querySelector('.seq-edit').value = card._seq;
  showSeqView(card);
}

function showSeqView(card) {
  const has = !!card._seq;
  card.querySelector('.seq-view').hidden = !has;
  card.querySelector('.seq-edit').hidden = has;
  card.querySelector('.seq-msg').hidden = true;
  card._sig = null;
}

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(ta.scrollHeight + 2, 17 * parseFloat(getComputedStyle(document.documentElement).fontSize))}px`;
}

function editSeq(card, pos = null) {
  clearPending();
  hideTip();
  const ta = card.querySelector('.seq-edit');
  card.querySelector('.seq-view').hidden = true;
  ta.hidden = false;
  autoGrow(ta);
  ta.focus();
  const at = pos ?? ta.value.length;
  ta.setSelectionRange(at, at);
}

function onSeqInput(card, ta) {
  const raw = ta.value;
  const msg = card.querySelector('.seq-msg');
  const ids = card.dataset.type === 'protein' ? parseUniprotIds(raw) : null;
  if (ids) {
    card._seq = '';
    msg.hidden = false;
    msg.innerHTML = `<button class="btn sm primary fetch-btn">Fetch ${esc(ids.join(', '))} from UniProt</button>`;
  } else {
    msg.hidden = true;
    card._seq = /^\s*[>;]/.test(raw) ? (parseFasta(raw)[0]?.seq || '') : cleanSeq(raw);
  }
  autoGrow(ta);
}

/** Turn the text box content into a sequence: UniProt IDs are fetched, FASTA is split into chains. */
function commitSeq(card) {
  const ta = card.querySelector('.seq-edit');
  if (ta.hidden || !card.isConnected) return;
  const raw = ta.value.trim();
  if (!raw) { card._seq = ''; touch(); return; }
  if (card.dataset.type === 'protein') {
    const ids = parseUniprotIds(raw);
    if (ids) { fetchInto(card, ids); return; }
  }
  if (/^\s*[>;]/m.test(raw)) {
    const entries = parseFasta(raw);
    if (!entries.length) return;
    let last = card;
    entries.forEach((e, i) => {
      const target = i === 0 ? card : addChain('protein', {}, { after: last, guess: true });
      fillChain(target, e.seq, shortHeader(e.header));
      last = target;
    });
    touch();
    return;
  }
  fillChain(card, raw, '');
  touch();
}

function fillChain(card, seq, label) {
  seq = cleanSeq(seq);
  if (card._guess && card.dataset.type !== 'ligand') {
    const t = guessSeqType(seq);
    if (t !== card.dataset.type) setType(card, t);
  }
  setSeq(card, seq);
  const lab = card.querySelector('.chain-label');
  if (label && !lab.value) lab.value = label;
}

async function fetchInto(card, ids) {
  if (card._fetching) return;
  card._fetching = true;
  const msg = card.querySelector('.seq-msg');
  msg.hidden = false;
  msg.textContent = 'Fetching…';
  const results = await Promise.allSettled(ids.map(fetchUniprot));
  card._fetching = false;
  if (!card.isConnected) return;
  let last = null;
  for (const r of results) {
    if (r.status !== 'fulfilled') {
      toast(r.reason instanceof TypeError ? 'UniProt could not be reached' : r.reason.message, { type: 'error' });
      continue;
    }
    const target = last ? addChain('protein', {}, { after: last }) : card;
    setSeq(target, r.value.seq);
    const lab = target.querySelector('.chain-label');
    if (!lab.value) lab.value = r.value.name;
    last = target;
  }
  msg.hidden = true;
  msg.textContent = '';
  touch();
}

/** Add FASTA entries as chains; an untouched empty chain is reused first. */
function addSeqEntries(entries) {
  for (const e of entries) {
    const spare = chainCards().find(c => c.dataset.type !== 'ligand' && !c._seq &&
      !c.querySelector('.seq-edit').value.trim() && !c.querySelector('.chain-label').value);
    const card = spare || addChain('protein', {}, { guess: true });
    card._guess = true;
    fillChain(card, e.seq, shortHeader(e.header));
  }
  touch();
}

// ── Sequence view ────────────────────────────────────────────────────────────

let _charW = 0;

function measureChar() {
  const probe = document.createElement('pre');
  probe.className = 'seq-view';
  probe.style.cssText = 'position:absolute;visibility:hidden;width:auto;padding:0;border:0;max-height:none';
  probe.textContent = 'M'.repeat(40);
  document.body.appendChild(probe);
  _charW = probe.getBoundingClientRect().width / 40 || 8;
  probe.remove();
}

function lineLength(card) {
  if (!_charW) measureChar();
  const w = card.querySelector('.seq-wrap').clientWidth - 40;
  const chars = Math.floor(w / _charW);
  return Math.max(1, Math.floor((chars - 6) / 11)) * 10;
}

/** hl: Map(pos → { cls: [..], color, tips: [..], pids: [..] }) */
function renderSeq(card, hl) {
  const view = card.querySelector('.seq-view');
  if (view.hidden) return;
  const seq = card._seq;
  const perLine = lineLength(card);
  let hlSig = '';
  hl.forEach((h, p) => { hlSig += `${p}${h.cls.join('')}${h.color || ''}${h.pids.join('.')};`; });
  const sig = `${seq}|${perLine}|${hlSig}`;
  if (card._sig === sig) return;
  card._sig = sig;
  card._tips = new Map();

  const numW = Math.max(4, String(seq.length).length + 1);
  const lines = [];
  for (let i = 0; i < seq.length; i += perLine) {
    let line = `<span class="n">${String(i + 1).padStart(numW)}</span> `;
    for (let j = i; j < Math.min(seq.length, i + perLine); j++) {
      if (j > i && (j - i) % 10 === 0) line += ' ';
      const p = j + 1;
      const h = hl.get(p);
      if (h) {
        if (h.tips.length) card._tips.set(p, h.tips);
        line += `<span class="r ${h.cls.join(' ')}" data-p="${p}"` +
          (h.color ? ` style="--h:${h.color}"` : '') +
          (h.pids.length ? ` data-k="${h.pids.join(' ')}"` : '') + `>${seq[j]}</span>`;
      } else {
        line += `<span class="r" data-p="${p}">${seq[j]}</span>`;
      }
    }
    lines.push(line);
  }
  view.innerHTML = lines.join('\n');
}

function renderSeqViews(model) {
  const maps = new Map(); // card → Map(pos → highlight)
  const cardOf = new Map();
  model.chains.forEach(c => { if (!cardOf.has(c.id)) cardOf.set(c.id, c.el); maps.set(c.el, new Map()); });
  const add = (card, pos, cls, o = {}) => {
    const m = maps.get(card);
    if (!m || !pos) return;
    if (!m.has(pos)) m.set(pos, { cls: [], color: null, tips: [], pids: [] });
    const h = m.get(pos);
    if (!h.cls.includes(cls)) h.cls.push(cls);
    if (o.color && !h.color) h.color = o.color;
    if (o.tip) h.tips.push(o.tip);
    if (o.pid) h.pids.push(o.pid);
  };
  const aaAt = (id, p) => model.chains.find(c => c.id === id)?.seq[p - 1] || '';

  model.xl.forEach(g => g.pairs.forEach(p => {
    if (!(p.c1 && p.p1 && p.c2 && p.p2)) return;
    const pid = p.el.dataset.pid;
    add(cardOf.get(p.c1), p.p1, 'h-xl', { color: g.color, pid, tip: `${g.name} – ${p.c2}:${aaAt(p.c2, p.p2)}${p.p2}` });
    add(cardOf.get(p.c2), p.p2, 'h-xl', { color: g.color, pid, tip: `${g.name} – ${p.c1}:${aaAt(p.c1, p.p1)}${p.p1}` });
  }));
  model.ss.forEach(b => {
    if (!(b.c1 && b.p1 && b.c2 && b.p2)) return;
    const pid = b.el.dataset.pid;
    add(cardOf.get(b.c1), b.p1, 'h-ss', { pid, tip: `S–S – ${b.c2}:${b.p2}` });
    add(cardOf.get(b.c2), b.p2, 'h-ss', { pid, tip: `S–S – ${b.c1}:${b.p1}` });
  });
  model.chains.forEach(c => c.mods.forEach(m => {
    const ptm = PTM_DATABASE.find(x => x.ccd === m.ccd);
    add(c.el, m.pos, 'h-mod', { tip: ptm ? `${m.ccd} · ${ptm.name}` : m.ccd });
  }));

  model.chains.forEach(c => {
    const ok = ALPHABET[c.type];
    if (ok) [...c.seq].forEach((ch, i) => { if (!ok.has(ch)) add(c.el, i + 1, 'h-bad', { tip: 'not allowed here' }); });
  });

  if (pending) {
    if (pending.kind === 'ss') {
      model.chains.filter(c => c.type === 'protein').forEach(c => {
        [...c.seq].forEach((aa, i) => { if (aa === 'C') add(c.el, i + 1, 'h-cand'); });
      });
    } else if (pending.kind === 'mod') {
      const seq = pending.card._seq;
      [...seq].forEach((aa, i) => { if (!pending.target || aa === pending.target) add(pending.card, i + 1, 'h-cand'); });
    }
  }
  maps.forEach((hl, card) => { if (card.dataset.type !== 'ligand') renderSeq(card, hl); });
  // the selected residue is marked in place: rebuilding the view between two clicks would swallow the second
  document.querySelectorAll('.r.h-sel').forEach(el => el.classList.remove('h-sel'));
  if (pending?.pos) pending.card.querySelector(`.r[data-p="${pending.pos}"]`)?.classList.add('h-sel');
}

// ── Residue actions ──────────────────────────────────────────────────────────

function setPending(p) {
  pending = p;
  const bar = $('pickBar');
  const text = $('pickBarText');
  bar.querySelectorAll('.pick-act').forEach(b => b.remove());
  if (!p) { bar.hidden = true; document.body.classList.remove('picking'); touch(); return; }
  const id = cardId(p.card);
  const aa = p.pos ? p.card._seq[p.pos - 1] : '';
  const act = (label, title, fn) => {
    const b = document.createElement('button');
    b.className = 'pick-act';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', fn);
    $('pickBarCancel').before(b);
  };
  if (p.kind === 'xl') {
    const protein = p.card.dataset.type === 'protein';
    text.innerHTML = `<b>${esc(id)} · ${aa}${p.pos}</b>` + (protein ? ' click another residue to crosslink' : '');
    act('Modification', 'Phosphorylation, methylation, …', () => openPtm(p.card, p.pos));
    if (!p.card._features) act('Edit sequence', 'Also: double-click the sequence', () => editSeq(p.card, p.pos));
    if (protein && aa === 'C') act('Disulfide', 'Bond to another cysteine', () => setPending({ ...p, kind: 'ss' }));
  } else if (p.kind === 'ss') {
    text.innerHTML = `<b>${esc(id)} · C${p.pos}</b> click the second cysteine`;
  } else if (p.kind === 'mod') {
    text.innerHTML = `<b>${esc(p.ccd)}</b> click ${p.target ? `a residue ${p.target}` : 'a residue'} in chain ${esc(id)}`;
  }
  bar.hidden = false;
  document.body.classList.add('picking');
  touch();
}

function clearPending() {
  if (pending) setPending(null);
}

function onResidueClick(card, span) {
  const pos = parseInt(span.dataset.p, 10);
  const id = cardId(card);
  const aa = card._seq[pos - 1];
  const type = card.dataset.type;

  if (pending?.kind === 'mod') {
    if (pending.card !== card) { toast(`Click a residue in chain ${cardId(pending.card)}`); return; }
    addMod(card, pending.ccd, pos);
    clearPending();
    return;
  }
  if (pending?.kind === 'ss') {
    if (pending.card === card && pending.pos === pos) { clearPending(); return; }
    if (type !== 'protein' || aa !== 'C') { toast('Pick a cysteine'); return; }
    addSs({ c1: cardId(pending.card), p1: pending.pos, c2: id, p2: pos });
    clearPending();
    return;
  }
  if (pending?.kind === 'xl') {
    if (pending.card === card && pending.pos === pos) { clearPending(); return; }
    if (pending.card.dataset.type === 'protein' && type === 'protein') {
      addClickedPair({ c1: cardId(pending.card), p1: pending.pos, c2: id, p2: pos });
      clearPending();
      return;
    }
  }
  setPending({ kind: 'xl', card, pos });
}

// ── Modifications ────────────────────────────────────────────────────────────

function addMod(card, ccd, pos) {
  ccd = String(ccd || '').trim().toUpperCase().replace(/^CCD_/, '');
  if (!ccd || !pos) return;
  const chip = document.createElement('span');
  chip.className = 'chip mod-chip';
  chip.dataset.ccd = ccd;
  chip.dataset.pos = pos;
  chip.innerHTML = `<b>${esc(ccd)}</b><span class="chip-at"></span><button class="chip-x" aria-label="Remove ${esc(ccd)}" title="Remove">${ICON.x}</button>`;
  card.querySelector('.opt-mods .chips').appendChild(chip);
  card.querySelector('.opt-mods').hidden = false;
  touch();
}

let _ptm = null; // { card, pos }

function openPtm(card, pos = null) {
  _ptm = { card, pos };
  const id = cardId(card);
  $('ptmTitle').textContent = pos ? `Modify ${id} · ${card._seq[pos - 1]}${pos}` : `Modification in chain ${id}`;
  $('ptmSearch').value = '';
  renderPtm();
  showModal('ptm-modal');
}

function renderPtm() {
  const { card, pos } = _ptm;
  const type = card.dataset.type;
  const aa = pos ? card._seq[pos - 1] : null;
  const q = $('ptmSearch').value.trim().toLowerCase();
  const pool = PTM_DATABASE.filter(p => {
    const nucleic = p.category === 'RNA modification' ? 'rna' : p.category === 'DNA modification' ? 'dna' : 'protein';
    if (nucleic !== type) return false;
    if (aa && p.targetAA !== aa) return false;
    return !q || `${p.ccd} ${p.name} ${p.description} ${p.category}`.toLowerCase().includes(q);
  });
  const list = $('ptmList');
  list.innerHTML = '';
  let cat = null;
  for (const p of pool) {
    if (p.category !== cat) {
      cat = p.category;
      list.appendChild(Object.assign(document.createElement('div'), { className: 'menu-heading', textContent: cat }));
    }
    const b = document.createElement('button');
    b.className = 'ptm-item';
    b.innerHTML = `<b>${esc(p.ccd)}</b><span>${esc(p.name)}</span><i>${esc(p.targetAA)}</i>`;
    b.title = p.description;
    b.addEventListener('click', () => choosePtm(p.ccd));
    list.appendChild(b);
  }
  const code = q.toUpperCase();
  if (/^[A-Z0-9]{1,5}$/.test(code) && !pool.some(p => p.ccd === code)) {
    const b = document.createElement('button');
    b.className = 'ptm-item';
    b.innerHTML = `<b>${esc(code)}</b><span>Use this CCD code</span>`;
    b.addEventListener('click', () => choosePtm(code));
    list.appendChild(b);
  }
  if (!list.children.length) {
    list.innerHTML = `<div class="menu-empty">${aa && !q ? `No listed modification for ${esc(aa)}. Type a CCD code.` : 'Nothing found. Type a CCD code.'}</div>`;
  }
}

function choosePtm(ccd) {
  hideModal('ptm-modal');
  const { card, pos } = _ptm;
  if (pos) {
    addMod(card, ccd, pos);
    clearPending();
  } else if (!card._seq) {
    toast('Add the sequence first');
  } else {
    showSeqView(card);
    const ptm = PTM_DATABASE.find(p => p.ccd === ccd);
    setPending({ kind: 'mod', card, ccd, target: ptm?.targetAA || null });
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// ── MSA and templates ────────────────────────────────────────────────────────

/** kind: 'msa' | 'tpl'; mode: 'auto' | 'none' | 'custom'. Auto hides the row unless keep. */
function setMode(card, kind, mode, keep = false) {
  card.dataset[kind] = mode;
  const opt = card.querySelector(`.opt-${kind}`);
  opt.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.v === mode));
  opt.querySelector('.opt-body').hidden = mode !== 'custom';
  opt.hidden = mode === 'auto' && !keep;
  if (kind === 'tpl' && mode === 'custom' && !opt.querySelector('.tpl')) addTpl(card);
  if (mode !== 'custom') {
    opt.querySelectorAll('.msa-path').forEach(inp => { inp.value = ''; clearInline(inp); });
    opt.querySelectorAll('.tpl').forEach(t => t.remove());
    opt.querySelectorAll('.opt-msg').forEach(m => { m.hidden = true; });
  }
  touch();
}

function setInline(input, name, content) {
  input._inline = content;
  input.value = name;
  input.classList.add('inline');
  input.title = 'Stored in the JSON. Type to replace it with a path.';
}

function clearInline(input) {
  delete input._inline;
  input.classList.remove('inline');
  input.title = '';
}

const fileVal = input => (input._inline != null
  ? { path: '', content: input._inline }
  : { path: input.value.trim(), content: '' });

function optMsg(el, text, bad = false) {
  el.hidden = !text;
  el.innerHTML = text || '';
  el.classList.toggle('bad', bad);
}

async function onMsaFile(card, row, file) {
  const text = await readFileText(file);
  setInline(row.querySelector('.msa-path'), file.name, text);
  const { errors, warnings } = validateA3m(text, card._seq || null);
  const msg = card.querySelector('.opt-msa .opt-msg');
  const who = row.dataset.slot === 'paired' ? 'Paired' : 'Unpaired';
  optMsg(msg, [...errors, ...warnings].map(m => `${who}: ${esc(m)}`).join('<br>'), errors.length > 0);
  touch();
}

function addTpl(card, d = {}) {
  const el = document.createElement('div');
  el.className = 'tpl';
  el.innerHTML = `
    <div class="file-row">
      <span class="file-name">Structure</span>
      <input class="tpl-path" placeholder="path to .cif on the machine that runs AF3x" spellcheck="false">
      <label class="btn sm" title="PDB or mmCIF. Aligned to the chain; stored in the JSON.">Upload<input type="file" accept=".cif,.mmcif,.pdb,.ent" hidden></label>
      <button class="icon-btn tpl-x" title="Remove template" aria-label="Remove template">×</button>
    </div>
    <div class="file-row">
      <span class="file-name" title="Which chain residues match which template residues, counted from 0">Mapping</span>
      <input class="tpl-q" placeholder="chain residues, from 0: 0-120" spellcheck="false" title="Chain residues, counted from 0">
      <span class="arrow">→</span>
      <input class="tpl-t" placeholder="template residues: 4-124" spellcheck="false" title="Template residues, counted from 0">
    </div>
    <div class="opt-msg" hidden></div>`;
  card.querySelector('.tpl-list').appendChild(el);
  const path = el.querySelector('.tpl-path');
  if (d.mmcif) setInline(path, 'mmCIF in the JSON', d.mmcif);
  else if (d.mmcifPath) path.value = d.mmcifPath;
  if (d.queryIndices) el.querySelector('.tpl-q').value = formatRanges(d.queryIndices);
  if (d.templateIndices) el.querySelector('.tpl-t').value = formatRanges(d.templateIndices);
  touch();
  return el;
}

async function onTplFile(card, el, file) {
  const text = await readFileText(file);
  const msg = el.querySelector('.opt-msg');
  let chains = [];
  try {
    chains = extractAtomSequences(text).filter(c => c.sequence && (c.sequence.match(/X/g) || []).length / c.sequence.length < 0.5);
  } catch { /* handled below */ }
  if (!chains.length) { optMsg(msg, 'No protein chain found in this file', true); return; }
  el._src = { text, name: file.name, chains };
  let best = 0;
  if (card._seq && chains.length > 1) {
    let top = -1;
    chains.forEach((c, i) => {
      const { alignedA, alignedB } = needlemanWunsch(card._seq, c.sequence);
      const same = [...alignedA].filter((ch, k) => ch !== '-' && ch === alignedB[k]).length;
      if (same > top) { top = same; best = i; }
    });
  }
  useTplChain(card, el, best);
}

/** Cut one chain out of the uploaded structure, store it, and fill the mapping by alignment. */
function useTplChain(card, el, idx) {
  const { text, name, chains } = el._src;
  const msg = el.querySelector('.opt-msg');
  let built;
  try {
    built = buildTemplate(text, chains[idx].chainId, name.replace(/\.[^.]+$/, ''));
  } catch (e) {
    optMsg(msg, esc(e.message), true);
    return;
  }
  setInline(el.querySelector('.tpl-path'), `${name} · chain ${chains[idx].chainId}`, built.mmcif);
  let html = '';
  if (chains.length > 1) {
    html += `Chain <select class="tpl-chain">${chains.map((c, i) =>
      `<option value="${i}"${i === idx ? ' selected' : ''}>${esc(c.chainId)} (${c.sequence.length})</option>`).join('')}</select> · `;
  }
  if (card._seq) {
    const { alignedA, alignedB } = needlemanWunsch(card._seq, built.sequence);
    const map = alignmentToMapping(alignedA, alignedB);
    el.querySelector('.tpl-q').value = formatRanges(map.queryIndices);
    el.querySelector('.tpl-t').value = formatRanges(map.templateIndices);
    html += `${map.queryIndices.length} residues aligned · ${(map.identity * 100).toFixed(0)}% identical`;
  } else {
    html += 'Add the chain sequence, then upload again to align';
  }
  optMsg(msg, html);
  touch();
}

// ── Chain menus ──────────────────────────────────────────────────────────────

function openChainMenu(card, anchor) {
  const type = card.dataset.type;
  const items = [];
  if (type !== 'ligand') {
    items.push({ label: 'Modification', hint: type === 'protein' ? 'Phospho, methyl, …' : 'Modified base', onClick: () => startMod(card) });
    if (type !== 'dna') items.push({ label: 'MSA', hint: 'None or your own', onClick: () => { setMode(card, 'msa', card.dataset.msa || 'auto', true); reveal(card.querySelector('.opt-msa')); } });
    if (type === 'protein') items.push({ label: 'Templates', hint: 'None or your own', onClick: () => { setMode(card, 'tpl', card.dataset.tpl || 'auto', true); reveal(card.querySelector('.opt-tpl')); } });
    if (card._seq) items.push({ label: card.classList.contains('tall') ? 'Collapse sequence' : 'Show whole sequence', onClick: () => { card.classList.toggle('tall'); } });
    items.push({ sep: true });
  }
  items.push({ label: 'Duplicate', onClick: () => duplicateChain(card) });
  openMenu(anchor, items, { align: 'right' });
}

function openTypeMenu(card, anchor) {
  openMenu(anchor, ['protein', 'rna', 'dna'].map(t => ({
    label: TYPE_LABEL[t],
    checked: card.dataset.type === t,
    onClick: () => { card._guess = false; setType(card, t); refreshChainSels(); touch(); },
  })));
}

function startMod(card) {
  if (!card._seq) { toast('Add the sequence first'); return; }
  openPtm(card, null);
}

// ─── Chain references in rows ────────────────────────────────────────────────

const chainSel = (cls, value, only = '') =>
  `<select class="chain-sel ${cls}" data-v="${esc(value || '')}" data-only="${only}" aria-label="Chain"></select>`;

/** Rebuild the options of every chain <select>, keeping the chosen chain. */
function refreshChainSels(root = document) {
  const chains = chainCards().map(c => ({ id: cardId(c), type: c.dataset.type, label: c.querySelector('.chain-label').value.trim() }));
  root.querySelectorAll('select.chain-sel').forEach(sel => {
    const only = sel.dataset.only;
    const ok = chains.filter(c => c.id && (!only || c.type === only));
    const ids = [...new Set(ok.map(c => c.id))];
    const hint = new Map(ok.map(c => [c.id, c.label]));
    let v = sel.dataset.v || '';
    if (!v) v = ids[0] || '';
    let html = ids.map(id => `<option data-hint="${esc(hint.get(id) || '')}">${esc(id)}</option>`).join('');
    if (v && !ids.includes(v)) html += `<option class="missing">${esc(v)}</option>`;
    if (!html) html = '<option value="">–</option>';
    sel.innerHTML = html;
    sel.value = v;
    sel.dataset.v = v;
  });
}

function renameChainRefs(oldId, newId) {
  document.querySelectorAll('select.chain-sel').forEach(sel => {
    if (sel.dataset.v === oldId) sel.dataset.v = newId;
  });
}

function onChainIdInput(card, input) {
  const clean = input.value.toUpperCase().replace(/[^A-Z]/g, '');
  if (clean !== input.value) input.value = clean;
  const old = card._id;
  if (clean && clean !== old) {
    const taken = chainCards().some(c => c !== card && cardId(c) === clean);
    const oldShared = chainCards().some(c => c !== card && (c._id === old));
    if (!taken) {
      if (old && !oldShared) renameChainRefs(old, clean);
      card._id = clean;
    }
  }
  refreshChainSels();
}

// ─── Crosslinks ──────────────────────────────────────────────────────────────

function xlOptionsHTML(selected) {
  const cats = [...new Set(CROSSLINKERS.map(x => x.category))];
  let html = '';
  for (const cat of cats) {
    html += `<optgroup label="${esc(cat)}">`;
    for (const x of CROSSLINKERS.filter(c => c.category === cat)) {
      html += `<option value="${esc(x.name)}"${x.name === selected ? ' selected' : ''}>${esc(x.name)}${x.dynamic ? ' n' : ''}</option>`;
    }
    html += '</optgroup>';
  }
  if (selected && !CROSSLINKERS.some(x => x.name === selected)) {
    html += `<option value="${esc(selected)}" selected>${esc(selected)}</option>`;
  }
  return html;
}

const xlGroups = () => [...$('xlGroups').querySelectorAll('.xl')];

function groupName(g) {
  const base = g.querySelector('.xl-name').value;
  const def = CROSSLINKERS.find(x => x.name === base);
  return def?.dynamic ? `${base}${parseInt(g.querySelector('.xl-n').value, 10) || 5}` : base;
}

/** d: { name: 'DSSO' | 'LINK5', pairs: [{ c1, p1, c2, p2 }] } */
function addXlGroup(d = {}) {
  const found = d.name ? findXl(d.name) : null;
  const base = found ? found.def.name : (d.name || 'DSSO');
  const g = document.createElement('div');
  g.className = 'xl';
  g.dataset.uid = `x${++uid}`;
  g.innerHTML = `
    <div class="xl-head">
      <span class="dot"></span>
      <select class="xl-name" aria-label="Crosslinker">${xlOptionsHTML(base)}</select>
      <input type="number" class="xl-n" min="1" max="30" value="${found?.n || 5}" title="n" aria-label="n" hidden>
      <span class="xl-info"></span>
      <span class="xl-count"></span>
      <button class="icon-btn xl-del" title="Remove crosslinker" aria-label="Remove crosslinker">×</button>
    </div>
    <div class="rows xl-pairs"></div>
    <div class="add-row"><button class="btn add sm xl-add">+ Pair</button></div>`;
  $('xlGroups').appendChild(g);
  syncXlHead(g);
  const pairs = d.pairs || [{}];
  pairs.forEach(p => addXlPair(g, p, false));
  refreshChainSels(g);
  activeXl = g;
  touch();
  return g;
}

function syncXlHead(g) {
  const def = CROSSLINKERS.find(x => x.name === g.querySelector('.xl-name').value);
  g.querySelector('.xl-n').hidden = !def?.dynamic;
  let info = '';
  if (def?.dynamic) info = def.name === 'LINK' ? 'carbons · any residue' : 'rings · any residue';
  else if (def?.symmetric) info = def.reactiveResidues.join(' ');
  else if (def) info = `${def.reactiveResidues[0].join(' ')} → any`;
  const el = g.querySelector('.xl-info');
  el.textContent = info;
  el.title = def ? def.description + (def.symmetric === false ? '. First residue: NHS-ester end.' : '') : '';
}

function addXlPair(g, p = {}, refreshSels = true) {
  const rows = g.querySelector('.xl-pairs');
  const prev = rows.lastElementChild;
  const proteins = chainCards().filter(c => c.dataset.type === 'protein').map(cardId);
  const c1 = p.c1 || prev?.querySelector('.c1').dataset.v || proteins[0] || '';
  const c2 = p.c2 || prev?.querySelector('.c2').dataset.v || proteins[1] || proteins[0] || '';
  const row = document.createElement('div');
  row.className = 'row pair';
  row.dataset.pid = `p${++uid}`;
  row.innerHTML = `
    ${chainSel('c1', c1, 'protein')}<input type="number" class="pos p1" min="1" placeholder="res" value="${p.p1 || ''}" aria-label="Residue"><span class="aa a1"></span>
    <span class="link"></span>
    ${chainSel('c2', c2, 'protein')}<input type="number" class="pos p2" min="1" placeholder="res" value="${p.p2 || ''}" aria-label="Residue"><span class="aa a2"></span>
    <span class="row-msg"></span>
    <button class="icon-btn row-x" title="Remove" aria-label="Remove">×</button>`;
  rows.appendChild(row);
  if (refreshSels) { refreshChainSels(row); touch(); }
  return row;
}

/** Put a pair made by clicking two residues into the active crosslinker. */
function addClickedPair(p) {
  let g = activeXl?.isConnected ? activeXl : xlGroups().pop();
  if (!g) g = addXlGroup({ pairs: [] });
  const last = g.querySelector('.xl-pairs').lastElementChild;
  let row;
  if (last && !last.querySelector('.p1').value && !last.querySelector('.p2').value) {
    row = last;
    row.querySelector('.c1').dataset.v = p.c1;
    row.querySelector('.c2').dataset.v = p.c2;
    row.querySelector('.p1').value = p.p1;
    row.querySelector('.p2').value = p.p2;
    refreshChainSels(row);
  } else {
    row = addXlPair(g, p);
  }
  flash(row);
  touch();
}

/** "A 104 B 43" lines → pairs; null if the text is not a pair list. */
function parsePairLines(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = line.match(/^\W*([A-Za-z]{1,4})\W*?(\d+)\W+([A-Za-z]{1,4})\W*?(\d+)\W*$/);
    if (!m) return null;
    out.push({ c1: m[1].toUpperCase(), p1: +m[2], c2: m[3].toUpperCase(), p2: +m[4] });
  }
  return out.length ? out : null;
}

// ─── Disulfides, bonded atoms, custom CCD ────────────────────────────────────

function addSs(p = {}) {
  const proteins = chainCards().filter(c => c.dataset.type === 'protein').map(cardId);
  const row = document.createElement('div');
  row.className = 'row ss';
  row.dataset.pid = `p${++uid}`;
  row.innerHTML = `
    ${chainSel('c1', p.c1 || proteins[0], 'protein')}<input type="number" class="pos p1" min="1" placeholder="Cys" value="${p.p1 || ''}" aria-label="Residue"><span class="aa a1"></span>
    <span class="link"></span>
    ${chainSel('c2', p.c2 || proteins[0], 'protein')}<input type="number" class="pos p2" min="1" placeholder="Cys" value="${p.p2 || ''}" aria-label="Residue"><span class="aa a2"></span>
    <span class="row-msg"></span>
    <button class="icon-btn row-x" title="Remove" aria-label="Remove">×</button>`;
  $('ssRows').appendChild(row);
  $('ssSec').hidden = false;
  refreshChainSels(row);
  touch();
  return row;
}

function addBond(d = {}) {
  const a = d.a || [], b = d.b || [];
  const ligand = chainCards().find(c => c.dataset.type === 'ligand');
  const row = document.createElement('div');
  row.className = 'row bond';
  row.innerHTML = `
    ${chainSel('ca', a[0])}<input type="number" class="pos ra" min="1" placeholder="res" value="${a[1] || ''}" aria-label="Residue"><input type="text" class="atom aa-name" placeholder="atom" value="${esc(a[2] || '')}" maxlength="8" spellcheck="false" aria-label="Atom name">
    <span class="link"></span>
    ${chainSel('cb', b[0] || (ligand ? cardId(ligand) : ''))}<input type="number" class="pos rb" min="1" placeholder="res" value="${b[1] || (ligand ? 1 : '')}" aria-label="Residue"><input type="text" class="atom ab-name" placeholder="atom" value="${esc(b[2] || '')}" maxlength="8" spellcheck="false" aria-label="Atom name">
    <span class="row-msg"></span>
    <button class="icon-btn row-x" title="Remove" aria-label="Remove">×</button>`;
  $('bondRows').appendChild(row);
  $('bondSec').hidden = false;
  refreshChainSels(row);
  touch();
  return row;
}

function showCcd(content = '', path = '') {
  $('ccdSec').hidden = false;
  $('userCCD').value = content;
  $('userCCDPath').value = path;
  syncCcd();
}

function syncCcd() {
  $('userCCDPath').disabled = !!$('userCCD').value.trim();
  $('userCCD').disabled = !!$('userCCDPath').value.trim();
}

// ─── Model ───────────────────────────────────────────────────────────────────

function emptyModel() {
  return {
    name: '', version, seedMode: 'count', seedCount: 1, seedList: [],
    chains: [], xl: [], ss: [], bonds: [], ccd: { content: '', path: '' },
  };
}

const intVal = el => parseInt(el.value, 10) || 0;

const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function collect() {
  const model = emptyModel();
  const chainColor = cssVar('--chain');
  const xlColors = XL_GROUP_COLORS[document.documentElement.getAttribute('data-theme')] || XL_GROUP_COLORS.light;
  model.name = $('jobName').value.trim();
  model.nameEl = $('jobName');
  model.seedMode = seedMode;
  model.seedCount = intVal($('seedCount'));
  model.seedList = parseIntList($('seedList').value).filter(n => n >= 0 && n <= 4294967295);
  model.seedEl = seedMode === 'count' ? $('seedCount') : $('seedList');

  model.chains = chainCards().map(card => {
    const type = card.dataset.type;
    const c = {
      el: card, id: cardId(card), type, seq: card._seq || '', color: chainColor,
      label: card.querySelector('.chain-label').value.trim(),
      mods: [],
      msa: { mode: 'auto', el: card.querySelector('.opt-msa') },
      tpl: { mode: 'auto', el: card.querySelector('.opt-tpl'), entries: [] },
    };
    if (type === 'ligand') {
      c.ligKind = card.dataset.lig || 'ccd';
      c.ligValue = card.querySelector('.lig-input').value.trim();
      return c;
    }
    c.mods = [...card.querySelectorAll('.mod-chip')].map(el => ({ el, ccd: el.dataset.ccd, pos: parseInt(el.dataset.pos, 10) }));
    if (type !== 'dna') {
      c.msa.mode = card.dataset.msa || 'auto';
      for (const slot of ['unpaired', 'paired']) {
        c.msa[slot] = fileVal(card.querySelector(`.file-row[data-slot="${slot}"] .msa-path`));
      }
    }
    if (type === 'protein') {
      c.tpl.mode = card.dataset.tpl || 'auto';
      c.tpl.entries = [...card.querySelectorAll('.tpl')].map(el => {
        const f = fileVal(el.querySelector('.tpl-path'));
        return { el, mmcif: f.content, mmcifPath: f.path, q: parseRanges(el.querySelector('.tpl-q').value), t: parseRanges(el.querySelector('.tpl-t').value) };
      });
    }
    return c;
  });

  const pairOf = row => ({
    el: row,
    c1: row.querySelector('.c1').value, p1: intVal(row.querySelector('.p1')),
    c2: row.querySelector('.c2').value, p2: intVal(row.querySelector('.p2')),
  });
  model.xl = xlGroups().map((g, i) => ({
    el: g, name: groupName(g),
    color: xlColors[i % xlColors.length],
    dash: XL_DASH_PATTERNS[Math.floor(i / xlColors.length) % XL_DASH_PATTERNS.length],
    pairs: [...g.querySelectorAll('.pair')].map(pairOf),
  }));
  model.ss = [...$('ssRows').querySelectorAll('.ss')].map(pairOf);
  model.bonds = [...$('bondRows').querySelectorAll('.bond')].map(row => ({
    el: row,
    a: [row.querySelector('.ca').value, intVal(row.querySelector('.ra')), row.querySelector('.aa-name').value.trim()],
    b: [row.querySelector('.cb').value, intVal(row.querySelector('.rb')), row.querySelector('.ab-name').value.trim()],
  }));
  model.ccd = $('ccdSec').hidden
    ? { content: '', path: '' }
    : { el: $('ccdSec'), content: $('userCCD').value.trim(), path: $('userCCDPath').value.trim() };
  return model;
}

/** Write residue letters, row messages and problem marks back to the page. */
function annotate(model, issues) {
  const byId = new Map();
  model.chains.forEach(c => { if (!byId.has(c.id)) byId.set(c.id, c); });
  const aa = (id, p) => (p && byId.get(id)?.seq[p - 1]) || '';

  const inUse = new Set();
  [...model.xl.flatMap(g => g.pairs), ...model.ss].forEach(p => { if (p.p1) inUse.add(p.c1); if (p.p2) inUse.add(p.c2); });
  model.bonds.forEach(b => [b.a, b.b].forEach(e => { if (e[1] && e[2]) inUse.add(e[0]); }));

  for (const c of model.chains) {
    c.el._features = inUse.has(c.id) || c.mods.length > 0 || c.msa.mode !== 'auto' || c.tpl.mode !== 'auto';
    c.el.classList.toggle('editable', c.type !== 'ligand' && !c.el._features);
    const len = c.el.querySelector('.chain-len');
    len.textContent = c.type === 'ligand' ? '' : (c.seq ? `${c.seq.length} ${UNIT[c.type]}` : '');
    c.el.querySelector('.chain-edit').hidden = c.type === 'ligand' || c.el.querySelector('.seq-view').hidden;
    c.mods.forEach(m => { m.el.querySelector('.chip-at').textContent = ` ${c.seq[m.pos - 1] || ''}${m.pos}`; });
  }

  let nPairs = 0, nInter = 0;
  for (const g of model.xl) {
    g.el.querySelector('.dot').style.background = g.color;
    g.el.style.setProperty('--g', g.color);
    let n = 0;
    for (const p of g.pairs) {
      p.el.querySelector('.a1').textContent = aa(p.c1, p.p1);
      p.el.querySelector('.a2').textContent = aa(p.c2, p.p2);
      const res = checkPair(p, g.name, byId);
      const msg = p.el.querySelector('.row-msg');
      msg.textContent = res.state === 'error' ? res.msg : res.state === 'swap' ? '⇄' : '';
      msg.title = res.state === 'swap' ? 'Written in reverse order in the JSON: the NHS-ester end goes first' : '';
      msg.classList.toggle('info', res.state === 'swap');
      if (res.state === 'ok' || res.state === 'swap') { n++; nPairs++; if (p.c1 !== p.c2) nInter++; }
    }
    g.el.querySelector('.xl-count').textContent = g.pairs.length > 3 ? `${n}` : '';
    g.el.classList.toggle('active', g.el === activeXl && model.xl.length > 1);
  }
  $('xlSummary').textContent = nPairs > 1 ? `${nPairs} · ${nInter} inter · ${nPairs - nInter} intra` : '';
  const anySeq = model.chains.some(c => c.type === 'protein' && c.seq);
  $('xlHint').hidden = !anySeq || nPairs > 0;

  for (const b of model.ss) {
    b.el.querySelector('.a1').textContent = aa(b.c1, b.p1);
    b.el.querySelector('.a2').textContent = aa(b.c2, b.p2);
  }

  document.querySelectorAll('.has-error, .has-warn').forEach(el => el.classList.remove('has-error', 'has-warn'));
  document.querySelectorAll('.row.ss .row-msg, .row.bond .row-msg').forEach(el => { el.textContent = ''; });
  for (const it of issues) {
    if (!it.el?.classList) continue;
    if (it.level === 'todo' && !nagged) continue;
    it.el.classList.add(it.level === 'warn' ? 'has-warn' : 'has-error');
    if (it.level === 'error' && it.el.classList.contains('opt')) it.el.hidden = false;
    if (it.level === 'error' && it.el.matches('.row.ss, .row.bond')) {
      it.el.querySelector('.row-msg').textContent = it.msg.replace(/^[^:]*: /, '');
    }
  }
}

function syncSections(model) {
  $('ssSec').hidden = !model.ss.length;
  $('bondSec').hidden = !model.bonds.length;
}

// ─── Output ──────────────────────────────────────────────────────────────────

function renderIssues(issues) {
  const box = $('issues');
  const order = { error: 0, todo: 1, warn: 2 };
  const sorted = [...issues].sort((a, b) => order[a.level] - order[b.level]);
  const blocked = issues.some(i => i.level !== 'warn');
  box.innerHTML = '';
  const MAX = 6;
  sorted.forEach((it, i) => {
    const b = document.createElement('button');
    b.className = `issue ${it.level}`;
    b.textContent = it.msg;
    if (i >= MAX) b.hidden = true;
    if (it.el) b.addEventListener('click', () => reveal(it.el));
    else b.disabled = true;
    box.appendChild(b);
  });
  if (sorted.length > MAX) {
    const more = document.createElement('button');
    more.className = 'issue more';
    more.textContent = `${sorted.length - MAX} more`;
    more.addEventListener('click', () => { box.querySelectorAll('[hidden]').forEach(b => { b.hidden = false; }); more.remove(); });
    box.appendChild(more);
  }
  if (!blocked) nagged = false;
  ['downloadBtn', 'downloadMoreBtn', 'copyBtn'].forEach(id => {
    $(id).classList.toggle('blocked', blocked);
    $(id).setAttribute('aria-disabled', blocked);
  });
}

const isBlocked = () => current.issues.some(i => i.level !== 'warn');

/** Download was pressed with open items: mark and flash every place that needs input. */
function showBlockers() {
  nagged = true;
  refresh();
  const open = current.issues.filter(i => i.level !== 'warn');
  open.forEach(i => { if (i.el?.classList) { const opt = i.el.closest('.opt'); if (opt) opt.hidden = false; flash(i.el); } });
  flash($('issues'));
  const first = open.find(i => i.el);
  if (first) reveal(first.el);
}

/** Scroll to an element, flash it and focus its first field. */
function reveal(el) {
  if (!el?.isConnected) return;
  const opt = el.closest('.opt');
  if (opt) opt.hidden = false;
  const sec = el.closest('.sec');
  if (sec) sec.hidden = false;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  flash(el);
  let f = el.matches('input, select, textarea') ? el : null;
  if (!f && el.classList.contains('chain')) f = el.querySelector('.seq-edit:not([hidden]), .lig-row:not([hidden]) .lig-input');
  if (!f) f = [...el.querySelectorAll('input:not([type=file]), select, textarea')].find(x => x.offsetParent !== null && !x.disabled);
  f?.focus({ preventScroll: true });
}

function flash(el) {
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

function renderJson() {
  if (!$('jsonDetails').open) return;
  const short = (k, v) => (typeof v === 'string' && v.length > 400
    ? `${v.slice(0, 60)}… (${v.length.toLocaleString('en')} characters)` : v);
  let text = JSON.stringify(current.json, short, 2);
  // one residue pair or bond per line
  text = text.replace(/\[\s*\[\s*("[^"]*"),\s*(\d+)(?:,\s*("[^"]*"))?\s*\],\s*\[\s*("[^"]*"),\s*(\d+)(?:,\s*("[^"]*"))?\s*\]\s*\]/g,
    (m, a, b, c, d, e, f) => `[[${a}, ${b}${c ? `, ${c}` : ''}], [${d}, ${e}${f ? `, ${f}` : ''}]]`);
  text = text.replace(/"modelSeeds": \[([\s\d,]+)\]/, (m, s) => `"modelSeeds": [${s.replace(/\s+/g, ' ').trim()}]`);
  $('jsonOut').textContent = text;
}

const jsonText = () => JSON.stringify(current.json, null, 2);

function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const safeName = name => sanitisedName(name) || 'af3x_job';

async function copyJson() {
  try {
    await navigator.clipboard.writeText(jsonText());
    const b = $('copyBtn');
    b.textContent = 'Copied';
    setTimeout(() => { b.textContent = 'Copy'; }, 1400);
  } catch {
    toast('Copying is blocked by the browser', { type: 'error' });
  }
}

// ── Diagram ──────────────────────────────────────────────────────────────────

function diagramData(model) {
  const chains = model.chains.filter(c => c.id).map(c => ({
    id: c.id, label: c.id, length: c.type === 'ligand' ? null : (c.seq.length || null), color: c.color, type: c.type,
  }));
  const done = p => p.c1 && p.p1 && p.c2 && p.p2;
  const groups = model.xl.map(g => ({
    name: g.name, color: g.color, dashArray: g.dash,
    pairs: g.pairs.filter(done).map(p => ({ chain1: p.c1, pos1: p.p1, chain2: p.c2, pos2: p.p2, color: g.color, dashArray: g.dash })),
  })).filter(g => g.pairs.length);
  const ss = model.ss.filter(done).map(p => ({ chain1: p.c1, pos1: p.p1, chain2: p.c2, pos2: p.p2 }));
  return { chains, groups, ss };
}

function drawDiagram(model) {
  const { chains, groups, ss } = diagramData(model);
  document.querySelector('.diagram').hidden = !chains.some(c => c.length);
  drawArcDiagram($('arc-svg'), chains, groups, ss);
  const legend = $('arc-legend');
  const line = (color, dash) => `<svg width="22" height="8" aria-hidden="true"><line x1="1" y1="4" x2="21" y2="4" stroke="${color}" stroke-width="2"${dash && dash !== 'none' ? ` stroke-dasharray="${dash}"` : ''}/></svg>`;
  let html = '';
  if (groups.length > 1) html += groups.map(g => `<span>${line(g.color, g.dashArray)}${esc(g.name)}</span>`).join('');
  if (ss.length) html += `<span>${line(cssVar('--ss'), '4 3')}S–S</span>`;
  legend.innerHTML = html;
}

function pairRowByKey(key) {
  const [c1, p1, c2, p2] = key.split(':');
  return [...document.querySelectorAll('.row.pair, .row.ss')].find(r =>
    r.querySelector('.c1').value === c1 && r.querySelector('.p1').value === p1 &&
    r.querySelector('.c2').value === c2 && r.querySelector('.p2').value === p2) || null;
}

/** Light up everything that shows one pair: row, residues, arc. */
function setHot(row, on) {
  document.querySelectorAll('.hot').forEach(el => el.classList.remove('hot'));
  if (!on || !row) return;
  row.classList.add('hot');
  const pid = row.dataset.pid;
  document.querySelectorAll(`.r[data-k~="${pid}"]`).forEach(el => el.classList.add('hot'));
  const key = ['.c1', '.p1', '.c2', '.p2'].map(s => row.querySelector(s).value).join(':');
  document.querySelectorAll(`.xl-arc-group[data-key="${CSS.escape(key)}"]`).forEach(el => el.classList.add('hot'));
}

function showTip(html, e) {
  const tip = $('arc-tooltip');
  tip.innerHTML = html;
  tip.style.display = 'block';
  moveTip(e);
}

function moveTip(e) {
  const tip = $('arc-tooltip');
  if (tip.style.display !== 'block') return;
  const w = tip.offsetWidth;
  tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - w - 8)}px`;
  tip.style.top = `${Math.max(4, e.clientY - 34)}px`;
}

function hideTip() {
  $('arc-tooltip').style.display = 'none';
}

// ─── Autosave ────────────────────────────────────────────────────────────────

let _saveTimer = null;

function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    const json = current.json;
    if (!json) return;
    try {
      localStorage.setItem(LS_STATE, JSON.stringify(json));
    } catch {
      // too large for local storage: keep everything but the uploaded files
      try {
        localStorage.setItem(LS_STATE, JSON.stringify(json, (k, v) => (typeof v === 'string' && v.length > 20000 ? '' : v)));
      } catch { /* storage unavailable */ }
    }
  }, 600);
}

function isBlank(json) {
  if (!json) return true;
  const seqs = json.sequences || [];
  const empty = seqs.every(s => { const d = Object.values(s)[0]; return !d.sequence && !d.ccdCodes?.length && !d.smiles; });
  return !json.name && empty && seqs.length <= 1 && !json.crosslinks && !json.disulfide_bonds && !json.bondedAtomPairs;
}

function restoreSession() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS_STATE)); } catch { /* ignore */ }
  if (!saved || detectJsonDialect(saved) !== 'af3x' || isBlank(saved)) return false;
  try {
    loadJson(saved);
    return true;
  } catch (e) {
    console.warn('restore failed', e);
    clearAll();
    return false;
  }
}

// ─── Loading and clearing ────────────────────────────────────────────────────

function clearAll() {
  clearPending();
  ['chains', 'xlGroups', 'ssRows', 'bondRows'].forEach(id => { $(id).innerHTML = ''; });
  activeXl = null;
  $('jobName').value = '';
  setSeeds([1]);
  version = 4;
  $('ccdSec').hidden = true;
  $('userCCD').value = '';
  $('userCCDPath').value = '';
  syncCcd();
}

function setSeeds(seeds) {
  const list = (Array.isArray(seeds) ? seeds : [1]).map(Number).filter(n => Number.isInteger(n) && n >= 0);
  const isRun = list.length > 0 && list.every((n, i) => n === i + 1);
  setSeedMode(isRun || !list.length ? 'count' : 'list');
  $('seedCount').value = isRun ? list.length : 1;
  $('seedList').value = isRun ? '' : list.join(', ');
}

function setSeedMode(mode) {
  seedMode = mode;
  $('seedCount').hidden = mode !== 'count';
  $('seedList').hidden = mode !== 'list';
  document.querySelector('.field.seeds').classList.toggle('wide', mode === 'list');
}

/** One `sequences` entry → one chain card per ID. */
function addChainFromEntry(obj, opts = {}) {
  const type = Object.keys(obj)[0];
  if (!TYPE_LABEL[type]) return;
  const d = obj[type] || {};
  const ids = opts.newId ? [null] : [].concat(d.id ?? [null]);
  let after = opts.after || null;
  for (const id of ids) {
    const card = addChain(type, {
      id: typeof id === 'string' && /^[A-Z]+$/.test(id) ? id : undefined,
      label: d.description, sequence: d.sequence, ccd: d.ccdCodes, smiles: d.smiles,
    }, { after });
    after = after ? card : null;
    if (type === 'ligand') continue;
    for (const m of d.modifications || []) addMod(card, m.ptmType || m.modificationType, m.ptmPosition || m.basePosition);
    if (type !== 'dna') {
      const slots = type === 'protein' ? ['unpaired', 'paired'] : ['unpaired'];
      const given = slots.filter(s => d[`${s}Msa`] != null || d[`${s}MsaPath`]);
      const filled = slots.filter(s => d[`${s}Msa`] || d[`${s}MsaPath`]);
      if (filled.length) {
        setMode(card, 'msa', 'custom');
        for (const s of filled) {
          const input = card.querySelector(`.file-row[data-slot="${s}"] .msa-path`);
          if (d[`${s}MsaPath`]) input.value = d[`${s}MsaPath`];
          else setInline(input, 'MSA in the JSON', d[`${s}Msa`]);
        }
      } else if (given.length) {
        setMode(card, 'msa', 'none');
      }
    }
    if (type === 'protein' && Array.isArray(d.templates)) {
      if (!d.templates.length) setMode(card, 'tpl', 'none');
      else {
        card.dataset.tpl = 'custom';
        d.templates.forEach(t => addTpl(card, t));
        setMode(card, 'tpl', 'custom');
      }
    }
  }
}

function loadJson(j) {
  clearAll();
  $('jobName').value = j.name || '';
  setSeeds(j.modelSeeds);
  version = [1, 2, 3, 4].includes(Number(j.version)) ? Number(j.version) : 4;
  for (const obj of j.sequences || []) addChainFromEntry(obj);
  for (const g of j.crosslinks || []) {
    addXlGroup({ name: g.name, pairs: (g.residue_pairs || []).map(p => ({ c1: p[0][0], p1: p[0][1], c2: p[1][0], p2: p[1][1] })) });
  }
  for (const g of j.disulfide_bonds || []) {
    for (const p of g.residue_pairs || []) addSs({ c1: p[0][0], p1: p[0][1], c2: p[1][0], p2: p[1][1] });
  }
  for (const b of j.bondedAtomPairs || []) addBond({ a: b[0], b: b[1] });
  if (j.userCCD || j.userCCDPath) showCcd(j.userCCD || '', j.userCCDPath || '');
  if (!chainCards().length) addChain('protein', {}, { guess: true });
  refreshChainSels();
  touch();
}

/** Replace the whole job, offering Undo. */
function replaceJob(json, message) {
  const before = isBlank(current.json) ? null : JSON.parse(JSON.stringify(current.json));
  loadJson(json);
  toast(message, before ? { action: { label: 'Undo', fn: () => loadJson(before) } } : {});
}

function newJob() {
  if (isBlank(current.json)) return;
  replaceJob({ sequences: [] }, 'Cleared');
}

// ─── Importing files ─────────────────────────────────────────────────────────

async function handleFile(file) {
  let text;
  try { text = await readFileText(file); } catch { toast(`Could not read ${file.name}`, { type: 'error' }); return; }
  const kind = sniffFile(file.name, text);
  if (kind === 'json') importJsonText(text, file.name);
  else if (kind === 'structure') openPdbModal(text, onStructureImport);
  else if (kind === 'csv') importCsv(text);
  else if (kind === 'fasta') importFasta(text);
  else toast(`${file.name}: not a FASTA, PDB/mmCIF, JSON or crosslink CSV file`, { type: 'error' });
}

function importJsonText(text, name) {
  let raw;
  try { raw = JSON.parse(text); } catch (e) { toast(`${name}: not valid JSON`, { type: 'error' }); return; }
  const dialect = detectJsonDialect(raw);
  if (dialect === 'af3x') {
    replaceJob(raw, `Opened ${name}`);
  } else if (dialect === 'alphafoldserver') {
    const { converted, notes } = convertServerJson(raw);
    replaceJob(converted, `Opened AlphaFold Server job ${name}`);
    notes.forEach(n => toast(n, { ms: 9000 }));
  } else {
    toast(`${name}: not an AlphaFold 3 or AlphaFold Server input`, { type: 'error' });
  }
}

function importFasta(text) {
  const entries = parseFasta(text);
  if (!entries.length) { toast('No sequence found in the file', { type: 'error' }); return; }
  if (entries.length <= 10) { addSeqEntries(entries); return; }
  $('fastaSummary').textContent = plural(entries.length, 'sequence');
  $('fastaList').innerHTML = entries.map((e, i) => `
    <label class="pick-row">
      <input type="checkbox" value="${i}" checked>
      <span class="pick-main">${esc(shortHeader(e.header) || `Sequence ${i + 1}`)}</span>
      <span class="pick-sub">${e.seq.length}</span>
    </label>`).join('');
  $('fastaConfirm').onclick = () => {
    const chosen = [...$('fastaList').querySelectorAll('input:checked')].map(cb => entries[+cb.value]);
    hideModal('fasta-modal');
    if (chosen.length) addSeqEntries(chosen);
  };
  showModal('fasta-modal');
}

function onStructureImport(chains) {
  for (const ch of chains) {
    const type = ['dna', 'rna', 'ligand'].includes(ch.type) ? ch.type : 'protein';
    if (type === 'ligand') {
      addChain('ligand', { ccd: ch.ccdCode });
      continue;
    }
    const spare = chainCards().find(c => c.dataset.type !== 'ligand' && !c._seq &&
      !c.querySelector('.seq-edit').value.trim() && !c.querySelector('.chain-label').value);
    const card = spare || addChain(type);
    if (card.dataset.type !== type) setType(card, type);
    card._guess = false;
    fillChain(card, ch.sequence || '', (ch.entityName || '').slice(0, 40));
  }
  refreshChainSels();
  touch();
}

function importCsv(text) {
  const chains = collect().chains.filter(c => c.type === 'protein').map(c => ({ id: c.id, label: c.label, hasSeq: !!c.seq }));
  openImportModal(text, onCsvImport, chains, nextFreeIds);
}

/** n chain IDs that are not in use. */
function nextFreeIds(n) {
  const used = new Set(chainCards().map(cardId));
  const out = [];
  for (let i = 0; out.length < n; i++) if (!used.has(intToId(i))) out.push(intToId(i));
  return out;
}

function onCsvImport(pairs, xlName, proteinToChain, sequences = {}) {
  for (const [prot, id] of Object.entries(proteinToChain)) {
    let card = cardByChainId(id);
    if (card && card.dataset.type !== 'protein') continue;
    if (!card) {
      const spare = chainCards().find(c => c.dataset.type === 'protein' && !c._seq &&
        !c.querySelector('.seq-edit').value.trim() && !c.querySelector('.chain-label').value &&
        !Object.values(proteinToChain).includes(cardId(c)));
      if (spare) {
        spare.querySelector('.chain-id').value = id;
        spare._id = id;
        card = spare;
      } else {
        card = addChain('protein', { id });
      }
    }
    const lab = card.querySelector('.chain-label');
    if (!lab.value) lab.value = shortProteinName(prot).slice(0, 40);
    if (!card._seq && sequences[prot]) setSeq(card, sequences[prot]);
  }
  refreshChainSels();
  const g = addXlGroup({
    name: xlName,
    pairs: pairs.map(p => ({ c1: proteinToChain[p.protein1], p1: p.pos1, c2: proteinToChain[p.protein2], p2: p.pos2 })),
  });
  toast(`Imported ${plural(pairs.length, 'crosslink')}`);
  g.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function pickFile(inputId) {
  const input = $(inputId);
  input.value = '';
  input.click();
}

// ─── Batch export ────────────────────────────────────────────────────────────

function allPairs() {
  return (current.json?.crosslinks || []).flatMap(g => g.residue_pairs.map(pair => ({ name: g.name, pair })));
}

function openBatch() {
  if (isBlocked()) { showBlockers(); return; }
  if (allPairs().length < 2) { toast('Batch export needs at least two crosslinks'); return; }
  syncBatch();
  showModal('batch-modal');
}

function syncBatch() {
  const n = allPairs().length;
  $('batchK').max = n;
  if (intVal($('batchK')) > n) $('batchK').value = Math.max(1, Math.min(5, n - 1));
  const k = intVal($('batchK')), m = intVal($('batchM'));
  $('batchCount').textContent = plural(n, 'crosslink');
  $('batchSingleInfo').textContent = `${plural(n, 'file')}`;
  const combo = document.querySelector('input[name="batchMode"]:checked').value === 'combo';
  const bad = combo && (k < 1 || k > n || m < 1);
  const note = $('batchNote');
  note.hidden = !bad;
  note.textContent = bad ? `Crosslinks per job must be between 1 and ${n}` : '';
  $('batchGo').disabled = bad;
}

async function runBatch() {
  const base = current.json;
  const pairs = allPairs();
  const mode = document.querySelector('input[name="batchMode"]:checked').value;
  const job = safeName(base.name);
  const variant = (name, chosen) => {
    const byName = new Map();
    chosen.forEach(({ name: n, pair }) => { if (!byName.has(n)) byName.set(n, []); byName.get(n).push(pair); });
    const j = { ...base, name, crosslinks: [...byName].map(([n, residue_pairs]) => ({ name: n, residue_pairs })) };
    return { name: `${name}.json`, content: JSON.stringify(j, null, 2) };
  };
  let files, zipName;
  if (mode === 'single') {
    files = pairs.map(p => variant(`${job}_${p.name}_${p.pair[0].join('')}-${p.pair[1].join('')}`, [p]));
    zipName = `${job}_single_xl.zip`;
  } else {
    const k = intVal($('batchK')), m = intVal($('batchM'));
    files = [];
    for (let i = 0; i < m; i++) {
      const pool = [...pairs];
      for (let j = 0; j < k; j++) {
        const r = j + Math.floor(Math.random() * (pool.length - j));
        [pool[j], pool[r]] = [pool[r], pool[j]];
      }
      files.push(variant(`${job}_combo_${String(i + 1).padStart(3, '0')}`, pool.slice(0, k)));
    }
    zipName = `${job}_combos_k${k}_n${m}.zip`;
  }
  const btn = $('batchGo');
  btn.disabled = true;
  try {
    const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
    const zip = new JSZip();
    files.forEach(f => zip.file(f.name, f.content));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: zipName });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    hideModal('batch-modal');
  } catch (e) {
    toast('Could not build the ZIP (is the network blocked?)', { type: 'error' });
  } finally {
    btn.disabled = false;
  }
}

// ─── Advanced options menu ───────────────────────────────────────────────────

function showCcdSec() {
  $('ccdSec').hidden = false;
  touch();
  reveal($('ccdSec'));
}

/** Run fn(card) on the one matching chain, or ask which. */
function withChain(anchor, filter, title, fn) {
  const cards = chainCards().filter(filter);
  if (!cards.length) { toast('Add a matching chain first'); return; }
  if (cards.length === 1) { fn(cards[0]); return; }
  openMenu(anchor, cards.map(c => ({
    label: `${cardId(c)}  ${c.querySelector('.chain-label').value}`.trim(),
    hint: `${TYPE_LABEL[c.dataset.type]}${c._seq ? ` · ${c._seq.length}` : ''}`,
    onClick: () => fn(c),
  })), { title, cls: 'palette' });
}

function openPalette() {
  const a = $('paletteBtn');
  const polymer = c => c.dataset.type !== 'ligand';
  const protein = c => c.dataset.type === 'protein';
  const msaOk = c => c.dataset.type === 'protein' || c.dataset.type === 'rna';
  const mode = (kind, m) => card => { setMode(card, kind, m, true); reveal(card.querySelector(`.opt-${kind}`)); };
  const items = [
    { heading: 'Add' },
    { label: 'Disulfide bond', hint: 'Cys–Cys', keys: 'ss s-s cysteine bridge disulphide', onClick: () => reveal(addSs()) },
    { label: 'Modification', hint: 'PTM or modified base', keys: 'ptm phospho methyl acetyl ccd', onClick: () => withChain(a, polymer, 'Modify which chain?', startMod) },
    { label: 'Bonded atom pair', hint: 'Covalent ligand, glycan', keys: 'bond covalent bondedAtomPairs', onClick: () => reveal(addBond()) },
    { label: 'Custom ligand definition', hint: 'Your own CCD mmCIF', keys: 'userCCD userCCDPath ligand cif', onClick: showCcdSec },
    { heading: 'MSA and templates' },
    { label: 'Run without MSA', hint: 'Per chain', keys: 'msa none single sequence unpairedMsa', onClick: () => withChain(a, msaOk, 'No MSA for which chain?', mode('msa', 'none')) },
    { label: 'Custom MSA', hint: 'Your own A3M', keys: 'msa a3m alignment unpairedMsa pairedMsa', onClick: () => withChain(a, msaOk, 'Custom MSA for which chain?', mode('msa', 'custom')) },
    { label: 'Run without templates', hint: 'Per chain', keys: 'template none', onClick: () => withChain(a, protein, 'No templates for which chain?', mode('tpl', 'none')) },
    { label: 'Custom template', hint: 'Your own PDB / mmCIF', keys: 'template structure pdb mmcif', onClick: () => withChain(a, protein, 'Template for which chain?', mode('tpl', 'custom')) },
    { heading: 'Job' },
    { label: 'Exact seed values', hint: seedMode === 'list' ? 'On' : 'Instead of 1…N', keys: 'seeds modelSeeds random', onClick: () => { setSeedMode('list'); touch(); reveal($('seedList')); } },
    { label: 'JSON version', hint: `Now ${version}`, keys: 'version dialect old', onClick: () => openJobMenu() },
    { heading: 'Import' },
    { label: 'AlphaFold 3 / AlphaFold Server JSON', hint: 'Open a job', keys: 'import open load json', onClick: () => pickFile('anyFileInput') },
    { label: 'FASTA, PDB or mmCIF', hint: 'Chains from a file', keys: 'import fasta pdb cif structure sequence', onClick: () => pickFile('chainFileInput') },
    { label: 'Crosslink CSV', hint: 'xiVIEW, xiNET', keys: 'import csv xiview xinet xl-ms', onClick: () => pickFile('csvFileInput') },
    { heading: 'Export' },
    { label: 'One job per crosslink', hint: 'ZIP', keys: 'batch export zip screening single', onClick: () => { document.querySelector('input[name="batchMode"][value="single"]').checked = true; openBatch(); } },
    { label: 'Random crosslink subsets', hint: 'ZIP', keys: 'batch export zip screening combinations sample', onClick: () => { document.querySelector('input[name="batchMode"][value="combo"]').checked = true; openBatch(); } },
    { heading: 'Page' },
    { label: 'Light / dark theme', keys: 'theme colour color', onClick: toggleTheme },
    { label: 'Help', keys: 'about guide documentation privacy credits', onClick: openHelp },
  ];
  openMenu(a, items, { search: true, placeholder: 'Search options', cls: 'palette' });
}

function openJobMenu() {
  const box = document.createElement('div');
  box.className = 'form-pop';
  box.innerHTML = `
    <div class="form-row"><span>Seeds</span>
      <div class="seg" id="seedSeg"><button data-v="count" title="Seeds 1, 2, … N">1…N</button><button data-v="list" title="Type the seed values">Exact</button></div>
    </div>
    <div class="form-row"><span>JSON version</span>
      <div class="seg" id="versionSeg" title="Use a lower version only for an old AlphaFold 3 installation">${[4, 3, 2, 1].map(v => `<button data-v="${v}">${v}</button>`).join('')}</div>
    </div>`;
  const seg = box.querySelector('#seedSeg');
  const paint = () => seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === seedMode));
  paint();
  seg.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    setSeedMode(b.dataset.v);
    paint();
    touch();
  });
  const vseg = box.querySelector('#versionSeg');
  const paintV = () => vseg.querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.v === version));
  paintV();
  vseg.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    version = parseInt(b.dataset.v, 10);
    paintV();
    touch();
  });
  openPopover($('jobMoreBtn'), box, { align: 'right' });
}

// ─── Help and theme ──────────────────────────────────────────────────────────

function openHelp() {
  const wrap = $('helpXlTable');
  if (!wrap.firstChild) {
    const rows = CROSSLINKERS.map(x => {
      const react = x.dynamic ? 'any'
        : x.symmetric ? x.reactiveResidues.join(' ')
        : `${x.reactiveResidues[0].join(' ')} → any`;
      return `<tr><td><b>${esc(x.name)}${x.dynamic ? '<i>n</i>' : ''}</b></td><td>${esc(react)}</td><td>${esc(x.description)}</td></tr>`;
    }).join('');
    wrap.innerHTML = `<table class="help-table"><thead><tr><th>Name</th><th>Residues</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  showModal('help-modal');
}

function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem(LS_THEME, next); } catch { /* ignore */ }
  touch();
}

// ─── Wiring ──────────────────────────────────────────────────────────────────

function initChains() {
  const box = $('chains');

  box.addEventListener('click', e => {
    const card = e.target.closest('.chain');
    if (!card) return;
    const hit = sel => e.target.closest(sel);
    let b;
    if (hit('.chain-del')) removeChain(card);
    else if ((b = hit('.chain-more'))) openChainMenu(card, b);
    else if ((b = hit('.chain-type'))) openTypeMenu(card, b);
    else if (hit('.chain-edit')) editSeq(card);
    else if (hit('.fetch-btn')) commitSeq(card);
    else if ((b = hit('.lig-kind button'))) { setLigKind(card, b.dataset.v); touch(); }
    else if ((b = hit('.seg[data-seg] button'))) setMode(card, b.parentElement.dataset.seg, b.dataset.v, true);
    else if ((b = hit('.opt-x'))) setMode(card, b.closest('.opt').classList.contains('opt-msa') ? 'msa' : 'tpl', 'auto');
    else if (hit('.chip-add')) startMod(card);
    else if ((b = hit('.chip-x'))) {
      b.closest('.chip').remove();
      if (!card.querySelector('.mod-chip')) card.querySelector('.opt-mods').hidden = true;
      touch();
    }
    else if (hit('.add-tpl')) addTpl(card);
    else if ((b = hit('.tpl-x'))) { b.closest('.tpl').remove(); touch(); }
    else if ((b = hit('.r'))) onResidueClick(card, b);
    else if (hit('.seq-view') && !pending && !card._features) editSeq(card);
  });

  box.addEventListener('dblclick', e => {
    const card = e.target.closest('.chain');
    if (!card || !e.target.closest('.seq-view') || card._features) return;
    const r = e.target.closest('.r');
    editSeq(card, r ? parseInt(r.dataset.p, 10) : null);
  });

  box.addEventListener('input', e => {
    const card = e.target.closest('.chain');
    if (!card) return;
    const t = e.target;
    if (t.classList.contains('seq-edit')) onSeqInput(card, t);
    else if (t.classList.contains('chain-id')) onChainIdInput(card, t);
  });

  box.addEventListener('beforeinput', e => {
    const t = e.target;
    if (t._inline != null && t.matches('.msa-path, .tpl-path')) { t.value = ''; clearInline(t); }
  });

  box.addEventListener('change', async e => {
    const card = e.target.closest('.chain');
    const t = e.target;
    if (!card) return;
    if (t.type === 'file' && t.files[0]) {
      const file = t.files[0];
      t.value = '';
      const tpl = t.closest('.tpl');
      if (tpl) await onTplFile(card, tpl, file);
      else await onMsaFile(card, t.closest('.file-row'), file);
    } else if (t.classList.contains('tpl-chain')) {
      useTplChain(card, t.closest('.tpl'), parseInt(t.value, 10));
    }
  });

  box.addEventListener('paste', e => {
    const t = e.target;
    if (!t.classList?.contains('seq-edit')) return;
    const card = t.closest('.chain');
    if (!t.value.trim()) setTimeout(() => commitSeq(card), 0);
  });

  box.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const t = e.target;
    if (t.classList.contains('seq-edit')) { e.preventDefault(); commitSeq(t.closest('.chain')); }
    else if (t.matches('.chain-id, .chain-label')) t.blur();
  });

  box.addEventListener('focusout', e => {
    const t = e.target;
    if (!t.classList?.contains('seq-edit')) return;
    const card = t.closest('.chain');
    if (e.relatedTarget?.closest?.('.seq-msg')) return;
    setTimeout(() => { if (document.activeElement !== t) commitSeq(card); }, 0);
  });

  // residue tooltip and pair highlight
  box.addEventListener('mouseover', e => {
    const r = e.target.closest('.r');
    if (!r) { hideTip(); return; }
    const card = r.closest('.chain');
    const p = parseInt(r.dataset.p, 10);
    const tips = card._tips?.get(p) || [];
    showTip(`<b>${r.textContent}${p}</b>${tips.map(t => `<span>${esc(t)}</span>`).join('')}`, e);
    const pid = (r.dataset.k || '').split(' ')[0];
    setHot(pid ? document.querySelector(`.row[data-pid="${pid}"]`) : null, !!pid);
  });
  box.addEventListener('mousemove', moveTip);
  box.addEventListener('mouseleave', () => { hideTip(); setHot(null, false); });

  // drag to reorder
  let dragged = null;
  box.addEventListener('mousedown', e => {
    const card = e.target.closest('.chain');
    if (card) card.draggable = !!e.target.closest('.grip');
  });
  box.addEventListener('dragstart', e => {
    const card = e.target.closest?.('.chain');
    if (!card?.draggable) return;
    dragged = card;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', cardId(card));
  });
  box.addEventListener('dragover', e => {
    if (!dragged) return;
    const card = e.target.closest('.chain');
    if (!card || card === dragged) return;
    e.preventDefault();
    const r = card.getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) card.before(dragged);
    else card.after(dragged);
  });
  box.addEventListener('dragend', () => {
    if (!dragged) return;
    dragged.classList.remove('dragging');
    dragged.draggable = false;
    dragged = null;
    refreshChainSels();
    touch();
  });
}

function initRows() {
  const xl = $('xlGroups');
  xl.addEventListener('click', e => {
    const g = e.target.closest('.xl');
    if (!g) return;
    activeXl = g;
    if (e.target.closest('.xl-del')) { g.remove(); activeXl = null; }
    else if (e.target.closest('.xl-add')) addXlPair(g).querySelector('.p1').focus();
    touch();
  });
  xl.addEventListener('focusin', e => {
    const g = e.target.closest('.xl');
    if (g && g !== activeXl) { activeXl = g; touch(); }
  });
  xl.addEventListener('change', e => {
    if (e.target.classList.contains('xl-name')) syncXlHead(e.target.closest('.xl'));
  });
  xl.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.target.classList.contains('pos')) return;
    const row = e.target.closest('.pair');
    if (e.target.classList.contains('p1')) { row.querySelector('.p2').focus(); return; }
    const next = row.nextElementSibling || addXlPair(row.closest('.xl'));
    next.querySelector('.p1').focus();
  });
  xl.addEventListener('paste', e => {
    const row = e.target.closest?.('.pair');
    if (!row) return;
    const pairs = parsePairLines(e.clipboardData?.getData('text') || '');
    if (!pairs) return;
    e.preventDefault();
    const g = row.closest('.xl');
    if (!row.querySelector('.p1').value && !row.querySelector('.p2').value) row.remove();
    pairs.forEach(p => addXlPair(g, p, false));
    refreshChainSels(g);
    touch();
  });

  // shared by crosslink, disulfide and bond rows
  document.addEventListener('click', e => {
    const x = e.target.closest('.row-x');
    if (!x) return;
    x.closest('.row').remove();
    touch();
  });
  document.addEventListener('change', e => {
    if (e.target.classList?.contains('chain-sel')) { e.target.dataset.v = e.target.value; touch(); }
  });
  document.addEventListener('mouseover', e => {
    const row = e.target.closest?.('.row.pair, .row.ss');
    if (row) setHot(row, true);
    else if (!e.target.closest?.('.r, .xl-arc-group')) setHot(null, false);
  });

  $('addXlBtn').addEventListener('click', () => addXlGroup().querySelector('.p1').focus());
  $('addMoreBtn').addEventListener('click', e => openMenu(e.currentTarget, [
    { label: 'Disulfide bond', hint: 'Cys–Cys', onClick: () => reveal(addSs()) },
    { label: 'Bonded atom pair', hint: 'Covalent ligand, glycan', onClick: () => reveal(addBond()) },
    { label: 'Custom ligand definition', hint: 'Your own CCD mmCIF', onClick: showCcdSec },
  ]));
  $('addSsBtn').addEventListener('click', () => addSs().querySelector('.p1').focus());
  $('addBondBtn').addEventListener('click', () => addBond().querySelector('.ra').focus());

  $('userCCD').addEventListener('input', syncCcd);
  $('userCCDPath').addEventListener('input', syncCcd);
  $('userCCDFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    $('userCCDPath').value = '';
    $('userCCD').value = await readFileText(file);
    e.target.value = '';
    syncCcd();
    touch();
  });
  $('ccdRemoveBtn').addEventListener('click', () => {
    $('ccdSec').hidden = true;
    $('userCCD').value = '';
    $('userCCDPath').value = '';
    syncCcd();
    touch();
  });
}

function initDiagram() {
  const svg = $('arc-svg');
  const groupOf = e => e.target.closest?.('.xl-arc-group');
  svg.addEventListener('mouseover', e => {
    const g = groupOf(e);
    if (!g) { hideTip(); return; }
    showTip(`<span>${esc(g.getAttribute('data-label'))}</span>`, e);
    setHot(pairRowByKey(g.getAttribute('data-key')), true);
  });
  svg.addEventListener('mousemove', moveTip);
  svg.addEventListener('mouseleave', () => { hideTip(); setHot(null, false); });
  svg.addEventListener('click', e => {
    const g = groupOf(e);
    const row = g && pairRowByKey(g.getAttribute('data-key'));
    if (row) { row.scrollIntoView({ behavior: 'smooth', block: 'center' }); flash(row); }
  });
  $('expandDiagramBtn').addEventListener('click', () => {
    const { chains, groups, ss } = diagramData(current.model);
    openInteractiveTopology(chains, groups, ss);
  });
}

function initDrop() {
  const overlay = $('dropOverlay');
  let depth = 0;
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', e => { if (hasFiles(e)) { depth++; overlay.hidden = false; } });
  window.addEventListener('dragleave', e => { if (hasFiles(e) && --depth <= 0) { depth = 0; overlay.hidden = true; } });
  window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    overlay.hidden = true;
    [...e.dataTransfer.files].forEach(handleFile);
  });
}

function init() {
  initModals();
  initDropdowns();
  initImportModal();
  initPdbModal();
  try { initInteractiveTopology(); } catch (e) { console.warn('diagram init', e); }
  initChains();
  initRows();
  initDiagram();
  initDrop();

  // any edit anywhere → refresh
  document.addEventListener('input', touch);
  document.addEventListener('change', touch);

  document.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
    const card = addChain(b.dataset.add);
    card.querySelector('.seq-edit:not([hidden]), .lig-input')?.focus();
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }));
  $('chainFileBtn').addEventListener('click', () => pickFile('chainFileInput'));
  $('xlCsvBtn').addEventListener('click', () => pickFile('csvFileInput'));
  $('importBtn').addEventListener('click', () => pickFile('anyFileInput'));
  ['anyFileInput', 'chainFileInput'].forEach(id => $(id).addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); }));
  $('csvFileInput').addEventListener('change', async e => { if (e.target.files[0]) importCsv(await readFileText(e.target.files[0])); });

  $('newBtn').addEventListener('click', newJob);
  $('helpBtn').addEventListener('click', openHelp);
  $('themeBtn').addEventListener('click', toggleTheme);
  $('paletteBtn').addEventListener('click', openPalette);
  $('jobMoreBtn').addEventListener('click', openJobMenu);

  $('downloadBtn').addEventListener('click', () => {
    if (isBlocked()) showBlockers();
    else download(`${safeName(current.json.name)}.json`, jsonText());
  });
  $('copyBtn').addEventListener('click', () => (isBlocked() ? showBlockers() : copyJson()));
  $('downloadMoreBtn').addEventListener('click', e => isBlocked() ? showBlockers() : openMenu(e.currentTarget, [
    { label: 'One job per crosslink', hint: 'ZIP', onClick: () => { document.querySelector('input[name="batchMode"][value="single"]').checked = true; openBatch(); } },
    { label: 'Random crosslink subsets', hint: 'ZIP', onClick: () => { document.querySelector('input[name="batchMode"][value="combo"]').checked = true; openBatch(); } },
  ], { align: 'right' }));
  $('batch-modal').addEventListener('input', syncBatch);
  $('batchGo').addEventListener('click', runBatch);

  const details = $('jsonDetails');
  try { details.open = localStorage.getItem(LS_JSON_OPEN) === '1'; } catch { /* ignore */ }
  details.addEventListener('toggle', () => {
    try { localStorage.setItem(LS_JSON_OPEN, details.open ? '1' : '0'); } catch { /* ignore */ }
    renderJson();
  });

  $('ptmSearch').addEventListener('input', renderPtm);
  $('ptmSearch').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('ptmList').querySelector('.ptm-item')?.click();
  });
  $('pickBarCancel').addEventListener('click', clearPending);

  document.addEventListener('keydown', e => {
    const typing = e.target.matches?.('input, textarea, select') || e.target.isContentEditable;
    if (e.key === 'Escape') { clearPending(); return; }
    if (anyModalOpen()) return;
    if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      openPalette();
    }
  });
  // starting to type somewhere ends a residue pick
  document.addEventListener('focusin', e => {
    if (pending && e.target.matches?.('input, textarea, select') && !e.target.closest('.modal, .popover')) clearPending();
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(touch, 120);
  });

  if (restoreSession()) {
    toast('Restored your last session', { action: { label: 'Start new', fn: newJob }, ms: 6000 });
  } else {
    addChain('protein', {}, { guess: true });
  }
  refresh();
  if (location.hash === '#help') openHelp();

  // for automated tests
  window._testApi = {
    loadJson,
    json: () => { refresh(); return current.json; },
    issues: () => { refresh(); return current.issues.map(i => ({ level: i.level, msg: i.msg })); },
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
