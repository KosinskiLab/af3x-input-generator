/**
 * AF3x Input Generator — main application
 *
 * Manages the form state, sequence cards, crosslink groups, disulfide bonds,
 * PTM picker, JSON generation, JSON import, and coordinates the arc diagram.
 */

import { CROSSLINKERS, PTM_DATABASE, PTM_CATEGORIES, chainColorForType, XL_GROUP_COLORS, MOD_GROUP_COLORS, XL_DASH_PATTERNS } from './data.js';
import { drawArcDiagram } from './viz.js';
import { openImportModal, initImportModal, _shortProteinName } from './csv_import.js';
import { openPdbModal, initPdbModal, extractAtomSequences, isMmcifText, pdbToMmcif } from './pdb_import.js';
import { updateXlStats } from './xl_stats.js';
import { openInteractiveTopology, initInteractiveTopology, resetTopologyView } from './topology_interactive.js';

// ─── State ────────────────────────────────────────────────────────────────────

let _seqCounter = 0;   // unique id for each sequence entity
let _xlCounter  = 0;   // unique id for each crosslink group
let _ssCounter  = 0;   // unique id for each disulfide bond
let _bondCounter = 0;  // unique id for each bonded atom pair

// active PTM picker context
let _ptmContext = null;  // { seqId, modIdx }

// XL residue pick state (click-to-add-XL in sequence display)
let _xlPickMode  = false; // true when "Select XL residues" button is active
let _xlPickState = null;  // null | { chainId, pos, spanEl }
let _xlPendingPair = null; // null | { c1, p1, c2, p2 } — waiting for popup confirmation

// Modification residue pick state
let _modPickState = null; // null | { seqId, row, targetAA }

// Disulfide bond residue pick state
let _ssPickState = null; // null | { row, slot: 'a'|'b' }

// XL pair row residue pick state (per-row pick button)
let _xlRowPickState = null; // null | { row, slot: 'a'|'b' }

// ─── Initialisation ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  _initCrosslinkPresets();
  _initPTMModal();
  _initJsonImport();
  initImportModal();
  initPdbModal();
  try { initInteractiveTopology(); } catch (e) { console.warn('topology init:', e); }
  window._resetTopologyView = resetTopologyView;

  // Add-entity buttons
  document.querySelectorAll('.btn-add-entity').forEach(btn => {
    btn.addEventListener('click', () => addSequenceCard(btn.dataset.seqtype));
  });

  // Crosslinks section
  document.getElementById('addCrosslinkGroupBtn').addEventListener('click', addCrosslinkGroup);
  document.getElementById('crosslinkerPresetsBtn').addEventListener('click', _togglePresetsDropdown);

  // Disulfide bonds
  document.getElementById('addSsBondBtn').addEventListener('click', addSsBond);

  // Bonded atom pairs
  document.getElementById('addBondBtn').addEventListener('click', addBond);

  // Generate + copy + download
  document.getElementById('generateBtn').addEventListener('click', generateJSON);
  document.getElementById('copyJsonBtn').addEventListener('click', _copyJSON);
  document.getElementById('expandJsonBtn').addEventListener('click', () => {
    document.getElementById('jsonOutputExpanded').textContent = document.getElementById('jsonOutput').textContent;
    document.getElementById('json-modal').style.display = 'flex';
  });
  document.getElementById('jsonModalCopy').addEventListener('click', _copyJSON);

  // Batch export
  document.getElementById('batchSingleBtn').addEventListener('click', _batchSingleXL);
  document.getElementById('batchComboBtn').addEventListener('click', _batchRandomCombos);
  document.getElementById('batchComboK').addEventListener('input', _updateBatchInfo);
  document.getElementById('batchComboM').addEventListener('input', _updateBatchInfo);
  document.getElementById('batchPanel').addEventListener('toggle', _updateBatchInfo);

  // Reset button
  document.getElementById('resetBtn').addEventListener('click', resetAll);

  // Theme toggle
  _initThemeToggle();

  // Intro / overview banner
  _initIntroBanner();

  // User CCD: content vs path are mutually exclusive
  _initUserCcdExclusivity();

  // Global tooltips for .label-hint "?" icons (event delegation — covers dynamically added ones)
  _initLabelHints();


  // JSON import button
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFileInput').click();
  });
  document.getElementById('importFileInput').addEventListener('change', _handleJsonImport);

  // CSV import button (from crosslinks section)
  document.getElementById('importCsvBtn').addEventListener('click', () => {
    document.getElementById('csvFileInput').click();
  });
  document.getElementById('csvFileInput').addEventListener('change', _handleCsvFile);

  // Expand interactive topology
  document.getElementById('expandTopologyBtn').addEventListener('click', () => {
    const chains   = _readChainsFromDOM();
    const xlGroups = _readXlGroupsFromDOM();
    const ssBonds  = _readSsBondsFromDOM();
    openInteractiveTopology(chains, xlGroups, ssBonds);
  });

  // Import from ▾ dropdown
  const importFromBtn  = document.getElementById('importFromBtn');
  const importDropdown = document.getElementById('import-dropdown');
  importFromBtn?.addEventListener('click', e => {
    e.stopPropagation();
    const open = importDropdown.style.display !== 'none';
    importDropdown.style.display = open ? 'none' : 'block';
  });
  document.addEventListener('click', () => { if (importDropdown) importDropdown.style.display = 'none'; });

  document.getElementById('importPdbBtn').addEventListener('click', () => {
    importDropdown.style.display = 'none';
    document.getElementById('pdbFileInput').click();
  });
  document.getElementById('importFastaBtn').addEventListener('click', () => {
    importDropdown.style.display = 'none';
    document.getElementById('fasta-import-file-input').click();
  });
  document.getElementById('importUniprotBtn').addEventListener('click', () => {
    importDropdown.style.display = 'none';
    _openUniprotModal();
  });

  document.getElementById('pdbFileInput').addEventListener('change', _handlePdbFile);

  // "Select XL residues" toggle button
  document.getElementById('selectXlBtn')?.addEventListener('click', _toggleXlPickMode);

  // XL pick: ESC cancels everything, banner cancel button
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (_modPickState)     { _exitModPickMode();    return; }
      if (_ssPickState)      { _exitSsPickMode();     return; }
      if (_xlRowPickState)   { _exitXlRowPickMode();  return; }
      if (_xlPendingPair)    { _closePendingPair();   return; }
      if (_xlPickState)      { _clearPickState();     return; }
      if (_xlPickMode)       { _toggleXlPickMode(); }
    }
  });
  document.getElementById('xl-pick-cancel-btn')?.addEventListener('click', () => {
    _clearPickState();
    if (_xlRowPickState) _exitXlRowPickMode();
    if (_xlPickMode) _toggleXlPickMode();
  });

  // XL confirm popup buttons
  document.getElementById('xlConfirmCancelBtn')?.addEventListener('click', _closePendingPair);
  document.getElementById('xlConfirmAddBtn')?.addEventListener('click', _commitXlFromPopup);

  // Enable/disable group select based on radio
  document.querySelectorAll('input[name="xlConfirmMode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const existing = document.getElementById('xlModeExisting').checked;
      document.getElementById('xlConfirmGroupSel').disabled = !existing;
      document.getElementById('xlConfirmXlSel').disabled    = existing;
    });
  });

  // Seed mode toggle
  document.querySelectorAll('.seed-seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seed-seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const isCount = btn.dataset.mode === 'count';
      document.getElementById('seedCount').style.display    = isCount ? '' : 'none';
      document.getElementById('seedSpecific').style.display = isCount ? 'none' : '';
    });
  });

  // Global FASTA import
  _initGlobalFastaImport();

  // Sequence card reordering
  _initSeqReorder();

  // UniProt import modal
  _initUniprotModal();

  // AlphaFold Server import modal
  _initServerImportModal();

  // localStorage restore banner
  _checkRestoreSession();

  // Close dropdown on outside click
  document.addEventListener('click', e => {
    const dd = document.getElementById('presets-dropdown');
    if (!dd.contains(e.target) && e.target.id !== 'crosslinkerPresetsBtn') {
      dd.style.display = 'none';
    }
  });

  // Start with one protein sequence
  addSequenceCard('protein');

  // Expose internals for automated testing (harmless in production)
  window._testApi = { populateFromJSON: _populateFromJSON };

  // Re-render sequence displays when window is resized
  let _resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
      document.querySelectorAll('.seq-card').forEach(card => {
        const display = card.querySelector('.seq-display');
        if (display && display.style.display !== 'none') _updateRuler(card);
      });
    }, 150);
  });

  // Tab switching
  document.querySelectorAll('.app-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.app-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.querySelector('.main-layout').style.display  = tab === 'build' ? '' : 'none';
      document.getElementById('about-panel').style.display  = tab === 'about' ? '' : 'none';
    });
  });

  // Build about crosslinker table
  _buildAboutXlTable();
});

