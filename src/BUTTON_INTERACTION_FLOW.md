# ChatICU 按鈕連動關係完整分析

**文件版本**: 1.0.0  
**分析日期**: 2026-01-10  
**分析範圍**: 所有按鈕、狀態切換、級聯效應、互動連動

---

## 📋 目錄

1. [連動關係總覽](#連動關係總覽)
2. [登入頁面連動](#1-登入頁面連動)
3. [儀表板連動](#2-儀表板連動)
4. [病人列表連動](#3-病人列表連動)
5. [病人詳細頁連動](#4-病人詳細頁連動)
6. [團隊聊天室連動](#5-團隊聊天室連動)
7. [藥事支援中心連動](#6-藥事支援中心連動)
8. [管理功能連動](#7-管理功能連動)
9. [全域連動關係](#8-全域連動關係)
10. [狀態變數依賴圖](#9-狀態變數依賴圖)

---

## 連動關係總覽

### 連動類型分類

| 連動類型 | 說明 | 數量 | 示例 |
|---------|------|------|------|
| **狀態切換連動** | 按鈕改變狀態變數，影響其他 UI | 45+ | 展開/收起按鈕 ↔ 內容顯示 |
| **Tab 切換連動** | Tab 切換影響顯示內容和按鈕 | 6 | 對話助手 Tab ↔ 對話輸入區 |
| **對話框連動** | 打開對話框影響背景互動 | 15+ | 編輯對話框 ↔ 儲存/取消按鈕 |
| **數據刷新連動** | 操作後重新載入數據 | 30+ | 發送留言 → 重新載入留言列表 |
| **導航連動** | 頁面跳轉影響側邊欄高亮 | 16 | 點擊病人卡片 → 側邊欄高亮 |
| **權限連動** | 角色改變影響按鈕顯示 | 45+ | 登入 → 顯示對應角色按鈕 |
| **級聯更新連動** | 一個操作觸發多個更新 | 20+ | 校正數據 → 更新表格+趨勢圖 |
| **即時通訊連動** | WebSocket 觸發 UI 更新 | 5+ | 收到新留言 → 未讀徽章+列表更新 |

---

## 1. 登入頁面連動

### 1.1 輸入欄位 ↔ 登入按鈕

**連動關係圖:**
```
[帳號輸入框] ──┐
              ├──> [表單驗證] ──> [登入按鈕 enabled/disabled]
[密碼輸入框] ──┘
```

**詳細說明:**
| 觸發元素 | 影響元素 | 連動類型 | 狀態變數 | 條件 |
|---------|---------|---------|---------|------|
| 帳號輸入框 | 登入按鈕 | 啟用/禁用 | `username` | username 不為空 |
| 密碼輸入框 | 登入按鈕 | 啟用/禁用 | `password` | password 不為空 |
| Remember Me 勾選 | - | 儲存偏好 | `rememberMe` | - |

### 1.2 登入按鈕 → 全系統連動

**連動關係圖:**
```
[登入按鈕] 
    ↓ (成功)
[儲存 token] ──┐
              ├──> [更新 AuthContext.user]
[儲存用戶資料]──┘
    ↓
[導航至 /dashboard]
    ↓
[側邊欄顯示對應角色選項] ←── 權限連動
    ↓
[儀表板顯示對應統計卡片] ←── 權限連動
```

**級聯效應:**
| 步驟 | 動作 | 影響範圍 | 備註 |
|------|------|---------|------|
| 1 | 點擊登入 | 本地 | 顯示 loading 狀態 |
| 2 | API 調用成功 | 全域 | 更新 AuthContext |
| 3 | 儲存 token | 全域 | 後續所有 API 請求帶 token |
| 4 | 導航至儀表板 | 全域 | 路由變更 |
| 5 | 側邊欄重新渲染 | 全域 | 根據角色顯示選項 |
| 6 | 儀表板載入數據 | 頁面 | 並行請求多個 API |

---

## 2. 儀表板連動

### 2.1 搜尋框 ↔ 病患卡片

**連動關係圖:**
```
[搜尋框輸入]
    ↓ (即時)
[更新 searchTerm]
    ↓
[篩選 filteredPatients]
    ↓
[重新渲染病患卡片]
```

**詳細連動:**
| 觸發元素 | 影響元素 | 連動類型 | 延遲 | API 調用 |
|---------|---------|---------|------|---------|
| 搜尋框 | 病患卡片列表 | 即時篩選 | 0ms (本地篩選) | 無 (未來應 debounce 500ms 後調用 API) |
| 搜尋框 | 「沒有符合條件」提示 | 顯示/隱藏 | 0ms | 無 |

### 2.2 篩選器組合連動

**連動關係圖:**
```
[篩選條件下拉] ──┐
                ├──> [組合篩選邏輯] ──> [filteredPatients]
[排序方式下拉] ──┘                           ↓
                                    [重新渲染病患卡片]
```

**狀態變數依賴:**
```typescript
filteredPatients = useMemo(() => {
  return mockPatients
    .filter(p => 
      // searchTerm 篩選
      (p.name.includes(searchTerm) || p.bedNumber.includes(searchTerm))
      // filterStatus 篩選
      && (filterStatus === 'all' 
          || (filterStatus === 'intubated' && p.intubated)
          || (filterStatus === 'san' && (p.sedation.length > 0 || ...))
          || (filterStatus === 'alerts' && p.alerts.length > 0)
      )
    )
    .sort((a, b) => 
      // sortBy 排序
      sortBy === 'bed' ? a.bedNumber.localeCompare(b.bedNumber)
                       : new Date(b.admissionDate) - new Date(a.admissionDate)
    );
}, [searchTerm, filterStatus, sortBy]);
```

**連動矩陣:**
| 觸發 | 搜尋框 | 篩選條件 | 排序方式 | 病患卡片 | 空狀態提示 |
|------|--------|---------|---------|---------|-----------|
| 搜尋框變更 | ✓ | - | - | ✓ 重新渲染 | ✓ 條件顯示 |
| 篩選條件變更 | - | ✓ | - | ✓ 重新渲染 | ✓ 條件顯示 |
| 排序方式變更 | - | - | ✓ | ✓ 重新渲染 | - |

### 2.3 團隊動態卡片 ↔ 導航

**連動關係圖:**
```
[團隊動態留言卡片點擊]
    ↓
[navigate(`/patient/${msg.patientId}`)]
    ↓
[病人詳細頁載入] ──┐
                  ├──> [切換至留言板 Tab] (如果有 query 參數)
[側邊欄高亮變更]──┘
```

**連動細節:**
| 觸發元素 | 目標頁面 | 自動操作 | 狀態保留 |
|---------|---------|---------|---------|
| 點擊留言卡片 | `/patient/:id` | 可選：切換至留言板 Tab | 保留未讀狀態 |
| 查看全部留言按鈕 | `/chat` | 無 | - |

### 2.4 插管病患數卡片 (純展示，無連動)

---

## 3. 病人列表連動

### 3.1 搜尋/篩選 ↔ 表格

**連動關係圖:**
```
[搜尋框] ────────┐
                │
[篩選條件下拉] ──┼──> [filteredPatients] ──> [表格重新渲染]
                │                               ↓
                └────────────────────────> [空狀態提示]
```

### 3.2 編輯按鈕 → 編輯對話框連動

**連動關係圖:**
```
[編輯按鈕 (鉛筆圖示)] 
    ↓
[handleEdit(patient)]
    ↓
[設定 editingPatientId = patient.id] ──┐
                                      ├──> [對話框顯示]
[設定 editFormData = {...patient}] ───┘
    ↓
[對話框內的所有輸入欄位載入數據]
    ↓
┌──────────────────────────────┐
│  對話框內連動:                │
│  [任何欄位變更]               │
│      ↓                        │
│  [更新 editFormData]          │
│      ↓                        │
│  [儲存按鈕 enabled]           │
└──────────────────────────────┘
    ↓ (點擊儲存)
[handleSave()]
    ↓
[API: PATCH /patients/:id] ──> [後端更新]
    ↓ (成功)
[更新本地 patients 陣列]
    ↓
[關閉對話框: editingPatientId = null]
    ↓
[表格重新渲染顯示新數據]
    ↓
[顯示成功 Toast]
```

**對話框內欄位連動:**
| 觸發欄位 | 影響欄位/按鈕 | 連動邏輯 |
|---------|--------------|---------|
| 床號輸入 | editFormData.bedNumber | 即時更新 |
| 姓名輸入 | editFormData.name | 即時更新 |
| 性別下拉 | editFormData.gender | 下拉選擇 |
| 插管狀態勾選 | editFormData.intubated | 布林切換 |
| S/A/N 藥物輸入 | editFormData.sedation/analgesia/nmb | 逗號分隔解析 |
| **任何欄位變更** | **儲存按鈕** | **啟用 (表單已修改)** |

**按鈕狀態連動:**
```
[取消按鈕] ──> [handleCancel()] ──> [editingPatientId = null] ──> [對話框關閉]
                                 └──> [editFormData = null]

[儲存按鈕] ──> [handleSave()] ──> [API 調用] ──> [成功]
                                              ├──> [更新 patients]
                                              ├──> [關閉對話框]
                                              └──> [Toast 提示]
                                 └──> [失敗]
                                      └──> [Toast 錯誤提示]
                                      └──> [對話框保持開啟]
```

### 3.3 新增/封存按鈕 (僅 admin)

**權限連動:**
```
[AuthContext.user.role] 
    ↓
{user?.role === 'admin' && (
    <Button>封存病人</Button>
    <Button>新增病人</Button>
)}
    ↓
[角色變更時按鈕顯示/隱藏]
```

---

## 4. 病人詳細頁連動

### 4.1 Tab 切換 → 全頁面連動

**Tab 狀態變數:** `activeTab`

**連動關係圖:**
```
[TabsList] 
    ↓ (點擊 Tab)
[setActiveTab('chat'/'messages'/'records'/'labs'/'meds'/'summary')]
    ↓
┌─────────────────────────────────────────────────────┐
│ TabContent 條件渲染:                                 │
│                                                      │
│ activeTab === 'chat'     → 顯示對話助手             │
│ activeTab === 'messages' → 顯示留言板               │
│ activeTab === 'records'  → 顯示病歷記錄             │
│ activeTab === 'labs'     → 顯示檢驗數據             │
│ activeTab === 'meds'     → 顯示用藥                 │
│ activeTab === 'summary'  → 顯示病歷摘要             │
└─────────────────────────────────────────────────────┘
    ↓
[對應的按鈕組和輸入欄位顯示/隱藏]
```

**Tab 切換影響矩陣:**
| 切換至 Tab | 顯示的按鈕組 | 顯示的輸入欄位 | 數據載入 |
|-----------|-------------|--------------|---------|
| **chat** | 新對話、更新患者數值、隱藏/顯示記錄、發送、複製、AI修飾(醫師) | 對話標題、訊息輸入框、Progress Note(醫師) | 載入對話記錄 |
| **messages** | 全部標為已讀、發送留言、標記為用藥建議、標為已讀(每則) | 留言輸入框 | 載入留言列表 |
| **records** | 進展記錄、護理記錄、會診記錄、AI輔助修飾、儲存記錄、複製 | 記錄內容 | 載入歷史記錄 |
| **labs** | 校正、查看趨勢 | - | 載入最新檢驗數據 |
| **meds** | 交互作用查詢、複製到報告、AI產生建議(藥師)、發送到病患留言(藥師) | 關注細節、修飾後建議(藥師) | 載入用藥列表 |
| **summary** | 無 | 無 | 載入摘要資訊 |

### 4.2 對話助手 Tab 內連動

#### 4.2.1 對話記錄列表 ↔ 對話區

**連動關係圖:**
```
[對話記錄卡片點擊]
    ↓
[setSelectedSession(session)]
    ↓
┌──────────────────────────────────────┐
│ 對話區更新:                           │
│ - 對話標題變更                        │
│ - 訊息列表變更 (chatMessages)        │
│ - 檢驗數據快照顯示 (labDataSnapshot) │
│ - 滾動至底部                          │
└──────────────────────────────────────┘

[新對話按鈕點擊]
    ↓
[setSelectedSession(null)]
    ↓
┌──────────────────────────────────────┐
│ 對話區清空:                           │
│ - 對話標題清空                        │
│ - 訊息列表清空 (chatMessages = [])   │
│ - 檢驗數據快照隱藏                    │
└──────────────────────────────────────┘
```

**狀態依賴:**
```typescript
// 當前對話的訊息列表依賴於 selectedSession
const chatMessages = selectedSession?.messages || [];

// 對話標題依賴於 selectedSession
const sessionTitle = selectedSession?.title || '';
```

#### 4.2.2 發送訊息 → 多重連動

**連動關係圖:**
```
[發送按鈕點擊]
    ↓
[handleSendMessage()]
    ↓
1. [添加用戶訊息到 chatMessages]
    ↓
2. [清空 chatInput]
    ↓
3. [顯示「AI 思考中...」狀態]
    ↓
4. [API: POST /ai/chat] ──> [後端處理]
    ↓
5. [收到 AI 回應]
    ↓
6. [添加 AI 訊息到 chatMessages]
    ↓
7. [自動儲存對話記錄]
    ↓
8. [更新對話記錄列表 (chatSessions)]
    ↓
9. [滾動至訊息底部]
```

**級聯更新:**
| 步驟 | 更新的狀態 | 影響的 UI 元素 |
|------|-----------|--------------|
| 1 | `chatMessages` | 訊息列表新增用戶訊息氣泡 |
| 2 | `chatInput` | 輸入框清空 |
| 3 | `loading` | 顯示 loading 動畫 |
| 4 | - | 發送按鈕禁用 |
| 5-6 | `chatMessages` | 訊息列表新增 AI 訊息氣泡 |
| 7-8 | `chatSessions` | 左側對話記錄列表更新 |
| 9 | - | 自動滾動 |

#### 4.2.3 展開/收起參考依據連動

**連動關係圖:**
```
[展開/收起按鈕點擊] (每則 AI 訊息都有一個)
    ↓
[更新 expandedReferences Set]
    ↓
{expandedReferences.has(msg.id) ? (
    <參考依據詳細內容>
) : null}
```

**狀態結構:**
```typescript
const [expandedReferences, setExpandedReferences] = useState<Set<string>>(new Set());

// 點擊展開/收起
const toggleReference = (messageId: string) => {
  const newExpanded = new Set(expandedReferences);
  if (newExpanded.has(messageId)) {
    newExpanded.delete(messageId); // 收起
  } else {
    newExpanded.add(messageId);    // 展開
  }
  setExpandedReferences(newExpanded);
};
```

**每則訊息獨立連動:**
| 訊息 ID | 按鈕狀態 | 內容顯示 |
|---------|---------|---------|
| msg_001 | 展開 ✓ | 顯示參考依據 |
| msg_002 | 收起 ✗ | 隱藏參考依據 |
| msg_003 | 展開 ✓ | 顯示參考依據 |

#### 4.2.4 隱藏/顯示記錄按鈕連動

**連動關係圖:**
```
[隱藏/顯示記錄按鈕點擊]
    ↓
[setShowSessionList(!showSessionList)]
    ↓
┌────────────────────────────────────┐
│ showSessionList === true:          │
│ - 左側對話記錄列表顯示             │
│ - 按鈕文字：「隱藏記錄」           │
│ - 對話區寬度：較窄 (2/3)           │
│                                    │
│ showSessionList === false:         │
│ - 左側對話記錄列表隱藏             │
│ - 按鈕文字：「顯示記錄」           │
│ - 對話區寬度：全寬 (100%)          │
└────────────────────────────────────┘
```

**佈局連動:**
```typescript
<div className={`grid ${showSessionList ? 'grid-cols-3' : 'grid-cols-1'} gap-6`}>
  {showSessionList && (
    <div className="col-span-1">
      {/* 對話記錄列表 */}
    </div>
  )}
  <div className={showSessionList ? 'col-span-2' : 'col-span-1'}>
    {/* 對話區 */}
  </div>
</div>
```

#### 4.2.5 更新患者數值按鈕連動

**連動關係圖:**
```
[更新患者數值按鈕點擊]
    ↓
[API: GET /patients/:id/lab-data/latest]
    ↓
[更新 labData 狀態]
    ↓
┌────────────────────────────────────┐
│ 影響範圍:                           │
│ 1. 對話區的檢驗數據快照更新         │
│ 2. 檢驗數據 Tab 的表格更新          │
│ 3. 生命徵象卡片更新                 │
│ 4. AI 對話時使用最新數據            │
└────────────────────────────────────┘
    ↓
[顯示「已更新患者最新數值」Toast]
```

**跨 Tab 連動:**
| 更新來源 Tab | 影響的 Tab | 影響的元素 |
|-------------|-----------|-----------|
| chat | labs | 檢驗數據表格值 |
| chat | labs | 生命徵象卡片值 |
| chat | summary | 警示列表 (如有新異常值) |

#### 4.2.6 Progress Note 輔助連動 (僅醫師/管理者)

**連動關係圖:**
```
[輸入草稿 Textarea]
    ↓
[更新 progressNoteInput]
    ↓
[AI 修飾 & 翻譯按鈕 enabled/disabled]
    ↓ (點擊)
[handlePolishProgressNote()]
    ↓
[API: POST /ai/progress-note/polish]
    ↓
[更新 polishedNote]
    ↓
┌────────────────────────────────────┐
│ 修飾結果區顯示:                     │
│ - 修飾後的英文 Progress Note        │
│ - 複製按鈕 enabled                  │
│ - 匯入 HIS 按鈕 enabled             │
└────────────────────────────────────┘
```

**按鈕啟用邏輯:**
```typescript
// AI 修飾按鈕
<Button 
  disabled={!progressNoteInput.trim() || loading}
  onClick={handlePolishProgressNote}
>
  AI 修飾 & 翻譯
</Button>

// 複製按鈕
<Button 
  disabled={!polishedNote}
  onClick={() => copyToClipboard(polishedNote)}
>
  複製
</Button>
```

### 4.3 留言板 Tab 內連動

#### 4.3.1 發送留言 → 列表更新連動

**連動關係圖:**
```
[留言輸入框] (messageInput)
    ↓
[發送留言按鈕 enabled 當 messageInput.trim() !== '']
    ↓ (點擊)
[handleSendMessage()]
    ↓
1. [創建新留言物件]
    ↓
2. [添加到 messages 陣列]
    ↓
3. [清空 messageInput]
    ↓
4. [API: POST /patients/:id/messages] ──> [後端儲存]
    ↓
5. [留言列表重新渲染]
    ↓
6. [滾動至最新留言]
    ↓
7. [顯示成功 Toast]
    ↓
8. [可能觸發 WebSocket 通知其他用戶] ──> [其他用戶的留言板更新]
```

**級聯更新矩陣:**
| 觸發動作 | 本地更新 | API 調用 | 通知其他用戶 |
|---------|---------|---------|-------------|
| 發送留言 | messages 陣列 | POST /patients/:id/messages | WebSocket 廣播 |
| 標為已讀 | message.isRead | PATCH /messages/:id/read | 無 |
| 全部標為已讀 | 所有 message.isRead | PATCH /messages/mark-all-read | 無 |

#### 4.3.2 未讀徽章連動

**連動關係圖:**
```
[messages 陣列變更]
    ↓
[計算 unreadCount = messages.filter(m => !m.isRead).length]
    ↓
┌────────────────────────────────────┐
│ 影響元素:                           │
│ 1. Tab 上的未讀徽章數字             │
│ 2. CardHeader 的未讀徽章            │
│ 3. 「全部標為已讀」按鈕顯示/隱藏    │
└────────────────────────────────────┘
```

**條件渲染:**
```typescript
{/* Tab 上的未讀徽章 */}
{messages.filter(m => !m.isRead).length > 0 && (
  <Badge className="absolute -top-1 -right-1">
    {messages.filter(m => !m.isRead).length}
  </Badge>
)}

{/* 全部標為已讀按鈕 */}
{messages.filter(m => !m.isRead).length > 0 && (
  <Button onClick={markAllAsRead}>全部標為已讀</Button>
)}
```

#### 4.3.3 標為已讀 → 多處 UI 更新

**連動關係圖:**
```
[標為已讀按鈕點擊] (單則留言)
    ↓
[更新該留言的 isRead = true]
    ↓
[API: PATCH /patients/:id/messages/:messageId/read]
    ↓
┌────────────────────────────────────┐
│ 同步更新:                           │
│ 1. 該留言卡片背景色變更              │
│    (bg-[#7f265b]/5 → bg-white)    │
│ 2. 該留言卡片邊框變更                │
│    (border-[#7f265b]/30 → border-gray-200) │
│ 3. 「標為已讀」按鈕隱藏              │
│ 4. 未讀徽章數字 -1                   │
│ 5. Tab 上的未讀徽章數字 -1          │
└────────────────────────────────────┘
```

**全部標為已讀連動:**
```
[全部標為已讀按鈕點擊]
    ↓
[更新所有留言的 isRead = true]
    ↓
[API: PATCH /patients/:id/messages/mark-all-read]
    ↓
┌────────────────────────────────────┐
│ 批量更新:                           │
│ 1. 所有留言卡片樣式變更              │
│ 2. 所有「標為已讀」按鈕隱藏          │
│ 3. 未讀徽章完全消失                  │
│ 4. Tab 上的未讀徽章消失              │
│ 5. 「全部標為已讀」按鈕隱藏          │
└────────────────────────────────────┘
```

#### 4.3.4 藥師用藥建議留言特殊連動

**連動關係圖:**
```
[藥師在用藥 Tab 發送建議]
    ↓
[API: POST /pharmacy/advice/:adviceId/send-to-patient]
    ↓
[後端創建留言記錄 (messageType: 'medication-advice')]
    ↓
[WebSocket 通知所有查看該病人的用戶]
    ↓
┌────────────────────────────────────┐
│ 醫護端:                             │
│ 1. 留言板 Tab 顯示未讀徽章          │
│ 2. 留言列表新增藥師建議              │
│ 3. 留言卡片顯示特殊徽章              │
│    (messageType badge)             │
│ 4. 儀表板的今日動態顯示新留言        │
└────────────────────────────────────┘
```

### 4.4 檢驗數據 Tab 內連動

#### 4.4.1 生命徵象卡片 → 趨勢圖對話框

**連動關係圖:**
```
[生命徵象卡片點擊]
    ↓
[handleVitalSignClick(labName, value, unit)]
    ↓
[setSelectedVitalSign({ name, nameChinese, unit, value })]
    ↓
[趨勢圖對話框開啟]
    ↓
┌────────────────────────────────────┐
│ 對話框內容:                         │
│ 1. 載入趨勢數據                     │
│    API: GET /vital-signs/trends?   │
│         vitalSign={labName}        │
│ 2. 顯示折線圖 (Recharts)            │
│ 3. 顯示當前數值 (大字)               │
│ 4. 顯示變化量/變化率                 │
│ 5. 顯示參考範圍                     │
└────────────────────────────────────┘
    ↓ (點擊關閉)
[setSelectedVitalSign(null)]
    ↓
[對話框關閉]
```

**每個生命徵象獨立連動:**
| 卡片 | 點擊觸發 | 對話框標題 | API 參數 |
|------|---------|-----------|---------|
| Respiratory Rate | handleVitalSignClick('RespiratoryRate', 28, 'rpm') | 呼吸速率 | vitalSign=RespiratoryRate |
| Temperature | handleVitalSignClick('Temperature', 38.2, '°C') | 體溫 | vitalSign=Temperature |
| Blood Pressure | handleVitalSignClick('BloodPressure', 112, 'mmHg') | 血壓 | vitalSign=BloodPressure |
| Heart Rate | handleVitalSignClick('HeartRate', 46, 'bpm') | 心率 | vitalSign=HeartRate |

#### 4.4.2 檢驗項目 → 趨勢圖/校正對話框

**LabDataDisplay 組件內部連動:**

**連動關係圖:**
```
[檢驗項目列點擊「查看趨勢」]
    ↓
[setSelectedLab({ labName, value, unit, ... })]
    ↓
[趨勢圖對話框開啟]
    ↓
[API: GET /patients/:id/lab-data/trends?labName={name}]
    ↓
[顯示折線圖]

[檢驗項目列點擊「校正」]
    ↓
[setCorrectionDialogOpen(true)]
[setSelectedLab({ labName, value, unit, ... })]
    ↓
[校正對話框開啟]
    ↓
┌────────────────────────────────────┐
│ 對話框內連動:                       │
│ [新數值輸入] → newValue             │
│ [校正理由輸入] → correctionReason   │
│                 ↓                   │
│ [確認校正按鈕] enabled 當兩者都填寫  │
│                 ↓ (點擊)            │
│ [API: PATCH /lab-data/correct]     │
│                 ↓                   │
│ [更新檢驗數據表格]                  │
│ [更新趨勢圖 (如果開啟)]              │
│ [關閉對話框]                        │
│ [顯示成功 Toast]                    │
└────────────────────────────────────┘
```

**校正後的級聯更新:**
| 更新來源 | 影響範圍 | 更新內容 |
|---------|---------|---------|
| 校正 K (血鉀) | 檢驗數據表格 | K 值更新、異常標記更新 |
| 校正 K (血鉀) | K 趨勢圖 (如開啟) | 新增校正數據點 |
| 校正 K (血鉀) | 病歷摘要 Tab | 警示列表更新 (如不再異常) |
| 校正 K (血鉀) | 對話助手 Tab | labDataSnapshot 更新 |

#### 4.4.3 檢驗類別 Tab 切換連動

**LabDataDisplay 內部 Tab 連動:**
```
[生化/血液/凝血/血氣/發炎 Tab 切換]
    ↓
[setActiveCategory('biochemistry'/'hematology'/...)]
    ↓
┌────────────────────────────────────┐
│ 顯示對應類別的檢驗項目:             │
│ - 生化: Na, K, Cl, BUN, Scr...      │
│ - 血液: WBC, RBC, Hb, Hct...        │
│ - 凝血: PT, PTT, D-Dimer...         │
│ - 血氣: pH, PCO2, PO2, HCO3...      │
│ - 發炎: CRP, PCT...                 │
└────────────────────────────────────┘
```

### 4.5 用藥 Tab 內連動

#### 4.5.1 藥師用藥建議 Widget 連動 (僅藥師/管理者)

**PharmacistAdviceWidget 組件內部連動:**

**連動關係圖:**
```
[關注類型下拉]
    ↓
[setAdviceType('drug-interaction'/'dosage-adjustment'/'adverse-reaction')]
    ↓
[根據類型顯示對應的輸入提示]

[關注細節輸入]
    ↓
[setConcernDetails(text)]
    ↓
[AI 產生建議按鈕 enabled]
    ↓ (點擊)
[handleGenerateAdvice()]
    ↓
[API: POST /pharmacy/advice/generate]
    ↓
[setPolishedAdvice(result)]
    ↓
┌────────────────────────────────────┐
│ 建議結果區顯示:                     │
│ 1. 修飾後建議內容 (可編輯 Textarea) │
│ 2. 複製按鈕 enabled                 │
│ 3. 發送到病患留言按鈕 enabled       │
└────────────────────────────────────┘
    ↓ (點擊發送)
[handleSendAdvice()]
    ↓
[API: POST /pharmacy/advice/:adviceId/send-to-patient]
    ↓
┌────────────────────────────────────┐
│ 級聯更新:                           │
│ 1. 留言板 Tab 新增留言              │
│ 2. 留言板 Tab 未讀徽章 +1           │
│ 3. 藥師建議內容清空                 │
│ 4. 顯示成功 Toast                   │
│ 5. WebSocket 通知醫護端             │
└────────────────────────────────────┘
```

**按鈕啟用邏輯連動:**
```typescript
// AI 產生建議按鈕
<Button 
  disabled={!concernDetails.trim() || loading}
  onClick={handleGenerateAdvice}
>
  AI 產生建議
</Button>

// 複製按鈕
<Button 
  disabled={!polishedAdvice}
  onClick={() => copyToClipboard(polishedAdvice)}
>
  複製
</Button>

// 發送到病患留言按鈕
<Button 
  disabled={!polishedAdvice || sending}
  onClick={handleSendAdvice}
>
  發送到病患留言
</Button>
```

**跨 Tab 連動:**
```
[藥師在用藥 Tab 發送建議]
    ↓
[留言板 Tab 未讀徽章更新]
    ↓
[切換至留言板 Tab]
    ↓
[自動滾動至新留言]
```

### 4.6 病歷記錄 Tab 內連動

**MedicalRecords 組件內部連動:**

**連動關係圖:**
```
[記錄類型按鈕切換] (進展記錄/護理記錄/會診記錄)
    ↓
[setRecordType('progress-note'/'nursing-record'/'consultation')]
    ↓
┌────────────────────────────────────┐
│ 根據類型調整:                       │
│ 1. 標題文字變更                     │
│ 2. placeholder 變更                 │
│ 3. API endpoint 變更                │
│ 4. 權限檢查 (會診記錄僅醫師)        │
└────────────────────────────────────┘

[記錄內容輸入]
    ↓
[setRecordContent(text)]
    ↓
[AI 輔助修飾按鈕 enabled]
    ↓ (點擊)
[handlePolishRecord()]
    ↓
[API: POST /ai/nursing-record/polish]
    ↓
[setPolishedContent(result)]
    ↓
[替換 recordContent]
    ↓
[儲存記錄按鈕 enabled]
    ↓ (點擊)
[handleSaveRecord()]
    ↓
[API: POST /patients/:id/medical-records]
    ↓
[重新載入歷史記錄列表]
    ↓
[清空 recordContent]
    ↓
[顯示成功 Toast]
```

**權限連動:**
```typescript
// 進展記錄 (僅醫師/管理者)
{(user?.role === 'doctor' || user?.role === 'admin') && (
  <Button onClick={() => setRecordType('progress-note')}>
    進展記錄
  </Button>
)}

// 護理記錄 (所有醫護)
<Button onClick={() => setRecordType('nursing-record')}>
  護理記錄
</Button>

// 會診記錄 (僅醫師/管理者)
{(user?.role === 'doctor' || user?.role === 'admin') && (
  <Button onClick={() => setRecordType('consultation')}>
    會診記錄
  </Button>
)}
```

---

## 5. 團隊聊天室連動

### 5.1 即時訊息連動

**WebSocket 驅動的連動:**

**連動關係圖:**
```
[頁面載入]
    ↓
[建立 WebSocket 連線]
ws://api.chaticu.hospital/v1/ws/chat?token={jwt}
    ↓
[監聽 'message' 事件]
    ↓
┌────────────────────────────────────┐
│ 收到新訊息時:                       │
│ 1. 添加到 messages 陣列             │
│ 2. 訊息列表重新渲染                 │
│ 3. 自動滾動至底部                   │
│ 4. (可選) 播放通知音效               │
└────────────────────────────────────┘

[發送訊息按鈕點擊]
    ↓
1. [本地立即添加訊息 (樂觀更新)]
    ↓
2. [API: POST /chat/messages]
    ↓
3. [後端儲存成功]
    ↓
4. [WebSocket 廣播給所有線上用戶]
    ↓
5. [其他用戶收到訊息並顯示]
```

**多用戶同步連動:**
| 用戶 A 動作 | WebSocket 事件 | 用戶 B 更新 | 用戶 C 更新 |
|-----------|---------------|-----------|-----------|
| 發送訊息 | 'new_message' | messages 陣列 +1 | messages 陣列 +1 |
| 登入 | 'user_joined' | 線上列表更新 | 線上列表更新 |
| 登出 | 'user_left' | 線上列表更新 | 線上列表更新 |

### 5.2 輸入框 ↔ 發送按鈕

**連動關係圖:**
```
[訊息輸入框]
    ↓
[setMessageInput(text)]
    ↓
[發送按鈕 enabled/disabled]
    ↓ (enabled 且點擊)
[handleSendMessage()]
    ↓
[清空 messageInput]
```

**按鈕狀態:**
```typescript
<Button 
  disabled={!messageInput.trim() || sending}
  onClick={handleSendMessage}
>
  發送
</Button>
```

---

## 6. 藥事支援中心連動

### 6.1 藥物交互作用查詢連動

**連動關係圖:**
```
[藥物 1 下拉選擇]
    ↓
[setDrug1(selected)]
    ↓
[藥物 2 下拉選擇]
    ↓
[setDrug2(selected)]
    ↓
[查詢按鈕 enabled 當兩者都選擇]
    ↓ (點擊)
[handleCheckInteraction()]
    ↓
[API: POST /pharmacy/drug-interactions/check]
    ↓
[setInteractionResults(data)]
    ↓
┌────────────────────────────────────┐
│ 結果表格顯示:                       │
│ - 交互作用列表                      │
│ - 嚴重度徽章 (major/moderate/minor) │
│ - Accordion 展開/收起詳情           │
└────────────────────────────────────┘
```

**Accordion 連動:**
```
[點擊交互作用列]
    ↓
[setExpandedRow(rowId)]
    ↓
┌────────────────────────────────────┐
│ 展開內容:                           │
│ - 機制說明                          │
│ - 臨床影響                          │
│ - 處置建議                          │
│ - 參考文獻                          │
└────────────────────────────────────┘
```

### 6.2 相容性檢核連動

**連動關係圖:**
```
[藥物 1 下拉] + [藥物 2 下拉] + [溶液下拉]
    ↓
[查詢按鈕 enabled 當三者都選擇]
    ↓ (點擊)
[API: POST /pharmacy/iv-compatibility/check]
    ↓
[結果卡片顯示]
    ↓
┌────────────────────────────────────┐
│ 相容性結果:                         │
│ - 相容/不相容 (顏色標記)             │
│ - 穩定時間                          │
│ - 注意事項                          │
│ - 參考文獻                          │
└────────────────────────────────────┘
```

### 6.3 劑量計算連動

**連動關係圖:**
```
[藥物下拉] + [體重/身高/Scr/eGFR 輸入] + [適應症下拉]
    ↓
[計算按鈕 enabled 當所有必填欄位都填寫]
    ↓ (點擊)
[handleCalculateDosage()]
    ↓
[API: POST /pharmacy/dosage/calculate]
    ↓
[結果卡片顯示]
    ↓
┌────────────────────────────────────┐
│ 劑量建議:                           │
│ - Loading Dose                     │
│ - Maintenance Dose                 │
│ - 調整建議 (腎功能)                 │
│ - 警示事項                          │
└────────────────────────────────────┘
```

**腎功能連動:**
```
[Scr 輸入變更] OR [eGFR 輸入變更]
    ↓
[自動計算另一個值 (如實作)]
    ↓
[劑量建議會自動調整 (需重新計算)]
```

---

## 7. 管理功能連動

### 7.1 用戶管理連動

#### 7.1.1 搜尋/篩選 ↔ 用戶表格

**連動關係圖:**
```
[搜尋框] ────────┐
                │
[角色篩選下拉] ──┼──> [filteredUsers] ──> [表格重新渲染]
                │
                └────────────────────────> [空狀態提示]
```

#### 7.1.2 新增用戶對話框連動

**連動關係圖:**
```
[新增用戶按鈕]
    ↓
[setAddUserDialogOpen(true)]
    ↓
[對話框顯示，所有欄位清空]
    ↓
┌────────────────────────────────────┐
│ 表單欄位連動:                       │
│ [姓名] → newUserData.name           │
│ [Email] → newUserData.email         │
│ [角色] → newUserData.role           │
│ [單位] → newUserData.unit           │
│ [密碼] → newUserData.password       │
│           ↓                         │
│ [儲存按鈕] enabled 當所有必填都填寫  │
└────────────────────────────────────┘
    ↓ (點擊儲存)
[handleCreateUser()]
    ↓
[API: POST /admin/users]
    ↓
[重新載入用戶列表]
    ↓
[關閉對話框]
    ↓
[顯示成功 Toast]
```

#### 7.1.3 編輯用戶對話框連動

**連動關係圖:**
```
[編輯按鈕 (每列)]
    ↓
[setEditingUser(user)]
[setEditUserDialogOpen(true)]
    ↓
[對話框顯示，欄位載入現有數據]
    ↓
┌────────────────────────────────────┐
│ 表單欄位連動:                       │
│ [任何欄位變更] → editUserData       │
│                  ↓                  │
│ [儲存按鈕] enabled (表單已修改)     │
│ [密碼欄位] 選填 (編輯時)            │
└────────────────────────────────────┘
    ↓ (點擊儲存)
[handleUpdateUser()]
    ↓
[API: PATCH /admin/users/:userId]
    ↓
[更新用戶列表]
    ↓
[關閉對話框]
```

#### 7.1.4 啟用/停用 Switch 連動

**連動關係圖:**
```
[啟用/停用 Switch 切換]
    ↓
[handleToggleUserStatus(userId, newStatus)]
    ↓
[API: PATCH /admin/users/:userId { active: newStatus }]
    ↓
┌────────────────────────────────────┐
│ 即時更新:                           │
│ 1. 該用戶列的狀態徽章更新            │
│ 2. Switch 狀態切換                  │
│ 3. (可選) 該用戶立即被登出           │
└────────────────────────────────────┘
```

### 7.2 稽核日誌連動

**連動關係圖:**
```
[開始日期] + [結束日期] + [用戶下拉] + [操作類型下拉]
    ↓
[查詢按鈕點擊]
    ↓
[API: GET /admin/audit-logs?...]
    ↓
[setAuditLogs(data)]
    ↓
[表格顯示日誌記錄]
    ↓
[分頁控制]
```

**匯出 CSV 連動 (未實作):**
```
[匯出 CSV 按鈕]
    ↓
[使用當前篩選條件]
    ↓
[下載 CSV 檔案]
```

### 7.3 向量資料庫連動

**連動關係圖:**
```
[上傳文件按鈕]
    ↓
[setUploadDialogOpen(true)]
    ↓
┌────────────────────────────────────┐
│ 上傳對話框:                         │
│ [選擇檔案] → file                   │
│ [Collection 下拉] → collection      │
│                ↓                    │
│ [確認上傳按鈕] enabled 當兩者都選擇  │
└────────────────────────────────────┘
    ↓ (點擊確認)
[handleUploadFile()]
    ↓
[API: POST /admin/vectors/upload]
    ↓
┌────────────────────────────────────┐
│ 上傳進度:                           │
│ 1. 顯示上傳進度條                   │
│ 2. 顯示處理狀態                     │
│ 3. 完成後更新 Collection 列表       │
└────────────────────────────────────┘
```

---

## 8. 全域連動關係

### 8.1 側邊欄 ↔ 路由高亮

**連動關係圖:**
```
[任何導航點擊] (側邊欄/病患卡片/按鈕)
    ↓
[navigate('/path')]
    ↓
[useLocation().pathname 變更]
    ↓
┌────────────────────────────────────┐
│ 側邊欄更新:                         │
│ 1. 當前路由項目高亮                 │
│    (bg-[#7f265b] text-white)       │
│ 2. 其他項目恢復普通樣式              │
│ 3. 群組展開狀態保持                 │
└────────────────────────────────────┘
```

**路由 → 側邊欄高亮對應表:**
| 當前路由 | 高亮項目 | 群組展開 |
|---------|---------|---------|
| `/dashboard` | 儀表板 | - |
| `/patients` | 病人列表 | - |
| `/patient/:id` | 病人列表 | - |
| `/chat` | 團隊聊天室 | - |
| `/pharmacy/workstation` | 藥事工作台 | 藥事支援 ✓ |
| `/pharmacy/interactions` | 交互作用查詢 | 藥事支援 ✓ |
| `/admin/audit` | 稽核日誌 | 管理功能 ✓ |
| `/admin/vectors` | 向量資料庫 | 管理功能 ✓ |
| `/admin/users` | 用戶管理 | 管理功能 ✓ |

### 8.2 登入/登出 → 全系統重置

**登出連動關係圖:**
```
[側邊欄登出按鈕點擊]
    ↓
[AuthContext.logout()]
    ↓
┌────────────────────────────────────┐
│ 清理動作:                           │
│ 1. 清除 localStorage token          │
│ 2. 清除 AuthContext.user            │
│ 3. 關閉所有 WebSocket 連線          │
│ 4. 清除所有快取數據                 │
└────────────────────────────────────┘
    ↓
[navigate('/login')]
    ↓
[所有受保護路由重定向至登入頁]
```

### 8.3 角色切換 → 權限連動

**角色變更影響矩陣:**
| 角色變更 | 側邊欄項目 | 頁面按鈕 | 功能可用性 |
|---------|-----------|---------|-----------|
| nurse → admin | 新增：管理功能群組 | 新增：編輯、上傳、管理按鈕 | 解鎖所有功能 |
| doctor → pharmacist | 移除：病人列表<br>新增：藥事支援群組 | 移除：Progress Note<br>新增：藥師 Widget | 切換功能集 |
| admin → nurse | 移除：管理功能群組 | 移除：編輯、上傳、管理按鈕 | 限制功能 |
| pharmacist → doctor | 移除：藥事支援群組<br>新增：病人列表 | 移除：藥師 Widget<br>新增：Progress Note | 切換功能集 |

### 8.4 Toast 通知連動

**Toast 觸發來源矩陣:**
| 觸發動作 | Toast 類型 | Toast 訊息 | 持續時間 |
|---------|-----------|-----------|---------|
| 登入成功 | success | "登入成功" | 2s |
| 登入失敗 | error | "帳號或密碼錯誤" | 3s |
| 發送訊息成功 | success | "訊息已發送" | 2s |
| 複製成功 | success | "已複製到剪貼簿" | 2s |
| 複製失敗 | error | "複製失敗，請手動複製" | 3s |
| 儲存成功 | success | "儲存成功" | 2s |
| API 錯誤 | error | 錯誤訊息 | 4s |
| 權限不足 | warning | "您沒有權限執行此操作" | 3s |
| 更新數據 | info | "已更新患者最新數值" | 2s |

---

## 9. 狀態變數依賴圖

### 9.1 病人詳細頁狀態依賴圖

```
病人詳細頁狀態樹:
├── activeTab (主 Tab 切換)
│   ├── 'chat'
│   │   ├── selectedSession (對話記錄選擇)
│   │   ├── chatMessages (依賴 selectedSession)
│   │   ├── chatInput (訊息輸入)
│   │   ├── sessionTitle (依賴 selectedSession)
│   │   ├── showSessionList (列表顯示/隱藏)
│   │   ├── expandedReferences (Set - 展開的參考依據)
│   │   ├── progressNoteInput (醫師專用)
│   │   └── polishedNote (醫師專用 - 依賴 progressNoteInput)
│   │
│   ├── 'messages'
│   │   ├── messages (留言列表)
│   │   ├── messageInput (留言輸入)
│   │   └── unreadCount (computed - 依賴 messages)
│   │
│   ├── 'records'
│   │   ├── recordType (記錄類型)
│   │   ├── recordContent (記錄內容)
│   │   └── polishedContent (依賴 recordContent)
│   │
│   ├── 'labs'
│   │   ├── labData (最新檢驗數據)
│   │   ├── selectedVitalSign (生命徵象選擇)
│   │   ├── selectedLab (檢驗項目選擇)
│   │   ├── trendDialogOpen (趨勢圖對話框)
│   │   └── correctionDialogOpen (校正對話框)
│   │
│   ├── 'meds'
│   │   ├── medications (用藥列表)
│   │   ├── adviceType (藥師專用)
│   │   ├── concernDetails (藥師專用)
│   │   └── polishedAdvice (藥師專用 - 依賴 concernDetails)
│   │
│   └── 'summary'
│       └── (純顯示，無狀態)
│
├── patient (病人基本資料)
└── user (當前登入用戶 - 全域狀態)
    └── 影響所有權限相關的條件渲染
```

### 9.2 依賴關係表

**主要狀態依賴:**
| 狀態變數 | 依賴於 | 影響 |
|---------|-------|------|
| `chatMessages` | `selectedSession` | 對話訊息列表顯示 |
| `unreadCount` | `messages` | 未讀徽章數字 |
| `filteredPatients` | `searchTerm`, `filterStatus`, `sortBy` | 病患卡片列表 |
| `polishedNote` | `progressNoteInput` | 修飾結果顯示 |
| `polishedAdvice` | `concernDetails` | 藥師建議結果顯示 |

**計算狀態 (computed):**
```typescript
// 未讀數量 (computed from messages)
const unreadCount = messages.filter(m => !m.isRead).length;

// 插管病患數 (computed from patients)
const intubatedCount = patients.filter(p => p.intubated).length;

// 住院天數 (computed from admissionDate)
const daysAdmitted = Math.floor(
  (new Date().getTime() - new Date(patient.admissionDate).getTime()) 
  / (1000 * 60 * 60 * 24)
);
```

---

## 10. 特殊連動場景

### 10.1 跨 Tab 數據同步

**場景：在對話助手 Tab 更新患者數值 → 檢驗數據 Tab 自動更新**

```
[對話助手 Tab]
    ↓
[更新患者數值按鈕點擊]
    ↓
[API: GET /patients/:id/lab-data/latest]
    ↓
[更新全域 labData 狀態]
    ↓
┌────────────────────────────────────┐
│ 同時影響:                           │
│ 1. 對話助手 Tab - labDataSnapshot   │
│ 2. 檢驗數據 Tab - 表格數值          │
│ 3. 病歷摘要 Tab - 警示列表          │
└────────────────────────────────────┘
    ↓
[用戶切換至檢驗數據 Tab]
    ↓
[看到最新的檢驗數據]
```

### 10.2 藥師建議 → 醫護留言板連動

**跨角色連動場景:**

```
[藥師端]
    ↓
[用藥 Tab - 發送建議到病患留言]
    ↓
[API: POST /pharmacy/advice/:adviceId/send-to-patient]
    ↓
[WebSocket 廣播]
    ↓
┌────────────────────────────────────┐
│ 醫護端自動更新:                     │
│ 1. 病人詳細頁 - 留言板 Tab 未讀 +1  │
│ 2. 儀表板 - 今日動態新增一則        │
│ 3. (可選) 瀏覽器通知                │
└────────────────────────────────────┘
```

### 10.3 校正檢驗數據 → 多處 UI 更新

**級聯更新場景:**

```
[檢驗數據 Tab - 校正 K 值]
    ↓
[PATCH /patients/:id/lab-data/:labDataId/correct]
    ↓
┌────────────────────────────────────────────────┐
│ 級聯更新範圍:                                   │
│ 1. 檢驗數據表格 - K 值更新                      │
│ 2. K 趨勢圖 (如開啟) - 新增校正數據點           │
│ 3. 病歷摘要 - 警示列表更新 (如不再異常)         │
│ 4. 對話助手 - labDataSnapshot 更新            │
│ 5. 儀表板病患卡片 - 警示徽章更新 (如不再異常)  │
│ 6. 稽核日誌 - 新增校正記錄                      │
└────────────────────────────────────────────────┘
```

---

## 📊 連動關係統計

### 按連動類型統計

| 連動類型 | 數量 | 複雜度 |
|---------|------|-------|
| 狀態切換連動 | 45+ | 低-中 |
| Tab 切換連動 | 6 | 中 |
| 對話框連動 | 15+ | 中 |
| 數據刷新連動 | 30+ | 中-高 |
| 導航連動 | 16 | 低 |
| 權限連動 | 45+ | 中 |
| 級聯更新連動 | 20+ | 高 |
| 即時通訊連動 | 5+ | 高 |

### 按頁面統計連動複雜度

| 頁面 | 狀態變數數量 | 連動關係數量 | 複雜度評級 |
|------|-------------|-------------|-----------|
| 登入頁面 | 5 | 8 | ⭐ 低 |
| 儀表板 | 8 | 12 | ⭐⭐ 中 |
| 病人列表 | 10 | 15 | ⭐⭐ 中 |
| 病人詳細頁 | 35+ | 80+ | ⭐⭐⭐⭐⭐ 極高 |
| 團隊聊天室 | 6 | 10 | ⭐⭐⭐ 中-高 |
| 藥物交互作用 | 8 | 10 | ⭐⭐ 中 |
| 用戶管理 | 12 | 18 | ⭐⭐⭐ 中-高 |

---

## ✅ 連動檢查清單

### 開發前檢查
- [ ] 確認所有狀態變數的初始值
- [ ] 確認狀態變數之間的依賴關係
- [ ] 確認哪些狀態需要持久化
- [ ] 確認哪些狀態需要全域管理

### 開發中檢查
- [ ] 每個按鈕都有明確的觸發動作
- [ ] 每個觸發動作都更新對應的狀態
- [ ] 每個狀態變更都觸發對應的 UI 更新
- [ ] 跨 Tab 的狀態同步正確
- [ ] 對話框開啟/關閉的狀態管理正確

### 測試檢查
- [ ] 測試所有按鈕的點擊效果
- [ ] 測試所有 Tab 切換的連動
- [ ] 測試所有對話框的開啟/關閉
- [ ] 測試跨頁面的數據同步
- [ ] 測試權限變更的 UI 更新
- [ ] 測試 WebSocket 即時連動

---

## 🔍 常見連動問題與解決方案

### 問題 1: 狀態更新不即時
**症狀:** 點擊按鈕後 UI 沒有立即更新

**可能原因:**
- 使用了舊的狀態值 (閉包問題)
- 沒有使用函數式更新

**解決方案:**
```typescript
// ❌ 錯誤
setCount(count + 1);

// ✅ 正確
setCount(prev => prev + 1);
```

### 問題 2: 跨 Tab 數據不同步
**症狀:** 在 Tab A 更新數據，切換至 Tab B 看到舊數據

**可能原因:**
- Tab 之間的狀態沒有共享
- 沒有在 Tab 切換時重新載入數據

**解決方案:**
```typescript
// 使用共享狀態
const [labData, setLabData] = useState(null);

// 或在 Tab 切換時重新載入
useEffect(() => {
  if (activeTab === 'labs') {
    fetchLabData();
  }
}, [activeTab]);
```

### 問題 3: 對話框關閉後狀態沒有清空
**症狀:** 重新開啟對話框看到上次的內容

**解決方案:**
```typescript
const handleClose = () => {
  setDialogOpen(false);
  // 清空表單狀態
  setFormData(initialFormData);
};
```

### 問題 4: WebSocket 重複訂閱
**症狀:** 收到多次相同的訊息

**解決方案:**
```typescript
useEffect(() => {
  const ws = new WebSocket(url);
  
  ws.onmessage = handleMessage;
  
  return () => {
    ws.close(); // 清理連線
  };
}, []); // 空依賴陣列，只執行一次
```

---

**文件結束**

盤點完成日期: 2026-01-10  
盤點人員: 前端團隊  
連動關係總數: 200+
