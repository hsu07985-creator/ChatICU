"""一次性驗證：AI 臨床夥伴在對話時，是否自動從 DB 翻查 meds + labs。

用法：
    cd backend && python3 scripts/probe_ai_chat_context.py
    cd backend && python3 scripts/probe_ai_chat_context.py -p <patient_id>

行為：
    1. 自動挑一位「有 active medications 且有 lab_data」的病人（或用 -p 指定）。
    2. 跑 build_clinical_snapshot()，dump 出 AI 每輪都會看到的快照。
    3. 用 4 句範例問題跑 build_question_prefetch_with_metadata()，
       觀察哪些問題會觸發額外的 DB 翻查（cultures / med-changes / reports / advice）。

不修改任何資料，只 SELECT。
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

# allow running from repo root or backend/ dir
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import select, func, distinct
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.patient import Patient
from app.models.medication import Medication
from app.models.lab_data import LabData
from app.services.patient_context_builder import build_clinical_snapshot
from app.services.ai_question_prefetch import build_question_prefetch_with_metadata


SAMPLE_QUESTIONS = [
    ("純藥物/lab 詢問", "他現在的腎功能怎麼樣？目前用藥有什麼劑量需要注意嗎？"),
    ("培養 / 抗生素", "這位病人最近的培養結果如何？要不要降階抗生素？"),
    ("用藥變動", "他最近 72 小時改了什麼藥？有沒有新加或停掉的藥？"),
    ("影像報告", "幫我看一下他最近的胸部 CT 報告。"),
]


async def pick_candidate_patient(db: AsyncSession) -> str:
    """找一個有 active meds 且有 lab_data 的病人。"""
    stmt = (
        select(
            Patient.id,
            Patient.name,
            Patient.bed_number,
            func.count(distinct(Medication.id)).label("med_cnt"),
            func.count(distinct(LabData.id)).label("lab_cnt"),
        )
        .join(Medication, Medication.patient_id == Patient.id)
        .join(LabData, LabData.patient_id == Patient.id)
        .group_by(Patient.id, Patient.name, Patient.bed_number)
        .having(func.count(distinct(Medication.id)) >= 3)
        .having(func.count(distinct(LabData.id)) >= 1)
        .order_by(func.count(distinct(Medication.id)).desc())
        .limit(1)
    )
    row = (await db.execute(stmt)).first()
    if not row:
        raise SystemExit("找不到符合條件的病人（active meds >= 3 且 lab_data >= 1）")
    print(f"[挑選] patient_id={row.id}  name={row.name}  bed={row.bed_number}  "
          f"meds={row.med_cnt}  labs={row.lab_cnt}")
    return row.id


async def main(patient_id: str | None) -> None:
    async with async_session() as db:
        if not patient_id:
            patient_id = await pick_candidate_patient(db)
        else:
            print(f"[使用指定 patient_id] {patient_id}")

        print("\n" + "=" * 78)
        print("PART 1 ── 每輪對話開頭，AI 看到的【臨床快照】（auto 翻查 meds + labs）")
        print("=" * 78)
        snapshot = await build_clinical_snapshot(patient_id, db)
        print(snapshot)

        print("\n" + "=" * 78)
        print("PART 2 ── 不同問題會觸發哪些【額外 DB 翻查】（prefetch）")
        print("=" * 78)
        for label, question in SAMPLE_QUESTIONS:
            print(f"\n--- 範例問題 [{label}] ---")
            print(f"使用者：{question}")
            text, meta = await build_question_prefetch_with_metadata(
                db, patient_id, question, user=None, ip=None,
            )
            cats = meta.get("prefetchCategories") or []
            print(f"[觸發] prefetch_categories = {cats or '無（只靠 snapshot 回答）'}")
            if text:
                print("[額外塞進 LLM 的 context]:")
                print(text)
            else:
                print("[額外 context]: （無，靠 snapshot 的 meds/labs/vitals 已足夠）")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("-p", "--patient", help="指定 patient_id；不給就自動挑一位")
    args = parser.parse_args()
    asyncio.run(main(args.patient))
