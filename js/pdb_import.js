/**
 * PDB / mmCIF import module
 * Parses chain sequences from structure files and drives the import modal.
 */

// ─── Amino acid mapping ───────────────────────────────────────────────────────

const AA3TO1 = {
  ALA:'A', ARG:'R', ASN:'N', ASP:'D', CYS:'C', GLN:'Q', GLU:'E', GLY:'G',
  HIS:'H', ILE:'I', LEU:'L', LYS:'K', MET:'M', PHE:'F', PRO:'P', SER:'S',
  THR:'T', TRP:'W', TYR:'Y', VAL:'V',
  // Modified / common variants → map to nearest standard
  MSE:'M', SEP:'S', TPO:'T', PTR:'Y', CME:'C', OCS:'C', CSE:'C',
  PCA:'E', HYP:'P', UNK:'X',
};

// ─── Format detection ─────────────────────────────────────────────────────────

import { toast, showModal, hideModal } from './ui.js';
import { esc } from './util.js';

function _detectFileFormat(text) {
  // Some mmCIF files (e.g. AlphaFold3 outputs) start with a long comment/license
  // header before "data_", so scan a generous window rather than just the first
  // few hundred characters.
  const head = text.slice(0, 5000);
  if (/^data_/m.test(head) || /^loop_/m.test(head) || /_atom_site/m.test(head)) {
    return 'mmcif';
  }
  return 'pdb';
}

/** True if the given text looks like mmCIF (vs. legacy PDB format). */
export function isMmcifText(text) {
  return _detectFileFormat(text) === 'mmcif';
}

// ─── PDB parser (SEQRES) ──────────────────────────────────────────────────────

function parsePDB(text) {
  const seqres = {};  // chainId → [3-letter codes]
  for (const line of text.split('\n')) {
    if (!line.startsWith('SEQRES')) continue;
    const chainId = line[11];
    if (!chainId || chainId === ' ') continue;
    const residues = line.substring(19).trim().split(/\s+/).filter(Boolean);
    if (!seqres[chainId]) seqres[chainId] = [];
    seqres[chainId].push(...residues);
  }

  const chains = [];
  for (const [chainId, residues] of Object.entries(seqres)) {
    const type = _detectResidueType(residues);
    const sequence = _convertResidues(residues, type);
    if (type !== 'unknown' && sequence.length > 0) {
      chains.push({ chainId, type, sequence, entityName: `Chain ${chainId}` });
    }
  }

  // Fallback: minimal/computationally-generated PDBs (e.g. written by
  // BioPython without headers) have no SEQRES — derive the sequence from
  // ATOM records instead.
  if (!chains.length) {
    const byChain = {};   // chainId → [3-letter codes], in residue order
    const seen = new Set();
    for (const line of text.split('\n')) {
      if (!line.startsWith('ATOM')) continue;
      const altLoc = line[16] || ' ';
      if (altLoc !== ' ' && altLoc !== 'A') continue;
      const resName = line.substring(17, 20).trim().toUpperCase();
      const chainId = line[21] || ' ';
      const resSeq  = line.substring(22, 26).trim();
      const iCode   = line[26] || ' ';
      const key = `${chainId}_${resSeq}${iCode}`;
      if (seen.has(key)) continue;
      seen.add(key);
      (byChain[chainId] ||= []).push(resName);
    }
    for (const [chainId, residues] of Object.entries(byChain)) {
      const type = _detectResidueType(residues);
      const sequence = _convertResidues(residues, type);
      if (type !== 'unknown' && sequence.length > 0) {
        chains.push({ chainId, type, sequence, entityName: `Chain ${chainId}` });
      }
    }
  }

  return chains;
}

function _detectResidueType(residues) {
  if (!residues.length) return 'unknown';
  const upper = residues.map(r => r.toUpperCase());
  const aaCount   = upper.filter(r => AA3TO1[r]).length;
  if (aaCount >= upper.length * 0.6) return 'protein';

  const dnaNucs = new Set(['DA','DC','DG','DT','DU']);
  const rnaNucs = new Set(['A','C','G','U','URI','RU','RA','RC','RG','RU']);
  const hasDNA  = upper.some(r => dnaNucs.has(r) || r === 'T' || r === 'THY');
  const hasRNA  = upper.some(r => r === 'U' || r === 'URI' || r === 'URA');
  const nuclCount = upper.filter(r =>
    dnaNucs.has(r) || rnaNucs.has(r) || ['A','C','G','T','U'].includes(r)
  ).length;
  if (nuclCount >= upper.length * 0.6) {
    return (hasDNA && !hasRNA) ? 'dna' : 'rna';
  }
  return 'unknown';
}

