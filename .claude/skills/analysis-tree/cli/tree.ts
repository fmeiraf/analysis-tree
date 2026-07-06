#!/usr/bin/env node
/**
 * tree.ts — the analysis-tree CLI.
 *
 * Deterministic toolkit over an exploration workspace. Zero external deps (Node builtins
 * only) so the bundled `tree.js` runs anywhere with `node tree.js <verb>`.
 *
 * Workspace = the directory containing this script (overridable with --ws <path>).
 * Layout: objective.md, node.md, tree.jsonl (append-only), nodes/<id>/, _deleted/<id>/.
 *
 * The jsonl is the source of truth for STRUCTURE + METADATA; node folders own CONTENT.
 * Every mutation is a new appended line; remount = replay, last-line-wins per id, drop
 * tombstoned (deleted) ids.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";

type Status = "open" | "promising" | "dead-end" | "answered";
const STATUSES: Status[] = ["open", "promising", "dead-end", "answered"];

interface Line {
  id: string;
  parent_id: string | null;
  seq: number;
  type: string;
  goal: string;
  status: Status;
  conclusion: string;
  created_by: string;
  notebook_ok: boolean | null;
  deleted?: boolean;
  ts?: string;
}

// ---------- workspace resolution ----------

function resolveWs(args: Record<string, string | boolean>): string {
  if (typeof args.ws === "string") return path.resolve(args.ws);
  // default: directory containing this script (workspace-local copy of tree.js)
  return __dirname;
}

const P = {
  jsonl: (ws: string) => path.join(ws, "tree.jsonl"),
  nodeMd: (ws: string) => path.join(ws, "node.md"),
  objective: (ws: string) => path.join(ws, "objective.md"),
  nodesDir: (ws: string) => path.join(ws, "nodes"),
  deletedDir: (ws: string) => path.join(ws, "_deleted"),
  nodeDir: (ws: string, id: string) => path.join(ws, "nodes", id),
};

// ---------- jsonl replay / remount ----------

function readLines(ws: string): Line[] {
  const f = P.jsonl(ws);
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l, i) => {
      try {
        return JSON.parse(l) as Line;
      } catch (e) {
        throw new Error(`Malformed tree.jsonl at line ${i + 1}: ${l}`);
      }
    });
}

/** Latest state per id (last line wins). Returns a Map preserving first-seen order. */
function remount(ws: string, opts: { includeDeleted?: boolean } = {}): Map<string, Line> {
  const latest = new Map<string, Line>();
  for (const ln of readLines(ws)) latest.set(ln.id, { ...(latest.get(ln.id) || {}), ...ln });
  if (!opts.includeDeleted) {
    for (const [id, ln] of [...latest]) if (ln.deleted) latest.delete(id);
  }
  return latest;
}

function nowTs(): string {
  return new Date().toISOString();
}

function appendLine(ws: string, line: Line): void {
  // Every appended line is stamped with wall-clock time unless the caller supplied one
  // explicitly (e.g. --ts for deterministic tests). Powers "updated N ago" in the dashboard.
  if (!line.ts) line.ts = nowTs();
  fs.appendFileSync(P.jsonl(ws), JSON.stringify(line) + "\n");
}

/** Merge current state of an id with a patch, and append the resulting full line. */
function mutate(ws: string, id: string, patch: Partial<Line>): Line {
  const cur = remount(ws, { includeDeleted: true }).get(id);
  if (!cur) throw new Error(`No such node: ${id}`);
  const next: Line = { ...cur, ...patch };
  // A mutation is a new event: refresh its stamp unless the patch pinned one explicitly.
  if (!("ts" in patch)) delete next.ts;
  appendLine(ws, next);
  return next;
}

// ---------- helpers ----------

function slugify(goal: string): string {
  const s = goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 6)
    .join("-");
  return s || "node";
}

function nextSeq(ws: string): number {
  const lines = remount(ws, { includeDeleted: true });
  let max = -1;
  for (const ln of lines.values()) if (ln.seq > max) max = ln.seq;
  return max + 1;
}

function childrenOf(all: Map<string, Line>, id: string): Line[] {
  return [...all.values()].filter((n) => n.parent_id === id).sort((a, b) => a.seq - b.seq);
}

function subtreeIds(all: Map<string, Line>, id: string): string[] {
  const out: string[] = [id];
  for (const c of childrenOf(all, id)) out.push(...subtreeIds(all, c.id));
  return out;
}

const GLYPH: Record<Status, string> = {
  open: "○",
  promising: "◐",
  "dead-end": "✗",
  answered: "●",
};

function die(msg: string): never {
  process.stderr.write("error: " + msg + "\n");
  process.exit(1);
}

function parseBool(v: string): boolean {
  if (v === "true") return true;
  if (v === "false") return false;
  die(`expected true|false, got: ${v}`);
}

// ---------- arg parsing ----------

function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const nxt = argv[i + 1];
      if (nxt !== undefined && !nxt.startsWith("--")) {
        flags[key] = nxt;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

// ---------- commands ----------

function cmdInit(ws: string, flags: Record<string, string | boolean>): void {
  const rootGoal = String(flags["root-goal"] || flags.goal || "");
  if (!rootGoal) die("init requires --root-goal <text>");
  fs.mkdirSync(P.nodesDir(ws), { recursive: true });
  fs.mkdirSync(P.deletedDir(ws), { recursive: true });
  if (!fs.existsSync(P.jsonl(ws))) fs.writeFileSync(P.jsonl(ws), "");
  if (remount(ws, { includeDeleted: true }).size > 0) die("workspace already initialized (tree.jsonl has nodes)");

  const id = "node_0_root";
  const dir = P.nodeDir(ws, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "goal.md"),
    `# Root goal\n\n${rootGoal}\n\n> The root frames the overall exploration. See \`objective.md\` for success criteria.\n`
  );
  const line: Line = {
    id,
    parent_id: null,
    seq: 0,
    type: String(flags.type || "root"),
    goal: rootGoal,
    status: "open",
    conclusion: "",
    created_by: String(flags["created-by"] || "master"),
    notebook_ok: null,
  };
  if (flags.ts) line.ts = String(flags.ts);
  appendLine(ws, line);
  process.stdout.write(id + "\n");
}

function cmdAdd(ws: string, flags: Record<string, string | boolean>): void {
  const parent = String(flags.parent || "");
  const goal = String(flags.goal || "");
  if (!parent) die("add requires --parent <id>");
  if (!goal) die("add requires --goal <text>");
  const all = remount(ws, { includeDeleted: true });
  if (!all.has(parent)) die(`no such parent: ${parent}`);

  const seq = nextSeq(ws);
  const id = `node_${seq}_${slugify(goal)}`;
  const dir = P.nodeDir(ws, id);
  if (fs.existsSync(dir)) die(`node folder already exists: ${id}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "goal.md"),
    `# Goal\n\n${goal}\n\n## Background\n\n_(the node subagent fills this in: context, why this branch, approach)_\n`
  );
  const line: Line = {
    id,
    parent_id: parent,
    seq,
    type: String(flags.type || "analysis"),
    goal,
    status: "open",
    conclusion: "",
    created_by: String(flags["created-by"] || "master"),
    notebook_ok: null,
  };
  if (flags.ts) line.ts = String(flags.ts);
  appendLine(ws, line);
  process.stdout.write(id + "\n");
}

