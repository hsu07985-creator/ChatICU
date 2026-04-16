# 過敏資料結構化解析 — 規劃與測試

- 建立日期：2026-04-16
- 狀態：Phase 1 完成（parser + HISConverter + 前端顯示）

---

## 一、現況分析

### 系統端

| 項目 | 現況 |
|------|------|
| DB 欄位 | `patients.allergies` JSONB 已存在，目前永遠寫 `[]` |
| HIS converter | `his_converter.py` 第 571 行硬寫 `"allergies": []` |
| SO 資料 | `getSO_AllPatientSeq.json` **從未被載入** |
| Sync 行為 | `snapshot_sync.py` 將 `allergies` 列在 `PRESERVE_EXISTING_FIELDS`，HIS sync 不會覆蓋手動輸入的過敏紀錄 |

### 資料來源（三處）

| # | 來源檔案 | 欄位 | 資料型態 | 目前匯入狀態 |
|---|----------|------|----------|-------------|
| S1 | `getSO_AllPatientSeq.json` | `SUBJECTIVE` | 自由文字（SOAP 主觀） | 未匯入 |
| S2 | `getLabResult.json` | `REP_TYPE_CODE == "10"` | 結構化檢驗值 | 已匯入 lab_data（但未標記為過敏相關） |
| S3 | `getOpd.json` | `ICD_CODE1`–`ICD_CODE10` | ICD 診斷碼 | 已匯入 diagnosis（未特別提取過敏診斷） |

---

## 二、資料盤點

### S1：SUBJECTIVE 自由文字中的過敏描述

16 位病人中，5 位有過敏相關描述，**全部為否定（無過敏）**。

| 病歷號 | PAT_SEQ | 原文 | 判讀 |
|--------|---------|------|------|
| 41113230 | M01154 | `Drug allergy(-),煙(-)` | 否定 |
| 41113230 | M01156 | `p/h NKA, HT(+), DM(-)` | 否定（NKA = No Known Allergy） |
| 50076763 | M00008 | `serious ADR to previous vaccination(-)` | 否定（疫苗 ADR） |
| 50076763 | M00009 | `no allergy to egg & vaccine` | 否定 |
| 50559866 | M01109 | `Allergy NKA` | 否定 |
| 50559866 | M01109 | `drug allergy-, smoking-, alcohol-` | 否定 |
| 50617996 | M01535 | `Drug allergy -` | 否定 |
| 61497143 | M01235 | `ALLERGIC HX TO MEDICIN: NIL` | 否定 |
| 61497143 | M01236 | `ALLERGIC HX TO MEDICIN: NIL` | 否定（重複就診） |
| 61497143 | M01237 | `ALLERGIC HX TO MEDICIN: NIL` | 否定（重複就診） |

**已知否定模式（regex 必須處理）：**

```
Drug allergy(-)
Drug allergy -
drug allergy-
NKA                          ← standalone 或 p/h NKA、Allergy NKA
ALLERGIC HX TO MEDICIN: NIL
no allergy to <substance>
ADR to <something>(-)
藥物過敏(-)                   ← 預留中文模式
```

**預期陽性模式（目前資料未出現，但必須支援）：**

```
Drug allergy(+): Penicillin
Drug allergy: Penicillin, Sulfa
Allergy: PCN
ALLERGIC HX TO MEDICIN: Penicillin
過敏: Penicillin
藥物過敏: Penicillin
對 Penicillin 過敏
ADR to Penicillin(+)
```

### S2：過敏檢驗（`REP_TYPE_CODE == "10"`）

| 病歷號 | LAB_CODE | LAB_NAME | RESULT | UNIT | 上限 | RES_SW | 判讀 |
|--------|----------|----------|--------|------|------|--------|------|
| 16312169 | 12031 | IgE（免疫球蛋白E） | 93.8 | IU/ml | 100.0 | N | 正常 |
| 50669055 | 12031 | IgE（免疫球蛋白E） | 43.9 | IU/ml | 100.0 | N | 正常 |
| 50669055 | 30021 | Allergen test Phadiatop Infant | 0.08 | PAU/L | 0.35 | N | 陰性 |
| 50559866 | 30023 | ECP | 3.2 | ug/L | 15.0 | N | 正常 |
| 50559866 | 12031 | IgE（免疫球蛋白E） | <2.0 | IU/ml | 100.0 | N | 正常 |

> 注意：過敏檢驗 ≠ 過敏史。IgE 升高只代表「過敏體質傾向」，不能自動判定為某藥物過敏。

### S3：ICD 過敏診斷

