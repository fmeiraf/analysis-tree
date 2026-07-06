# PRD — `analysis-tree`

A user-invoked skill for running iterative data-science / data-exploration work as a
**remountable tree of nodes**. Each node is a self-contained bundle of assets that
collaborate on one goal; the tree can be reconstructed ("remounted") at any time to show
how an analysis unfolded, where each node's assets live, and what was concluded.

Status: **Phase 1 built and proven** (step-mode ledger works end-to-end on a real toy
exploration; notebook executes clean, tree remounts from the jsonl). Phase 2 (auto mode) not
started.
Owner: Fernando Meira. Date: 2026-07-05.

---

## 1. Problem & vision

Data exploration is iterative and branching — you try something, learn, branch, abandon
dead ends, and come back. That structure is normally lost in scattered notebooks. This
skill makes the exploration itself a **first-class tree**: an explicit search over
hypotheses where every step records *why it was pursued*, *what it produced*, and *where
to go next*, and the whole thing can be replayed from durable metadata.

Mental model: **organize analysis as a tree search.** Internal leading-word vocabulary the
skill leans on: **tree, node, branch, frontier, expand, prune, remount, root, objective.**

## 2. Core model

- **Human-driven ledger by default (step mode)**, with a per-run toggle to **auto mode**
  (the master agent runs the search loop unattended). Build ledger-first; auto is a branch
  layered on the same primitives.
- **Source of truth split:** `tree.jsonl` owns **structure + metadata** (parentage,
  status, scores, conclusion summaries); flat node folders own **content** (full goal,
  notebook, artifacts). A node is not "done" until its validated jsonl line is written.
- **Typed nodes** whose contract is defined by a per-exploration **`node.md`**. The skill
  reads `node.md` as the source of truth for node requirements every run.

## 3. Roles

- **Master** (the user's session agent once the skill is invoked): remounts the tree,
  reasons over the frontier, proposes nodes, dispatches node subagents, validates results
  against `node.md`, and is the **sole writer** of `tree.jsonl` (single-writer gate — kills
  drift/duplicate/orphan-line races and makes parallel siblings safe).
- **Node subagent**: receives a lean starting context in the dispatch prompt, can
  **hydrate more context itself** via the CLI (navigate tree, read specific nodes, walk
  ancestors), produces the required assets, runs the notebook clean, writes its folder, and
  returns a structured result. It does **not** decide where to go next — that logic isn't in
  front of it.

## 4. Skill structure (one skill, branch-disclosed)

```
analysis-tree/
  SKILL.md            # master playbook (user-invoked, no description)
  node-execution.md   # disclosed node branch — the only slice a node subagent reads
  references/
    node.md           # DEFAULT node contract (copied into each workspace)
    tree-schema.md    # jsonl line schema + conventions
  cli/
    tree.ts           # TypeScript source
    tree.js           # bundled, zero-dep build artifact (committed)
```

- **User-invoked** (`disable-model-invocation: true`): heavyweight, deliberate mode; zero
  context load. Node subagents are handed `node-execution.md` by explicit path, so they need
  no description to reach it.

## 5. Node contract (`node.md`)

Structured spec, single file, one block per type:

- Frontmatter/structured block per `type`: `required_files` + a checkable `validate` rule
  per file. Prose guidance below.
- **Default type `analysis`**: `goal.md` (background, context, approach) +
  `notebook.ipynb` (executed clean) + `conclusion.md` (findings, whether it worked, where to
  go next).
- The `required_files` list **is** the node's completion criterion — machine-checkable, so
  "done" isn't a vibe.
- Users edit the workspace copy of `node.md` to add types or change required assets.

## 6. `tree.js` CLI

- **Authored in TypeScript, shipped as a bundled `tree.js`**, run via `node tree.js <verb>`
  (Node-only, no `npx`/`bun` install step → deterministic across environments). A build step
  (esbuild/tsc) lives beside the source.
- **Verbs:** `init`, `add`, `set`, `status`, `reparent`, `delete`, `show`, `path`, `node`,
  `children`, `find`, `check-notebook`.
  (`score` deferred until auto-mode needs to rank a wide frontier.)
  - Build refinement: the PRD's single `append` split into **`add`** (create a node + its
    folder + first line) and **`set`/`status`** (append an update line: status / conclusion /
    notebook_ok). Append-only mechanics are internal — every mutation is still a new line.
  - `add --parent <id> --goal <text> [--type <t>] [--created-by <who>]` → prints new id.
  - `set <id> [--status <s>] [--conclusion <text>] [--notebook-ok <bool>]`.

### `show` — terminal visualization

