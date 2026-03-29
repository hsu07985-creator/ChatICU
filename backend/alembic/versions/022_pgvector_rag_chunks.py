"""Add pgvector extension and rag_chunks table.

Revision ID: 022_pgvector_rag
Revises: 021_medication_conc
Create Date: 2026-03-30
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "022_pgvector_rag"
down_revision = "021_medication_conc"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Enable pgvector extension (Supabase has it pre-installed)
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "rag_chunks",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("doc_id", sa.String(200), nullable=False),
        sa.Column("chunk_index", sa.Integer, nullable=False),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("contextual_prefix", sa.Text, nullable=True),
        sa.Column("contextual_text", sa.Text, nullable=True),
        sa.Column("category", sa.String(100), nullable=True),
        sa.Column("meta", sa.dialects.postgresql.JSONB, nullable=True),
        sa.Column("embedding_model", sa.String(100), nullable=False),
        sa.Column("source_fingerprint", sa.String(64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )

    # Add vector column (3072 dim for text-embedding-3-large)
    op.execute("ALTER TABLE rag_chunks ADD COLUMN embedding vector(1536) NOT NULL")

    # Indexes
    op.create_index("ix_rag_chunks_doc_id", "rag_chunks", ["doc_id"])
    op.create_index("ix_rag_chunks_category", "rag_chunks", ["category"])

    # HNSW index for cosine distance search
    op.execute(
        "CREATE INDEX ix_rag_chunks_embedding ON rag_chunks "
        "USING hnsw (embedding vector_cosine_ops)"
    )


def downgrade() -> None:
    op.drop_table("rag_chunks")
