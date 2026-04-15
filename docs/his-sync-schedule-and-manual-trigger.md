# HIS Snapshot 同步排程與手動觸發

日期：2026-04-16

這份文件說明 ChatICU 與 HIS 同步的自動排程與**手動強制掃描**流程。

---

## 1. 自動排程（launchd）

### 現行排程

| 時間 | 用途 |
|------|------|
| **每天 06:00** | 配合晨會前更新 |
| **每天 18:00** | 配合晚查房更新 |

排程由 macOS launchd 管理，不走 cron。

### 設定檔位置

```
~/Library/LaunchAgents/com.chaticu.his-sync.plist
```

### 關鍵欄位

```xml
<key>ProgramArguments</key>
<array>
  <string>/Users/chun/Workspace/ChatICU_2026_verf_0110_Yu/backend/scripts/run_his_snapshot_sync.sh</string>
  <string>--state-file</string>
  <string>/Users/chun/Workspace/ChatICU_2026_verf_0110_Yu/backend/.state/his_snapshot_sync_state.json</string>
</array>

<key>StartCalendarInterval</key>
<array>
  <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>0</integer></dict>
  <dict><key>Hour</key><integer>18</integer><key>Minute</key><integer>0</integer></dict>
</array>

<key>RunAtLoad</key>
<false/>
```

### 要改時間的話

1. 編輯 plist 裡面的 `Hour` / `Minute`
2. 重新載入：
   ```bash
   launchctl unload ~/Library/LaunchAgents/com.chaticu.his-sync.plist
   launchctl load ~/Library/LaunchAgents/com.chaticu.his-sync.plist
   launchctl list | grep chaticu   # 確認已註冊
   ```

### Log 位置

```
backend/.logs/his-sync.stdout.log
backend/.logs/his-sync.stderr.log
```

`LastExitStatus`（`launchctl list com.chaticu.his-sync` 可看）不為 0 時，先看 stderr log。

---

## 2. 手動強制掃描（保留用）

即使 launchd 已經排程，仍可以**隨時手動觸發**一次完整掃描，忽略 hash 比對直接重跑全部病人。

### 最重要：環境變數與絕對路徑

**`SYNC_ENV_PATH` 必須是絕對路徑**。`run_his_snapshot_sync.sh` 會先 `cd "$BACKEND_DIR"` 再檢查 env 檔，相對路徑會落在 `backend/backend/...` 找不到 → 會 fallback 去讀 `backend/.env`，結果寫到本地 docker，不會進雲端 Supabase。

### 指令（推薦，直接照抄）

```bash
# 1. 清掉可能殘留的環境變數
unset SYNC_ENV_PATH DATABASE_URL

# 2. 設定絕對路徑的 env 檔
export SYNC_ENV_PATH=/Users/chun/Workspace/ChatICU_2026_verf_0110_Yu/backend/.env.his-sync

# 3. 背景執行，輸出導到檔案（--force 忽略 hash 比對）
bash /Users/chun/Workspace/ChatICU_2026_verf_0110_Yu/backend/scripts/run_his_snapshot_sync.sh --force \
  > /tmp/his_sync_run.log 2>&1 &

# 4. 記下 PID，監看進度
echo "PID=$!"
tail -f /tmp/his_sync_run.log
```

### 旗標說明

| 旗標 | 用途 | 什麼時候用 |
|------|------|----------|
| *（無）* | 只同步 hash 有變的病人 | 日常排程，快 |
| `--force` | 所有病人都重跑，忽略 hash | 雲端資料疑似丟失、改過 converter 邏輯想回填、驗證流水線 |
| `--patient 16312169` / `-p` | 只同步單一病歷號 | 偵錯、測新病人 |
| `--dry-run` | 只預覽，不寫 DB | 確認會動到哪些病人 |
| `--concurrency 4` | 並行同步的病人數（預設 2） | 想加快，但 Supabase pooler 會變緊 |
| `--state-file <path>` | 指定 state 檔 | 多環境互不干擾 |

### 組合範例

```bash
# 只強制同步單一病人
bash backend/scripts/run_his_snapshot_sync.sh --force -p 16312169

# 乾跑，不寫 DB，看哪些病人會被掃到
bash backend/scripts/run_his_snapshot_sync.sh --dry-run

# 並行 4 個病人強制同步（小心 pooler 連線上限）
bash backend/scripts/run_his_snapshot_sync.sh --force --concurrency 4
```

---

## 3. 驗證是否有進雲端 Supabase

手動跑完或排程跑完後，驗證雲端資料真的有更新（尤其是用 `--force` 的時候，避免寫錯 DB）：