function _convertResidues(residues, type) {
  if (type === 'protein') {
    return residues.map(r => AA3TO1[r.toUpperCase()] || 'X').join('');
  }
  if (type === 'rna' || type === 'dna') {
    return residues.map(r => {
      const u = r.toUpperCase();
      if (['DA','RA','A','ADE'].includes(u)) return 'A';
      if (['DC','RC','C','CYT'].includes(u)) return 'C';
      if (['DG','RG','G','GUA'].includes(u)) return 'G';
      if (['DU','RU','U','URA','URI','UR'].includes(u)) return 'U';
      if (['DT','T','THY'].includes(u)) return 'T';
      return 'N';
    }).join('');
  }
  return '';
}

// ─── mmCIF parser ─────────────────────────────────────────────────────────────

function parseMmCIF(text) {
  const entities   = _mmcifParseEntities(text);    // entityId → {type, sequence, description}
  const asyms      = _mmcifParseAsyms(text);        // asymId   → entityId
  const nonpolys   = _mmcifParseNonpolys(text);     // entityId → compId

  const chains = [];

  // Polymers → sequence chains
  for (const [asymId, entityId] of Object.entries(asyms)) {
    const ent = entities[entityId];
    if (!ent || ent.type === 'water') continue;
    if (ent.type === 'non-polymer' || ent.type === 'branched') {
      const ccdCode = nonpolys[entityId];
      if (ccdCode) {
        chains.push({
          chainId: asymId,
          type: 'ligand',
          sequence: '',
          ccdCode,
          entityName: ent.description || ccdCode,
        });
      }
      continue;
    }
    // polymer
    const seqType = _mmcifPolyType(ent.polymerType);
    if (seqType === 'unknown' || !ent.sequence) continue;
    const seq = ent.sequence.replace(/[^A-Za-z]/g, '').toUpperCase();
    chains.push({
      chainId: asymId,
      type: seqType,
      sequence: seq,
      entityName: ent.description || `Chain ${asymId}`,
    });
  }

  return chains;
}

function _mmcifPolyType(polymerType) {
  if (!polymerType) return 'unknown';
  const t = polymerType.toLowerCase();
  if (t.includes('polypeptide')) return 'protein';
  if (t.includes('polyribonucleotide') || t.includes('rna')) return 'rna';
  if (t.includes('polydeoxyribonucleotide') || t.includes('dna')) return 'dna';
  return 'unknown';
}