function cmdSet(ws: string, positional: string[], flags: Record<string, string | boolean>): void {
  const id = positional[0];
  if (!id) die("set requires <id>");
  const patch: Partial<Line> = {};
  if (typeof flags.status === "string") {
    if (!STATUSES.includes(flags.status as Status)) die(`invalid status: ${flags.status} (${STATUSES.join("|")})`);
    patch.status = flags.status as Status;
  }
  if (typeof flags.conclusion === "string") patch.conclusion = flags.conclusion;
  if (typeof flags["notebook-ok"] === "string") patch.notebook_ok = parseBool(flags["notebook-ok"] as string);
  if (typeof flags.ts === "string") patch.ts = flags.ts;
  if (Object.keys(patch).length === 0) die("set requires at least one of --status --conclusion --notebook-ok");
  const next = mutate(ws, id, patch);
  process.stdout.write(`${next.id} -> status=${next.status} notebook_ok=${next.notebook_ok}\n`);
}

function cmdStatus(ws: string, positional: string[], flags: Record<string, string | boolean>): void {
  const id = positional[0];
  const status = positional[1];
  if (!id || !status) die("status requires <id> <status>");
  if (!STATUSES.includes(status as Status)) die(`invalid status: ${status} (${STATUSES.join("|")})`);
  const patch: Partial<Line> = { status: status as Status };
  if (typeof flags.ts === "string") patch.ts = flags.ts;
  const next = mutate(ws, id, patch);
  process.stdout.write(`${next.id} -> ${next.status}\n`);
}

function cmdReparent(ws: string, positional: string[], flags: Record<string, string | boolean>): void {
  const id = positional[0];
  const newParent = positional[1];
  if (!id || !newParent) die("reparent requires <id> <new_parent>");
  const all = remount(ws, { includeDeleted: true });
  if (!all.has(id)) die(`no such node: ${id}`);
  if (!all.has(newParent)) die(`no such new parent: ${newParent}`);
  if (id === newParent) die("cannot reparent a node onto itself");
  if (subtreeIds(all, id).includes(newParent)) die("cannot reparent a node under its own descendant (cycle)");
  const patch: Partial<Line> = { parent_id: newParent };
  if (typeof flags.ts === "string") patch.ts = flags.ts;
  mutate(ws, id, patch);
  process.stdout.write(`${id} -> parent ${newParent}\n`);
}

function cmdDelete(ws: string, positional: string[], flags: Record<string, string | boolean>): void {
  const id = positional[0];
  if (!id) die("delete requires <id>");
  const all = remount(ws, { includeDeleted: true });
  const node = all.get(id);
  if (!node || node.deleted) die(`no such (live) node: ${id}`);
  if (id === "node_0_root") die("cannot delete the root node");

  const kids = childrenOf(all, id).filter((k) => !k.deleted);
  const cascade = !!flags.cascade;
  const reparent = !!flags.reparent;
  const purge = !!flags.purge;

  if (kids.length > 0 && !cascade && !reparent) {
    die(
      `node has ${kids.length} live child(ren); pass --cascade to delete the subtree or --reparent to lift them to ${node.parent_id}`
    );
  }

  let toTombstone: string[];
  if (reparent) {
    for (const k of kids) mutate(ws, k.id, { parent_id: node.parent_id });
    toTombstone = [id];
  } else if (cascade) {
    toTombstone = subtreeIds(all, id).filter((x) => !all.get(x)!.deleted);
  } else {
    toTombstone = [id];
  }

  for (const tid of toTombstone) {
    mutate(ws, tid, { deleted: true });
    const src = P.nodeDir(ws, tid);
    if (fs.existsSync(src)) {
      if (purge) {
        fs.rmSync(src, { recursive: true, force: true });
      } else {
        fs.mkdirSync(P.deletedDir(ws), { recursive: true });
        const dst = path.join(P.deletedDir(ws), tid);
        fs.rmSync(dst, { recursive: true, force: true });
        fs.renameSync(src, dst);
      }
    }
  }
  process.stdout.write(`deleted ${toTombstone.length} node(s): ${toTombstone.join(", ")}${purge ? " (purged)" : " (archived)"}\n`);
}

function renderTree(
  all: Map<string, Line>,
  full: boolean,
  statusFilter: string | undefined,
  highlightPath: Set<string>
): string {
  const roots = [...all.values()].filter((n) => n.parent_id === null).sort((a, b) => a.seq - b.seq);
  const out: string[] = [];
  const walk = (node: Line, prefix: string, isLast: boolean, isRoot: boolean) => {
    const branch = isRoot ? "" : isLast ? "└─ " : "├─ ";
    const mark = highlightPath.has(node.id) ? " «" : "";
    const adopted = node.created_by === "adopt" ? "  [adopted]" : "";
    const line = `${prefix}${branch}${GLYPH[node.status]} ${node.id}  ${node.goal}${adopted}${mark}`;
    if (!statusFilter || node.status === statusFilter) out.push(line);
    if (full && node.conclusion) {
      const cprefix = prefix + (isRoot ? "   " : isLast ? "    " : "│   ");
      out.push(`${cprefix}↳ ${node.conclusion}`);
    }
    const kids = childrenOf(all, node.id);
    kids.forEach((k, i) => {
      const childPrefix = prefix + (isRoot ? "" : isLast ? "    " : "│   ");
      walk(k, childPrefix, i === kids.length - 1, false);
    });
  };
  roots.forEach((r) => walk(r, "", true, true));
  return out.join("\n");
}

function cmdShow(ws: string, flags: Record<string, string | boolean>): void {
  const all = remount(ws);
  if (all.size === 0) {
    process.stdout.write("(empty tree — run init)\n");
    return;
  }
  const highlight = new Set<string>();
  if (typeof flags.path === "string") {
    let cur: Line | undefined = all.get(flags.path);
    while (cur) {
      highlight.add(cur.id);
      cur = cur.parent_id ? all.get(cur.parent_id) : undefined;
    }
  }
  const statusFilter = typeof flags.status === "string" ? flags.status : undefined;
  process.stdout.write(renderTree(all, !!flags.full, statusFilter, highlight) + "\n");

  // frontier summary
  const frontier = [...all.values()].filter((n) => n.status === "open" || n.status === "promising");
  process.stdout.write(
    `\nlegend: ${GLYPH.open} open  ${GLYPH.promising} promising  ${GLYPH["dead-end"]} dead-end  ${GLYPH.answered} answered\n`
  );
  process.stdout.write(`frontier (${frontier.length}): ${frontier.map((n) => n.id).join(", ") || "—"}\n`);
}

