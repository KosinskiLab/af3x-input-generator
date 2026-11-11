// AF3x job model → issues and JSON; AlphaFold Server JSON conversion.
//
// Model (built from the page by app.js):
//   { name, nameEl, version, seedMode: 'count'|'list', seedCount, seedList, seedEl,
//     chains: [{ el, id, type, seq, label, ligKind, ligValue,
//                mods: [{ el, ccd, pos }],
//                msa: { mode, el, unpaired: { path, content }, paired: { path, content } },
//                tpl: { mode, el, entries: [{ el, mmcif, mmcifPath, q, t }] } }],
//     xl:    [{ el, name, pairs: [{ el, c1, p1, c2, p2 }] }],
//     ss:    [{ el, c1, p1, c2, p2 }],
//     bonds: [{ el, a: [chain, res, atom], b: [chain, res, atom] }],
//     ccd:   { el, content, path } }
// `el` values are opaque: they are only passed back in issues.

import { CROSSLINKERS, PTM_DATABASE } from './data.js';
import { ALPHABET } from './util.js';

const POLYMERS = new Set(['protein', 'rna', 'dna']);

/** Crosslinker table entry for a JSON name ("DSSO", "LINK5") → { def, n } or null. */
export function findXl(name) {
  const exact = CROSSLINKERS.find(x => !x.dynamic && x.name === name);
  if (exact) return { def: exact, n: null };
  const m = /^(LINK|RIGID)(\d+)$/.exec(name || '');
  if (m) return { def: CROSSLINKERS.find(x => x.name === m[1]), n: parseInt(m[2], 10) };
  return null;
}

function reactive(seq, pos, allowed) {
  if (!allowed || allowed.includes('any AA')) return true;
  const aa = seq[pos - 1];
  return !aa || allowed.includes(aa) || (pos === 1 && allowed.includes('N-term'));
}

/**
 * State of one crosslink pair. Returns
 *   { state: 'empty'|'partial'|'ok'|'swap'|'error', msg }
 * 'swap': valid only in reverse order (asymmetric linker); toJson swaps it.
 */
export function checkPair(pair, xlName, chainById) {
  const { c1, p1, c2, p2 } = pair;
  const filled = [c1, p1, c2, p2].filter(Boolean).length;
  if (!p1 && !p2) return { state: 'empty' };
  if (filled < 4) return { state: 'partial', msg: 'incomplete' };
  for (const [c, p] of [[c1, p1], [c2, p2]]) {
    const ch = chainById.get(c);
    if (!ch) return { state: 'error', msg: `no chain ${c}` };
    if (ch.type !== 'protein') return { state: 'error', msg: `${c} is not a protein` };
    if (ch.seq && p > ch.seq.length) return { state: 'error', msg: `${c} has ${ch.seq.length} residues` };
  }
  if (c1 === c2 && p1 === p2) return { state: 'error', msg: 'same residue twice' };

  const xl = findXl(xlName);
  if (!xl || xl.def.dynamic) return { state: 'ok' };
  const s1 = chainById.get(c1).seq, s2 = chainById.get(c2).seq;
  const aa1 = s1[p1 - 1] || '?', aa2 = s2[p2 - 1] || '?';
  const fmt = r => r.join('/');
  if (xl.def.symmetric) {
    const r = xl.def.reactiveResidues;
    const bad = [];
    if (!reactive(s1, p1, r)) bad.push(`${aa1}${p1}`);
    if (!reactive(s2, p2, r)) bad.push(`${aa2}${p2}`);
    return bad.length
      ? { state: 'error', msg: `${bad.join(', ')} not reactive (${fmt(r)})` }
      : { state: 'ok' };
  }
  const [end1, end2] = xl.def.reactiveResidues;
  if (reactive(s1, p1, end1) && reactive(s2, p2, end2)) return { state: 'ok' };
  if (reactive(s2, p2, end1) && reactive(s1, p1, end2)) return { state: 'swap' };
  return { state: 'error', msg: `one end must be ${fmt(end1)}` };
}

/**
 * Model → [{ level: 'todo'|'error'|'warn', msg, el }].
 * 'todo': a required field is still empty. 'todo' and 'error' block the export.
 */
