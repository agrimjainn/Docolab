// =============================================================================
// lib/api/presence.ts  —  self-reported online presence.
//
// Any authenticated user pings POST /presence/heartbeat on an interval to stamp
// users.last_seen_at. The admin panel reads that timestamp to show who is
// online (see backend presence_service.is_online). This is the REST presence
// channel — separate from the Yjs/Hocuspocus awareness used for live cursors.
// =============================================================================

import { apiFetch } from "@/lib/api/client";

export interface HeartbeatResponse {
  user_id: string;
  online: boolean;
  last_seen_at: string;
}

/** Stamp the caller's presence. Idempotent; safe to call frequently. */
export function heartbeat(): Promise<HeartbeatResponse> {
  return apiFetch<HeartbeatResponse>("/presence/heartbeat", { method: "POST" });
}