// Parse _entity loop
function _mmcifParseEntities(text) {
  const entities = {};

  // Try loop_ form first
  const loopMatch = _mmcifFindCategory(text, '_entity.id');
  if (loopMatch) {
    const cols = loopMatch.columns;
    const iId   = cols.indexOf('_entity.id');
    const iType = cols.indexOf('_entity.type');
    const iDesc = cols.indexOf('_entity.pdbx_description');
    for (const row of loopMatch.rows) {
      const id   = row[iId];
      const type = iType >= 0 ? row[iType] : '';
      const desc = iDesc >= 0 ? row[iDesc] : '';
      if (id) entities[id] = { type: type.toLowerCase(), description: _mmcifUnquote(desc) };
    }
  }

  // Parse _entity_poly for polymer type and sequence
  const polyLoop = _mmcifFindCategory(text, '_entity_poly.entity_id');
  if (polyLoop) {
    const cols   = polyLoop.columns;
    const iEid   = cols.indexOf('_entity_poly.entity_id');
    const iPtype = cols.indexOf('_entity_poly.type');
    const iSeq   = cols.indexOf('_entity_poly.pdbx_seq_one_letter_code_can');
    const iSeq2  = cols.indexOf('_entity_poly.pdbx_seq_one_letter_code');
    for (const row of polyLoop.rows) {
      const eid   = row[iEid];
      const ptype = iPtype >= 0 ? row[iPtype] : '';
      const seqIdx = iSeq >= 0 ? iSeq : iSeq2;
      const seq   = seqIdx >= 0 ? _mmcifUnquote(row[seqIdx]) : '';
      if (!eid) continue;
      if (!entities[eid]) entities[eid] = { type: 'polymer' };
      entities[eid].polymerType = _mmcifUnquote(ptype);
      entities[eid].sequence    = seq.replace(/\n/g, '').replace(/;/g, '');
    }
  }

  // Fallback: some mmCIF writers (e.g. AlphaFold3) omit the packed
  // pdbx_seq_one_letter_code(_can) string and instead only provide the
  // per-residue _entity_poly_seq loop (entity_id, mon_id, num in order).
  // Build the sequence from that when the packed form is missing.
  const needsFallback = Object.values(entities).some(e => e.polymerType && !e.sequence);
  if (needsFallback) {
    const seqLoop = _mmcifFindCategory(text, '_entity_poly_seq.entity_id');
    if (seqLoop) {
      const cols  = seqLoop.columns;
      const iEid  = cols.indexOf('_entity_poly_seq.entity_id');
      const iMon  = cols.indexOf('_entity_poly_seq.mon_id');
      const iNum  = cols.indexOf('_entity_poly_seq.num');
      const byEntity = {}; // eid -> [{num, mon}]
      for (const row of seqLoop.rows) {
        const eid = row[iEid];
        if (!eid || !entities[eid] || entities[eid].sequence) continue;
        (byEntity[eid] ||= []).push({
          num: iNum >= 0 ? parseInt(row[iNum]) || 0 : 0,
          mon: (iMon >= 0 ? row[iMon] : '').toUpperCase(),
        });
      }
      for (const [eid, residues] of Object.entries(byEntity)) {
        residues.sort((a, b) => a.num - b.num);
        const type = _mmcifPolyType(entities[eid].polymerType);
        entities[eid].sequence = residues
          .map(r => type === 'protein' ? (AA3TO1[r.mon] || 'X') : _nucToOne(r.mon))
          .join('');
      }
    }
  }

  return entities;
}

function _nucToOne(code) {
  if (['DA', 'RA', 'A', 'ADE'].includes(code)) return 'A';
  if (['DC', 'RC', 'C', 'CYT'].includes(code)) return 'C';
  if (['DG', 'RG', 'G', 'GUA'].includes(code)) return 'G';
  if (['DU', 'RU', 'U', 'URA', 'URI', 'UR'].includes(code)) return 'U';
  if (['DT', 'T', 'THY'].includes(code)) return 'T';
  return 'N';
}

// Parse _struct_asym to get chain→entity mapping
function _mmcifParseAsyms(text) {
  const asyms = {};
  const loop = _mmcifFindCategory(text, '_struct_asym.id');
  if (!loop) return asyms;
  const cols  = loop.columns;
  const iId   = cols.indexOf('_struct_asym.id');
  const iEid  = cols.indexOf('_struct_asym.entity_id');
  for (const row of loop.rows) {
    const id  = row[iId];
    const eid = row[iEid];
    if (id && eid) asyms[id] = eid;
  }
  return asyms;
}

// Parse _pdbx_entity_nonpoly for ligand CCD codes
function _mmcifParseNonpolys(text) {
  const nonpolys = {};
  const loop = _mmcifFindCategory(text, '_pdbx_entity_nonpoly.entity_id');
  if (!loop) return nonpolys;
  const cols  = loop.columns;
  const iEid  = cols.indexOf('_pdbx_entity_nonpoly.entity_id');
  const iComp = cols.indexOf('_pdbx_entity_nonpoly.comp_id');
  for (const row of loop.rows) {
    const eid  = row[iEid];
    const comp = row[iComp];
    if (eid && comp) nonpolys[eid] = comp;
  }
  return nonpolys;
}

// Minimal CIF loop parser: finds a loop that has the given column, returns {columns, rows}
// Finds a category by column name, trying loop_ form first, then falling
// back to the flat "single row, no loop_" form CIF allows for categories
// with exactly one row (very common for _entity/_entity_poly/_struct_asym
// etc. in single-chain/single-entity PDB-deposited structures).
function _mmcifFindCategory(text, targetColumn) {
  return _mmcifFindLoop(text, targetColumn) || _mmcifFindFlatRow(text, targetColumn);
}

