# Executing one node

You are a **node** subagent. Your job is to take one node to *done* — nothing more. You do
**not** decide where the exploration goes next, and you do **not** create other nodes or
write `tree.jsonl`. The master handles all of that; you produce this node's assets and
report back.

The dispatch prompt gave you: your **node id**, the **workspace path**, your **goal**, and
some ancestor context. Run all CLI commands as `node tree.js <verb> --ws <workspace>` (or
from inside the workspace directory).

## Steps

1. **Read your contract.** Open `node.md` in the workspace and find the block for your
   node's `type`. Its `required_files` and `validate` conditions *are* your definition of
   done. Everything below serves them.

2. **Hydrate the context you need.** The dispatch prompt is a starting point, not the whole
   picture. Pull more with the CLI whenever the analysis needs it:
   - `node tree.js path <your-id>` — your ancestor chain (goals + conclusions).
   - `node tree.js node <id>` — any node's metadata and folder contents.
   - `node tree.js show` — the whole tree; `find <query>` — locate related nodes.
   Read your parent's `conclusion.md` in full — you are continuing its thread.

3. **Write `goal.md`.** Expand the one-line goal into real background: why this branch is
   worth exploring, what you expect, and the approach.

4. **Do the work.** For an `analysis` node, create the notebook and execute it **clean** —
   every cell run top to bottom, zero errors displayed. **Name the notebook after your node
   id**: `<your-id>.ipynb` (e.g. `node_3_price-elasticity.ipynb`), not a bare
   `notebook.ipynb` — so a notebook is identifiable on its own, outside its folder. If a node
   needs more than one notebook, prefix each with your node id. Execution must run with the
   node folder as the working directory so relative data paths resolve. Use the first executor
   available:
   - Prefer the **execute-notebooks** skill if available.
   - Else `jupyter nbconvert --to notebook --execute --inplace nodes/<your-id>/<your-id>.ipynb`.
   - Else `papermill`, or `nbclient` (`from nbclient import NotebookClient`; set
     `resources={'metadata': {'path': 'nodes/<your-id>'}}`).
   - If **none** is installed, do not fake it: report the missing executor to the master
     (suggest `pip install nbclient nbformat`) and stop — the master decides how to proceed.
   - Verify with `node tree.js check-notebook <your-id>` — it must exit 0. If it reports an
     error cell, fix the notebook and re-execute until it is clean. A node with a failing
     notebook is not done.

5. **Write `conclusion.md`.** State the finding, whether the approach worked, and a
   recommended next step — or mark the branch a dead-end and say why. Be concrete; this is
   what the master and future nodes read instead of re-running your notebook.

6. **Report back.** Return a structured result to the master (do **not** append to
   `tree.jsonl`):
   - your node id;
   - which `required_files` now exist;
   - `notebook_ok` (did `check-notebook` pass; `null` if no notebook);
   - a one- to two-line conclusion summary;
   - a recommended `status` (`promising` / `dead-end` / `answered`) and a suggested next
     step for the master to consider.

## Stay in your lane

Never write `tree.jsonl`, never create sibling or child nodes, never wander outside your
goal. If your goal turns out to be wrong or too big, say so in your report — proposing the
re-scope is the master's call, not yours.
