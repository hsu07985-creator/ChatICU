# LLM Continuation Prompt — ChatICU 接續開發指引

> **用途:** 提供給其他 LLM（或未來 Session）的接續開發 prompt，確保理解專案現狀、已完成修正、待辦任務與關鍵限制。
> **更新日期:** 2026-02-19
> **Branch:** `ai/meds-layout-api-sync`

---

## 一、技術棧說明

### 前端
| 項目 | 版本/說明 |
|------|-----------|
| **Framework** | Vite + React 18 + TypeScript |
| **UI Library** | Shadcn/ui (Radix primitives + Tailwind) |
| **CSS** | Tailwind CSS v4.1.3 **pre-compiled**（`src/index.css` = 4734+ 行已編譯 CSS，非 JIT） |
| **Root Font Size** | 瀏覽器預設 16px（Tailwind `--text-base: 1rem`） |
| **Router** | React Router v6 (SPA, `BrowserRouter`) |
| **HTTP Client** | Axios (httpOnly cookie auth, `src/lib/api-client.ts`) |
| **Markdown** | `react-markdown` (in `src/components/ui/ai-markdown.tsx`) |
| **Toast** | Sonner |
| **Icons** | Lucide React |
| **Charts** | Recharts (for lab trend charts) |
| **Build** | `npm run build` → 4 chunks (vendor/charts/ui/index), all < 500KB |
| **Dev Server** | Port 3000 |

### 後端
| 項目 | 版本/說明 |
|------|-----------|
| **Framework** | FastAPI + Uvicorn |
| **Python** | 3.9.6 (macOS system) — 必須用 `Optional[X]` 不能用 `X \| None` |
| **ORM** | SQLAlchemy 2.x (async, `asyncpg` for PostgreSQL) |
| **Database** | PostgreSQL (production) / SQLite + aiosqlite (tests) |
| **Cache/Session** | Redis (支援 TLS: `rediss://`) |
| **Auth** | JWT httpOnly cookies (access 15min + refresh 1day) |
| **Migration** | Alembic (3 versions: 001 initial, 002 password_history, 003 pharmacy_advices) |
| **LLM** | OpenAI API (所有呼叫經 `backend/app/llm.py`) |
| **RAG** | ChromaDB (44 PDFs, 2150 chunks, `rag 文本/`) |
| **Tests** | pytest-asyncio, 170/170 passing (`cd backend && python3 -m pytest tests/ -v`) |
| **Response Envelope** | `{ success: true/false, data/error, message }` |

### 關鍵路徑
```
/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/
├── backend/                    # FastAPI 後端
│   ├── app/
│   │   ├── config.py           # 環境設定 (JWT, Redis, 密碼政策)
│   │   ├── main.py             # ASGI app + SecurityHeaders middleware
│   │   ├── llm.py              # 所有 LLM 呼叫入口 (7 task prompts)
│   │   ├── middleware/auth.py  # JWT 驗證 + Redis session + idle timeout
│   │   ├── models/             # SQLAlchemy ORM (15+ tables)
│   │   ├── routers/            # 16 routers, 70+ endpoints
│   │   ├── schemas/            # Pydantic v2 schemas
│   │   └── utils/response.py   # success_response / error_response
│   ├── seeds/seed_data.py      # 種子資料
│   ├── tests/                  # 85 tests (SQLite in-memory)
│   └── alembic/                # 3 migration versions
├── src/                        # Vite + React 前端
│   ├── index.css               # Tailwind v4 pre-compiled (4734+ lines)
│   ├── lib/
│   │   ├── api-client.ts       # Axios instance (httpOnly cookie, trace headers)
│   │   ├── api/ai.ts           # AI API client (651 lines, 9 functions)
│   │   ├── api/auth.ts         # Auth API (login/logout/refresh)
│   │   └── auth-context.tsx    # React auth context
│   ├── pages/
│   │   ├── patient-detail.tsx  # 主要頁面 (2157 lines)
│   │   ├── patients.tsx        # 病人列表 (compact-table)
│   │   ├── chat.tsx            # 團隊聊天
│   │   └── pharmacy/*.tsx      # 藥師工作站 (5 pages)
│   └── components/
│       ├── ui/                 # Shadcn components
│       │   ├── ai-markdown.tsx # AI Markdown 渲染
│       │   ├── skeletons.tsx   # Skeleton loading states
│       │   └── table.tsx       # Table (p-2 default padding)
│       └── patient/            # 病人相關元件
├── datamock/                   # JSON mock data (passwords removed)
├── docs/                       # 所有 Markdown 文件
└── CLAUDE.md                   # 專案規範
```

---

## 二、已完成的修正清單（避免重做）