| 病歷號 | ICD | 名稱 | 來源 |
|--------|-----|------|------|
| 50617996 | L23.9 | 過敏性接觸性皮膚炎，未明示原因 | `getOpd.json` ICD_CODE5 |

> 注意：ICD 診斷是「疾病」，不是「對某藥物過敏」。僅供參考，不直接寫入 allergies。

---

## 三、架構設計

### 目標輸出結構

```jsonc
// patients.allergies JSONB — 寫入 DB 的格式
[
  {
    "substance": "Penicillin",       // 過敏原（藥名/物質）
    "reaction": "rash",              // 反應描述（可為 null）
    "severity": null,                // 嚴重度（可為 null）
    "source": "so_note",             // 來源：so_note | manual
    "source_visit": "M01154",        // 來源就診序號
    "extracted_text": "Drug allergy(+): Penicillin - rash"  // 原始文字
  }
]
// 若為 NKA，寫入：
[]
// 並在 patient.alerts 中加入 "NKA" 標記（可選）
```

### 新增方法：`HISConverter._extract_allergies()`

```
位置：backend/app/fhir/his_converter.py
呼叫點：convert_all() → convert_patient() 之後
```

**處理流程：**

```
1. _load("getSO_AllPatientSeq.json")
   ├─ 遍歷所有 Responses[].Data[].SUBJECTIVE
   ├─ 每筆跑 regex 提取過敏描述行
   └─ 收集所有 match

2. 分類 match
   ├─ 否定模式 → allergy_status = "nka"
   ├─ 陽性模式 → 提取藥物名稱 → allergy_status = "has_allergies"
   └─ 無 match  → allergy_status = "unknown"

3. 輸出
   ├─ 陽性 → 寫入 patient["allergies"] = [{substance, reaction, ...}]
   ├─ NKA  → patient["allergies"] = []（可選加 alert）
   └─ Unknown → patient["allergies"] = []（不動）
```

### Regex 規則表

| 優先序 | 模式 | 類型 | 提取 |
|--------|------|------|------|
| 1 | `(?i)drug\s*allergy\s*\(\+\)\s*[:：]\s*(.+)` | 陽性 | group(1) = 藥物名 |
| 2 | `(?i)drug\s*allergy\s*[:：]\s*([^,\n(]+)` | 陽性 | group(1) = 藥物名（非空、非 `-`、非 `nil`） |
| 3 | `(?i)allerg(?:y\|ic)\s*(?:hx\s*)?(?:to\s*)?medicin[e]?\s*[:：]\s*([^,\n]+)` | 依內容 | `NIL` → 否定；其他 → 陽性 |
| 4 | `(?i)過敏\s*[:：]\s*(.+)` | 依內容 | 空/無 → 否定；其他 → 陽性 |
| 5 | `(?i)對\s*(.+?)\s*過敏` | 陽性 | group(1) = 藥物名 |
| 6 | `(?i)\bNKA\b` | 否定 | — |
| 7 | `(?i)drug\s*allergy\s*\(-\)` | 否定 | — |
| 8 | `(?i)drug\s*allergy\s*-` | 否定 | — |
| 9 | `(?i)no\s+(?:known\s+)?allerg` | 否定 | — |
| 10 | `(?i)ADR\s+to\s+.+\(-\)` | 否定 | — |

> 規則按優先序執行：陽性 match 優先於否定 match。同一病人多筆就診的結果取聯集。

### Sync 策略

目前 `allergies` 在 `PRESERVE_EXISTING_FIELDS`，代表 HIS sync 不會覆蓋。兩種做法：

| 方案 | 行為 | 適用情境 |
|------|------|----------|
| A. 維持 PRESERVE | HIS 解析只在 allergies 為空時才寫入 | 手動輸入優先，HIS 當補充 |
| B. 改為 MERGE | HIS 解析結果與既有合併（去重） | 雙來源並存 |

**建議：方案 A**（保守，先求有再求好）

---

## 四、實作步驟

| 步驟 | 說明 | 預估改動 |
|------|------|----------|
| 1 | 在 `his_converter.py` 新增 `_extract_allergies()` 方法 | ~80 行 |
| 2 | 在 `convert_all()` 呼叫 `_extract_allergies()`，結果寫入 `patient["allergies"]` | ~5 行 |
| 3 | 在 `_load()` 支援 `getSO_AllPatientSeq.json` 的特殊結構（巢狀 Responses） | ~15 行 |
| 4 | 寫測試（見下方） | ~200 行 |
| 5 | 跑 `--force` sync 驗證 16 位病人結果 | 操作 |

---

## 五、測試計畫

### 5.1 單元測試：Regex 解析