function cmdPath(ws: string, positional: string[]): void {
  const id = positional[0];
  if (!id) die("path requires <id>");
  const all = remount(ws, { includeDeleted: true });
  const chain: Line[] = [];
  let cur: Line | undefined = all.get(id);
  if (!cur) die(`no such node: ${id}`);
  while (cur) {
    chain.unshift(cur);
    cur = cur.parent_id ? all.get(cur.parent_id) : undefined;
  }
  for (const n of chain) {
    process.stdout.write(`${GLYPH[n.status]} ${n.id}  [${n.status}]\n    goal: ${n.goal}\n`);
    if (n.conclusion) process.stdout.write(`    conclusion: ${n.conclusion}\n`);
  }
}

function cmdNode(ws: string, positional: string[]): void {
  const id = positional[0];
  if (!id) die("node requires <id>");
  const all = remount(ws, { includeDeleted: true });
  const n = all.get(id);
  if (!n) die(`no such node: ${id}`);
  process.stdout.write(JSON.stringify(n, null, 2) + "\n");
  const dir = P.nodeDir(ws, id);
  if (fs.existsSync(dir)) {
    process.stdout.write(`\nfolder: nodes/${id}/\n`);
    for (const f of fs.readdirSync(dir)) process.stdout.write(`  - ${f}\n`);
  } else {
    process.stdout.write(`\n(no folder on disk${n.deleted ? " — archived under _deleted/" : ""})\n`);
  }
}

function cmdChildren(ws: string, positional: string[]): void {
  const id = positional[0];
  if (!id) die("children requires <id>");
  const all = remount(ws);
  if (!all.has(id)) die(`no such node: ${id}`);
  const kids = childrenOf(all, id);
  if (kids.length === 0) {
    process.stdout.write("(no children)\n");
    return;
  }
  for (const k of kids) process.stdout.write(`${GLYPH[k.status]} ${k.id}  [${k.status}]  ${k.goal}\n`);
}

function cmdFind(ws: string, positional: string[]): void {
  const q = positional.join(" ").toLowerCase();
  if (!q) die("find requires <query>");
  const all = remount(ws);
  const hits = [...all.values()].filter(
    (n) =>
      n.id.toLowerCase().includes(q) ||
      n.goal.toLowerCase().includes(q) ||
      n.conclusion.toLowerCase().includes(q) ||
      n.status === q ||
      n.type.toLowerCase() === q
  );
  if (hits.length === 0) {
    process.stdout.write("(no matches)\n");
    return;
  }
  for (const n of hits.sort((a, b) => a.seq - b.seq))
    process.stdout.write(`${GLYPH[n.status]} ${n.id}  [${n.status}]  ${n.goal}\n`);
}

/** Scan an executed notebook for error outputs / unexecuted cells. Exit 1 if not clean. */
function cmdCheckNotebook(ws: string, positional: string[], flags: Record<string, string | boolean>): void {
  const id = positional[0];
  if (!id) die("check-notebook requires <id>");
  const nbName = typeof flags.file === "string" ? flags.file : "notebook.ipynb";
  const nbPath = path.join(P.nodeDir(ws, id), nbName);
  if (!fs.existsSync(nbPath)) die(`notebook not found: nodes/${id}/${nbName}`);
  let nb: any;
  try {
    nb = JSON.parse(fs.readFileSync(nbPath, "utf8"));
  } catch (e) {
    die(`notebook is not valid JSON: ${nbPath}`);
  }
  const cells: any[] = nb.cells || [];
  const problems: string[] = [];
  cells.forEach((cell, i) => {
    if (cell.cell_type !== "code") return;
    const src = Array.isArray(cell.source) ? cell.source.join("") : cell.source || "";
    if (src.trim() === "") return;
    if (cell.execution_count == null) problems.push(`cell ${i}: not executed (execution_count is null)`);
    for (const out of cell.outputs || []) {
      if (out.output_type === "error") {
        problems.push(`cell ${i}: error output — ${out.ename || ""}: ${out.evalue || ""}`);
      }
    }
  });
  if (problems.length > 0) {
    process.stderr.write(`NOT CLEAN — ${problems.length} problem(s):\n`);
    for (const p of problems) process.stderr.write("  - " + p + "\n");
    process.exit(1);
  }
  const nCode = cells.filter((c) => c.cell_type === "code").length;
  process.stdout.write(`clean: ${nCode} code cell(s) executed, zero error outputs\n`);
}

// ---------- serve: live html dashboard ----------

/** Flat, sorted, live-state node list for the dashboard API. */
function treeSnapshot(ws: string): Line[] {
  return [...remount(ws).values()].sort((a, b) => a.seq - b.seq);
}

