"""drug_library — Read-only catalog of every drug/class the DDI database
knows about, plus per-drug coverage stats and ATC navigation.

Endpoints:
    GET  /pharmacy/drug-library/stats
    GET  /pharmacy/drug-library/drugs
    GET  /pharmacy/drug-library/drugs/{name}

Used by the 藥事工具 → 藥物資料庫 page. Pharmacist/admin only.
"""
from __future__ import annotations

import csv
import json as _json
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.drug_interaction import DrugInteraction
from app.models.user import User
from app.utils.response import escape_like, success_response

router = APIRouter(prefix="/drug-library", tags=["pharmacy"])

BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent.parent
FORMULARY_CSV = BACKEND_ROOT / "app" / "fhir" / "code_maps" / "drug_formulary.csv"

# WHO ATC top-level chapters (Chinese labels for sidebar)
ATC_TOP = {
    "A": "消化道與代謝",
    "B": "血液與造血系統",
    "C": "心血管系統",
    "D": "皮膚科",
    "G": "泌尿生殖與性荷爾蒙",
    "H": "全身性荷爾蒙製劑",
    "J": "全身性抗感染",
    "L": "抗腫瘤與免疫調節",
    "M": "肌肉骨骼系統",
    "N": "神經系統",
    "P": "抗寄生蟲藥",
    "R": "呼吸系統",
    "S": "感官系統",
    "V": "其他",
}

# Common ATC level-2 (3-char) Chinese labels — covers ICU usage hot spots
ATC_LEVEL2 = {
    "A02": "胃酸相關疾病",
    "A03": "腸胃功能性疾病",
    "A04": "止吐劑",
    "A06": "便秘用藥",
    "A07": "止瀉/腸抗發炎",
    "A10": "糖尿病用藥",
    "A11": "維生素",
    "A12": "礦物質補充",
    "B01": "抗血栓劑",
    "B02": "抗出血劑",
    "B03": "抗貧血藥",
    "B05": "血液代用品/灌注液",
    "C01": "心臟治療",
    "C02": "降血壓劑",
    "C03": "利尿劑",
    "C07": "β-腎上腺素受體阻斷",
    "C08": "鈣通道阻斷",
    "C09": "腎素-血管收縮素系統",
    "C10": "降血脂藥",
    "D07": "皮膚 corticosteroid",
    "G03": "性荷爾蒙",
    "G04": "泌尿科用藥",
    "H01": "腦垂體/下視丘荷爾蒙",
    "H02": "系統性 corticosteroid",
    "H03": "甲狀腺治療",
    "J01": "全身性抗菌劑",
    "J02": "全身性抗黴菌",
    "J04": "抗結核",
    "J05": "全身性抗病毒",
    "J06": "免疫血清及免疫球蛋白",
    "J07": "疫苗",
    "L01": "抗腫瘤",
    "L02": "內分泌治療",
    "L04": "免疫抑制",
    "M01": "抗發炎/抗風濕",
    "M03": "肌肉鬆弛劑",
    "M05": "骨疾病治療",
    "N01": "麻醉劑",
    "N02": "鎮痛劑",
    "N03": "抗癲癇",
    "N04": "抗帕金森",
    "N05": "精神藥/鎮靜",
    "N06": "抗憂鬱/精神刺激",
    "N07": "其他神經系統藥",
    "R01": "鼻用藥",
    "R03": "氣喘/COPD 吸入",
    "R05": "止咳化痰",
    "R06": "全身性抗組織胺",
    "S01": "眼科",
    "S02": "耳科",
}

