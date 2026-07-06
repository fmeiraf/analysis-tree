# analysis-tree

A [Claude Code](https://claude.com/claude-code) **skill** for running iterative
data-science / data-exploration work as a **remountable tree of nodes**.

Each **node** is a self-contained bundle of assets pursuing one goal (a `goal.md`, an
executed `notebook.ipynb`, a `conclusion.md`). The **tree** records how the analysis
branched, what each branch concluded, and where it went next — and can be **remounted** from
its metadata (`tree.jsonl`) at any point, so you never lose the thread of *why* an
exploration went where it did. It's analysis organized as a tree search: an explicit
frontier, an objective as the north star, and a durable record of every branch pursued or
pruned.

A **master** agent proposes nodes, reasons over the frontier, and dispatches each node to a
**subagent** to execute; it is the single writer of the tree's log. You can run it
**step-by-step** (human in the loop, the default) or in **auto** mode (the master drives the
search itself).

## Install

Into the current repo's `.claude/skills/`:

```bash
curl -fsSL https://raw.githubusercontent.com/fmeiraf/analysis-tree/master/install.sh | bash
```

Into your user-level skills (available in all your projects):

```bash
curl -fsSL https://raw.githubusercontent.com/fmeiraf/analysis-tree/master/install.sh | bash -s -- --user
```

Or from a clone:

```bash
git clone https://github.com/fmeiraf/analysis-tree.git
cd your-project
/path/to/analysis-tree/install.sh          # or --user, or --dest DIR
```

The installer copies only the skill into `.claude/skills/analysis-tree/` and verifies the
CLI runs.

## Requirements

- **Node.js** — runs the bundled, zero-dependency `tree.js` CLI (`node cli/tree.js`).
- **A notebook executor** for `analysis` nodes — the `execute-notebooks` skill if you have
  it, otherwise `jupyter nbconvert`, `papermill`, or `nbclient`
  (`pip install nbclient nbformat`).

## Usage

Open your project in Claude Code and invoke the **analysis-tree** skill (it's user-invoked —
type its name). It will:

1. Interview you to write an `objective.md` (the question, success criteria, constraints).
2. Scaffold a self-contained workspace at `explorations/<slug>/`.
3. Propose and execute nodes, one branch at a time, validating each notebook runs clean
   before recording it.

Inspect the tree any time with the CLI from inside a workspace:

```bash
node tree.js show --full     # the tree, with conclusions and the live frontier
node tree.js path <node-id>  # the root -> node reasoning chain
node tree.js                 # all commands
```

## How it works

- `tree.jsonl` — append-only source of truth for **structure + metadata** (parentage,
  status, conclusions). Remount = replay, last-line-wins per node.
- `nodes/<id>/` — each node's **content** (goal, notebook, conclusion).
- `node.md` — the **configurable contract** for what each node type must contain; the master
  validates against it before a node counts as done.
