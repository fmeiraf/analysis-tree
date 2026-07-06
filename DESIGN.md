<!-- SEED: re-run /impeccable document once the redesigned dashboard is built, to capture the actual tokens and generate the .impeccable/design.json sidecar. Values below are committed design intent, not placeholders. -->
---
name: analysis-tree · Observatory
description: A live decision-tree dashboard rendered as a deep field where the search frontier glows.
colors:
  field: "oklch(0.15 0.018 250)"
  field-lift: "oklch(0.185 0.02 250)"
  hairline: "oklch(0.30 0.02 250)"
  edge: "oklch(0.34 0.02 250)"
  ink: "oklch(0.92 0.008 250)"
  ink-dim: "oklch(0.64 0.015 250)"
  frontier: "oklch(0.86 0.19 130)"
  frontier-core: "oklch(0.93 0.15 130)"
  open: "oklch(0.70 0.09 130)"
  answered: "oklch(0.70 0.04 210)"
  dead: "oklch(0.44 0.006 250)"
  adopted: "oklch(0.72 0.13 305)"
typography:
  display:
    fontFamily: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace"
    fontSize: "clamp(1.1rem, 2.2vw, 1.5rem)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  label:
    fontFamily: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0"
  meta:
    fontFamily: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.01em"
rounded:
  none: "0px"
  sm: "3px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  node-frontier:
    textColor: "{colors.frontier}"
    typography: "{typography.label}"
  node-pruned:
    textColor: "{colors.dead}"
    typography: "{typography.label}"
  tag-adopted:
    textColor: "{colors.adopted}"
    rounded: "{rounded.pill}"
    padding: "0 6px"
---

# Design System: analysis-tree · Observatory

## 1. Overview

**Creative North Star: "The Observatory"**

The dashboard is an instrument trained on a live search. You are not reading a file list — you are
watching an exploration move through a dark field, the way an observatory watches a sky. The tree
is drawn as a real **decision tree** on a pan/zoom canvas — **horizontal by default** (root at the
left, the search flowing rightward; toggle to top-down vertical), depth carried along the growth
axis, the leaves (the live edge of the search) at the leading end. Parents center over their
children (tidy layout); orthogonal flowchart connectors make each logical parent→child step
explicit. What matters glows. The live **frontier** — the nodes the search could expand next —
emits a soft phosphor-chartreuse light and breathes; a node being worked pulses brightest; a
**pruned** branch goes cold and dim and recedes. You feel the state of the search before you read a
single label.

This system rejects, by name, the thing it replaces: the **github-dark devtool skin** (`#0f1115`
slate, `#5b9dff` blue accent, muted-gray everything) and the whole **generic-SaaS dashboard**
family — cards-in-cards, rounded tiles, one blue accent, the hero-metric row. Above all it rejects
the **indented text list with collapse chevrons pretending to be a tree**. This tool is *about* a
tree; it must look and behave like one. Depth comes from **light and position, not from boxes**.

**Key Characteristics:**
- A node-link **decision tree** on a pan/zoom canvas — horizontal (default) or top-down vertical,
  toggleable — not an outline; branches and depth are the layout; labels truncate to fit with the
  full text on hover; the camera eases to each new node.
- One signature light: phosphor-chartreuse marks "alive / on the frontier".
- State reads pre-attentively through luminance; a distinct glyph always backs the color.
- Mono-forward and grid-aligned — a precise instrument, dense and calm.
- A single committed deep mode. There is no light theme; the dark field is the concept.

## 2. Colors: The Deep-Field Palette

A near-black tinted field, near-white ink, and one living accent. Saturation appears only where the
search is alive; everything resolved or dead drains toward cold neutral.

### Primary
- **Phosphor** (`oklch(0.86 0.19 130)`): the signature. The live frontier — `open` and `promising`
  nodes — and the "live" connection dot. It glows (a soft halo) and, while a node is *working*,
  breathes. This is the only saturated color that carries weight; its rarity is what makes "where
  the search is" legible at a glance. A brighter **Phosphor Core** (`oklch(0.93 0.15 130)`) lights
  the center of a working node's halo.

