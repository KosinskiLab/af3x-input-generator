/**
 * CSV import module — parses xiVIEW / xiNET crosslink CSVs in the browser.
 *
 * Only xiNET and xiVIEW CSV exports are supported. Other search-engine
 * formats (pLink, MeroX, XlinkX, MS Annika, Scout, MaxQuant/MaxLynx, …)
 * must be converted to one of these formats by the user beforehand —
 * no external/local conversion server is contacted.
 *
 * No external libraries required; handles quoted fields and semicolon-
 * delimited ambiguous assignments natively.
 */

import { CROSSLINKERS } from './data.js';
import { toast, showModal, hideModal } from './ui.js';

// ─── CSV parsing ──────────────────────────────────────────────────────────────

/** Parse a CSV string → array of row objects. Handles quoted fields. */
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return [];

  const headers = _splitRow(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = _splitRow(line);
    const row = {};
    headers.forEach((h, idx) => { row[h.trim()] = (cells[idx] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

function _splitRow(line) {
  const cells = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuote = !inQuote;
    } else if (c === ',' && !inQuote) {
      cells.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells;
}

// ─── Format detection ─────────────────────────────────────────────────────────

/**
 * Returns 'xiview' | 'xinet' | 'generic' | 'unknown' based on column names.
 */
export function detectFormat(headers) {
  const h = new Set(headers.map(x => x.trim()));
  if (h.has('AbsPos1') && h.has('AbsPos2')) return 'xiview';
  if (h.has('LinkPos1') && h.has('LinkPos2')) return 'xinet';
  if (h.has('Protein1') && h.has('Protein2')) return 'generic';
  return 'unknown';
}

// ─── Row → crosslink pair ─────────────────────────────────────────────────────

function _splitMulti(field) {
  if (!field) return [];
  return field.split(';').map(s => s.trim()).filter(Boolean);
}

function _parseXiviewRow(row) {
  const proteins1 = _splitMulti(row['Protein1']);
  const proteins2 = _splitMulti(row['Protein2']);
  const pos1s     = _splitMulti(row['AbsPos1']).map(Number);
  const pos2s     = _splitMulti(row['AbsPos2']).map(Number);
  const score     = parseFloat(row['Score']) || null;
  const isDecoy   = row['Decoy1'] === 'true' || row['Decoy2'] === 'true' ||
                    row['Decoy1'] === 'TRUE' || row['Decoy2'] === 'TRUE';
  const linkType  = row['LinkType'] || row['Link-Type'] || '';

  const p1 = proteins1[0] || '';
  const p2 = proteins2[0] || '';
  const r1 = pos1s[0]   || null;
  const r2 = pos2s[0]   || null;
  if (p1 && p2 && r1 && r2) {
    return [{ protein1: p1, pos1: r1, protein2: p2, pos2: r2,
              score, isDecoy, linkType, ambiguous: proteins1.length > 1 || proteins2.length > 1 }];
  }
  return [];
}

function _parseXinetRow(row) {
  const proteins1 = _splitMulti(row['Protein1']);
  const proteins2 = _splitMulti(row['Protein2']);
  const score     = parseFloat(row['Score']) || null;
  const linkType  = row['LinkType'] || row['Link-Type'] || '';
  const isDecoy   = false;

  function absPos(idx) {
    const pepKey  = `PepPos${idx}`;
    const linkKey = `LinkPos${idx}`;
    const pepRaw  = row[pepKey];
    const linkRaw = row[linkKey];
    const pepList  = pepRaw  ? _splitMulti(pepRaw).map(Number)  : [0];
    const linkList = linkRaw ? _splitMulti(linkRaw).map(Number) : [0];
    const pep  = pepList[0]  || 0;
    const link = linkList[0] || 0;
    return pepRaw ? pep + link : link;
  }

  const p1 = proteins1[0] || '';
  const p2 = proteins2[0] || '';
  const r1 = absPos(1);
  const r2 = absPos(2);
  if (p1 && p2 && r1 && r2) {
    return [{ protein1: p1, pos1: r1, protein2: p2, pos2: r2,
               score, isDecoy, linkType, ambiguous: proteins1.length > 1 || proteins2.length > 1 }];
  }
  return [];
}

function _parseGenericRow(row, col1, col2) {
  const p1 = (row['Protein1'] || '').trim();
  const p2 = (row['Protein2'] || '').trim();
  const r1 = parseInt(row[col1]) || null;
  const r2 = parseInt(row[col2]) || null;
  const score = parseFloat(row['Score']) || null;
  if (p1 && p2 && r1 && r2) {
    return [{ protein1: p1, pos1: r1, protein2: p2, pos2: r2, score, isDecoy: false, linkType: '' }];
  }
  return [];
}

// ─── Main parse function ──────────────────────────────────────────────────────

/**
 * Parse CSV text → { format, pairs, proteins, headers }.
 * genericCols = { col1, col2 } for manual column mapping (optional).
 */
export function parseCSVFile(text, genericCols = null) {
  const rows    = parseCSV(text);
  if (!rows.length) return null;
  const headers = Object.keys(rows[0]);
  const format  = detectFormat(headers);
  const pairs   = [];

  for (const row of rows) {
    let rowPairs = [];
    if (format === 'xiview') {
      rowPairs = _parseXiviewRow(row);
    } else if (format === 'xinet') {
      rowPairs = _parseXinetRow(row);
    } else if (format === 'generic' && genericCols) {
      rowPairs = _parseGenericRow(row, genericCols.col1, genericCols.col2);
    }
    pairs.push(...rowPairs);
  }

  const proteins = [...new Set(pairs.flatMap(p => [p.protein1, p.protein2]))].sort();
  return { format, pairs, proteins, headers };
}

// ─── Import Modal state ───────────────────────────────────────────────────────

let _modalData        = null;  // { format, pairs, proteins, headers }
let _onImport         = null;  // callback
let _genericCols      = { col1: '', col2: '' };
let _fetchedSequences = {};    // protein → sequence string
let _chains           = [];    // existing protein chains: [{ id, label, hasSeq }]
let _nextFreeIds      = n => Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));

// ─── Open modal ───────────────────────────────────────────────────────────────

/**
 * Open the CSV import modal (xiVIEW / xiNET only).
 * chains: existing protein chains [{ id, label, hasSeq }]; nextFreeIds(n): unused chain IDs.
 * onImport(pairs, xlName, proteinToChain, sequences)
 */
export function openImportModal(csvText, onImport, chains = [], nextFreeIds = null) {
  _onImport = onImport;
  _genericCols = { col1: '', col2: '' };
  _chains = chains;
  if (nextFreeIds) _nextFreeIds = nextFreeIds;
  _fetchedSequences = {};

  const raw = parseCSVFile(csvText);
  if (!raw || raw.format === 'unknown' || !raw.pairs.length) {
    toast('Not an xiVIEW or xiNET CSV. Convert other formats first, for example with pyXLMS.', { type: 'error' });
    return;
  }

  _modalData = raw;
  _showMainContent(raw);
  showModal('csv-modal');
}

// ─── Render main import content ───────────────────────────────────────────────

function _showMainContent(data) {
  const { format, pairs, proteins } = data;

  document.getElementById('csvFormatBadge').textContent = format === 'xiview' ? 'xiVIEW' : 'xiNET';
  document.getElementById('csvTotalCount').textContent = `${pairs.length} pairs`;
  document.getElementById('csvMinScore').value = '';
  document.getElementById('csvOnlyInter').checked = false;
  document.getElementById('csvSelectAll').checked = true;

  _renderProteinMapping(proteins);
  _renderCsvCrosslinkerSelect();
  _applyFiltersAndRender();

  document.getElementById('csvMinScore').oninput = _applyFiltersAndRender;
  document.getElementById('csvExcludeDecoys').onchange = _applyFiltersAndRender;
  document.getElementById('csvOnlyInter').onchange = _applyFiltersAndRender;
  document.getElementById('csvSelectAll').onchange = _toggleSelectAll;
}

// ─── Protein mapping ──────────────────────────────────────────────────────────

function _renderProteinMapping(proteins) {
  const container = document.getElementById('csvProteinMapping');
  container.innerHTML = '';

  const hasUniProt = proteins.some(p => _extractUniprotAcc(p) !== null);
  const defaults = _defaultMapping(proteins);

  const headerRow = document.createElement('div');
  headerRow.className = 'mapping-header-row';

  const selectAllCb = document.createElement('input');
  selectAllCb.type = 'checkbox';
  selectAllCb.id = 'mappingSelectAll';
  selectAllCb.checked = true;
  const selectAllLabel = document.createElement('label');
  selectAllLabel.htmlFor = 'mappingSelectAll';
  selectAllLabel.textContent = 'All';
  selectAllLabel.className = 'mapping-select-all-label';
  headerRow.appendChild(selectAllCb);
  headerRow.appendChild(selectAllLabel);

  if (hasUniProt) {
    const fetchBtn = document.createElement('button');
    fetchBtn.className = 'btn sm fetch-all-uniprot-btn';
    fetchBtn.textContent = 'Fetch sequences from UniProt';
    fetchBtn.title = 'Fills chains that have no sequence yet';
    fetchBtn.addEventListener('click', () => _fetchAllSequences(container, proteins));
    const fetchStatus = document.createElement('span');
    fetchStatus.className = 'fetch-all-status';
    headerRow.appendChild(fetchBtn);
    headerRow.appendChild(fetchStatus);
  }
  container.appendChild(headerRow);

  proteins.forEach((prot, i) => {
    const acc = _extractUniprotAcc(prot);
    const row = document.createElement('div');
    row.className = 'mapping-row';
    row.dataset.protein = prot;

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'mapping-protein-cb';
    cb.checked = true;
    cb.dataset.protein = prot;
    cb.addEventListener('change', () => {
      _setProteinRowEnabled(row, cb.checked);
      _applyFiltersAndRender();
      _syncMappingSelectAll(container);
    });

    const label = document.createElement('span');
    label.className = 'mapping-protein-name';
    label.textContent = shortProteinName(prot);
    label.title = prot;

    const arrow = document.createElement('span');
    arrow.className = 'mapping-arrow';
    arrow.textContent = '→';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'mapping-chain-input';
    input.placeholder = 'ID';
    input.setAttribute('aria-label', 'Chain ID');
    input.dataset.protein = prot;
    input.value = defaults[prot];
    input.maxLength = 4;
    input.spellcheck = false;
    input.addEventListener('input', () => { input.value = input.value.toUpperCase().replace(/[^A-Z]/g, ''); });

    row.appendChild(cb);
    row.appendChild(label);
    row.appendChild(arrow);
    row.appendChild(input);

    if (acc) {
      const status = document.createElement('span');
      status.className = 'fetch-status';
      status.dataset.protein = prot;
      row.appendChild(status);
    } else {
      row.appendChild(Object.assign(document.createElement('span'), { className: 'fetch-status-pad' }));
    }

    container.appendChild(row);
  });

  selectAllCb.addEventListener('change', () => {
    container.querySelectorAll('.mapping-protein-cb').forEach(cb => {
      cb.checked = selectAllCb.checked;
      const r = cb.closest('.mapping-row');
      if (r) _setProteinRowEnabled(r, cb.checked);
    });
    _applyFiltersAndRender();
  });
}

/** Proteins that match an existing chain by name keep it; the rest get unused IDs. */
function _defaultMapping(proteins) {
  const map = {};
  const taken = new Set();
  const norm = s => String(s || '').toLowerCase();
  for (const prot of proteins) {
    const names = [norm(shortProteinName(prot)), norm(_extractUniprotAcc(prot)), norm(prot)].filter(Boolean);
    const hit = _chains.find(c => c.label && !taken.has(c.id) && names.includes(norm(c.label)));
    if (hit) { map[prot] = hit.id; taken.add(hit.id); }
  }
  const rest = proteins.filter(p => !map[p]);
  // with no names to go by, existing chains without a match are used in order
  const unnamed = _chains.filter(c => !taken.has(c.id) && !c.label);
  const fresh = _nextFreeIds(rest.length);
  rest.forEach(p => { map[p] = unnamed.length ? unnamed.shift().id : fresh.shift(); });
  return map;
}

function _setProteinRowEnabled(row, enabled) {
  row.classList.toggle('mapping-row-disabled', !enabled);
  const input = row.querySelector('.mapping-chain-input');
  if (input) input.disabled = !enabled;
}

function _syncMappingSelectAll(container) {
  const all     = container.querySelectorAll('.mapping-protein-cb');
  const checked = container.querySelectorAll('.mapping-protein-cb:checked');
  const cb = document.getElementById('mappingSelectAll');
  if (!cb) return;
  cb.indeterminate = checked.length > 0 && checked.length < all.length;
  cb.checked = checked.length === all.length;
}

function _getSelectedProteins() {
  const selected = new Set();
  document.querySelectorAll('#csvProteinMapping .mapping-protein-cb:checked').forEach(cb => {
    selected.add(cb.dataset.protein);
  });
  return selected;
}

// ─── Crosslinker select ───────────────────────────────────────────────────────

function _renderCsvCrosslinkerSelect() {
  const sel = document.getElementById('csvCrosslinkerSelect');
  sel.innerHTML = '';
  CROSSLINKERS.forEach(xl => {
    if (xl.dynamic) return;
    const opt = document.createElement('option');
    opt.value = xl.name;
    opt.textContent = xl.name + (xl.symmetric ? '' : ' (asymmetric)');
    sel.appendChild(opt);
  });
  ['LINK', 'RIGID'].forEach(type => {
    const opt = document.createElement('option');
    opt.value = type + '_dynamic';
    opt.textContent = `${type} n`;
    sel.appendChild(opt);
  });

  sel.onchange = () => {
    const isDyn = sel.value.endsWith('_dynamic');
    document.getElementById('csvDynamicN').hidden = !isDyn;
    _checkAsymmetricWarning(sel.value);
  };
  document.getElementById('csvDynamicN').hidden = true;
  _checkAsymmetricWarning(sel.value);
}

function _checkAsymmetricWarning(xlName) {
  const xl   = CROSSLINKERS.find(x => x.name === xlName);
  const warn = document.getElementById('csvAsymWarning');
  const asym = !!(xl && !xl.symmetric && !xl.dynamic);
  warn.hidden = !asym;
  warn.textContent = asym ? 'The NHS-ester end is put first in the JSON.' : '';
}

// ─── Table ────────────────────────────────────────────────────────────────────

function _applyFiltersAndRender() {
  const minScore      = parseFloat(document.getElementById('csvMinScore').value) || -Infinity;
  const excludeDecoys = document.getElementById('csvExcludeDecoys').checked;
  const onlyInter     = document.getElementById('csvOnlyInter').checked;
  const selectedProts = _getSelectedProteins();

  const filtered = _modalData.pairs.filter(p => {
    if (excludeDecoys && p.isDecoy) return false;
    if (p.score !== null && p.score < minScore) return false;
    if (onlyInter && p.protein1 === p.protein2) return false;
    if (!selectedProts.has(p.protein1) || !selectedProts.has(p.protein2)) return false;
    return true;
  });

  _renderTable(filtered);
}

function _renderTable(pairs) {
  const tbody = document.getElementById('csvTableBody');
  tbody.innerHTML = '';

  pairs.forEach(pair => {
    const tr = document.createElement('tr');

    const tdCheck = document.createElement('td');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'pair-checkbox';
    cb.checked = true;
    cb.onchange = _updateSelectedCount;
    tdCheck.appendChild(cb);

    const cols = [
      shortProteinName(pair.protein1),
      pair.pos1,
      shortProteinName(pair.protein2),
      pair.pos2,
      pair.score !== null ? pair.score.toFixed(3) : '—',
      pair.linkType || '—',
    ];

    tr.appendChild(tdCheck);
    cols.forEach(val => {
      const td = document.createElement('td');
      td.textContent = val;
      if (pair.ambiguous) { td.classList.add('ambiguous'); td.title = 'Ambiguous: the first protein match is used'; }
      tr.appendChild(td);
    });

    tr._pairData = pair;
    tbody.appendChild(tr);
  });

  _updateSelectedCount();
}

function _toggleSelectAll() {
  const checked = document.getElementById('csvSelectAll').checked;
  document.querySelectorAll('#csvTableBody .pair-checkbox').forEach(cb => { cb.checked = checked; });
  _updateSelectedCount();
}

function _updateSelectedCount() {
  const total    = document.querySelectorAll('#csvTableBody .pair-checkbox').length;
  const selected = document.querySelectorAll('#csvTableBody .pair-checkbox:checked').length;
  document.getElementById('csvSelectedCount').textContent = `${selected} of ${total} selected`;
  document.getElementById('csvImportConfirm').disabled = selected === 0;
}

// ─── Confirm / Cancel ─────────────────────────────────────────────────────────

function _buildProteinToChain() {
  const map = {};
  document.querySelectorAll('#csvProteinMapping .mapping-chain-input').forEach(input => {
    if (input.disabled) return;
    const prot  = input.dataset.protein;
    const chain = input.value.trim();
    if (prot && chain) map[prot] = chain;
  });
  return map;
}

function _resolveXlName() {
  const val = document.getElementById('csvCrosslinkerSelect').value;
  if (val.endsWith('_dynamic')) {
    const base = val.replace('_dynamic', '');
    const n    = parseInt(document.getElementById('csvDynamicN').value) || 5;
    return base + n;
  }
  return val;
}

export function initImportModal() {
  document.getElementById('csvImportConfirm').onclick = _confirmImport;
}

function _closeModal() {
  hideModal('csv-modal');
  _modalData = null;
  _fetchedSequences = {};
}

function _confirmImport() {
  if (!_modalData || !_onImport) return;

  const rows     = document.querySelectorAll('#csvTableBody tr');
  const selected = [];
  rows.forEach(tr => {
    const cb = tr.querySelector('.pair-checkbox');
    if (cb && cb.checked && tr._pairData) selected.push(tr._pairData);
  });

  if (selected.length === 0) return;

  const proteinToChain = _buildProteinToChain();
  const xlName         = _resolveXlName();

  const missing = [...new Set(selected.flatMap(p => [p.protein1, p.protein2]))]
    .filter(prot => !proteinToChain[prot]);
  if (missing.length > 0) {
    toast(`Give a chain ID to ${missing.map(shortProteinName).join(', ')}`, { type: 'error' });
    return;
  }

  _onImport(selected, xlName, proteinToChain, { ..._fetchedSequences });
  _closeModal();
}

// ─── UniProt sequence fetch ───────────────────────────────────────────────────

function _extractUniprotAcc(name) {
  if (!name) return null;
  const parts = name.split('|');
  if (parts.length >= 3 && (parts[0] === 'sp' || parts[0] === 'tr')) return parts[1];
  if (/^[OPQ][0-9][A-Z0-9]{3}[0-9]$|^[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}$/.test(name)) return name;
  return null;
}

function _extractFastaSeq(text) {
  const lines = text.split('\n');
  let seq = '';
  for (const line of lines) {
    const l = line.trim();
    if (!l || l.startsWith('>') || l.startsWith(';')) continue;
    seq += l.toUpperCase();
  }
  return seq || null;
}

async function _fetchAllSequences(container, proteins) {
  const btn       = container.querySelector('.fetch-all-uniprot-btn');
  const allStatus = container.querySelector('.fetch-all-status');
  if (btn) btn.disabled = true;
  if (allStatus) { allStatus.textContent = 'Fetching…'; allStatus.style.color = ''; }

  // Only fetch for proteins whose checkbox is currently checked
  const selectedProts = new Set();
  container.querySelectorAll('.mapping-protein-cb:checked').forEach(cb => {
    selectedProts.add(cb.dataset.protein);
  });

  const uniProtProteins = proteins.filter(p =>
    _extractUniprotAcc(p) !== null && selectedProts.has(p)
  );

  await Promise.all(uniProtProteins.map(async prot => {
    const acc      = _extractUniprotAcc(prot);
    const statusEl = container.querySelector(`.fetch-status[data-protein="${CSS.escape(prot)}"]`);
    if (statusEl) { statusEl.textContent = '…'; statusEl.style.color = 'var(--text-3)'; }

    try {
      const res = await fetch(`https://rest.uniprot.org/uniprotkb/${acc}.fasta`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const seq  = _extractFastaSeq(text);
      if (!seq) throw new Error('empty response');
      _fetchedSequences[prot] = seq;
      if (statusEl) { statusEl.textContent = `${seq.length} aa`; statusEl.style.color = 'var(--ok)'; }
    } catch (e) {
      if (statusEl) { statusEl.textContent = 'not found'; statusEl.style.color = 'var(--danger)'; }
    }
  }));

  const nOk = uniProtProteins.filter(p => _fetchedSequences[p]).length;
  if (allStatus) {
    allStatus.textContent = `${nOk} of ${uniProtProteins.length} fetched`;
    allStatus.style.color = nOk === uniProtProteins.length ? 'var(--ok)' : 'var(--warn)';
  }
  if (btn) btn.disabled = false;
}

// ─── Utility ─────────────────────────────────────────────────────────────────

export function shortProteinName(name) {
  if (!name) return '';
  const parts = name.split('|');
  if (parts.length === 3) return parts[2];
  return parts[parts.length - 1];
}
