"""端點級煙霧測試：重複用藥 + 交互作用（真實 app + 本地 DB，僅 override 認證）。

與 smoke_test_duplicates.py 的差異：那支直接呼叫 DuplicateDetector service；
這支走完整 HTTP stack（routing、ACL、序列化、cache），涵蓋：

  1. GET  /patients/{pid}/medication-duplicates?context=icu   （病人層級重複偵測）
  2. POST /pharmacy/duplicate-check                            （手動清單 + ATC 解析）
  3. POST /api/v1/clinical/interactions                        （病人詳情頁交互作用檢查 + 陰性對照）
  4. GET  /pharmacy/drug-interactions?drugA=&drugB=            （藥事頁搜尋，drug graph → DB fallback）
  5. word-boundary 回歸（prednisolone vs methylprednisolone 不得誤報）

Run:
    cd backend
    python3 -m scripts.smoke_test_safety_endpoints [patient_id]

預設 patient_id=pat_a86cb503（吳佳旺，已知 4 條重複警示）。
只 SELECT + audit log 寫入（本地 DB），不改臨床資料。
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import httpx  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.main import app  # noqa: E402
from app.database import async_session  # noqa: E402
from app.middleware.auth import get_current_user  # noqa: E402
from app.models.user import User  # noqa: E402


async def main(patient_id: str) -> None:
    async with async_session() as s:
        user = (await s.execute(
            select(User).where(User.role.in_(["admin", "pharmacist"])).limit(1)
        )).scalars().first()
        assert user, "本地 DB 找不到 admin/pharmacist 使用者"
        print(f"[auth override] user={user.id} role={user.role}\n")

    app.dependency_overrides[get_current_user] = lambda: user

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:

        # 1. 病人層級重複偵測
        r = await c.get(f"/patients/{patient_id}/medication-duplicates",
                        params={"context": "icu"})
        d = r.json()["data"]
        print(f"1) per-patient duplicates: HTTP {r.status_code} counts={d['counts']}")
        for a in d["alerts"][:8]:
            meds = " + ".join(m["genericName"] for m in a["members"])
            print(f"   [{a['level']}] layer={a['layer']} {a['mechanism']}: {meds}")

        # 2. 手動清單 duplicate-check（PPI 同類 + RAAS 雙重阻斷，皆應 critical）
        r = await c.post("/pharmacy/duplicate-check", json={
            "drugs": [
                {"name": "Pantoprazole"}, {"name": "Esomeprazole"},
                {"name": "Lisinopril"}, {"name": "Valsartan"},
            ],
            "context": "icu",
        })
        d = r.json()["data"]
        print(f"\n2) manual duplicate-check: HTTP {r.status_code} counts={d['counts']}")
        print(f"   resolved ATC: {d['resolved']}")
        assert d["counts"]["critical"] >= 2, "預期 PPI×PPI 與 ACEI+ARB 皆 critical"

        # 3. 交互作用（DB 已知 pair）+ 陰性對照
        r = await c.post("/api/v1/clinical/interactions", json={
            "drug_list": ["DOPamine", "HaloPERidol", "Milrinone", "Anagrelide"],
        })
        d = r.json()["data"]
        print(f"\n3) clinical/interactions: HTTP {r.status_code} "
              f"overall={d['overall_severity']} findings={len(d['findings'])}")
        assert d["overall_severity"] == "contraindicated", "Milrinone×Anagrelide 應為 contraindicated"

        r = await c.post("/api/v1/clinical/interactions", json={
            "drug_list": ["Acetaminophen", "Normal Saline"],
        })
        d = r.json()["data"]
        print(f"   negative control: overall={d['overall_severity']} findings={len(d['findings'])}")
        assert d["overall_severity"] == "none" and not d["findings"], "陰性對照不應有 findings"

        # 4. 藥事頁搜尋（drug graph 缺檔時應 fallback DB）
        r = await c.get("/pharmacy/drug-interactions",
                        params={"drugA": "Amiodarone", "drugB": "PAZOPanib"})
        d = r.json()["data"]
        print(f"\n4) pharmacy/drug-interactions: HTTP {r.status_code} "
              f"total={d['total']} source={d['source']}")
        assert d["total"] >= 1, "Amiodarone×PAZOPanib 應查得到"

        # 5. word-boundary 回歸
        r = await c.post("/api/v1/clinical/interactions",
                         json={"drug_list": ["prednisolone", "methylprednisolone"]})
        d = r.json()["data"]
        print(f"\n5) word-boundary pred/methylpred: findings={len(d['findings'])}（超字串誤報應為 0）")

    print("\nPASS")


if __name__ == "__main__":
    pid = sys.argv[1] if len(sys.argv) > 1 else "pat_a86cb503"
    asyncio.run(main(pid))
