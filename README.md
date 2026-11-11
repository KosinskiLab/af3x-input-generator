# AF3x Input Generator

A browser tool that builds input JSON files for [AF3x](https://github.com/KosinskiLab/af3x), the AlphaFold 3
fork that models crosslinks explicitly. Files without crosslinks also run in plain AlphaFold 3.

**Live at https://kosinskilab.github.io/af3x-input-generator/**. Nothing to install.

## Use

1. **Chains.** Paste a sequence, FASTA or UniProt ID into a chain, or drop a FASTA / PDB / mmCIF file on the page.
2. **Crosslinks.** Click two residues, type the pairs (or paste lines like `A 104 B 43`), or import an
   xiVIEW / xiNET CSV.
3. **Job.** Name it and press **Download JSON**. The JSON is always up to date; open problems are listed next
   to the button and block the download until fixed.

Everything else stays off the page until it is used:

| Feature | Where |
|---|---|
| Disulfide bonds, bonded atom pairs, custom ligand definition (CCD) | **Advanced options** (press `/`) |
| Modifications (PTMs, modified bases) | click a residue, or a chain's `⋯` menu |
| MSA: none or your own A3M; templates: none or your own structure | a chain's `⋯` menu, or Advanced options |
| Exact seed values, JSON version | the settings button next to Seeds |
| Batch export: one job per crosslink, or random crosslink subsets (ZIP) | the arrow next to Download |
| Open an AlphaFold 3 / AlphaFold Server JSON | **Import**, or drop the file |

The current input is autosaved in the browser and restored on the next visit. **New** clears it.

## Crosslink CSV

| Format | Columns read |
|---|---|
| xiVIEW | `Protein1`, `Protein2`, `AbsPos1`, `AbsPos2`, `Score`, `Decoy1`, `Decoy2` |
| xiNET | `Protein1`, `Protein2`, `LinkPos1`, `LinkPos2`, `Score`, optional `PepPos1`, `PepPos2` |

Proteins are matched to existing chains by name; the rest get new chains, with sequences fetched from UniProt
on request. Convert other formats first, for example with [pyXLMS](https://github.com/hgb-bin-proteomics/pyXLMS).

## Output

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

## AlphaFold 3 rules the tool applies

- **MSA and templates go together.** A protein with custom templates must also have its MSA set (to a file or
  to none), and a protein with one custom MSA needs both `unpairedMsa` and `pairedMsa` set. The tool writes the
  missing one as empty and asks for the MSA choice when templates are custom.
- **A template is one chain with a release date.** An uploaded PDB or mmCIF is cut down to the chosen chain and
  rewritten as a minimal mmCIF: `ATOM` records only, first model, residues with coordinates numbered 1…N, release
  date taken from the file or set to today. Template indices then count the residues that have coordinates,
  which is what the alignment in the tool produces.
- **Asymmetric crosslinkers** (SDA, LCSDA, SDAD, SDA25A) need the NHS-ester end first. A pair that is only
  valid in reverse order is written reversed.
- **Overlapping crosslinks.** AF3x drops a crosslink whose residue is already used by an earlier one unless it
  runs with `--noremove_overlapping_crosslinks`; the tool warns about them.
- **Chain IDs** are upper-case letters. Renaming a chain updates the crosslinks, disulfides and bonds that use it.
- **`description`** (the chain name) is written only for JSON version 4.

## Development

Static site, no build step. `main` is served by GitHub Pages, so a push goes live.

```bash
python3 -m http.server 54399 --bind 127.0.0.1   # then open http://127.0.0.1:54399/
```

| File | Content |
|---|---|
| `index.html`, `style.css` | page, dialogs, styles |
| `js/app.js` | page logic: reads the page into a model, refreshes issues, diagram, sequence views, JSON |
| `js/af_json.js` | model → issues and JSON; AlphaFold Server JSON conversion |
| `js/data.js` | crosslinker table (a hand copy of AF3x `crosslink_definitions.py`), modification list, colours |
| `js/util.js` | FASTA, UniProt, A3M check, alignment |
| `js/ui.js` | toasts, menus, dialogs |
| `js/csv_import.js`, `js/pdb_import.js` | crosslink CSV import; PDB / mmCIF parsing and template building |
| `js/viz.js`, `js/topology_interactive.js` | small and large crosslink diagram |

## Data sources

Sequences fetched by UniProt ID are retrieved from [UniProt](https://www.uniprot.org) (The UniProt Consortium),
available under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Credits

Developed by Luca Leon Egger in the [Kosinski Lab](https://www.embl.org/groups/kosinski/), EMBL Hamburg.
Maintained by the Kosinski Lab. © 2026 European Molecular Biology Laboratory (EMBL).
