// Static data: crosslinkers, PTM database, crosslink colours

// Colours of crosslinker groups, in fixed order, one step per theme.
// Checked for colour-vision-deficiency separation on the page surfaces
// (light #fdfdfc, dark #1a1a19); keep the order when editing.
export const XL_GROUP_COLORS = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark:  ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};

// Stroke-dasharray values: a ninth group reuses the first colour with the next line style.
// Order: solid → long-dash → short-dash → dash-dot → dotted → very-long → dash-2dot → medium
export const XL_DASH_PATTERNS = [
  'none',
  '9 3',
  '3 3',
  '10 3 2 3',
  '2 2',
  '15 3',
  '6 2 2 2',
  '5 2',
];

// ─── Crosslinker definitions ─────────────────────────────────────────────────
export const CROSSLINKERS = [
  // Symmetric NHS-ester crosslinkers
  {
    name: 'DSSO',
    symmetric: true,
    category: 'NHS-ester (symmetric)',
    reactiveResidues: ['K', 'S', 'T', 'Y', 'N-term'],
    spacer: '~6 Å',
    description: 'Disuccinimidyl sulfoxide — cleavable, MS-cleavable linker',
  },
  {
    name: 'DSS',
    symmetric: true,
    category: 'NHS-ester (symmetric)',
    reactiveResidues: ['K', 'S', 'T', 'Y', 'N-term'],
    spacer: '~12 Å',
    description: 'Disuccinimidyl suberate — 8-carbon spacer, non-cleavable',
  },
  {
    name: 'BS3',
    symmetric: true,
    category: 'NHS-ester (symmetric)',
    reactiveResidues: ['K', 'S', 'T', 'Y', 'N-term'],
    spacer: '~12 Å',
    description: 'Bis(sulfosuccinimidyl)suberate — water-soluble BS3, 8-carbon spacer',
  },
  {
    name: 'DSG',
    symmetric: true,
    category: 'NHS-ester (symmetric)',
    reactiveResidues: ['K', 'S', 'T', 'Y', 'N-term'],
    spacer: '~8 Å',
    description: 'Disuccinimidyl glutarate — shorter spacer (5-carbon)',
  },
  {
    name: 'BS2G',
    symmetric: true,
    category: 'NHS-ester (symmetric)',
    reactiveResidues: ['K', 'S', 'T', 'Y', 'N-term'],
    spacer: '~8 Å',
    description: 'Bis(sulfosuccinimidyl)glutarate — water-soluble BS2G',
  },
  {
    name: 'DSBU',
    symmetric: true,
    category: 'NHS-ester (symmetric)',
    reactiveResidues: ['K', 'S', 'T', 'Y', 'N-term'],
    spacer: '~12 Å',
    description: 'Disuccinimidyl dibutyric urea — MS-cleavable, urea-containing',
  },
  {
    name: 'CDI',
    symmetric: true,
    category: 'NHS-ester (symmetric)',
    reactiveResidues: ['K', 'S', 'T', 'Y', 'N-term'],
    spacer: '~5 Å',
    description: 'Carbonyl diimidazole — short zero-length-like crosslinker',
  },
  {
    name: 'PHOX',
    symmetric: true,
    category: 'NHS-ester (symmetric)',
    reactiveResidues: ['K', 'S', 'T', 'Y', 'N-term'],
    spacer: '~10 Å',
    description: 'Phosphonate-containing crosslinker',
  },
  {
    name: 'BSPEG5',
    symmetric: true,
    category: 'NHS-ester (symmetric, PEG)',
    reactiveResidues: ['K', 'S', 'T', 'Y', 'N-term'],
    spacer: '~18 Å',
    description: 'PEG5 spacer — hydrophilic, 5 PEG units',
  },
  {
    name: 'BSPEG9',
    symmetric: true,
    category: 'NHS-ester (symmetric, PEG)',
    reactiveResidues: ['K', 'S', 'T', 'Y', 'N-term'],
    spacer: '~26 Å',
    description: 'PEG9 spacer — hydrophilic, 9 PEG units',
  },
  // Asymmetric crosslinkers (residue order matters!)
  {
    name: 'SDA',
    symmetric: false,
    category: 'NHS-ester + diazirine (asymmetric)',
    reactiveResidues: [['K', 'S', 'T', 'Y', 'N-term'], ['any AA']],
    spacer: '~5 Å',
    description: 'Sulfo-SDA — NHS-ester + diazirine photocrosslinker',
    asymmetricNote: 'Residue 1: NHS-ester (K, S, T, Y, N-term) · Residue 2: diazirine (any AA)',
  },
  {
    name: 'SDA25A',
    symmetric: false,
    category: 'NHS-ester + diazirine (asymmetric)',
    reactiveResidues: [['K', 'S', 'T', 'Y', 'N-term'], ['any AA']],
    spacer: '~25 Å',
    description: 'SDA with 25 Å spacer arm — long-range variant',
    asymmetricNote: 'Residue 1: NHS-ester (K, S, T, Y, N-term) · Residue 2: diazirine (any AA)',
  },
  {
    name: 'LCSDA',
    symmetric: false,
    category: 'NHS-ester + diazirine (asymmetric)',
    reactiveResidues: [['K', 'S', 'T', 'Y', 'N-term'], ['any AA']],
    spacer: '~11 Å',
    description: 'Sulfo-LC-SDA — longer spacer arm than SDA',
    asymmetricNote: 'Residue 1: NHS-ester (K, S, T, Y, N-term) · Residue 2: diazirine (any AA)',
  },
  {
    name: 'SDAD',
    symmetric: false,
    category: 'NHS-ester + diazirine (asymmetric)',
    reactiveResidues: [['K', 'S', 'T', 'Y', 'N-term'], ['any AA']],
    spacer: '~8 Å',
    description: 'Sulfo-SDAD — disulfide-cleavable + diazirine',
    asymmetricNote: 'Residue 1: NHS-ester (K, S, T, Y, N-term) · Residue 2: diazirine (any AA)',
  },
  {
    name: 'azide-A-DSBSO',
    symmetric: true,
    category: 'NHS-ester (symmetric)',
    reactiveResidues: ['K', 'S', 'T', 'Y', 'N-term'],
    spacer: '~15 Å',
    description: 'Azide-A-DSBSO — contains azide group for click chemistry',
  },
  // Dynamic linkers
  {
    name: 'LINK',
    dynamic: true,
    symmetric: true,
    category: 'Dynamic (flexible)',
    description: 'Flexible poly-carbon chain — LINK<n> where n = number of carbons (e.g. LINK5)',
  },
  {
    name: 'RIGID',
    dynamic: true,
    symmetric: true,
    category: 'Dynamic (rigid)',
    description: 'Rigid fused aromatic rings — RIGID<n> where n = number of rings (e.g. RIGID2)',
  },
];

