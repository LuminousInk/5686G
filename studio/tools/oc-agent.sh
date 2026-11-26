#!/bin/bash
# Runs one coding agent on an OpenCode Go model (the Claude Code CLI pointed at the OpenCode gateway that
# `npx @opencode/console setup claude-code` configured), in its own git worktree, so its changes can be reviewed and
# merged like a branch.
#
#   tools/oc-agent.sh <name> <model> <brief.md> [extra-allowed-tools]
#   e.g. tools/oc-agent.sh doors opencode-go/kimi-k3 briefs/doors.md
#
# Go-plan models seen working: opencode-go/deepseek-v4.1-flash, opencode-go/deepseek-v4-pro, opencode-go/glm-5.3,
# opencode-go/kimi-k3, opencode-go/qwen3.8-flash, opencode-go/minimax-m3.
# Notes:
# - Go models need an x-opencode-session header; it is passed through --settings, because the env block in
#   ~/.claude/settings.json would override a plain environment variable.
# - The CLI runs with a clean environment: inside a Claude Code session the parent's provider variables would
#   otherwise pin it to Anthropic's API.
# - The agent may only edit files and run typecheck / lint / tests; it never commits. Review `git diff` in the
#   worktree, then commit there and merge the branch oc/<name>.
set -u
NAME=$1
MODEL=$2
BRIEF=$(realpath "$3")
EXTRA=${4:-}
ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
WORK=${OC_WORK:-$ROOT/../oc-work}
WT=$WORK/wt/$NAME
LOG=$WORK/logs/$NAME.log
mkdir -p "$WORK/wt" "$WORK/logs"
if [ ! -d "$WT" ]; then
  git -C "$ROOT" worktree add -q "$WT" -b "oc/$NAME" HEAD
  ln -s "$ROOT/studio/node_modules" "$WT/studio/node_modules"
  [ -d "$ROOT/studio/.cache" ] && ln -s "$ROOT/studio/.cache" "$WT/studio/.cache"
fi
cd "$WT/studio" || exit 1
SID="cuby-$NAME-$(date +%s)"
TOOLS="Read,Edit,Write,Glob,Grep,Bash(npx tsc:*),Bash(npx oxlint:*),Bash(npx vitest:*),Bash(npm run typecheck),Bash(npm run lint),Bash(npm test),Bash(git diff:*),Bash(git status:*),Bash(ls:*)${EXTRA:+,$EXTRA}"
echo "== $NAME on $MODEL at $(date +%T)" > "$LOG"
env -i HOME="$HOME" PATH="$PATH" TERM=dumb LANG=C.UTF-8 \
  HTTPS_PROXY="${HTTPS_PROXY:-}" https_proxy="${https_proxy:-}" NO_PROXY="${NO_PROXY:-}" no_proxy="${no_proxy:-}" \
  NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-}" SSL_CERT_FILE="${SSL_CERT_FILE:-}" REQUESTS_CA_BUNDLE="${REQUESTS_CA_BUNDLE:-}" \
  timeout 5400 claude -p "$(cat "$BRIEF")" \
  --settings "{\"env\":{\"ANTHROPIC_CUSTOM_HEADERS\":\"x-opencode-plugin: opencode-console/0.1.16\\nx-opencode-session: $SID\"}}" \
  --model "$MODEL" --permission-mode acceptEdits --allowedTools "$TOOLS" --output-format text >> "$LOG" 2>&1
echo "== exit $? at $(date +%T)" >> "$LOG"
tail -20 "$LOG"