# Common ATC level-3 (5-char) Chinese labels for ICU-relevant drugs
ATC_LEVEL3 = {
    "A02BA": "H2 受體拮抗劑",
    "A02BC": "氫離子幫浦抑制劑 (PPI)",
    "A03FA": "促腸蠕動劑",
    "A04AA": "5-HT3 拮抗劑",
    "A06AD": "滲透性瀉劑",
    "A10AB": "短效胰島素",
    "A10AC": "中效胰島素",
    "A10AE": "長效胰島素",
    "B01AA": "Vitamin K 拮抗劑",
    "B01AB": "肝素類",
    "B01AC": "抗血小板劑（不含肝素）",
    "B01AE": "直接凝血酶抑制",
    "B01AF": "直接 Xa 抑制",
    "B02BA": "Vitamin K 補充",
    "B05AA": "血漿代用品 (Albumin)",
    "B05BA": "靜脈輸注 (parenteral)",
    "C01AA": "強心糖苷",
    "C01BA": "Class Ia 抗心律不整",
    "C01BC": "Class Ic 抗心律不整",
    "C01BD": "Class III 抗心律不整 (Amiodarone)",
    "C01CA": "腎上腺素及去甲腎上腺素類",
    "C01CE": "Phosphodiesterase 抑制",
    "C01EB": "其他心臟治療",
    "C03CA": "環利尿劑 (Loop)",
    "C03DA": "醛固酮拮抗",
    "C07AB": "選擇性 β1 阻斷",
    "C08CA": "Dihydropyridine CCB",
    "C09AA": "ACEI",
    "C09CA": "ARB",
    "C10AA": "Statin (HMG-CoA 還原抑制)",
    "H02AB": "Glucocorticoid",
    "J01CA": "廣效 penicillin",
    "J01CR": "Penicillin + β-lactamase 抑制",
    "J01DC": "Cephalosporin 第 2 代",
    "J01DD": "Cephalosporin 第 3 代",
    "J01DE": "Cephalosporin 第 4 代",
    "J01DH": "Carbapenem",
    "J01FA": "Macrolide",
    "J01GB": "Aminoglycoside",
    "J01MA": "Fluoroquinolone",
    "J01XA": "Glycopeptide (Vancomycin)",
    "J02AC": "Triazole 抗黴菌",
    "J05AP": "C 肝抗病毒",
    "L04AA": "選擇性免疫抑制",
    "M01AB": "醋酸類 NSAID",
    "M01AC": "Oxicam NSAID",
    "M01AE": "丙酸類 NSAID",
    "M03AC": "其他季銨化合物 NMB",
    "M03AX": "其他周邊肌鬆",
    "N01AH": "鴉片類麻醉",
    "N01AX": "其他全身麻醉",
    "N02AA": "天然 opium 衍生",
    "N02AB": "Phenylpiperidine 衍生",
    "N02AX": "其他鴉片類",
    "N02BE": "Anilide 鎮痛 (Acetaminophen)",
    "N03AF": "Carboxamide 抗癲癇",
    "N03AX": "其他抗癲癇",
    "N05AD": "Butyrophenone 抗精神病",
    "N05AH": "Diazepine/Oxazepine/Thiazepine",
    "N05AX": "其他抗精神病",
    "N05BA": "Benzodiazepine 抗焦慮",
    "N05CD": "Benzodiazepine 安眠",
    "N05CM": "其他催眠/鎮靜",
    "N06AB": "SSRI",
    "N06AX": "其他抗憂鬱",
    "R03AC": "選擇性 β2 拮抗 吸入",
    "R03AK": "β2 拮抗 + 其他",
    "R03BB": "抗膽鹼吸入",
}


def _require_pharmacist(user: User) -> None:
    if user.role not in ("pharmacist", "admin"):
        raise HTTPException(status_code=403, detail="Pharmacist or admin only")


# ────────────────────────────────────────────────────────────────────
# Cached formulary lookup (rebuild on cold start)
# ────────────────────────────────────────────────────────────────────
_formulary_cache: dict | None = None

# Tokens that aren't standalone drugs — skip when used as first-word fallback.
_AMBIGUOUS_FIRST_WORDS = frozenset({
    "sodium", "potassium", "calcium", "magnesium",
    "iron", "ferric", "ferrous", "aluminum", "aluminium",
    "zinc", "lithium",
    "insulin", "insulim",
    "human", "hepatitis", "vitamin", "amino", "recombinant",
    "mag.",
})


def _load_formulary() -> dict:
    """Return {ingredient_lower: {atc, brand_names, hospital_codes}}."""
    global _formulary_cache
    if _formulary_cache is not None:
        return _formulary_cache
    out: dict[str, dict] = {}
    if not FORMULARY_CSV.exists():
        _formulary_cache = out
        return out
    with FORMULARY_CSV.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            ingr = (row.get("ingredient") or "").strip()
            if not ingr:
                continue
            key = ingr.lower()
            entry = out.setdefault(key, {
                "atc": (row.get("atc_code") or "").strip() or None,
                "brand_names": [],
                "hospital_codes": [],
                "ingredient": ingr,
            })
            brand = (row.get("brand_name") or "").strip()
            if brand and brand not in entry["brand_names"]:
                entry["brand_names"].append(brand)
            code = (row.get("odr_code") or "").strip()
            if code and code not in entry["hospital_codes"]:
                entry["hospital_codes"].append(code)
            # Index by first word too — so DDI's "Morphine (Systemic)" can
            # find formulary's "Morphine HCl 10mg/ml Inj" via "morphine".
            first = re.split(r"[\s\(\[/\-]", ingr)[0].strip().lower()
            if first and first != key and first not in _AMBIGUOUS_FIRST_WORDS:
                out.setdefault(first, entry)
    _formulary_cache = out
    return out