// ─── PTM database ─────────────────────────────────────────────────────────────
export const PTM_DATABASE = [
  // Phosphorylation
  { ccd: 'SEP',  name: 'Phosphoserine',             targetAA: 'S', category: 'Phosphorylation',          description: 'O-phosphoserine' },
  { ccd: 'TPO',  name: 'Phosphothreonine',           targetAA: 'T', category: 'Phosphorylation',          description: 'O-phosphothreonine' },
  { ccd: 'PTR',  name: 'Phosphotyrosine',            targetAA: 'Y', category: 'Phosphorylation',          description: 'O-phosphotyrosine' },
  { ccd: 'NEP',  name: 'N1-Phosphohistidine',        targetAA: 'H', category: 'Phosphorylation',          description: 'Phosphorylated at N1 of histidine imidazole' },
  { ccd: 'HIP',  name: 'ND1-Phosphohistidine',       targetAA: 'H', category: 'Phosphorylation',          description: 'Phosphorylated at ND1 of histidine imidazole' },
  // Acetylation & Methylation
  { ccd: 'ALY',  name: 'N6-Acetyllysine',            targetAA: 'K', category: 'Acetylation/Methylation',  description: 'Acetylation of lysine ε-amino group' },
  { ccd: 'MLY',  name: 'N6-Methyllysine',            targetAA: 'K', category: 'Acetylation/Methylation',  description: 'Mono-methylation of lysine ε-amino group' },
  { ccd: 'MLZ',  name: 'N6-Methyllysine (MLZ)',      targetAA: 'K', category: 'Acetylation/Methylation',  description: 'Alternative CCD for N6-methyllysine' },
  { ccd: 'M3L',  name: 'N6,N6,N6-Trimethyllysine',  targetAA: 'K', category: 'Acetylation/Methylation',  description: 'Trimethylation of lysine ε-amino group' },
  { ccd: 'SAC',  name: 'S-Acetylserine',             targetAA: 'S', category: 'Acetylation/Methylation',  description: 'Acetylation of serine hydroxyl' },
  { ccd: 'AGM',  name: 'N5-Methylarginine',          targetAA: 'R', category: 'Acetylation/Methylation',  description: 'Monomethylation of arginine' },
  // Hydroxylation & Oxidation
  { ccd: 'HYP',  name: '4-Hydroxyproline',           targetAA: 'P', category: 'Hydroxylation/Oxidation',  description: 'Trans-4-hydroxyproline; collagen modification' },
  { ccd: 'HY3',  name: '3-Hydroxyproline',           targetAA: 'P', category: 'Hydroxylation/Oxidation',  description: 'cis-3-hydroxyproline' },
  { ccd: 'CSO',  name: 'S-Hydroxycysteine',          targetAA: 'C', category: 'Hydroxylation/Oxidation',  description: 'Cysteine sulfenic acid' },
  { ccd: 'SME',  name: 'Methionine sulfoxide',        targetAA: 'M', category: 'Hydroxylation/Oxidation',  description: 'Oxidation of methionine to sulfoxide' },
  { ccd: 'OCS',  name: 'Cysteinesulfonic acid',       targetAA: 'C', category: 'Hydroxylation/Oxidation',  description: 'Over-oxidised cysteine (sulfonyl)' },
  { ccd: 'CSD',  name: 'S-Cysteic acid',              targetAA: 'C', category: 'Hydroxylation/Oxidation',  description: 'Fully oxidised cysteine' },
  { ccd: 'TYS',  name: 'Sulfotyrosine',              targetAA: 'Y', category: 'Hydroxylation/Oxidation',  description: 'Tyrosine sulfation' },
  // Lipidation & Special
  { ccd: 'MSE',  name: 'Selenomethionine',           targetAA: 'M', category: 'Special',                  description: 'Selenium-substituted methionine; used in SAD phasing' },
  { ccd: 'KCX',  name: 'N6-Carboxylysine',          targetAA: 'K', category: 'Special',                  description: 'CO2 carboxylation of lysine' },
  { ccd: 'CME',  name: 'S-Carboxymethylcysteine',   targetAA: 'C', category: 'Special',                  description: 'Carbamidomethylation of cysteine (iodoacetamide alkylation)' },
  { ccd: 'CGU',  name: 'Gamma-carboxyglutamate',    targetAA: 'E', category: 'Special',                  description: 'Vitamin K-dependent carboxylation of glutamate' },
  { ccd: 'GLP',  name: 'Pyroglutamate (from Glu)',  targetAA: 'E', category: 'Special',                  description: 'Cyclisation of N-terminal glutamate' },
  { ccd: 'PCA',  name: 'Pyroglutamate (from Gln)',  targetAA: 'Q', category: 'Special',                  description: 'Cyclisation of N-terminal glutamine' },
  { ccd: 'FME',  name: 'N-Formylmethionine',        targetAA: 'M', category: 'Special',                  description: 'Formylated N-terminal methionine (prokaryotes)' },
  { ccd: 'CSX',  name: 'S-Methylsulfinylcysteine',  targetAA: 'C', category: 'Special',                  description: 'Sulfinyl cysteine derivative' },
  { ccd: 'LYZ',  name: '5-Hydroxylysine',           targetAA: 'K', category: 'Special',                  description: 'Collagen cross-linking modification' },
  // D-amino acids
  { ccd: 'DAL',  name: 'D-Alanine',     targetAA: 'A', category: 'D-amino acids',  description: 'D-stereoisomer of alanine' },
  { ccd: 'DVA',  name: 'D-Valine',      targetAA: 'V', category: 'D-amino acids',  description: 'D-stereoisomer of valine' },
  { ccd: 'DIL',  name: 'D-Isoleucine',  targetAA: 'I', category: 'D-amino acids',  description: 'D-stereoisomer of isoleucine' },
  { ccd: 'DLE',  name: 'D-Leucine',     targetAA: 'L', category: 'D-amino acids',  description: 'D-stereoisomer of leucine' },
  { ccd: 'DPN',  name: 'D-Phenylalanine', targetAA: 'F', category: 'D-amino acids', description: 'D-stereoisomer of phenylalanine' },
  { ccd: 'DSN',  name: 'D-Serine',      targetAA: 'S', category: 'D-amino acids',  description: 'D-stereoisomer of serine' },
  { ccd: 'DTH',  name: 'D-Threonine',   targetAA: 'T', category: 'D-amino acids',  description: 'D-stereoisomer of threonine' },
  { ccd: 'DCY',  name: 'D-Cysteine',    targetAA: 'C', category: 'D-amino acids',  description: 'D-stereoisomer of cysteine' },
  { ccd: 'DAS',  name: 'D-Aspartate',   targetAA: 'D', category: 'D-amino acids',  description: 'D-stereoisomer of aspartate' },
  { ccd: 'DGL',  name: 'D-Glutamate',   targetAA: 'E', category: 'D-amino acids',  description: 'D-stereoisomer of glutamate' },
  { ccd: 'DLY',  name: 'D-Lysine',      targetAA: 'K', category: 'D-amino acids',  description: 'D-stereoisomer of lysine' },
  { ccd: 'DAR',  name: 'D-Arginine',    targetAA: 'R', category: 'D-amino acids',  description: 'D-stereoisomer of arginine' },
  { ccd: 'DHI',  name: 'D-Histidine',   targetAA: 'H', category: 'D-amino acids',  description: 'D-stereoisomer of histidine' },
  { ccd: 'DTR',  name: 'D-Tryptophan',  targetAA: 'W', category: 'D-amino acids',  description: 'D-stereoisomer of tryptophan' },
  { ccd: 'DTY',  name: 'D-Tyrosine',    targetAA: 'Y', category: 'D-amino acids',  description: 'D-stereoisomer of tyrosine' },
  { ccd: 'DME',  name: 'D-Methionine',  targetAA: 'M', category: 'D-amino acids',  description: 'D-stereoisomer of methionine' },
  { ccd: 'DPR',  name: 'D-Proline',     targetAA: 'P', category: 'D-amino acids',  description: 'D-stereoisomer of proline' },
  // RNA modifications
  { ccd: '5MU',  name: '5-Methyluridine',            targetAA: 'U', category: 'RNA modification',  description: 'Ribothymidine; m5U' },
  { ccd: 'OMU',  name: "2'-O-Methyluridine",         targetAA: 'U', category: 'RNA modification',  description: "2'-O-methylation of uridine" },
  { ccd: 'PSU',  name: 'Pseudouridine',              targetAA: 'U', category: 'RNA modification',  description: 'Ψ; isomerisation of uridine (C-glycosidic bond)' },
  { ccd: '1MA',  name: '1-Methyladenosine',          targetAA: 'A', category: 'RNA modification',  description: 'm1A; N1-methylation of adenosine' },
  { ccd: '2MG',  name: 'N2-Methylguanosine',         targetAA: 'G', category: 'RNA modification',  description: 'm2G; N2 monomethylation' },
  { ccd: 'M2G',  name: 'N2,N2-Dimethylguanosine',   targetAA: 'G', category: 'RNA modification',  description: 'm22G; N2 dimethylation' },
  { ccd: 'OMG',  name: "2'-O-Methylguanosine",       targetAA: 'G', category: 'RNA modification',  description: "2'-O-methylation of guanosine" },
  { ccd: '5MC',  name: '5-Methylcytidine',           targetAA: 'C', category: 'RNA modification',  description: 'm5C; cytosine C5 methylation in RNA' },
  // DNA modifications
  { ccd: '5CM',  name: '5-Methylcytosine (DNA)',     targetAA: 'C', category: 'DNA modification',  description: 'm5dC; epigenetic methylation in CpG context' },
  { ccd: '8OG',  name: '8-Oxoguanine',               targetAA: 'G', category: 'DNA modification',  description: 'Oxidative DNA damage product' },
];

// Unique categories for the PTM picker tabs
export const PTM_CATEGORIES = [...new Set(PTM_DATABASE.map(p => p.category))];