**檔案**：`backend/tests/test_allergy_extraction.py`

```python
"""Tests for allergy extraction from getSO SUBJECTIVE text."""
import pytest

# ── 假設實作在 his_converter.py 的 _extract_allergies 或獨立模組 ──
# from app.fhir.his_converter import HISConverter
# 或
# from app.fhir.allergy_parser import parse_allergy_text


class TestNegativePatterns:
    """確認否定模式正確回傳空清單 + NKA 狀態。"""

    @pytest.mark.parametrize("text,description", [
        ("Drug allergy(-),煙(-)", "括號否定"),
        ("Drug allergy -", "空格 dash"),
        ("drug allergy-, smoking-, alcohol-", "dash 緊接"),
        ("Allergy NKA", "NKA 關鍵字"),
        ("p/h NKA, HT(+), DM(-)", "NKA 混在其他病史"),
        ("ALLERGIC HX TO MEDICIN: NIL", "NIL 關鍵字"),
        ("ALLERGIC HX TO MEDICINE: NIL", "NIL + medicine 拼法"),
        ("no allergy to egg & vaccine", "no allergy 自然語言"),
        ("serious ADR to previous vaccination(-)", "ADR 否定"),
        ("No known drug allergy", "NKDA 描述"),
        ("藥物過敏(-)", "中文否定"),
        ("藥物過敏: 無", "中文無"),
        ("過敏史: 否認", "中文否認"),
    ])
    def test_negative_returns_empty(self, text, description):
        """否定模式 → allergies=[], status='nka'"""
        result = parse_allergy_text(text)
        assert result["allergies"] == [], f"應為空: {description}"
        assert result["status"] == "nka"


class TestPositivePatterns:
    """確認陽性模式正確提取藥物名稱。"""

    @pytest.mark.parametrize("text,expected_substances,description", [
        (
            "Drug allergy(+): Penicillin",
            ["Penicillin"],
            "括號陽性 + 冒號",
        ),
        (
            "Drug allergy: Penicillin, Sulfa",
            ["Penicillin", "Sulfa"],
            "多藥物逗號分隔",
        ),
        (
            "Allergy: PCN",
            ["PCN"],
            "簡寫 Allergy",
        ),
        (
            "ALLERGIC HX TO MEDICIN: Penicillin",
            ["Penicillin"],
            "ALLERGIC HX 陽性",
        ),
        (
            "Drug allergy(+): Penicillin - rash",
            ["Penicillin"],
            "含反應描述",
        ),
        (
            "過敏: Penicillin",
            ["Penicillin"],
            "中文冒號",
        ),
        (
            "藥物過敏: Aspirin, Morphine",
            ["Aspirin", "Morphine"],
            "中文多藥物",
        ),
        (
            "對 Vancomycin 過敏",
            ["Vancomycin"],
            "中文句型「對...過敏」",
        ),
        (
            "Drug allergy: Penicillin (rash), Sulfa (GI upset)",
            ["Penicillin", "Sulfa"],
            "每藥附反應描述",
        ),
    ])
    def test_positive_extracts_substances(self, text, expected_substances, description):
        """陽性模式 → allergies 包含對應藥物"""
        result = parse_allergy_text(text)
        assert result["status"] == "has_allergies", f"應為 has_allergies: {description}"
        extracted = [a["substance"] for a in result["allergies"]]
        for sub in expected_substances:
            assert sub in extracted, f"缺少 {sub}: {description}"


class TestNoMention:
    """SUBJECTIVE 完全沒有過敏相關文字。"""

    @pytest.mark.parametrize("text", [
        "Chief complaint: fever for 3 days",
        "主訴：咳嗽兩天",
        "",
        "HT(+), DM(+), CAD",
    ])
    def test_no_mention_returns_unknown(self, text):
        """無過敏描述 → allergies=[], status='unknown'"""
        result = parse_allergy_text(text)
        assert result["allergies"] == []
        assert result["status"] == "unknown"


class TestEdgeCases:
    """邊界情況。"""

    def test_multiple_visits_negative_all(self):
        """多筆就診全否定 → NKA"""
        texts = [
            "Drug allergy(-)",
            "NKA",
            "ALLERGIC HX TO MEDICIN: NIL",
        ]
        result = parse_allergy_texts(texts)
        assert result["status"] == "nka"
        assert result["allergies"] == []

    def test_multiple_visits_one_positive(self):
        """多筆就診中有一筆陽性 → 取陽性"""
        texts = [
            "Drug allergy(-)",
            "Drug allergy: Penicillin",
            "NKA",
        ]
        result = parse_allergy_texts(texts)
        assert result["status"] == "has_allergies"
        assert len(result["allergies"]) == 1
        assert result["allergies"][0]["substance"] == "Penicillin"

    def test_positive_overrides_negative(self):
        """同一段文字既有否定又有陽性 → 陽性優先"""
        text = "Drug allergy(-), but known allergy to Morphine"
        result = parse_allergy_text(text)
        assert result["status"] == "has_allergies"

    def test_dedup_across_visits(self):
        """多筆就診重複提到同藥物 → 去重"""
        texts = [
            "Drug allergy: Penicillin",
            "Allergy: Penicillin, Sulfa",
        ]
        result = parse_allergy_texts(texts)
        substances = [a["substance"] for a in result["allergies"]]
        assert substances.count("Penicillin") == 1
        assert "Sulfa" in substances

    def test_case_insensitive(self):
        """大小寫不敏感"""
        result = parse_allergy_text("DRUG ALLERGY: PENICILLIN")
        assert result["status"] == "has_allergies"

    def test_reaction_extraction(self):
        """反應描述提取"""
        result = parse_allergy_text("Drug allergy(+): Penicillin - skin rash")
        allergy = result["allergies"][0]
        assert allergy["substance"] == "Penicillin"
        assert allergy.get("reaction") is not None

    def test_empty_file(self):
        """getSO 檔案不存在或空 → unknown"""
        result = parse_allergy_texts([])
        assert result["status"] == "unknown"
        assert result["allergies"] == []


class TestReactionParsing:
    """反應描述解析。"""

    @pytest.mark.parametrize("text,substance,reaction", [
        ("Drug allergy: Penicillin (rash)", "Penicillin", "rash"),
        ("Drug allergy: Morphine (噁心嘔吐)", "Morphine", "噁心嘔吐"),
        ("對 Vancomycin 過敏，紅疹", "Vancomycin", "紅疹"),
    ])
    def test_reaction_parsed(self, text, substance, reaction):
        result = parse_allergy_text(text)
        match = [a for a in result["allergies"] if a["substance"] == substance]
        assert len(match) == 1
        assert match[0]["reaction"] == reaction
```