export function validate(model) {
  const issues = [];
  const err = (msg, el) => issues.push({ level: 'error', msg, el });
  const warn = (msg, el) => issues.push({ level: 'warn', msg, el });
  const todo = (msg, el) => issues.push({ level: 'todo', msg, el });

  if (!model.name) todo('Name the job', model.nameEl);
  else if (!/[A-Za-z0-9._-]/.test(model.name)) err('Job name needs a letter or a number', model.nameEl);
  if (model.seedMode === 'count') {
    if (!(model.seedCount >= 1 && model.seedCount <= 1000)) err('Seeds: enter a number from 1 to 1000', model.seedEl);
  } else if (!model.seedList.length) {
    err('Seeds: enter at least one value', model.seedEl);
  }

  if (!model.chains.length) todo('Add a chain');
  const idCount = new Map();
  model.chains.forEach(c => idCount.set(c.id, (idCount.get(c.id) || 0) + 1));
  const chainById = new Map(model.chains.map(c => [c.id, c]));

  for (const c of model.chains) {
    const tag = `Chain ${c.id || '?'}`;
    if (!c.id) err('A chain has no ID', c.el);
    else if (!/^[A-Z]+$/.test(c.id)) err(`${tag}: ID must be upper-case letters`, c.el);
    else if (idCount.get(c.id) > 1) err(`${tag}: duplicate ID`, c.el);

    if (c.type === 'ligand') {
      if (!c.ligValue) todo(`${tag}: enter a ${c.ligKind === 'smiles' ? 'SMILES string' : 'CCD code'}`, c.el);
      continue;
    }
    if (!c.seq) { todo(`${tag}: add a sequence`, c.el); continue; }
    const odd = [...new Set([...c.seq].filter(ch => !ALPHABET[c.type].has(ch)))];
    if (odd.length) {
      const what = { protein: 'amino acids', rna: 'RNA bases', dna: 'DNA bases' }[c.type];
      err(`${tag}: ${odd.slice(0, 8).join(' ')} ${odd.length === 1 ? 'is' : 'are'} not ${what}`, c.el);
    }

    for (const m of c.mods) {
      if (!m.ccd || !m.pos) continue;
      if (m.pos > c.seq.length) { err(`${tag}: ${m.ccd} at ${m.pos} is past the end`, m.el); continue; }
      const ptm = PTM_DATABASE.find(p => p.ccd === m.ccd);
      if (ptm && c.seq[m.pos - 1] !== ptm.targetAA) {
        warn(`${tag}: ${m.ccd} expects ${ptm.targetAA}, position ${m.pos} is ${c.seq[m.pos - 1]}`, m.el);
      }
    }

    if (c.type !== 'dna' && c.msa.mode === 'custom') {
      const has = s => s && (s.path || s.content);
      if (!has(c.msa.unpaired) && !(c.type === 'protein' && has(c.msa.paired))) {
        err(`${tag}: custom MSA has no file`, c.msa.el);
      }
    }
    if (c.type === 'protein' && c.tpl.mode === 'custom') {
      if (!c.tpl.entries.length) err(`${tag}: no template added`, c.tpl.el);
      c.tpl.entries.forEach((t, i) => {
        const n = `${tag}, template ${i + 1}`;
        if (!t.mmcif && !t.mmcifPath) err(`${n}: no structure`, t.el);
        if (!t.q || !t.t) err(`${n}: residue mapping is not a list of numbers`, t.el);
        else if (!t.q.length) err(`${n}: residue mapping is empty`, t.el);
        else if (t.q.length !== t.t.length) err(`${n}: mapping lists differ in length (${t.q.length} vs ${t.t.length})`, t.el);
        else if (Math.max(...t.q) >= c.seq.length) err(`${n}: mapping exceeds the chain length`, t.el);
      });
      if (c.tpl.entries.length && c.msa.mode === 'auto') {
        err(`${tag}: custom templates need MSA set to None or Custom`, c.msa.el);
      }
    }
  }

  // Crosslinks
  const used = new Map();
  for (const g of model.xl) {
    if (!findXl(g.name)) warn(`Unknown crosslinker ${g.name}`, g.el);
    for (const p of g.pairs) {
      const res = checkPair(p, g.name, chainById);
      if (res.state === 'partial') warn('Incomplete crosslink (ignored)', p.el);
      else if (res.state === 'error') err(`${g.name} ${p.c1}:${p.p1}–${p.c2}:${p.p2}: ${res.msg}`, p.el);
      if (res.state === 'ok' || res.state === 'swap' || res.state === 'error') {
        for (const k of [`${p.c1}:${p.p1}`, `${p.c2}:${p.p2}`]) {
          if (!used.has(k)) used.set(k, []);
          used.get(k).push(p.el);
        }
      }
    }
  }
  for (const [k, els] of used) {
    if (els.length > 1) warn(`${k} is in ${els.length} crosslinks; AF3x keeps the first unless run with --noremove_overlapping_crosslinks`, els[1]);
  }

  // Disulfides
  for (const b of model.ss) {
    const filled = [b.c1, b.p1, b.c2, b.p2].filter(Boolean).length;
    if (!b.p1 && !b.p2) continue;
    if (filled < 4) { warn('Incomplete disulfide (ignored)', b.el); continue; }
    let bad = null;
    for (const [c, p] of [[b.c1, b.p1], [b.c2, b.p2]]) {
      const ch = chainById.get(c);
      if (!ch) bad = `no chain ${c}`;
      else if (ch.type !== 'protein') bad = `${c} is not a protein`;
      else if (ch.seq && p > ch.seq.length) bad = `${c} has ${ch.seq.length} residues`;
      else if (ch.seq && ch.seq[p - 1] !== 'C') bad = `${c}:${ch.seq[p - 1]}${p} is not Cys`;
      if (bad) break;
    }
    if (!bad && b.c1 === b.c2 && b.p1 === b.p2) bad = 'same residue twice';
    if (bad) err(`Disulfide ${b.c1}:${b.p1}–${b.c2}:${b.p2}: ${bad}`, b.el);
  }

  // Bonded atoms
  model.bonds.forEach((b, i) => {
    if (!b.a[2] && !b.b[2]) return;
    const filled = [...b.a, ...b.b].filter(Boolean).length;
    if (filled < 6) { warn('Incomplete bonded atom pair (ignored)', b.el); return; }
    const kinds = [b.a[0], b.b[0]].map(id => {
      const ch = chainById.get(id);
      if (!ch) return null;
      return ch.type === 'ligand' ? (ch.ligKind === 'smiles' ? 'smiles' : 'ccd') : 'polymer';
    });
    const n = `Bond ${i + 1}`;
    if (kinds.includes(null)) err(`${n}: chain not defined`, b.el);
    else if (kinds.includes('smiles')) err(`${n}: SMILES ligands have no atom names; use a CCD ligand`, b.el);
    else if (kinds[0] === 'polymer' && kinds[1] === 'polymer') err(`${n}: one end must be a CCD ligand`, b.el);
  });

  if (model.ccd.content && model.ccd.path) err('Custom CCD: use the text or the path, not both', model.ccd.el);
  return issues;
}