function readIfExists(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

/** Node folder content for the detail panel. */
function nodeDetail(ws: string, id: string): any {
  const all = remount(ws, { includeDeleted: true });
  const meta = all.get(id);
  if (!meta) return null;
  const dir = P.nodeDir(ws, id);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  return {
    meta,
    files,
    goal: readIfExists(path.join(dir, "goal.md")),
    conclusion: readIfExists(path.join(dir, "conclusion.md")),
  };
}

// Self-contained dashboard page (no external assets — inlined so the copied-in tree.js
// serves it offline). Client JS avoids template literals to keep this a clean TS literal.
const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>analysis-tree · observatory</title>
<style>
  :root {
    --field: oklch(0.15 0.018 250);
    --field-lift: oklch(0.185 0.02 250);
    --hairline: oklch(0.30 0.02 250);
    --edge: oklch(0.34 0.02 250);
    --ink: oklch(0.92 0.008 250);
    --ink-dim: oklch(0.64 0.015 250);
    --frontier: oklch(0.86 0.19 130);
    --frontier-core: oklch(0.93 0.15 130);
    --open: oklch(0.70 0.09 130);
    --answered: oklch(0.70 0.04 210);
    --dead: oklch(0.44 0.006 250);
    --adopted: oklch(0.72 0.13 305);
    --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
    --ease: cubic-bezier(0.22, 1, 0.36, 1);
    --z-drawer: 40;
    --z-hud: 20;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    font: 400 13px/1.5 var(--mono);
    background: var(--field);
    color: var(--ink);
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    /* faint deep-field vignette so the center reads as depth, not a flat wall */
    background-image: radial-gradient(120% 120% at 50% 42%, oklch(0.185 0.02 255) 0%, var(--field) 55%, oklch(0.12 0.016 250) 100%);
  }

  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 16px;
    height: 44px;
    flex: none;
    border-bottom: 1px solid var(--hairline);
    background: color-mix(in oklch, var(--field) 82%, transparent);
    backdrop-filter: blur(6px);
    z-index: var(--z-hud);
  }
  .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--dead);
    flex: none;
    transition: background 0.3s var(--ease), box-shadow 0.3s var(--ease);
  }
  .dot.live {
    background: var(--frontier);
    box-shadow: 0 0 0 3px color-mix(in oklch, var(--frontier) 22%, transparent),
                0 0 10px color-mix(in oklch, var(--frontier) 55%, transparent);
  }
  .brand { font-weight: 600; letter-spacing: 0.01em; color: var(--ink); flex: none; }
  .obj {
    color: var(--ink-dim);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    flex: 1; min-width: 0;
  }
  .stamp { color: var(--ink-dim); font-size: 11px; flex: none; }

  main { position: relative; flex: 1; min-height: 0; }
  #sky { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; }
  #sky.dragging { cursor: grabbing; }

  /* ---- edges ---- */
  .edge { fill: none; stroke: var(--edge); stroke-width: 1.1; opacity: 0.7; stroke-linejoin: round; stroke-linecap: round; }
  .edge.to-frontier {
    stroke: color-mix(in oklch, var(--frontier) 55%, var(--edge));
    opacity: 0.85;
  }

  /* ---- nodes ---- */
  .node { cursor: pointer; }
  .node .hit { fill: transparent; }
  .node .glyph {
    font-family: var(--mono);
    font-size: 19px;
    font-weight: 500;
    fill: var(--ink-dim);
    transition: fill 0.35s var(--ease);
    -webkit-user-select: none; user-select: none;
  }
  .node .label {
    font-family: var(--mono);
    font-size: 12px;
    fill: var(--ink-dim);
    opacity: 0.55; /* every step stays readable — that's the point of the tree view */
    transition: opacity 0.25s var(--ease), fill 0.25s var(--ease);
    -webkit-user-select: none; user-select: none;
    pointer-events: none;
    paint-order: stroke;
    stroke: color-mix(in oklch, var(--field) 80%, transparent);
    stroke-width: 3.5px;
  }
  .node.labeled .label,
  .node:hover .label,
  .node.sel .label,
  #sky.zoomed .node .label { opacity: 1; }

  /* status kinds — glyph shape carries state, color/glow reinforce */
  .k-dead .glyph { fill: var(--dead); }
  .k-dead .label { fill: var(--dead); text-decoration: line-through; }
  .k-answered .glyph { fill: var(--answered); }
  .k-answered .label { fill: color-mix(in oklch, var(--answered) 75%, var(--ink)); }
  .k-open .glyph { fill: var(--open); }
  .k-promising .glyph { fill: var(--frontier); }
  .k-working .glyph { fill: var(--frontier-core); }
  .node.labeled.k-promising .label,
  .node.labeled.k-working .label { fill: color-mix(in oklch, var(--frontier) 82%, var(--ink)); }

  /* glow: state through light, not chrome */
  .node.glow .glyph { filter: drop-shadow(0 0 5px color-mix(in oklch, var(--frontier) 65%, transparent)); }
  .node.k-working .glyph {
    filter: drop-shadow(0 0 7px color-mix(in oklch, var(--frontier) 78%, transparent));
    animation: breathe 2.4s var(--ease) infinite;
  }
  @keyframes breathe {
    0%, 100% { opacity: 0.72; }
    50%      { opacity: 1; }
  }

  /* adopted provenance — violet ring, distinct hue from phosphor */
  .node.adopt .adopt-ring {
    fill: none;
    stroke: var(--adopted);
    stroke-width: 1;
    stroke-dasharray: 2 3;
    opacity: 0.85;
  }

  /* selection + keyboard focus */
  .node .sel-ring { fill: none; stroke: var(--frontier); stroke-width: 1.25; opacity: 0; transition: opacity 0.2s var(--ease); }
  .node.sel .sel-ring { opacity: 0.9; }
  .node:focus-visible { outline: none; }
  .node:focus-visible .sel-ring { opacity: 0.9; stroke: var(--frontier-core); }

  /* entrance of freshly-added nodes */
  .node.enter { animation: appear 0.5s var(--ease) both; }
  @keyframes appear {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  /* ---- HUD: controls + legend ---- */
  .hud { position: absolute; z-index: var(--z-hud); display: flex; gap: 6px; }
  .controls { right: 14px; bottom: 14px; flex-direction: column; }
  .controls button {
    font: 500 12px/1 var(--mono);
    color: var(--ink-dim);
    background: color-mix(in oklch, var(--field-lift) 88%, transparent);
    border: 1px solid var(--hairline);
    border-radius: 3px;
    padding: 7px 9px;
    min-width: 34px;
    cursor: pointer;
    backdrop-filter: blur(6px);
    transition: color 0.2s var(--ease), border-color 0.2s var(--ease), background 0.2s var(--ease);
  }
  .controls button:hover { color: var(--frontier); border-color: color-mix(in oklch, var(--frontier) 40%, var(--hairline)); }
  .controls button:focus-visible { outline: 2px solid var(--frontier); outline-offset: 2px; }
  .controls button:active { background: color-mix(in oklch, var(--field-lift) 70%, transparent); }

  .legend { left: 14px; bottom: 14px; }
  .legend > details {
    background: color-mix(in oklch, var(--field-lift) 88%, transparent);
    border: 1px solid var(--hairline);
    border-radius: 3px;
    backdrop-filter: blur(6px);
    font-size: 11px;
    color: var(--ink-dim);
    min-width: 130px;
  }
  .legend summary {
    list-style: none; cursor: pointer; padding: 7px 10px;
    letter-spacing: 0.04em; text-transform: lowercase; color: var(--ink-dim);
  }
  .legend summary::-webkit-details-marker { display: none; }
  .legend summary:hover { color: var(--ink); }
  .legend .rows { padding: 2px 10px 9px; display: grid; gap: 4px; }
  .legend .row { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
  .legend .g { width: 12px; text-align: center; font-size: 13px; }
  .legend .g.working { color: var(--frontier-core); }
  .legend .g.promising { color: var(--frontier); }
  .legend .g.open { color: var(--open); }
  .legend .g.answered { color: var(--answered); }
  .legend .g.dead { color: var(--dead); }
  .legend .g.adopt { color: var(--adopted); }

  /* ---- empty state ---- */
  #empty {
    position: absolute; inset: 0; display: none;
    align-items: center; justify-content: center; flex-direction: column; gap: 10px;
    color: var(--ink-dim); pointer-events: none; text-align: center;
  }
  #empty.show { display: flex; }
  #empty .glyph { font-size: 22px; color: var(--open); filter: drop-shadow(0 0 8px color-mix(in oklch, var(--frontier) 40%, transparent)); animation: breathe 2.8s var(--ease) infinite; }
  #empty .msg { font-size: 12px; letter-spacing: 0.02em; }

  /* ---- detail drawer ---- */
  dialog#drawer {
    position: fixed;
    inset: 0 0 0 auto;
    height: 100%;
    width: min(440px, 92vw);
    max-height: 100%;
    margin: 0;
    padding: 0;
    border: none;
    border-left: 1px solid var(--hairline);
    background: var(--field-lift);
    color: var(--ink);
    box-shadow: -24px 0 60px -30px oklch(0 0 0 / 0.7);
    overflow: auto;
    z-index: var(--z-drawer);
  }
  dialog#drawer::backdrop { background: oklch(0.1 0.01 250 / 0.32); backdrop-filter: blur(1px); }
  dialog#drawer[open] { animation: drawer-in 0.28s var(--ease); }
  @keyframes drawer-in { from { transform: translateX(18px); opacity: 0; } to { transform: none; opacity: 1; } }

  .d-pad { padding: 18px 20px 28px; }
  .d-top { display: flex; align-items: center; gap: 9px; margin-bottom: 4px; }
  .d-top .glyph { font-size: 16px; }
  .d-top .glyph.k-working, .d-top .glyph.k-promising { color: var(--frontier); }
  .d-top .glyph.k-open { color: var(--open); }
  .d-top .glyph.k-answered { color: var(--answered); }
  .d-top .glyph.k-dead { color: var(--dead); }
  .d-id { font-size: 13px; font-weight: 600; color: var(--ink); overflow-wrap: anywhere; }
  .d-close {
    margin-left: auto; flex: none;
    background: none; border: 1px solid var(--hairline); color: var(--ink-dim);
    border-radius: 3px; width: 26px; height: 26px; cursor: pointer; font-size: 14px; line-height: 1;
    transition: color 0.2s var(--ease), border-color 0.2s var(--ease);
  }
  .d-close:hover { color: var(--ink); border-color: var(--ink-dim); }
  .d-close:focus-visible { outline: 2px solid var(--frontier); outline-offset: 2px; }
  .d-badges { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 18px; }
  .badge {
    font-size: 11px; padding: 2px 9px; border-radius: 999px;
    border: 1px solid var(--hairline); color: var(--ink-dim); white-space: nowrap;
  }
  .badge.status { color: var(--ink); border-color: color-mix(in oklch, var(--ink-dim) 60%, var(--hairline)); }
  .badge.status.working, .badge.status.promising { color: var(--frontier); border-color: color-mix(in oklch, var(--frontier) 45%, var(--hairline)); }
  .badge.status.answered { color: var(--answered); border-color: color-mix(in oklch, var(--answered) 45%, var(--hairline)); }
  .badge.status.dead { color: var(--dead); }
  .badge.nb-ok { color: var(--frontier); border-color: color-mix(in oklch, var(--frontier) 45%, var(--hairline)); }
  .badge.nb-bad { color: oklch(0.7 0.16 25); border-color: color-mix(in oklch, oklch(0.7 0.16 25) 45%, var(--hairline)); }
  .badge.adopt { color: var(--adopted); border-color: color-mix(in oklch, var(--adopted) 45%, var(--hairline)); }
  .d-meta { color: var(--ink-dim); font-size: 11px; margin-bottom: 20px; }
  .d-sec { margin: 18px 0; }
  .d-sec h3 { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-dim); margin: 0 0 7px; font-weight: 600; }
  .md { font-size: 12.5px; line-height: 1.6; color: var(--ink); overflow-wrap: anywhere; }
  .md :first-child { margin-top: 0; }
  .md :last-child { margin-bottom: 0; }
  .md h1, .md h2, .md h3 { font-size: 13px; margin: 12px 0 4px; color: var(--ink); }
  .md p { margin: 6px 0; }
  .md code { background: color-mix(in oklch, var(--field) 60%, transparent); padding: 1px 5px; border-radius: 3px; font-size: 11.5px; }
  .md pre { background: var(--field); padding: 10px 12px; border-radius: 5px; overflow: auto; border: 1px solid var(--hairline); }
  .md pre code { background: none; padding: 0; }
  .md ul { margin: 6px 0; padding-left: 18px; }
  .md li { margin: 2px 0; }
  .md a { color: var(--frontier); }
  .none { color: var(--ink-dim); font-style: normal; opacity: 0.7; }
  .files { display: flex; flex-wrap: wrap; gap: 6px 14px; }
  .files a { color: var(--frontier); text-decoration: none; font-size: 12px; }
  .files a:hover { text-decoration: underline; }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; }
    .node.k-working .glyph { opacity: 0.92; }
  }