function _buildAboutXlTable() {
  const wrap = document.getElementById('about-xl-table-wrap');
  if (!wrap) return;
  const rows = CROSSLINKERS.map(xl => {
    const reactText = xl.dynamic ? '—'
      : xl.symmetric
        ? (xl.reactiveResidues || []).join(', ')
        : `<span style="color:var(--text-2)">End 1:</span> ${xl.reactiveResidues[0].join(', ')}<br><span style="color:var(--text-2)">End 2:</span> ${xl.reactiveResidues[1].join(', ')}`;
    const badge = xl.dynamic
      ? `<span class="xl-ref-dyn">dynamic</span>`
      : xl.symmetric
        ? `<span class="xl-ref-sym">symmetric</span>`
        : `<span class="xl-ref-asym">asymmetric</span>`;
    return `<tr>
      <td class="xl-ref-name">${xl.name}</td>
      <td>${xl.category}</td>
      <td class="xl-ref-spacer">${xl.spacer || '—'}</td>
      <td>${reactText}</td>
      <td>${badge}</td>
      <td>${xl.description || ''}</td>
    </tr>`;
  }).join('');
  wrap.innerHTML = `
    <table class="xl-ref-table">
      <thead><tr>
        <th>Name</th><th>Category</th><th>Spacer</th><th>Reactive residues</th><th>Type</th><th>Description</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ─── Sequence Cards ───────────────────────────────────────────────────────────

// Per-type counters so chains of the same type cycle through that type's own
// colour family (see chainColorForType in data.js) instead of a single global rotation.
const _typeColorCounters = { protein: 0, rna: 0, dna: 0, ligand: 0 };

export function addSequenceCard(type) {
  _seqCounter++;
  const id = `seq_${_seqCounter}`;

  const typeIdx = _typeColorCounters[type] ?? 0;
  _typeColorCounters[type] = typeIdx + 1;
  const color = chainColorForType(type, typeIdx);

  const card = document.createElement('div');
  card.className  = 'seq-card';
  card.dataset.id = id;
  card.dataset.color = color;
  card.dataset.type = type;
  card.style.setProperty('--chain-color', color);

  card.innerHTML = `
    <div class="seq-card-main">

      <div class="seq-left">
        <span class="drag-handle" title="Drag to reorder">⠿</span>
        <span class="seq-type-badge" style="background:${color}">${_typeLabel(type)}</span>
        <span class="seq-type-label">${_typeLabel(type)}</span>
        <div class="seq-chain-id-wrap">
          <label>Chain ID</label>
          <input type="text" class="seq-chain-id" placeholder="A" value="${_nextChainId()}"
                 autocomplete="off" spellcheck="false" data-seqid="${id}" maxlength="4">
          <span class="chain-id-dup-warn" style="display:none" title="Duplicate chain ID">⚠</span>
          <span class="chain-id-multi-warn" style="display:none" title="Use separate cards for multiple chains">One ID only</span>
        </div>
        <span class="seq-length-hint"></span>
        <button class="btn-copy-chain" data-seqid="${id}" title="Duplicate chain (new chain ID, no crosslinks)">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.6"/>
            <path d="M3 11H2.5A1.5 1.5 0 0 1 1 9.5v-7A1.5 1.5 0 0 1 2.5 1h7A1.5 1.5 0 0 1 11 2.5V3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
          Duplicate
        </button>
      </div>

      <div class="seq-right">
        ${_sequenceInputBlock(type, id)}
      </div>

      <div class="seq-actions">
        <button class="btn-icon btn-remove-seq" data-seqid="${id}" title="Remove">✕</button>
      </div>

    </div>

    <details class="seq-advanced">
      <summary>Advanced options <span class="seq-advanced-sub" data-seqid="${id}">${_advancedSubLabel(type)}</span></summary>
      ${_advancedBlock(type, id)}
    </details>
  `;

  // Wire input mode tabs and interactive elements
  _wireSeqInputTabs(card, type, id);

  // Drag-to-reorder: only activate when mousedown on the handle
  const handle = card.querySelector('.drag-handle');
  if (handle) {
    handle.addEventListener('mousedown', () => { card.draggable = true; });
    card.addEventListener('dragend', () => { card.draggable = false; });
  }

  card.querySelector('.btn-copy-chain').addEventListener('click', () => {
    const seq = card.querySelector('.seq-textarea')?.value || '';
    addSequenceCard(type);
    // The new card is the last one — fill in the sequence / ligand data
    const all  = document.querySelectorAll('#sequences-container .seq-card');
    const copy = all[all.length - 1];
    if (!copy) return;
    if (type === 'ligand') {
      // Copy whichever ligand input tab is active
      const activePanel = card.querySelector('.ligand-body .tab-panel.active');
      const panelKey    = activePanel?.dataset.panel || 'ccd';
      const srcVal      = activePanel?.querySelector('input')?.value || '';
      if (srcVal) {
        // Switch copy card to the same tab first
        const copyTabBtn = copy.querySelector(`.tab-btn[data-tab="${panelKey}"]`);
        if (copyTabBtn) copyTabBtn.click();
        const destInput = copy.querySelector(`.ligand-body .tab-panel[data-panel="${panelKey}"] input`);
        if (destInput) {
          destInput.value = srcVal;
          destInput.dispatchEvent(new Event('input'));
        }
      }
    } else {
      const ta = copy.querySelector('.seq-textarea');
      if (ta && seq) {
        ta.value = seq;
        _autoValidateSeq(ta, type);
        _updateRuler(copy);
      }
    }
  });

  card.querySelector('.btn-remove-seq').addEventListener('click', () => {
    card.remove();
    _updateSeqCount();
    updateViz();
  });

  card.querySelector('.seq-chain-id').addEventListener('input', function() {
    const warn = card.querySelector('.chain-id-multi-warn');
    if (this.value.includes(',') || this.value.includes(' ')) {
      this.value = this.value.replace(/[,\s]+/g, '');
      if (warn) { warn.style.display = ''; setTimeout(() => { warn.style.display = 'none'; }, 2000); }
    }
    updateViz();
  });

  document.getElementById('sequences-container').appendChild(card);
  _updateSeqCount();
  updateViz();
  _updateAdvancedSummary(id);
}

function _typeLabel(type) {
  return { protein: 'Protein', rna: 'RNA', dna: 'DNA', ligand: 'Ligand' }[type] || type;
}

function _nextChainId() {
  const used = new Set();
  document.querySelectorAll('.seq-chain-id').forEach(el => {
    el.value.split(',').map(s => s.trim()).forEach(c => used.add(c));
  });
  for (let i = 0; i < 26; i++) {
    const c = String.fromCharCode(65 + i);
    if (!used.has(c)) return c;
  }
  return 'A';
}

function _updateSeqCount() {
  const n = document.querySelectorAll('.seq-card').length;
  document.getElementById('seqCountBadge').textContent = n;

  const hasLigand = !!document.querySelector('.seq-card[data-type="ligand"]');
  const ccdSection = document.getElementById('userCcdSection');
  if (ccdSection) ccdSection.style.display = hasLigand ? '' : 'none';
}

function _sequenceInputBlock(type, id) {
  if (type === 'ligand') {
    return `
      <div class="seq-body ligand-body">
        <div class="input-tabs">
          <button class="tab-btn active" data-tab="ccd">CCD Codes</button>
          <button class="tab-btn" data-tab="smiles">SMILES</button>
        </div>
        <div class="tab-panel active" data-panel="ccd">
          <input type="text" class="ligand-ccd seq-validated" placeholder="e.g. ATP or ATP,ADP"
                 data-seqid="${id}" autocomplete="off">
          <span class="seq-hint">Comma-separated CCD codes from the wwPDB Chemical Component Dictionary</span>
        </div>
        <div class="tab-panel" data-panel="smiles" style="display:none">
          <input type="text" class="ligand-smiles seq-validated"
                 placeholder="e.g. CC(=O)Oc1ccccc1C(=O)O" data-seqid="${id}" autocomplete="off">
          <span class="seq-hint">SMILES string (cannot define covalent bonds with SMILES)</span>
        </div>
      </div>`;
  }

  const placeholder = type === 'protein'
    ? 'MKVLWAALLVTFLAGCQAKVEQAVEDANSQATRVCEKMFEASYSRVEDVYASPKLQNLFKDPQYILINTTESYTLDADMKIAQEKKTSFQKLTENFQKLENFMLNKFKKNLKDTFEALKNVSKLKL'
    : type === 'rna' ? 'AGCUAGCUAGCU' : 'ACGTACGTACGT';

  return `
    <div class="seq-body">
      <div class="tab-panel active" data-panel="text">
        <div class="seq-editor-wrap">
          <pre class="seq-display" title="Click to edit"></pre>
          <textarea class="seq-textarea seq-validated"
                    placeholder="${placeholder}"
                    data-seqid="${id}" spellcheck="false"></textarea>
        </div>
        <div class="seq-meta"><span class="seq-val-msg"></span></div>
      </div>
    </div>`;
}

function _advancedSubLabel(type) {
  if (type === 'ligand') return '';
  if (type === 'dna')    return '— Mods: 0';
  if (type === 'rna')    return '— Mods: 0 · MSA: Auto';
  return '— Mods: 0 · MSA: Auto · Templates: 0';
}

const _MSA_MODE_LABELS = { auto: 'Auto', custom: 'Custom', none: 'None' };

/** Returns 'none' | 'custom' | 'auto' for a chain's MSA, derived from actual
 *  field state (within the given seq-card) rather than a UI mode toggle. */
function _getMsaMode(card) {
  if (card.querySelector('.no-msa-check')?.checked) return 'none';
  const hasValue = sel => [...card.querySelectorAll(sel)].some(el => el.value.trim());
  const hasCustom =
    hasValue('.msa-unpaired-path, .msa-unpaired-content') ||
    hasValue('.msa-paired-path, .msa-paired-content');
  return hasCustom ? 'custom' : 'auto';
}

/** Updates the live "— Mods: N · MSA: X · Templates: N" summary shown next to
 *  "Advanced options" so users can see what's configured without expanding it. */
function _updateAdvancedSummary(seqId) {
  const card  = document.querySelector(`.seq-card[data-id="${seqId}"]`);
  const subEl = card?.querySelector('.seq-advanced-sub');
  if (!subEl) return;

  const parts = [];

  const modsCount = card.querySelectorAll(`.mods-container[data-seqid="${seqId}"] .mod-row`).length;
  parts.push(`Mods: ${modsCount}`);

  if (card.querySelector(`.no-msa-check[data-seqid="${seqId}"]`)) {
    parts.push(`MSA: ${_MSA_MODE_LABELS[_getMsaMode(card)]}`);
  }

  const tplContainer = card.querySelector(`.tpl-container[data-seqid="${seqId}"]`);
  let hasTemplates = false;
  if (tplContainer) {
    const noTpl = card.querySelector('.no-templates-check')?.checked;
    hasTemplates = !noTpl && tplContainer.querySelectorAll('.tpl-entry').length > 0;
    parts.push(noTpl ? 'Templates: off' : `Templates: ${tplContainer.querySelectorAll('.tpl-entry').length}`);
  }

  // AF3x rejects chains with custom templates but MSA left on Auto — it must
  // be set explicitly either way (see _getMsaMode). Surface that early.
  const warnEl = card.querySelector(`.msa-tpl-warning[data-seqid="${seqId}"]`);
  if (warnEl) warnEl.style.display = (hasTemplates && _getMsaMode(card) === 'auto') ? '' : 'none';

  subEl.textContent = parts.length ? `— ${parts.join(' · ')}` : '';
}

function _advancedBlock(type, id) {
  const descSection = `
    <div class="adv-section">
      <label class="adv-label" for="desc_${id}">Description
        <span class="label-hint" data-tip="Free-text comment for this chain — purely cosmetic, not used by AF3x for prediction. Completely optional; leave blank if you don't need it.">?</span>
      </label>
      <input type="text" class="seq-description" id="desc_${id}" data-seqid="${id}"
             placeholder="Optional — e.g. &quot;bait protein&quot; (not used by AF3x, just a label in the JSON)">
    </div>`;

  if (type === 'ligand') return descSection;

  const modLabel = type === 'protein' ? 'Post-translational Modification' : 'Base Modifications';
  const modSection = `
    <div class="adv-section">
      <div class="adv-section-header">
        <span>${modLabel}
          <span class="label-hint" data-tip="Post-translational modifications (e.g. phosphorylation, methylation) or RNA/DNA base modifications applied at a specific residue position. Click ⋯ on a row to search by name or CCD code.">?</span>
        </span>
        <div class="adv-section-actions"></div>
        <button class="btn btn-outline btn-xs add-mod-btn" data-seqid="${id}">+ Add PTM</button>
      </div>
      <div class="mods-container" data-seqid="${id}"></div>
    </div>`;

  // DNA has no MSA support per AF3x spec
  const msaSection = type === 'dna' ? '' : `
    <div class="adv-section">
      <div class="adv-section-header">
        <span>MSA
          <span class="label-hint" data-tip="Multiple Sequence Alignment — homologous sequences AF3 uses for coevolution signal. By default AF3 searches and builds it for you (recommended). Without MSA: skip it entirely (faster, but usually lower accuracy). Add custom MSA: supply your own pre-computed .a3m file(s) instead of letting AF3 search.">?</span>
        </span>
        <div class="adv-section-actions">
          <label class="no-tpl-label no-msa-label" title="Sets unpairedMsa/pairedMsa to '' — disables MSA search/usage for this chain">
            <input type="checkbox" class="no-msa-check" data-seqid="${id}">
            Without MSA
          </label>
        </div>
        <button class="btn btn-outline btn-xs add-msa-btn" data-seqid="${id}">+ Add custom MSA</button>
      </div>
      <p class="adv-hint no-msa-hint" data-seqid="${id}">If no custom MSA is added, AF3 searches automatically.</p>
      <div class="msa-custom-wrap subsection" data-seqid="${id}" style="display:none">
        <div class="tpl-entry-header">
          <span class="tpl-entry-title">Custom MSA</span>
          <button class="btn-icon remove-msa-btn" data-seqid="${id}" title="Remove custom MSA">✕</button>
        </div>
        <div class="msa-file-row">
          <span class="msa-file-label">Unpaired</span>
          <input type="text" class="msa-unpaired-path"
                 placeholder="/path/to/MSAs_A_unpaired.a3m" data-seqid="${id}">
          <label class="btn btn-ghost btn-xs msa-upload-label" title="Upload .a3m file — content is embedded inline in JSON">
            Upload MSA file <input type="file" class="msa-unpaired-file" accept=".a3m,.txt" data-seqid="${id}" style="display:none">
          </label>
          <textarea class="msa-unpaired-content" style="display:none" data-seqid="${id}"></textarea>
        </div>
        ${type === 'protein' ? `
        <div class="msa-file-row">
          <span class="msa-file-label">Paired</span>
          <input type="text" class="msa-paired-path"
                 placeholder="/path/to/MSAs_A_paired.a3m" data-seqid="${id}">
          <label class="btn btn-ghost btn-xs msa-upload-label" title="Upload .a3m file — content is embedded inline in JSON">
            Upload MSA file <input type="file" class="msa-paired-file" accept=".a3m,.txt" data-seqid="${id}" style="display:none">
          </label>
          <textarea class="msa-paired-content" style="display:none" data-seqid="${id}"></textarea>
        </div>` : ''}
        <p class="adv-hint msa-path-hint">Enter a file path for cluster use
          (<code>unpairedMsaPath</code>), or upload a local .a3m file
          (embedded inline as <code>unpairedMsa</code>). Path takes priority over upload.</p>
        <p class="msa-val-msg" data-seqid="${id}" style="display:none"></p>
      </div>
    </div>`;

  const tplSection = type === 'protein' ? `
    <div class="adv-section">
      <div class="adv-section-header">
        <span>Structural Templates
          <span class="label-hint" data-tip="Known structures of homologous proteins AF3 can use to guide folding. Leave empty for AF3 to search automatically, add specific ones manually, or check 'Without templates' to disable template search for this chain entirely.">?</span>
        </span>
        <div class="adv-section-actions">
          <label class="no-tpl-label" title="Output templates:[] — disables AF3 template search for this chain">
            <input type="checkbox" class="no-templates-check" data-seqid="${id}">
            Without templates
          </label>
        </div>
        <button class="btn btn-outline btn-xs add-tpl-btn" data-seqid="${id}">+ Add template</button>
      </div>
      <p class="adv-hint no-tpl-hint" data-seqid="${id}">If no templates are added, AF3 searches automatically.</p>
      <p class="adv-hint msa-tpl-warning" data-seqid="${id}" style="display:none; color:var(--danger)">
        ⚠ AF3x rejects this: when a chain has custom templates, MSA can't be left on Auto — it
        must also be set explicitly. Pick <strong>Without MSA</strong> or add a custom MSA above.
      </p>
      <div class="tpl-container" data-seqid="${id}"></div>
    </div>` : '';

  return descSection + modSection + msaSection + tplSection;
}

// ── Tab wiring (input modes) ──────────────────────────────────────────────────

function _wireSeqInputTabs(card, type, id) {
  const tabs   = card.querySelectorAll('.input-tabs .tab-btn');
  const panels = card.querySelectorAll('.tab-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => { p.style.display = 'none'; p.classList.remove('active'); });
      tab.classList.add('active');
      const panel = card.querySelector(`.tab-panel[data-panel="${tab.dataset.tab}"]`);
      if (panel) { panel.style.display = 'block'; panel.classList.add('active'); }
    });
  });

  // Sequence textarea: edit mode + auto-uppercase
  const seqTA   = card.querySelector('.seq-textarea');
  const display = card.querySelector('.seq-display');

  // Initial state: textarea visible (no sequence yet), display hidden
  if (display) display.style.display = 'none';

  if (seqTA) {
    let _upperTimer = null;

    // While typing: resize textarea, validate, update viz — stay in edit mode
    seqTA.addEventListener('input', () => {
      seqTA.style.height = 'auto';
      seqTA.style.height = seqTA.scrollHeight + 'px';
      _autoValidateSeq(seqTA, type);
      updateViz();

      // Auto-uppercase after 1.5 s of no typing
      clearTimeout(_upperTimer);
      _upperTimer = setTimeout(() => {
        const upper = seqTA.value.toUpperCase();
        if (seqTA.value !== upper) {
          const pos = seqTA.selectionStart;
          seqTA.value = upper;
          seqTA.setSelectionRange(pos, pos);
          _autoValidateSeq(seqTA, type);
          seqTA.style.height = 'auto';
          seqTA.style.height = seqTA.scrollHeight + 'px';
        }
      }, 1500);
    });

    // On blur: switch to formatted display mode
    seqTA.addEventListener('blur', () => _updateRuler(card));
  }

  // Click display → residue selection (only in pick mode) OR enter edit mode
  if (display && seqTA) {
    display.addEventListener('click', e => {
      const resSpan = e.target.closest('.seq-res');

      // SS bond residue pick mode: first click → slot A, second click → slot B + close
      if (resSpan && _ssPickState) {
        e.stopPropagation();
        const pos      = parseInt(resSpan.dataset.pos);
        const chainIds = (display.dataset.chainId || '').split(',').filter(Boolean);
        if (pos && chainIds.length) {
          const { row, slot } = _ssPickState;
          row.querySelector(`.ss-chain-${slot}`).value = chainIds[0];
          row.querySelector(`.ss-pos-${slot}`).value   = pos;
          if (slot === 'a') {
            _ssPickState.slot = 'b';  // advance to second residue
            document.querySelectorAll('.seq-card').forEach(c => _updateRuler(c));
          } else {
            _exitSsPickMode();
          }
          updateViz();
        }
        return;
      }

      // XL pair row pick mode: first click → END1 (chain-a / pos-a), second → END2 + close
      if (resSpan && _xlRowPickState) {
        e.stopPropagation();
        const pos      = parseInt(resSpan.dataset.pos);
        const chainIds = (display.dataset.chainId || '').split(',').filter(Boolean);
        if (pos && chainIds.length) {
          const { row, slot } = _xlRowPickState;
          const suffix = slot === 'a' ? 'a' : 'b';
          row.querySelector(`.xl-chain-${suffix}`).value = chainIds[0];
          row.querySelector(`.xl-pos-${suffix}`).value   = pos;
          if (slot === 'a') {
            _xlRowPickState.slot = 'b';
            const textEl = document.getElementById('xl-pick-banner-text');
            if (textEl) textEl.textContent = `${chainIds[0]}:${pos} — click second residue (END2)`;
          } else {
            _exitXlRowPickMode();
          }
          updateViz();
        }
        return;
      }

      // Mod residue pick mode: clicking a residue fills the position input
      if (resSpan && _modPickState?.seqId === id) {
        e.stopPropagation();
        const pos = parseInt(resSpan.dataset.pos);
        if (pos) {
          const posEl = _modPickState.row.querySelector('.mod-pos');
          const warnEl = _modPickState.row.querySelector('.mod-pos-warn');
          const ccd = (_modPickState.row.querySelector('.mod-ccd')?.value || '').trim().toUpperCase();
          if (posEl) posEl.value = pos;
          _validateModRow(ccd, pos, id, warnEl);
          _exitModPickMode();
        }
        return;
      }

      if (resSpan && (_xlPickMode || _xlPickState)) {
        e.stopPropagation();
        const pos      = parseInt(resSpan.dataset.pos);
        const chainIds = (display.dataset.chainId || '').split(',').filter(Boolean);
        if (pos && chainIds.length) _handleResidueClick(chainIds[0], pos, resSpan);
        return;
      }
      // Background click in pick mode: cancel pending state only, don't enter edit mode
      if (_xlPickState) { _clearPickState(); return; }
      // Normal: enter edit mode
      display.style.display = 'none';
      seqTA.style.display   = 'block';
      seqTA.style.height    = 'auto';
      seqTA.style.height    = seqTA.scrollHeight + 'px';
      seqTA.focus();
    });

    // Tooltip for XL- and PTM-highlighted residues, and residue position in pick mode
    const tooltip = document.getElementById('arc-tooltip');
    display.addEventListener('mouseover', e => {
      const resSpan = e.target.closest('.seq-res');
      const xlHl    = e.target.closest('.xl-hl');
      const modHl   = e.target.closest('.mod-valid, .mod-selected');
      if (!tooltip) return;

      if (xlHl && xlHl.dataset.xlInfo) {
        tooltip.innerHTML = `<span class="tip-text">${xlHl.dataset.xlInfo.replace(/\n/g,'<br>')}</span>`;
        tooltip.style.display = 'block';
      } else if (modHl && modHl.dataset.modInfo) {
        tooltip.innerHTML = `<span class="tip-text">${modHl.dataset.modInfo}</span>`;
        tooltip.style.display = 'block';
      } else if (resSpan) {
        const pos      = resSpan.dataset.pos;
        const chainId  = (display.dataset.chainId || '').split(',')[0];
        const aa       = resSpan.textContent;
        const posLabel = chainId ? `${chainId} · ${pos}` : `pos ${pos}`;
        const color    = getComputedStyle(display.closest('.seq-card') || document.body)
                           .getPropertyValue('--chain-color').trim() || 'var(--primary)';
        tooltip.style.setProperty('--tip-chain-color', color);
        tooltip.innerHTML = `<span class="tip-res-aa">${aa}</span><span class="tip-res-pos">${posLabel}</span>`;
        tooltip.style.display = 'block';
      } else {
        tooltip.style.display = 'none';
      }
    });
    display.addEventListener('mousemove', e => {
      if (tooltip && tooltip.style.display === 'block') {
        tooltip.style.left = (e.clientX + 16) + 'px';
        tooltip.style.top  = (e.clientY - 32) + 'px';
      }
    });
    display.addEventListener('mouseleave', () => {
      if (tooltip) tooltip.style.display = 'none';
    });
  }

  // Ligand CCD/SMILES tabs
  if (type === 'ligand') {
    const ltabs = card.querySelectorAll('.ligand-body .tab-btn');
    const lpanels = card.querySelectorAll('.ligand-body .tab-panel');
    ltabs.forEach(tab => {
      tab.addEventListener('click', () => {
        ltabs.forEach(t => t.classList.remove('active'));
        lpanels.forEach(p => { p.style.display = 'none'; p.classList.remove('active'); });
        tab.classList.add('active');
        const panel = card.querySelector(`.ligand-body .tab-panel[data-panel="${tab.dataset.tab}"]`);
        if (panel) { panel.style.display = 'block'; panel.classList.add('active'); }
      });
    });
    return;
  }

  // Auto-detect FASTA paste in the sequence textarea
  const seqTa = card.querySelector('.seq-textarea');
  if (seqTa) {
    seqTa.addEventListener('paste', e => {
      // On next tick, check if pasted content looks like FASTA
      setTimeout(() => {
        if (seqTa.value.trimStart().startsWith('>') || seqTa.value.trimStart().startsWith(';')) {
          const entries = _parseFastaAll(seqTa.value);
          if (entries.length === 1) {
            seqTa.value = entries[0].seq;
            _autoValidateSeq(seqTa, type);
            _updateRuler(card);
            updateViz();
          } else if (entries.length > 1) {
            seqTa.value = '';
            _showFastaSelectModal(entries, card);
          }
        }
      }, 0);
    });
  }

  // Modification button
  const addModBtn = card.querySelector('.add-mod-btn');
  if (addModBtn) {
    addModBtn.addEventListener('click', () => {
      _openPTMPicker(id, null);
    });
  }

  // Template button
  const addTplBtn = card.querySelector('.add-tpl-btn');
  if (addTplBtn) {
    addTplBtn.addEventListener('click', () => _addTemplate(card, id));
  }

  // "Without templates" checkbox
  const noTplCheck = card.querySelector('.no-templates-check');
  if (noTplCheck) {
    const _applyNoTpl = () => {
      const off = noTplCheck.checked;
      if (addTplBtn) addTplBtn.disabled = off;
      const hint = card.querySelector('.no-tpl-hint');
      if (hint) hint.textContent = off
        ? 'Template search disabled for this chain (templates: [] in JSON).'
        : 'If no templates are added, AF3 searches automatically.';
      const tplContainer = card.querySelector('.tpl-container');
      if (tplContainer) tplContainer.style.opacity = off ? '0.35' : '';
      _updateAdvancedSummary(id);
    };
    noTplCheck.addEventListener('change', _applyNoTpl);
    _applyNoTpl();
  }

  // MSA: "+ Add custom MSA" / "Without MSA" / remove
  const msaCustomWrap = card.querySelector(`.msa-custom-wrap[data-seqid="${id}"]`);
  const addMsaBtn     = card.querySelector(`.add-msa-btn[data-seqid="${id}"]`);
  const noMsaCheck    = card.querySelector(`.no-msa-check[data-seqid="${id}"]`);

  if (msaCustomWrap) {
    if (addMsaBtn) {
      addMsaBtn.addEventListener('click', () => {
        msaCustomWrap.style.display = 'block';
        if (noMsaCheck && noMsaCheck.checked) {
          noMsaCheck.checked = false;
          noMsaCheck.dispatchEvent(new Event('change'));
        }
        _updateAdvancedSummary(id);
      });
    }

    const removeMsaBtn = card.querySelector(`.remove-msa-btn[data-seqid="${id}"]`);
    if (removeMsaBtn) {
      removeMsaBtn.addEventListener('click', () => {
        msaCustomWrap.style.display = 'none';
        card.querySelectorAll(
          `.msa-unpaired-path[data-seqid="${id}"], .msa-unpaired-content[data-seqid="${id}"],
           .msa-paired-path[data-seqid="${id}"], .msa-paired-content[data-seqid="${id}"]`
        ).forEach(el => { el.value = ''; delete el.dataset.isUpload; });
        _updateAdvancedSummary(id);
      });
    }

    if (noMsaCheck) {
      const _applyNoMsa = () => {
        const off = noMsaCheck.checked;
        if (addMsaBtn) addMsaBtn.disabled = off;
        const hint = card.querySelector(`.no-msa-hint[data-seqid="${id}"]`);
        if (hint) hint.textContent = off
          ? 'MSA disabled for this chain (unpairedMsa/pairedMsa: "" in JSON).'
          : 'If no custom MSA is added, AF3 searches automatically.';
        if (off) msaCustomWrap.style.display = 'none';
        _updateAdvancedSummary(id);
      };
      noMsaCheck.addEventListener('change', _applyNoMsa);
      _applyNoMsa();
    }

    // File upload: unpaired
    const _showMsaVal = (msgs, isError) => {
      const el = card.querySelector(`.msa-val-msg[data-seqid="${id}"]`);
      if (!el) return;
      if (!msgs.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
      el.style.display = 'block';
      el.style.color   = isError ? 'var(--danger)' : 'var(--warning, #b45309)';
      el.innerHTML     = msgs.map(m => `<div>${isError ? '✗' : '⚠'} ${m}</div>`).join('');
    };

    const _runMsaValidation = (a3mText, label) => {
      const chainSeq = (card.querySelector('.seq-textarea')?.value || '').replace(/\s/g, '').toUpperCase();
      const { errors, warnings } = _validateA3m(a3mText, chainSeq || null);
      if (errors.length)        _showMsaVal(errors.map(e => `${label}: ${e}`), true);
      else if (warnings.length) _showMsaVal(warnings.map(w => `${label}: ${w}`), false);
      else                      _showMsaVal([], false);
    };

    const unpairedFile = card.querySelector('.msa-unpaired-file');
    if (unpairedFile) {
      unpairedFile.addEventListener('change', () => {
        const file = unpairedFile.files[0];
        if (!file) return;
        const pathInput   = card.querySelector('.msa-unpaired-path');
        const contentArea = card.querySelector('.msa-unpaired-content');
        const reader = new FileReader();
        reader.onload = e => {
          if (pathInput)   { pathInput.value = file.name; pathInput.dataset.isUpload = 'true'; }
          if (contentArea) contentArea.value = e.target.result;
          _runMsaValidation(e.target.result, 'Unpaired MSA');
          _updateAdvancedSummary(id);
        };
        reader.readAsText(file);
      });
    }

    // File upload: paired
    const pairedFile = card.querySelector('.msa-paired-file');
    if (pairedFile) {
      pairedFile.addEventListener('change', () => {
        const file = pairedFile.files[0];
        if (!file) return;
        const pathInput   = card.querySelector('.msa-paired-path');
        const contentArea = card.querySelector('.msa-paired-content');
        const reader = new FileReader();
        reader.onload = e => {
          if (pathInput)   { pathInput.value = file.name; pathInput.dataset.isUpload = 'true'; }
          if (contentArea) contentArea.value = e.target.result;
          _runMsaValidation(e.target.result, 'Paired MSA');
          _updateAdvancedSummary(id);
        };
        reader.readAsText(file);
      });
    }

    // Clear isUpload flag when user manually edits the path
    card.querySelectorAll('.msa-unpaired-path, .msa-paired-path').forEach(inp => {
      inp.addEventListener('input', () => {
        delete inp.dataset.isUpload;
        _updateAdvancedSummary(id);
      });
    });
  }
}

// ── Sequence helpers ──────────────────────────────────────────────────────────

function _extractFasta(text) {
  const lines = text.split('\n');
  let seq = '';
  for (const line of lines) {
    const l = line.trim();
    if (!l || l.startsWith('>') || l.startsWith(';')) continue;
    seq += l.toUpperCase();
  }
  return seq || null;
}

function _parseFastaAll(text) {
  const entries = [];
  let current = null;
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (l.startsWith('>') || l.startsWith(';')) {
      if (current && current.seq) entries.push(current);
      current = { header: l.slice(1).trim(), seq: '' };
    } else if (l && current) {
      current.seq += l.toUpperCase().replace(/[^A-Za-z]/g, '');
    }
  }
  if (current && current.seq) entries.push(current);
  return entries;
}

function _showFastaSelectModal(entries, targetCard) {
  const modal = document.getElementById('fasta-select-modal');
  if (!modal) return;

  const isSingle = !!targetCard;
  const list     = modal.querySelector('#fasta-select-list');
  const title    = modal.querySelector('#fasta-select-title');
  const confirmBtn = modal.querySelector('#fasta-select-confirm');
  if (!list || !confirmBtn) return;

  if (title) title.textContent = isSingle
    ? 'Multiple sequences found — select one to import:'
    : `${entries.length} sequence${entries.length > 1 ? 's' : ''} found — select which to import:`;

  list.innerHTML = entries.map((e, i) => `
    <label class="fasta-select-row">
      <input type="${isSingle ? 'radio' : 'checkbox'}" name="fasta-seq-pick" value="${i}" checked>
      <span class="fasta-seq-header" title="${e.header || ''}">${e.header || `Sequence ${i + 1}`}</span>
      <span class="fasta-seq-len">${e.seq.length} aa</span>
    </label>
  `).join('');

  modal.dataset.targetCard = targetCard ? targetCard.dataset.seqid || '' : '';
  modal._fastaEntries = entries;
  modal._isSingle     = isSingle;

  modal.style.display = 'flex';

  confirmBtn.onclick = () => {
    const checked = [...list.querySelectorAll('input:checked')].map(i => parseInt(i.value));
    const selected = checked.map(i => entries[i]).filter(Boolean);
    if (!selected.length) return;

    if (isSingle) {
      _setSeqAndSwitchToText(targetCard, selected[0].seq, _cardType(targetCard));
    } else {
      _importFastaEntries(selected);
    }
    modal.style.display = 'none';
  };
}

function _cardType(card) {
  return card?.querySelector('.seq-type-label')?.textContent.toLowerCase() || 'protein';
}

function _importFastaEntries(entries) {
  entries.forEach((entry, idx) => {
    let card = null;

    // For the first entry, reuse the last card if it's still empty
    if (idx === 0) {
      const cards = document.querySelectorAll('#sequences-container .seq-card');
      const last  = cards[cards.length - 1];
      const lastTa = last?.querySelector('.seq-textarea');
      if (last && lastTa && !lastTa.value.trim()) card = last;
    }

    if (!card) {
      addSequenceCard('protein');
      const cards = document.querySelectorAll('#sequences-container .seq-card');
      card = cards[cards.length - 1];
    }
    if (!card) return;

    const ta = card.querySelector('.seq-textarea');
    if (ta) {
      ta.value = entry.seq;
      _autoValidateSeq(ta, 'protein');
      _updateRuler(card);
    }
  });
  updateViz();
}

function _initSeqReorder() {
  const container = document.getElementById('sequences-container');
  if (!container) return;

  let dragSrc = null;

  container.addEventListener('dragstart', e => {
    const card = e.target.closest('.seq-card');
    if (!card || !card.draggable) return;
    dragSrc = card;
    card.classList.add('seq-dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('dragover', e => {
    if (!dragSrc) return;
    const card = e.target.closest('.seq-card');
    if (!card || card === dragSrc) return;
    e.preventDefault();
    const mid = card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2;
    container.querySelectorAll('.seq-card').forEach(c => c.classList.remove('drag-over-top', 'drag-over-bottom'));
    card.classList.add(e.clientY < mid ? 'drag-over-top' : 'drag-over-bottom');
  });

  container.addEventListener('dragleave', e => {
    if (!e.target.closest('.seq-card')) return;
    e.target.closest('.seq-card').classList.remove('drag-over-top', 'drag-over-bottom');
  });

  container.addEventListener('drop', e => {
    if (!dragSrc) return;
    const card = e.target.closest('.seq-card');
    if (!card || card === dragSrc) { _resetDrag(container, dragSrc); return; }
    e.preventDefault();
    const mid = card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2;
    container.insertBefore(dragSrc, e.clientY < mid ? card : card.nextSibling);
    _resetDrag(container, dragSrc);
    updateViz();
  });

  container.addEventListener('dragend', () => { _resetDrag(container, dragSrc); dragSrc = null; });
}

function _resetDrag(container, dragSrc) {
  if (dragSrc) { dragSrc.draggable = false; dragSrc.classList.remove('seq-dragging'); }
  container.querySelectorAll('.seq-card').forEach(c => c.classList.remove('drag-over-top', 'drag-over-bottom'));
}

function _validateA3m(a3mText, querySeq) {
  const errors   = [];
  const warnings = [];

  // Parse entries: header lines start with '>'
  const lines   = a3mText.replace(/\r\n?/g, '\n').split('\n');
  const entries = [];
  let cur = null;
  for (const line of lines) {
    if (line.startsWith('>')) {
      if (cur) entries.push(cur);
      cur = { header: line.slice(1).trim(), seq: '' };
    } else if (cur) {
      cur.seq += line.trim();
    }
  }
  if (cur) entries.push(cur);

  if (entries.length === 0) {
    errors.push('A3M file is empty or contains no valid FASTA entries');
    return { errors, warnings };
  }

  // ── First sequence (query) checks ─────────────────────────────────────────
  const firstSeq = entries[0].seq;

  if (/[a-z]/.test(firstSeq))
    errors.push('A3M first sequence contains lowercase insertion characters — the query must be uppercase only');
  if (firstSeq.includes('-'))
    errors.push('A3M first sequence contains gap characters (-) — the query must not have gaps');

  if (querySeq) {
    const firstUpper = firstSeq.toUpperCase();
    if (firstUpper.length !== querySeq.length) {
      errors.push(`A3M first sequence length (${firstUpper.length}) does not match chain sequence length (${querySeq.length})`);
    } else if (firstUpper !== querySeq) {
      let pos = -1;
      for (let i = 0; i < querySeq.length; i++) {
        if (firstUpper[i] !== querySeq[i]) { pos = i + 1; break; }
      }
      if (pos > 0)
        errors.push(`A3M first sequence mismatch at position ${pos}: expected ${querySeq[pos-1]}, got ${firstUpper[pos-1]}`);
    }
  }

  // ── Subsequent hit checks ──────────────────────────────────────────────────
  const queryLen = querySeq ? querySeq.length : firstSeq.replace(/[a-z]/g, '').length;
  let badHits = 0;
  for (let i = 1; i < entries.length; i++) {
    const aligned = entries[i].seq.replace(/[a-z]/g, '');
    if (aligned.length !== queryLen) badHits++;
  }
  if (badHits > 0)
    warnings.push(`${badHits} MSA hit(s) have incorrect alignment length after removing insertions (expected ${queryLen} columns)`);

  return { errors, warnings };
}

function _looksLikeStructureFile(filename, text) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (['pdb', 'cif', 'mmcif', 'ent'].includes(ext)) return true;
  // Content-based fallback for extensionless or ambiguous files
  const head = text.trimStart().slice(0, 400);
  return isMmcifText(text) || /^(ATOM|HETATM|HEADER|REMARK|MODEL|COMPND|SEQRES)\s/m.test(head);
}

function _initGlobalFastaImport() {
  const input = document.getElementById('fasta-import-file-input');
  if (!input) return;

  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    input.value = '';
    const reader = new FileReader();
    reader.onload = e => _handleFastaFileContent(e.target.result);
    reader.readAsText(file);
  });

  // Global drag-and-drop on the sequences card
  const seqCard = document.getElementById('sequences-card');
  if (seqCard) {
    seqCard.addEventListener('dragover', e => { e.preventDefault(); seqCard.classList.add('fasta-drag-over'); });
    seqCard.addEventListener('dragleave', e => {
      if (!seqCard.contains(e.relatedTarget)) seqCard.classList.remove('fasta-drag-over');
    });
    seqCard.addEventListener('drop', e => {
      e.preventDefault();
      seqCard.classList.remove('fasta-drag-over');
      const file = e.dataTransfer.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const text = ev.target.result;
        if (_looksLikeStructureFile(file.name, text)) {
          openPdbModal(text, _onPdbImport);
        } else {
          _handleFastaFileContent(text);
        }
      };
      reader.readAsText(file);
    });
  }

  // Close modal on backdrop click
  const modal = document.getElementById('fasta-select-modal');
  if (modal) {
    modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
    modal.querySelector('#fasta-select-cancel')?.addEventListener('click', () => { modal.style.display = 'none'; });
  }
}

function _openUniprotModal() {
  const modal = document.getElementById('uniprot-modal');
  if (!modal) return;
  document.getElementById('uniprotModalInput').value = '';
  const status = document.getElementById('uniprotModalStatus');
  status.textContent = '';
  status.className = 'uniprot-status';
  modal.style.display = 'flex';
  document.getElementById('uniprotModalInput').focus();
}

function _initUniprotModal() {
  const modal     = document.getElementById('uniprot-modal');
  const input     = document.getElementById('uniprotModalInput');
  const fetchBtn  = document.getElementById('uniprotModalFetchBtn');
  const statusEl  = document.getElementById('uniprotModalStatus');
  if (!modal) return;

  const close = () => { modal.style.display = 'none'; };
  document.getElementById('uniprotModalClose')?.addEventListener('click', close);
  document.getElementById('uniprotModalCancel')?.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  const doFetch = async () => {
    const uniId = input.value.trim();
    if (!uniId) return;
    fetchBtn.disabled = true;
    statusEl.textContent = 'Fetching…';
    statusEl.className = 'uniprot-status loading';
    try {
      const url = `https://rest.uniprot.org/uniprotkb/${uniId}.fasta`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`UniProt returned ${res.status}`);
      const text = await res.text();
      const seq  = _extractFasta(text);
      if (!seq) throw new Error('No sequence in response');
      // Reuse existing empty protein card if there is one, otherwise add new
      const existingCards = document.querySelectorAll('#sequences-container .seq-card');
      let targetCard = null;
      for (const c of existingCards) {
        if (c.dataset.type === 'protein' && !c.querySelector('.seq-textarea')?.value.trim()) {
          targetCard = c;
          break;
        }
      }
      if (!targetCard) {
        addSequenceCard('protein');
        const all = document.querySelectorAll('#sequences-container .seq-card');
        targetCard = all[all.length - 1];
      }
      _setSeqAndSwitchToText(targetCard, seq, 'protein');
      targetCard?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      close();
    } catch (err) {
      statusEl.textContent = `✗ ${err.message}`;
      statusEl.className = 'uniprot-status error';
    } finally {
      fetchBtn.disabled = false;
    }
  };

  fetchBtn.addEventListener('click', doFetch);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doFetch(); });
}