/** Model → AF3x input JSON. Incomplete or empty rows are left out. */
export function toJson(model) {
  const seeds = model.seedMode === 'count'
    ? Array.from({ length: Math.max(0, Math.min(1000, model.seedCount || 0)) }, (_, i) => i + 1)
    : model.seedList;
  const out = { dialect: 'alphafold3', version: model.version, name: model.name, modelSeeds: seeds, sequences: [] };
  const chainById = new Map(model.chains.map(c => [c.id, c]));

  for (const c of model.chains) {
    const d = { id: c.id };
    if (c.label && model.version >= 4) d.description = c.label;
    if (c.type === 'ligand') {
      if (c.ligKind === 'smiles') d.smiles = c.ligValue;
      else d.ccdCodes = c.ligValue.split(/[\s,;]+/).filter(Boolean).map(s => s.toUpperCase());
      out.sequences.push({ ligand: d });
      continue;
    }
    d.sequence = c.seq;
    const mods = c.mods.filter(m => m.ccd && m.pos).map(m => c.type === 'protein'
      ? { ptmType: m.ccd, ptmPosition: m.pos }
      : { modificationType: m.ccd, basePosition: m.pos });
    if (mods.length) d.modifications = mods;

    if (c.type !== 'dna') {
      const slots = c.type === 'protein' ? ['unpaired', 'paired'] : ['unpaired'];
      if (c.msa.mode === 'none') {
        slots.forEach(s => { d[`${s}Msa`] = ''; });
      } else if (c.msa.mode === 'custom') {
        // AF3 needs both protein MSAs set once one is: a missing one is sent empty.
        for (const s of slots) {
          const m = c.msa[s] || {};
          if (m.content) d[`${s}Msa`] = m.content;
          else if (m.path) d[`${s}MsaPath`] = m.path;
          else d[`${s}Msa`] = '';
        }
      }
    }
    if (c.type === 'protein') {
      if (c.tpl.mode === 'none') d.templates = [];
      else if (c.tpl.mode === 'custom') {
        d.templates = c.tpl.entries.map(t => {
          const e = t.mmcifPath ? { mmcifPath: t.mmcifPath } : { mmcif: t.mmcif || '' };
          e.queryIndices = t.q || [];
          e.templateIndices = t.t || [];
          return e;
        });
      }
    }
    out.sequences.push({ [c.type]: d });
  }

  const xl = [];
  for (const g of model.xl) {
    const pairs = [];
    for (const p of g.pairs) {
      const st = checkPair(p, g.name, chainById).state;
      if (st === 'empty' || st === 'partial') continue;
      pairs.push(st === 'swap' ? [[p.c2, p.p2], [p.c1, p.p1]] : [[p.c1, p.p1], [p.c2, p.p2]]);
    }
    if (pairs.length) xl.push({ name: g.name, residue_pairs: pairs });
  }
  if (xl.length) out.crosslinks = xl;

  const ss = model.ss.filter(b => b.c1 && b.p1 && b.c2 && b.p2).map(b => [[b.c1, b.p1], [b.c2, b.p2]]);
  if (ss.length) out.disulfide_bonds = [{ residue_pairs: ss }];

  const bonds = model.bonds.filter(b => [...b.a, ...b.b].every(Boolean)).map(b => [b.a, b.b]);
  if (bonds.length) out.bondedAtomPairs = bonds;

  if (model.ccd.content) out.userCCD = model.ccd.content;
  else if (model.ccd.path) out.userCCDPath = model.ccd.path;
  return out;
}

