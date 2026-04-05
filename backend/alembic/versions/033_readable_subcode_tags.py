"""Update subcode tags from bare codes to readable format.

Existing tags like '1-1' become '1-1 給藥問題' so pharmacists can
read the tag without memorizing code numbers.

Revision ID: 033
Revises: 032
Create Date: 2026-04-05
"""

import json

from alembic import op
import sqlalchemy as sa

revision = "033"
down_revision = "032"
branch_labels = None
depends_on = None

_CODE_TO_SHORT_LABEL = {
    "1-1": "給藥問題",
    "1-2": "適應症問題",
    "1-3": "用藥禁忌問題",
    "1-4": "藥品併用問題",
    "1-5": "藥品交互作用",
    "1-6": "疑似藥品不良反應",
    "1-7": "藥品相容性問題",
    "1-8": "其他",
    "1-9": "不符健保給付規定",
    "1-10": "用藥劑量/頻次問題",
    "1-11": "用藥期間/數量問題",
    "1-12": "用藥途徑或劑型問題",
    "1-13": "建議更適當用藥/配方組成",
    "2-1": "用藥劑量/頻次問題",
    "2-2": "用藥期間/數量問題",
    "2-3": "用藥途徑或劑型問題",
    "2-4": "建議更適當用藥/配方組成",
    "2-5": "藥品不良反應評估",
    "2-6": "建議用藥/建議增加用藥",
    "2-7": "建議藥物治療療程",
    "2-8": "建議靜脈營養配方",
    "3-1": "建議藥品療效監測",
    "3-2": "建議藥品不良反應監測",
    "3-3": "建議藥品血中濃度監測",
    "4-1": "藥歷審核與整合",
    "4-2": "藥品辨識/自備藥辨識",
    "4-3": "病人用藥遵從性問題",
}


def upgrade():
    conn = op.get_bind()

    # Find messages with tags that contain bare advice codes (e.g. "1-1")
    rows = conn.execute(sa.text(
        "SELECT id, tags FROM patient_messages "
        "WHERE message_type = 'medication-advice' "
        "AND tags IS NOT NULL AND tags != '[]'::jsonb"
    )).fetchall()

    for row in rows:
        tags = row.tags if isinstance(row.tags, list) else json.loads(row.tags)
        updated = False
        new_tags = []
        for tag in tags:
            # Check if this tag is a bare code like "1-1", "2-3", etc.
            if tag in _CODE_TO_SHORT_LABEL:
                new_tags.append(f"{tag} {_CODE_TO_SHORT_LABEL[tag]}")
                updated = True
            else:
                new_tags.append(tag)

        if updated:
            conn.execute(
                sa.text("UPDATE patient_messages SET tags = :tags WHERE id = :id"),
                {"tags": json.dumps(new_tags), "id": row.id},
            )


def downgrade():
    pass
