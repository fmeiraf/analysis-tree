# Product

## Register

product

## Users

The person running an `analysis-tree` exploration — a data scientist or engineer driving the
master loop. They often watch the dashboard on a second screen **while the agent drives the
search**, especially in auto mode. Their job at any moment: read the shape of the search — where
the live **frontier** is, which branches were pursued, which were **pruned** — and click any node
to inspect its goal, conclusion, and notebook status. They are not configuring anything here; the
dashboard is a read-only window onto a running exploration.

## Product Purpose

A live, self-contained dashboard (emitted by `tree.js serve`) that renders an analysis-tree
exploration as a navigable **decision tree** in real time. It exists so you can *watch reasoning
unfold* — see the frontier move, a branch resolve, a dead-end get cut — and remount the whole
line of "why we went here" at a glance. Success is a reader grasping the state and shape of the
search in one look, then drilling into any node without losing the thread.

## Brand Personality

Spatial, luminous, exact. It should feel like an **observatory** trained on an exploration —
atmospheric and quietly confident, precise rather than busy. Not playful, not corporate; the
composure of a good scientific instrument. The drama comes from the live search moving, not from
decoration.

## Anti-references

- **The current github-dark devtool skin** it's replacing: `#0f1115` slate field, `#5b9dff` blue
  accent, muted-gray everything — the generic dark-IDE look. Explicitly rejected.
- **Generic SaaS dashboards**: cards-in-cards, rounded tiles, one blue accent, nested panels, the
  hero-metric row. The whole family is out, not just its colors.
- **An indented text list with collapse chevrons pretending to be a tree.** The outline
  masquerading as structure. This tool is *about* a tree — it must look and behave like one.

## Design Principles

- **The tree is the interface.** Render the exploration as a real decision tree — branches,
  depth, and the frontier as spatial structure — not a text outline with toggles. The shape of
  the search must be legible before any label is read.
- **State through light, not chrome.** A node's role (working / frontier / answered / pruned)
  reads pre-attentively through luminance and emphasis — the live frontier glows, dead-ends dim —
  so you feel the state of the search, not parse it. Never by color/glow *alone*: shape and glyph
  carry status too, for color-blind and reduced-motion readers.
- **Dense but calm.** A large tree stays legible and navigable; density is a feature. The field
  around the nodes stays quiet so structure, not ornament, holds attention.
- **Real-time is the whole point.** The value is watching the search move. A node being worked, a
  branch resolving, a node adopted — each must register instantly and unmistakably, without the
  user hunting for what changed.
- **Self-contained and instant.** One offline HTML page, zero dependencies — it ships copied into
  every exploration and must open and render immediately, anywhere.

## Accessibility & Inclusion

Target WCAG AA for anything read as text: node labels and metadata hit ≥4.5:1 against the deep
field. Status is never encoded by color or glow alone — a distinct glyph/shape backs every state.
`prefers-reduced-motion` is honored: the frontier glow and "working" pulse have a calm, static
fallback (no motion, status still legible). Keyboard focus for node selection is preserved.
