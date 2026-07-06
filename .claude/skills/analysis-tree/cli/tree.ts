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
<title>analysis-tree · live</title>
<style>
  :root {
    --bg:#0f1115; --panel:#161a21; --panel2:#1b212b; --border:#252c38;
    --fg:#e6e9ef; --muted:#8a94a6; --accent:#5b9dff;
    --open:#8a94a6; --working:#f0b429; --promising:#3fb950; --answered:#5b9dff; --dead:#5a6273;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg:#f6f7f9; --panel:#ffffff; --panel2:#f0f2f5; --border:#e2e6ec;
      --fg:#1c2029; --muted:#6b7383; --accent:#2f6fd6;
      --open:#6b7383; --working:#b9820a; --promising:#1a7f37; --answered:#2f6fd6; --dead:#9aa3b2;
    }
  }
  * { box-sizing:border-box; }
  body { margin:0; font:14px/1.5 ui-sans-serif,-apple-system,Segoe UI,Roboto,sans-serif;
         background:var(--bg); color:var(--fg); height:100vh; display:flex; flex-direction:column; }
  header { display:flex; align-items:center; gap:12px; padding:10px 16px;
           border-bottom:1px solid var(--border); background:var(--panel); }
  header h1 { font-size:14px; font-weight:600; margin:0; letter-spacing:.02em; }
  header .obj { color:var(--muted); font-size:13px; overflow:hidden; text-overflow:ellipsis;
                white-space:nowrap; flex:1; }
  .dot { width:9px; height:9px; border-radius:50%; background:var(--dead); flex:none; }
  .dot.live { background:var(--promising); box-shadow:0 0 0 3px color-mix(in srgb,var(--promising) 25%,transparent); }
  main { flex:1; display:flex; min-height:0; }
  #tree { flex:1; overflow:auto; padding:14px 10px; }
  #detail { width:42%; max-width:560px; border-left:1px solid var(--border); background:var(--panel);
            overflow:auto; padding:0; }
  .row { display:flex; align-items:baseline; gap:7px; padding:3px 8px; border-radius:6px;
         cursor:pointer; white-space:nowrap; }
  .row:hover { background:var(--panel2); }
  .row.sel { background:color-mix(in srgb,var(--accent) 18%,transparent); }
  .row.frontier { }
  .chev { width:12px; color:var(--muted); flex:none; cursor:pointer; user-select:none; font-size:11px; }
  .glyph { flex:none; width:14px; text-align:center; font-size:13px; }
  .s-open .glyph{color:var(--open);} .s-working .glyph{color:var(--working);}
  .s-promising .glyph{color:var(--promising);} .s-answered .glyph{color:var(--answered);}
  .s-dead-end .glyph{color:var(--dead);}
  .s-working .glyph{ animation:pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:.35;} }
  .nid { color:var(--muted); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }
  .goal { overflow:hidden; text-overflow:ellipsis; }
  .s-dead-end .goal { text-decoration:line-through; color:var(--muted); }
  .frontier .goal { font-weight:600; }
  .ago { color:var(--muted); font-size:11px; margin-left:6px; flex:none; }
  .legend { color:var(--muted); font-size:12px; padding:8px 16px; border-top:1px solid var(--border);
            background:var(--panel); display:flex; gap:16px; flex-wrap:wrap; }
  .legend b { font-weight:400; }
  .dpad { padding:16px 18px; }
  .dhead { display:flex; align-items:center; gap:8px; margin-bottom:2px; }
  .dhead .nid { font-size:13px; }
  .badge { font-size:11px; padding:1px 8px; border-radius:999px; border:1px solid var(--border); color:var(--muted); }
  .badge.ok { color:var(--promising); border-color:color-mix(in srgb,var(--promising) 40%,var(--border)); }
  .badge.bad { color:#f85149; border-color:color-mix(in srgb,#f85149 40%,var(--border)); }
  .badge.adopt { color:var(--accent); border-color:color-mix(in srgb,var(--accent) 40%,var(--border)); }
  .tag-adopt { flex:none; font-size:10px; padding:0 6px; border-radius:999px; letter-spacing:.03em;
               color:var(--accent); border:1px solid color-mix(in srgb,var(--accent) 35%,var(--border)); }
  .dmeta { color:var(--muted); font-size:12px; margin:6px 0 14px; }
  .dsec { margin:16px 0; }
  .dsec h3 { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted);
             margin:0 0 6px; font-weight:600; }
  .md { font-size:13.5px; }
  .md h1,.md h2,.md h3 { font-size:14px; margin:12px 0 4px; }
  .md code { background:var(--panel2); padding:1px 5px; border-radius:4px;
             font-family:ui-monospace,Menlo,monospace; font-size:12px; }
  .md pre { background:var(--panel2); padding:10px 12px; border-radius:8px; overflow:auto; }
  .md pre code { background:none; padding:0; }
  .md ul { margin:4px 0; padding-left:20px; }
  .md a { color:var(--accent); }
  .files a { color:var(--accent); text-decoration:none; font-family:ui-monospace,Menlo,monospace; font-size:12px; }
  .files span { margin-right:12px; }
  .empty { color:var(--muted); padding:40px; text-align:center; }
  .placeholder { color:var(--muted); padding:40px 20px; text-align:center; }
