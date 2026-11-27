#!/bin/bash
# Runs one Codex CLI worker (ChatGPT plan login, `codex login --device-auth`) in its own git worktree, so its changes
# can be reviewed and merged like a branch. The brief goes in on stdin (the variadic --image flag would swallow a
# positional prompt).
#
#   tools/codex-agent.sh <name> <brief.md> [image ...]
#   e.g. tools/codex-agent.sh rooms briefs/rooms.md shots/a.png shots/b.png
#
# The sandbox is workspace-write with network access (so the worker can run vite preview + Playwright renders on
# localhost and view them); it cannot write .git, so it never commits. Review `git diff` in the worktree, then commit
# there and merge the branch cx/<name>. CODEX_MODEL / CODEX_EFFORT override the model and reasoning effort.
set -u
NAME=$1
BRIEF=$(realpath "$2")
shift 2
IMAGES=()
for f in "$@"; do IMAGES+=("--image=$(realpath "$f")"); done
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(git -C "$HERE" rev-parse --show-toplevel)
WORK=${OC_WORK:-$ROOT/../oc-work}
WT=$WORK/wt/$NAME
LOG=$WORK/logs/$NAME.log
mkdir -p "$WORK/wt" "$WORK/logs"
if [ -d "$WT" ] && [ "$(git -C "$WT" branch --show-current)" != "cx/$NAME" ]; then
  echo "worktree $WT belongs to $(git -C "$WT" branch --show-current), not cx/$NAME: pick another name" >&2
  exit 1
fi
if [ ! -d "$WT" ]; then
  git -C "$ROOT" worktree add -q "$WT" -b "cx/$NAME" HEAD
  ln -s "$ROOT/studio/node_modules" "$WT/studio/node_modules"
  [ -d "$ROOT/studio/.cache" ] && ln -s "$ROOT/studio/.cache" "$WT/studio/.cache"
fi
cd "$WT/studio" || exit 1
echo "== $NAME (codex) at $(date +%T)" > "$LOG"
timeout 7200 codex exec -s workspace-write -c sandbox_workspace_write.network_access=true \
  -c model_reasoning_effort="${CODEX_EFFORT:-high}" ${CODEX_MODEL:+-m "$CODEX_MODEL"} \
  "${IMAGES[@]}" < "$BRIEF" >> "$LOG" 2>&1
echo "== exit $? at $(date +%T)" >> "$LOG"
tail -30 "$LOG"
