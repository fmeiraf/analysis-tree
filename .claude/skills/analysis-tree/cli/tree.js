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
function appendLine(ws, line) {
    fs.appendFileSync(P.jsonl(ws), JSON.stringify(line) + "\n");
}
/** Merge current state of an id with a patch, and append the resulting full line. */
function mutate(ws, id, patch) {
    const cur = remount(ws, { includeDeleted: true }).get(id);
    if (!cur)
        throw new Error(`No such node: ${id}`);
    const next = { ...cur, ...patch };
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
    const id = `node_${seq}_${slugify(goal)}`;
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
        const line = `${prefix}${branch}${GLYPH[node.status]} ${node.id}  ${node.goal}${mark}`;
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
    const nbName = typeof flags.file === "string" ? flags.file : "notebook.ipynb";
    const nbPath = path.join(P.nodeDir(ws, id), nbName);
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
            default:
                process.stdout.write([
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
