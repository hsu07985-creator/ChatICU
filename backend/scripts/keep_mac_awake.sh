#!/bin/zsh
# keep_mac_awake.sh — 讓 Mac 在辦公時段不會睡眠，確保 launchd HIS 同步持續運作。
#
# 背景：HIS 每小時同步 (com.chaticu.his-sync) 依賴本機 launchd 排程。
# 如果 Mac 進入睡眠 → launchd 暫停 → patient/ 資料夾的新資料不會被吸進雲端 DB。
#
# 用法：
#   bash backend/scripts/keep_mac_awake.sh
#
# 這會持續執行直到你按 Ctrl+C 為止。建議在一個 terminal 視窗開著、不要關閉。
# 闔上筆電蓋子時不會睡眠 (-s flag 只在插電狀態有效，拔電源仍會睡)。
#
# 若要背景執行並保留 session 關閉後也繼續：
#   nohup bash backend/scripts/keep_mac_awake.sh > /dev/null 2>&1 &
#
# 停止背景執行的 caffeinate：
#   pkill -f 'caffeinate -i -s'

set -euo pipefail

echo "[$(date '+%Y-%m-%d %H:%M:%S')] keep_mac_awake: starting caffeinate -i -s"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] HIS sync launchd job: com.chaticu.his-sync (every 5 min)"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Press Ctrl+C to stop and allow normal sleep behavior"
echo ""

# -i  prevent idle sleep
# -s  prevent system sleep when on AC power (ignored on battery)
# Running without -t means caffeinate stays alive until killed.
exec caffeinate -i -s