### Secondary
- **Adopted Violet** (`oklch(0.72 0.13 305)`): provenance only. Marks nodes imported via the
  `adopt` branch — a cool counter-hue to Phosphor so "grown by the search" vs "brought in from
  outside" reads without a legend.

### Neutral
- **Field** (`oklch(0.15 0.018 250)`): the deep near-black base, tinted a hair toward cool blue —
  its own hue, never toward warmth. The sky.
- **Field Lift** (`oklch(0.185 0.02 250)`): the one lifted surface — the node detail pane. A step
  up in lightness, never a shadowed card.
- **Ink** (`oklch(0.92 0.008 250)`): primary text — goals, headings. ≥4.5:1 on Field.
- **Ink Dim** (`oklch(0.64 0.015 250)`): metadata, node ids, timestamps — the "machine" data.
- **Edge** (`oklch(0.34 0.02 250)`): the tree's connecting lines. Faint at rest; an edge leading
  into a frontier node brightens toward Phosphor.
- **Hairline** (`oklch(0.30 0.02 250)`): the single divider between tree and detail pane.
- **Answered** (`oklch(0.70 0.04 210)`): a resolved, settled node — cool and calm, off the frontier.
- **Dead** (`oklch(0.44 0.006 250)`): pruned. Cold, desaturated, dimmed; recedes into the field.

### Named Rules
**The One Light Rule.** Phosphor appears only on the live frontier and its halo — never as
decoration, never on chrome, never as a fill. If more than a fraction of the field is glowing, the
frontier has stopped meaning "here".

**The Own-Hue Rule.** Every neutral tints toward the field's cool blue (hue ~250), never toward
warm "for atmosphere". Warmth-by-default in the surface is the AI move; the mood lives in Phosphor.

## 3. Typography

**Display / Body / Label / Meta Font:** system monospace — `ui-monospace, 'SF Mono', 'JetBrains
Mono', Menlo, Consolas, monospace`. One family throughout; **weight is the hierarchy.** No external
fonts: the dashboard ships as one offline page.

**Character:** an instrument readout, not prose. Everything aligns to a mono grid; numbers are
tabular; ids and labels sit on the same rhythm. Density feels precise, not cramped.

### Hierarchy
- **Display** (600, `clamp(1.1rem, 2.2vw, 1.5rem)`, 1.15, -0.01em): the objective / header line.
- **Label** (500, 13px, 1.4): node goals and the selected node's title — the thing you read.
- **Meta** (400, 11px, 0.01em): node ids, seq, timestamps, status words — Ink Dim, the machine data.

### Named Rules
**The Weight-Not-Size Rule.** Hierarchy is carried by weight and luminance on a near-constant type
size, so the tree stays dense and grid-true. Jumping font sizes per level would break the grid the
instrument depends on.

## 4. Elevation

**There are no shadows and no cards.** Depth is conveyed entirely by **luminance and glow** — the
observatory's whole thesis. A node advances or recedes by how much light it emits: a working node
glows and breathes; a frontier node holds a soft steady halo; an answered node sits calm; a pruned
node dims into the field. The only lifted surface is the detail drawer, raised by a single step of
lightness (Field → Field Lift) and a Hairline left border, never by a decorative drop shadow (it
carries one soft depth shadow along its edge to read as "above" the canvas).

### Glow Vocabulary
- **Frontier halo** (`0 0 12px oklch(0.86 0.19 130 / 0.35)`): soft radial light on live nodes.
- **Working pulse**: the halo animates 0.35→0.6→0.35 opacity on a slow ease; the node is alive.
- **Reduced-motion fallback**: the pulse resolves to a static mid-strength halo — status stays
  fully legible with no motion.

### Named Rules
**The No-Box Rule.** Nothing that is a node gets a border, a fill, or a corner radius. Nodes are
points of light and text on the field. Boxes are how the old outline faked structure; the tree's
real structure is its edges and positions.

