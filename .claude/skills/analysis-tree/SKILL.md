---
name: analysis-tree
description: Run iterative data-science exploration as a remountable tree of nodes.
disable-model-invocation: true
---

You are the **master** of an exploration organized as a **tree** of **nodes**. Each node is
a self-contained bundle of assets pursuing one goal; the **tree** records how the analysis
branched, what each branch concluded, and where it went next — and can be **remounted** from
its metadata at any time. You expand the **frontier** one node at a time, dispatching each
node to a subagent, and you are the single writer of the tree's log.

Think of it as a search: an explicit **frontier** of live nodes, an **objective** as the
north star, and a discipline of recording *why* every branch was pursued or **pruned**.

Vocabulary used throughout: **tree, node, branch, frontier, expand, prune, remount, root,
objective.**

## Workspace

Every exploration is a self-contained directory: `explorations/<slug>/` holding
`objective.md`, `node.md`, `tree.jsonl`, `nodes/<id>/`, and its own copy of `tree.js`. Run
the CLI as `node tree.js <verb>` from inside it (it resolves the workspace from the script's
location). Full CLI: run `node tree.js` with no args.

**Where `explorations/` lives.** Create it at the **root of the user's current
project** — the directory Claude Code was launched in (the working directory), i.e.
`./explorations/<slug>/`. **Never** create it inside the skill's own folder
(`.claude/skills/analysis-tree/`) or anywhere under the analysis-tree tool repo — the
exploration belongs to the user's project, not the tool. If the user names a different
location, use that instead. When in doubt about the project root, confirm the path with the
user before scaffolding.

The `node.md` in the workspace is the **source of truth** for what each node type requires —
read it every run; never hardcode node requirements. Its schema and the tree mechanics live
in [`references/node.md`](references/node.md) and
[`references/tree-schema.md`](references/tree-schema.md).

## Entry: new exploration or remount

**If the user is starting a new exploration:**
1. Pick a `<slug>` and create `explorations/<slug>/` **at the user's project root** (their
   working directory, `./explorations/<slug>/`), not inside the skill folder — see
   **Workspace** above.
2. Copy the skill's `references/node.md` → `explorations/<slug>/node.md` and the skill's
   `cli/tree.js` → `explorations/<slug>/tree.js`.
3. **Interview the user** to write `objective.md`: the overall question, explicit **success
   criteria** (how you'll know the exploration is done), and any constraints or data
   sources. This is the north star every node is justified against.
4. `node tree.js init --root-goal "<the overall question>"` to create the log and the
   `root` node.

**If the user is resuming:** `cd` into the existing workspace, read `objective.md`, and run
`node tree.js show` to **remount** the tree and see the current frontier. Remounting *is*
the entry step — continue the loop from there.

**If the user wants to adopt existing analyses from this repo into a tree:** follow
[`adopt.md`](adopt.md). It scaffolds the workspace, interviews for an objective, scans where you
point it, and turns existing artifacts (notebooks, scripts, reports) into validated nodes —
prompting the user to fill each node's contract gaps. It hands back to the loop below once the
tree is built.

## The loop

Repeat until a stop condition (below):

1. **Remount.** `node tree.js show` (add `--full` for conclusions). Read the frontier —
   every `open` / `promising` node.
2. **Propose.** Choose one frontier node to **expand** and a candidate child goal, justified
   against `objective.md`. State *why this branch, why now*.
3. **Create.** `node tree.js add --parent <id> --goal "<goal>" --type <type>`. It prints the
   new node id. **Make the node name readable.** The id is `node_<seq>_<slug>`, and the slug
   is what a human scans in `show`, in `path`, and on the dashboard — so make it legible at a
   glance. The slug derives from `--goal`; when the goal is a long sentence (e.g. a question),
   pass a short, concrete `--slug "<kebab-case>"` (2–4 words, e.g. `churn-by-cohort`,
   `price-elasticity`) so the name reads cleanly instead of a truncated sentence.
4. **Dispatch.** Spawn a subagent pointed at
   [`node-execution.md`](node-execution.md). Hand it: the new node id, the workspace path,
   the goal, and lean starting context — the **chain of conclusions** from root to parent
   (cheap; it's in the log) plus the parent's full `conclusion.md`. The subagent can hydrate
   more via the CLI itself, so keep the bundle small.
5. **Validate.** When it returns, check its node against `node.md`: every `required_file`
   present, and for an `analysis` node run `node tree.js check-notebook <id>` yourself —
   never trust the report alone. If validation fails, send it back or fix and re-dispatch.
6. **Commit.** You are the sole writer of `tree.jsonl`. Record the result:
   `node tree.js set <id> --conclusion "<summary>" --notebook-ok <true|false>` and
   `node tree.js status <id> <promising|dead-end|answered>`. Update the parent's status too
   if this result resolves or kills it. The node is now official.
7. **Loop.** Return to step 1.

Editing the shape of the tree as understanding shifts is normal: `node tree.js reparent <id>
<new_parent>` to move a branch, `node tree.js delete <id>` to prune (blocks a non-leaf
unless you pass `--cascade` or `--reparent`; archives the folder unless `--purge`).

### Live dashboard

`node tree.js serve [--port <n>]` starts a local HTML dashboard (default
`http://localhost:4173`) that renders the tree as an indented, collapsible view and updates
**in real time** as you write to `tree.jsonl` — a node appears as pulsing "working" the moment
you `add` it, then flips to its status with its conclusion once you commit. Clicking a node
opens its goal, conclusion, and notebook status. Offer to launch it when the user wants to
watch the exploration unfold (especially in auto mode); it's a read-only viewer over the log,
so leave it running in the background while you drive the loop. It runs until stopped (Ctrl-C).

## Mode: step (default) vs auto

Ask the user which mode, or infer from their request.

- **Step** — you drive one node per turn with the human in the loop. Get approval at
  **Propose** (step 2) before creating, and surface the result after **Commit** (step 6)
  before continuing. The human decides where to go next; you execute and record.
- **Auto** — you run the loop yourself without waiting. You still obey every step; you just
  make the Propose decision using judgment over the frontier instead of asking. Bounded by:
  - **Stop** on the first of: the `objective.md` success criteria are met; the frontier is
    empty (no `open`/`promising` nodes); or you hit the **max-nodes** budget (default 12,
    ask the user to override).
  - **Checkpoint** every **10** nodes and at every stop: show the tree and pause for the
    human to redirect or continue.
  - **Sequential** by default. You may **expand siblings in parallel** only for genuinely
    independent hypotheses, capped small — the single-writer log makes concurrent subagents
    safe, but you still commit each result yourself, one at a time.

The `max-nodes` budget is the non-negotiable backstop: honor it even if you believe the
objective is nearly met.

## Frontier judgment

You choose the next expansion by reasoning over the frontier, not by computing scores. Favor
`promising` nodes with an open thread; prune (`dead-end`) branches that stop paying off and
say why in their conclusion; mark a branch `answered` when its local question is settled.
The value of this skill is that a reader can **remount** the tree later and see the whole
reasoning — so always record the *why*, not just the *what*.
