# =============================================================================
# app/api/presence.py  —  POST /presence/heartbeat
#
# Any authenticated user pings this on an interval (e.g. every ~30s) to mark
# themselves online. The Admin page's user list reads users.last_seen_at to
# show who is currently online (see presence_service.is_online). This is the
# ONLY writer of last_seen_at, so presence stays a simple, self-reported signal
# and does not couple to the Yjs/Hocuspocus awareness channel.
# =============================================================================

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.database_models import User
from app.schemas.presence import HeartbeatResponse
from app.services.presence_service import is_online

router = APIRouter()


@router.post("/heartbeat", response_model=HeartbeatResponse)
async def heartbeat(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Stamp the caller's presence. Idempotent; safe to call frequently."""
    now = datetime.now(timezone.utc)
    current_user.last_seen_at = now
    await db.commit()
    return HeartbeatResponse(
        user_id=current_user.id,
        online=is_online(now, now),
        last_seen_at=now,
    )
