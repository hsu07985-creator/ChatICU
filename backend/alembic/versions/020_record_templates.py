"""Add customizable record templates."""

revision = "020_record_templates"
down_revision = "019_advice_response_link"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade():
    op.create_table(
        "record_templates",
        sa.Column("id", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("record_type", sa.String(length=30), nullable=False),
        sa.Column("role_scope", sa.String(length=20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by_id", sa.String(length=50), nullable=False),
        sa.Column("created_by_name", sa.String(length=100), nullable=False),
        sa.Column("updated_by_id", sa.String(length=50), nullable=True),
        sa.Column("updated_by_name", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_record_templates_name", "record_templates", ["name"])
    op.create_index("ix_record_templates_record_type", "record_templates", ["record_type"])
    op.create_index("ix_record_templates_role_scope", "record_templates", ["role_scope"])
    op.create_index("ix_record_templates_is_system", "record_templates", ["is_system"])
    op.create_index("ix_record_templates_is_active", "record_templates", ["is_active"])
    op.create_index("ix_record_templates_created_by_id", "record_templates", ["created_by_id"])


def downgrade():
    op.drop_index("ix_record_templates_created_by_id", table_name="record_templates")
    op.drop_index("ix_record_templates_is_active", table_name="record_templates")
    op.drop_index("ix_record_templates_is_system", table_name="record_templates")
    op.drop_index("ix_record_templates_role_scope", table_name="record_templates")
    op.drop_index("ix_record_templates_record_type", table_name="record_templates")
    op.drop_index("ix_record_templates_name", table_name="record_templates")
    op.drop_table("record_templates")
