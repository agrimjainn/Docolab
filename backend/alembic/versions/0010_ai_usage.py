"""ai usage metering (token counts per model call)

Revision ID: 0010_ai_usage
Revises: 0009_ai_models
Create Date: 2026-07-08

Phase 4: the ai-gateway reports each call's real token usage here. Powers the
Admin "Model Usage" section (usage % by model, tokens per model, top documents
by usage). Additive; no existing table touched.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0010_ai_usage"
down_revision: str = "0009_ai_models"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_usage_events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", UUID(as_uuid=True), nullable=False),
        sa.Column("document_id", UUID(as_uuid=True), sa.ForeignKey("documents.id", ondelete="SET NULL"), nullable=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("vendor", sa.Text(), nullable=False),
        sa.Column("model_key", sa.Text(), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("request_id", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("request_id", name="uq_ai_usage_request"),
    )
    op.create_index("idx_ai_usage_org", "ai_usage_events", ["org_id"])
    op.create_index("idx_ai_usage_document", "ai_usage_events", ["document_id"])
    op.create_index("idx_ai_usage_model", "ai_usage_events", ["org_id", "model_key"])
    op.create_index("idx_ai_usage_created", "ai_usage_events", ["created_at"])


def downgrade() -> None:
    op.drop_index("idx_ai_usage_created", table_name="ai_usage_events")
    op.drop_index("idx_ai_usage_model", table_name="ai_usage_events")
    op.drop_index("idx_ai_usage_document", table_name="ai_usage_events")
    op.drop_index("idx_ai_usage_org", table_name="ai_usage_events")
    op.drop_table("ai_usage_events")
