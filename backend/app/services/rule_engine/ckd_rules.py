"""CKD staging rule engine — pure logic, no LLM."""


CKD_STAGES = [
    {
        "stage": "G1",
        "egfr_min": 90,
        "egfr_max": float("inf"),
        "description": "Normal or high kidney function",
        "egfr_range": "≥90 mL/min/1.73m²",
        "recommendations": [
            "Monitor annually",
            "Control blood pressure",
            "Manage cardiovascular risk factors",
        ],
    },
    {
        "stage": "G2",
        "egfr_min": 60,
        "egfr_max": 89,
        "description": "Mildly decreased kidney function",
        "egfr_range": "60-89 mL/min/1.73m²",
        "recommendations": [
            "Monitor annually",
            "Assess progression risk",
            "Optimize blood pressure control",
        ],
    },
    {
        "stage": "G3a",
        "egfr_min": 45,
        "egfr_max": 59,
        "description": "Mildly to moderately decreased",
        "egfr_range": "45-59 mL/min/1.73m²",
        "recommendations": [
            "Monitor every 6 months",
            "Refer to nephrologist if progressing",
            "Adjust medication doses as needed",
            "Assess for complications (anemia, bone disease)",
        ],
    },
    {
        "stage": "G3b",
        "egfr_min": 30,
        "egfr_max": 44,
        "description": "Moderately to severely decreased",
        "egfr_range": "30-44 mL/min/1.73m²",
        "recommendations": [
            "Monitor every 3-6 months",
            "Nephrology referral recommended",
            "Avoid nephrotoxic agents",
            "Manage complications actively",
        ],
    },
    {
        "stage": "G4",
        "egfr_min": 15,
        "egfr_max": 29,
        "description": "Severely decreased kidney function",
        "egfr_range": "15-29 mL/min/1.73m²",
        "recommendations": [
            "Monitor every 3 months",
            "Prepare for renal replacement therapy",
            "Nephrology co-management required",
            "Dietary protein restriction",
        ],
    },
    {
        "stage": "G5",
        "egfr_min": 0,
        "egfr_max": 14,
        "description": "Kidney failure",
        "egfr_range": "<15 mL/min/1.73m²",
        "recommendations": [
            "Initiate dialysis or transplant evaluation",
            "Urgent nephrology management",
            "Strict fluid and electrolyte management",
        ],
    },
]


def classify_ckd_stage(egfr: float, has_proteinuria: bool = False) -> dict:
    """Classify CKD stage based on eGFR value.

    Args:
        egfr: Estimated glomerular filtration rate (mL/min/1.73m²).
        has_proteinuria: Whether albuminuria/proteinuria is present.

    Returns:
        Dict with stage, description, egfr_range, and recommendations.
    """
    for stage_info in CKD_STAGES:
        if stage_info["egfr_min"] <= egfr <= stage_info["egfr_max"]:
            result = {
                "stage": stage_info["stage"],
                "description": stage_info["description"],
                "egfr_range": stage_info["egfr_range"],
                "recommendations": list(stage_info["recommendations"]),
            }
            if has_proteinuria:
                result["recommendations"].insert(
                    0, "Proteinuria detected — consider ACEi/ARB therapy"
                )
            return result

    return {
        "stage": "Unknown",
        "description": "Unable to classify — invalid eGFR value",
        "egfr_range": "N/A",
        "recommendations": ["Verify lab results and retest"],
    }
