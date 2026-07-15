from pydantic import BaseModel
from typing import Optional


class AIJobResponse(BaseModel):
    job_id: str
    status: str  # pending / processing / completed / failed
    created_at: str
    result: Optional[dict] = None

    class Config:
        from_attributes = True


class AISuggestRequest(BaseModel):
    pass


class AISuggestResponse(BaseModel):
    job_id: str
    status: str
    message: str


class ApplyAIRecommendationRequest(BaseModel):
    pass


class ApplyAIRecommendationResponse(BaseModel):
    job_id: str
    status: str
    message: str


class AIJobStatusResponse(BaseModel):
    job_id: str
    status: str
    created_at: Optional[str] = None
    completed_at: Optional[str] = None
    result: Optional[dict] = None
    error: Optional[str] = None

    class Config:
        from_attributes = True


class AIResolveResponse(BaseModel):
    """The vendor+model the editor should use for a document. Resolved from the
    document's assigned model against the org's enabled catalog, falling back to
    the org default. Contains NO API key — keys live only on the AI gateway."""
    document_id: str
    vendor: str
    model_key: str
    display_name: str
    is_fallback: bool   # true if the doc's assigned model was missing/disabled


class AIUsageReportRequest(BaseModel):
    """Posted by the ai-gateway after a vendor call. `grant` is the SAME grant
    the gateway received (backend derives org/doc/user/vendor/model from it);
    `request_id` makes the write idempotent (one per upstream call)."""
    grant: str
    request_id: str
    input_tokens: int = 0
    output_tokens: int = 0


class AIUsageReportResponse(BaseModel):
    recorded: bool          # False if this request_id was already recorded
    request_id: str


class AIGrantResponse(BaseModel):
    """A resolve PLUS a signed, short-lived grant the frontend passes to the AI
    gateway in place of a vendor key. Still contains NO vendor key."""
    document_id: str
    vendor: str
    model_key: str
    display_name: str
    is_fallback: bool
    grant: str            # signed JWT — hand to the gateway as x-ai-grant
    gateway_url: str      # base URL of the AI gateway ("" if not configured)
    expires_in: int       # seconds