### P0 — 關鍵修正 (6 項)
1. **Mock 資料完全移除** — `src/lib/mock-data.ts` 已刪除，`grep -r "mock-data" src/` = 0
2. **httpOnly Cookie JWT** — 前端 `api-client.ts` 使用 `credentials: 'include'`，後端 `middleware/auth.py` 管理 3 cookies
3. **JWT Secret 啟動驗證** — `config.py:113-132` fail-closed（最低 32 字元 + 黑名單不安全值）
4. **帳號鎖定** — 5 次失敗 / 15 分鐘鎖定，`config.py:66-68`
5. **Auth refresh 無限重導迴圈修正** — `api-client.ts` response interceptor 對 `/auth/` 端點跳過自動 refresh；不重導已在 `/login` 的頁面；`clearAll()` 清除 indicator cookie
6. **Vite proxy SPA 路由衝突修正** — `vite.config.ts` 為 `/patients`、`/dashboard`、`/admin`、`/pharmacy` 添加 `bypass(req)` 函數，檢查 `Accept: text/html` header 時返回 SPA 而非轉發至後端

### P1 — 高優先 (8 項)
5. **HSTS + 安全標頭** — `main.py:161-213` SecurityHeadersMiddleware
6. **密碼過期 + 歷史** — 90天 / 5筆，`routers/auth.py:302-355`
7. **Compact Table CSS** — `index.css:4729-4734` + `patients.tsx:359`
8. **MED_CATEGORY_LABELS** — `patient-detail.tsx:158-175` (16 categories)
9. **ChatMessage timestamp 映射** — `ai.ts:11` → `patient-detail.tsx:1142` → `:1304/:1433`
10. **AI 串流聊天** — SSE `ai.ts:226-333` + 降級回退至 REST
11. **AI Markdown 渲染** — `ai-markdown.tsx:28-63` (ReactMarkdown + custom components)
12. **Session Idle Timeout** — `middleware/auth.py:174-194` (30 分鐘 Redis 追蹤)

### P2 — 中優先 (5 項)
13. **對話 Round Badge** — `patient-detail.tsx:1311-1313`
14. **跳到最新按鈕** — `patient-detail.tsx:1462-1469` (sticky FAB)
15. **資料品質指示器** — `patient-detail.tsx:1391-1399` (degraded/freshness)
16. **可展開參考文獻面板** — `patient-detail.tsx:1331-1388`
17. **Skeleton 載入狀態** — `skeletons.tsx` (5 variants)

### 補充 (1 項)
18. **Figma 匯入清理 + 文件整併** — 11 Figma 檔刪除、8 MD 檔從 `src/` 移至 `docs/`

---

## 三、尚未完成的 3 個任務詳細規格

### Task A: E2E 整合驗證

**前置條件:**
1. 設定 `backend/.env`:
   ```
   JWT_SECRET=<cryptographically_random_32+_chars>
   OPENAI_API_KEY=<your_key>
   DATABASE_URL=postgresql+asyncpg://chaticu:password@localhost:5432/chaticu  # pragma: allowlist secret
   REDIS_URL=redis://localhost:6379/0
   SEED_DEFAULT_PASSWORD=<secure_12+_chars>
   DEBUG=true
   ```
2. 啟動 PostgreSQL + Redis
3. 執行 `cd backend && alembic upgrade head && python3 seeds/seed_data.py`
4. 啟動後端 `cd backend && uvicorn app.main:app --reload --port 8000`
5. 啟動前端 `npm run dev`

**驗證清單:**
| # | 端點/功能 | 驗證方式 | 預期結果 |
|---|-----------|----------|----------|
| 1 | `POST /auth/login` | curl / 瀏覽器 | Set-Cookie: httpOnly JWT |
| 2 | `POST /auth/refresh` | 15 分鐘後自動觸發 | 新 access token |
| 3 | `POST /ai/chat` | 前端聊天輸入 | AI 回應 + citations |
| 4 | `POST /ai/chat/stream` | 前端串流 | 逐 chunk 顯示 + done 事件 |
| 5 | `POST /api/v1/clinical/summary` | Summary tab | 結構化摘要 |
| 6 | `POST /api/v1/clinical/guideline` | Guideline 按鈕 | RAG 引用 + 解讀 |
| 7 | `GET /patients` | 病人列表頁 | Compact table 正常 |
| 8 | `GET /patients/:id/medications` | 用藥 tab | Category badge 顯示 |
| 9 | 帳號鎖定 | 連續 5 次錯誤密碼 | 第 6 次被拒（900s） |
| 10 | Idle Timeout | 靜置 30+ 分鐘 | 自動登出 |

### Task B: T04 UAT 腳本建立

**目標:** 建立可重複執行的 User Acceptance Test 腳本

**建議格式:** Markdown checklist in `docs/uat-script.md`