### 5.2 整合測試：HISConverter 層級

```python
"""Integration tests: HISConverter allergy extraction with real patient data."""
import pytest
from pathlib import Path

PATIENT_DIR = Path(__file__).resolve().parents[3] / "patient"
SNAPSHOT = "20260415_152444"


class TestHISConverterAllergies:
    """用真實病人資料測試 HISConverter._extract_allergies()。"""

    @pytest.mark.parametrize("pat_no,expected_status", [
        ("41113230", "nka"),       # Drug allergy(-)
        ("50559866", "nka"),       # Allergy NKA
        ("50617996", "nka"),       # Drug allergy -
        ("61497143", "nka"),       # ALLERGIC HX TO MEDICIN: NIL
        ("50076763", "nka"),       # no allergy to egg & vaccine
        ("13826137", "unknown"),   # 無 SO 過敏描述
        ("50067505", "unknown"),   # 無 SO 過敏描述
        ("70117162", "unknown"),   # 無 SO 過敏描述
    ])
    def test_real_patient_allergy_status(self, pat_no, expected_status):
        """真實病人資料 → 預期 allergy_status。"""
        from app.fhir.his_converter import HISConverter
        patient_dir = PATIENT_DIR / pat_no / SNAPSHOT
        if not patient_dir.exists():
            pytest.skip(f"patient dir not found: {patient_dir}")
        converter = HISConverter(str(patient_dir), pat_no)
        result = converter._extract_allergies()
        assert result["status"] == expected_status, (
            f"pat {pat_no}: expected {expected_status}, got {result['status']}"
        )

    def test_all_16_patients_no_crash(self):
        """16 位病人全跑一遍，不 crash。"""
        from app.fhir.his_converter import HISConverter
        snapshot_base = PATIENT_DIR
        if not snapshot_base.exists():
            pytest.skip("patient dir not found")
        count = 0
        for pat_dir in sorted(snapshot_base.iterdir()):
            snap = pat_dir / SNAPSHOT
            if not snap.exists():
                continue
            converter = HISConverter(str(snap), pat_dir.name)
            result = converter._extract_allergies()
            assert result["status"] in ("nka", "unknown", "has_allergies")
            assert isinstance(result["allergies"], list)
            count += 1
        assert count >= 16

    def test_convert_all_includes_allergies(self):
        """convert_all() 回傳的 patient dict 包含 allergies 欄位。"""
        from app.fhir.his_converter import HISConverter
        pat_no = "41113230"
        patient_dir = PATIENT_DIR / pat_no / SNAPSHOT
        if not patient_dir.exists():
            pytest.skip("patient dir not found")
        converter = HISConverter(str(patient_dir), pat_no)
        result = converter.convert_all()
        patient = result["patient"]
        assert "allergies" in patient
        assert isinstance(patient["allergies"], list)
```