function _handleFastaFileContent(text) {
  let entries = _parseFastaAll(text);
  // Fallback: raw sequence with no header
  if (!entries.length) {
    const seq = _extractFasta(text);
    if (seq) entries = [{ header: 'Imported sequence', seq }];
  }
  if (!entries.length) { alert('No valid FASTA sequences found in file.'); return; }
  // Always show modal so user can confirm / choose type
  _showFastaSelectModal(entries, null);
}

function _setSeqAndSwitchToText(card, seq, type) {
  const ta = card.querySelector('.seq-textarea');
  if (ta) {
    ta.value = seq;
    _autoValidateSeq(ta, type);
    _updateRuler(card);
    updateViz();
  }
  // Switch to text tab
  const textTab = card.querySelector('.tab-btn[data-tab="text"]');
  if (textTab) textTab.click();
}

async function _fetchUniProt(card, type, id) {
  const input  = card.querySelector('.uniprot-input');
  const status = card.querySelector('.uniprot-status');
  const uniId  = input.value.trim();
  if (!uniId) return;

  status.textContent = 'Fetching…';
  status.className   = 'uniprot-status loading';

  try {
    const url = `https://rest.uniprot.org/uniprotkb/${uniId}.fasta`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`UniProt returned ${res.status}`);
    const text = await res.text();
    const seq  = _extractFasta(text);
    if (!seq) throw new Error('No sequence in response');
    _setSeqAndSwitchToText(card, seq, type);
    // Also update chain-id placeholder with accession
    status.textContent = `✓ ${uniId} — ${seq.length} residues`;
    status.className   = 'uniprot-status ok';
  } catch (err) {
    status.textContent = `✗ ${err.message}`;
    status.className   = 'uniprot-status error';
  }
}

const VALID_AA  = new Set('ACDEFGHIKLMNPQRSTVWY');
const VALID_RNA = new Set('AGCU');
const VALID_DNA = new Set('ACGT');

function _autoValidateSeq(ta, type) {
  const seq = ta.value.toUpperCase().replace(/\s/g, '');
  const card = ta.closest('.seq-card');
  const lenHint = card?.querySelector('.seq-length-hint');
  const valMsg  = card?.querySelector('.seq-val-msg');

  if (!seq) {
    ta.classList.remove('valid', 'invalid');
    if (lenHint) lenHint.textContent = '';
    if (valMsg)  valMsg.textContent  = '';
    return;
  }

  const allowed = type === 'protein' ? VALID_AA : type === 'rna' ? VALID_RNA : VALID_DNA;
  const invalid = [...seq].filter(c => !allowed.has(c));

  if (lenHint) lenHint.textContent = `${seq.length} residues`;

  if (invalid.length) {
    ta.classList.remove('valid');
    ta.classList.add('invalid');
    const sample = [...new Set(invalid)].slice(0, 5).join(', ');
    if (valMsg) valMsg.textContent = `⚠ Unknown characters: ${sample}`;
  } else {
    ta.classList.remove('invalid');
    ta.classList.add('valid');
    if (valMsg) valMsg.textContent = '';
  }
}

// ── Sequence ruler ────────────────────────────────────────────────────────────

// How many residues fit per line given the container pixel width
function _calcSeqLineLen(container) {
  const w = container.clientWidth;
  if (!w) return 60;
  // JetBrains Mono 13px ≈ 7.82px per char; 24px padding; 8 chars for "     1  ".
  // A couple of safety chars are subtracted on top — better to under-fill a
  // row slightly than to overflow by a few px and trigger horizontal scroll.
  const charW      = 7.82;
  const padChars   = Math.round(24 / charW);
  const posChars   = 8;  // "     1  "
  const sepChars   = 2;  // 2 spaces between groups of 10
  const safetyChars = 3;
  const available  = Math.floor(w / charW) - padChars - posChars - safetyChars;
  // Each full group costs 10 chars + 2 spaces separator (except last)
  // Approximate: available / (10 + sepChars) groups
  const groups = Math.max(1, Math.floor(available / (10 + sepChars)));
  return groups * 10;
}

// Format sequence as grouped, numbered display.
// xlHighlights: Map<pos → { color, info }>
// modHighlights: Map<pos → { type: 'valid'|'selected', ccd, targetAA }>
function _formatSeqHTML(raw, lineLen, xlHighlights, modHighlights) {
  const seq = raw.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (!seq) return '';
  lineLen = lineLen || 60;
  const hl    = xlHighlights  || new Map();
  const modHL = modHighlights || new Map();

  const rows = [];
  for (let i = 0; i < seq.length; i += lineLen) {
    const posLabel = String(i + 1).padStart(6);
    const chunk    = seq.slice(i, i + lineLen);
    const groups   = [];
    for (let j = 0; j < chunk.length; j += 10) {
      let groupHtml = '';
      for (let k = 0; k < 10; k++) {
        if (j + k >= chunk.length) break;
        const absPos = i + j + k + 1;
        const aa     = chunk[j + k];
        const hlInfo = hl.get(absPos);
        const modInfo = modHL.get(absPos);
        if (hlInfo) {
          const info = hlInfo.info.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
          groupHtml += `<span class="seq-res xl-hl" data-pos="${absPos}" data-xl-info="${info}" style="--hl-color:${hlInfo.color}">${aa}</span>`;
        } else if (modInfo) {
          const cls  = modInfo.type === 'selected' ? 'mod-selected' : 'mod-valid';
          const info = modInfo.type === 'selected'
            ? `${modInfo.name} (${modInfo.ccd}) @ ${absPos}`
            : `${modInfo.name} (${modInfo.ccd}) — ${modInfo.targetAA} @ ${absPos}`;
          groupHtml += `<span class="seq-res ${cls}" data-pos="${absPos}" data-mod-info="${info}" style="--mod-color:${modInfo.color}">${aa}</span>`;
        } else {
          groupHtml += `<span class="seq-res" data-pos="${absPos}">${aa}</span>`;
        }
      }
      groups.push(groupHtml);
    }
    rows.push(`<span class="seq-pos">${posLabel}</span>  ${groups.join('  ')}`);
  }
  return rows.join('\n');
}

// Assign a unique color to every individual XL pair (global index across all groups).
function _buildPairColorMap() {
  const map = new Map();
  let idx = 0;
  document.querySelectorAll('.xl-group-card').forEach(card => {
    card.querySelectorAll('.xl-pair-row').forEach(row => {
      const c1 = row.querySelector('.xl-chain-a')?.value.trim();
      const p1 = parseInt(row.querySelector('.xl-pos-a')?.value) || null;
      const c2 = row.querySelector('.xl-chain-b')?.value.trim();
      const p2 = parseInt(row.querySelector('.xl-pos-b')?.value) || null;
      if (c1 && p1 && c2 && p2) {
        map.set(`${c1}:${p1}:${c2}:${p2}`, XL_GROUP_COLORS[idx % XL_GROUP_COLORS.length]);
        idx++;
      }
    });
  });
  return map;
}

// Build a highlight map for a given chain: pos → { color, info } for each XL pair that touches it.
function _buildXlHighlights(chainId) {
  const hl         = new Map();
  const pairColors = _buildPairColorMap();
  document.querySelectorAll('.xl-group-card').forEach((card, gi) => {
    const xlName = card.querySelector('.xl-select')?.value || '';
    card.querySelectorAll('.xl-pair-row').forEach(row => {
      const c1 = row.querySelector('.xl-chain-a')?.value.trim();
      const p1 = parseInt(row.querySelector('.xl-pos-a')?.value) || null;
      const c2 = row.querySelector('.xl-chain-b')?.value.trim();
      const p2 = parseInt(row.querySelector('.xl-pos-b')?.value) || null;
      if (!c1 || !p1 || !c2 || !p2) return;
      const color    = pairColors.get(`${c1}:${p1}:${c2}:${p2}`) || XL_GROUP_COLORS[gi % XL_GROUP_COLORS.length];
      const lineInfo = `${xlName}: ${c1}:${p1} ↔ ${c2}:${p2}`;
      const addHL = pos => {
        if (!hl.has(pos)) hl.set(pos, { color, info: '' });
        const e = hl.get(pos);
        if (!e.info.includes(lineInfo)) e.info = e.info ? e.info + '\n' + lineInfo : lineInfo;
      };
      if (c1 === chainId) addHL(p1);
      if (c2 === chainId) addHL(p2);
    });
  });
  return hl;
}

function _updateRuler(card) {
  const seqTA   = card.querySelector('.seq-textarea');
  const display = card.querySelector('.seq-display');
  if (!seqTA) return;

  const seq = seqTA.value.trim();
  if (display) {
    if (seq) {
      const lineLen  = _calcSeqLineLen(seqTA.parentElement);
      const chainRaw = card.querySelector('.seq-chain-id')?.value.trim() || '';
      const chainIds = chainRaw.includes(',')
        ? chainRaw.split(',').map(s => s.trim()).filter(Boolean)
        : chainRaw ? [chainRaw] : [];
      const chainId  = chainIds[0] || '';
      display.dataset.chainId = chainIds.join(',');

      const xlHL  = chainId ? _buildXlHighlights(chainId) : new Map();
      const modHL = _buildModHighlights(card.dataset.id);
      _buildSsPickHighlights(card.dataset.id).forEach((v, k) => { if (!modHL.has(k)) modHL.set(k, v); });
      display.innerHTML     = _formatSeqHTML(seq, lineLen, xlHL, modHL);
      display.style.display = 'block';
      seqTA.style.display   = 'none';

      // Re-apply pending pick highlight if this chain has a pending residue
      if (_xlPickState && chainIds.includes(_xlPickState.chainId)) {
        const span = display.querySelector(`.seq-res[data-pos="${_xlPickState.pos}"]`);
        if (span) { span.classList.add('xl-pick-pending'); _xlPickState.spanEl = span; }
      }
    } else {
      display.style.display = 'none';
      seqTA.style.display   = 'block';
      seqTA.style.height    = 'auto';
      seqTA.style.height    = seqTA.scrollHeight + 'px';
    }
  } else {
    seqTA.style.height = 'auto';
    seqTA.style.height = seqTA.scrollHeight + 'px';
  }
}

// ── XL residue pick (click-to-add-XL) ────────────────────────────────────────

function _toggleXlPickMode() {
  if (_xlRowPickState) _exitXlRowPickMode();
  _xlPickMode = !_xlPickMode;
  const btn      = document.getElementById('selectXlBtn');
  const seqCont  = document.getElementById('sequences-container');
  btn?.classList.toggle('xl-pick-mode-on', _xlPickMode);
  seqCont?.classList.toggle('sequences-xl-pick-active', _xlPickMode);
  if (!_xlPickMode) _clearPickState();
  else _updatePickBanner();
}

// Banner stays visible for the whole time pick mode is on (not just while a
// residue is pending) so it's always obvious the picker is still active and
// normal clicks elsewhere in the page won't do what you expect.
function _updatePickBanner() {
  const banner = document.getElementById('xl-pick-banner');
  const textEl = document.getElementById('xl-pick-banner-text');
  if (!banner || !textEl) return;
  if (!_xlPickMode) { banner.classList.remove('visible'); return; }
  textEl.textContent = _xlPickState
    ? `${_xlPickState.chainId}:${_xlPickState.pos} selected — click a second residue`
    : 'XL pick mode active — click two residues to add a pair';
  banner.classList.add('visible');
}

function _clearPickState() {
  if (_xlPickState?.spanEl) {
    try { _xlPickState.spanEl.classList.remove('xl-pick-pending'); } catch {}
  }
  _xlPickState = null;
  _updatePickBanner();
}

function _closePendingPair() {
  _xlPendingPair = null;
  const popup = document.getElementById('xl-confirm-popup');
  if (popup) popup.style.display = 'none';
}

function _handleResidueClick(chainId, pos, spanEl) {
  if (!_xlPickState) {
    // First residue selected
    _xlPickState = { chainId, pos, spanEl };
    spanEl.classList.add('xl-pick-pending');
    _updatePickBanner();
  } else if (_xlPickState.chainId === chainId && _xlPickState.pos === pos) {
    _clearPickState(); // same residue: cancel
  } else {
    // Second residue: show confirmation popup
    const c1 = _xlPickState.chainId, p1 = _xlPickState.pos;
    const c2 = chainId,             p2 = pos;
    _clearPickState();
    _showXlConfirmPopup(c1, p1, c2, p2);
  }
}

function _showXlConfirmPopup(c1, p1, c2, p2) {
  _xlPendingPair = { c1, p1, c2, p2 };

  // Pair label
  const label = document.getElementById('xl-confirm-pair-label');
  if (label) label.textContent = `${c1}:${p1}  ↔  ${c2}:${p2}`;

  // Populate existing-group dropdown
  const groupSel = document.getElementById('xlConfirmGroupSel');
  if (groupSel) {
    groupSel.innerHTML = '';
    const groups = document.querySelectorAll('.xl-group-card');
    groups.forEach((card, i) => {
      const name = card.querySelector('.xl-select')?.value || `Group ${i + 1}`;
      const opt  = document.createElement('option');
      opt.value       = card.dataset.id;
      opt.textContent = `Group ${i + 1} — ${name}`;
      groupSel.appendChild(opt);
    });
    const hasGroups = groups.length > 0;
    groupSel.disabled = !hasGroups;

    // Default mode
    const modeExisting = document.getElementById('xlModeExisting');
    const modeNew      = document.getElementById('xlModeNew');
    if (modeExisting && modeNew) {
      modeExisting.checked  = hasGroups;
      modeNew.checked       = !hasGroups;
      document.getElementById('xlConfirmXlSel').disabled = hasGroups;
    }
    if (!hasGroups && modeExisting) modeExisting.disabled = true;
    else if (modeExisting) modeExisting.disabled = false;
  }

  // Populate crosslinker dropdown for new group
  const xlSel = document.getElementById('xlConfirmXlSel');
  if (xlSel && xlSel.options.length === 0) {
    CROSSLINKERS.filter(xl => !xl.dynamic).forEach(xl => {
      const opt = document.createElement('option');
      opt.value = xl.name;
      opt.textContent = xl.name;
      if (xl.name === 'DSSO') opt.selected = true;
      xlSel.appendChild(opt);
    });
  }

  const popup = document.getElementById('xl-confirm-popup');
  if (popup) popup.style.display = 'block';
}

