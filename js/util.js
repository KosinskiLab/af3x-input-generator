// Pure helpers: text escaping, sequence parsing, UniProt, A3M checks, alignment.

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// ─── Sequences ───────────────────────────────────────────────────────────────

export const ALPHABET = {
  protein: new Set('ACDEFGHIKLMNPQRSTVWY'),
  rna: new Set('ACGU'),
  dna: new Set('ACGT'),
};

export function cleanSeq(text) {
  return String(text || '').replace(/[^A-Za-z]/g, '').toUpperCase();
}

/** FASTA text → [{ header, seq }]. Text without a header is one entry. */
export function parseFasta(text) {
  const entries = [];
  let cur = null;
  for (const line of String(text).split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    if (l.startsWith('>') || l.startsWith(';')) {
      if (cur && cur.seq) entries.push(cur);
      cur = { header: l.slice(1).trim(), seq: '' };
    } else {
      if (!cur) cur = { header: '', seq: '' };
      cur.seq += cleanSeq(l);
    }
  }
  if (cur && cur.seq) entries.push(cur);
  return entries;
}

/** "sp|P04637|P53_HUMAN Cellular tumor antigen p53 OS=…" → "P53_HUMAN". */
export function shortHeader(header) {
  if (!header) return '';
  const first = header.split(/\s+/)[0];
  const parts = first.split('|');
  return (parts.length >= 3 ? parts[2] : first).slice(0, 40);
}

/** Guess the polymer type of a pasted sequence. */
export function guessSeqType(seq) {
  if (seq.length < 8) return 'protein';
  if (/^[ACGU]+$/.test(seq) && seq.includes('U')) return 'rna';
  if (/^[ACGT]+$/.test(seq)) return 'dna';
  return 'protein';
}

// ─── UniProt ─────────────────────────────────────────────────────────────────

const UNIPROT_RE = /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})(?:-\d+)?$/;

/** Text → list of UniProt accessions, or null if it is anything else. */
export function parseUniprotIds(text) {
  const tokens = String(text).trim().toUpperCase().split(/[\s,;]+/).filter(Boolean);
  if (!tokens.length || tokens.length > 30) return null;
  return tokens.every(t => UNIPROT_RE.test(t)) ? tokens : null;
}

export async function fetchUniprot(acc) {
  const res = await fetch(`https://rest.uniprot.org/uniprotkb/${encodeURIComponent(acc)}.fasta`);
  if (!res.ok) throw new Error(res.status === 404 || res.status === 400 ? `${acc} not found` : `UniProt error ${res.status}`);
  const entry = parseFasta(await res.text())[0];
  if (!entry) throw new Error(`${acc}: no sequence`);
  return { acc, seq: entry.seq, name: shortHeader(entry.header) };
}

// ─── File sniffing ───────────────────────────────────────────────────────────