</style>
</head>
<body>
<header>
  <span class="dot" id="dot" title="live connection"></span>
  <span class="brand">analysis-tree</span>
  <span class="obj" id="obj"></span>
  <span class="stamp" id="stamp"></span>
</header>
<main>
  <svg id="sky" role="tree" aria-label="analysis tree constellation">
    <g id="viewport">
      <g id="edges"></g>
      <g id="nodes"></g>
    </g>
  </svg>

  <div id="empty">
    <div class="glyph">○</div>
    <div class="msg">waiting for the first node…</div>
  </div>

  <div class="hud legend">
    <details>
      <summary>legend</summary>
      <div class="rows">
        <div class="row"><span class="g working">◐</span> working</div>
        <div class="row"><span class="g promising">●</span> promising</div>
        <div class="row"><span class="g open">○</span> open</div>
        <div class="row"><span class="g answered">✓</span> answered</div>
        <div class="row"><span class="g dead">✗</span> dead-end</div>
        <div class="row"><span class="g adopt">◌</span> adopted</div>
      </div>
    </details>
  </div>

  <div class="hud controls">
    <button id="c-fit" title="Zoom to fit (F)">fit</button>
    <button id="c-front" title="Recenter on frontier (C)">◉</button>
    <button id="c-in" title="Zoom in (+)" aria-label="zoom in">+</button>
    <button id="c-out" title="Zoom out (−)" aria-label="zoom out">−</button>
  </div>
</main>

<dialog id="drawer" aria-label="node detail"></dialog>

<script>
"use strict";
const els = {
  sky: document.getElementById("sky"),
  vp: document.getElementById("viewport"),
  edges: document.getElementById("edges"),
  nodes: document.getElementById("nodes"),
  empty: document.getElementById("empty"),
  dot: document.getElementById("dot"),
  obj: document.getElementById("obj"),
  stamp: document.getElementById("stamp"),
  drawer: document.getElementById("drawer"),
};
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const LEVEL_GAP = 96;   // vertical distance between tree depths
const LEAF_GAP = 158;   // horizontal distance between adjacent leaves
const GLYPH_R = 11;     // glyph radius, used to inset connectors
const ZOOM_LABEL_THRESHOLD = 1.35;

const state = {
  nodes: [],
  layout: { byId: new Map(), kids: new Map(), roots: [], pos: new Map() },
  known: new Set(),
  selected: null,
  view: { tx: 0, ty: 0, s: 1 },
  lastEvent: 0,
  firstLoad: true,
  raf: 0,
  returnFocusId: null,
};

/* ---------- helpers ---------- */
function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function shortId(id) {
  if (id === "node_0_root") return "root";
  return id.replace(/^node_\\d+_/, "") || id;
}
function agoLabel(ts) {
  if (!ts) return "";
  const d = Date.now() - Date.parse(ts);
  if (isNaN(d)) return "";
  const s = Math.round(d / 1000);
  if (s < 5) return "just now";
  if (s < 60) return s + "s ago";
  const m = Math.round(s / 60); if (m < 60) return m + "m ago";
  const h = Math.round(m / 60); if (h < 24) return h + "h ago";
  return Math.round(h / 24) + "d ago";
}
function statusKind(n) {
  if (!n.parent_id) return "open"; // root is a calm anchor, never a pulsing "working" node
  if (n.status === "dead-end") return "dead";
  if (n.status === "answered") return "answered";
  if (n.status === "promising") return "promising";
  if (n.status === "open" && !n.conclusion) return "working";
  return "open";
}
function glyphChar(n) {
  const k = statusKind(n);
  return k === "promising" ? "●" : k === "answered" ? "✓" : k === "dead" ? "✗" : k === "working" ? "◐" : "○";
}
function isFrontier(n) { return n.status === "open" || n.status === "promising"; }

