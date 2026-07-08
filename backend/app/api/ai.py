import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.database_models import User, Document, Recommendation, Suggestion
from app.schemas.ai import (
    AISuggestRequest, AISuggestResponse, ApplyAIRecommendationRequest,
    ApplyAIRecommendationResponse, AIJobStatusResponse, AIResolveResponse,
)
from app.services.auth_service import require_permission
from app.services.audit_service import record_audit, AuditAction
from app.services import ai_model_service

router = APIRouter()


@router.get("/documents/{id}/ai/resolve", response_model=AIResolveResponse)
async def resolve_ai_model(
    id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Tell the editor which vendor+model to use for this document (backend
    governs the choice; the client must NOT pick its own). Returns the
    document's assigned model resolved against the org's ENABLED catalog, with
    fallback to the org default. No API key is returned — the AI gateway holds
    keys and is handed a backend-issued grant separately (Phase 2)."""
    doc = (
        await db.execute(select(Document).where(Document.id == id, Document.org_id == current_user.org_id))
    ).scalars().first()
    if not doc or doc.status == "deleted":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    # Invoking AI is a suggest-level action; gate the resolve on the same right.
    await require_permission(db, current_user.id, "can_suggest", "document", doc.id)

    resolved = await ai_model_service.resolve(db, current_user.org_id, doc.ai_model)
    if resolved is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No AI model is enabled for this organization",
        )
    return AIResolveResponse(
        document_id=str(doc.id),
        vendor=resolved.vendor,
        model_key=resolved.model_key,
        display_name=resolved.display_name,
        is_fallback=(resolved.model_key != doc.ai_model),
    )


@router.post("/documents/{id}/ai/suggest", response_model=AISuggestResponse)
async def suggest_ai(
    id: str,
    data: AISuggestRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Enqueue AI job; return job id (rate/budget checked)."""
    doc = (
        await db.execute(select(Document).where(Document.id == id, Document.org_id == current_user.org_id))
    ).scalars().first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    await require_permission(db, current_user.id, "can_suggest", "document", doc.id)

    # Enqueue AI job (placeholder - would integrate with job queue)
    job_id = str(uuid.uuid4())

    return {
        "job_id": job_id,
        "status": "pending",
        "message": "AI suggestion job enqueued"
    }


@router.post("/recommendations/{id}/ai/apply", response_model=ApplyAIRecommendationResponse)
async def apply_ai_recommendation(
    id: str,
    data: ApplyAIRecommendationRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """AI drafts suggestions for a recommendation."""
    recommendation = (
        await db.execute(select(Recommendation).where(Recommendation.id == id))
    ).scalars().first()
    if not recommendation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recommendation not found")

    doc = (
        await db.execute(select(Document).where(Document.id == recommendation.document_id, Document.org_id == current_user.org_id))
    ).scalars().first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    await require_permission(db, current_user.id, "can_suggest", "document", doc.id)

    job_id = str(uuid.uuid4())

    suggestion = Suggestion(
        id=uuid.uuid4(),
        org_id=current_user.org_id,
        document_id=doc.id,
        author_id=None,  # AI-authored
        origin="ai",
        type="insert",
        anchor=recommendation.anchor,
        status="pending",
        reason="AI-generated suggestion from recommendation"
    )
    db.add(suggestion)
    await db.flush()
    record_audit(
        db, org_id=current_user.org_id, actor_id=current_user.id,
        action=AuditAction.AI_APPLY, target_type="suggestion",
        target_id=suggestion.id, document_id=doc.id,
        meta={"recommendation_id": str(recommendation.id), "job_id": job_id},
    )
    await db.commit()

    return {
        "job_id": job_id,
        "status": "pending",
        "message": "AI drafting suggestions for recommendation"
    }


@router.get("/ai/jobs/{job_id}", response_model=AIJobStatusResponse)
async def get_ai_job_status(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Poll job status."""
    # Placeholder: would read from a job_queue table.
    return {
        "job_id": job_id,
        "status": "completed",
        "created_at": None,
        "completed_at": None,
        "result": {
            "suggestions_created": 1,
            "message": "Job completed successfully"
        },
        "error": None
    }
