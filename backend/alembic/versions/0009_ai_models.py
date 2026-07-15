"""ai model catalog (governed per-org allow-list) + normalise documents.ai_model

Revision ID: 0009_ai_models
Revises: 0008_admin_features
Create Date: 2026-07-08

Phase 1 of backend-governed, multi-vendor AI:
  - ai_models          — org-scoped catalog of assignable models. documents.ai_model
                        stores a model_key that must resolve to an ENABLED row here.
                        Vendor API keys are NOT stored (they live on the AI gateway).
  - documents.ai_model — the previous coarse default 'gemini' is normalised to the
                        concrete catalog key 'gemini-2.5-flash' (what the editor
                        actually runs), and the column default is bumped to match.

Additive + a one-shot data normalise; nothing that reads documents.ai_model breaks
(the resolver also falls back to the org default for any unknown value).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0009_ai_models"
down_revision: str = "0008_admin_features"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_models",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", UUID(as_uuid=True), nullable=False),
        sa.Column("vendor", sa.Text(), nullable=False),
        sa.Column("model_key", sa.Text(), nullable=False),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("org_id", "model_key", name="uq_ai_models_org_key"),
    )
    op.create_index("idx_ai_models_org", "ai_models", ["org_id"])

    # Normalise the coarse legacy default to the concrete model the editor runs.
    op.execute("UPDATE documents SET ai_model = 'gemini-2.5-flash' WHERE ai_model = 'gemini'")
    op.alter_column("documents", "ai_model", server_default="gemini-2.5-flash")


def downgrade() -> None:
    op.alter_column("documents", "ai_model", server_default="gemini")
    op.execute("UPDATE documents SET ai_model = 'gemini' WHERE ai_model = 'gemini-2.5-flash'")
    op.drop_index("idx_ai_models_org", table_name="ai_models")
    op.drop_table("ai_models")
