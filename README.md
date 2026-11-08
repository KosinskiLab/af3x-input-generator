# AF3x Input Generator

A browser-based JSON input generator for [AF3x](https://github.com/KosinskiLab/af3x) — the AlphaFold 3 extension for explicit crosslink modelling.

**Live at https://kosinskilab.github.io/af3x-input-generator/** — no installation needed, just open the link.

## Features

### Sequences
- **Protein, RNA, DNA, Ligand** entities with full AF3x field support
- Multiple input modes: type directly, paste FASTA, upload FASTA file, or fetch from **UniProt ID** (live API call)
- Sequence validation (checks for invalid characters per molecule type)
- Homomer support via comma-separated chain IDs (e.g. `A,B,C`)

### Crosslinks
- All **AF3x crosslinkers** in a grouped dropdown:
  - Symmetric NHS-ester: DSSO, DSS, BS3, DSG, BS2G, DSBU, CDI, PHOX, BSPEG5, BSPEG9, azide-A-DSBSO
  - Asymmetric (order matters!): SDA, SDA25A, LCSDA, SDAD
  - Dynamic: LINK\<n\> (flexible carbon chain), RIGID\<n\> (rigid aromatic rings)
- **Warning banner** for asymmetric crosslinkers explaining residue order requirement
- **CSV import**: upload xiVIEW or xiNET crosslink CSVs → auto-detect format → choose which pairs to import → assign proteins to chain IDs

### Disulfide Bonds
- Separate section using the `disulfide_bonds` JSON field
- AF3x models these by mutating Cys→Ala and adding S–S covalent ligands

### Post-Translational Modifications
- **PTM picker modal** with 50+ modifications searchable by name or CCD code
- Categories: Phosphorylation, Acetylation/Methylation, Hydroxylation, D-amino acids, RNA/DNA modifications, and more
- Works for protein PTMs (`ptmType`/`ptmPosition`) and RNA/DNA base modifications

### Advanced (collapsible)
- Optional free-text **description** per chain (cosmetic only, not used by AF3x)
- MSA configuration (unpaired/paired content or file paths)
- Structural templates (mmCIF content or path + 0-based query/template indices), with
  automatic index-mapping suggestions via sequence alignment against an uploaded PDB/mmCIF
- Bonded atom pairs (covalent bonds for glycans, covalent ligands)
- User-provided CCD (inline mmCIF content or file path)

### Output
- **Generate JSON** — validates all fields, produces AF3x-compatible JSON
- **Copy to clipboard** / **Download** as `.json`
- **Import JSON** — load an existing AF3x JSON file to edit

### Topology Visualisation
- Live **arc diagram** showing all chains as coloured bars and crosslinks as bezier arcs
- Updates in real time as sequences and crosslinks are added
- Tooltip on hover shows crosslinker name and residue positions

## CSV Import Format

The importer auto-detects two formats from column names:

| Format | Required columns |
|--------|-----------------|
| **xiVIEW** | `Protein1`, `Protein2`, `AbsPos1`, `AbsPos2`, `Score` |
| **xiNET**  | `Protein1`, `Protein2`, `LinkPos1`, `LinkPos2`, `Score` (optional `PepPos1`, `PepPos2`) |

After parsing, you can filter by minimum score, exclude decoys, restrict to inter-protein links, and select individual pairs before importing.

## JSON Format (AF3x)

```json
{
  "dialect": "alphafold3",
  "version": 4,
  "name": "my_complex",
  "modelSeeds": [1, 2, 3],
  "sequences": [
    { "protein": { "id": "A", "sequence": "MKVL..." } },
    { "ligand":  { "id": "L", "ccdCodes": ["ATP"] } }
  ],
  "crosslinks": [
    { "name": "DSSO", "residue_pairs": [[["A", 104], ["B", 43]]] }
  ],
  "disulfide_bonds": [
    { "residue_pairs": [[["A", 14], ["A", 20]]] }
  ]
}
```

## AF3x Quirks & Gotchas

Things this tool works around or that aren't obvious from AF3x's own docs (verified
against `folding_input.py`/`pipeline.py`/`templates.py` in the AF3x source):

- **Custom templates require explicit MSA.** If a chain has a non-empty `templates`
  list, AF3x also requires `unpairedMsa`/`pairedMsa` to be explicitly set (either to
  real MSA content or to `""` to skip search) — leaving MSA on "Auto" while templates
  are set is rejected with *"…templates set only partially…"*. This tool checks for
  that combination and blocks JSON generation with a clear error instead of letting
  AF3x fail later. (`pipeline.py`, `process_protein_chain`)
- **Templates need real mmCIF, not PDB.** AF3x's `Template.mmcif` field is parsed by
  a CIF-only parser — there's no PDB code path. Uploading a legacy `.pdb` file for a
  template is auto-converted to a minimal valid mmCIF (`pdbToMmcif` in
  `js/pdb_import.js`). Two non-obvious requirements that minimal mmCIF must satisfy,
  found by trial and error against real AF3x errors:
  - **No HETATM/waters.** Mixing water into the same `label_entity_id` as the polymer
    raises *"Bad mmCIF file: non-water entity has water molecules"* — the converter
    only emits `ATOM` records.
  - **A release date is mandatory.** Templates without
    `_pdbx_audit_revision_history.revision_date` raise *"Template structure must have
    a release date"*. The converter parses the date from a PDB `HEADER` line if
    present, otherwise falls back to today's date — the exact value doesn't matter
    for a manually-supplied template.
- **`userCCDPath` exists** (since AF3x JSON schema v3) — mutually exclusive with
  `userCCD`. An earlier AF3x version genuinely didn't have it; if you're getting a
  schema-validation error mentioning it, check which AF3x version/commit you're
  running against.
- **Version is fixed at 4** in this tool's output (the current schema version) since
  it uses `mmcifPath`/`unpairedMsaPath` (v2), `userCCDPath` (v3), and could use
  `description` (v4). AF3x's `JSON_VERSIONS` accepts 1–4; older AF3x checkouts may
  cap out lower — re-check `folding_input.py`'s `JSON_VERSIONS` constant if a version
  mismatch error comes up after an AF3x update.
- **mmCIF parsing is more varied than it looks.** Real-world CIF files (including
  AF3x's own outputs) use several valid-but-different conventions this tool's parser
  (`js/pdb_import.js`) has to handle: a long comment/license header before `data_`
  (format detection scans further than the first few hundred characters), sequence
  given via the per-residue `_entity_poly_seq` loop instead of the packed
  `pdbx_seq_one_letter_code` string, and single-row categories written in flat
  key-value form instead of a `loop_` block (common for `_entity`/`_entity_poly` in
  single-chain/single-entity depositions).

## Data sources

Sequences fetched by UniProt ID are retrieved from [UniProt](https://www.uniprot.org) (The UniProt Consortium),
available under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Credits

Developed by Luca Leon Egger in the [Kosinski Lab](https://www.embl.org/groups/kosinski/), EMBL Hamburg.
Maintained by the Kosinski Lab. © 2026 European Molecular Biology Laboratory (EMBL).
