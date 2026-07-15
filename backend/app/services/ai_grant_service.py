# =============================================================================
# app/services/ai_grant_service.py
# Mints short-lived, signed "AI grant" tokens.
#
# A grant is the credential the frontend hands to the AI gateway INSTEAD of a
# real vendor API key. It is a compact HMAC-signed JWT scoping a single AI
# action to: this user, this document, this org, and exactly one vendor+model,
# with a short expiry. The gateway verifies the signature + expiry, checks the
# requested vendor/model match the grant, then swaps in the real vendor key.
#
# The signing secret (AI_GATEWAY_SECRET) is shared ONLY with the gateway — never
# the browser. So even though the grant travels through the client, it cannot be
# forged, cannot exceed its scope, and expires in seconds.
# =============================================================================

import time

import jwt

from app.core.config import settings

GRANT_TYPE = "ai_grant"
SERVICE_TYPE = "service"


def issue_grant(*, user_id, org_id, document_id, vendor: str, model_key: str) -> str:
    """Sign an AI grant for one user+document+model. Raises nothing here — the
    caller has already authorized the action (can_suggest) and resolved the
    governed model."""
    now = int(time.time())
    payload = {
        "typ": GRANT_TYPE,
        "sub": str(user_id),
        "org": str(org_id),
        "doc": str(document_id),
        "vendor": vendor,
        "model": model_key,
        "iat": now,
        "exp": now + settings.AI_GRANT_TTL_SECONDS,
    }
    return jwt.encode(payload, settings.AI_GATEWAY_SECRET, algorithm=settings.ALGORITHM)


def verify_grant(token: str) -> dict:
    """Decode + validate a grant (used by tests / any backend-side check). The
    gateway performs the authoritative verification in Node with the same
    secret. Raises jwt exceptions on failure."""
    payload = jwt.decode(token, settings.AI_GATEWAY_SECRET, algorithms=[settings.ALGORITHM])
    if payload.get("typ") != GRANT_TYPE:
        raise jwt.InvalidTokenError("not an ai_grant token")
    return payload


def verify_service_token(token: str) -> dict:
    """Validate a SERVICE JWT — the credential the ai-gateway presents to the
    backend's internal usage endpoint to prove it is the gateway (authn). Signed
    with the shared AI_GATEWAY_SECRET. Scope of the reported usage is derived
    from the accompanying AI grant, NOT from this token."""
    payload = jwt.decode(token, settings.AI_GATEWAY_SECRET, algorithms=[settings.ALGORITHM])
    if payload.get("typ") != SERVICE_TYPE:
        raise jwt.InvalidTokenError("not a service token")
    return payload


def issue_service_token(subject: str = "ai-gateway", ttl_seconds: int = 300) -> str:
    """Sign a service JWT (used by tests, and available to the backend if it ever
    needs to mint one). The gateway signs its own with the shared secret."""
    now = int(time.time())
    return jwt.encode(
        {"typ": SERVICE_TYPE, "sub": subject, "iat": now, "exp": now + ttl_seconds},
        settings.AI_GATEWAY_SECRET,
        algorithm=settings.ALGORITHM,
    )
