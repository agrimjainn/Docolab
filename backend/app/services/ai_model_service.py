# =============================================================================
# app/services/ai_model_service.py
# The single place that reasons about the org AI-model catalog (ai_models).
#
# documents.ai_model stores a model_key; this service resolves that key against
# the ENABLED catalog and, crucially, falls back to the org default when the
# key is missing or has been disabled — so an admin disabling a model, or a
# stale value, can never hard-fail AI in the editor.
#
# Vendor API keys live ONLY on the AI gateway service, never here — this layer
# governs *which* vendor+model are permitted, not *how* to call them.
# =============================================================================

from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database_models import AiModel

# Seed catalog for a fresh org. Only Gemini is enabled by default (it is what
# the editor runs today and the only vendor with a configured key pre-gateway);
# the rest are disabled placeholders an admin can turn on once the gateway holds
# their keys. `default=True` marks the org fallback.
SEED_CATALOG = [
    {"vendor": "google",    "model_key": "gemini-2.5-flash", "display_name": "Gemini 2.5 Flash", "enabled": True,  "is_default": True},
    {"vendor": "google",    "model_key": "gemini-2.5-pro",   "display_name": "Gemini 2.5 Pro",   "enabled": True,  "is_default": False},
    {"vendor": "openai",    "model_key": "gpt-4o-mini",      "display_name": "GPT-4o mini",      "enabled": False, "is_default": False},
    {"vendor": "openai",    "model_key": "gpt-4o",           "display_name": "GPT-4o",           "enabled": False, "is_default": False},
    {"vendor": "anthropic", "model_key": "claude-sonnet-4",  "display_name": "Claude Sonnet 4",  "enabled": False, "is_default": False},
]


async def list_models(db: AsyncSession, org_id, only_enabled: bool = False) -> list[AiModel]:
    query = select(AiModel).where(AiModel.org_id == org_id)
    if only_enabled:
        query = query.where(AiModel.enabled == True)  # noqa: E712
    return list((await db.execute(query.order_by(AiModel.display_name))).scalars().all())


async def get_by_key(db: AsyncSession, org_id, model_key: str) -> Optional[AiModel]:
    return (
        await db.execute(
            select(AiModel).where(AiModel.org_id == org_id, AiModel.model_key == model_key)
        )
    ).scalars().first()


async def default_model(db: AsyncSession, org_id) -> Optional[AiModel]:
    """The org's default (fallback) model — the flagged default if enabled, else
    the first enabled model, else None."""
    flagged = (
        await db.execute(
            select(AiModel).where(
                AiModel.org_id == org_id, AiModel.is_default == True, AiModel.enabled == True  # noqa: E712
            )
        )
    ).scalars().first()
    if flagged:
        return flagged
    return (
        await db.execute(
            select(AiModel).where(AiModel.org_id == org_id, AiModel.enabled == True)  # noqa: E712
            .order_by(AiModel.created_at)
        )
    ).scalars().first()


async def resolve(db: AsyncSession, org_id, model_key: str) -> Optional[AiModel]:
    """Resolve a document's model_key to a usable, ENABLED catalog row. Falls
    back to the org default when the key is unknown or disabled. Returns None
    only if the org has no enabled models at all."""
    m = await get_by_key(db, org_id, model_key)
    if m and m.enabled:
        return m
    return await default_model(db, org_id)


async def seed_org_catalog(db: AsyncSession, org_id) -> None:
    """Idempotently seed SEED_CATALOG for an org (only if it has no models yet).
    Queued on the given session; the caller commits."""
    existing = (
        await db.execute(select(AiModel).where(AiModel.org_id == org_id))
    ).scalars().first()
    if existing is not None:
        return
    for row in SEED_CATALOG:
        db.add(AiModel(org_id=org_id, **row))
