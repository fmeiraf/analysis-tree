#!/usr/bin/env bash
#
# Install the `analysis-tree` skill into a repo's (or your user-level) .claude/skills/.
#
# Usage:
#   ./install.sh                 # into ./.claude/skills/ (current repo)
#   ./install.sh --user          # into ~/.claude/skills/ (all your projects)
#   ./install.sh --dest DIR      # into DIR/analysis-tree
#
# One-liner (from anywhere, downloads the skill):
#   curl -fsSL https://raw.githubusercontent.com/fmeiraf/analysis-tree/master/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/fmeiraf/analysis-tree/master/install.sh | bash -s -- --user

set -euo pipefail

REPO="fmeiraf/analysis-tree"
BRANCH="master"
SKILL="analysis-tree"
SUBPATH=".claude/skills/${SKILL}"

DEST_BASE="./.claude/skills"

while [ $# -gt 0 ]; do
  case "$1" in
    --user) DEST_BASE="$HOME/.claude/skills" ;;
    --dest) DEST_BASE="${2:?--dest needs a directory}"; shift ;;
    -h|--help)
      sed -n '3,14p' "$0" 2>/dev/null || echo "see header of install.sh"
      exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

# --- prerequisites ---
if ! command -v node >/dev/null 2>&1; then
  echo "error: 'node' is required to run the analysis-tree CLI (tree.js). Install Node first." >&2
  exit 1
fi

# --- locate the skill source: local clone if present, else download a tarball ---
SRC=""
SOURCE="${BASH_SOURCE[0]:-}"
if [ -n "$SOURCE" ] && [ -f "$SOURCE" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
  [ -d "$SCRIPT_DIR/$SUBPATH" ] && SRC="$SCRIPT_DIR/$SUBPATH"
fi

CLEANUP=""
if [ -z "$SRC" ]; then
  command -v curl >/dev/null 2>&1 || { echo "error: need curl to download the skill" >&2; exit 1; }
  TMP="$(mktemp -d)"
  CLEANUP="$TMP"
  echo "downloading $SKILL from github.com/$REPO@$BRANCH ..."
  curl -fsSL "https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz" | tar -xz -C "$TMP"
  SRC="$TMP/${SKILL}-${BRANCH}/$SUBPATH"
fi

if [ ! -d "$SRC" ]; then
  echo "error: could not find skill source at $SRC" >&2
  exit 1
fi

# --- install (copy, excluding build-time node_modules) ---
DEST="$DEST_BASE/$SKILL"
mkdir -p "$DEST_BASE"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"
rm -rf "$DEST/cli/node_modules"

[ -n "$CLEANUP" ] && rm -rf "$CLEANUP"

# --- verify the CLI runs ---
if node "$DEST/cli/tree.js" >/dev/null 2>&1; then
  echo "✓ installed $SKILL -> $DEST"
  echo "  CLI ok: node $DEST/cli/tree.js"
  echo
  echo "Next: open this repo in Claude Code and invoke the 'analysis-tree' skill"
  echo "(it is user-invoked — type its name). It will interview you for an objective"
  echo "and start building the exploration tree."
else
  echo "installed to $DEST, but 'node tree.js' did not run cleanly — check your Node install." >&2
  exit 1
fi