function _mmcifFindFlatRow(text, targetColumn) {
  const categoryPrefix = targetColumn.slice(0, targetColumn.indexOf('.'));
  const lines = text.split('\n');
  const columns = [];
  const values = [];
  let found = false;
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith(categoryPrefix + '.')) {
      found = true;
      const sp = trimmed.search(/\s/);
      const key  = sp === -1 ? trimmed : trimmed.slice(0, sp);
      let rest   = sp === -1 ? '' : trimmed.slice(sp).trim();
      i++;
      if (!rest) {
        if (i < lines.length && lines[i].trimStart().startsWith(';')) {
          let value = lines[i].replace(/^\s*;/, '');
          i++;
          while (i < lines.length && !lines[i].startsWith(';')) {
            value += '\n' + lines[i];
            i++;
          }
          i++; // skip closing ';'
          rest = value.trim();
        } else if (i < lines.length) {
          rest = lines[i].trim();
          i++;
        }
      }
      columns.push(key);
      values.push(_mmcifUnquote(rest));
      continue;
    }
    if (found) {
      if (trimmed === '#' || trimmed === '') { i++; continue; }
      break; // category block ended
    }
    i++;
  }
  if (!found || !columns.includes(targetColumn)) return null;
  return { columns, rows: [values] };
}

function _mmcifFindLoop(text, targetColumn) {
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line === 'loop_') {
      i++;
      const columns = [];
      // Collect column names
      while (i < lines.length && lines[i].trim().startsWith('_')) {
        columns.push(lines[i].trim());
        i++;
      }
      if (!columns.includes(targetColumn)) {
        // Not the loop we want; skip rows until next loop_ or new category
        while (i < lines.length) {
          const l = lines[i].trim();
          if (l === 'loop_' || (l.startsWith('_') && !l.includes(' ')) || l.startsWith('data_')) break;
          i++;
        }
        continue;
      }
      // Collect rows
      const rows = [];
      const nCols = columns.length;
      while (i < lines.length) {
        const l = lines[i].trim();
        if (!l || l.startsWith('#')) { i++; continue; }
        if (l === 'loop_' || l.startsWith('data_')) break;
        if (l.startsWith('_') && !l.includes(' ')) break;
        // Handle semicolon multi-line text fields
        if (l.startsWith(';')) {
          let value = '';
          i++;
          while (i < lines.length && !lines[i].startsWith(';')) {
            value += lines[i] + '\n';
            i++;
          }
          i++; // skip closing ;
          if (rows.length > 0) {
            const row = rows[rows.length - 1];
            if (row.length < nCols) row.push(value.trim());
          }
          continue;
        }
        // Tokenize row
        const tokens = _mmcifTokenize(l);
        // Accumulate tokens until we have a full row
        let pending = rows.length > 0 && rows[rows.length - 1].length < nCols
          ? rows[rows.length - 1] : null;
        if (!pending) { rows.push([]); pending = rows[rows.length - 1]; }
        for (const tok of tokens) {
          pending.push(tok);
          if (pending.length === nCols) {
            rows.push([]);
            pending = rows[rows.length - 1];
          }
        }
        i++;
      }
      // Remove last empty row if any
      if (rows.length && rows[rows.length - 1].length === 0) rows.pop();
      return { columns, rows };
    }
    i++;
  }
  return null;
}

function _mmcifTokenize(line) {
  const tokens = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === '"' || c === "'") {
      const q = c; i++;
      let val = '';
      while (i < line.length && line[i] !== q) val += line[i++];
      i++;
      tokens.push(val);
    } else {
      let val = '';
      while (i < line.length && line[i] !== ' ' && line[i] !== '\t') val += line[i++];
      tokens.push(val);
    }
  }
  return tokens;
}

function _mmcifUnquote(s) {
  if (!s) return '';
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s === '.' || s === '?' ? '' : s;
}

/** Parse PDB or mmCIF text into a list of chains, auto-detecting the format. */
export function parseStructureChains(text) {
  const fmt = _detectFileFormat(text);
  return fmt === 'mmcif' ? parseMmCIF(text) : parsePDB(text);
}

