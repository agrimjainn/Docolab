import type { DocVersion } from "@/lib/types";
import { latency, read, uid, write } from "@/lib/api/db";
import { USERS } from "@/lib/api/seed";

const keyFor = (docId: string) => `versions:${docId}`;

function name(id: string) {
  return USERS.find((u) => u.id === id)?.name ?? "Someone";
}

function seed(docId: string): DocVersion[] {
  const now = Date.now();
  const at = (h: number) => new Date(now - h * 3_600_000).toISOString();
  const versions: DocVersion[] = [
    { id: uid("ver"), label: "Current version", createdAt: at(0), authorId: "you", authorName: name("you"), isCurrent: true },
    { id: uid("ver"), label: "Edited by Sarah", createdAt: at(2), authorId: "sarah", authorName: name("sarah"), isCurrent: false },
    { id: uid("ver"), label: "Status set to Working", createdAt: at(26), authorId: "you", authorName: name("you"), isCurrent: false },
    { id: uid("ver"), label: "Initial draft", createdAt: at(72), authorId: "marcus", authorName: name("marcus"), isCurrent: false },
  ];
  write(keyFor(docId), versions);
  return versions;
}

export async function listVersions(docId: string): Promise<DocVersion[]> {
  await latency();
  return read<DocVersion[] | null>(keyFor(docId), null) ?? seed(docId);
}

/** Snapshot the current doc as a new version entry. */
export async function snapshotVersion(docId: string, label: string): Promise<DocVersion> {
  await latency(120);
  const list = read<DocVersion[] | null>(keyFor(docId), null) ?? seed(docId);
  const entry: DocVersion = {
    id: uid("ver"),
    label,
    createdAt: new Date().toISOString(),
    authorId: "you",
    authorName: name("you"),
    isCurrent: true,
  };
  write(keyFor(docId), [entry, ...list.map((v) => ({ ...v, isCurrent: false }))]);
  return entry;
}

export async function restoreVersion(docId: string, versionId: string): Promise<void> {
  await latency();
  const list = read<DocVersion[] | null>(keyFor(docId), null) ?? seed(docId);
  write(
    keyFor(docId),
    list.map((v) => ({ ...v, isCurrent: v.id === versionId })),
  );
}
