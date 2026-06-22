// =============================================================================
// lib/api/recommendations.ts — Manager feedback on a submitted version.
//
// The approve/reject endpoints do NOT carry a feedback string; the backend
// models feedback as a Recommendation attached to a version (see
// frontend_instructions.md §4). The approval flow is therefore TWO calls:
// decide (approve/reject), then post the recommendation as the feedback.
//
//   GET   /versions/:id/recommendations          list feedback on a version
//   POST  /versions/:id/recommendations          create feedback (Manager only)
//   GET   /recommendations/:id/responses          reply thread
//   POST  /recommendations/:id/responses          reply (Collaborator)
//   PATCH /recommendations/:id                     mark addressed/orphaned/open
// =============================================================================

import { apiFetch } from "@/lib/api/client";

export interface Recommendation {
  id: string;
  document_id: string;
  version_id: string;
  author_id: string;
  body: string;
  status: "open" | "addressed" | "orphaned";
  created_at: string;
}

export interface RecommendationResponse {
  id: string;
  recommendation_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

/** List the Manager's feedback notes attached to a version. */
export async function listRecommendations(versionId: string): Promise<Recommendation[]> {
  const data = await apiFetch<{ recommendations: Recommendation[] }>(
    `/versions/${versionId}/recommendations`,
  );
  return data.recommendations;
}

/** Post feedback on a version (requires can_give_final_approval → Manager/Owner). */
export async function createRecommendation(
  versionId: string,
  body: string,
): Promise<Recommendation> {
  return apiFetch<Recommendation>(`/versions/${versionId}/recommendations`, {
    method: "POST",
    body: JSON.stringify({ body, anchor: { type: "document" } }),
  });
}

export async function listResponses(recId: string): Promise<RecommendationResponse[]> {
  const data = await apiFetch<{ responses: RecommendationResponse[] }>(
    `/recommendations/${recId}/responses`,
  );
  return data.responses;
}

/** Reply to a recommendation (append-only; requires can_suggest). */
export async function createResponse(
  recId: string,
  body: string,
): Promise<RecommendationResponse> {
  return apiFetch<RecommendationResponse>(`/recommendations/${recId}/responses`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export async function updateRecommendationStatus(
  recId: string,
  status: Recommendation["status"],
): Promise<Recommendation> {
  return apiFetch<Recommendation>(`/recommendations/${recId}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}