// ─── Legacy PDB → minimal mmCIF conversion ─────────────────────────────────────
// AF3x's Template.mmcif field is parsed with a CIF parser internally — it has
// no PDB-format code path at all, so a PDB file can never be used there
// directly. This builds a minimal, valid mmCIF text (just an _atom_site loop,
// the same scope a "template" mmCIF needs) from PDB ATOM/HETATM records, so
// uploaded PDB files work everywhere a real mmCIF would.

const ATOM_SITE_COLUMNS = [
  'group_PDB', 'id', 'type_symbol', 'label_atom_id', 'label_alt_id', 'label_comp_id',
  'label_asym_id', 'label_entity_id', 'label_seq_id', 'pdbx_PDB_ins_code',
  'Cartn_x', 'Cartn_y', 'Cartn_z', 'occupancy', 'B_iso_or_equiv',
  'pdbx_formal_charge', 'auth_seq_id', 'auth_asym_id', 'pdbx_PDB_model_num',
];

/**
 * Converts legacy PDB ATOM records to a minimal mmCIF text. Throws if none found.
 *
 * Only ATOM records are kept (no HETATM/waters/ligands): AF3x templates must be
 * a single protein chain, and lumping water into the same label_entity_id as the
 * polymer makes AF3x's own mmCIF parser reject the file with "non-water entity
 * has water molecules" — giving water its own entity would work too, but
 * templates don't need it at all, so dropping it is simpler and correct.
 */
export function pdbToMmcif(pdbText, dataName = 'converted') {
  const rows = [];
  let serial = 0;
  for (const line of pdbText.split('\n')) {
    const rec = line.slice(0, 6).trim();
    if (rec !== 'ATOM') continue;
    const atomName = line.slice(12, 16).trim();
    const altLoc   = line[16] && line[16] !== ' ' ? line[16] : '.';
    const resName  = line.slice(17, 20).trim();
    const chainId  = line[21] && line[21] !== ' ' ? line[21] : 'A';
    const resSeq   = line.slice(22, 26).trim() || '.';
    const iCode    = line[26] && line[26] !== ' ' ? line[26] : '?';
    const x = line.slice(30, 38).trim();
    const y = line.slice(38, 46).trim();
    const z = line.slice(46, 54).trim();
    if (!atomName || !resName || x === '' || y === '' || z === '') continue;
    const occ  = line.slice(54, 60).trim() || '1.00';
    const temp = line.slice(60, 66).trim() || '0.00';
    let elem   = line.slice(76, 78).trim();
    if (!elem) elem = (atomName.match(/^[A-Za-z]+/) || ['C'])[0].slice(0, 1);
    serial++;
    rows.push([
      rec, serial, elem, atomName, altLoc, resName, chainId, '1',
      resSeq, iCode, x, y, z, occ, temp, '?', resSeq, chainId, '1',
    ]);
  }
  if (!rows.length) {
    throw new Error('No ATOM/HETATM records found — is this really a PDB file?');
  }

  // AF3x's template featurisation requires a release date
  // (_pdbx_audit_revision_history.revision_date) or it refuses the template
  // outright. A legacy PDB HEADER line carries a deposition date (cols 51-59,
  // DD-MMM-YY); fall back to today if that's missing or unparsable — the exact
  // date doesn't matter for using the structure as a manually-supplied template.
  const releaseDate = _pdbDepositionDate(pdbText) || new Date().toISOString().slice(0, 10);

  let out = `data_${dataName}\n#\n`;
  out += `loop_\n_pdbx_audit_revision_history.revision_date\n${releaseDate}\n#\n`;
  out += 'loop_\n';
  for (const c of ATOM_SITE_COLUMNS) out += `_atom_site.${c}\n`;
  for (const r of rows) out += r.join(' ') + '\n';
  out += '#\n';
  return out;
}

function _pdbDepositionDate(pdbText) {
  const headerLine = pdbText.split('\n').find(l => l.startsWith('HEADER'));
  if (!headerLine) return null;
  const m = headerLine.slice(50, 59).trim().match(/^(\d{2})-(\w{3})-(\d{2})$/i);
  if (!m) return null;
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const mi = months.indexOf(m[2].toUpperCase());
  if (mi === -1) return null;
  const yy = parseInt(m[3], 10);
  const year = yy <= 30 ? 2000 + yy : 1900 + yy; // PDB 2-digit year convention
  return `${year}-${String(mi + 1).padStart(2, '0')}-${m[1]}`;
}

