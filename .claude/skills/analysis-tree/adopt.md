# Adopting existing analyses into the tree

You are the **master**, and the user wants to **adopt** work that already exists in this repo —
scattered notebooks, scripts, and reports — into a proper **tree**. This is a one-time
bootstrap. Once it's built you hand back to the normal loop in [`SKILL.md`](SKILL.md): the
adopted nodes are ordinary nodes, and you **remount** and continue the **frontier** from there.

Adopt invents nothing new. An adopted node is a real node, validated against `node.md` like any
other — so a **"missing part" is just a contract gap** (a notebook with no `conclusion.md`, an
un-executed `notebook.ipynb`, a repo with no `objective.md`). You detect gaps with the same
validation gate you run before committing any node, and you **prompt the user** to close each one.

## Steps

1. **Scaffold the workspace.** As for a new exploration: pick a `<slug>`, create
   `explorations/<slug>/` **at the user's project root** (their working directory,
   `./explorations/<slug>/`) — never inside the skill folder or the analysis-tree tool repo —
   and copy the skill's `references/node.md` and `cli/tree.js` into it.

2. **Establish the objective.** An adopted repo rarely states one. Draft an `objective.md` from
   the repo's own signals — READMEs, report headings, notebook titles — then confirm and refine
   it with the user. It is still the north star every adopted node is justified against. Then
   `node tree.js init --root-goal "<the overall question>"` to create the log and `root`.

3. **Point the scan.** Scan where the user told you to. If they didn't say, **ask** — which
   directories hold the analyses, and what to include or ignore (exclude vendored code, data
   dumps, checkpoints). Never guess the scope silently.

4. **Inventory the candidates.** Sweep the scoped paths **exhaustively** for analysis artifacts:
   notebooks (`.ipynb`), analysis scripts (`.py`/`.R`/`.sql`), and written findings
   (`.md`/reports). For each, capture what it does (from titles, headings, first cells, prose),
   whether it has been executed, and any cross-references between artifacts. A silently skipped
   artifact is a lost branch — every candidate in scope must reach step 5 or be shown to the user
   as deliberately excluded.

5. **Infer the tree and propose it.** Map each artifact to a candidate node — a one-line `goal`,
   a `type` (notebook → `analysis`, prose report → `synthesis`), and a proposed **parent** from
   folder layout, filename ordering (`_v2`, `step2`), and cross-references (one artifact building
   on another). Pre-flag each node's contract gaps against `node.md`. Default to flat-under-`root`
   when you can't justify a parent. Then render the **whole proposed tree** — indented, each node
   showing goal, type, parent, and `[gap: …]` tags — and get the user's edits **before creating
   anything**. Parentage is inferred and often wrong; the user approving the map is the point.

6. **Build the approved tree, parents before children.** For each node, top-down:
   - `node tree.js add --parent <id> --goal "<goal>" --type <type> --created-by adopt` → new id.
     Give it a **readable name**: pass a short `--slug "<kebab>"` (2–4 words) when the goal is a
     long sentence, so the node id reads cleanly.
   - Copy the artifact into `nodes/<id>/` under its contract name (notebook → `<id>.ipynb`,
     named after the node id; report → source for `conclusion.md`). Overwrite the template
     `goal.md` with a real one: the
     inferred background **plus a line recording the original path** it was adopted from, so a
     later remount shows the provenance.
   - If an `analysis` node's notebook was already executed, verify it with
     `node tree.js check-notebook <id>`. If it isn't executed or it errors, that's a gap — carry
     it to step 7; do not fake `notebook_ok`.

7. **Close the gaps.** Walk every adopted node against its `node.md` contract — the same
   validation you run before committing any node. For each gap, prompt the user with the specific
   missing part and the cheapest way to close it:
   - **No conclusion** → have them state the finding, or draft one from the notebook/report for
     their approval, and write `conclusion.md`.
   - **Not executed / errors** → offer to run it (needs the executor and the data present); if the
     data is gone, record that in the conclusion rather than pretending it ran.
   - **No goal / context** → confirm the inferred goal.
   - A gap the user chooses to **defer** is fine, but it must be **explicit**: leave the node
     `open` with the gap named in its conclusion. Never silently mark a gapped node done.
   - **Commit** each node as the master always does:
     `node tree.js set <id> --conclusion "<summary>" --notebook-ok <true|false>` and
     `node tree.js status <id> <promising|dead-end|answered>`.

**Done when** every inventoried artifact is either an adopted node that passes its `node.md`
contract, or has its gap explicitly accepted by the user and reflected in its status — and no
scoped artifact was dropped without the user seeing it. Then `node tree.js show` the remounted
tree and return to the loop in [`SKILL.md`](SKILL.md): the frontier is now the live and gapped
nodes to continue from.
