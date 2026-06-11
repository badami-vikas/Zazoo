#!/usr/bin/env bash
# Install (or reinstall) the Recon scheduler as a launchd LaunchAgent.
#
#   ./deploy/install.sh            # install + load (starts the daemon)
#   ./deploy/install.sh --no-load  # write the plist but don't start it yet
#
# Idempotent: unloads any existing agent before reloading.
set -euo pipefail

RECON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="$(dirname "$(command -v node)")"
NODE="$NODE_BIN/node"
LABEL="ai.bridge.recon.scheduler"
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
TEMPLATE="$RECON_DIR/deploy/$LABEL.plist"

echo "Recon dir : $RECON_DIR"
echo "node      : $NODE"
echo "plist     : $DEST"

mkdir -p "$HOME/Library/LaunchAgents" "$RECON_DIR/data"

# Substitute tokens → real launchd plist.
sed -e "s#__NODE__#$NODE#g" \
    -e "s#__NODE_BIN__#$NODE_BIN#g" \
    -e "s#__RECON_DIR__#$RECON_DIR#g" \
    "$TEMPLATE" > "$DEST"

# Reload cleanly if already present.
launchctl unload "$DEST" 2>/dev/null || true

if [[ "${1:-}" == "--no-load" ]]; then
  echo "✓ plist written (not loaded). Start later with:  launchctl load -w \"$DEST\""
  exit 0
fi

launchctl load -w "$DEST"
echo "✓ loaded. Daemon is running under launchd."
echo "  logs   : tail -f \"$RECON_DIR/data/scheduler.log\""
echo "  pause  : touch \"$RECON_DIR/data/PAUSE\""
echo "  stop   : launchctl unload \"$DEST\""
echo "  status : node \"$RECON_DIR/scripts/scheduler.mjs\" --status"