// ─── ATOM-record sequence extraction (for template index alignment) ───────────
//
// Unlike parseStructureChains() above (which uses SEQRES / _entity_poly — the
// full construct sequence, which may include residues with no coordinates),
// this walks the actual ATOM records so the resulting 0-based positions match
// what AF3x's templateIndices must refer to: residues that are actually present
// in the template structure.

/** Returns [{chainId, sequence}] built only from observed ATOM records. */
export function extractAtomSequences(text) {
  const fmt = _detectFileFormat(text);
  return fmt === 'mmcif' ? _atomSeqFromMmcif(text) : _atomSeqFromPdb(text);
}

function _atomSeqFromPdb(text) {
  const chains = {};   // chainId -> [resName, ...]
  const seen   = new Set();
  for (const line of text.split('\n')) {
    if (!line.startsWith('ATOM')) continue;
    const altLoc = line[16] || ' ';
    if (altLoc !== ' ' && altLoc !== 'A') continue; // skip alt conformers other than the first
    const resName = line.substring(17, 20).trim().toUpperCase();
    const chainId = line[21] || ' ';
    const resSeq  = line.substring(22, 26).trim();
    const iCode   = line[26] || ' ';
    const key = `${chainId}_${resSeq}${iCode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    (chains[chainId] ||= []).push(resName);
  }
  return Object.entries(chains).map(([chainId, resnames]) => ({
    chainId,
    sequence: resnames.map(r => AA3TO1[r] || 'X').join(''),
  })).filter(c => c.sequence.length > 0);
}

function _atomSeqFromMmcif(text) {
  const loop = _mmcifFindLoop(text, '_atom_site.group_PDB');
  if (!loop) return [];
  const cols = loop.columns;
  const iGroup     = cols.indexOf('_atom_site.group_PDB');
  const iComp      = cols.indexOf('_atom_site.label_comp_id');
  const iAsym      = cols.indexOf('_atom_site.label_asym_id');
  const iAuthAsym  = cols.indexOf('_atom_site.auth_asym_id');
  const iSeqId     = cols.indexOf('_atom_site.label_seq_id');
  const iAuthSeqId = cols.indexOf('_atom_site.auth_seq_id');
  const iIns       = cols.indexOf('_atom_site.pdbx_PDB_ins_code');
  const iAlt       = cols.indexOf('_atom_site.label_alt_id');
  const iModel     = cols.indexOf('_atom_site.pdbx_PDB_model_num');

  const chains = {};
  const seen   = new Set();
  let firstModel = null;
  for (const row of loop.rows) {
    if (iGroup >= 0 && row[iGroup] !== 'ATOM') continue;
    if (iModel >= 0) {
      if (firstModel === null) firstModel = row[iModel];
      else if (row[iModel] !== firstModel) continue; // only the first model (e.g. NMR ensembles)
    }
    if (iAlt >= 0) {
      const alt = row[iAlt];
      if (alt && alt !== '.' && alt !== '?' && alt !== 'A') continue;
    }
    const chainId = iAsym >= 0 ? row[iAsym] : (iAuthAsym >= 0 ? row[iAuthAsym] : '?');
    const resName = (iComp >= 0 ? row[iComp] : '').toUpperCase();
    const seqId   = (iSeqId >= 0 && row[iSeqId] !== '.') ? row[iSeqId] : (iAuthSeqId >= 0 ? row[iAuthSeqId] : '');
    const ins     = iIns >= 0 ? row[iIns] : '';
    const key = `${chainId}_${seqId}_${ins}`;
    if (seen.has(key)) continue;
    seen.add(key);
    (chains[chainId] ||= []).push(resName);
  }
  return Object.entries(chains).map(([chainId, resnames]) => ({
    chainId,
    sequence: resnames.map(r => AA3TO1[r] || 'X').join(''),
  })).filter(c => c.sequence.replace(/X/g, '').length > 0);
}

// ─── Single-chain template mmCIF ─────────────────────────────────────────────

/**
 * One chain of a PDB / mmCIF file as a minimal template mmCIF.
 * AF3 needs exactly one polymer chain and a release date in a template, and
 * counts template residues along the chain. Only residues with coordinates are
 * written, numbered 1…N, so position k (0-based) in `sequence` is template index k.
 * Returns { mmcif, sequence }.
 */
export function buildTemplate(text, chainId, dataName = 'template') {
  const isCif = _detectFileFormat(text) === 'mmcif';
  const atoms = isCif ? _chainAtomsFromMmcif(text, chainId) : _chainAtomsFromPdb(text, chainId);
  if (!atoms.length) throw new Error(`Chain ${chainId} has no atoms`);

  let date = null;
  if (isCif) {
    const m = text.match(/_pdbx_audit_revision_history\.revision_date\s+(\d{4}-\d{2}-\d{2})/) ||
              text.match(/_pdbx_audit_revision_history[\s\S]{0,600}?\s(\d{4}-\d{2}-\d{2})\s/);
    date = m ? m[1] : null;
  } else {
    date = _pdbDepositionDate(text);
  }
  date = date || new Date().toISOString().slice(0, 10);

  const q = v => (/['"\s]/.test(v) ? (v.includes('"') ? `'${v}'` : `"${v}"`) : v);
  const rows = [];
  const resnames = [];
  let lastKey = null;
  atoms.forEach((a, i) => {
    if (a.resKey !== lastKey) { lastKey = a.resKey; resnames.push(a.resName); }
    rows.push([
      'ATOM', i + 1, a.elem, q(a.atomName), '.', a.resName, 'A', '1', resnames.length, '?',
      a.x, a.y, a.z, a.occ, a.b, '?', a.authSeq || resnames.length, 'A', '1',
    ].join(' '));
  });

  const name = String(dataName).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40) || 'template';
  let out = `data_${name}\n#\n`;
  out += `_entry.id ${name}\n#\n`;
  out += `loop_\n_pdbx_audit_revision_history.revision_date\n${date}\n#\n`;
  out += 'loop_\n' + ATOM_SITE_COLUMNS.map(c => `_atom_site.${c}`).join('\n') + '\n';
  out += rows.join('\n') + '\n#\n';
  return { mmcif: out, sequence: resnames.map(r => AA3TO1[r] || 'X').join('') };
}

function _chainAtomsFromPdb(text, chainId) {
  const atoms = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('ENDMDL')) break;            // first model only
    if (!line.startsWith('ATOM')) continue;
    if ((line[21] || ' ') !== chainId) continue;
    const alt = line[16] || ' ';
    if (alt !== ' ' && alt !== 'A') continue;
    const atomName = line.slice(12, 16).trim();
    const x = line.slice(30, 38).trim(), y = line.slice(38, 46).trim(), z = line.slice(46, 54).trim();
    if (!atomName || x === '' || y === '' || z === '') continue;
    const resSeq = line.slice(22, 26).trim();
    atoms.push({
      atomName, resName: line.slice(17, 20).trim().toUpperCase(),
      resKey: `${resSeq}${line[26] || ' '}`, authSeq: resSeq,
      x, y, z,
      occ: line.slice(54, 60).trim() || '1.00', b: line.slice(60, 66).trim() || '0.00',
      elem: line.slice(76, 78).trim() || (atomName.match(/[A-Za-z]/) || ['C'])[0],
    });
  }
  return atoms;
}

