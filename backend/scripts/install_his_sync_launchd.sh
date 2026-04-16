#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$BACKEND_DIR/.." && pwd)"

LABEL="com.chaticu.his-sync"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-300}"
LAUNCH_AGENTS_DIR="${LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
OUTPUT_PATH="${OUTPUT_PATH:-$LAUNCH_AGENTS_DIR/$LABEL.plist}"
WRAPPER_PATH="$BACKEND_DIR/scripts/run_his_snapshot_sync.sh"
LOG_DIR="${LOG_DIR:-$BACKEND_DIR/.logs}"
STATE_FILE="${STATE_FILE:-$BACKEND_DIR/.state/his_snapshot_sync_state.json}"
DATABASE_URL_VALUE="${DATABASE_URL:-}"

mkdir -p "$LAUNCH_AGENTS_DIR" "$LOG_DIR" "$(dirname "$STATE_FILE")"
chmod +x "$WRAPPER_PATH"

ENV_BLOCK=""
if [[ -n "$DATABASE_URL_VALUE" ]]; then
  ENV_BLOCK=$(cat <<ENV
    <key>EnvironmentVariables</key>
    <dict>
      <key>DATABASE_URL</key>
      <string>$DATABASE_URL_VALUE</string>
    </dict>
ENV
)
fi

cat > "$OUTPUT_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
      <string>$WRAPPER_PATH</string>
      <string>--state-file</string>
      <string>$STATE_FILE</string>
    </array>
$ENV_BLOCK
    <key>WorkingDirectory</key>
    <string>$REPO_ROOT</string>
    <key>StartInterval</key>
    <integer>$INTERVAL_SECONDS</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/his-sync.stdout.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/his-sync.stderr.log</string>
  </dict>
</plist>
PLIST

plutil -lint "$OUTPUT_PATH" >/dev/null
echo "Wrote launchd plist to: $OUTPUT_PATH"
echo "To enable:"
echo "  launchctl unload \"$OUTPUT_PATH\" 2>/dev/null || true"
echo "  launchctl load \"$OUTPUT_PATH\""
