#!/bin/bash
# Runs one headless Gemini CLI worker in its own git worktree (like tools/oc-agent.sh), so its changes can be reviewed and
# merged like a branch.
#
#   tools/gemini-agent.sh <name> <model> <brief.md> [extra-policy.toml]
#   e.g. tools/gemini-agent.sh doors gemini-3-flash-preview briefs/doors.md
#   GEMINI_INCLUDE=/path/to/data tools/gemini-agent.sh ...   (lets the worker read a directory outside the worktree)
#
# Models seen working on a free-tier API key: gemini-3-flash-preview, gemini-3.5-flash-lite, gemini-3.1-flash-lite.
# Each model has its own free quota, so spread workers across them.
# Notes:
# - The key comes from the environment (GEMINI_API_KEY), or from a network secret that the session proxy adds to requests
#   to generativelanguage.googleapis.com (then any placeholder value works locally).
# - tools/gemini-policy.toml allows file edits, reads, web search and a short list of shell commands (typecheck, lint,
#   tests, git diff/status); everything else is denied. The worker never commits: review `git diff` in the worktree, then
#   commit there and merge the branch gm/<name>.
set -u
NAME=$1
MODEL=$2
BRIEF=$(realpath "$3")
EXTRA=${4:-}
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(git -C "$HERE" rev-parse --show-toplevel)
WORK=${OC_WORK:-$ROOT/../oc-work}
WT=$WORK/wt/$NAME
LOG=$WORK/logs/$NAME.log
mkdir -p "$WORK/wt" "$WORK/logs"
if [ ! -d "$WT" ]; then
  git -C "$ROOT" worktree add -q "$WT" -b "gm/$NAME" HEAD
  ln -s "$ROOT/studio/node_modules" "$WT/studio/node_modules"
  [ -d "$ROOT/studio/.cache" ] && ln -s "$ROOT/studio/.cache" "$WT/studio/.cache"
fi
cd "$WT/studio" || exit 1
POLICY=(--policy "$HERE/gemini-policy.toml")
[ -n "$EXTRA" ] && POLICY+=(--policy "$(realpath "$EXTRA")")
echo "== $NAME on $MODEL at $(date +%T)" > "$LOG"
GEMINI_API_KEY=${GEMINI_API_KEY:-from-proxy} NODE_USE_ENV_PROXY=1 GEMINI_CLI_TRUST_WORKSPACE=true NO_COLOR=1 \
  timeout 5400 gemini -m "$MODEL" --approval-mode auto_edit "${POLICY[@]}" ${GEMINI_INCLUDE:+--include-directories "$GEMINI_INCLUDE"} \
  -p "$(cat "$BRIEF")" >> "$LOG" 2>&1
echo "== exit $? at $(date +%T)" >> "$LOG"
grep -v -e UNDICI -e trace-warnings "$LOG" | tail -20