function _chainAtomsFromMmcif(text, chainId) {
  const loop = _mmcifFindLoop(text, '_atom_site.group_PDB');
  if (!loop) return [];
  const col = name => loop.columns.indexOf(`_atom_site.${name}`);
  const iGroup = col('group_PDB'), iComp = col('label_comp_id'), iAtom = col('label_atom_id');
  const iAsym = col('label_asym_id') >= 0 ? col('label_asym_id') : col('auth_asym_id');
  const iSeq = col('label_seq_id'), iAuthSeq = col('auth_seq_id'), iIns = col('pdbx_PDB_ins_code');
  const iAlt = col('label_alt_id'), iModel = col('pdbx_PDB_model_num'), iElem = col('type_symbol');
  const iX = col('Cartn_x'), iY = col('Cartn_y'), iZ = col('Cartn_z'), iOcc = col('occupancy'), iB = col('B_iso_or_equiv');
  const atoms = [];
  let firstModel = null;
  for (const row of loop.rows) {
    if (iGroup >= 0 && row[iGroup] !== 'ATOM') continue;
    if (row[iAsym] !== chainId) continue;
    if (iModel >= 0) {
      if (firstModel === null) firstModel = row[iModel];
      else if (row[iModel] !== firstModel) continue;
    }
    if (iAlt >= 0) {
      const alt = row[iAlt];
      if (alt && alt !== '.' && alt !== '?' && alt !== 'A') continue;
    }
    const seqId = (iSeq >= 0 && row[iSeq] !== '.') ? row[iSeq] : (iAuthSeq >= 0 ? row[iAuthSeq] : '');
    const atomName = row[iAtom];
    atoms.push({
      atomName, resName: (row[iComp] || '').toUpperCase(),
      resKey: `${seqId}_${iIns >= 0 ? row[iIns] : ''}`,
      authSeq: iAuthSeq >= 0 && /^-?\d+$/.test(row[iAuthSeq]) ? row[iAuthSeq] : '',
      x: row[iX], y: row[iY], z: row[iZ],
      occ: iOcc >= 0 ? row[iOcc] : '1.00', b: iB >= 0 ? row[iB] : '0.00',
      elem: iElem >= 0 ? row[iElem] : (atomName.match(/[A-Za-z]/) || ['C'])[0],
    });
  }
  return atoms;
}