### 5.3 端對端驗證：Sync 後 DB 檢查

```python
"""E2E: verify allergy data reaches the database after sync."""
import pytest


class TestAllergyInDB:
    """Sync 後 DB 中 allergies 欄位正確。"""

    @pytest.mark.asyncio
    async def test_nka_patient_has_empty_allergies(self, db_session):
        """NKA 病人 → DB allergies = []"""
        from app.models.patient import Patient
        from sqlalchemy import select
        stmt = select(Patient).where(
            Patient.medical_record_number == "41113230"
        )
        result = await db_session.execute(stmt)
        patient = result.scalar_one_or_none()
        if patient is None:
            pytest.skip("patient not in DB")
        assert patient.allergies == [] or patient.allergies is None

    @pytest.mark.asyncio
    async def test_manual_allergy_not_overwritten(self, db_session):
        """手動輸入的過敏紀錄不被 HIS sync 覆蓋（PRESERVE 策略）。"""
        # 預設：先手動寫入 allergies，再跑 sync，確認未被清掉
        # 此測試需要 fixture 先 seed 一筆手動過敏
        pass  # TODO: implement with proper fixture
```

### 5.4 測試執行方式

```bash
# 單元測試（不需 DB、不需真實資料）
cd backend
python3 -m pytest tests/test_allergy_extraction.py -v --tb=short -k "Negative or Positive or NoMention or EdgeCase"

# 整合測試（需要 patient/ 資料夾）
python3 -m pytest tests/test_allergy_extraction.py -v --tb=short -k "HISConverter"

# 端對端（需要 DB）
python3 -m pytest tests/test_allergy_extraction.py -v --tb=short -k "AllergyInDB"

# 全部
python3 -m pytest tests/test_allergy_extraction.py -v --tb=short
```

---

## 六、過敏檢驗（S2）處理方式

過敏檢驗（IgE / ECP / Phadiatop）**不直接寫入 `patients.allergies`**，原因：

1. IgE 升高 ≠ 藥物過敏（只代表體質傾向）
2. 檢驗已存在 `lab_data` 表，前端可直接顯示
3. 避免誤導臨床判斷

**可選增強**（Phase 2）：
- 在前端過敏區塊旁顯示「有過敏檢驗資料」提示
- 以 `REP_TYPE_CODE == "10"` 過濾 lab_data 即可，不需後端改動

---

## 七、ICD 過敏診斷（S3）處理方式

ICD 診斷（如 L23.9 過敏性接觸性皮膚炎）**不自動寫入 `patients.allergies`**，原因：

1. ICD 是疾病診斷，不是「對某藥物過敏」的結構化記錄
2. 過敏性疾病不等同於藥物過敏史

**可選增強**（Phase 2）：
- 前端 alert 區顯示過敏相關 ICD 診斷作為參考
- 用 ICD prefix 過濾：`L23.*`、`L27.*`、`T78.4*`、`Z88.*`（藥物過敏個人史）

---

## 八、風險與注意

| 風險 | 對策 |
|------|------|
| Regex 誤判陽性（false positive） | 所有 match 保留 `extracted_text` 原文供人工複查 |
| 中文分詞切錯藥名 | 陽性結果以「冒號/逗號後的完整 token」為邊界，不做中文斷詞 |
| 新的文字模式出現 | 加 `unmatched_allergy_mentions` log，定期回顧補 pattern |
| 陽性覆蓋手動 NKA | 維持 PRESERVE 策略：已有手動資料的病人，HIS 不覆蓋 |
| getSO 檔案不存在 | 回傳 `status: "unknown"`，不改動現有 allergies |

---

## 九、驗收標準

- [ ] `parse_allergy_text()` 通過全部 13 條否定 pattern 測試
- [ ] `parse_allergy_text()` 通過全部 9 條陽性 pattern 測試
- [ ] 邊界測試全過（多筆就診、去重、大小寫、空檔案）
- [ ] 16 位真實病人跑整合測試不 crash
- [ ] 已知 5 位 NKA 病人判定正確
- [ ] 已知 11 位無 SO 描述病人判定為 unknown
- [ ] `convert_all()` 輸出包含 allergies 欄位
- [ ] `--force` sync 後 DB 中 allergies 正確更新
- [ ] 手動輸入的 allergies 不被 sync 覆蓋
