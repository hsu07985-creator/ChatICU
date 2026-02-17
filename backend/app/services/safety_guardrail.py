"""Medical safety guardrail for AI-generated outputs (T30).

Applies to all LLM responses before they reach the user:
1. Appends a standard medical disclaimer
2. Flags potentially unsafe drug dosage mentions
3. Detects unsupported definitive diagnostic claims
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional

# ── Standard disclaimer appended to all AI outputs ──
MEDICAL_DISCLAIMER = (
    "\n\n---\n"
    "⚕️ **免責聲明**：本回覆由 AI 輔助產生，僅供臨床參考，不可取代醫師專業判斷。"
    "任何治療決策應以主治醫師評估為準。"
)

# ── Known dangerous drug keywords for dosage flagging ──
HIGH_ALERT_MEDICATIONS = [
    "heparin", "insulin", "warfarin", "digoxin", "morphine", "fentanyl",
    "norepinephrine", "epinephrine", "potassium chloride", "vancomycin",
    "methotrexate", "chemotherapy", "thrombolytic",
    "肝素", "胰島素", "華法林", "地高辛", "嗎啡", "芬太尼",
    "去甲腎上腺素", "腎上腺素", "氯化鉀", "萬古黴素",
]

# ── Patterns indicating definitive claims that should be flagged ──
DEFINITIVE_CLAIM_PATTERNS = [
    r"確定診斷為",
    r"一定(?:要|是|會)",
    r"(?:must|definitely|certainly)\s+(?:prescribe|administer|give)",
    r"保證(?:有效|治癒|痊癒)",
]


def apply_safety_guardrail(
    content: str,
    context: Optional[str] = None,
    include_disclaimer: bool = True,
    user_role: Optional[str] = None,
) -> Dict[str, object]:
    """Post-process AI output with safety checks.

    Args:
        content: Raw LLM output text.
        context: Optional context hint (unused, reserved).
        include_disclaimer: If True (default), appends MEDICAL_DISCLAIMER to content.
            Set to False for chat messages (frontend shows a persistent banner instead)
            to avoid repeating the disclaimer on every message.
        user_role: Optional user role (e.g. "pharmacist", "doctor").
            When role is "pharmacist", drug dosage warnings use
            「此計算結果僅供參考，請依臨床判斷」 instead of
            「須經藥師/醫師雙重確認」.

    Returns:
        dict with keys:
            - content: processed content (with or without disclaimer)
            - disclaimer: the standard disclaimer text (always returned for frontend banner)
            - warnings: list of safety warnings (if any)
            - flagged: True if any safety concern was detected
    """
    warnings: List[str] = []

    # 1. Check for high-alert medication mentions without dosage caution
    content_lower = content.lower()
    for med in HIGH_ALERT_MEDICATIONS:
        if med.lower() in content_lower:
            # Check if there's a numeric dosage near the mention
            pattern = re.compile(
                re.escape(med) + r"[^.]{0,60}\d+\s*(?:mg|mcg|ml|unit|mEq|g|IU)",
                re.IGNORECASE,
            )
            if pattern.search(content):
                if user_role == "pharmacist":
                    warnings.append(
                        f"⚠️ 高警訊藥物 ({med}) 此計算結果僅供參考，請依臨床判斷"
                    )
                else:
                    warnings.append(
                        f"⚠️ 高警訊藥物 ({med}) 劑量建議須經藥師/醫師雙重確認"
                    )

    # 2. Check for definitive diagnostic claims
    for pat in DEFINITIVE_CLAIM_PATTERNS:
        if re.search(pat, content, re.IGNORECASE):
            warnings.append("⚠️ AI 回覆包含確定性診斷用語，請以臨床檢查結果為準")
            break

    # 3. Append disclaimer only when requested
    processed_content = content
    if include_disclaimer:
        processed_content = content + MEDICAL_DISCLAIMER

    # 4. Warnings are returned separately for UI rendering (avoid duplicating content)
    # NOTE: Do not inject warnings into content here; the frontend renders warnings
    # via a dedicated SafetyWarnings component.

    flagged = len(warnings) > 0

    return {
        "content": processed_content,
        "disclaimer": MEDICAL_DISCLAIMER,
        "warnings": warnings,
        "flagged": flagged,
        # T30: Flagged outputs require expert review before clinical use
        "requiresExpertReview": flagged,
    }
