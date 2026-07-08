"""admin features: user presence, per-document AI model, multi-folder placement

Revision ID: 0008_admin_features
Revises: 0007_content_snapshot
Create Date: 2026-07-08

Backs the Docolab Admin page. All additive — no existing column/table changes,
so nothing that reads the current schema breaks:

  - users.last_seen_at      — presence heartbeat timestamp (online/offline is
                              derived from this, never stored).
  - documents.ai_model      — the AI model assigned to a document (default
                              'gemini' so existing docs behave exactly as before).
  - document_folders        — many-to-many: a document may be filed under several
                              folders at once. The canonical location remains
                              documents.folder_id; this table only adds extras.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0008_admin_features"
down_revision: str = "0007_content_snapshot"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "documents",
        sa.Column("ai_model", sa.Text(), nullable=False, server_default="gemini"),
    )
    op.create_table(
        "document_folders",
        sa.Column("document_id", UUID(as_uuid=True), sa.ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("folder_id", UUID(as_uuid=True), sa.ForeignKey("folders.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("org_id", UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("idx_document_folders_folder", "document_folders", ["folder_id"])


def downgrade() -> None:
    op.drop_index("idx_document_folders_folder", table_name="document_folders")
    op.drop_table("document_folders")
    op.drop_column("documents", "ai_model")
    op.drop_column("users", "last_seen_at")
