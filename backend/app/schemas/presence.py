import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class HeartbeatResponse(BaseModel):
    user_id: uuid.UUID
    online: bool
    last_seen_at: Optional[datetime]
