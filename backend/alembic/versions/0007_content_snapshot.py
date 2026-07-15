"""add content_snapshot (single mutable warm-storage slot) to documents

Revision ID: 0007_content_snapshot
Revises: 0006_version_content
Create Date: 2026-07-03

Storage tiering (per product requirement):
  - COLD:  approved versions (versions.kind='approved') — permanent, one row
           per approval, never overwritten.
  - WARM:  a submission pending review (versions.kind='submission') — also a
           permanent row until approved/rejected.
  - HOT:   the live document while at least one client is connected — owned
           entirely by Yjs/Hocuspocus (documents.yjs_state).
  - IDLE:  when nobody is editing (or on an explicit manual save), the most
           recent known-good content is kept in exactly ONE row here,
           OVERWRITTEN in place — never accumulates history. This is
           deliberately separate from `versions` (which is permanent/append
           -only) to avoid the "unlimited manual snapshots" bloat problem.

NULL = no manual/idle save has happened yet for this document.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0007_content_snapshot"
down_revision: str = "0006_version_content"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "documents",
        sa.Column("content_snapshot", JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("documents", "content_snapshot")
