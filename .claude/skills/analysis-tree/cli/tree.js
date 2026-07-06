#!/usr/bin/env node
"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const http = __importStar(require("node:http"));
const STATUSES = ["open", "promising", "dead-end", "answered"];
// ---------- workspace resolution ----------
function resolveWs(args) {
    if (typeof args.ws === "string")
        return path.resolve(args.ws);
    // default: directory containing this script (workspace-local copy of tree.js)
    return __dirname;
}
const P = {
    jsonl: (ws) => path.join(ws, "tree.jsonl"),
    nodeMd: (ws) => path.join(ws, "node.md"),
    objective: (ws) => path.join(ws, "objective.md"),
    nodesDir: (ws) => path.join(ws, "nodes"),
    deletedDir: (ws) => path.join(ws, "_deleted"),
    nodeDir: (ws, id) => path.join(ws, "nodes", id),
};
// ---------- jsonl replay / remount ----------
function readLines(ws) {
    const f = P.jsonl(ws);
    if (!fs.existsSync(f))
        return [];
    return fs
        .readFileSync(f, "utf8")
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l, i) => {
        try {
            return JSON.parse(l);
        }
        catch (e) {
            throw new Error(`Malformed tree.jsonl at line ${i + 1}: ${l}`);
        }
    });
}
/** Latest state per id (last line wins). Returns a Map preserving first-seen order. */
function remount(ws, opts = {}) {
    const latest = new Map();
    for (const ln of readLines(ws))
        latest.set(ln.id, { ...(latest.get(ln.id) || {}), ...ln });
    if (!opts.includeDeleted) {
        for (const [id, ln] of [...latest])
            if (ln.deleted)
                latest.delete(id);
    }
    return latest;
}
function nowTs() {
    return new Date().toISOString();
}
function appendLine(ws, line) {
    // Every appended line is stamped with wall-clock time unless the caller supplied one
    // explicitly (e.g. --ts for deterministic tests). Powers "updated N ago" in the dashboard.
    if (!line.ts)
        line.ts = nowTs();
    fs.appendFileSync(P.jsonl(ws), JSON.stringify(line) + "\n");
}
/** Merge current state of an id with a patch, and append the resulting full line. */
function mutate(ws, id, patch) {
    const cur = remount(ws, { includeDeleted: true }).get(id);
    if (!cur)
        throw new Error(`No such node: ${id}`);
    const next = { ...cur, ...patch };
    // A mutation is a new event: refresh its stamp unless the patch pinned one explicitly.
    if (!("ts" in patch))
        delete next.ts;
    appendLine(ws, next);
    return next;
}
// ---------- helpers ----------
function slugify(goal) {
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
function nextSeq(ws) {
    const lines = remount(ws, { includeDeleted: true });
    let max = -1;
    for (const ln of lines.values())
        if (ln.seq > max)
            max = ln.seq;
    return max + 1;
}
function childrenOf(all, id) {
    return [...all.values()].filter((n) => n.parent_id === id).sort((a, b) => a.seq - b.seq);
}
function subtreeIds(all, id) {
    const out = [id];
    for (const c of childrenOf(all, id))
        out.push(...subtreeIds(all, c.id));
    return out;
}
const GLYPH = {
    open: "○",
    promising: "◐",
    "dead-end": "✗",
    answered: "●",
};
function die(msg) {
    process.stderr.write("error: " + msg + "\n");
    process.exit(1);
}
function parseBool(v) {
    if (v === "true")
        return true;
    if (v === "false")
        return false;
    die(`expected true|false, got: ${v}`);
}
// ---------- arg parsing ----------
function parseArgs(argv) {
    const positional = [];
    const flags = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith("--")) {
            const key = a.slice(2);
            const nxt = argv[i + 1];
            if (nxt !== undefined && !nxt.startsWith("--")) {
                flags[key] = nxt;
                i++;
            }
            else {
                flags[key] = true;
            }
        }
        else {
            positional.push(a);
        }
    }
    return { positional, flags };
}
// ---------- commands ----------
function cmdInit(ws, flags) {
    const rootGoal = String(flags["root-goal"] || flags.goal || "");
    if (!rootGoal)
        die("init requires --root-goal <text>");
    fs.mkdirSync(P.nodesDir(ws), { recursive: true });
    fs.mkdirSync(P.deletedDir(ws), { recursive: true });
    if (!fs.existsSync(P.jsonl(ws)))
        fs.writeFileSync(P.jsonl(ws), "");
    if (remount(ws, { includeDeleted: true }).size > 0)
        die("workspace already initialized (tree.jsonl has nodes)");
    const id = "node_0_root";
    const dir = P.nodeDir(ws, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "goal.md"), `# Root goal\n\n${rootGoal}\n\n> The root frames the overall exploration. See \`objective.md\` for success criteria.\n`);
    const line = {
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
    if (flags.ts)
        line.ts = String(flags.ts);
    appendLine(ws, line);
    process.stdout.write(id + "\n");
}
function cmdAdd(ws, flags) {
    const parent = String(flags.parent || "");
    const goal = String(flags.goal || "");
    if (!parent)
        die("add requires --parent <id>");
    if (!goal)
        die("add requires --goal <text>");
    const all = remount(ws, { includeDeleted: true });
    if (!all.has(parent))
        die(`no such parent: ${parent}`);
    const seq = nextSeq(ws);
    // Node name derives from the goal, but a long-sentence goal makes an unreadable slug.
    // Let the master pass a short, hand-picked --slug for a legible name; sanitize either way.
    const slug = flags.slug ? slugify(String(flags.slug)) : slugify(goal);
    const id = `node_${seq}_${slug}`;
    const dir = P.nodeDir(ws, id);
    if (fs.existsSync(dir))
        die(`node folder already exists: ${id}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "goal.md"), `# Goal\n\n${goal}\n\n## Background\n\n_(the node subagent fills this in: context, why this branch, approach)_\n`);
    const line = {
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
    if (flags.ts)
        line.ts = String(flags.ts);
    appendLine(ws, line);
    process.stdout.write(id + "\n");
}
function cmdSet(ws, positional, flags) {
    const id = positional[0];
    if (!id)
        die("set requires <id>");
    const patch = {};
    if (typeof flags.status === "string") {
        if (!STATUSES.includes(flags.status))
            die(`invalid status: ${flags.status} (${STATUSES.join("|")})`);
        patch.status = flags.status;
    }
    if (typeof flags.conclusion === "string")
        patch.conclusion = flags.conclusion;
    if (typeof flags["notebook-ok"] === "string")
        patch.notebook_ok = parseBool(flags["notebook-ok"]);
    if (typeof flags.ts === "string")
        patch.ts = flags.ts;
    if (Object.keys(patch).length === 0)
        die("set requires at least one of --status --conclusion --notebook-ok");
    const next = mutate(ws, id, patch);
    process.stdout.write(`${next.id} -> status=${next.status} notebook_ok=${next.notebook_ok}\n`);
}
function cmdStatus(ws, positional, flags) {
    const id = positional[0];
    const status = positional[1];
    if (!id || !status)
        die("status requires <id> <status>");
    if (!STATUSES.includes(status))
        die(`invalid status: ${status} (${STATUSES.join("|")})`);
    const patch = { status: status };
    if (typeof flags.ts === "string")
        patch.ts = flags.ts;
    const next = mutate(ws, id, patch);
    process.stdout.write(`${next.id} -> ${next.status}\n`);
}
function cmdReparent(ws, positional, flags) {
    const id = positional[0];
    const newParent = positional[1];
    if (!id || !newParent)
        die("reparent requires <id> <new_parent>");
    const all = remount(ws, { includeDeleted: true });
    if (!all.has(id))
        die(`no such node: ${id}`);
    if (!all.has(newParent))
        die(`no such new parent: ${newParent}`);
    if (id === newParent)
        die("cannot reparent a node onto itself");
    if (subtreeIds(all, id).includes(newParent))
        die("cannot reparent a node under its own descendant (cycle)");
    const patch = { parent_id: newParent };
    if (typeof flags.ts === "string")
        patch.ts = flags.ts;
    mutate(ws, id, patch);
    process.stdout.write(`${id} -> parent ${newParent}\n`);
}
function cmdDelete(ws, positional, flags) {
    const id = positional[0];
    if (!id)
        die("delete requires <id>");
    const all = remount(ws, { includeDeleted: true });
    const node = all.get(id);
    if (!node || node.deleted)
        die(`no such (live) node: ${id}`);
    if (id === "node_0_root")
        die("cannot delete the root node");
    const kids = childrenOf(all, id).filter((k) => !k.deleted);
    const cascade = !!flags.cascade;
    const reparent = !!flags.reparent;
    const purge = !!flags.purge;
    if (kids.length > 0 && !cascade && !reparent) {
        die(`node has ${kids.length} live child(ren); pass --cascade to delete the subtree or --reparent to lift them to ${node.parent_id}`);
    }
    let toTombstone;
    if (reparent) {
        for (const k of kids)
            mutate(ws, k.id, { parent_id: node.parent_id });
        toTombstone = [id];
    }
    else if (cascade) {
        toTombstone = subtreeIds(all, id).filter((x) => !all.get(x).deleted);
    }
    else {
        toTombstone = [id];
    }
    for (const tid of toTombstone) {
        mutate(ws, tid, { deleted: true });
        const src = P.nodeDir(ws, tid);
        if (fs.existsSync(src)) {
            if (purge) {
                fs.rmSync(src, { recursive: true, force: true });
            }
            else {
                fs.mkdirSync(P.deletedDir(ws), { recursive: true });
                const dst = path.join(P.deletedDir(ws), tid);
                fs.rmSync(dst, { recursive: true, force: true });
                fs.renameSync(src, dst);
            }
        }
    }
    process.stdout.write(`deleted ${toTombstone.length} node(s): ${toTombstone.join(", ")}${purge ? " (purged)" : " (archived)"}\n`);
}
function renderTree(all, full, statusFilter, highlightPath) {
    const roots = [...all.values()].filter((n) => n.parent_id === null).sort((a, b) => a.seq - b.seq);
    const out = [];
    const walk = (node, prefix, isLast, isRoot) => {
        const branch = isRoot ? "" : isLast ? "└─ " : "├─ ";
        const mark = highlightPath.has(node.id) ? " «" : "";
        const adopted = node.created_by === "adopt" ? "  [adopted]" : "";
        const line = `${prefix}${branch}${GLYPH[node.status]} ${node.id}  ${node.goal}${adopted}${mark}`;
        if (!statusFilter || node.status === statusFilter)
            out.push(line);
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
function cmdShow(ws, flags) {
    const all = remount(ws);
    if (all.size === 0) {
        process.stdout.write("(empty tree — run init)\n");
        return;
    }
    const highlight = new Set();
    if (typeof flags.path === "string") {
        let cur = all.get(flags.path);
        while (cur) {
            highlight.add(cur.id);
            cur = cur.parent_id ? all.get(cur.parent_id) : undefined;
        }
    }
    const statusFilter = typeof flags.status === "string" ? flags.status : undefined;
    process.stdout.write(renderTree(all, !!flags.full, statusFilter, highlight) + "\n");
    // frontier summary
    const frontier = [...all.values()].filter((n) => n.status === "open" || n.status === "promising");
    process.stdout.write(`\nlegend: ${GLYPH.open} open  ${GLYPH.promising} promising  ${GLYPH["dead-end"]} dead-end  ${GLYPH.answered} answered\n`);
    process.stdout.write(`frontier (${frontier.length}): ${frontier.map((n) => n.id).join(", ") || "—"}\n`);
}
function cmdPath(ws, positional) {
    const id = positional[0];
    if (!id)
        die("path requires <id>");
    const all = remount(ws, { includeDeleted: true });
    const chain = [];
    let cur = all.get(id);
    if (!cur)
        die(`no such node: ${id}`);
    while (cur) {
        chain.unshift(cur);
        cur = cur.parent_id ? all.get(cur.parent_id) : undefined;
    }
    for (const n of chain) {
        process.stdout.write(`${GLYPH[n.status]} ${n.id}  [${n.status}]\n    goal: ${n.goal}\n`);
        if (n.conclusion)
            process.stdout.write(`    conclusion: ${n.conclusion}\n`);
    }
}
function cmdNode(ws, positional) {
    const id = positional[0];
    if (!id)
        die("node requires <id>");
    const all = remount(ws, { includeDeleted: true });
    const n = all.get(id);
    if (!n)
        die(`no such node: ${id}`);
    process.stdout.write(JSON.stringify(n, null, 2) + "\n");
    const dir = P.nodeDir(ws, id);
    if (fs.existsSync(dir)) {
        process.stdout.write(`\nfolder: nodes/${id}/\n`);
        for (const f of fs.readdirSync(dir))
            process.stdout.write(`  - ${f}\n`);
    }
    else {
        process.stdout.write(`\n(no folder on disk${n.deleted ? " — archived under _deleted/" : ""})\n`);
    }
}
function cmdChildren(ws, positional) {
    const id = positional[0];
    if (!id)
        die("children requires <id>");
    const all = remount(ws);
    if (!all.has(id))
        die(`no such node: ${id}`);
    const kids = childrenOf(all, id);
    if (kids.length === 0) {
        process.stdout.write("(no children)\n");
        return;
    }
    for (const k of kids)
        process.stdout.write(`${GLYPH[k.status]} ${k.id}  [${k.status}]  ${k.goal}\n`);
}
function cmdFind(ws, positional) {
    const q = positional.join(" ").toLowerCase();
    if (!q)
        die("find requires <query>");
    const all = remount(ws);
    const hits = [...all.values()].filter((n) => n.id.toLowerCase().includes(q) ||
        n.goal.toLowerCase().includes(q) ||
        n.conclusion.toLowerCase().includes(q) ||
        n.status === q ||
        n.type.toLowerCase() === q);
    if (hits.length === 0) {
        process.stdout.write("(no matches)\n");
        return;
    }
    for (const n of hits.sort((a, b) => a.seq - b.seq))
        process.stdout.write(`${GLYPH[n.status]} ${n.id}  [${n.status}]  ${n.goal}\n`);
}
/** Scan an executed notebook for error outputs / unexecuted cells. Exit 1 if not clean. */
function cmdCheckNotebook(ws, positional, flags) {
    const id = positional[0];
    if (!id)
        die("check-notebook requires <id>");
    const dir = P.nodeDir(ws, id);
    // Resolve the notebook: explicit --file wins, else the node-id-named notebook
    // (`<id>.ipynb`, the convention), else legacy `notebook.ipynb`, else the sole *.ipynb.
    let nbName;
    if (typeof flags.file === "string") {
        nbName = flags.file;
    }
    else if (fs.existsSync(path.join(dir, `${id}.ipynb`))) {
        nbName = `${id}.ipynb`;
    }
    else if (fs.existsSync(path.join(dir, "notebook.ipynb"))) {
        nbName = "notebook.ipynb";
    }
    else {
        const ipynbs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".ipynb")) : [];
        if (ipynbs.length === 1)
            nbName = ipynbs[0];
        else if (ipynbs.length === 0)
            die(`no notebook found in nodes/${id}/`);
        else
            die(`multiple notebooks in nodes/${id}/ — pass --file <name> (${ipynbs.join(", ")})`);
    }
    const nbPath = path.join(dir, nbName);
    if (!fs.existsSync(nbPath))
        die(`notebook not found: nodes/${id}/${nbName}`);
    let nb;
    try {
        nb = JSON.parse(fs.readFileSync(nbPath, "utf8"));
    }
    catch (e) {
        die(`notebook is not valid JSON: ${nbPath}`);
    }
    const cells = nb.cells || [];
    const problems = [];
    cells.forEach((cell, i) => {
        if (cell.cell_type !== "code")
            return;
        const src = Array.isArray(cell.source) ? cell.source.join("") : cell.source || "";
        if (src.trim() === "")
            return;
        if (cell.execution_count == null)
            problems.push(`cell ${i}: not executed (execution_count is null)`);
        for (const out of cell.outputs || []) {
            if (out.output_type === "error") {
                problems.push(`cell ${i}: error output — ${out.ename || ""}: ${out.evalue || ""}`);
            }
        }
    });
    if (problems.length > 0) {
        process.stderr.write(`NOT CLEAN — ${problems.length} problem(s):\n`);
        for (const p of problems)
            process.stderr.write("  - " + p + "\n");
        process.exit(1);
    }
    const nCode = cells.filter((c) => c.cell_type === "code").length;
    process.stdout.write(`clean: ${nCode} code cell(s) executed, zero error outputs\n`);
}
// ---------- serve: live html dashboard ----------
/** Flat, sorted, live-state node list for the dashboard API. */
function treeSnapshot(ws) {
    return [...remount(ws).values()].sort((a, b) => a.seq - b.seq);
}
function readIfExists(p) {
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}
/** Node folder content for the detail panel. */
function nodeDetail(ws, id) {
    const all = remount(ws, { includeDeleted: true });
    const meta = all.get(id);
    if (!meta)
        return null;
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
  /* when a label is shown, its full text is a click target for the node (not just the glyph) */
  .node.labeled .label,
  .node:hover .label,
  .node.sel .label,
  #sky.zoomed .node .label { pointer-events: bounding-box; cursor: pointer; }

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

  .d-pad { padding: 20px 22px 32px; }

  /* title: human slug up top, canonical id quiet beneath */
  .d-titlebar { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 15px; }
  .d-title { min-width: 0; flex: 1; }
  .d-slug { font-size: 17px; font-weight: 600; color: var(--ink); letter-spacing: -0.01em; overflow-wrap: anywhere; line-height: 1.25; }
  .d-fullid { font-size: 11px; color: var(--ink-dim); margin-top: 3px; overflow-wrap: anywhere; opacity: 0.82; }
  .d-close {
    flex: none; margin-top: 1px;
    background: none; border: 1px solid var(--hairline); color: var(--ink-dim);
    border-radius: 4px; width: 27px; height: 27px; cursor: pointer; font-size: 13px; line-height: 1;
    transition: color 0.2s var(--ease), border-color 0.2s var(--ease), background 0.2s var(--ease);
  }
  .d-close:hover { color: var(--ink); border-color: var(--ink-dim); background: color-mix(in oklch, var(--field) 50%, transparent); }
  .d-close:focus-visible { outline: 2px solid var(--frontier); outline-offset: 2px; }

  /* status hero — the node's state read pre-attentively through light + glyph + words */
  .d-hero {
    --tone: var(--open);
    display: flex; align-items: flex-start; gap: 13px;
    padding: 13px 15px; margin-bottom: 15px;
    border: 1px solid color-mix(in oklch, var(--tone) 32%, var(--hairline));
    border-radius: 8px;
    background: color-mix(in oklch, var(--tone) 9%, var(--field));
  }
  .d-hero.k-working, .d-hero.k-promising { --tone: var(--frontier); }
  .d-hero.k-open     { --tone: var(--open); }
  .d-hero.k-answered { --tone: var(--answered); }
  .d-hero.k-dead     { --tone: var(--dead); }
  .d-hero .d-glyph {
    font-size: 25px; line-height: 1; flex: none; color: var(--tone);
    filter: drop-shadow(0 0 8px color-mix(in oklch, var(--tone) 45%, transparent));
  }
  .d-hero.k-dead .d-glyph { filter: none; opacity: 0.85; }
  .d-hero.k-working .d-glyph { animation: breathe 2.4s var(--ease) infinite; }
  .d-hero-txt { min-width: 0; }
  .d-status { font-size: 14px; font-weight: 600; color: var(--tone); letter-spacing: 0.01em; }
  .d-status-sub { font-size: 11.5px; color: var(--ink-dim); margin-top: 3px; line-height: 1.5; }

  /* chips: what kind of thing this node is */
  .d-chips { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 16px; }
  .chip {
    font-size: 11px; padding: 3px 10px; border-radius: 5px;
    border: 1px solid var(--hairline); color: var(--ink-dim); white-space: nowrap;
    display: inline-flex; align-items: center; gap: 5px;
  }
  .chip .k { color: var(--ink); font-weight: 600; }
  .chip.type { border-color: color-mix(in oklch, var(--ink-dim) 55%, var(--hairline)); }
  .chip.adopt { color: var(--adopted); border-color: color-mix(in oklch, var(--adopted) 42%, var(--hairline)); }
  .chip.nb-ok { color: var(--frontier); border-color: color-mix(in oklch, var(--frontier) 42%, var(--hairline)); }
  .chip.nb-bad { color: oklch(0.7 0.16 25); border-color: color-mix(in oklch, oklch(0.7 0.16 25) 42%, var(--hairline)); }

  /* facts: structured metadata grid, not a run-on dotted line */
  .d-facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 13px 10px; margin: 0; }
  .d-facts > div { min-width: 0; }
  .d-facts dt { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.09em; color: var(--ink-dim); margin-bottom: 3px; }
  .d-facts dd { font-size: 12px; color: var(--ink); margin: 0; overflow-wrap: anywhere; }

  /* sections split by hairlines + a phosphor marker so each reads as its own beat */
  .d-sec { margin: 0; padding-top: 18px; margin-top: 18px; border-top: 1px solid var(--hairline); }
  .d-sec > h3 {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.09em;
    color: var(--ink-dim); margin: 0 0 10px; font-weight: 600;
    display: flex; align-items: center; gap: 9px;
  }
  .d-sec > h3::before {
    content: ""; width: 5px; height: 5px; border-radius: 1px; flex: none;
    background: var(--frontier); box-shadow: 0 0 6px color-mix(in oklch, var(--frontier) 60%, transparent);
  }
  .d-sec.empty > h3::before { background: var(--dead); box-shadow: none; }
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
    <button id="c-orient" title="Toggle vertical / horizontal (O)" aria-label="toggle orientation">⇅</button>
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
const GLYPH_R = 11;     // glyph radius, used to inset connectors
const ZOOM_LABEL_THRESHOLD = 1.35;
// per-orientation geometry. DEPTH = along the growth axis, BREADTH = sibling spread,
// MAXLABEL = chars a label may show before it's truncated (full text lives in <title> + drawer).
const GEO = {
  vertical:   { DEPTH: 96,  BREADTH: 170, MAXLABEL: 20 },
  horizontal: { DEPTH: 230, BREADTH: 52,  MAXLABEL: 30 },
};

function loadOrient() {
  // horizontal is the default; a saved explicit choice wins.
  try { return localStorage.getItem("at-orient") === "vertical" ? "vertical" : "horizontal"; }
  catch (e) { return "horizontal"; }
}
const state = {
  nodes: [],
  layout: { byId: new Map(), kids: new Map(), roots: [], pos: new Map() },
  known: new Set(),
  selected: null,
  orient: loadOrient(),
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

/* ---------- layout: tidy tree, vertical or horizontal ---------- */
// Leaves get sequential integer slots along the breadth axis; each parent
// centers over its children. Subtrees occupy contiguous slot ranges, so nothing
// overlaps. Orientation maps (depth, slot) onto (x, y).
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
  const slotOf = new Map();
  const seen = new Set();
  let cursor = 0;
  function walk(n, d) {
    if (seen.has(n.id)) return slotOf.get(n.id) || 0; // guard against cycles
    seen.add(n.id);
    depth.set(n.id, d);
    const ch = kids.get(n.id) || [];
    let slot;
    if (ch.length === 0) {
      slot = cursor++;
    } else {
      const ss = ch.map(c => walk(c, d + 1));
      slot = (ss[0] + ss[ss.length - 1]) / 2;
    }
    slotOf.set(n.id, slot);
    return slot;
  }
  for (const r of roots) { walk(r, 0); cursor++; } // gap between separate roots

  const vertical = state.orient !== "horizontal";
  const g = vertical ? GEO.vertical : GEO.horizontal;
  const pos = new Map();
  for (const n of nodes) {
    const d = depth.get(n.id) || 0;
    const b = (slotOf.get(n.id) || 0) * g.BREADTH;
    pos.set(n.id, vertical ? { x: b, y: d * g.DEPTH, d } : { x: d * g.DEPTH, y: b, d });
  }
  return { byId, kids, roots, pos };
}

// Orthogonal flowchart connector along the current growth axis: out from the
// parent, a rounded elbow at the midline, across to the child's lane, then in.
function edgePath(p, c) {
  const vertical = state.orient !== "horizontal";
  // a/b = along growth axis / across; map back to x/y at the end
  const pa = vertical ? p.y : p.x, pb = vertical ? p.x : p.y;
  const ca = vertical ? c.y : c.x, cb = vertical ? c.x : c.y;
  const a0 = pa + GLYPH_R, a1 = ca - GLYPH_R, mid = (a0 + a1) / 2;
  const XY = (a, b) => (vertical ? b.toFixed(1) + "," + a.toFixed(1) : a.toFixed(1) + "," + b.toFixed(1));
  if (Math.abs(cb - pb) < 0.5) return "M" + XY(a0, pb) + " L" + XY(a1, cb);
  const dir = cb > pb ? 1 : -1;
  const r = Math.min(12, Math.abs(cb - pb) / 2, Math.abs(mid - a0));
  return "M" + XY(a0, pb) +
    " L" + XY(mid - r, pb) +
    " Q" + XY(mid, pb) + " " + XY(mid, pb + dir * r) +
    " L" + XY(mid, cb - dir * r) +
    " Q" + XY(mid, cb) + " " + XY(mid + r, cb) +
    " L" + XY(a1, cb);
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

  const vertical = state.orient !== "horizontal";
  const maxLabel = (vertical ? GEO.vertical : GEO.horizontal).MAXLABEL;
  // vertical: label centered under the glyph; horizontal: to the right, on the baseline
  const lx = vertical ? 0 : 15, ly = vertical ? 16 : 0;
  const lanchor = vertical ? "middle" : "start", lbase = vertical ? "hanging" : "central";

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
    const full = shortId(n.id);
    const label = full.length > maxLabel ? full.slice(0, maxLabel - 1) + "…" : full;
    out +=
      '<g class="' + cls.join(" ") + '" data-id="' + esc(n.id) + '" transform="translate(' + pt.x.toFixed(1) + " " + pt.y.toFixed(1) + ')" tabindex="0" role="treeitem" aria-label="' + esc(full + ": " + n.goal + " (" + kind + ")") + '">' +
      "<title>" + esc(full + " — " + n.goal) + "</title>" +
      (n.created_by === "adopt" ? '<circle class="adopt-ring" r="13" vector-effect="non-scaling-stroke"/>' : "") +
      '<circle class="sel-ring" r="14" vector-effect="non-scaling-stroke"/>' +
      '<circle class="hit" r="15"/>' +
      '<text class="glyph" text-anchor="middle" dominant-baseline="central">' + glyphChar(n) + "</text>" +
      '<text class="label" x="' + lx + '" y="' + ly + '" text-anchor="' + lanchor + '" dominant-baseline="' + lbase + '">' + esc(label) + "</text>" +
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

function setOrient(o) {
  state.orient = o;
  try { localStorage.setItem("at-orient", o); } catch (e) {}
  document.getElementById("c-orient").textContent = o === "horizontal" ? "⇄" : "⇅";
  state.layout = computeLayout(state.nodes);
  render();
  fitView(true);
}
function toggleOrient() { setOrient(state.orient === "horizontal" ? "vertical" : "horizontal"); }
document.getElementById("c-orient").textContent = state.orient === "horizontal" ? "⇄" : "⇅";

document.getElementById("c-orient").addEventListener("click", toggleOrient);
document.getElementById("c-fit").addEventListener("click", () => fitView(true));
document.getElementById("c-front").addEventListener("click", () => { const n = newestFrontier(); if (n) centerOn(n.id, true); });
document.getElementById("c-in").addEventListener("click", () => { const r = viewport(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.25); });
document.getElementById("c-out").addEventListener("click", () => { const r = viewport(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 0.8); });

window.addEventListener("keydown", e => {
  if (e.target.closest("dialog")) return;
  if (e.key === "f" || e.key === "F") fitView(true);
  else if (e.key === "c" || e.key === "C") { const n = newestFrontier(); if (n) centerOn(n.id, true); }
  else if (e.key === "o" || e.key === "O") toggleOrient();
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
// a node file usually opens with its own "# Goal" / "# Conclusion" heading; the drawer
// already labels the section, so drop that leading heading to avoid the doubled title.
function stripLeadingHeading(src, title) {
  if (!src) return src;
  const lines = src.replace(/\\r/g, "").split("\\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  const h = lines[i] && lines[i].match(/^#{1,6}\\s+(.*)$/);
  if (h && h[1].trim().toLowerCase() === title.toLowerCase()) { lines.splice(i, 1); return lines.join("\\n"); }
  return src;
}
// human-readable state: the drawer says what the status *means*, not just its name
function statusInfo(m) {
  const k = statusKind(m);
  if (!m.parent_id) return { k, word: "objective", desc: "root of the exploration — the north-star question" };
  const map = {
    working:   { word: "working",   desc: "in progress — not yet concluded" },
    promising: { word: "promising", desc: "resolved, worth expanding — on the frontier" },
    open:      { word: "open",      desc: "created, not yet resolved — on the frontier" },
    answered:  { word: "answered",  desc: "resolved — its local question is settled" },
    dead:      { word: "dead-end",  desc: "pruned — resolved, not worth expanding" },
  };
  return Object.assign({ k: k }, map[k] || map.open);
}
function renderDrawer(d) {
  if (!d) return;
  const m = d.meta;
  const si = statusInfo(m);
  const nb = m.notebook_ok === true ? '<span class="chip nb-ok">◇ notebook clean</span>'
           : m.notebook_ok === false ? '<span class="chip nb-bad">◈ notebook failed</span>' : "";
  const adopted = m.created_by === "adopt" ? '<span class="chip adopt">◌ adopted</span>' : "";
  const hasConc = !!(d.conclusion && d.conclusion.trim());
  const files = (d.files || []).map(f =>
    '<a href="/api/file?id=' + encodeURIComponent(m.id) + "&name=" + encodeURIComponent(f) + '" target="_blank" rel="noopener">' + esc(f) + "</a>"
  ).join("");
  els.drawer.innerHTML =
    '<div class="d-pad">' +
      '<div class="d-titlebar">' +
        '<div class="d-title">' +
          '<div class="d-slug">' + esc(shortId(m.id)) + "</div>" +
          '<div class="d-fullid">' + esc(m.id) + "</div>" +
        "</div>" +
        '<button class="d-close" id="d-close" aria-label="close" title="Close (Esc)">✕</button>' +
      "</div>" +
      '<div class="d-hero k-' + si.k + '">' +
        '<span class="d-glyph">' + glyphChar(m) + "</span>" +
        '<div class="d-hero-txt">' +
          '<div class="d-status">' + esc(si.word) + "</div>" +
          '<div class="d-status-sub">' + esc(si.desc) + "</div>" +
        "</div>" +
      "</div>" +
      '<div class="d-chips">' +
        '<span class="chip type">type <span class="k">' + esc(m.type) + "</span></span>" +
        adopted + nb +
      "</div>" +
      '<dl class="d-facts">' +
        '<div><dt>seq</dt><dd>' + esc(m.seq) + "</dd></div>" +
        '<div><dt>created by</dt><dd>' + esc(m.created_by) + "</dd></div>" +
        '<div><dt>updated</dt><dd>' + esc(m.ts ? agoLabel(m.ts) : "—") + "</dd></div>" +
      "</dl>" +
      '<div class="d-sec"><h3>Goal</h3><div class="md">' + (md(stripLeadingHeading(d.goal, "goal")) || '<span class="none">no goal.md</span>') + "</div></div>" +
      '<div class="d-sec' + (hasConc ? "" : " empty") + '"><h3>Conclusion</h3><div class="md">' + (md(stripLeadingHeading(d.conclusion, "conclusion")) || '<span class="none">— not concluded yet —</span>') + "</div></div>" +
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
function send(res, code, type, body) {
    res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-cache" });
    res.end(body);
}
function cmdServe(ws, flags) {
    if (!fs.existsSync(P.jsonl(ws)))
        die("no tree.jsonl in workspace — run init first");
    const port = Number(flags.port) || 4173;
    const clients = new Set();
    const pushTree = () => {
        const data = JSON.stringify(treeSnapshot(ws));
        for (const res of clients)
            res.write(`event: tree\ndata: ${data}\n\n`);
    };
    // Watch the append-only log; every mutation (add/set/status/…) lands as a new line and
    // fans out to every connected browser. Debounced so a burst of writes coalesces.
    let timer = null;
    const onChange = () => {
        if (timer)
            clearTimeout(timer);
        timer = setTimeout(pushTree, 100);
    };
    try {
        fs.watch(P.jsonl(ws), onChange);
    }
    catch {
        fs.watchFile(P.jsonl(ws), { interval: 500 }, onChange); // fallback for platforms without fs.watch
    }
    const server = http.createServer((req, res) => {
        const url = new URL(req.url || "/", `http://localhost:${port}`);
        const p = url.pathname;
        try {
            if (p === "/")
                return send(res, 200, "text/html; charset=utf-8", DASHBOARD_HTML);
            if (p === "/api/tree")
                return send(res, 200, "application/json", JSON.stringify(treeSnapshot(ws)));
            if (p === "/api/objective")
                return send(res, 200, "text/plain; charset=utf-8", readIfExists(P.objective(ws)));
            if (p.startsWith("/api/node/")) {
                const d = nodeDetail(ws, decodeURIComponent(p.slice("/api/node/".length)));
                return d ? send(res, 200, "application/json", JSON.stringify(d)) : send(res, 404, "application/json", "null");
            }
            if (p === "/api/file") {
                const id = url.searchParams.get("id") || "";
                const name = url.searchParams.get("name") || "";
                if (!/^[\w.-]+$/.test(id) || !/^[\w.-]+$/.test(name))
                    return send(res, 400, "text/plain", "bad path");
                const fp = path.join(P.nodeDir(ws, id), name);
                if (!fs.existsSync(fp))
                    return send(res, 404, "text/plain", "not found");
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
        }
        catch (e) {
            send(res, 500, "text/plain", e && e.message ? e.message : String(e));
        }
    });
    server.on("error", (e) => {
        if (e.code === "EADDRINUSE")
            die(`port ${port} is in use — pass --port <n>`);
        die(e.message || String(e));
    });
    server.listen(port, () => {
        process.stdout.write(`analysis-tree dashboard live at http://localhost:${port}  (Ctrl-C to stop)\n`);
    });
}
// ---------- dispatch ----------
function main() {
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
                process.stdout.write([
                    "analysis-tree CLI",
                    "usage: node tree.js <verb> [args] [--ws <path>]",
                    "",
                    "  init --root-goal <text>",
                    "  add --parent <id> --goal <text> [--type <t>] [--slug <kebab>] [--created-by <who>]",
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
                ].join("\n") + "\n");
                process.exit(verb ? 1 : 0);
        }
    }
    catch (e) {
        die(e && e.message ? e.message : String(e));
    }
}
main();
