import type { Value } from "platejs";

import type { PresenceHue } from "@/lib/types";

// Presence colour palette assigned to live collaborators (Yjs awareness).
// This is the only non-user-data constant that survives the demo gut — it is
// pure presentation, not seeded content.
export const HUES: PresenceHue[] = [
  "violet",
  "teal",
  "amber",
  "rose",
  "sky",
  "lime",
  "fuchsia",
  "orange",
];

/** A genuinely blank document body — a single empty paragraph. */
export function blankContent(): Value {
  return [{ type: "p", children: [{ text: "" }] }];
}

type SlateNodeLike = { type?: string; text?: string; children?: SlateNodeLike[] };

// A paragraph counts as empty only when every child is whitespace-only text.
// Any non-paragraph block (image, table, heading, embed, …) is real content,
// so it is deliberately NOT treated as empty — this keeps isBlankValue
// conservative and avoids blocking media-only documents.
function isEmptyParagraph(node: SlateNodeLike): boolean {
  if (!node || node.type !== "p") return false;
  const children = node.children ?? [];
  return children.every(
    (c) => typeof c.text === "string" && c.text.trim() === "",
  );
}

/**
 * True when a Slate value has no content worth freezing — an empty array or a
 * document made up only of empty paragraphs. Used to block submitting a blank
 * document for approval, which would freeze a contentless version (nothing to
 * diff, and a blank approved baseline). Mirrored server-side in
 * versions.py::_is_blank_value.
 */
export function isBlankValue(value: Value | null | undefined): boolean {
  if (!Array.isArray(value) || value.length === 0) return true;
  return (value as unknown as SlateNodeLike[]).every(isEmptyParagraph);
}