function _commitXlFromPopup() {
  if (!_xlPendingPair) return;
  const { c1, p1, c2, p2 } = _xlPendingPair;
  _closePendingPair();

  const modeNew = document.getElementById('xlModeNew')?.checked;
  let xlCard;

  if (modeNew) {
    // Create a new XL group
    const xlName = document.getElementById('xlConfirmXlSel')?.value || 'DSSO';
    addCrosslinkGroup({ name: xlName });
    xlCard = document.querySelector('.xl-group-card:last-child');
  } else {
    // Use existing group
    const xlId = document.getElementById('xlConfirmGroupSel')?.value;
    xlCard = xlId
      ? document.querySelector(`.xl-group-card[data-id="${xlId}"]`)
      : document.querySelector('.xl-group-card');
  }

  if (!xlCard) return;
  _addXlPair(xlCard, xlCard.dataset.id, { chain1: c1, pos1: p1, chain2: c2, pos2: p2 });

  const newRow = xlCard.querySelector('.xl-pairs-container .xl-pair-row:last-child');
  if (newRow) {
    newRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    void newRow.offsetWidth;
    newRow.classList.add('xl-row-flash');
  }
  updateViz();
}

// ── Template helper ───────────────────────────────────────────────────────────

// ─── Template sequence alignment (query vs. template mmCIF chain) ─────────────
// Needleman-Wunsch global alignment, used to suggest query/template index
// mappings from the chain's pasted sequence vs. a template structure's chain.

function _needlemanWunsch(seqA, seqB, match = 2, mismatch = -1, gap = -1) {
  const n = seqA.length, m = seqB.length;
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let i = 0; i <= n; i++) dp[i][0] = i * gap;
  for (let j = 0; j <= m; j++) dp[0][j] = j * gap;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = seqA[i - 1] === seqB[j - 1] ? match : mismatch;
      dp[i][j] = Math.max(dp[i - 1][j - 1] + s, dp[i - 1][j] + gap, dp[i][j - 1] + gap);
    }
  }
  let i = n, j = m, alignedA = '', alignedB = '';
  while (i > 0 && j > 0) {
    const s = seqA[i - 1] === seqB[j - 1] ? match : mismatch;
    if (dp[i][j] === dp[i - 1][j - 1] + s) {
      alignedA = seqA[i - 1] + alignedA; alignedB = seqB[j - 1] + alignedB; i--; j--;
    } else if (dp[i][j] === dp[i - 1][j] + gap) {
      alignedA = seqA[i - 1] + alignedA; alignedB = '-' + alignedB; i--;
    } else {
      alignedA = '-' + alignedA; alignedB = seqB[j - 1] + alignedB; j--;
    }
  }
  while (i > 0) { alignedA = seqA[i - 1] + alignedA; alignedB = '-' + alignedB; i--; }
  while (j > 0) { alignedA = '-' + alignedA; alignedB = seqB[j - 1] + alignedB; j--; }
  return { alignedA, alignedB };
}

/** 0-based query/template index pairs for every column with a residue on both sides. */
function _alignmentToMapping(alignedQuery, alignedTemplate) {
  const queryIndices = [];
  const templateIndices = [];
  let qi = 0, ti = 0, nIdentical = 0, nAligned = 0;
  for (let k = 0; k < alignedQuery.length; k++) {
    const qc = alignedQuery[k], tc = alignedTemplate[k];
    if (qc !== '-' && tc !== '-') {
      queryIndices.push(qi);
      templateIndices.push(ti);
      nAligned++;
      if (qc === tc) nIdentical++;
      qi++; ti++;
    } else if (qc === '-') {
      ti++;
    } else {
      qi++;
    }
  }
  const identity = nAligned ? nIdentical / nAligned : 0;
  return { queryIndices, templateIndices, identity };
}