// ─── Import modal ─────────────────────────────────────────────────────────────

let _pdbChains  = [];
let _onPdbImport = null;

/**
 * Open the PDB/mmCIF import modal with the given chain list.
 * onImport(chains) is called with selected chain objects.
 */
export function openPdbModal(text, onImport) {
  _onPdbImport = onImport;
  const fmt    = _detectFileFormat(text);
  _pdbChains   = fmt === 'mmcif' ? parseMmCIF(text) : parsePDB(text);

  if (!_pdbChains.length) {
    toast('No chains found in this PDB / mmCIF file', { type: 'error' });
    return;
  }

  _renderPdbModal(_pdbChains);
  showModal('pdb-modal');
}

function _renderPdbModal(chains) {
  const list = document.getElementById('pdbChainList');
  list.innerHTML = '';

  const typeCounts = { protein: 0, rna: 0, dna: 0, ligand: 0 };
  chains.forEach(c => { if (typeCounts[c.type] !== undefined) typeCounts[c.type]++; });

  const summary = document.getElementById('pdbSummary');
  const parts = [];
  if (typeCounts.protein) parts.push(`${typeCounts.protein} protein${typeCounts.protein>1?'s':''}`);
  if (typeCounts.rna)     parts.push(`${typeCounts.rna} RNA`);
  if (typeCounts.dna)     parts.push(`${typeCounts.dna} DNA`);
  if (typeCounts.ligand)  parts.push(`${typeCounts.ligand} ligand${typeCounts.ligand>1?'s':''}`);
  summary.textContent = parts.join(' · ');

  chains.forEach((chain, i) => {
    const row = document.createElement('div');
    row.className = 'pdb-chain-row';

    const cb = document.createElement('input');
    cb.type    = 'checkbox';
    cb.id      = `pdbCb_${i}`;
    cb.checked = chain.type !== 'ligand'; // include proteins/RNA/DNA by default, not ligands

    const unit = chain.type === 'dna' || chain.type === 'rna' ? 'nt' : 'aa';
    const sub = chain.sequence ? `${chain.sequence.length} ${unit}` : esc(chain.ccdCode || '');
    row.innerHTML = `
      <label class="pick-row">
        <input type="checkbox" class="pdb-chain-cb" data-idx="${i}" ${cb.checked ? 'checked' : ''}>
        <span class="pick-main"><b>${esc(chain.chainId)}</b> ${esc(chain.type)} <span class="pick-name">${esc(chain.entityName || '')}</span></span>
        <span class="pick-sub">${sub}</span>
      </label>`;

    list.appendChild(row);
  });
}

export function initPdbModal() {
  document.getElementById('pdbImportConfirm').onclick = _confirmPdbImport;
}

function _closePdbModal() {
  hideModal('pdb-modal');
  _pdbChains   = [];
  _onPdbImport = null;
}

function _confirmPdbImport() {
  const selected = [];
  document.querySelectorAll('.pdb-chain-cb:checked').forEach(cb => {
    const idx = parseInt(cb.dataset.idx);
    if (_pdbChains[idx]) selected.push(_pdbChains[idx]);
  });

  if (!selected.length) return;

  if (_onPdbImport) _onPdbImport(selected);
  _closePdbModal();
}