/** 'json' | 'structure' | 'csv' | 'fasta' | null */
export function sniffFile(name, text) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const head = text.trimStart().slice(0, 2000);
  if (ext === 'json' || /^[\[{]/.test(head)) return 'json';
  if (['pdb', 'ent', 'cif', 'mmcif'].includes(ext)) return 'structure';
  if (['csv', 'tsv'].includes(ext)) return 'csv';
  if (/^data_/m.test(head) || /^(ATOM|HETATM|HEADER|REMARK|SEQRES|CRYST1)\s/m.test(head)) return 'structure';
  if (/^[^\n]*Protein1[^\n]*Protein2/i.test(head)) return 'csv';
  if (head.startsWith('>') || /^[A-Za-z\s]+$/.test(head)) return 'fasta';
  return null;
}

// ─── A3M validation ──────────────────────────────────────────────────────────

/** Returns { errors, warnings } for an A3M text against the chain sequence. */
export function validateA3m(a3mText, querySeq) {
  const errors = [];
  const warnings = [];
  const entries = [];
  let cur = null;
  for (const line of a3mText.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.startsWith('>')) {
      if (cur) entries.push(cur);
      cur = '';
    } else if (cur !== null) {
      cur += line.trim();
    }
  }
  if (cur !== null) entries.push(cur);
  if (!entries.length) return { errors: ['no sequences found'], warnings };

  const first = entries[0];
  if (/[a-z]/.test(first)) errors.push('query row has insertions (lowercase)');
  if (first.includes('-')) errors.push('query row has gaps');
  if (querySeq) {
    const up = first.toUpperCase();
    if (up.length !== querySeq.length) {
      errors.push(`query row is ${up.length} long, chain is ${querySeq.length}`);
    } else if (up !== querySeq) {
      const i = [...querySeq].findIndex((c, k) => c !== up[k]);
      errors.push(`query row differs from the chain at position ${i + 1}`);
    }
  }
  const width = querySeq ? querySeq.length : first.replace(/[a-z]/g, '').length;
  const bad = entries.slice(1).filter(s => s.replace(/[a-z]/g, '').length !== width).length;
  if (bad) warnings.push(`${bad} row${bad === 1 ? '' : 's'} with a wrong alignment length`);
  return { errors, warnings };
}

// ─── Template alignment ──────────────────────────────────────────────────────

/** Needleman-Wunsch global alignment → { alignedA, alignedB }. */
export function needlemanWunsch(seqA, seqB, match = 2, mismatch = -1, gap = -1) {
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
  let i = n, j = m;
  const a = [], b = [];
  while (i > 0 && j > 0) {
    const s = seqA[i - 1] === seqB[j - 1] ? match : mismatch;
    if (dp[i][j] === dp[i - 1][j - 1] + s) { a.push(seqA[--i]); b.push(seqB[--j]); }
    else if (dp[i][j] === dp[i - 1][j] + gap) { a.push(seqA[--i]); b.push('-'); }
    else { a.push('-'); b.push(seqB[--j]); }
  }
  while (i > 0) { a.push(seqA[--i]); b.push('-'); }
  while (j > 0) { a.push('-'); b.push(seqB[--j]); }
  return { alignedA: a.reverse().join(''), alignedB: b.reverse().join('') };
}

/** 0-based index pairs for every column with a residue on both sides. */
export function alignmentToMapping(alignedQuery, alignedTemplate) {
  const queryIndices = [], templateIndices = [];
  let qi = 0, ti = 0, same = 0;
  for (let k = 0; k < alignedQuery.length; k++) {
    const q = alignedQuery[k], t = alignedTemplate[k];
    if (q !== '-' && t !== '-') {
      queryIndices.push(qi);
      templateIndices.push(ti);
      if (q === t) same++;
    }
    if (q !== '-') qi++;
    if (t !== '-') ti++;
  }
  return { queryIndices, templateIndices, identity: queryIndices.length ? same / queryIndices.length : 0 };
}

export function parseIntList(text) {
  return String(text || '').split(/[\s,;]+/).filter(Boolean).map(s => parseInt(s, 10)).filter(n => !Number.isNaN(n));
}

/** Compact "0-12, 15, 20-31" form of a sorted integer list. */
export function formatRanges(nums) {
  if (!nums.length) return '';
  const out = [];
  let start = nums[0], prev = nums[0];
  for (let i = 1; i <= nums.length; i++) {
    const n = nums[i];
    if (n === prev + 1) { prev = n; continue; }
    out.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = n;
  }
  return out.join(', ');
}

/** Inverse of formatRanges; also accepts plain comma lists. */
export function parseRanges(text) {
  const out = [];
  for (const tok of String(text || '').split(/[\s,;]+/).filter(Boolean)) {
    const m = tok.match(/^(\d+)-(\d+)$/);
    if (m) {
      const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      for (let n = a; n <= b && out.length < 100000; n++) out.push(n);
    } else if (/^\d+$/.test(tok)) {
      out.push(parseInt(tok, 10));
    } else {
      return null;
    }
  }
  return out;
}