/* ---------- layout: vertical tidy tree (top-down) ---------- */
// Leaves are packed left-to-right into equal slots; each parent centers over
// its children. Subtrees occupy contiguous slot ranges, so nothing overlaps.
function computeLayout(nodes) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const kids = new Map();
  const roots = [];
  for (const n of nodes) {
    if (n.parent_id && byId.has(n.parent_id)) {
      if (!kids.has(n.parent_id)) kids.set(n.parent_id, []);
      kids.get(n.parent_id).push(n);
    } else {
      roots.push(n);
    }
  }
  for (const arr of kids.values()) arr.sort((a, b) => a.seq - b.seq);
  roots.sort((a, b) => a.seq - b.seq);

  const depth = new Map();
  const xOf = new Map();
  const seen = new Set();
  let cursor = 0;
  function walk(n, d) {
    if (seen.has(n.id)) return xOf.get(n.id) || 0; // guard against cycles
    seen.add(n.id);
    depth.set(n.id, d);
    const ch = kids.get(n.id) || [];
    let x;
    if (ch.length === 0) {
      x = cursor * LEAF_GAP;
      cursor++;
    } else {
      const xs = ch.map(c => walk(c, d + 1));
      x = (xs[0] + xs[xs.length - 1]) / 2;
    }
    xOf.set(n.id, x);
    return x;
  }
  for (const r of roots) { walk(r, 0); cursor++; } // gap between separate roots

  const pos = new Map();
  for (const n of nodes) {
    const d = depth.get(n.id) || 0;
    pos.set(n.id, { x: xOf.get(n.id) || 0, y: d * LEVEL_GAP, d });
  }
  return { byId, kids, roots, pos };
}

// Orthogonal flowchart connector: down from the parent, a rounded elbow at the
// midline, across to the child's column, then down into the child.
function edgePath(p, c) {
  const py = p.y + GLYPH_R, cy = c.y - GLYPH_R;
  const midY = (py + cy) / 2;
  if (Math.abs(c.x - p.x) < 0.5) {
    return "M" + p.x.toFixed(1) + "," + py.toFixed(1) + " L" + c.x.toFixed(1) + "," + cy.toFixed(1);
  }
  const dir = c.x > p.x ? 1 : -1;
  const r = Math.min(12, Math.abs(c.x - p.x) / 2, Math.abs(midY - py));
  return "M" + p.x.toFixed(1) + "," + py.toFixed(1) +
    " L" + p.x.toFixed(1) + "," + (midY - r).toFixed(1) +
    " Q" + p.x.toFixed(1) + "," + midY.toFixed(1) + " " + (p.x + dir * r).toFixed(1) + "," + midY.toFixed(1) +
    " L" + (c.x - dir * r).toFixed(1) + "," + midY.toFixed(1) +
    " Q" + c.x.toFixed(1) + "," + midY.toFixed(1) + " " + c.x.toFixed(1) + "," + (midY + r).toFixed(1) +
    " L" + c.x.toFixed(1) + "," + cy.toFixed(1);
}

/* ---------- render ---------- */
function render() {
  const L = state.layout;
  els.empty.classList.toggle("show", state.nodes.length <= 1 && state.nodes.every(n => !n.parent_id));

  let edges = "";
  for (const n of state.nodes) {
    if (n.parent_id && L.pos.has(n.parent_id) && L.pos.has(n.id)) {
      const cls = isFrontier(n) ? "edge to-frontier" : "edge";
      edges += '<path class="' + cls + '" vector-effect="non-scaling-stroke" d="' + edgePath(L.pos.get(n.parent_id), L.pos.get(n.id)) + '"/>';
    }
  }
  els.edges.innerHTML = edges;

  let out = "";
  for (const n of state.nodes) {
    const pt = L.pos.get(n.id);
    if (!pt) continue;
    const kind = statusKind(n);
    const fr = isFrontier(n);
    const labeled = fr || pt.d === 0 || state.selected === n.id;
    const cls = ["node", "k-" + kind];
    if (fr) cls.push("glow");
    if (labeled) cls.push("labeled");
    if (n.created_by === "adopt") cls.push("adopt");
    if (state.selected === n.id) cls.push("sel");
    if (!state.known.has(n.id) && !state.firstLoad) cls.push("enter");
    out +=
      '<g class="' + cls.join(" ") + '" data-id="' + esc(n.id) + '" transform="translate(' + pt.x.toFixed(1) + " " + pt.y.toFixed(1) + ')" tabindex="0" role="treeitem" aria-label="' + esc(shortId(n.id) + ": " + n.goal + " (" + kind + ")") + '">' +
      (n.created_by === "adopt" ? '<circle class="adopt-ring" r="13" vector-effect="non-scaling-stroke"/>' : "") +
      '<circle class="sel-ring" r="14" vector-effect="non-scaling-stroke"/>' +
      '<circle class="hit" r="15"/>' +
      '<text class="glyph" text-anchor="middle" dominant-baseline="central">' + glyphChar(n) + "</text>" +
      '<text class="label" x="0" y="16" text-anchor="middle" dominant-baseline="hanging">' + esc(shortId(n.id)) + "</text>" +
      "</g>";
  }
  els.nodes.innerHTML = out;
  for (const n of state.nodes) state.known.add(n.id);
}

/* ---------- camera ---------- */
function viewport() { return els.sky.getBoundingClientRect(); }
function applyView() {
  const v = state.view;
  els.vp.setAttribute("transform", "translate(" + v.tx.toFixed(2) + " " + v.ty.toFixed(2) + ") scale(" + v.s.toFixed(4) + ")");
  els.sky.classList.toggle("zoomed", v.s >= ZOOM_LABEL_THRESHOLD);
}
function clampScale(s) { return Math.max(0.12, Math.min(3.2, s)); }

function zoomAt(clientX, clientY, factor) {
  const r = viewport();
  const px = clientX - r.left, py = clientY - r.top;
  const v = state.view;
  const s2 = clampScale(v.s * factor);
  v.tx = px - (px - v.tx) * (s2 / v.s);
  v.ty = py - (py - v.ty) * (s2 / v.s);
  v.s = s2;
  cancelCamera();
  applyView();
}

function cancelCamera() { if (state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; } }
function animateTo(target) {
  cancelCamera();
  const from = { tx: state.view.tx, ty: state.view.ty, s: state.view.s };
  if (reduceMotion) { state.view = { ...target }; applyView(); return; }
  const t0 = performance.now(), dur = 520;
  const ease = t => 1 - Math.pow(1 - t, 4);
  const step = now => {
    const k = Math.min(1, (now - t0) / dur), e = ease(k);
    state.view.tx = from.tx + (target.tx - from.tx) * e;
    state.view.ty = from.ty + (target.ty - from.ty) * e;
    state.view.s = from.s + (target.s - from.s) * e;
    applyView();
    if (k < 1) state.raf = requestAnimationFrame(step); else state.raf = 0;
  };
  state.raf = requestAnimationFrame(step);
}

