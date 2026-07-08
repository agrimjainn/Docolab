# =============================================================================
# app/services/presence_service.py
# Derived online/offline state from users.last_seen_at.
#
# We do NOT store an "online" boolean (it would go stale the moment a client
# disconnects without telling us). Instead each client pings POST
# /presence/heartbeat on an interval, which stamps users.last_seen_at; a user
# is considered ONLINE if that stamp is within ONLINE_WINDOW_SECONDS of now.
# =============================================================================

from datetime import datetime, timedelta, timezone
from typing import Optional

# A user is "online" if they pinged within this many seconds. Sized to comfortably
# cover a client heartbeat interval of ~30s plus network slack.
ONLINE_WINDOW_SECONDS = 90


def is_online(last_seen_at: Optional[datetime], now: Optional[datetime] = None) -> bool:
    """True if `last_seen_at` falls inside the online window ending at `now`."""
    if last_seen_at is None:
        return False
    now = now or datetime.now(timezone.utc)
    # Guard against naive datetimes coming back from some drivers.
    if last_seen_at.tzinfo is None:
        last_seen_at = last_seen_at.replace(tzinfo=timezone.utc)
    return (now - last_seen_at) <= timedelta(seconds=ONLINE_WINDOW_SECONDS)