**覆蓋範圍:**
1. 登入/登出流程（含密碼過期場景）
2. 病人 CRUD（新增/編輯/封存）
3. 藥物管理（S/A/N 分類 + 其他藥物 category badge）
4. AI 聊天（新對話/載入歷史/刪除/串流）
5. 臨床 AI 工具（summary/explanation/guideline/decision/polish）
6. 藥師工作站（交互作用/劑量/相容性/用藥建議）
7. 管理功能（使用者管理/稽核日誌/向量資料庫）
8. 安全驗證（HSTS/CSP headers via DevTools）

### Task C: T22 CI 3 次連續綠燈

**前置條件:** 需要 Git remote repository (GitHub/GitLab)

**CI Pipeline 內容 (`.github/workflows/ci.yml`):**
```yaml
jobs:
  backend-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: pip install -r backend/requirements.lock
      - run: cd backend && python -m pytest tests/ -v --tb=short
        env:
          SEED_DEFAULT_PASSWORD: test-password-ci
          JWT_SECRET: ci-test-jwt-secret-32chars-minimum

  frontend-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run build

  lint-gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: bash scripts/verify_restructure.sh
```

**驗證:** 需要 3 次連續 push 且 CI 全綠才算完成。

---

## 四、關鍵注意事項

### 4.1 Tailwind v4 Pre-compiled 限制
- `src/index.css` 是 **已編譯的 CSS**（4734+ 行），不是 Tailwind source config
- **不能使用未在 CSS 中定義的任意 Tailwind className**
- 新增 CSS 規則必須手動添加到 `index.css` 末尾（如 `.compact-table`）
- 若需新的 Tailwind utility class，必須確認已存在於 compiled CSS 中
- 行內 `style={{}}` 屬性可正常使用，不受此限制

### 4.2 SPA 路由 + Vite Proxy Bypass
- 使用 React Router `BrowserRouter`
- 所有路由在 `src/App.tsx` 定義
- 後端需設定 fallback 至 `index.html`（Vite dev server 自動處理）
- Production 部署需 Nginx/Caddy `try_files` 或等效配置
- **Vite proxy 重要設計:** `/patients`、`/dashboard`、`/admin`、`/pharmacy` 同時是 SPA 路由和後端 API 前綴。`vite.config.ts` 使用 `bypass(req)` 函數：瀏覽器導航（`Accept: text/html`）返回 SPA，API 呼叫（`Accept: application/json`）轉發至後端。純後端路徑（`/auth`、`/ai`、`/api`、`/health`、`/team`）直接代理，無需 bypass。

### 4.3 Commit 規範
```
chore(TXX): <英文描述>
```
- 每個 ISMS 任務獨立 commit
- 修改後執行 `bash scripts/verify_restructure.sh <TXX>`
- 不在 `src/` 新增 `.md` 檔案（放 `docs/` 或 `docs/frontend/`）

### 4.4 Python 相容性
- Python 3.9.6 → 必須用 `Optional[X]` 而非 `X | None`
- 必須用 `List[X]` 而非 `list[X]`
- Pydantic v2: 用 `pattern=` 而非 `regex=` in `Field()`
- 執行指令用 `python3` 而非 `python`

### 4.5 測試環境
- 無 Docker — 測試用 SQLite + aiosqlite（JSONB → JSON 重映射）
- `conftest.py` 的 `override_get_db` 必須含 commit（多請求測試場景）
- Backend 測試: `cd backend && python3 -m pytest tests/ -v --tb=short`
- Frontend build: `npm run build`

### 4.6 API Contract 關鍵映射

```typescript
// API Response (ai.ts:ChatMessage)     →    Frontend (patient-detail.tsx:ChatMessage)
timestamp: string                       →    timestamp: toLocaleTimeString('zh-TW')
citations: Citation[]                   →    references: AiCitation[]
safetyWarnings: string[]                →    warnings: string[]
degraded: boolean                       →    degraded: boolean
dataFreshness: DataFreshness            →    dataFreshness: DataFreshness (直接傳遞)
```

### 4.7 禁止事項（來自 CLAUDE.md）
- 不得在 `src/` 新增 `.md` 文件
- 不得將 `_archive_candidates/` 推入版本庫
- 不得在無防護情況下對空向量執行 matmul / cosine similarity
- 不得新增 Figma 匯出檔到 `src/imports/` 而不在頁面中引用
- `SEED_DEFAULT_PASSWORD` 環境變數無 fallback（未設定 → `sys.exit(1)`）

---

## 五、快速啟動指令

```bash
# 後端測試
cd backend && python3 -m pytest tests/ -v --tb=short

# 前端 build
npm run build

# 前端 dev
npm run dev

# Mock data 驗證
grep -r "mock-data" src/

# 全部 endpoint 檢視
cd backend && python3 -c "from app.main import app; [print(r.path, r.methods) for r in app.routes if hasattr(r, 'path')]"
```