def _formulary_lookup(name: str) -> Optional[dict]:
    """Try several normalisations to find a formulary entry."""
    fm = _load_formulary()
    if not name:
        return None
    key = name.strip().lower()
    if key in fm:
        return fm[key]
    # Strip parens: "Morphine (Systemic)" → "morphine"
    no_paren = re.sub(r"\s*\([^)]*\)\s*", " ", key).strip()
    no_paren = re.sub(r"\s+", " ", no_paren)
    if no_paren and no_paren != key and no_paren in fm:
        return fm[no_paren]
    # First word fallback (skip ambiguous ions like sodium / potassium)
    base = no_paren or key
    first = re.split(r"[\s\(\[/\-]", base)[0].strip().lower()
    if first and first not in _AMBIGUOUS_FIRST_WORDS and first in fm:
        return fm[first]
    return None


# ────────────────────────────────────────────────────────────────────
# Aggregation helpers
# ────────────────────────────────────────────────────────────────────
async def _aggregate_per_drug(db: AsyncSession) -> dict:
    """Walk drug_interactions and build per-drug counters.
    Dedup key = name.lower() so 'FentaNYL' and 'Fentanyl' merge into one
    entry. Display name = the most-frequent case form. Other forms saved
    as `aliases`.
    """
    r = await db.execute(text("""
        SELECT drug1, drug2, drug1_atc, drug2_atc, risk_rating, "references"
        FROM drug_interactions
        WHERE is_active = TRUE
    """))
    per_drug: dict[str, dict] = {}
    name_form_counts: dict[str, Counter] = {}

    for row in r:
        for name, atc in ((row.drug1, row.drug1_atc), (row.drug2, row.drug2_atc)):
            if not name:
                continue
            key = name.strip().lower()
            entry = per_drug.setdefault(key, {
                "_lower_key": key,
                "atc_codes": set(),
                "ddi_counts": {"X": 0, "D": 0, "C": 0, "B": 0, "A": 0, "total": 0},
                "sources": set(),
                "recently_added_count": 0,
                "_unique_rule_ids": set(),
            })
            name_form_counts.setdefault(key, Counter())[name.strip()] += 1
            if atc:
                entry["atc_codes"].add(atc)
            risk = (row.risk_rating or "").upper()
            if risk in entry["ddi_counts"]:
                entry["ddi_counts"][risk] += 1
            entry["ddi_counts"]["total"] += 1
            if row.references:
                entry["sources"].add(row.references)
                if row.references == "Lexicomp 2026":
                    entry["recently_added_count"] += 1

    # Pick display name = most common case form; rest become aliases
    for key, entry in per_drug.items():
        forms = name_form_counts.get(key, Counter())
        if forms:
            display, _ = forms.most_common(1)[0]
            entry["name"] = display
            other_forms = sorted(f for f in forms.keys() if f != display)
            entry["aliases"] = other_forms
        else:
            entry["name"] = key
            entry["aliases"] = []

    return per_drug


def _coverage_status(ddi_total: int, has_atc: bool) -> str:
    if ddi_total == 0:
        return "yellow"  # 缺資料
    if not has_atc:
        return "red"  # 待補 ATC
    return "green"


def _drug_name_is(target: str, full_name: str) -> bool:
    """True iff `target` is a drug-level match for `full_name` — not a
    substring of a class name. Splits parens to handle 'Foo (Bar)' synonym
    forms but does NOT split slashes (which appear inside class names like
    'Serotonin/Norepinephrine Reuptake Inhibitor').
    """
    if not full_name or not target:
        return False
    target_l = target.strip().lower()
    full_l = full_name.strip().lower()
    if target_l == full_l:
        return True
    # Split parens: "Acetylsalicylic Acid (Aspirin)" → ["acetylsalicylic acid", "aspirin"]
    parts = [p.strip() for p in re.split(r"\s*[()]\s*", full_l) if p.strip()]
    return target_l in parts


