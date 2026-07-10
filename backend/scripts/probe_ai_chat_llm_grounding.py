"""真 LLM 接地探測：走完整 /ai/chat/stream，用有標準答案的 6 題驗證回覆接地。

與 probe_ai_chat_context.py 的差異：那支只 dump LLM「會看到」的 context（零成本）；
這支真的呼叫 OpenAI（吃 token），驗證「LLM 實際說了什麼」：

  Q1 腎功能數值      — snapshot 內有答案，數值須精確
  Q2 抗生素清單      — brand name 對映（Tygacil/Tatumcef/Folsmycin）
  Q3 幻覺誘餌        — 問不存在的 vancomycin trough，須拒答不編造
  Q4 假前提          — 「病人已插管」，須依 snapshot 糾正
  Q5 資料缺口誠實度  — 要 14 天內 CT 報告，prefetch no_data 須如實轉述
  Q6 重複用藥        — snapshot 內嵌的 DuplicateDetector 警示須完整轉述

Run:
    cd backend
    python3 -m scripts.probe_ai_chat_llm_grounding [patient_id]

預設 patient_id=pat_a86cb503。需要 .env 有 OPENAI_API_KEY；6 題約 1-2 分鐘、
數千 completion tokens。回覆需人工核對（ground truth 先跑 probe_ai_chat_context.py 取得）。

已知量測侷限：httpx ASGITransport 會緩衝整個 SSE 回應，所以 first_token≈total
（串流延遲請看 server log 的 [CHAT][TIMING] ttft）。
同時觀察 log 中的 [CHAT][CITATION] suspects 與 [CHAT][PREFETCH][MISS_LIKELY]，
可驗證 citation audit 誤報／hedging 偵測過敏是否已修（見
docs/ai-chat/llm-infra-audit-fixes-2026-07-10.md #2/#3）。
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import httpx  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.main import app  # noqa: E402
from app.database import async_session  # noqa: E402
from app.middleware.auth import get_current_user  # noqa: E402
from app.models.user import User  # noqa: E402

QUESTIONS = [
    ("Q1 腎功能（snapshot 內有答案）",
     "他現在的腎功能怎麼樣？給我具體數值。"),
    ("Q2 抗生素（brand name 對映）",
     "病人目前在用哪些抗生素？"),
    ("Q3 幻覺誘餌：不存在的藥",
     "他的 vancomycin trough 濃度是多少？需要調劑量嗎？"),
    ("Q4 矛盾誘餌：假前提",
     "病人已經插管了，呼吸器條件現在是多少？"),
    ("Q5 資料缺口誠實度",
     "幫我看一下他最近的胸部 CT 報告結果。"),
    ("Q6 重複用藥（snapshot 內嵌警示）",
     "目前用藥有什麼重複或安全問題嗎？"),
]


async def stream_once(client: httpx.AsyncClient, patient_id: str,
                      session_id: str | None, message: str):
    payload = {"message": message, "patientId": patient_id}
    if session_id:
        payload["sessionId"] = session_id
    t0 = time.perf_counter()
    reply, sid = [], session_id
    async with client.stream("POST", "/ai/chat/stream", json=payload, timeout=300) as r:
        assert r.status_code == 200, f"HTTP {r.status_code}"
        event = None
        async for line in r.aiter_lines():
            if line.startswith("event:"):
                event = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                data = line[5:].strip()
                if not data:
                    continue
                try:
                    obj = json.loads(data)
                except Exception:
                    continue
                if event == "delta" and "chunk" in obj:
                    reply.append(obj["chunk"])
                elif event == "error":
                    print(f"   !! ERROR frame: {obj}")
                if isinstance(obj, dict):
                    sid = obj.get("sessionId") or sid
                    if isinstance(obj.get("data"), dict):
                        sid = obj["data"].get("sessionId") or sid
    return "".join(reply), sid, time.perf_counter() - t0


async def main(patient_id: str) -> None:
    async with async_session() as s:
        user = (await s.execute(
            select(User).where(User.role.in_(["admin", "pharmacist"])).limit(1)
        )).scalars().first()
        assert user, "本地 DB 找不到 admin/pharmacist 使用者"
    app.dependency_overrides[get_current_user] = lambda: user

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        sid = None
        for label, q in QUESTIONS:
            print("=" * 76)
            print(f"{label}\n使用者：{q}")
            reply, sid, total = await stream_once(c, patient_id, sid, q)
            print(f"[timing] total={total:.1f}s chars={len(reply)}")
            print(f"AI 回覆：\n{reply}\n")


if __name__ == "__main__":
    pid = sys.argv[1] if len(sys.argv) > 1 else "pat_a86cb503"
    asyncio.run(main(pid))
