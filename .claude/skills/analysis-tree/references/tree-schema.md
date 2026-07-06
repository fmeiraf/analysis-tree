# tree.jsonl — schema & mechanics

`tree.jsonl` is the source of truth for the exploration's **structure and metadata**. Node
folders own the **content**. The file is **append-only**: every mutation is a new line;
remounting replays the file and takes the **last line per `id`** as its current state, then
drops any `id` whose latest line is a tombstone (`deleted: true`). This gives full history
for free — you can see that a branch was explored and later abandoned.

Do not hand-edit `tree.jsonl`. All writes go through the CLI, and only the **master** writes
it (single-writer), so parallel node subagents can never corrupt or race it.

## One line = one node event

| field | type | meaning |
|---|---|---|
| `id` | string | `node_<seq>_<slug>` — also the folder name under `nodes/` |
| `parent_id` | string \| null | parent's id (`null` only for the root) |
| `seq` | number | monotonic creation counter (root = 0) |
| `type` | string | node type defined in `node.md` (e.g. `analysis`) |
| `goal` | string | one-line goal (full version lives in the folder's `goal.md`) |
| `status` | enum | `open` \| `promising` \| `dead-end` \| `answered` |
| `conclusion` | string | short summary (full version in `conclusion.md`) |
| `created_by` | string | `master` or `auto` (which mode created the node) |
| `notebook_ok` | bool \| null | did the notebook pass clean; `null` if no notebook |
| `deleted` | bool? | tombstone flag; present only on deletion lines |
| `ts` | string? | optional wall-clock stamp; omitted by default |

## Status meanings (the frontier)

- `open` — created, not yet resolved. On the frontier.
- `promising` — resolved and worth expanding further. On the frontier.
- `dead-end` — resolved, not worth expanding (pruned). Off the frontier.
- `answered` — resolved and its local question is settled. Off the frontier.

The **frontier** is every `open` or `promising` node — the set the master chooses its next
expansion from.

## Id naming

`id = node_<seq>_<slug>`. `seq` is birth order; `slug` is a short kebab summary of the goal.
The name records *when the node was born*, not *where it sits* — reparenting changes
`parent_id` but never the name.