function bbox() {
  const pts = [...state.layout.pos.values()];
  if (!pts.length) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  return { minX, minY, maxX, maxY };
}
function fitView(animate) {
  const r = viewport(), b = bbox();
  const pad = 90;
  const w = Math.max(b.maxX - b.minX, 1), h = Math.max(b.maxY - b.minY, 1);
  const s = clampScale(Math.min((r.width - pad * 2) / w, (r.height - pad * 2) / h, 1.5));
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  const target = { s, tx: r.width / 2 - cx * s, ty: r.height / 2 - cy * s };
  if (animate) animateTo(target); else { state.view = target; applyView(); }
}
function centerOn(id, animate) {
  const pt = state.layout.pos.get(id);
  if (!pt) return;
  const r = viewport();
  const s = Math.max(state.view.s, 0.7);
  const target = { s, tx: r.width / 2 - pt.x * s, ty: r.height / 2 - pt.y * s };
  if (animate) animateTo(target); else { state.view = target; applyView(); }
}
function newestFrontier() {
  let best = null;
  for (const n of state.nodes) if (isFrontier(n) && (!best || n.seq > best.seq)) best = n;
  if (!best) for (const n of state.nodes) if (!best || n.seq > best.seq) best = n;
  return best;
}

/* ---------- pan / zoom input ---------- */
let drag = null;
els.sky.addEventListener("pointerdown", e => {
  if (e.button !== 0) return;
  drag = { x: e.clientX, y: e.clientY, tx: state.view.tx, ty: state.view.ty, moved: false, node: e.target.closest(".node") };
  els.sky.setPointerCapture(e.pointerId);
});
els.sky.addEventListener("pointermove", e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; els.sky.classList.add("dragging"); cancelCamera(); }
  if (drag.moved) { state.view.tx = drag.tx + dx; state.view.ty = drag.ty + dy; applyView(); }
});
els.sky.addEventListener("pointerup", e => {
  els.sky.classList.remove("dragging");
  if (drag && !drag.moved && drag.node) selectNode(drag.node.getAttribute("data-id"));
  drag = null;
});
els.sky.addEventListener("pointercancel", () => { drag = null; els.sky.classList.remove("dragging"); });
els.sky.addEventListener("wheel", e => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0016));
}, { passive: false });

els.nodes.addEventListener("keydown", e => {
  const g = e.target.closest(".node");
  if (!g) return;
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectNode(g.getAttribute("data-id")); }
});

document.getElementById("c-fit").addEventListener("click", () => fitView(true));
document.getElementById("c-front").addEventListener("click", () => { const n = newestFrontier(); if (n) centerOn(n.id, true); });
document.getElementById("c-in").addEventListener("click", () => { const r = viewport(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.25); });
document.getElementById("c-out").addEventListener("click", () => { const r = viewport(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 0.8); });

window.addEventListener("keydown", e => {
  if (e.target.closest("dialog")) return;
  if (e.key === "f" || e.key === "F") fitView(true);
  else if (e.key === "c" || e.key === "C") { const n = newestFrontier(); if (n) centerOn(n.id, true); }
  else if (e.key === "+" || e.key === "=") { const r = viewport(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.25); }
  else if (e.key === "-" || e.key === "_") { const r = viewport(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 0.8); }
});
window.addEventListener("resize", () => applyView());