function _addTemplate(card, seqId) {
  const container = card.querySelector(`.tpl-container[data-seqid="${seqId}"]`);
  const idx = container.querySelectorAll('.tpl-entry').length;

  const div = document.createElement('div');
  div.className = 'tpl-entry subsection';
  div.innerHTML = `
    <div class="tpl-entry-header">
      <span class="tpl-entry-title">Template ${idx + 1}</span>
      <button class="btn-icon remove-tpl-btn" title="Remove template">✕</button>
    </div>
    <p class="adv-hint tpl-entry-intro">
      A template needs a single-chain structure (mmCIF) plus a 0-based mapping between
      this chain's sequence and the template's residues. If you already have a prepared
      mapping, use <strong>Upload mapping file</strong> below. Otherwise, pasting or
      uploading the mmCIF content automatically suggests one — AF3x itself has no tool
      for this, it only defines the JSON format, so treat the suggestion as a starting
      point to check, not a guaranteed-correct mapping.
    </p>
    <div class="field-row">
      <div class="field field-grow">
        <label>mmCIF content</label>
        <textarea class="tpl-mmcif" rows="2" placeholder="Paste mmCIF, or leave blank and use &quot;Upload &amp; align&quot; below"></textarea>
      </div>
      <div class="field field-grow">
        <label>mmCIF path</label>
        <input type="text" class="tpl-mmcif-path" placeholder="/path/to/template.cif">
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Query indices (0-based, comma-separated)</label>
        <input type="text" class="tpl-query-idx" placeholder="0,1,2,5">
      </div>
      <div class="field">
        <label>Template indices (0-based, comma-separated)</label>
        <input type="text" class="tpl-tpl-idx" placeholder="0,1,2,8">
      </div>
      <label class="btn btn-ghost btn-xs tpl-mapping-upload-label"
             title="Upload a 2-column CSV/TSV file (query_index,template_index per line, one pair per row, 0-based) to fill both index fields above — a local convenience, not an AF3x JSON field">
        Upload mapping file
        <input type="file" class="tpl-mapping-file" accept=".csv,.tsv,.txt" style="display:none">
      </label>
    </div>
    <div class="tpl-align-row">
      <label class="btn btn-outline btn-xs tpl-align-upload-label"
             title="Upload a PDB or mmCIF file: fills the content field above (converting PDB to mmCIF automatically) and suggests a mapping right away.">
        Upload &amp; align
        <input type="file" class="tpl-align-upload-file" accept=".pdb,.ent,.cif,.mmcif,.txt" style="display:none">
      </label>
    </div>
    <p class="adv-hint tpl-align-hint">Pasting or uploading mmCIF content above automatically suggests a mapping below — review it and click Apply.</p>
    <div class="tpl-align-result" style="display:none"></div>`;

  div.querySelector('.remove-tpl-btn').addEventListener('click', () => {
    div.remove();
    _updateAdvancedSummary(seqId);
  });

  // mmCIF content vs path: mutually exclusive — filling one disables the other
  const mmcifTa   = div.querySelector('.tpl-mmcif');
  const mmcifPath = div.querySelector('.tpl-mmcif-path');

  function _syncMmcifExclusivity() {
    const hasContent = mmcifTa.value.trim().length > 0;
    const hasPath     = mmcifPath.value.trim().length > 0;
    mmcifPath.disabled = hasContent;
    mmcifTa.disabled   = hasPath;
  }
  mmcifTa.addEventListener('input', _syncMmcifExclusivity);
  mmcifPath.addEventListener('input', _syncMmcifExclusivity);

  div.querySelector('.tpl-mapping-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const queries = [];
      const templates = [];
      ev.target.result.split(/\r?\n/).forEach(line => {
        line = line.trim();
        if (!line) return;
        const cols = line.split(/[,\t]/).map(s => s.trim());
        if (cols.length < 2) return;
        const q = parseInt(cols[0]);
        const t = parseInt(cols[1]);
        if (Number.isNaN(q) || Number.isNaN(t)) return; // skip header / bad rows
        queries.push(q);
        templates.push(t);
      });
      if (!queries.length) {
        alert('Could not find any valid "query_index,template_index" rows in this file.');
        return;
      }
      div.querySelector('.tpl-query-idx').value = queries.join(',');
      div.querySelector('.tpl-tpl-idx').value   = templates.join(',');
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // Sequence alignment → suggest query/template indices
  const alignResult = div.querySelector('.tpl-align-result');

  const _runTplAlignment = (templateChain) => {
    const querySeq = card.querySelector('.seq-textarea')?.value.trim().replace(/\s+/g, '').toUpperCase() || '';
    const { alignedA, alignedB } = _needlemanWunsch(querySeq, templateChain.sequence);
    const { queryIndices, templateIndices, identity } = _alignmentToMapping(alignedA, alignedB);
    if (!queryIndices.length) {
      alignResult.innerHTML = `<p class="adv-hint" style="color:var(--danger)">No alignable positions found between this chain's sequence and the template.</p>`;
      alignResult.style.display = '';
      return;
    }
    alignResult.innerHTML = `
      <p class="adv-hint">
        Aligned against chain ${templateChain.chainId} (${templateChain.sequence.length} aa) —
        ${queryIndices.length} mapped position${queryIndices.length === 1 ? '' : 's'},
        ${(identity * 100).toFixed(0)}% identity over the aligned region.
      </p>
      <button class="btn btn-primary btn-xs tpl-apply-align-btn" type="button">Apply mapping (${queryIndices.length} pairs)</button>`;
    alignResult.style.display = '';
    alignResult.querySelector('.tpl-apply-align-btn').addEventListener('click', () => {
      div.querySelector('.tpl-query-idx').value = queryIndices.join(',');
      div.querySelector('.tpl-tpl-idx').value   = templateIndices.join(',');
    });
  };

  const _startAlignmentFromText = (structText, { silent = false } = {}) => {
    if (!structText.trim()) {
      if (!silent) alert('No mmCIF content above yet — paste/upload it there first, or use "Upload & align" below.');
      return;
    }
    const querySeq = card.querySelector('.seq-textarea')?.value.trim().replace(/\s+/g, '') || '';
    if (!querySeq) {
      if (!silent) alert('This chain has no sequence yet — add one in the Sequence field above first.');
      return;
    }

    let chains;
    try {
      chains = extractAtomSequences(structText);
    } catch (e) {
      if (!silent) alert('Could not parse this structure file: ' + e.message);
      return;
    }
    // Keep chains that look like protein (mostly standard amino acids, not
    // nucleic acid/unrecognized residues, which extractAtomSequences maps to 'X')
    const proteinChains = chains.filter(c => {
      if (!c.sequence) return false;
      const nUnknown = (c.sequence.match(/X/g) || []).length;
      return nUnknown / c.sequence.length < 0.5;
    });
    if (!proteinChains.length) {
      if (silent) { alignResult.style.display = 'none'; return; }
      alignResult.innerHTML = `<p class="adv-hint" style="color:var(--danger)">No protein chains with a sequence found in this structure file.</p>`;
      alignResult.style.display = '';
      return;
    }

    if (proteinChains.length === 1) {
      _runTplAlignment(proteinChains[0]);
    } else {
      const options = proteinChains
        .map((c, i) => `<option value="${i}">Chain ${c.chainId} (${c.sequence.length} aa)</option>`)
        .join('');
      alignResult.innerHTML = `
        <div class="tpl-chain-pick-row">
          <label>Multiple protein chains found — pick one:</label>
          <select class="tpl-chain-pick-sel">${options}</select>
          <button class="btn btn-outline btn-xs tpl-chain-pick-confirm" type="button">Align</button>
        </div>`;
      alignResult.style.display = '';
      alignResult.querySelector('.tpl-chain-pick-confirm').addEventListener('click', () => {
        const idx = parseInt(alignResult.querySelector('.tpl-chain-pick-sel').value);
        _runTplAlignment(proteinChains[idx]);
      });
    }
  };

  // Auto-suggest a mapping whenever the mmCIF content changes (paste/typing),
  // debounced so it doesn't re-run on every keystroke. Silent: no alerts if a
  // prerequisite (sequence, parseable content) isn't there yet — it just waits.
  let _alignDebounceTimer = null;
  mmcifTa.addEventListener('input', () => {
    clearTimeout(_alignDebounceTimer);
    _alignDebounceTimer = setTimeout(() => {
      _startAlignmentFromText(mmcifTa.value, { silent: true });
    }, 500);
  });

  div.querySelector('.tpl-align-upload-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      // Also fill the content field above with this file (converting legacy
      // PDB to mmCIF first, since that's what AF3x's templates require) —
      // that's exactly what's needed for the JSON anyway, no reason to make
      // the user upload the same file twice via two different buttons.
      if (!mmcifTa.disabled) {
        try {
          mmcifTa.value = isMmcifText(text) ? text : pdbToMmcif(text, file.name.replace(/\.[^.]+$/, ''));
          _syncMmcifExclusivity();
        } catch { /* fall through to alignment below using the raw text */ }
      }
      _startAlignmentFromText(text);
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  container.appendChild(div);
  _updateAdvancedSummary(seqId);
}

// ─── Crosslink Groups ─────────────────────────────────────────────────────────

export function addCrosslinkGroup(preset = null) {
  _xlCounter++;
  const id    = `xl_${_xlCounter}`;
  const color = XL_GROUP_COLORS[(_xlCounter - 1) % XL_GROUP_COLORS.length];

  const card = document.createElement('div');
  card.className  = 'xl-group-card';
  card.dataset.id = id;
  card.style.setProperty('--xl-color', color);

  const defaultName = preset ? preset.name : 'DSSO';

  card.innerHTML = `
    <div class="xl-group-header">
      <div class="xl-color-dot" style="background:${color}"></div>
      <div class="field field-grow">
        <label>Crosslinker</label>
        ${_crosslinkerSelect(id, defaultName)}
      </div>
      <button class="btn-icon btn-remove-xl" data-xlid="${id}" title="Remove group">✕</button>
    </div>

    <div class="xl-asym-warning" data-xlid="${id}" style="display:none"></div>

    <div class="xl-dynamic-n" data-xlid="${id}" style="display:none">
      <label>n (chain length) <input type="number" class="xl-dyn-n-input" value="5" min="1" max="30"></label>
    </div>

    <div class="xl-pairs-container" data-xlid="${id}"></div>

    <div class="xl-pair-actions">
      <button class="btn btn-outline btn-sm add-pair-btn" data-xlid="${id}">+ Add pair</button>
    </div>`;

  card.querySelector('.btn-remove-xl').addEventListener('click', () => {
    card.remove();
    updateViz();
  });

  card.querySelector('.add-pair-btn').addEventListener('click', () => {
    _addXlPair(card, id);
  });

  const xlSel = card.querySelector('.xl-select');
  xlSel.addEventListener('change', () => _handleXlSelectChange(card, id, xlSel.value));

  document.getElementById('crosslinks-container').appendChild(card);

  // Add one pair by default
  if (preset && preset.pairs) {
    preset.pairs.forEach(p => _addXlPair(card, id, p));
  } else {
    _addXlPair(card, id);
  }

  updateViz();
}

function _crosslinkerSelect(id, defaultValue = 'DSSO') {
  let html = `<select class="xl-select" data-xlid="${id}">`;

  // Group by category
  const categories = [...new Set(CROSSLINKERS.map(x => x.category))];
  categories.forEach(cat => {
    html += `<optgroup label="${cat}">`;
    CROSSLINKERS.filter(x => x.category === cat).forEach(xl => {
      const label = xl.symmetric === false ? `${xl.name} ⚠` : xl.name;
      const sel   = xl.name === defaultValue ? ' selected' : '';
      html += `<option value="${xl.name}"${sel}>${label}</option>`;
    });
    html += '</optgroup>';
  });
  html += '</select>';
  return html;
}

function _handleXlSelectChange(card, id, xlName) {
  const xl     = CROSSLINKERS.find(x => x.name === xlName);
  const warnEl = card.querySelector(`.xl-asym-warning[data-xlid="${id}"]`);
  const dynEl  = card.querySelector(`.xl-dynamic-n[data-xlid="${id}"]`);

  if (xl && !xl.symmetric && !xl.dynamic) {
    warnEl.style.display = 'block';
    warnEl.textContent = `⚠ Asymmetric crosslinker — ${xl.asymmetricNote}`;
  } else {
    warnEl.style.display = 'none';
  }

  if (xl && xl.dynamic) {
    dynEl.style.display = 'block';
  } else {
    dynEl.style.display = 'none';
  }

  updateViz();
}

function _addXlPair(card, xlId, defaults = {}) {
  const container = card.querySelector(`.xl-pairs-container[data-xlid="${xlId}"]`);
  const idx       = container.querySelectorAll('.xl-pair-row').length;

  const row = document.createElement('div');
  row.className = 'xl-pair-row';
  row.innerHTML = `
    <span class="pair-num">${idx + 1}</span>
    <input type="text" class="xl-chain-a" placeholder="Chain" value="${defaults.chain1 || ''}" maxlength="4">
    <input type="number" class="xl-pos-a" placeholder="Res" value="${defaults.pos1 || ''}" min="1">
    <span class="pair-sep">↔</span>
    <input type="text" class="xl-chain-b" placeholder="Chain" value="${defaults.chain2 || ''}" maxlength="4">
    <input type="number" class="xl-pos-b" placeholder="Res" value="${defaults.pos2 || ''}" min="1">
    <span class="xl-pos-warn" style="display:none"></span>
    <span class="xl-chem-warn" style="display:none"></span>
    <button class="btn-icon xl-row-pick-btn" title="Pick residues by clicking in sequence">${_SS_PICK_SVG}</button>
    <button class="btn-icon btn-remove-pair" title="Remove pair">✕</button>`;

  row.querySelector('.btn-remove-pair').addEventListener('click', () => {
    if (_xlRowPickState?.row === row) _exitXlRowPickMode();
    row.remove();
    // Re-number
    container.querySelectorAll('.pair-num').forEach((el, i) => { el.textContent = i + 1; });
    updateViz();
  });

  row.querySelector('.xl-row-pick-btn').addEventListener('click', () => _toggleXlRowPickMode(row));
  row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', updateViz));
  wireXlPairRowHover(row);
  container.appendChild(row);
}

// ─── Disulfide Bonds ──────────────────────────────────────────────────────────

const _SS_PICK_SVG = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none">
  <circle cx="8" cy="8" r="4.5" stroke="currentColor" stroke-width="1.6"/>
  <line x1="8" y1="1" x2="8" y2="4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  <line x1="8" y1="12" x2="8" y2="15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  <line x1="1" y1="8" x2="4" y2="8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  <line x1="12" y1="8" x2="15" y2="8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
</svg>`;

function addSsBond() {
  _ssCounter++;
  const id = `ss_${_ssCounter}`;

  const container = document.getElementById('ss-bonds-container');
  const row = document.createElement('div');
  row.className  = 'ss-pair-row';
  row.dataset.id = id;
  row.innerHTML = `
    <span class="pair-label">S–S</span>
    <input type="text" class="ss-chain-a" placeholder="Chain" maxlength="4">
    <input type="number" class="ss-pos-a" placeholder="Cys res" min="1">
    <span class="pair-sep">↔</span>
    <input type="text" class="ss-chain-b" placeholder="Chain" maxlength="4">
    <input type="number" class="ss-pos-b" placeholder="Cys res" min="1">
    <button class="btn-icon ss-pick-btn" title="Pick two Cys residues in sequence">${_SS_PICK_SVG}</button>
    <button class="btn-icon btn-remove-pair" title="Remove">✕</button>`;

  row.querySelector('.btn-remove-pair').addEventListener('click', () => {
    if (_ssPickState?.row === row) _exitSsPickMode();
    row.remove();
    updateViz();
  });
  row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', updateViz));
  row.querySelector('.ss-pick-btn').addEventListener('click', () => _toggleSsPickMode(row));
  container.appendChild(row);
}

function _toggleSsPickMode(row) {
  if (_ssPickState?.row === row) { _exitSsPickMode(); return; }
  _exitSsPickMode();
  if (_modPickState) _exitModPickMode();
  _ssPickState = { row, slot: 'a' };
  row.querySelector('.ss-pick-btn')?.classList.add('ss-pick-active');
  document.querySelectorAll('.seq-card').forEach(card => _updateRuler(card));
}

function _exitSsPickMode() {
  if (!_ssPickState) return;
  _ssPickState.row.querySelector('.ss-pick-btn')?.classList.remove('ss-pick-active');
  _ssPickState = null;
  document.querySelectorAll('.seq-card').forEach(card => _updateRuler(card));
}

function _toggleXlRowPickMode(row) {
  if (_xlRowPickState?.row === row) { _exitXlRowPickMode(); return; }
  _exitXlRowPickMode();
  if (_ssPickState)  _exitSsPickMode();
  if (_modPickState) _exitModPickMode();
  if (_xlPickMode)   _toggleXlPickMode();
  _xlRowPickState = { row, slot: 'a' };
  row.querySelector('.xl-row-pick-btn')?.classList.add('xl-row-pick-active');
  document.getElementById('sequences-container')?.classList.add('sequences-xl-pick-active');
  const textEl = document.getElementById('xl-pick-banner-text');
  if (textEl) textEl.textContent = 'Click first residue (END1)';
  document.getElementById('xl-pick-banner')?.classList.add('visible');
}

function _exitXlRowPickMode() {
  if (!_xlRowPickState) return;
  _xlRowPickState.row.querySelector('.xl-row-pick-btn')?.classList.remove('xl-row-pick-active');
  _xlRowPickState = null;
  document.getElementById('sequences-container')?.classList.remove('sequences-xl-pick-active');
  document.getElementById('xl-pick-banner')?.classList.remove('visible');
}

function _buildSsPickHighlights(seqId) {
  const hl = new Map();
  if (!_ssPickState) return hl;
  const card     = document.querySelector(`.seq-card[data-id="${seqId}"]`);
  const chainRaw = card?.querySelector('.seq-chain-id')?.value.trim() || '';
  const seq      = card?.querySelector('.seq-textarea')?.value.trim().replace(/\s/g,'').toUpperCase() || '';
  if (!seq || !chainRaw) return hl;
  const chainIds = chainRaw.split(',').map(s => s.trim()).filter(Boolean);
  const { row } = _ssPickState;
  const selA_c = row.querySelector('.ss-chain-a')?.value.trim();
  const selA_p = parseInt(row.querySelector('.ss-pos-a')?.value) || 0;
  const selB_c = row.querySelector('.ss-chain-b')?.value.trim();
  const selB_p = parseInt(row.querySelector('.ss-pos-b')?.value) || 0;
  for (let i = 0; i < seq.length; i++) {
    if (seq[i] === 'C') {
      const pos    = i + 1;
      const isSel  = (chainIds.includes(selA_c) && selA_p === pos) ||
                     (chainIds.includes(selB_c) && selB_p === pos);
      hl.set(pos, { type: isSel ? 'selected' : 'valid', ccd: 'SS', targetAA: 'C',
                    color: '#f0b400', name: 'Cysteine (S–S)' });
    }
  }
  return hl;
}

// ─── Bonded Atom Pairs ────────────────────────────────────────────────────────

function addBond() {
  _bondCounter++;
  const id = `bond_${_bondCounter}`;

  const container = document.getElementById('bonds-container');
  const div = document.createElement('div');
  div.className = 'bond-pair-row';
  div.dataset.id = id;
  div.innerHTML = `
    <span class="pair-num bond-num">${_bondCounter}</span>
    <input type="text"   class="bond-entity-a" placeholder="Chain" maxlength="4">
    <input type="number" class="bond-res-a"    placeholder="Res"   min="1">
    <input type="text"   class="bond-atom-a"   placeholder="Atom"  maxlength="8">
    <span class="bond-connector">—</span>
    <input type="text"   class="bond-entity-b" placeholder="Chain" maxlength="4">
    <input type="number" class="bond-res-b"    placeholder="Res"   min="1">
    <input type="text"   class="bond-atom-b"   placeholder="Atom"  maxlength="8">
    <button class="btn-icon btn-remove-pair" title="Remove">✕</button>`;

  div.querySelector('.btn-remove-pair').addEventListener('click', () => div.remove());
  container.appendChild(div);
}

// ─── PTM Picker ───────────────────────────────────────────────────────────────

function _initPTMModal() {
  const modal    = document.getElementById('ptm-modal');
  const closeBtn = document.getElementById('ptmModalClose');
  const search   = document.getElementById('ptmSearch');
  const tabs     = document.getElementById('ptmCategoryTabs');
  const list     = document.getElementById('ptmList');

  // Build category tabs
  let activeCategory = 'all';
  const allCategories = ['all', ...PTM_CATEGORIES];

  allCategories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className  = 'cat-tab-btn' + (cat === 'all' ? ' active' : '');
    btn.textContent = cat === 'all' ? 'All' : cat;
    btn.dataset.cat = cat;
    btn.addEventListener('click', () => {
      tabs.querySelectorAll('.cat-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeCategory = cat;
      _renderPTMList(list, search.value, activeCategory);
    });
    tabs.appendChild(btn);
  });

  search.addEventListener('input', () => _renderPTMList(list, search.value, activeCategory));
  closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
  modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
}

function _renderPTMList(list, query, category) {
  const q = query.toLowerCase();
  const filtered = PTM_DATABASE.filter(p => {
    const matchCat  = category === 'all' || p.category === category;
    const matchQ    = !q || p.ccd.toLowerCase().includes(q) ||
                      p.name.toLowerCase().includes(q) ||
                      p.description.toLowerCase().includes(q);
    return matchCat && matchQ;
  });

  list.innerHTML = '';
  if (!filtered.length) {
    list.innerHTML = '<div class="ptm-empty">No modifications match your search.</div>';
    return;
  }

  filtered.forEach(ptm => {
    const item = document.createElement('div');
    item.className  = 'ptm-item';
    item.innerHTML  = `
      <div class="ptm-ccd">${ptm.ccd}</div>
      <div class="ptm-info">
        <span class="ptm-name">${ptm.name}</span>
        <span class="ptm-aa">→ ${ptm.targetAA}</span>
        <span class="ptm-desc">${ptm.description}</span>
      </div>`;
    item.addEventListener('click', () => _applyPTM(ptm));
    list.appendChild(item);
  });
}

function _openPTMPicker(seqId, existingModEl) {
  _ptmContext = { seqId, existingModEl };
  const search = document.getElementById('ptmSearch');
  search.value = '';
  _renderPTMList(document.getElementById('ptmList'), '', 'all');
  document.getElementById('ptm-modal').style.display = 'flex';
  search.focus();
}

function _applyPTM(ptm) {
  if (!_ptmContext) return;
  const { seqId, existingModEl } = _ptmContext;

  const card   = document.querySelector(`.seq-card[data-id="${seqId}"]`);
  const modsEl = card?.querySelector(`.mods-container[data-seqid="${seqId}"]`);
  if (!modsEl) return;

  let row, posEl;
  if (existingModEl?.classList.contains('mod-row')) {
    // Update existing row's CCD in place
    row    = existingModEl;
    const ccdEl  = row.querySelector('.mod-ccd');
    posEl  = row.querySelector('.mod-pos');
    const warnEl = row.querySelector('.mod-pos-warn');
    if (ccdEl) ccdEl.value = ptm.ccd;
    _validateModRow(ptm.ccd, posEl?.value || '', seqId, warnEl);
    _updateRuler(card);
    _refreshModRowColors(seqId);
  } else {
    row   = _addModRow(modsEl, seqId, ptm.ccd, null);
    posEl = row.querySelector('.mod-pos');
  }

  // No position chosen yet — go straight into pick mode so valid residues
  // for this modification's target amino acid are highlighted right away.
  if (!posEl?.value) _toggleModResiduePickMode(seqId, row);
  document.getElementById('ptm-modal').style.display = 'none';
}

function _addModRow(container, seqId, ccdCode = '', position = '') {
  const row = document.createElement('div');
  row.className = 'mod-row subsection';
  row.innerHTML = `
    <div class="mod-row-main">
      <input type="text" class="mod-ccd" value="${ccdCode}" placeholder="CCD code (e.g. SEP)"
             title="Click ⋯ to pick from database">
      <span class="mod-sep">@</span>
      <input type="number" class="mod-pos" value="${position}" placeholder="pos" min="1">
      <button class="btn-icon mod-res-pick-btn" title="Click a residue in the sequence to set position">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="4.5" stroke="currentColor" stroke-width="1.6"/>
          <line x1="8" y1="1" x2="8" y2="4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          <line x1="8" y1="12" x2="8" y2="15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          <line x1="1" y1="8" x2="4" y2="8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          <line x1="12" y1="8" x2="15" y2="8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
      </button>
      <button class="btn-icon mod-pick-btn" title="Pick modification from database">⋯</button>
      <button class="btn-icon btn-remove-pair" title="Remove">✕</button>
    </div>
    <div class="mod-pos-warn" style="display:none"></div>`;

  const ccdEl   = row.querySelector('.mod-ccd');
  const posEl   = row.querySelector('.mod-pos');
  const warnEl  = row.querySelector('.mod-pos-warn');

  const revalidate = () => {
    _validateModRow(ccdEl.value, posEl.value, seqId, warnEl);
    _updateRuler(document.querySelector(`.seq-card[data-id="${seqId}"]`));
    _refreshModRowColors(seqId);
  };

  ccdEl.addEventListener('change', revalidate);
  posEl.addEventListener('input',  () => {
    // Typing a position by hand supersedes click-to-pick — drop out of pick mode.
    if (_modPickState?.row === row) _exitModPickMode();
    _validateModRow(ccdEl.value, posEl.value, seqId, warnEl);
  });
  posEl.addEventListener('change', revalidate);

  row.querySelector('.btn-remove-pair').addEventListener('click', () => {
    if (_modPickState?.row === row) _exitModPickMode();
    row.remove();
    _updateRuler(document.querySelector(`.seq-card[data-id="${seqId}"]`));
    _updateAdvancedSummary(seqId);
    _refreshModRowColors(seqId);
  });
  row.querySelector('.mod-pick-btn').addEventListener('click', () => _openPTMPicker(seqId, row));
  row.querySelector('.mod-res-pick-btn').addEventListener('click', () => _toggleModResiduePickMode(seqId, row));

  container.appendChild(row);
  if (ccdCode && position) _validateModRow(ccdCode, position, seqId, warnEl);
  _updateAdvancedSummary(seqId);
  _refreshModRowColors(seqId);
  return row;
}

function _validateModRow(ccdRaw, posRaw, seqId, warnEl) {
  if (!warnEl) return;
  const ccd = (ccdRaw || '').trim().toUpperCase();
  const pos = parseInt(posRaw) || 0;
  if (!ccd || !pos) { warnEl.style.display = 'none'; return; }

  const card = document.querySelector(`.seq-card[data-id="${seqId}"]`);
  const seq  = card?.querySelector('.seq-textarea')?.value.trim().replace(/\s/g,'').toUpperCase() || '';
  if (!seq) { warnEl.style.display = 'none'; return; }

  if (pos > seq.length) {
    warnEl.textContent = `Position ${pos} out of range (chain length: ${seq.length})`;
    warnEl.style.display = 'block'; return;
  }
  const ptm = PTM_DATABASE.find(p => p.ccd.toUpperCase() === ccd);
  if (ptm && seq[pos - 1] !== ptm.targetAA) {
    warnEl.textContent = `${ccd} requires ${ptm.targetAA}, but position ${pos} is ${seq[pos - 1]}`;
    warnEl.style.display = 'block'; return;
  }
  warnEl.style.display = 'none';
}

function _buildPTMColorMap(seqId) {
  const map  = new Map();
  let   idx  = 0;
  document.querySelector(`.seq-card[data-id="${seqId}"]`)
    ?.querySelectorAll('.mod-row .mod-ccd').forEach(el => {
      const ccd = el.value.trim().toUpperCase();
      if (ccd && !map.has(ccd)) {
        map.set(ccd, MOD_GROUP_COLORS[idx % MOD_GROUP_COLORS.length]);
        idx++;
      }
    });
  return map;
}

// Tints each modification row with the same colour used for its highlight in
// the sequence display, so the row and the highlighted residue are visually
// linked at a glance.
function _refreshModRowColors(seqId) {
  const colorMap = _buildPTMColorMap(seqId);
  document.querySelectorAll(`.mods-container[data-seqid="${seqId}"] .mod-row`).forEach(row => {
    const ccd   = (row.querySelector('.mod-ccd')?.value || '').trim().toUpperCase();
    const color = ccd ? (colorMap.get(ccd) || MOD_GROUP_COLORS[0]) : null;
    row.style.setProperty('--mod-row-color', color || 'var(--primary)');
  });
}

function _buildModHighlights(seqId) {
  const hl        = new Map(); // pos → { type, ccd, targetAA, color, name }
  const card      = document.querySelector(`.seq-card[data-id="${seqId}"]`);
  const seq       = card?.querySelector('.seq-textarea')?.value.trim().replace(/\s/g,'').toUpperCase() || '';
  if (!seq) return hl;

  const inPickMode = _modPickState?.seqId === seqId;
  const pickRow    = inPickMode ? _modPickState.row : null;
  const colorMap   = _buildPTMColorMap(seqId);

  card.querySelectorAll('.mod-row').forEach(row => {
    const ccd   = (row.querySelector('.mod-ccd')?.value || '').trim().toUpperCase();
    const pos   = parseInt(row.querySelector('.mod-pos')?.value) || 0;
    if (!ccd) return;
    const ptm   = PTM_DATABASE.find(p => p.ccd.toUpperCase() === ccd);
    const color = colorMap.get(ccd) || MOD_GROUP_COLORS[0];
    const name  = ptm ? ptm.name : ccd;

    // In pick mode: highlight all valid positions for the active row
    if (inPickMode && row === pickRow && ptm) {
      for (let i = 0; i < seq.length; i++) {
        if (seq[i] === ptm.targetAA && !hl.has(i + 1)) {
          hl.set(i + 1, { type: 'valid', ccd, targetAA: ptm.targetAA, color, name });
        }
      }
    }
    // Always mark the placed position
    if (pos && pos <= seq.length) {
      hl.set(pos, { type: 'selected', ccd, targetAA: ptm?.targetAA || '?', color, name });
    }
  });
  return hl;
}

function _toggleModResiduePickMode(seqId, row) {
  if (_modPickState?.row === row) { _exitModPickMode(); return; }
  _exitModPickMode();
  const ccd = (row.querySelector('.mod-ccd')?.value || '').trim().toUpperCase();
  const ptm = PTM_DATABASE.find(p => p.ccd.toUpperCase() === ccd);
  _modPickState = { seqId, row, targetAA: ptm?.targetAA || null };
  row.querySelector('.mod-res-pick-btn')?.classList.add('mod-pick-active');
  const card = document.querySelector(`.seq-card[data-id="${seqId}"]`);
  if (card) _updateRuler(card);
}

function _exitModPickMode() {
  if (!_modPickState) return;
  _modPickState.row.querySelector('.mod-res-pick-btn')?.classList.remove('mod-pick-active');
  const card = document.querySelector(`.seq-card[data-id="${_modPickState.seqId}"]`);
  _modPickState = null;
  if (card) _updateRuler(card);
}

// ─── Crosslinker Presets ──────────────────────────────────────────────────────

function _initCrosslinkPresets() {
  const list = document.getElementById('presets-list');
  const presets = CROSSLINKERS.filter(xl => !xl.dynamic).slice(0, 8);

  presets.forEach(xl => {
    const btn = document.createElement('button');
    btn.className   = 'preset-btn';
    btn.innerHTML   = `<strong>${xl.name}</strong><span>${xl.description}</span>`;
    btn.addEventListener('click', () => {
      addCrosslinkGroup({ name: xl.name });
      document.getElementById('presets-dropdown').style.display = 'none';
    });
    list.appendChild(btn);
  });
}

function _togglePresetsDropdown() {
  const dd  = document.getElementById('presets-dropdown');
  const btn = document.getElementById('crosslinkerPresetsBtn');
  if (dd.style.display === 'none') {
    const rect = btn.getBoundingClientRect();
    dd.style.top  = (btn.offsetTop + btn.offsetHeight + 4) + 'px';
    dd.style.display = 'block';
  } else {
    dd.style.display = 'none';
  }
}

// ─── CSV Import handler ───────────────────────────────────────────────────────

function _handleCsvFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    openImportModal(ev.target.result, _onCsvImport);
  };
  reader.readAsText(file);
  e.target.value = '';  // reset so same file can be re-selected
}

function _onCsvImport(pairs, xlName, proteinToChain, sequences = {}) {
  // Create sequence cards for proteins with fetched sequences (sorted by chain ID)
  const chainOrder = Object.entries(proteinToChain)
    .filter(([prot]) => sequences[prot])
    .sort((a, b) => a[1].localeCompare(b[1]));

  chainOrder.forEach(([prot, chainId]) => {
    const seq = sequences[prot];

    // Try to reuse an existing card with this chain ID that has no sequence yet
    let targetCard = null;
    document.querySelectorAll('.seq-card').forEach(card => {
      const cid = card.querySelector('.seq-chain-id')?.value.trim();
      const ta  = card.querySelector('.seq-textarea');
      if (cid === chainId && ta && !ta.value.trim()) targetCard = card;
    });

    if (!targetCard) {
      // Check if chain already has content — skip to avoid overwrite
      let hasContent = false;
      document.querySelectorAll('.seq-card').forEach(card => {
        const cid = card.querySelector('.seq-chain-id')?.value.trim();
        const ta  = card.querySelector('.seq-textarea');
        if (cid === chainId && ta && ta.value.trim()) hasContent = true;
      });
      if (hasContent) return;

      addSequenceCard('protein');
      targetCard = document.querySelector('#sequences-container .seq-card:last-child');
      if (targetCard) targetCard.querySelector('.seq-chain-id').value = chainId;
    }

    if (!targetCard) return;
    const ta = targetCard.querySelector('.seq-textarea');
    if (ta) {
      ta.value = seq;
      _autoValidateSeq(ta, 'protein');
      _updateRuler(targetCard);
    }
  });

  // Add crosslink group
  const converted = pairs.map(p => ({
    chain1: proteinToChain[p.protein1] || p.protein1,
    pos1:   p.pos1,
    chain2: proteinToChain[p.protein2] || p.protein2,
    pos2:   p.pos2,
  }));
  addCrosslinkGroup({ name: xlName, pairs: converted });
}

// ─── JSON import ──────────────────────────────────────────────────────────────

function _initJsonImport() {
  // handled via event listener in DOMContentLoaded
}

function _detectJsonDialect(raw) {
  if (Array.isArray(raw)) return 'alphafoldserver';
  if (raw.dialect === 'alphafoldserver') return 'alphafoldserver';
  if (raw.sequences) return 'af3x';
  return 'unknown';
}

function _stripCcd(code) {
  return typeof code === 'string' ? code.replace(/^CCD_/i, '') : code;
}

function _convertServerJson(raw) {
  const jobs = Array.isArray(raw) ? raw : [raw];
  const job = jobs[0];
  const w = []; // warnings

  w.push('Converted from AlphaFold Server format.');
  if (jobs.length > 1) {
    w.push(`File contains ${jobs.length} jobs — only the first was imported.`);
  }

  const converted = { name: job.name || '', version: 2 };

  // Seeds: server uses strings or empty array → default to [1]
  const rawSeeds = Array.isArray(job.modelSeeds) ? job.modelSeeds : [];
  converted.modelSeeds = rawSeeds.map(s => parseInt(s, 10)).filter(n => !isNaN(n));
  if (!converted.modelSeeds.length) converted.modelSeeds = [1];

  const usedIds = new Set();
  const nextId = () => {
    for (let i = 0; i < 26; i++) {
      const c = String.fromCharCode(65 + i);
      if (!usedIds.has(c)) { usedIds.add(c); return c; }
    }
    return '?';
  };

  // Convert modifications array, stripping CCD_ prefix
  const convertMods = (mods, isProtein) => {
    if (!Array.isArray(mods) || !mods.length) return undefined;
    return mods.map(m => isProtein
      ? { ptmType: _stripCcd(m.ptmType || m.modificationType || ''), ptmPosition: m.ptmPosition || m.basePosition }
      : { modificationType: _stripCcd(m.modificationType || m.ptmType || ''), basePosition: m.basePosition || m.ptmPosition }
    );
  };

  converted.sequences = [];
  (job.sequences || []).forEach(seqObj => {
    const type = Object.keys(seqObj)[0];
    const data = seqObj[type];
    const count = (Number.isInteger(data.count) && data.count > 0) ? data.count : 1;

    if (type === 'proteinChain') {
      if (data.useStructureTemplate) w.push('Protein: "useStructureTemplate: true" is not supported and was removed.');
      if (data.glycans?.length)      w.push('Protein: glycans are not supported in AF3x and were removed.');
      if (data.maxTemplateDate)      w.push(`Protein: "maxTemplateDate" (${data.maxTemplateDate}) is not supported and was removed.`);
      if (count > 1 && (data.unpairedMsa || data.templates?.length)) {
        w.push(`Protein (×${count}): MSA/templates applied to first chain only — add manually to others if needed.`);
      }
      const mods = convertMods(data.modifications, true);
      for (let i = 0; i < count; i++) {
        const entry = { protein: { id: nextId(), sequence: data.sequence || '' } };
        if (mods) entry.protein.modifications = mods;
        if (i === 0 && data.unpairedMsa) entry.protein.unpairedMsa = data.unpairedMsa;
        if (i === 0 && data.pairedMsa)   entry.protein.pairedMsa   = data.pairedMsa;
        if (i === 0 && data.templates?.length) entry.protein.templates = data.templates;
        converted.sequences.push(entry);
      }
    } else if (type === 'rnaSequence') {
      const mods = convertMods(data.modifications, false);
      for (let i = 0; i < count; i++) {
        const entry = { rna: { id: nextId(), sequence: data.sequence || '' } };
        if (mods) entry.rna.modifications = mods;
        converted.sequences.push(entry);
      }
    } else if (type === 'dnaSequence') {
      const mods = convertMods(data.modifications, false);
      for (let i = 0; i < count; i++) {
        const entry = { dna: { id: nextId(), sequence: data.sequence || '' } };
        if (mods) entry.dna.modifications = mods;
        converted.sequences.push(entry);
      }
    } else if (type === 'ligand') {
      const ccd = _stripCcd(data.ligand || '');
      for (let i = 0; i < count; i++) {
        converted.sequences.push({ ligand: { id: nextId(), ccdCodes: [ccd] } });
      }
    } else if (type === 'ion') {
      w.push(`Ion "${data.ion || type}"${count > 1 ? ` ×${count}` : ''} removed — ions are not supported in AF3x.`);
    } else {
      w.push(`Unknown entity type "${type}" was removed.`);
    }
  });

  return { converted, warnings: w };
}

function _openServerImportModal(result) {
  const modal   = document.getElementById('server-import-modal');
  const notes   = document.getElementById('serverImportNotes');
  const options = document.getElementById('serverImportOptions');
  const msaRow  = document.getElementById('serverImportMsaRow');
  const tplRow  = document.getElementById('serverImportTplRow');
  if (!modal) return;

  // Render notes
  notes.innerHTML = result.warnings.map((w, i) =>
    `<span class="${i === 0 ? 'note-converted' : 'note-warn'}">${i === 0 ? 'ℹ' : '⚠'} ${w}</span>`
  ).join('');

  // Check which optional content exists in converted sequences
  const hasMsa = result.converted.sequences.some(s => {
    const d = Object.values(s)[0];
    return d.unpairedMsa || d.pairedMsa;
  });
  const hasTpl = result.converted.sequences.some(s => {
    const d = Object.values(s)[0];
    return d.templates?.length > 0;
  });

  options.style.display = (hasMsa || hasTpl) ? '' : 'none';
  msaRow.style.display  = hasMsa ? '' : 'none';
  tplRow.style.display  = hasTpl ? '' : 'none';
  document.getElementById('serverImportMsa').checked = true;
  document.getElementById('serverImportTpl').checked = true;

  modal._pendingResult = result;
  modal.style.display  = 'flex';
}

function _initServerImportModal() {
  const modal = document.getElementById('server-import-modal');
  if (!modal) return;
  const close = () => { modal.style.display = 'none'; modal._pendingResult = null; };
  document.getElementById('serverImportClose')?.addEventListener('click', close);
  document.getElementById('serverImportCancel')?.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  document.getElementById('serverImportConfirm')?.addEventListener('click', () => {
    const result = modal._pendingResult;
    if (!result) return;
    close();

    const includeMsa = document.getElementById('serverImportMsa').checked;
    const includeTpl = document.getElementById('serverImportTpl').checked;

    // Deep-clone and strip unwanted fields
    const json = JSON.parse(JSON.stringify(result.converted));
    if (!includeMsa || !includeTpl) {
      json.sequences.forEach(s => {
        const d = Object.values(s)[0];
        if (!includeMsa) { delete d.unpairedMsa; delete d.pairedMsa; }
        if (!includeTpl && d.templates?.length > 0) delete d.templates;
      });
    }

    const populateWarnings = _populateFromJSON(json);
    const allWarnings = populateWarnings.filter(Boolean);
    if (allWarnings.length) {
      alert('Imported.\n\nNotes:\n• ' + allWarnings.join('\n• '));
    }
  });
}

function _handleJsonImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const raw = JSON.parse(ev.target.result);
      const dialect = _detectJsonDialect(raw);

      if (dialect === 'alphafoldserver') {
        const result = _convertServerJson(raw);
        _openServerImportModal(result);
      } else if (dialect === 'af3x') {
        const populateWarnings = _populateFromJSON(raw);
        if (populateWarnings.length) {
          alert('JSON imported.\n\nNotes:\n• ' + populateWarnings.join('\n• '));
        } else {
          alert('JSON imported successfully!');
        }
      } else {
        alert('Unrecognized JSON format. Expected an AF3/AF3x input JSON or an AlphaFold Server job_request.json.');
      }
    } catch (err) {
      alert('Invalid JSON: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function _populateFromJSON(json) {
  // Clear existing
  document.getElementById('sequences-container').innerHTML = '';
  document.getElementById('crosslinks-container').innerHTML = '';
  document.getElementById('ss-bonds-container').innerHTML = '';
  document.getElementById('bonds-container').innerHTML = '';
  _seqCounter = 0; _xlCounter = 0; _ssCounter = 0; _bondCounter = 0;

  // Job settings
  document.getElementById('jobName').value      = json.name || '';
  const importedSeeds = json.modelSeeds || [1];
  document.querySelectorAll('.seed-seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === 'specific');
  });
  document.getElementById('seedCount').style.display    = 'none';
  document.getElementById('seedSpecific').style.display = '';
  document.getElementById('seedSpecific').value         = importedSeeds.join(', ');

  // Restore version from imported JSON
  const importedVersion = parseInt(json.version, 10);
  const versionEl = document.getElementById('inputVersion');
  let versionWarning = null;
  if (versionEl) {
    if (importedVersion >= 1 && importedVersion <= 4) {
      versionEl.value = importedVersion;
    } else if (json.version !== undefined) {
      versionEl.value = 4;
      versionWarning = `Unsupported JSON version "${json.version}" — defaulted to version 4.`;
    } else {
      versionEl.value = 4;
    }
  }

  // Sequences
  (json.sequences || []).forEach(seqObj => {
    const type = Object.keys(seqObj)[0];
    const data = seqObj[type];
    addSequenceCard(type);

    const card = document.querySelector('.seq-card:last-child');
    if (!card) return;

    // Chain ID
    const chainInput = card.querySelector('.seq-chain-id');
    if (chainInput) {
      chainInput.value = Array.isArray(data.id) ? data.id.join(',') : (data.id || '');
    }

    // Description (optional, purely cosmetic)
    const descInput = card.querySelector('.seq-description');
    if (descInput) descInput.value = data.description || '';

    // Sequence
    const seqTA = card.querySelector('.seq-textarea');
    if (seqTA && data.sequence) {
      seqTA.value = data.sequence;
      _autoValidateSeq(seqTA, type);
      _updateRuler(card);
    }

    // Ligand
    if (type === 'ligand') {
      if (data.smiles) {
        card.querySelector('.ligand-smiles').value = data.smiles;
        card.querySelector('.tab-btn[data-tab="smiles"]')?.click();
      } else if (data.ccdCodes) {
        card.querySelector('.ligand-ccd').value = data.ccdCodes.join(',');
      }
    }

    // MSA
    const noMsaCheckEl  = card.querySelector('.no-msa-check');
    const msaCustomWrap = card.querySelector('.msa-custom-wrap');
    if (noMsaCheckEl) {
      const hasMsaFree   = data.unpairedMsa === '' || data.pairedMsa === '';
      const hasCustomMsa = data.unpairedMsaPath || data.pairedMsaPath || data.unpairedMsa || data.pairedMsa;
      if (hasMsaFree) {
        noMsaCheckEl.checked = true;
        noMsaCheckEl.dispatchEvent(new Event('change'));
      } else if (hasCustomMsa) {
        if (msaCustomWrap) msaCustomWrap.style.display = 'block';
        const unpairedPathEl = card.querySelector('.msa-unpaired-path');
        const pairedPathEl   = card.querySelector('.msa-paired-path');
        if (unpairedPathEl) {
          if (data.unpairedMsaPath) {
            unpairedPathEl.value = data.unpairedMsaPath;
          } else if (data.unpairedMsa) {
            const contentEl = card.querySelector('.msa-unpaired-content');
            if (contentEl) contentEl.value = data.unpairedMsa;
            unpairedPathEl.value = '(inline content)';
            unpairedPathEl.dataset.isUpload = 'true';
          }
        }
        if (pairedPathEl) {
          if (data.pairedMsaPath) {
            pairedPathEl.value = data.pairedMsaPath;
          } else if (data.pairedMsa) {
            const contentEl = card.querySelector('.msa-paired-content');
            if (contentEl) contentEl.value = data.pairedMsa;
            pairedPathEl.value = '(inline content)';
            pairedPathEl.dataset.isUpload = 'true';
          }
        }
      }
    }

    // Modifications
    if (data.modifications?.length) {
      const modsEl = card.querySelector('.mods-container');
      data.modifications.forEach(mod => {
        const code = mod.ptmType || mod.modificationType || '';
        const pos  = mod.ptmPosition || mod.basePosition || '';
        if (modsEl) _addModRow(modsEl, card.dataset.id, code, pos);
      });
    }

    // "Without templates" — restore if templates: [] was explicitly set
    if (Array.isArray(data.templates) && data.templates.length === 0) {
      const noTplCheck = card.querySelector('.no-templates-check');
      if (noTplCheck) {
        noTplCheck.checked = true;
        noTplCheck.dispatchEvent(new Event('change'));
      }
    } else if (Array.isArray(data.templates) && data.templates.length > 0) {
      data.templates.forEach(tpl => {
        _addTemplate(card, card.dataset.id);
        const entries = card.querySelectorAll('.tpl-entry');
        const div = entries[entries.length - 1];
        const mmcifTa   = div.querySelector('.tpl-mmcif');
        const mmcifPath = div.querySelector('.tpl-mmcif-path');
        if (tpl.mmcif && mmcifTa)         { mmcifTa.value   = tpl.mmcif;     if (mmcifPath) mmcifPath.disabled = true; }
        else if (tpl.mmcifPath && mmcifPath) { mmcifPath.value = tpl.mmcifPath; if (mmcifTa)   mmcifTa.disabled   = true; }
        if (tpl.queryIndices)    div.querySelector('.tpl-query-idx').value = tpl.queryIndices.join(', ');
        if (tpl.templateIndices) div.querySelector('.tpl-tpl-idx').value   = tpl.templateIndices.join(', ');
      });
    }

    _updateAdvancedSummary(card.dataset.id);
  });

  // Crosslinks
  (json.crosslinks || []).forEach(group => {
    const pairs = (group.residue_pairs || []).map(pair => ({
      chain1: pair[0][0], pos1: pair[0][1],
      chain2: pair[1][0], pos2: pair[1][1],
    }));
    addCrosslinkGroup({ name: group.name, pairs });
  });

  // Disulfide bonds
  (json.disulfide_bonds || []).forEach(ssBond => {
    (ssBond.residue_pairs || []).forEach(pair => {
      addSsBond();
      const row = document.querySelector('.ss-pair-row:last-child');
      if (row) {
        row.querySelector('.ss-chain-a').value = pair[0][0];
        row.querySelector('.ss-pos-a').value   = pair[0][1];
        row.querySelector('.ss-chain-b').value = pair[1][0];
        row.querySelector('.ss-pos-b').value   = pair[1][1];
      }
    });
  });

  // Bonded atom pairs
  (json.bondedAtomPairs || []).forEach(bond => {
    addBond();
    const div = document.querySelector('.bond-pair-row:last-child');
    if (div) {
      div.querySelector('.bond-entity-a').value = bond[0][0] || '';
      div.querySelector('.bond-res-a').value    = bond[0][1] || '';
      div.querySelector('.bond-atom-a').value   = bond[0][2] || '';
      div.querySelector('.bond-entity-b').value = bond[1][0] || '';
      div.querySelector('.bond-res-b').value    = bond[1][1] || '';
      div.querySelector('.bond-atom-b').value   = bond[1][2] || '';
    }
  });

  // User CCD
  document.getElementById('userCCD').value     = json.userCCD || '';
  document.getElementById('userCCDPath').value = json.userCCDPath || '';
  _syncUserCcdExclusivity();

  updateViz();
  return versionWarning ? [versionWarning] : [];
}

// ─── JSON Generation ──────────────────────────────────────────────────────────

function _fixAsymmetricXlOrder(jsonObj, chainSeqMap) {
  const notes = [];
  (jsonObj.crosslinks || []).forEach(group => {
    const xl = CROSSLINKERS.find(x => group.name === x.name || group.name.startsWith(x.name));
    if (!xl || xl.symmetric || xl.dynamic) return;

    const end1 = xl.reactiveResidues[0]; // NHS-ester end — must be position 1

    const isEnd1Compatible = (chain, pos) => {
      if (!end1 || end1.includes('any AA')) return true;
      const seq = chainSeqMap[chain];
      if (!seq) return true; // unknown chain — skip
      const aa = seq[pos - 1];
      if (!aa) return true;
      return end1.includes(aa) || (pos === 1 && end1.includes('N-term'));
    };

    (group.residue_pairs || []).forEach((pair, i) => {
      const [c1, p1] = pair[0];
      const [c2, p2] = pair[1];
      if (!isEnd1Compatible(c1, p1) && isEnd1Compatible(c2, p2)) {
        group.residue_pairs[i] = [[c2, p2], [c1, p1]];
        const aa1 = chainSeqMap[c1]?.[p1 - 1] || '?';
        const aa2 = chainSeqMap[c2]?.[p2 - 1] || '?';
        notes.push(`${group.name}: swapped ${c1}:${aa1}${p1} ↔ ${c2}:${aa2}${p2} — ${aa2}${p2} placed first as NHS-ester (END1) anchor`);
      }
    });
  });
  return notes;
}

let _hasGeneratedOnce = false;

function _markOutputStale() {
  if (!_hasGeneratedOnce) return;
  const banner = document.getElementById('outputStaleBanner');
  if (banner) banner.style.display = 'flex';
  const dl = document.getElementById('downloadJsonLink');
  if (dl) dl.classList.add('stale-action');
}

function _clearOutputStale() {
  const banner = document.getElementById('outputStaleBanner');
  if (banner) banner.style.display = 'none';
  const dl = document.getElementById('downloadJsonLink');
  if (dl) dl.classList.remove('stale-action');
}

function generateJSON() {
  try {
    const output = _buildJSON();

    // Build chainSeqMap for order correction
    const csMap = {};
    (output.sequences || []).forEach(entry => {
      const type = Object.keys(entry)[0];
      const data = entry[type];
      if (data.sequence) {
        const ids = Array.isArray(data.id) ? data.id : [data.id];
        ids.forEach(id => { csMap[id] = data.sequence; });
      }
    });

    // Auto-fix asymmetric XL pair order BEFORE serialising
    const autoSwaps = _fixAsymmetricXlOrder(output, csMap);

    const pretty = JSON.stringify(output, null, 2);

    const el = document.getElementById('jsonOutput');
    el.textContent = pretty;

    // Brief flash on re-generate to confirm it ran
    if (_hasGeneratedOnce) {
      el.classList.add('output-flash');
      setTimeout(() => el.classList.remove('output-flash'), 350);
    }
    _hasGeneratedOnce = true;
    _clearOutputStale();

    // Show expand + copy + download
    document.getElementById('expandJsonBtn').style.display = 'inline-block';
    document.getElementById('copyJsonBtn').style.display  = 'inline-block';
    const dl = document.getElementById('downloadJsonLink');
    dl.href     = 'data:application/json;charset=utf-8,' + encodeURIComponent(pretty);
    dl.download = (output.name || 'alphafold3_input') + '.json';
    dl.style.display = 'inline-block';

    // Validate (auto-swaps already applied)
    const { errors, warnings } = _validateGeneratedJSON(output);
    _showValidationReport(errors, warnings, autoSwaps);

  } catch (err) {
    document.getElementById('jsonOutput').textContent = '// Error: ' + err.message;
    _showValidationReport([err.message], []);
    console.error(err);
  }
}

function _validateGeneratedJSON(jsonObj) {
  const errors   = [];
  const warnings = [];

  // Build chain → sequence map and chain → type map from the JSON object itself
  const chainSeqMap  = {};
  const chainTypeMap = {};   // id → 'protein' | 'rna' | 'dna' | 'ccd_ligand' | 'smiles_ligand'
  (jsonObj.sequences || []).forEach(entry => {
    const type = Object.keys(entry)[0];
    const data = entry[type];
    const ids  = Array.isArray(data.id) ? data.id : [data.id];
    if (data.sequence) ids.forEach(id => { chainSeqMap[id] = data.sequence; });
    const kind = (type === 'ligand') ? (data.smiles ? 'smiles_ligand' : 'ccd_ligand') : type;
    ids.forEach(id => { chainTypeMap[id] = kind; });
  });
  const knownChains = new Set(Object.keys(chainSeqMap));

  // Validate crosslink groups
  (jsonObj.crosslinks || []).forEach(group => {
    const xlName = group.name;
    const xl     = CROSSLINKERS.find(x => xlName === x.name || xlName.startsWith(x.name));

    (group.residue_pairs || []).forEach(pair => {
      const [c1, p1] = pair[0];
      const [c2, p2] = pair[1];

      if (!knownChains.has(c1)) errors.push(`XL "${xlName}": chain "${c1}" is not defined in sequences`);
      if (!knownChains.has(c2)) errors.push(`XL "${xlName}": chain "${c2}" is not defined in sequences`);

      const seq1 = chainSeqMap[c1];
      const seq2 = chainSeqMap[c2];
      if (seq1 && p1 > seq1.length) errors.push(`XL "${xlName}": ${c1}:${p1} out of bounds (chain length ${seq1.length})`);
      if (seq2 && p2 > seq2.length) errors.push(`XL "${xlName}": ${c2}:${p2} out of bounds (chain length ${seq2.length})`);

      // Chemical compatibility (order already auto-corrected for asymmetric XLs)
      if (xl && !xl.dynamic && seq1 && seq2) {
        const r1 = xl.symmetric ? xl.reactiveResidues : xl.reactiveResidues[0];
        const r2 = xl.symmetric ? xl.reactiveResidues : xl.reactiveResidues[1];

        const chemOk = (seq, pos, reactive) => {
          if (!reactive || reactive.includes('any AA')) return true;
          const aa = seq[pos - 1];
          if (!aa) return true;
          if (reactive.includes(aa)) return true;
          if (pos === 1 && reactive.includes('N-term')) return true;
          return false;
        };

        const _fmtAllowed = r => {
          const aas = r.filter(x => x !== 'N-term').join(', ');
          return r.includes('N-term') ? `${aas} (or N-term)` : aas;
        };
        if (!chemOk(seq1, p1, r1)) {
          const aa = seq1[p1 - 1];
          const msg = `XL "${xlName}": ${c1}:${aa}${p1} — ${aa} not reactive at END1 position [${_fmtAllowed(r1)}]`;
          errors.push(msg);
        }
        if (!chemOk(seq2, p2, r2)) {
          const aa = seq2[p2 - 1];
          const msg = `XL "${xlName}": ${c2}:${aa}${p2} — ${aa} not reactive at END2 position [${_fmtAllowed(r2)}]`;
          // Only error if the crosslinker actually requires a specific residue at END2
          const isAnyAA = !r2 || r2.includes('any AA');
          if (isAnyAA) warnings.push(msg); else errors.push(msg);
        }
      }
    });
  });

  // Duplicate residue positions across all XL pairs
  const xlPosUsage = {};
  (jsonObj.crosslinks || []).forEach(group => {
    (group.residue_pairs || []).forEach(pair => {
      const k1 = `${pair[0][0]}:${pair[0][1]}`;
      const k2 = `${pair[1][0]}:${pair[1][1]}`;
      xlPosUsage[k1] = (xlPosUsage[k1] || 0) + 1;
      xlPosUsage[k2] = (xlPosUsage[k2] || 0) + 1;
    });
  });
  Object.entries(xlPosUsage).forEach(([key, count]) => {
    if (count > 1) errors.push(`Residue ${key} appears in ${count} crosslink pairs — each residue may only be crosslinked once`);
  });

  // Disulfide bonds
  (jsonObj.disulfide_bonds || []).forEach(group => {
    (group.residue_pairs || []).forEach(pair => {
      const [c1, p1] = pair[0];
      const [c2, p2] = pair[1];
      if (!knownChains.has(c1)) errors.push(`S–S bond: chain "${c1}" is not defined`);
      if (!knownChains.has(c2)) errors.push(`S–S bond: chain "${c2}" is not defined`);
      // Cysteine check
      if (chainSeqMap[c1]?.[p1-1] && chainSeqMap[c1][p1-1] !== 'C')
        warnings.push(`S–S bond: ${c1}:${chainSeqMap[c1][p1-1]}${p1} — expected Cys (C)`);
      if (chainSeqMap[c2]?.[p2-1] && chainSeqMap[c2][p2-1] !== 'C')
        warnings.push(`S–S bond: ${c2}:${chainSeqMap[c2][p2-1]}${p2} — expected Cys (C)`);
    });
  });

  // Bonded atom pairs — must have at least one CCD-ligand endpoint
  const POLYMER_TYPES = new Set(['protein', 'rna', 'dna']);
  (jsonObj.bondedAtomPairs || []).forEach((bond, bi) => {
    const eA    = bond[0][0];
    const eB    = bond[1][0];
    const typeA = chainTypeMap[eA];
    const typeB = chainTypeMap[eB];
    const idx   = bi + 1;

    if (typeA === 'smiles_ligand')
      errors.push(`Bonded atom pair ${idx}: chain "${eA}" is a SMILES ligand — SMILES compounds have no named atoms; use a CCD ligand instead`);
    if (typeB === 'smiles_ligand')
      errors.push(`Bonded atom pair ${idx}: chain "${eB}" is a SMILES ligand — SMILES compounds have no named atoms; use a CCD ligand instead`);
    if (typeA && typeB && POLYMER_TYPES.has(typeA) && POLYMER_TYPES.has(typeB))
      errors.push(`Bonded atom pair ${idx}: both "${eA}" (${typeA}) and "${eB}" (${typeB}) are polymer chains — at least one endpoint must be a CCD ligand`);
  });

  return { errors, warnings };
}

function _showValidationReport(errors, warnings, infos = []) {
  const panel = document.getElementById('json-validation-panel');
  if (!panel) return;

  if (errors.length === 0 && warnings.length === 0 && infos.length === 0) {
    panel.innerHTML = '<div class="val-ok">✓ All checks passed — JSON is valid</div>';
  } else {
    let html = '';
    errors.forEach(e   => { html += `<div class="val-error">✗ ${e}</div>`; });
    warnings.forEach(w => { html += `<div class="val-warn">⚠ ${w}</div>`; });
    infos.forEach(i    => { html += `<div class="val-info">↔ ${i}</div>`; });
    panel.innerHTML = html;
  }
  panel.style.display = 'block';
}

function _buildJSON() {
  const name    = document.getElementById('jobName').value.trim();
  const version = parseInt(document.getElementById('inputVersion')?.value || '4', 10) || 4;

  const seedMode = document.querySelector('.seed-seg-btn.active')?.dataset.mode || 'count';
  let seeds;
  if (seedMode === 'count') {
    const n = parseInt(document.getElementById('seedCount')?.value || '1');
    if (n < 1 || n > 100) throw new Error('Seed count must be between 1 and 100.');
    seeds = Array.from({ length: n }, (_, i) => i + 1);
  } else {
    const raw = document.getElementById('seedSpecific')?.value.trim() || '';
    seeds = raw.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    if (!seeds.length) throw new Error('At least one model seed is required.');
  }
  if (!name) throw new Error('Job name is required.');

  // Field order matches real AF3x JSON files
  const output = { dialect: 'alphafold3', version, name, modelSeeds: seeds, sequences: [] };

  // ── Sequences ─────────────────────────────────────────────────────────────
  document.querySelectorAll('.seq-card').forEach(card => {
    const type    = card.querySelector('.seq-type-label').textContent.toLowerCase();
    const chainRaw = card.querySelector('.seq-chain-id').value.trim();
    if (!chainRaw) throw new Error('All sequence entities need a chain ID.');

    const ids = chainRaw.includes(',')
      ? chainRaw.split(',').map(s => s.trim()).filter(Boolean)
      : chainRaw;

    const seqData = { id: ids };

    const description = card.querySelector('.seq-description')?.value.trim();
    if (description) seqData.description = description;

    if (type === 'ligand') {
      const smilesEl = card.querySelector('.ligand-smiles');
      const ccdEl    = card.querySelector('.ligand-ccd');
      // Active tab determines which to use
      const activePanel = card.querySelector('.ligand-body .tab-panel.active');
      if (activePanel?.dataset.panel === 'smiles') {
        const smiles = smilesEl?.value.trim();
        if (!smiles) throw new Error(`Ligand chain "${chainRaw}": SMILES is empty.`);
        seqData.smiles = smiles;
      } else {
        const ccd = ccdEl?.value.trim();
        if (!ccd) throw new Error(`Ligand chain "${chainRaw}": CCD codes are empty.`);
        seqData.ccdCodes = ccd.split(',').map(s => s.trim()).filter(Boolean);
      }
      output.sequences.push({ ligand: seqData });
      return;
    }

    const seqTA = card.querySelector('.seq-textarea');
    const seq   = (seqTA?.value || '').trim().replace(/\s/g, '').toUpperCase();
    if (!seq) throw new Error(`Chain "${chainRaw}": sequence is empty.`);
    if (type === 'rna' && /[^ACGU]/.test(seq))
      throw new Error(`Chain "${chainRaw}": RNA sequence may only contain A, C, G, U.`);
    if (type === 'dna' && /[^ACGT]/.test(seq))
      throw new Error(`Chain "${chainRaw}": DNA sequence may only contain A, C, G, T.`);
    seqData.sequence = seq;

    // Modifications
    const mods = [];
    card.querySelectorAll('.mod-row').forEach(row => {
      const code = row.querySelector('.mod-ccd')?.value.trim();
      const pos  = parseInt(row.querySelector('.mod-pos')?.value) || null;
      if (code && pos) {
        if (type === 'protein') mods.push({ ptmType: code, ptmPosition: pos });
        else                    mods.push({ modificationType: code, basePosition: pos });
      }
    });
    if (mods.length) seqData.modifications = mods;

    // MSA — protein and RNA only; DNA has no MSA support in AF3x spec
    let msaMode = 'auto';
    if (type === 'protein' || type === 'rna') {
      msaMode = _getMsaMode(card);

      if (msaMode === 'none') {
        seqData.unpairedMsa = '';
        if (type === 'protein') seqData.pairedMsa = '';
      } else if (msaMode === 'custom') {
        const unpairedPathEl    = card.querySelector('.msa-unpaired-path');
        const unpairedContentEl = card.querySelector('.msa-unpaired-content');
        const unpairedPath      = unpairedPathEl?.value.trim() || '';
        const unpairedIsUpload  = unpairedPathEl?.dataset.isUpload === 'true';
        const unpairedContent   = unpairedContentEl?.value || '';

        if (unpairedIsUpload && unpairedContent.trim()) {
          seqData.unpairedMsa = unpairedContent;
        } else if (unpairedPath) {
          seqData.unpairedMsaPath = unpairedPath;
        }

        if (type === 'protein') {
          const pairedPathEl    = card.querySelector('.msa-paired-path');
          const pairedContentEl = card.querySelector('.msa-paired-content');
          const pairedPath      = pairedPathEl?.value.trim() || '';
          const pairedIsUpload  = pairedPathEl?.dataset.isUpload === 'true';
          const pairedContent   = pairedContentEl?.value || '';

          if (pairedIsUpload && pairedContent.trim()) {
            seqData.pairedMsa = pairedContent;
          } else if (pairedPath) {
            seqData.pairedMsaPath = pairedPath;
          }
        }
      }
      // 'auto': omit all MSA fields → AF3 generates automatically
    }

    // Templates
    const tplEntries = [];
    card.querySelectorAll('.tpl-entry').forEach(tpl => {
      const mmcifContent  = tpl.querySelector('.tpl-mmcif')?.value.trim()      || null;
      const mmcifPath     = tpl.querySelector('.tpl-mmcif-path')?.value.trim() || null;
      const queryRaw      = tpl.querySelector('.tpl-query-idx')?.value.trim()  || '';
      const tplRaw        = tpl.querySelector('.tpl-tpl-idx')?.value.trim()    || '';

      if (!queryRaw || !tplRaw)
        throw new Error(`Template in chain "${chainRaw}": both query and template indices are required.`);
      if (mmcifContent && mmcifPath)
        throw new Error(`Template in chain "${chainRaw}": provide mmCIF content OR path, not both.`);

      const entry = {};
      if (mmcifPath) entry.mmcifPath = mmcifPath;
      else if (mmcifContent) entry.mmcif = mmcifContent;
      entry.queryIndices    = queryRaw.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
      entry.templateIndices = tplRaw.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
      if (entry.queryIndices.length !== entry.templateIndices.length)
        throw new Error(`Template in chain "${chainRaw}": query and template index counts must match.`);
      tplEntries.push(entry);
    });
    const noTpl = card.querySelector('.no-templates-check')?.checked;
    if (noTpl) {
      seqData.templates = []; // explicitly disable template search
    } else if (tplEntries.length) {
      seqData.templates = tplEntries;
      // AF3x rejects this combination outright ("templates set only partially"):
      // custom templates require unpairedMsa/pairedMsa to also be explicit.
      if (msaMode === 'auto') {
        throw new Error(
          `Chain "${chainRaw}": has custom templates but MSA is still on Auto. ` +
          `AF3x requires MSA to be explicit too — pick "Without MSA" or add a custom MSA for this chain.`
        );
      }
    }

    output.sequences.push({ [type]: seqData });
  });

  if (!output.sequences.length) throw new Error('Add at least one sequence entity.');

  // ── Crosslinks ─────────────────────────────────────────────────────────────
  const xlGroups = [];
  document.querySelectorAll('.xl-group-card').forEach(card => {
    const xlId    = card.dataset.id;
    const xlSel   = card.querySelector('.xl-select');
    let   xlName  = xlSel?.value || 'DSSO';

    const xl = CROSSLINKERS.find(x => x.name === xlName);
    if (xl?.dynamic) {
      const n = parseInt(card.querySelector('.xl-dyn-n-input')?.value) || 5;
      xlName  = xlName + n;
    }

    const pairs = [];
    card.querySelectorAll('.xl-pair-row').forEach(row => {
      const c1 = row.querySelector('.xl-chain-a')?.value.trim();
      const p1 = parseInt(row.querySelector('.xl-pos-a')?.value) || null;
      const c2 = row.querySelector('.xl-chain-b')?.value.trim();
      const p2 = parseInt(row.querySelector('.xl-pos-b')?.value) || null;
      if (c1 && p1 && c2 && p2) pairs.push([[c1, p1], [c2, p2]]);
    });

    if (pairs.length) xlGroups.push({ name: xlName, residue_pairs: pairs });
  });
  if (xlGroups.length) output.crosslinks = xlGroups;

  // ── Disulfide bonds ─────────────────────────────────────────────────────────
  const ssPairs = [];
  document.querySelectorAll('.ss-pair-row').forEach(row => {
    const c1 = row.querySelector('.ss-chain-a')?.value.trim();
    const p1 = parseInt(row.querySelector('.ss-pos-a')?.value) || null;
    const c2 = row.querySelector('.ss-chain-b')?.value.trim();
    const p2 = parseInt(row.querySelector('.ss-pos-b')?.value) || null;
    if (c1 && p1 && c2 && p2) ssPairs.push([[c1, p1], [c2, p2]]);
  });
  if (ssPairs.length) output.disulfide_bonds = [{ residue_pairs: ssPairs }];

  // ── Bonded atom pairs ───────────────────────────────────────────────────────
  const bonds = [];
  document.querySelectorAll('.bond-pair-row').forEach(div => {
    const ea = div.querySelector('.bond-entity-a')?.value.trim();
    const ra = parseInt(div.querySelector('.bond-res-a')?.value) || null;
    const aa = div.querySelector('.bond-atom-a')?.value.trim();
    const eb = div.querySelector('.bond-entity-b')?.value.trim();
    const rb = parseInt(div.querySelector('.bond-res-b')?.value) || null;
    const ab = div.querySelector('.bond-atom-b')?.value.trim();
    if (ea && ra && aa && eb && rb && ab) bonds.push([[ea, ra, aa], [eb, rb, ab]]);
  });
  if (bonds.length) output.bondedAtomPairs = bonds;

  // ── User CCD ────────────────────────────────────────────────────────────────
  const ccdContent = document.getElementById('userCCD')?.value.trim();
  const ccdPath    = document.getElementById('userCCDPath')?.value.trim();
  if (ccdContent && ccdPath) throw new Error('Provide User CCD content OR path, not both.');
  if (ccdContent) output.userCCD     = ccdContent;
  if (ccdPath)    output.userCCDPath = ccdPath;

  return output;
}

// ─── Copy JSON ────────────────────────────────────────────────────────────────

function _copyJSON(e) {
  const text = document.getElementById('jsonOutput').textContent;
  if (!text || text.startsWith('//')) return;
  navigator.clipboard.writeText(text).then(() => {
    const btn = e?.currentTarget || document.getElementById('copyJsonBtn');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
}

// ─── Arc Diagram Update ───────────────────────────────────────────────────────

let _autoSaveTimer = null;

export function updateViz() {
  const svg = document.getElementById('arc-svg');
  if (!svg) return;

  const chains   = _readChainsFromDOM();
  const xlGroups = _readXlGroupsFromDOM();
  const ssBonds  = _readSsBondsFromDOM();

  drawArcDiagram(svg, chains, xlGroups, ssBonds);
  _rewireArcEvents(svg);
  _updateArcLegend(xlGroups, ssBonds);
  updateXlStats();
  _validateAll();
  _markOutputStale();


  // Refresh XL highlights in all visible sequence displays
  document.querySelectorAll('.seq-card').forEach(card => {
    const display = card.querySelector('.seq-display');
    if (display && display.style.display !== 'none') _updateRuler(card);
  });

  // Debounced auto-save
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(_tryAutoSave, 1500);
}

function _readChainsFromDOM() {
  const chains = [];
  document.querySelectorAll('.seq-card').forEach((card, cardIdx) => {
    const type     = card.querySelector('.seq-type-label')?.textContent.toLowerCase() || 'protein';
    const chainRaw  = card.querySelector('.seq-chain-id')?.value.trim() || '';
    const color     = card.dataset.color || chainColorForType(type, cardIdx);
    const seqTA     = card.querySelector('.seq-textarea');
    const seqLen    = seqTA ? (seqTA.value.trim().replace(/\s/g,'').length || 0) : 0;

    const ids = chainRaw.includes(',')
      ? chainRaw.split(',').map(s => s.trim()).filter(Boolean)
      : chainRaw ? [chainRaw] : [];

    ids.forEach(id => {
      chains.push({ id, label: id, length: seqLen || null, color, type });
    });
  });
  return chains;
}

function _readXlGroupsFromDOM() {
  const groups = [];
  let pairIdx  = 0;  // global counter — gives each pair a unique color
  document.querySelectorAll('.xl-group-card').forEach((card, gi) => {
    const xlId   = card.dataset.id;
    const xlSel  = card.querySelector('.xl-select');
    let   xlName = xlSel?.value || '';
    const xl     = CROSSLINKERS.find(x => x.name === xlName);
    if (xl?.dynamic) {
      const n = parseInt(card.querySelector('.xl-dyn-n-input')?.value) || 5;
      xlName  = xlName + n;
    }

    const groupColor = XL_GROUP_COLORS[gi % XL_GROUP_COLORS.length];
    const dashArray  = XL_DASH_PATTERNS[gi % XL_DASH_PATTERNS.length];
    const pairs = [];

    card.querySelectorAll('.xl-pair-row').forEach(row => {
      const c1 = row.querySelector('.xl-chain-a')?.value.trim();
      const p1 = parseInt(row.querySelector('.xl-pos-a')?.value) || null;
      const c2 = row.querySelector('.xl-chain-b')?.value.trim();
      const p2 = parseInt(row.querySelector('.xl-pos-b')?.value) || null;
      if (c1 && p1 && c2 && p2) {
        const color = XL_GROUP_COLORS[pairIdx % XL_GROUP_COLORS.length];
        pairs.push({ chain1: c1, pos1: p1, chain2: c2, pos2: p2, color, dashArray });
        pairIdx++;
      }
    });

    if (pairs.length) groups.push({ name: xlName, color: groupColor, dashArray, pairs });
  });
  return groups;
}

function _readSsBondsFromDOM() {
  const bonds = [];
  document.querySelectorAll('.ss-pair-row').forEach(row => {
    const c1 = row.querySelector('.ss-chain-a')?.value.trim();
    const p1 = parseInt(row.querySelector('.ss-pos-a')?.value) || null;
    const c2 = row.querySelector('.ss-chain-b')?.value.trim();
    const p2 = parseInt(row.querySelector('.ss-pos-b')?.value) || null;
    if (c1 && p1 && c2 && p2) bonds.push({ chain1: c1, pos1: p1, chain2: c2, pos2: p2 });
  });
  return bonds;
}

function _updateArcLegend(xlGroups, ssBonds) {
  const el = document.getElementById('arc-legend');
  if (!el) return;

  const hasSS = ssBonds && ssBonds.length > 0;
  const hasMultiXL = xlGroups && xlGroups.length >= 2;
  if (!hasSS && !hasMultiXL) { el.innerHTML = ''; return; }

  const _svgLine = (color, dash) =>
    `<svg width="36" height="12" style="vertical-align:middle;margin:0 4px 0 2px">` +
    `<line x1="2" y1="6" x2="34" y2="6" stroke="${color}" stroke-width="2.5"` +
    (dash && dash !== 'none' ? ` stroke-dasharray="${dash}"` : '') + `/></svg>`;

  let html = '';
  if (hasMultiXL) {
    html += '<span class="arc-legend-label">Crosslinker groups:</span>';
    xlGroups.forEach(grp => {
      html += `<span class="arc-legend-item">${_svgLine(grp.color || '#9aa0a6', grp.dashArray)}${grp.name || '—'}</span>`;
    });
  }
  if (hasSS) {
    if (html) html += '<span class="arc-legend-sep">·</span>';
    html += `<span class="arc-legend-item">${_svgLine('#f0b400', '5 3')}Disulfide (S–S)</span>`;
  }
  el.innerHTML = html;
}

// ─── Batch export / Screening ─────────────────────────────────────────────────

/** Extract all crosslink pairs from the DOM as flat objects. */
function _getAllCrosslinkPairs() {
  const all = [];
  document.querySelectorAll('.xl-group-card').forEach(card => {
    const xlSel = card.querySelector('.xl-select');
    let xlName  = xlSel?.value || 'DSSO';
    const xl    = CROSSLINKERS.find(x => x.name === xlName);
    if (xl?.dynamic) {
      const n = parseInt(card.querySelector('.xl-dyn-n-input')?.value) || 5;
      xlName  = xlName + n;
    }
    card.querySelectorAll('.xl-pair-row').forEach(row => {
      const c1 = row.querySelector('.xl-chain-a')?.value.trim();
      const p1 = parseInt(row.querySelector('.xl-pos-a')?.value) || null;
      const c2 = row.querySelector('.xl-chain-b')?.value.trim();
      const p2 = parseInt(row.querySelector('.xl-pos-b')?.value) || null;
      if (c1 && p1 && c2 && p2) all.push({ xlName, pair: [[c1, p1], [c2, p2]] });
    });
  });
  return all;
}

/** Group [{xlName, pair}] → [{name: xlName, residue_pairs: [...]}] for JSON output. */
function _groupByXLName(items) {
  const map = new Map();
  for (const { xlName, pair } of items) {
    if (!map.has(xlName)) map.set(xlName, []);
    map.get(xlName).push(pair);
  }
  return [...map.entries()].map(([name, residue_pairs]) => ({ name, residue_pairs }));
}

/** Build a complete JSON but replace the crosslinks field with the given groups. */
function _buildJSONWithXL(xlGroups) {
  const out = _buildJSON();
  if (xlGroups && xlGroups.length) {
    out.crosslinks = xlGroups;
  } else {
    delete out.crosslinks;
  }
  return out;
}

/** Create and trigger download of a ZIP archive. */
async function _downloadZip(files, zipFilename) {
  const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
  const zip = new JSZip();
  files.forEach(f => zip.file(f.name, f.content));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = zipFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function _batchSingleXL() {
  const btn = document.getElementById('batchSingleBtn');
  btn.disabled = true;
  btn.textContent = 'Building…';
  try {
    const allPairs = _getAllCrosslinkPairs();
    if (!allPairs.length) { alert('No crosslink pairs loaded.'); return; }

    const base    = _buildJSON();  // validates required fields, throws on error
    const jobName = base.name || 'job';

    const files = allPairs.map(({ xlName, pair }) => {
      const label = `${xlName}_${pair[0][0]}${pair[0][1]}-${pair[1][0]}${pair[1][1]}`;
      const json  = _buildJSONWithXL([{ name: xlName, residue_pairs: [pair] }]);
      json.name   = `${jobName}_${label}`;
      return { name: `${jobName}_${label}.json`, content: JSON.stringify(json, null, 2) };
    });

    await _downloadZip(files, `${jobName}_single_xl.zip`);
  } catch (e) {
    alert('Error: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Download ZIP';
  }
}

async function _batchRandomCombos() {
  const btn = document.getElementById('batchComboBtn');
  btn.disabled = true;
  btn.textContent = 'Building…';
  try {
    const allPairs = _getAllCrosslinkPairs();
    const k = parseInt(document.getElementById('batchComboK').value) || 5;
    const m = parseInt(document.getElementById('batchComboM').value) || 20;

    if (!allPairs.length) { alert('No crosslink pairs loaded.'); return; }
    if (k > allPairs.length) {
      alert(`k=${k} exceeds available pairs (${allPairs.length}). Reduce k.`);
      return;
    }

    const base    = _buildJSON();
    const jobName = base.name || 'job';
    const files   = [];

    for (let i = 0; i < m; i++) {
      // Fisher-Yates partial shuffle to pick k random items
      const pool = [...allPairs];
      for (let j = 0; j < k; j++) {
        const r = j + Math.floor(Math.random() * (pool.length - j));
        [pool[j], pool[r]] = [pool[r], pool[j]];
      }
      const chosen   = pool.slice(0, k);
      const xlGroups = _groupByXLName(chosen);
      const json     = _buildJSONWithXL(xlGroups);
      const label    = `${jobName}_combo_${String(i + 1).padStart(3, '0')}`;
      json.name      = label;
      files.push({ name: `${label}.json`, content: JSON.stringify(json, null, 2) });
    }

    await _downloadZip(files, `${jobName}_combos_k${k}_n${m}.zip`);
  } catch (e) {
    alert('Error: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Download ZIP';
  }
}

/** Refresh batch export info labels (called on panel open and input changes). */
function _updateBatchInfo() {
  const n          = _getAllCrosslinkPairs().length;
  const singleInfo = document.getElementById('batchSingleInfo');
  if (singleInfo) {
    singleInfo.textContent = `${n} pair${n !== 1 ? 's' : ''} → ${n} JSON file${n !== 1 ? 's' : ''}`;
  }

  const k         = parseInt(document.getElementById('batchComboK')?.value) || 5;
  const m         = parseInt(document.getElementById('batchComboM')?.value) || 20;
  const comboInfo = document.getElementById('batchComboInfo');
  if (!comboInfo) return;
  if (n === 0) {
    comboInfo.textContent  = 'No crosslink pairs loaded.';
    comboInfo.style.color  = 'var(--warning)';
  } else if (k > n) {
    comboInfo.textContent  = `⚠ k=${k} exceeds available pairs (${n}) — reduce k`;
    comboInfo.style.color  = 'var(--warning)';
  } else {
    const coverage = n > 0 ? ((k / n) * 100).toFixed(0) : 0;
    comboInfo.textContent  = `${m} jobs × ${k} XLs each  (${coverage}% of ${n} pairs per job)`;
    comboInfo.style.color  = '';
  }
}

// ─── Arc click ↔ pair row highlight + zoom ───────────────────────────────────

let _zoomRaf = null;

function _rewireArcEvents(svg) {
  const tooltip = document.getElementById('arc-tooltip');

  svg.querySelectorAll('.xl-arc-group').forEach(group => {
    const key   = group.getAttribute('data-key');
    const label = group.getAttribute('data-label');

    // Click → flash matching pair row
    group.addEventListener('click', () => {
      const [c1, p1, c2, p2] = key.split(':');
      let found = null;
      document.querySelectorAll('.xl-pair-row').forEach(row => {
        if (row.querySelector('.xl-chain-a')?.value.trim() === c1 &&
            String(row.querySelector('.xl-pos-a')?.value).trim() === p1 &&
            row.querySelector('.xl-chain-b')?.value.trim() === c2 &&
            String(row.querySelector('.xl-pos-b')?.value).trim() === p2) {
          found = row;
        }
      });
      if (found) {
        found.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        found.classList.remove('xl-row-flash');
        void found.offsetWidth;
        found.classList.add('xl-row-flash');
      }
    });

    // Hover → show tooltip
    group.addEventListener('mouseenter', () => {
      if (tooltip) { tooltip.textContent = label; tooltip.style.display = 'block'; }
    });

    group.addEventListener('mousemove', e => {
      if (tooltip) {
        tooltip.style.left = (e.clientX + 16) + 'px';
        tooltip.style.top  = (e.clientY - 32) + 'px';
      }
    });

    group.addEventListener('mouseleave', () => {
      if (tooltip) tooltip.style.display = 'none';
    });
  });
}

function _zoomToGroup(svg, group) {
  const fullVb = svg.dataset.fullVb;
  if (!fullVb) return;
  const [, , vw, vh] = fullVb.split(' ').map(Number);

  let bbox;
  try { bbox = group.getBBox(); } catch { return; }

  const PAD = 90;
  let tx = bbox.x - PAD;
  let ty = bbox.y - PAD;
  let tw = bbox.width  + PAD * 2;
  let th = bbox.height + PAD * 2;

  // Clamp to SVG bounds
  if (tx < 0)          { tw += tx;     tx = 0; }
  if (ty < 0)          { th += ty;     ty = 0; }
  if (tx + tw > vw)    { tw = vw - tx;        }
  if (ty + th > vh)    { th = vh - ty;        }

  // Skip zoom if area is already ≥ 80% of the diagram
  if (tw / vw > 0.80 && th / vh > 0.80) return;

  _smoothViewBox(svg, [tx, ty, tw, th], 220);
}

function _restoreViewBox(svg) {
  const fullVb = svg.dataset.fullVb;
  if (!fullVb) return;
  _smoothViewBox(svg, fullVb.split(' ').map(Number), 200);
}

function _smoothViewBox(svg, target, durationMs) {
  const vb    = svg.viewBox.baseVal;
  const start = [vb.x, vb.y, vb.width, vb.height];
  const t0    = performance.now();

  if (_zoomRaf) cancelAnimationFrame(_zoomRaf);

  function step(t) {
    const raw  = Math.min((t - t0) / durationMs, 1);
    const ease = raw < 0.5 ? 4 * raw ** 3 : 1 - (-2 * raw + 2) ** 3 / 2;

    const x = start[0] + (target[0] - start[0]) * ease;
    const y = start[1] + (target[1] - start[1]) * ease;
    const w = start[2] + (target[2] - start[2]) * ease;
    const h = start[3] + (target[3] - start[3]) * ease;
    svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);

    if (raw < 1) {
      _zoomRaf = requestAnimationFrame(step);
    } else {
      _zoomRaf = null;
    }
  }

  _zoomRaf = requestAnimationFrame(step);
}

export function wireXlPairRowHover(row) {
  row.addEventListener('mouseenter', () => {
    const c1 = row.querySelector('.xl-chain-a')?.value.trim();
    const p1 = row.querySelector('.xl-pos-a')?.value.trim();
    const c2 = row.querySelector('.xl-chain-b')?.value.trim();
    const p2 = row.querySelector('.xl-pos-b')?.value.trim();
    if (!c1 || !p1 || !c2 || !p2) return;
    const key = `${c1}:${p1}:${c2}:${p2}`;
    document.querySelectorAll(`.xl-arc-group[data-key="${CSS.escape(key)}"]`).forEach(grp => {
      grp.classList.add('xl-arc-group-hover');
    });
  });
  row.addEventListener('mouseleave', () => {
    document.querySelectorAll('.xl-arc-group.xl-arc-group-hover').forEach(grp => {
      grp.classList.remove('xl-arc-group-hover');
    });
  });
}

// ─── Validation ───────────────────────────────────────────────────────────────

function _validateAll() {
  _checkDuplicateChainIds();
  _checkXlPositions();
}

function _checkDuplicateChainIds() {
  const seen = {};
  document.querySelectorAll('.seq-card').forEach(card => {
    const input = card.querySelector('.seq-chain-id');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;
    // Multi-chain (comma-separated)
    val.split(',').map(s => s.trim()).filter(Boolean).forEach(id => {
      if (!seen[id]) seen[id] = [];
      seen[id].push(input);
    });
  });

  document.querySelectorAll('.seq-chain-id').forEach(input => {
    const warn = input.closest('.seq-chain-id-wrap')?.querySelector('.chain-id-dup-warn');
    const ids  = (input.value.trim()).split(',').map(s => s.trim()).filter(Boolean);
    const isDup = ids.some(id => seen[id] && seen[id].length > 1);
    if (warn) warn.style.display = isDup ? 'inline' : 'none';
    input.classList.toggle('input-warning', isDup);
  });
}

function _checkXlPositions() {
  // Build chain → sequence maps
  const chainLen = {};
  const chainSeq = {};
  document.querySelectorAll('.seq-card').forEach(card => {
    const chainRaw = card.querySelector('.seq-chain-id')?.value.trim() || '';
    const seq      = card.querySelector('.seq-textarea')?.value.replace(/\s/g, '').toUpperCase() || '';
    if (!seq) return;
    chainRaw.split(',').map(s => s.trim()).filter(Boolean).forEach(id => {
      chainLen[id] = seq.length;
      chainSeq[id] = seq;
    });
  });

  // Build duplicate-position map: "chain:pos" → count across all pairs
  const posUsage = {};
  document.querySelectorAll('.xl-pair-row').forEach(row => {
    const c1 = row.querySelector('.xl-chain-a')?.value.trim();
    const p1 = parseInt(row.querySelector('.xl-pos-a')?.value) || 0;
    const c2 = row.querySelector('.xl-chain-b')?.value.trim();
    const p2 = parseInt(row.querySelector('.xl-pos-b')?.value) || 0;
    if (c1 && p1) posUsage[`${c1}:${p1}`] = (posUsage[`${c1}:${p1}`] || 0) + 1;
    if (c2 && p2) posUsage[`${c2}:${p2}`] = (posUsage[`${c2}:${p2}`] || 0) + 1;
  });

  document.querySelectorAll('.xl-pair-row').forEach(row => {
    const posWarn  = row.querySelector('.xl-pos-warn');
    const chemWarn = row.querySelector('.xl-chem-warn');
    const c1 = row.querySelector('.xl-chain-a')?.value.trim();
    const p1 = parseInt(row.querySelector('.xl-pos-a')?.value) || 0;
    const c2 = row.querySelector('.xl-chain-b')?.value.trim();
    const p2 = parseInt(row.querySelector('.xl-pos-b')?.value) || 0;

    // Position bounds
    let posMsg = '';
    if (c1 && p1 && chainLen[c1] && p1 > chainLen[c1]) {
      posMsg = `${c1}: pos ${p1} > len ${chainLen[c1]}`;
    } else if (c2 && p2 && chainLen[c2] && p2 > chainLen[c2]) {
      posMsg = `${c2}: pos ${p2} > len ${chainLen[c2]}`;
    }

    // Duplicate position check — each residue may appear in at most one XL pair
    if (!posMsg) {
      const dups = [];
      if (c1 && p1 && posUsage[`${c1}:${p1}`] > 1) dups.push(`${c1}:${p1}`);
      if (c2 && p2 && posUsage[`${c2}:${p2}`] > 1) dups.push(`${c2}:${p2}`);
      if (dups.length) posMsg = `residue${dups.length > 1 ? 's' : ''} ${dups.join(', ')} used in multiple pairs`;
    }

    if (posWarn) {
      posWarn.textContent   = posMsg ? `⚠ ${posMsg}` : '';
      posWarn.style.display = posMsg ? 'inline' : 'none';
    }

    // Chemical compatibility
    if (chemWarn) {
      const xlCard = row.closest('.xl-group-card');
      const xlName = xlCard?.querySelector('.xl-select')?.value;
      const xl     = CROSSLINKERS.find(x => x.name === xlName);
      let chemMsg  = '';
      let isInfo   = false;

      if (xl && !xl.dynamic && c1 && p1 && c2 && p2) {
        const isOk = (chain, pos, reactive) => {
          if (!reactive || reactive.includes('any AA')) return true;
          const seq = chainSeq[chain];
          if (!seq) return true;
          const aa = seq[pos - 1];
          if (!aa) return true;
          return reactive.includes(aa) || (pos === 1 && reactive.includes('N-term'));
        };

        const fmtR = r => {
          const aas = r.filter(x => x !== 'N-term').join('/');
          return r.includes('N-term') ? `${aas}/N-term` : aas;
        };
        if (xl.symmetric) {
          const r = xl.reactiveResidues;
          const bad = [];
          if (!isOk(c1, p1, r)) {
            const aa = chainSeq[c1]?.[p1 - 1] || '?';
            bad.push(`${c1}:${aa}${p1} not reactive [${fmtR(r)}]`);
          }
          if (!isOk(c2, p2, r)) {
            const aa = chainSeq[c2]?.[p2 - 1] || '?';
            bad.push(`${c2}:${aa}${p2} not reactive [${fmtR(r)}]`);
          }
          chemMsg = bad.join(' · ');
        } else {
          // Asymmetric: check both forward and reversed order
          const end1 = xl.reactiveResidues[0];
          const end2 = xl.reactiveResidues[1];
          const fwdOk = isOk(c1, p1, end1) && isOk(c2, p2, end2);
          const revOk = isOk(c2, p2, end1) && isOk(c1, p1, end2);
          if (fwdOk) {
            chemMsg = ''; // correct order
          } else if (revOk) {
            chemMsg = '↔ order will be auto-corrected on export';
            isInfo  = true;
          } else {
            // Neither order works
            const aa1 = chainSeq[c1]?.[p1 - 1] || '?';
            const aa2 = chainSeq[c2]?.[p2 - 1] || '?';
            const allowed = fmtR(end1);
            if (!isOk(c1, p1, end1) && !isOk(c2, p2, end1)) {
              chemMsg = `neither position has END1-reactive residue [${allowed}]`;
            } else {
              chemMsg = !isOk(c1, p1, end1)
                ? `${c1}:${aa1}${p1} needs END1-reactive [${allowed}]`
                : `${c2}:${aa2}${p2} needs END2-reactive`;
            }
          }
        }
      }

      chemWarn.textContent = chemMsg ? (isInfo ? `ℹ ${chemMsg}` : `⚠ ${chemMsg}`) : '';
      chemWarn.style.display = chemMsg ? 'inline' : 'none';
      chemWarn.classList.toggle('is-info', isInfo);
    }
  });
}

// ─── Reset / clear all ───────────────────────────────────────────────────────

export function resetAll() {
  if (!confirm('Clear everything and start fresh?')) return;

  // Sequences
  document.getElementById('sequences-container').innerHTML = '';

  // Crosslinks
  document.getElementById('crosslinks-container').innerHTML = '';

  // Disulfide bonds
  document.getElementById('ss-bonds-container').innerHTML = '';

  // Bonded atom pairs
  document.getElementById('bonds-container').innerHTML = '';

  // Header fields
  document.getElementById('jobName').value    = '';
  document.querySelectorAll('.seed-seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === 'count');
  });
  document.getElementById('seedCount').style.display    = '';
  document.getElementById('seedSpecific').style.display = 'none';
  document.getElementById('seedCount').value            = '1';

  // JSON output + stale banner
  document.getElementById('jsonOutput').innerHTML =
    '<span class="json-placeholder">// Click "Generate JSON" to build output</span>';
  document.getElementById('expandJsonBtn').style.display  = 'none';
  document.getElementById('copyJsonBtn').style.display    = 'none';
  document.getElementById('downloadJsonLink').style.display = 'none';
  const valPanel = document.getElementById('json-validation-panel');
  if (valPanel) { valPanel.innerHTML = ''; valPanel.style.display = 'none'; }
  _clearOutputStale();
  _hasGeneratedOnce = false;

  // Clear localStorage
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(LS_TIME_KEY);
  const banner = document.getElementById('restoreBanner');
  if (banner) banner.style.display = 'none';

  // Start fresh with one empty protein card
  addSequenceCard('protein');
  _updateSeqCount();
  updateViz();
}

// ─── localStorage auto-save / restore ────────────────────────────────────────

const LS_KEY      = 'af3x_autosave';
const LS_TIME_KEY = 'af3x_autosave_time';

function _tryAutoSave() {
  try {
    const json = _buildJSON();
    localStorage.setItem(LS_KEY, JSON.stringify(json));
    localStorage.setItem(LS_TIME_KEY, new Date().toISOString());
  } catch { /* ignore if form is incomplete */ }
}

function _checkRestoreSession() {
  const saved = localStorage.getItem(LS_KEY);
  const time  = localStorage.getItem(LS_TIME_KEY);
  if (!saved) return;

  const banner = document.getElementById('restoreBanner');
  if (!banner) return;

  const when = time ? new Date(time).toLocaleString() : 'previously';
  banner.querySelector('#restoreBannerTime').textContent = when;
  banner.style.display = 'flex';

  document.getElementById('restoreSessionBtn').addEventListener('click', () => {
    try {
      const json = JSON.parse(saved);
      _populateFromJSON(json);
      banner.style.display = 'none';
    } catch (e) {
      alert('Could not restore session: ' + e.message);
    }
  });

  document.getElementById('dismissRestoreBtn').addEventListener('click', () => {
    banner.style.display = 'none';
    localStorage.removeItem(LS_KEY);
    localStorage.removeItem(LS_TIME_KEY);
  });
}

// ─── PDB / mmCIF import ───────────────────────────────────────────────────────

function _handlePdbFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    openPdbModal(ev.target.result, _onPdbImport);
  };
  reader.readAsText(file);
  e.target.value = '';
}

function _onPdbImport(chains) {
  // Find the initial empty card (if any) to reuse for the first chain
  const allCards  = document.querySelectorAll('#sequences-container .seq-card');
  const lastCard  = allCards[allCards.length - 1];
  const lastTa    = lastCard?.querySelector('.seq-textarea');
  const emptyCard = (lastCard && lastTa && !lastTa.value.trim()) ? lastCard : null;

  // Collect existing IDs, but exclude the empty card's ID so it can be reassigned
  const emptyCardId = emptyCard?.querySelector('.seq-chain-id')?.value.trim() || null;
  const existingIds = new Set();
  document.querySelectorAll('.seq-chain-id').forEach(el => {
    (el.value || '').split(',').map(s => s.trim()).filter(Boolean).forEach(id => {
      if (id !== emptyCardId) existingIds.add(id);
    });
  });

  let nextCharCode = 65; // 'A'
  function _nextFreeId() {
    while (existingIds.has(String.fromCharCode(nextCharCode)) && nextCharCode < 91) nextCharCode++;
    const id = nextCharCode < 91 ? String.fromCharCode(nextCharCode) : `Z${nextCharCode - 90}`;
    existingIds.add(id);
    nextCharCode++;
    return id;
  }

  chains.forEach((chain, idx) => {
    const type = chain.type === 'dna' ? 'dna'
               : chain.type === 'rna' ? 'rna'
               : chain.type === 'ligand' ? 'ligand'
               : 'protein';

    let card;
    if (idx === 0 && emptyCard) {
      card = emptyCard; // reuse the initial empty card
    } else {
      addSequenceCard(type);
      card = document.querySelector('#sequences-container .seq-card:last-child');
    }
    if (!card) return;

    const chainIdInput = card.querySelector('.seq-chain-id');
    if (chainIdInput) chainIdInput.value = _nextFreeId();

    if (type === 'ligand') {
      // Switch to CCD tab and set the code
      const ccdBtn = card.querySelector('[data-tab="ccd"]');
      const smilesBtn = card.querySelector('[data-tab="smiles"]');
      if (ccdBtn) ccdBtn.click();
      const ccdInput = card.querySelector('.ligand-ccd');
      if (ccdInput && chain.ccdCode) ccdInput.value = chain.ccdCode;
    } else {
      const ta = card.querySelector('.seq-textarea');
      if (ta && chain.sequence) {
        ta.value = chain.sequence;
        const typeName = type === 'dna' ? 'dna' : type === 'rna' ? 'rna' : 'protein';
        _autoValidateSeq(ta, typeName);
        _updateRuler(card);
      }
    }
  });

  updateViz();
}

// ─── Theme toggle (light / dark) ───────────────────────────────────────────────

const THEME_KEY = 'af3x_theme';

function _initThemeToggle() {
  const btn = document.getElementById('themeToggleBtn');
  if (!btn) return;
  _applyThemeIcon(document.documentElement.getAttribute('data-theme') || 'dark');
  btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(THEME_KEY, next);
    _applyThemeIcon(next);
  });
}

function _applyThemeIcon(theme) {
  const btn = document.getElementById('themeToggleBtn');
  if (!btn) return;
  btn.textContent = theme === 'light' ? '🌙' : '☀️';
  btn.title = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
}

// ─── Intro / overview banner ───────────────────────────────────────────────────
// Always present (not dismissible) — only collapsible, so the quick overview
// stays available rather than disappearing forever after one click.

function _initIntroBanner() {
  const banner = document.getElementById('introBanner');
  if (!banner) return;

  const body        = document.getElementById('introBannerBody');
  const collapseBtn = document.getElementById('introCollapseBtn');

  collapseBtn.addEventListener('click', () => {
    const collapsed = body.style.display === 'none';
    body.style.display      = collapsed ? '' : 'none';
    collapseBtn.textContent = collapsed ? 'Hide details ▾' : 'Show details ▸';
  });
}

function _syncUserCcdExclusivity() {
  const content = document.getElementById('userCCD');
  const path     = document.getElementById('userCCDPath');
  if (!content || !path) return;
  path.disabled    = content.value.trim().length > 0;
  content.disabled = path.value.trim().length > 0;
}

function _initUserCcdExclusivity() {
  const content = document.getElementById('userCCD');
  const path     = document.getElementById('userCCDPath');
  if (!content || !path) return;
  content.addEventListener('input', _syncUserCcdExclusivity);
  path.addEventListener('input', _syncUserCcdExclusivity);

  const fileInput = document.getElementById('userCCDFile');
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      content.value = e.target.result;
      _syncUserCcdExclusivity();
    };
    reader.readAsText(file);
    fileInput.value = '';
  });
}

// ─── Global tooltips for .label-hint "?" icons ─────────────────────────────────
// Rendered into a single fixed-position element appended to <body> so they are
// never clipped by ancestors with overflow:hidden (e.g. .seq-card). Uses event
// delegation so it also works for hints added dynamically later (templates, mods).

function _initLabelHints() {
  const tip = document.getElementById('global-tooltip');
  if (!tip) return;

  document.addEventListener('mouseover', (e) => {
    const hint = e.target.closest('.label-hint[data-tip]');
    if (!hint) return;
    tip.textContent = hint.dataset.tip;
    tip.classList.add('visible');
    _positionLabelTooltip(hint, tip);
  });

  document.addEventListener('mouseout', (e) => {
    const hint = e.target.closest('.label-hint[data-tip]');
    if (!hint) return;
    tip.classList.remove('visible');
  });

  window.addEventListener('scroll', () => tip.classList.remove('visible'), true);
}

function _positionLabelTooltip(hint, tip) {
  const r = hint.getBoundingClientRect();
  // Measure with visible width (max-width applies once content is set)
  const tipRect = tip.getBoundingClientRect();
  let left = r.left + r.width / 2 - tipRect.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));

  const spaceAbove = r.top;
  const showBelow  = spaceAbove < tipRect.height + 12;
  const top = showBelow ? r.bottom + 7 : r.top - tipRect.height - 7;

  tip.style.left = `${left}px`;
  tip.style.top  = `${top}px`;
}