def _row_about_target(row, target: str) -> bool:
    """True iff DDI row truly involves `target` as a drug — either exactly
    on side 1 / side 2 / or as a member of a class group, NOT just as a
    substring of a class name.
    """
    if _drug_name_is(target, row.drug1) or _drug_name_is(target, row.drug2):
        return True
    raw = row.interacting_members
    if isinstance(raw, str):
        try:
            raw = _json.loads(raw)
        except Exception:
            raw = None
    members_lists: list = []
    if isinstance(raw, list):
        for grp in raw:
            if isinstance(grp, dict):
                members_lists.append(grp.get("members") or [])
    elif isinstance(raw, dict):
        members_lists.extend(raw.values())
    for ms in members_lists:
        if not isinstance(ms, list):
            continue
        for m in ms:
            if _drug_name_is(target, m):
                return True
    return False


# ────────────────────────────────────────────────────────────────────
# Endpoint 1: stats banner
# ────────────────────────────────────────────────────────────────────
@router.get("/stats")
async def get_stats(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_pharmacist(user)

    r = await db.execute(text("""
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE risk_rating = 'X') AS x_count,
          COUNT(*) FILTER (WHERE risk_rating = 'D') AS d_count,
          COUNT(*) FILTER (WHERE risk_rating = 'C') AS c_count,
          COUNT(*) FILTER (WHERE risk_rating = 'B') AS b_count,
          COUNT(*) FILTER (WHERE risk_rating = 'A') AS a_count,
          COUNT(DISTINCT LOWER(drug1)) FILTER (WHERE drug1 IS NOT NULL) AS d1_uniq,
          COUNT(DISTINCT LOWER(drug2)) FILTER (WHERE drug2 IS NOT NULL) AS d2_uniq,
          COUNT(*) FILTER (WHERE drug1_atc IS NULL OR drug2_atc IS NULL) AS missing_atc,
          MAX(updated_at) AS last_updated
        FROM drug_interactions
        WHERE is_active = TRUE
    """))
    row = r.first()

    # Sources distribution
    r2 = await db.execute(text("""
        SELECT COALESCE("references", 'unspecified') AS src, COUNT(*) AS n
        FROM drug_interactions
        WHERE is_active = TRUE
        GROUP BY src
        ORDER BY n DESC
    """))
    sources = {row2.src: row2.n for row2 in r2}

    # Distinct drug names (drug1 ∪ drug2)
    r3 = await db.execute(text("""
        SELECT COUNT(*) AS n FROM (
          SELECT DISTINCT LOWER(drug1) AS d FROM drug_interactions
          WHERE is_active = TRUE AND drug1 IS NOT NULL
          UNION
          SELECT DISTINCT LOWER(drug2) FROM drug_interactions
          WHERE is_active = TRUE AND drug2 IS NOT NULL
        ) t
    """))
    total_drugs = r3.scalar_one()

    # Recently added (Lexicomp 2026 batch)
    recently_added = sources.get("Lexicomp 2026", 0)

    return success_response(data={
        "total_drugs": total_drugs,
        "total_ddi": row.total,
        "ddi_by_risk": {
            "X": row.x_count, "D": row.d_count, "C": row.c_count,
            "B": row.b_count, "A": row.a_count,
        },
        "missing_atc": row.missing_atc,
        "sources": sources,
        "recently_added": recently_added,
        "last_updated": row.last_updated.isoformat() if row.last_updated else None,
    })


# ────────────────────────────────────────────────────────────────────
# Endpoint 2: drug list (paginated, searchable, sortable)
# ────────────────────────────────────────────────────────────────────
@router.get("/drugs")
async def list_drugs(
    q: Optional[str] = Query(None, description="搜尋關鍵字（藥名/ATC/院內代碼）"),
    atc: Optional[str] = Query(None, description="ATC 前綴篩選"),
    sort: str = Query("name", pattern="^(name|ddi_count)$"),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    in_formulary_only: bool = Query(False),
    has_x_only: bool = Query(False),
    missing_atc_only: bool = Query(False),
    recently_added_only: bool = Query(False),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_pharmacist(user)

    per_drug = await _aggregate_per_drug(db)

    # Enrich + filter
    items: list[dict] = []
    atc_chapter_counts: Counter = Counter()
    q_lower = (q or "").strip().lower()
    atc_lower = (atc or "").strip().upper()

    for _key, agg in per_drug.items():
        name = agg["name"]
        aliases = agg.get("aliases", [])
        atcs = sorted(agg["atc_codes"])
        primary_atc = atcs[0] if atcs else None
        atc_chapter = primary_atc[0] if primary_atc else None

        fm = _formulary_lookup(name)
        in_formulary = bool(fm)
        brand_names = fm["brand_names"] if fm else []
        hospital_codes = fm["hospital_codes"] if fm else []

        recently_added = agg["recently_added_count"] > 0 and agg["ddi_counts"]["total"] == agg["recently_added_count"]
        status = _coverage_status(agg["ddi_counts"]["total"], bool(primary_atc))

        # Search filter
        if q_lower:
            haystack = " ".join([
                name.lower(),
                " ".join(a.lower() for a in aliases),
                " ".join(b.lower() for b in brand_names),
                " ".join(c.lower() for c in hospital_codes),
                primary_atc.lower() if primary_atc else "",
            ])
            if q_lower not in haystack:
                continue

        if atc_lower and (not primary_atc or not primary_atc.upper().startswith(atc_lower)):
            continue
        if in_formulary_only and not in_formulary:
            continue
        if has_x_only and agg["ddi_counts"]["X"] == 0:
            continue
        if missing_atc_only and primary_atc:
            continue
        if recently_added_only and not recently_added:
            continue

        items.append({
            "name": name,
            "aliases": aliases,
            "atc": primary_atc,
            "atc_chapter": atc_chapter,
            "atc_codes": atcs,
            "brand_names": brand_names,
            "hospital_codes": hospital_codes,
            "in_formulary": in_formulary,
            "ddi_counts": agg["ddi_counts"],
            "sources": sorted(agg["sources"]),
            "recently_added": recently_added,
            "status": status,
        })
        if atc_chapter:
            atc_chapter_counts[atc_chapter] += 1

    # Sort — library default is alphabetical
    if sort == "ddi_count":
        items.sort(key=lambda x: (-x["ddi_counts"]["total"], x["name"].lower()))
    else:  # name (default)
        items.sort(key=lambda x: x["name"].lower())

    total = len(items)
    start = (page - 1) * size
    page_items = items[start:start + size]

    atc_classes = [
        {"code": code, "name": ATC_TOP.get(code, code), "count": atc_chapter_counts[code]}
        for code in sorted(ATC_TOP.keys())
        if atc_chapter_counts[code] > 0
    ]

    return success_response(data={
        "total": total,
        "page": page,
        "size": size,
        "items": page_items,
        "atc_classes": atc_classes,
    })


# ────────────────────────────────────────────────────────────────────
# Endpoint 3: drug detail
# ────────────────────────────────────────────────────────────────────
@router.get("/drugs/{name}")
async def get_drug_detail(
    name: str,
    scope: str = Query("all", pattern="^(all|icu)$"),
    risk: Optional[str] = Query(None, description="逗號分隔風險過濾，如 X,D"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_pharmacist(user)

    # Build risk filter
    risk_filter: Optional[set] = None
    if risk:
        risk_filter = {r.strip().upper() for r in risk.split(",") if r.strip()}

    # Fetch all DDI rows where this drug appears (drug1 / drug2 / interacting_members)
    escaped = escape_like(name)
    r = await db.execute(text(f"""
        SELECT
          id, drug1, drug2, drug1_atc, drug2_atc,
          risk_rating, severity, severity_label, reliability_rating,
          mechanism, clinical_effect, management, discussion,
          "references" AS source_ref, pubmed_ids,
          interacting_members,
          pharmacist_note, last_verified_at, verified_by, etag
        FROM drug_interactions
        WHERE is_active = TRUE
          AND (drug1 ILIKE :pat OR drug2 ILIKE :pat
               OR CAST(interacting_members AS TEXT) ILIKE :pat)
        ORDER BY
          CASE risk_rating WHEN 'X' THEN 0 WHEN 'D' THEN 1 WHEN 'C' THEN 2
                          WHEN 'B' THEN 3 WHEN 'A' THEN 4 ELSE 5 END
    """), {"pat": f"%{escaped}%"})

    ddi_rows = list(r)
    if not ddi_rows:
        # Drug name not found — return empty profile
        return success_response(data={
            "name": name, "exists": False, "ddi": [],
        })

    # Determine "this drug" canonical name (most common occurrence)
    name_lower = name.lower()
    primary_name = name
    for row in ddi_rows:
        if row.drug1 and row.drug1.lower() == name_lower:
            primary_name = row.drug1
            break
        if row.drug2 and row.drug2.lower() == name_lower:
            primary_name = row.drug2
            break

    # ATC for this drug — pick from any row where drug1==name → drug1_atc, etc.
    primary_atc = None
    for row in ddi_rows:
        if row.drug1 and row.drug1.lower() == name_lower and row.drug1_atc:
            primary_atc = row.drug1_atc
            break
        if row.drug2 and row.drug2.lower() == name_lower and row.drug2_atc:
            primary_atc = row.drug2_atc
            break

    # Formulary enrichment
    fm = _formulary_lookup(primary_name)
    in_formulary = bool(fm)
    if not primary_atc and fm:
        primary_atc = fm.get("atc")

    # Build DDI list (the OTHER drug). Reject string-pollution rows where
    # the target drug only appears as a substring of a class name.
    ddi_out = []
    sources_seen = set()
    for row in ddi_rows:
        if not _row_about_target(row, primary_name):
            continue
        d1, d2 = row.drug1 or "", row.drug2 or ""
        is_d1 = _drug_name_is(primary_name, d1)
        is_d2 = _drug_name_is(primary_name, d2)
        if is_d1:
            other = d2
            other_atc = row.drug2_atc
        elif is_d2:
            other = d1
            other_atc = row.drug1_atc
        else:
            # Class-member match — pick the side whose group/name does NOT
            # contain the target as a member, since target is on the other.
            raw = row.interacting_members
            if isinstance(raw, str):
                try:
                    raw = _json.loads(raw)
                except Exception:
                    raw = None
            target_in_d1_group = False
            if isinstance(raw, list):
                for grp in raw:
                    if not isinstance(grp, dict):
                        continue
                    if (grp.get("group_name") or "").lower() == d1.lower():
                        for m in grp.get("members") or []:
                            if _drug_name_is(primary_name, m):
                                target_in_d1_group = True
                                break
            elif isinstance(raw, dict):
                for gn, mems in raw.items():
                    if gn.lower() == d1.lower():
                        for m in mems or []:
                            if _drug_name_is(primary_name, m):
                                target_in_d1_group = True
                                break
            if target_in_d1_group:
                other = d2
                other_atc = row.drug2_atc
            else:
                other = d1
                other_atc = row.drug1_atc
        risk_str = (row.risk_rating or "").upper()
        if risk_filter and risk_str not in risk_filter:
            continue
        if row.source_ref:
            sources_seen.add(row.source_ref)
        try:
            pmids = row.pubmed_ids if isinstance(row.pubmed_ids, list) else (
                _json.loads(row.pubmed_ids) if row.pubmed_ids else []
            )
        except Exception:
            pmids = []
        ddi_out.append({
            "id": row.id,
            "other_drug": other,
            "other_drug_atc": other_atc,
            "risk_rating": risk_str,
            "severity": row.severity,
            "severity_label": row.severity_label,
            "reliability": row.reliability_rating,
            "mechanism": row.mechanism,
            "clinical_effect": row.clinical_effect,
            "management": row.management,
            "discussion": row.discussion,
            "source": row.source_ref,
            "pubmed_count": len(pmids) if isinstance(pmids, list) else 0,
            # Phase 4a: editor metadata
            "pharmacist_note": row.pharmacist_note,
            "last_verified_at": row.last_verified_at.isoformat() if row.last_verified_at else None,
            "verified_by": row.verified_by,
            "etag": row.etag,
        })

    # ATC path with Chinese labels for L1/L2/L3 (L4/L5 stay code-only)
    atc_path = []
    if primary_atc:
        if len(primary_atc) >= 1:
            atc_path.append({"code": primary_atc[:1], "name": ATC_TOP.get(primary_atc[:1], "")})
        if len(primary_atc) >= 3:
            atc_path.append({"code": primary_atc[:3], "name": ATC_LEVEL2.get(primary_atc[:3], "")})
        if len(primary_atc) >= 5:
            atc_path.append({"code": primary_atc[:5], "name": ATC_LEVEL3.get(primary_atc[:5], "")})
        if len(primary_atc) >= 7:
            atc_path.append({"code": primary_atc, "name": ""})

    # Risk count
    risk_counts = {"X": 0, "D": 0, "C": 0, "B": 0, "A": 0}
    for d in ddi_out:
        if d["risk_rating"] in risk_counts:
            risk_counts[d["risk_rating"]] += 1

    # ── IV compatibility for this drug (Trissel's Handbook etc.) ───
    iv_rows = await db.execute(text("""
        SELECT id, drug1, drug2, solution, compatible, time_stability,
               notes, "references" AS source_ref
        FROM iv_compatibilities
        WHERE drug1 ILIKE :pat OR drug2 ILIKE :pat
        ORDER BY compatible DESC, drug1, drug2
    """), {"pat": f"%{escaped}%"})
    iv_compat = []
    for row in iv_rows:
        d1 = row.drug1 or ""
        d2 = row.drug2 or ""
        if d1.lower() == name_lower:
            other = d2
        elif d2.lower() == name_lower:
            other = d1
        else:
            other = f"{d1} ↔ {d2}"
        iv_compat.append({
            "id": row.id,
            "other_drug": other,
            "solution": row.solution,
            "compatible": row.compatible,
            "time_stability": row.time_stability,
            "notes": row.notes,
            "source": row.source_ref,
        })

    return success_response(data={
        "name": primary_name,
        "exists": True,
        "atc": primary_atc,
        "atc_path": atc_path,
        "brand_names": fm["brand_names"] if fm else [],
        "hospital_codes": fm["hospital_codes"] if fm else [],
        "in_formulary": in_formulary,
        "sources": sorted(sources_seen),
        "ddi_total": len(ddi_out),
        "ddi_by_risk": risk_counts,
        "ddi": ddi_out,
        "iv_compatibility": iv_compat,
    })


# ────────────────────────────────────────────────────────────────────
# Phase 4a — editor endpoints (note / verify / deprecate / restore / history)
# ────────────────────────────────────────────────────────────────────

class _NoteIn(BaseModel):
    note: Optional[str] = Field(default=None, max_length=2000)


class _DeprecateIn(BaseModel):
    reason: str = Field(min_length=30, max_length=500,
                         description="軟刪除原因，至少 30 字（合規要求）")


class _RestoreIn(BaseModel):
    reason: str = Field(min_length=10, max_length=500)


async def _write_audit_log(
    db: AsyncSession,
    request: Optional[Request],
    user: User,
    *,
    action: str,
    entity_type: str,
    entity_id: str,
    before: Optional[dict] = None,
    after: Optional[dict] = None,
    reason: Optional[str] = None,
) -> None:
    """Insert an immutable audit row. Triggered by every mutating editor endpoint."""
    ip = None
    ua = None
    if request is not None:
        ip = request.client.host if request.client else None
        ua = request.headers.get("user-agent")
    await db.execute(text("""
        INSERT INTO drug_library_audit_log
            (action, entity_type, entity_id, before_json, after_json,
             actor_id, actor_name, actor_role, reason, ip_address, user_agent)
        VALUES (:action, :etype, :eid, CAST(:before AS JSONB), CAST(:after AS JSONB),
                :aid, :aname, :arole, :reason, :ip, :ua)
    """), {
        "action": action,
        "etype": entity_type,
        "eid": entity_id,
        "before": _json.dumps(before, ensure_ascii=False) if before is not None else None,
        "after": _json.dumps(after, ensure_ascii=False) if after is not None else None,
        "aid": user.id,
        "aname": user.name,
        "arole": user.role,
        "reason": reason,
        "ip": ip,
        "ua": ua,
    })


async def _fetch_rule_or_404(db: AsyncSession, rule_id: str) -> dict:
    r = await db.execute(text("""
        SELECT id, drug1, drug2, risk_rating, severity, is_active,
               pharmacist_note, last_verified_at, verified_by, etag
        FROM drug_interactions WHERE id = :id
    """), {"id": rule_id})
    row = r.first()
    if not row:
        raise HTTPException(status_code=404, detail="Rule not found")
    return {
        "id": row.id, "drug1": row.drug1, "drug2": row.drug2,
        "risk_rating": row.risk_rating, "severity": row.severity,
        "is_active": row.is_active, "pharmacist_note": row.pharmacist_note,
        "last_verified_at": row.last_verified_at,
        "verified_by": row.verified_by, "etag": row.etag,
    }


@router.patch("/rules/{rule_id}/note")
async def update_note(
    rule_id: str,
    body: _NoteIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Set or clear the pharmacist note on a rule. Single-pharmacist OK."""
    _require_pharmacist(user)
    before = await _fetch_rule_or_404(db, rule_id)
    new_note = (body.note or "").strip() or None

    await db.execute(text("""
        UPDATE drug_interactions
        SET pharmacist_note = :note, etag = etag + 1, updated_at = NOW()
        WHERE id = :id
    """), {"note": new_note, "id": rule_id})

    await _write_audit_log(
        db, request, user,
        action="note", entity_type="rule", entity_id=rule_id,
        before={"pharmacist_note": before["pharmacist_note"]},
        after={"pharmacist_note": new_note},
    )
    await db.commit()
    after = await _fetch_rule_or_404(db, rule_id)
    return success_response(data={
        "id": rule_id,
        "pharmacist_note": after["pharmacist_note"],
        "etag": after["etag"],
    })


@router.post("/rules/{rule_id}/verify")
async def mark_verified(
    rule_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Stamp 'last_verified_at = now, verified_by = me' on a rule."""
    _require_pharmacist(user)
    before = await _fetch_rule_or_404(db, rule_id)

    await db.execute(text("""
        UPDATE drug_interactions
        SET last_verified_at = NOW(), verified_by = :uid,
            etag = etag + 1, updated_at = NOW()
        WHERE id = :id
    """), {"uid": user.id, "id": rule_id})

    await _write_audit_log(
        db, request, user,
        action="verify", entity_type="rule", entity_id=rule_id,
        before={"last_verified_at": before["last_verified_at"].isoformat()
                                     if before["last_verified_at"] else None,
                "verified_by": before["verified_by"]},
        after={"verified_by": user.id, "verified_by_name": user.name},
    )
    await db.commit()
    after = await _fetch_rule_or_404(db, rule_id)
    return success_response(data={
        "id": rule_id,
        "last_verified_at": after["last_verified_at"].isoformat()
                             if after["last_verified_at"] else None,
        "verified_by": after["verified_by"],
        "verified_by_name": user.name,
        "etag": after["etag"],
    })


@router.post("/rules/{rule_id}/deprecate")
async def deprecate_rule(
    rule_id: str,
    body: _DeprecateIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Soft-delete a rule. Marks is_active=FALSE; reason ≥30 chars required."""
    _require_pharmacist(user)
    before = await _fetch_rule_or_404(db, rule_id)
    if not before["is_active"]:
        raise HTTPException(status_code=409, detail="Rule already deprecated")

    await db.execute(text("""
        UPDATE drug_interactions
        SET is_active = FALSE,
            deprecated_at = NOW(),
            deprecated_by = :uid,
            deprecated_reason = :reason,
            etag = etag + 1,
            updated_at = NOW()
        WHERE id = :id
    """), {"uid": user.id, "reason": body.reason, "id": rule_id})

    await _write_audit_log(
        db, request, user,
        action="deprecate", entity_type="rule", entity_id=rule_id,
        before={"is_active": True},
        after={"is_active": False, "deprecated_by": user.id},
        reason=body.reason,
    )
    await db.commit()
    return success_response(data={
        "id": rule_id, "is_active": False, "deprecated_at_utc": "now",
    })


@router.post("/rules/{rule_id}/restore")
async def restore_rule(
    rule_id: str,
    body: _RestoreIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Undo a soft-delete. Reason required for audit trail."""
    _require_pharmacist(user)
    before = await _fetch_rule_or_404(db, rule_id)
    if before["is_active"]:
        raise HTTPException(status_code=409, detail="Rule is already active")

    await db.execute(text("""
        UPDATE drug_interactions
        SET is_active = TRUE,
            deprecated_at = NULL,
            deprecated_by = NULL,
            deprecated_reason = NULL,
            etag = etag + 1,
            updated_at = NOW()
        WHERE id = :id
    """), {"id": rule_id})

    await _write_audit_log(
        db, request, user,
        action="restore", entity_type="rule", entity_id=rule_id,
        before={"is_active": False},
        after={"is_active": True},
        reason=body.reason,
    )
    await db.commit()
    return success_response(data={"id": rule_id, "is_active": True})


@router.get("/rules/{rule_id}/history")
async def rule_history(
    rule_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Audit log for one rule, newest first. Pharmacist/admin only."""
    _require_pharmacist(user)
    r = await db.execute(text("""
        SELECT action, actor_id, actor_name, actor_role,
               before_json, after_json, reason, created_at
        FROM drug_library_audit_log
        WHERE entity_type = 'rule' AND entity_id = :id
        ORDER BY created_at DESC
        LIMIT 200
    """), {"id": rule_id})
    out = [{
        "action": row.action,
        "actor_id": row.actor_id,
        "actor_name": row.actor_name,
        "actor_role": row.actor_role,
        "before": row.before_json,
        "after": row.after_json,
        "reason": row.reason,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    } for row in r]
    return success_response(data={"rule_id": rule_id, "history": out})