/* ---------- detail drawer ---------- */
function mdInline(s) {
  s = esc(s);
  s = s.replace(/\`([^\`]+)\`/g, "<code>$1</code>");
  s = s.replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");
  s = s.replace(/\\*([^*]+)\\*/g, "<em>$1</em>");
  s = s.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}
function md(src) {
  if (!src) return "";
  const lines = src.replace(/\\r/g, "").split("\\n");
  const out = []; let inCode = false, code = [], list = false;
  const closeList = () => { if (list) { out.push("</ul>"); list = false; } };
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^\`\`\`/.test(ln)) {
      if (inCode) { out.push("<pre><code>" + esc(code.join("\\n")) + "</code></pre>"); code = []; inCode = false; }
      else { closeList(); inCode = true; }
      continue;
    }
    if (inCode) { code.push(ln); continue; }
    const h = ln.match(/^(#{1,6})\\s+(.*)$/);
    if (h) { closeList(); out.push("<h3>" + mdInline(h[2]) + "</h3>"); continue; }
    const li = ln.match(/^\\s*[-*]\\s+(.*)$/);
    if (li) { if (!list) { out.push("<ul>"); list = true; } out.push("<li>" + mdInline(li[1]) + "</li>"); continue; }
    if (ln.trim() === "") { closeList(); continue; }
    closeList(); out.push("<p>" + mdInline(ln) + "</p>");
  }
  if (inCode) out.push("<pre><code>" + esc(code.join("\\n")) + "</code></pre>");
  closeList();
  return out.join("");
}

function selectNode(id) {
  state.selected = id;
  state.returnFocusId = id;
  render();
  centerOn(id, true);
  fetch("/api/node/" + encodeURIComponent(id)).then(r => r.json()).then(renderDrawer).catch(() => {});
}
function renderDrawer(d) {
  if (!d) return;
  const m = d.meta;
  const kind = statusKind(m);
  const nb = m.notebook_ok === true ? '<span class="badge nb-ok">notebook ✓</span>'
           : m.notebook_ok === false ? '<span class="badge nb-bad">notebook ✗</span>' : "";
  const adopted = m.created_by === "adopt" ? '<span class="badge adopt">adopted</span>' : "";
  const files = (d.files || []).map(f =>
    '<a href="/api/file?id=' + encodeURIComponent(m.id) + "&name=" + encodeURIComponent(f) + '" target="_blank" rel="noopener">' + esc(f) + "</a>"
  ).join("");
  els.drawer.innerHTML =
    '<div class="d-pad">' +
      '<div class="d-top">' +
        '<span class="glyph k-' + kind + '">' + glyphChar(m) + "</span>" +
        '<span class="d-id">' + esc(m.id) + "</span>" +
        '<button class="d-close" id="d-close" aria-label="close" title="Close (Esc)">✕</button>' +
      "</div>" +
      '<div class="d-badges">' +
        '<span class="badge status ' + kind + '">' + esc(m.status) + "</span>" +
        '<span class="badge">' + esc(m.type) + "</span>" + nb + adopted +
      "</div>" +
      '<div class="d-meta">seq ' + esc(m.seq) + " · by " + esc(m.created_by) + (m.ts ? " · updated " + esc(agoLabel(m.ts)) : "") + "</div>" +
      '<div class="d-sec"><h3>Goal</h3><div class="md">' + (md(d.goal) || '<span class="none">no goal.md</span>') + "</div></div>" +
      '<div class="d-sec"><h3>Conclusion</h3><div class="md">' + (md(d.conclusion) || '<span class="none">— not concluded yet —</span>') + "</div></div>" +
      (files ? '<div class="d-sec"><h3>Files</h3><div class="files">' + files + "</div></div>" : "") +
    "</div>";
  document.getElementById("d-close").addEventListener("click", () => els.drawer.close());
  if (!els.drawer.open) els.drawer.showModal();
}
els.drawer.addEventListener("click", e => {
  // light-dismiss when clicking the backdrop area outside the panel
  const r = els.drawer.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) els.drawer.close();
});
els.drawer.addEventListener("close", () => {
  const prev = state.returnFocusId;
  state.selected = null;
  render();
  if (prev) { const g = els.nodes.querySelector('[data-id="' + (window.CSS && CSS.escape ? CSS.escape(prev) : prev) + '"]'); if (g) g.focus(); }
});

/* ---------- data / live ---------- */
function ingest(nodes) {
  const prevKnown = new Set(state.known);
  state.nodes = nodes;
  state.layout = computeLayout(nodes);
  render();
  if (state.firstLoad) {
    fitView(false);
    state.firstLoad = false;
  } else {
    const fresh = nodes.filter(n => !prevKnown.has(n.id));
    if (fresh.length) {
      let newest = fresh[0];
      for (const n of fresh) if (n.seq > newest.seq) newest = n;
      centerOn(newest.id, true);
    }
    if (state.selected) {
      // keep drawer content fresh if the selected node changed
      fetch("/api/node/" + encodeURIComponent(state.selected)).then(r => r.json()).then(d => { if (d && els.drawer.open) renderDrawer(d); }).catch(() => {});
    }
  }
}

function refreshAgos() {
  if (state.lastEvent) els.stamp.textContent = "updated " + agoLabel(new Date(state.lastEvent).toISOString());
}
setInterval(refreshAgos, 5000);

fetch("/api/objective").then(r => r.text()).then(t => {
  const first = (t.split("\\n").find(l => l.trim() && !l.trim().startsWith("#")) || "").trim();
  els.obj.textContent = first || (t.trim().split("\\n")[0] || "");
}).catch(() => {});

const es = new EventSource("/events");
es.addEventListener("tree", e => {
  state.lastEvent = Date.now();
  els.dot.classList.add("live");
  refreshAgos();
  ingest(JSON.parse(e.data));
});
es.onerror = () => els.dot.classList.remove("live");
</script>
</body>
</html>`;

function send(res: http.ServerResponse, code: number, type: string, body: string | Buffer): void {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-cache" });
  res.end(body);
}

function cmdServe(ws: string, flags: Record<string, string | boolean>): void {
  if (!fs.existsSync(P.jsonl(ws))) die("no tree.jsonl in workspace — run init first");
  const port = Number(flags.port) || 4173;
  const clients = new Set<http.ServerResponse>();

  const pushTree = () => {
    const data = JSON.stringify(treeSnapshot(ws));
    for (const res of clients) res.write(`event: tree\ndata: ${data}\n\n`);
  };

  // Watch the append-only log; every mutation (add/set/status/…) lands as a new line and
  // fans out to every connected browser. Debounced so a burst of writes coalesces.
  let timer: NodeJS.Timeout | null = null;
  const onChange = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(pushTree, 100);
  };
  try {
    fs.watch(P.jsonl(ws), onChange);
  } catch {
    fs.watchFile(P.jsonl(ws), { interval: 500 }, onChange); // fallback for platforms without fs.watch
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    const p = url.pathname;
    try {
      if (p === "/") return send(res, 200, "text/html; charset=utf-8", DASHBOARD_HTML);
      if (p === "/api/tree") return send(res, 200, "application/json", JSON.stringify(treeSnapshot(ws)));
      if (p === "/api/objective") return send(res, 200, "text/plain; charset=utf-8", readIfExists(P.objective(ws)));
      if (p.startsWith("/api/node/")) {
        const d = nodeDetail(ws, decodeURIComponent(p.slice("/api/node/".length)));
        return d ? send(res, 200, "application/json", JSON.stringify(d)) : send(res, 404, "application/json", "null");
      }
      if (p === "/api/file") {
        const id = url.searchParams.get("id") || "";
        const name = url.searchParams.get("name") || "";
        if (!/^[\w.-]+$/.test(id) || !/^[\w.-]+$/.test(name)) return send(res, 400, "text/plain", "bad path");
        const fp = path.join(P.nodeDir(ws, id), name);
        if (!fs.existsSync(fp)) return send(res, 404, "text/plain", "not found");
        const isNb = name.endsWith(".ipynb");
        return send(res, 200, isNb ? "application/json" : "text/plain; charset=utf-8", fs.readFileSync(fp));
      }
      if (p === "/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(`event: tree\ndata: ${JSON.stringify(treeSnapshot(ws))}\n\n`);
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      send(res, 404, "text/plain", "not found");
    } catch (e: any) {
      send(res, 500, "text/plain", e && e.message ? e.message : String(e));
    }
  });

  server.on("error", (e: any) => {
    if (e.code === "EADDRINUSE") die(`port ${port} is in use — pass --port <n>`);
    die(e.message || String(e));
  });
  server.listen(port, () => {
    process.stdout.write(`analysis-tree dashboard live at http://localhost:${port}  (Ctrl-C to stop)\n`);
  });
}

// ---------- dispatch ----------

function main(): void {
  const [, , verb, ...rest] = process.argv;
  const { positional, flags } = parseArgs(rest);
  const ws = resolveWs(flags);

  try {
  switch (verb) {
    case "init":
      return cmdInit(ws, flags);
    case "add":
      return cmdAdd(ws, flags);
    case "set":
      return cmdSet(ws, positional, flags);
    case "status":
      return cmdStatus(ws, positional, flags);
    case "reparent":
      return cmdReparent(ws, positional, flags);
    case "delete":
      return cmdDelete(ws, positional, flags);
    case "show":
      return cmdShow(ws, flags);
    case "path":
      return cmdPath(ws, positional);
    case "node":
      return cmdNode(ws, positional);
    case "children":
      return cmdChildren(ws, positional);
    case "find":
      return cmdFind(ws, positional);
    case "check-notebook":
      return cmdCheckNotebook(ws, positional, flags);
    case "serve":
      return cmdServe(ws, flags);
    default:
      process.stdout.write(
        [
          "analysis-tree CLI",
          "usage: node tree.js <verb> [args] [--ws <path>]",
          "",
          "  init --root-goal <text>",
          "  add --parent <id> --goal <text> [--type <t>] [--created-by <who>]",
          "  set <id> [--status <s>] [--conclusion <text>] [--notebook-ok <bool>]",
          "  status <id> <status>",
          "  reparent <id> <new_parent>",
          "  delete <id> [--cascade] [--reparent] [--purge]",
          "  show [--full] [--status <s>] [--path <id>]",
          "  path <id>",
          "  node <id>",
          "  children <id>",
          "  find <query>",
          "  check-notebook <id> [--file <name>]",
          "  serve [--port <n>]            # live html dashboard (real-time via SSE)",
          "",
          `  statuses: ${STATUSES.join(" | ")}`,
        ].join("\n") + "\n"
      );
      process.exit(verb ? 1 : 0);
  }
  } catch (e: any) {
    die(e && e.message ? e.message : String(e));
  }
}

main();