// ─── Reading JSON files ──────────────────────────────────────────────────────

export function detectJsonDialect(raw) {
  if (Array.isArray(raw)) return 'alphafoldserver';
  if (raw && raw.dialect === 'alphafoldserver') return 'alphafoldserver';
  if (raw && raw.sequences) return 'af3x';
  return 'unknown';
}

const stripCcd = code => (typeof code === 'string' ? code.replace(/^CCD_/i, '') : code);

/** AlphaFold Server job JSON → { converted (AF3x JSON), notes }. */
export function convertServerJson(raw) {
  const jobs = Array.isArray(raw) ? raw : [raw];
  const job = jobs[0];
  const notes = [];
  if (jobs.length > 1) notes.push(`${jobs.length} jobs in the file; the first was imported`);

  const converted = { name: job.name || '', version: 4 };
  const seeds = (Array.isArray(job.modelSeeds) ? job.modelSeeds : []).map(s => parseInt(s, 10)).filter(n => !Number.isNaN(n));
  converted.modelSeeds = seeds.length ? seeds : [1];

  const mods = (list, protein) => {
    if (!Array.isArray(list) || !list.length) return undefined;
    return list.map(m => protein
      ? { ptmType: stripCcd(m.ptmType || m.modificationType || ''), ptmPosition: m.ptmPosition || m.basePosition }
      : { modificationType: stripCcd(m.modificationType || m.ptmType || ''), basePosition: m.basePosition || m.ptmPosition });
  };

  converted.sequences = [];
  for (const obj of job.sequences || []) {
    const kind = Object.keys(obj)[0];
    const d = obj[kind];
    const count = Number.isInteger(d.count) && d.count > 0 ? d.count : 1;
    const push = entry => { for (let i = 0; i < count; i++) converted.sequences.push(JSON.parse(JSON.stringify(entry))); };
    if (kind === 'proteinChain') {
      if (d.glycans?.length) notes.push('Glycans were dropped (add them as ligands with bonded atoms)');
      if (d.maxTemplateDate) notes.push('maxTemplateDate was dropped (set it with --max_template_date)');
      const e = { sequence: d.sequence || '' };
      if (mods(d.modifications, true)) e.modifications = mods(d.modifications, true);
      if (d.useStructureTemplate === false) e.templates = [];
      push({ protein: e });
    } else if (kind === 'rnaSequence' || kind === 'dnaSequence') {
      const e = { sequence: d.sequence || '' };
      if (mods(d.modifications, false)) e.modifications = mods(d.modifications, false);
      push({ [kind === 'rnaSequence' ? 'rna' : 'dna']: e });
    } else if (kind === 'ligand') {
      push({ ligand: { ccdCodes: [stripCcd(d.ligand || '')] } });
    } else if (kind === 'ion') {
      push({ ligand: { ccdCodes: [stripCcd(d.ion || '')] } });
    } else {
      notes.push(`Unknown entry "${kind}" was dropped`);
    }
  }
  return { converted, notes };
}