## 5. Components

### Node (the signature component)
- **Form:** a status **glyph** + monospace label sitting on the field at its depth in the tree — no
  box, no fill. Connected to its parent by an **Edge** line.
- **Status is a distinct glyph, always** (never color alone): `○` open · `◐` working (pulsing) ·
  `●` promising · `✓` answered · `✗` dead-end. Color/luminance reinforces; glyph carries.
- **Frontier nodes** (`open` / `promising`): Phosphor label + halo; edge into them brightens.
- **Pruned nodes** (`dead-end`): Dead color, label struck or dimmed, recedes.
- **Selected:** a faint Phosphor focus ring (keyboard-focusable, `:focus-visible`); the camera
  eases to center the node and the detail drawer opens.
- **Adopted:** a dashed **Adopted Violet** ring around the glyph (provenance), and an `adopted`
  violet pill in the drawer; violet is the counter-hue to Phosphor.

### Canvas (pan / zoom)
- **Model:** the tree lives on a pannable, zoomable SVG canvas. Drag to pan, wheel/pinch to zoom
  about the cursor, orientation toggle (`⇄`/`⇅`) / `fit` / recenter-on-`frontier` / `+` / `−`
  controls (also `O` / `F` / `C` / `+` / `−` keys). Strokes are non-scaling (hairline at any zoom).
- **Orientation:** horizontal (default) or vertical top-down, toggled with `⇄`/`O` and remembered
  per browser. Horizontal gives labels their own row (fits longer text); vertical centers labels
  under each node.
- **Labels:** every node's mono label reads by default (dimmed); frontier, selected, and hovered
  nodes brighten to full. Labels **truncate to fit their lane** (`…`); the full slug + goal live in
  a hover tooltip and the drawer, so nothing is lost. Readability of the logical steps is the point.

### Edges (tree connectors)
- **Style:** thin Edge-colored **orthogonal flowchart connectors** (down from the parent, a rounded
  elbow at the midline, across, then down into the child), drawn as the layout, so the branching
  *is* the structure. An edge terminating in a frontier node grades toward Phosphor.

### Detail drawer
- **Surface:** Field Lift, slides in from the right over the full-width canvas; native `<dialog>`
  (Escape + focus-trap), light-dismiss on backdrop click, ✕ to close, focus returns to the node.
- **Contents:** selected node's goal (Ink), conclusion (Ink), status + type + notebook + adopted
  badges, seq/provenance meta, file links. Rendered as readout, not a card stack.

### Live indicator
- **Dot:** Phosphor when the SSE stream is connected (the observatory is watching), Dead when not.

## 6. Do's and Don'ts

### Do:
- **Do** render the exploration as a spatial decision tree — branches and depth as layout, edges
  drawn between parent and child. The shape must be legible before any label is read.
- **Do** carry state with luminance and glow: frontier glows Phosphor, working breathes, answered
  settles cool, pruned dims into the field.
- **Do** back every status with a distinct glyph (`○ ◐ ● ✓ ✗`) so it survives color-blindness and
  reduced-motion.
- **Do** keep it dense and grid-true — one mono family, weight for hierarchy, tabular metadata.
- **Do** honor `prefers-reduced-motion`: the pulse becomes a static halo, nothing else moves.

### Don't:
- **Don't** ship the **github-dark devtool skin** — no `#0f1115` slate field, no `#5b9dff` blue
  accent, no muted-gray-on-slate. That is exactly what this replaces.
- **Don't** build a **generic-SaaS dashboard**: no cards-in-cards, no rounded tiles, no hero-metric
  row, no second accent competing with Phosphor.
- **Don't** render the tree as an **indented text list with collapse chevrons.** An outline is not
  a tree. Nodes are points of light on the field, not rows.
- **Don't** put a border, fill, or corner radius on a node (The No-Box Rule), or a drop shadow
  anywhere (depth is light, not shadow).
- **Don't** let Phosphor spread past the live frontier, and don't tint neutrals warm — both dilute
  the one signal the instrument exists to show.