`node tree.js show` is the dedicated terminal view of the current tree: an indented ASCII
tree, root at top, each line = status glyph + `id` + one-line goal, with the live
**frontier** (`open`/`promising` nodes) highlighted. Flags: `--full` (include conclusion
summaries), `--status <s>` (filter), `--path <id>` (highlight root→node).

### `delete` — semantics

- **Children:** blocks deletion of a non-leaf by default; explicit `--cascade` deletes the
  whole subtree, `--reparent` lifts children to the deleted node's parent (grandparent).
  Silent subtree loss is never the default.
- **jsonl:** appends a **tombstone line** (`deleted: true`) — history preserved (pi-style);
  remount filters out ids whose latest line is a tombstone.
- **Folder:** archived to `explorations/<slug>/_deleted/<id>/`; optional `--purge` to `rm`.
- Both master and node subagents use the CLI — it is the shared, deterministic toolkit that
  makes "remount the tree" identical every run and enforces the contract at one `append` gate.

### `tree.jsonl` line schema

Append-only, one JSON object per line, last-write-wins per `id`; edits (status/conclusion/
reparent) are new lines → full history for free (pi-style).

| field | purpose |
|---|---|
| `id` | `node_<seq>_<slug>` (= folder name) |
| `parent_id` | id of parent (`null` for root) |
| `seq` | monotonic creation counter |
| `type` | node type from `node.md` (e.g. `analysis`) |
| `goal` | one-line goal (full version in the folder's `goal.md`) |
| `status` | `open` / `promising` / `dead-end` / `answered` |
| `conclusion` | short summary (full version in `conclusion.md`) |
| `created_by` | `master` or `auto` |
| `notebook_ok` | whether notebook passed clean (`null` if no notebook) |
| `deleted` | tombstone flag (orthogonal to `status`); remount filters these out |

No `timestamp` by default (`append` may optionally stamp a wall-clock time for an audit
trail). Node **id = folder name**; `seq` = creation order, `slug` = short kebab summary of
the goal. Reparenting changes `parent_id` but **not** the name (name records birth order,
not tree position).

## 7. Master decision logic

- **Structured judgment over a typed frontier** — no numeric scoring. Statuses:
  `open / promising / dead-end / answered`. At each step the master renders the tree
  (`show`), inspects the frontier, and reasons in prose about which `open`/`promising` node
  to expand and what the candidate child goal is. The "search" is the discipline of always
  working from an explicit frontier and recording why each branch was pursued or abandoned.
- **Root `objective.md`** (the overall question, success criteria, constraints) is the north
  star; every node's `goal.md` is justified against it.

### Node dispatch contract (Q5)

- **Input:** master passes a lean starting bundle (target node id + goal + relevant ancestor
  context — chain-of-conclusions + full parent `conclusion.md`); the node hydrates more via
  the CLI on demand.
- **Output:** the node subagent **writes its folder** (notebook, conclusion, etc.) and
  returns a structured result; the **master validates** against `node.md` and **appends** the
  `tree.jsonl` line. The append is the "node is now official" act and belongs only to the
  master.

## 8. Auto mode (Phase 2)

- Master drives the same primitives without waiting for the human.
- **Stops on the first of:** objective-met (success criteria in `objective.md` judged
  satisfied) / frontier-exhausted (no `open`/`promising` nodes) / **max-nodes budget
  (default 12)**. The budget is the non-negotiable backstop.
- **Human checkpoint** every **10** nodes and at every stop: surface a tree summary, allow
  redirect/continue.
- **Sequential by default**, with opt-in **bounded parallel siblings** (small cap) for
  genuinely independent hypotheses — safe because of the single-writer append gate.

## 9. Workspace

- Self-contained per exploration: `explorations/<slug>/` containing `objective.md`,
  `node.md` (copied in, editable per exploration), `tree.jsonl`, `nodes/node_<seq>_<slug>/`,
  and a copied-in `tree.js`.
- **Copied-in tooling is deliberate:** each exploration is a portable, committable,
  reproducible unit that survives skill updates/absence. Reproducibility beats DRY for a
  data-science record; the skill remains source of truth for the CLI *source*, the copy is a
  frozen build.
- **Init:** invoking on a fresh slug runs a short interview to write `objective.md`,
  scaffolds files, copies in default `node.md` + `tree.js`, writes the `root` node
  (`node_0_root`).
- **Resume:** invoking on an existing slug → master runs `node tree.js show` to remount the
  frontier and continues. Remount *is* the entry step (no separate resume command).

## 10. Notebook validation

- **Prefer** the execute-notebooks skill when present; **fall back** to direct execution
  (`jupyter nbconvert ... --execute`, else `papermill`, else `nbclient`) so the core node
  flow is portable. If no executor is installed, the node reports it (suggest
  `pip install nbclient nbformat`) rather than faking execution — the master decides.
  Execution must run with the node folder as the working directory (relative data paths).
- **`notebook_ok = true`** means executed top-to-bottom with **zero `error`-type cell
  outputs**, verified deterministically by `node tree.js check-notebook <id>` (scans the
  executed ipynb JSON). Master validates `notebook_ok` at the append gate for `analysis`
  nodes.

## 11. Build plan

**Phase 1 — the ledger (step mode), end-to-end:**
1. Skill scaffold — `SKILL.md`, `node-execution.md`, `references/` (default `node.md`,
   tree-schema doc).
2. `tree.js` CLI (TS source + bundled build) — all verbs incl. `check-notebook`.
3. Step-mode loop working on a **real toy exploration**: init → interview `objective.md` →
   propose node → dispatch node subagent (`node-execution.md`) → produce assets →
   execute-notebooks/fallback → `check-notebook` → validate against `node.md` → `append` →
   remount.

**Phase 1 completion criterion:** not "code written" but **a real exploration remounts
cleanly** on a toy dataset.

**Phase 2 — the search (auto mode):**
4. Auto loop: frontier reasoning, status transitions, stopping criteria
   (objective / frontier / max-nodes=12), human checkpoint every 10, opt-in parallel siblings.

## 12. Adopt — importing existing analyses

A third **entry branch** alongside new-exploration and resume: **adopt** scattered work that
already exists in a repo (notebooks, scripts, reports) into a tree. Disclosed to
`adopt.md` — the master reads it only on this branch; it hands back to the normal loop once the
tree is built.

- **Invents no new primitives.** An adopted node is an ordinary node validated against `node.md`;
  a **"missing part" is a contract gap** (no `conclusion.md`, un-executed notebook, no
  `objective.md`) detected by the same gate the master runs before committing any node. Placing
  files into node folders is copying on top of `add`. **Zero CLI changes** — the only addition is
  provenance: adopted nodes carry `created_by: adopt`.
- **Propose-then-approve.** The master interviews for an objective (repos rarely state one),
  scans where the user points it (or asks), inventories every candidate artifact exhaustively,
  infers a candidate tree + artifact→node mapping (parent from folder layout, filename ordering,
  cross-references), and renders the whole proposed tree for the user to edit **before creating
  anything** — parentage is inferred and often wrong.
- **Gap prompting.** Every adopted node is walked against its `node.md` contract; each gap is
  surfaced to the user with the cheapest fix (state/draft a conclusion, run the notebook, confirm
  the goal). A deferred gap must be explicit — the node stays `open` with the gap named in its
  conclusion, never silently marked done.
- **Completion:** every inventoried artifact is either an adopted node passing its contract or has
  its gap explicitly accepted and reflected in status, with no scoped artifact dropped unseen.

---

## Appendix — decision log

| # | Decision |
|---|---|
| Q1 | Human-driven ledger default + auto-mode toggle; build ledger-first |
| Q2 | `tree.jsonl` owns structure/metadata; flat folders own content; done = line written |
| Q3 | Typed nodes; default `analysis` = executed notebook + goal + conclusion |
| Q4 | `node.md` = structured spec, single file, source of truth every run |
| Q5 | Node hydrates via CLI; subagent writes folder, master validates + is sole jsonl writer |
| Q6 | Deterministic bundled CLI over `tree.jsonl` (not agent-improvised parsing) |
| Q7 | Author in TS, ship bundled `tree.js`, run via `node` |
| Q8 | Structured judgment over status frontier (no numeric score); root `objective.md` |
| Q9 | Auto stops on objective/frontier/max-nodes(12); checkpoint every 10; sequential default + opt-in parallel |
| Q10 | One skill; master playbook in SKILL.md; node branch disclosed to `node-execution.md` |
| Q11 | User-invoked (zero context load) |
| Q12 | Name `analysis-tree`; vocabulary tree/node/branch/frontier/expand/prune/remount/root/objective |
| Q13 | Self-contained `explorations/<slug>/`, copied-in tooling, init-interviews-objective, resume=remount |
| Q14 | jsonl schema fields fixed; append-only last-write-wins; no default timestamp |
| Q15 | Prefer execute-notebooks, fallback nbconvert/papermill; `notebook_ok` = zero error outputs via `check-notebook` |
| Q16 | Phase 1 (step mode) proven on real toy exploration before Phase 2 (auto mode) |
| Q17 | `show` = terminal ASCII-tree viz (flags `--full`/`--status`/`--path`); `delete` blocks non-leaf by default (`--cascade`/`--reparent`), tombstone (`deleted`) + archive to `_deleted/` (`--purge` to rm) |
| Q18 | **Adopt** — third entry branch, disclosed to `adopt.md`; propose-then-approve import of existing repo analyses; gaps = `node.md` contract failures on adopted nodes; `created_by: adopt`, zero CLI changes |
