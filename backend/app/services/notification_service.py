# =============================================================================
# app/services/notification_service.py
#
# Shared fan-out helpers for creating Notification rows. Kept as best-effort
# UX plumbing (not a security boundary) — recipient resolution intentionally
# only considers DIRECT document-scoped assignments, not the full folder/org
# inheritance walk that authorize() performs, matching this project's existing
# "single-org v1" simplifications elsewhere.
#
# Types produced (payload always includes at least version_id + version_no):
#   submission_pending      -> approvers, when a version is submitted for review
#   version_approved        -> submitter + document participants, baseline advanced
#   version_rejected        -> submitter, submission was declined
#   recommendation_created  -> submitter, a Manager left feedback on their version
# =============================================================================

import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database_models import Assignment, Notification, Role, RolePermission


async def _direct_assignees(db: AsyncSession, document_id, permission: str | None = None) -> set:
    """User ids with a DIRECT document-scoped assignment, optionally filtered
    to roles holding `permission`."""
    query = (
        select(Assignment.user_id)
        .join(Role, Role.id == Assignment.role_id)
        .where(Assignment.scope_type == "document", Assignment.scope_id == document_id)
    )
    if permission is not None:
        query = query.join(
            RolePermission,
            (RolePermission.role_id == Role.id) & (RolePermission.permission == permission),
        )
    rows = (await db.execute(query)).scalars().all()
    return set(rows)


def _notify(db: AsyncSession, *, org_id, user_id, document_id, type: str, payload: dict) -> None:
    db.add(Notification(
        id=uuid.uuid4(), org_id=org_id, user_id=user_id,
        document_id=document_id, type=type, payload=payload,
    ))


async def notify_approvers_of_submission(
    db: AsyncSession, *, doc, version, submitter_id,
) -> None:
    """A version was submitted for review — tell whoever can approve it.
    Falls back to the document's creator if nobody holds direct approval
    rights on this document (common in the single-owner-gate flow)."""
    recipients = await _direct_assignees(db, doc.id, permission="can_give_final_approval")
    recipients.discard(submitter_id)  # don't notify yourself
    if not recipients:
        recipients = {doc.created_by} - {submitter_id}
    payload = {"version_id": str(version.id), "version_no": version.version_no,
               "submitter": str(submitter_id)}
    for user_id in recipients:
        _notify(db, org_id=doc.org_id, user_id=user_id, document_id=doc.id,
                type="submission_pending", payload=payload)


async def notify_version_decided(
    db: AsyncSession, *, doc, version, decided_by_id, approved: bool,
) -> None:
    """A submission was approved or rejected. The submitter always hears
    about it; on approval, everyone else with direct access also learns the
    comparison baseline moved (so their next Compare is against fresh data)."""
    payload = {"version_id": str(version.id), "version_no": version.version_no,
               "decided_by": str(decided_by_id)}
    notif_type = "version_approved" if approved else "version_rejected"

    recipients = {version.created_by}
    if approved:
        recipients |= await _direct_assignees(db, doc.id)
    recipients.discard(decided_by_id)

    for user_id in recipients:
        _notify(db, org_id=doc.org_id, user_id=user_id, document_id=doc.id,
                type=notif_type, payload=payload)


async def notify_recommendation_created(
    db: AsyncSession, *, doc_id, org_id, version, author_id,
) -> None:
    """A Manager left feedback on a version — tell whoever submitted it."""
    if version.created_by == author_id:
        return  # a manager commenting on their own submission — nothing to say
    _notify(
        db, org_id=org_id, user_id=version.created_by, document_id=doc_id,
        type="recommendation_created",
        payload={"version_id": str(version.id), "version_no": version.version_no,
                 "author": str(author_id)},
    )