```bash
python3 -c "
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

# 從 backend/.env.his-sync 讀 DATABASE_URL
url = 'postgresql+asyncpg://postgres.gqicofefwvrscmvabrbt:***@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres'

async def main():
    eng = create_async_engine(url, connect_args={
        'prepared_statement_cache_size': 0,
        'statement_cache_size': 0,
    })
    async with eng.connect() as c:
        r = await c.execute(text(
            'SELECT version, last_synced_at, '
            'jsonb_array_length(COALESCE(details->\\'recent_deltas\\', \\'[]\\'::jsonb)) '
            'FROM sync_status LIMIT 1'
        ))
        print('sync_status:', r.fetchone())
        for t in ['medications', 'lab_data', 'culture_results', 'diagnostic_reports']:
            r = await c.execute(text(f'SELECT COUNT(*), MAX(created_at) FROM {t}'))
            print(f'{t}:', r.fetchone())
    await eng.dispose()

asyncio.run(main())
"
```

**預期輸出**：
- `sync_status.version` 應為剛剛同步的時間戳（非 `2026-04-15T02:59:09` 這種舊值）
- 各表的 `max(created_at)` 應為今天
- `recent_deltas` 長度 = 有真實新增的病人數（零變動病人不入 ring buffer）

---

## 4. 常見踩雷

### 雷 1：執行結果寫到本地 docker，不是雲端 Supabase

**症狀**：命令成功、有 delta 輸出，但雲端 `sync_status.version` 沒動、`MAX(created_at)` 沒進。

**原因**：`SYNC_ENV_PATH` 用了相對路徑，env 檔沒 source 到，Python fallback 讀 `backend/.env`（指向 `localhost:5433` docker `backend-db-1`）。

**解法**：`SYNC_ENV_PATH` 一定用絕對路徑，或直接 `unset` 讓 wrapper 用預設的絕對路徑 `$BACKEND_DIR/.env.his-sync`。

### 雷 2：`MaxClientsInSessionMode: max clients reached`

**症狀**：16 個病人全部 error、`LastExitStatus=256`。

**原因**：`DATABASE_URL` 用了 Supabase 的 **session mode** pool（port **5432**），同時連線上限很低。

**解法**：`.env.his-sync` 裡改用 **transaction mode**：
```
DATABASE_URL=postgresql+asyncpg://...@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres
```
（port **6543**）。script 已預設 `statement_cache_size=0`、`prepared_statement_cache_size=0`，相容 transaction mode。

### 雷 3：`--force` 執行完 `recent_deltas` 沒有新事件

**不是 bug**：同 snapshot 強制重跑時，incoming ID 集合 = 既有 ID 集合 → 差集為空 → 事件被判定為零變動 → 不進 ring buffer（避免前端 toast 刷屏）。

**想看到 delta**：換一個真的有差別的 snapshot 跑，或手動從 DB 刪幾筆再跑 `--force`。

### 雷 4：launchd 沒在該跑的時候跑

**排查**：
```bash
launchctl list com.chaticu.his-sync   # LastExitStatus 不為 0 → 看 stderr log
plutil -p ~/Library/LaunchAgents/com.chaticu.his-sync.plist   # 確認 StartCalendarInterval 正確
tail -50 backend/.logs/his-sync.stderr.log
```

Mac 睡眠時 launchd 不會觸發漏掉的排程（這點和 cron 類似但更嚴格）。需要喚醒時執行可搭配 `pmset` 的 wake schedule，本專案目前不需要。

---

## 5. 參考檔案

| 檔案 | 用途 |
|------|------|
| `backend/scripts/run_his_snapshot_sync.sh` | launchd/手動都用這支 wrapper，會 source `.env.his-sync` |
| `backend/scripts/sync_his_snapshots.py` | 實際的 Python sync 腳本（`--force` / `--dry-run` / `-p` 都在這） |
| `backend/scripts/install_his_sync_launchd.sh` | 安裝/更新 launchd plist 的腳本 |
| `backend/.env.his-sync` | 雲端 Supabase 的 DATABASE_URL（**gitignore**，絕對路徑） |
| `backend/.state/his_snapshot_sync_state.json` | 每個病人最後一次 hash / snapshot_id（state 檔，同步關鍵） |
| `backend/.logs/his-sync.stdout.log` | launchd 的 stdout |
| `backend/.logs/his-sync.stderr.log` | launchd 的 stderr |
| `~/Library/LaunchAgents/com.chaticu.his-sync.plist` | launchd 排程定義 |
| `docs/patient-field-auto-sync-design.md` | delta 偵測機制的設計文件（步驟 1B） |