</style>
</head>
<body>
<header>
  <span class="dot" id="dot"></span>
  <h1>analysis-tree</h1>
  <span class="obj" id="obj"></span>
  <span class="ago" id="stamp"></span>
</header>
<main>
  <div id="tree"><div class="empty">connecting…</div></div>
  <aside id="detail"><div class="placeholder">Select a node to see its goal &amp; conclusion.</div></aside>
</main>
<div class="legend">
  <b><span style="color:var(--working)">◐</span> working</b>
  <b><span style="color:var(--open)">○</span> open</b>
  <b><span style="color:var(--promising)">●</span> promising</b>
  <b><span style="color:var(--answered)">✓</span> answered</b>
  <b><span style="color:var(--dead)">✗</span> dead-end</b>
</div>
<script>
var state = { nodes: [], byId: {}, kids: {}, selected: null, collapsed: {}, lastEvent: 0 };

function esc(s){ return String(s).replace(/[&<>"]/g, function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

function agoLabel(ts){
  if(!ts) return '';
  var d = Date.now() - Date.parse(ts);
  if(isNaN(d)) return '';
  var s = Math.round(d/1000);
  if(s < 5) return 'just now';
  if(s < 60) return s + 's ago';
  var m = Math.round(s/60); if(m < 60) return m + 'm ago';
  var h = Math.round(m/60); if(h < 24) return h + 'h ago';
  return Math.round(h/24) + 'd ago';
}

function glyph(n){
  if(n.status === 'promising') return '●';
  if(n.status === 'answered') return '✓';
  if(n.status === 'dead-end') return '✗';
  if(n.status === 'open' && !n.conclusion) return '◐';
  return '○';
}
function statusClass(n){
  if(n.status === 'open' && !n.conclusion) return 's-working';
  return 's-' + n.status;
}
function isFrontier(n){ return n.status === 'open' || n.status === 'promising'; }

function index(){
  state.byId = {}; state.kids = {};
  state.nodes.forEach(function(n){ state.byId[n.id] = n; });
  state.nodes.forEach(function(n){
    var p = n.parent_id;
    if(p){ (state.kids[p] = state.kids[p] || []).push(n); }
  });
}

function renderTree(){
  index();
  var roots = state.nodes.filter(function(n){ return !n.parent_id; });
  var host = document.getElementById('tree');
  if(state.nodes.length === 0){ host.innerHTML = '<div class="empty">Empty tree — waiting for the first node…</div>'; return; }
  var html = [];
  roots.forEach(function(r){ walk(r, 0, html); });
  host.innerHTML = html.join('');
}

function walk(n, depth, html){
  var kids = state.kids[n.id] || [];
  var collapsed = !!state.collapsed[n.id];
  var chev = kids.length ? (collapsed ? '▸' : '▾') : '';
  var cls = 'row ' + statusClass(n) + (isFrontier(n) ? ' frontier' : '') + (state.selected === n.id ? ' sel' : '');
  html.push(
    '<div class="' + cls + '" data-id="' + esc(n.id) + '" style="padding-left:' + (8 + depth*18) + 'px">' +
      '<span class="chev" data-chev="' + esc(n.id) + '">' + chev + '</span>' +
      '<span class="glyph">' + glyph(n) + '</span>' +
      '<span class="nid">' + esc(n.id) + '</span>' +
      '<span class="goal">' + esc(n.goal) + '</span>' +
      (n.created_by === 'adopt' ? '<span class="tag-adopt">adopted</span>' : '') +
      '<span class="ago" data-ts="' + esc(n.ts || '') + '">' + agoLabel(n.ts) + '</span>' +
    '</div>'
  );
  if(!collapsed) kids.forEach(function(k){ walk(k, depth+1, html); });
}

// --- tiny markdown renderer (headings, bold, italic, code, lists, links, paras) ---
function mdInline(s){
  s = esc(s);
  s = s.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
  s = s.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
  s = s.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');
  s = s.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}
function md(src){
  if(!src) return '';
  var lines = src.replace(/\\r/g,'').split('\\n');
  var out = [], i = 0, inCode = false, code = [], list = false;
  function closeList(){ if(list){ out.push('</ul>'); list = false; } }
  for(i=0;i<lines.length;i++){
    var ln = lines[i];
    if(/^\`\`\`/.test(ln)){
      if(inCode){ out.push('<pre><code>' + esc(code.join('\\n')) + '</code></pre>'); code=[]; inCode=false; }
      else { closeList(); inCode = true; }
      continue;
    }
    if(inCode){ code.push(ln); continue; }
    var h = ln.match(/^(#{1,6})\\s+(.*)$/);
    if(h){ closeList(); out.push('<h3>' + mdInline(h[2]) + '</h3>'); continue; }
    var li = ln.match(/^\\s*[-*]\\s+(.*)$/);
    if(li){ if(!list){ out.push('<ul>'); list = true; } out.push('<li>' + mdInline(li[1]) + '</li>'); continue; }
    if(ln.trim() === ''){ closeList(); continue; }
    closeList(); out.push('<p>' + mdInline(ln) + '</p>');
  }
  if(inCode) out.push('<pre><code>' + esc(code.join('\\n')) + '</code></pre>');
  closeList();
  return out.join('');
}

function renderDetail(d){
  var host = document.getElementById('detail');
  if(!d){ host.innerHTML = '<div class="placeholder">Node not found.</div>'; return; }
  var m = d.meta;
  var nbBadge = '';
  if(m.notebook_ok === true) nbBadge = '<span class="badge ok">notebook ✓</span>';
  else if(m.notebook_ok === false) nbBadge = '<span class="badge bad">notebook ✗</span>';
  var files = (d.files||[]).map(function(f){
    return '<span><a href="/api/file?id=' + encodeURIComponent(m.id) + '&name=' + encodeURIComponent(f) +
           '" target="_blank" rel="noopener">' + esc(f) + '</a></span>';
  }).join('');
  host.innerHTML =
    '<div class="dpad">' +
      '<div class="dhead"><span class="glyph ' + statusClass(m) + '">' + glyph(m) + '</span>' +
        '<span class="nid">' + esc(m.id) + '</span>' +
        '<span class="badge">' + esc(m.status) + '</span>' + nbBadge +
        (m.created_by === 'adopt' ? '<span class="badge adopt">adopted</span>' : '') + '</div>' +
      '<div class="dmeta">type ' + esc(m.type) + ' · by ' + esc(m.created_by) +
        (m.ts ? ' · updated ' + esc(agoLabel(m.ts)) : '') + '</div>' +
      '<div class="dsec"><h3>Goal</h3><div class="md">' + (md(d.goal) || '<p class="placeholder">no goal.md</p>') + '</div></div>' +
      '<div class="dsec"><h3>Conclusion</h3><div class="md">' + (md(d.conclusion) || '<p style="color:var(--muted)">— not concluded yet —</p>') + '</div></div>' +
      (files ? '<div class="dsec"><h3>Files</h3><div class="files">' + files + '</div></div>' : '') +
    '</div>';
}

function select(id){
  state.selected = id;
  renderTree();
  fetch('/api/node/' + encodeURIComponent(id)).then(function(r){ return r.json(); }).then(renderDetail);
}

document.getElementById('tree').addEventListener('click', function(e){
  var chev = e.target.getAttribute('data-chev');
  if(chev){ state.collapsed[chev] = !state.collapsed[chev]; renderTree(); return; }
  var row = e.target.closest('.row');
  if(row){ select(row.getAttribute('data-id')); }
});

function refreshAgos(){
  document.querySelectorAll('.ago[data-ts]').forEach(function(el){
    el.textContent = agoLabel(el.getAttribute('data-ts'));
  });
  var st = document.getElementById('stamp');
  if(state.lastEvent) st.textContent = 'updated ' + agoLabel(new Date(state.lastEvent).toISOString());
}
setInterval(refreshAgos, 5000);

fetch('/api/objective').then(function(r){ return r.text(); }).then(function(t){
  var first = (t.split('\\n').find(function(l){ return l.trim() && !l.trim().startsWith('#'); }) || '').trim();
  document.getElementById('obj').textContent = first || t.trim().split('\\n')[0] || '';
});

var es = new EventSource('/events');
es.addEventListener('tree', function(e){
  state.nodes = JSON.parse(e.data);
  state.lastEvent = Date.now();
  renderTree();
  if(state.selected) select(state.selected);
  document.getElementById('dot').classList.add('live');
});
es.onerror = function(){ document.getElementById('dot').classList.remove('live'); };
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
