# node.md — the node contract for this exploration

This file defines what each **type** of node must contain to count as *done*. The master
reads it as the source of truth every run and validates a node against it before appending
its `tree.jsonl` line. **Edit this file** to add types or change what a node requires — it is
yours to configure per exploration.

Each type lists `required_files` (must exist in the node's folder) and `validate` (the
checkable condition that makes the node done). A node is not done until every required file
exists and every validate condition passes.

---

## type: root

The single node that frames the whole exploration. Created by `init`.

- required_files:
  - `goal.md` — the overall question, restated from `objective.md`.
- validate:
  - `goal.md` is non-empty.

## type: analysis

The default working node: does computation in a notebook.

- required_files:
  - `goal.md` — background, why this branch is worth exploring, and the approach.
  - `notebook.ipynb` — the analysis, executed top to bottom.
  - `conclusion.md` — what was found, whether it worked, and where to go next.
- validate:
  - `notebook.ipynb` runs clean: `node tree.js check-notebook <id>` exits 0 (every code
    cell executed, zero `error` outputs). This sets `notebook_ok = true`.
  - `conclusion.md` states a finding and a recommended next step (or marks the branch a
    dead-end).

## type: synthesis

A reasoning node that combines the conclusions of other nodes; no computation of its own.

- required_files:
  - `goal.md` — which nodes it synthesizes and the question it answers.
  - `conclusion.md` — the combined finding.
- validate:
  - `conclusion.md` references the ids of the nodes it draws on.
  - no `notebook.ipynb` is required; `notebook_ok` stays `null`.

---

## Adding a type

Copy a block, rename `type:`, and adjust `required_files` / `validate`. Keep every validate
condition **checkable** — a condition the master can verify by reading a file or running a
CLI command, not a matter of taste. That checkability is what stops a node being declared
done prematurely.
