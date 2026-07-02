"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { Plate, usePlateEditor, usePluginOption } from "platejs/react";
import { YjsPlugin } from "@platejs/yjs/react";

import type { DocumentRecord } from "@/lib/types";
import { EditorKit } from "@/components/editor/editor-kit";
import { createYjsPlugin } from "@/components/editor/plugins/yjs-kit";
import { Editor, EditorContainer } from "@/components/ui/editor";
import { EditorTopBar } from "@/components/editor/editor-top-bar";
import { getCurrentUser } from "@/lib/api/auth";
import { buildCursorIdentity } from "@/lib/presence-identity";
import { saveCurrentSnapshot } from "@/lib/api/documents";

// Comments and Recommendations panels are only mounted when the user opens
// them, so keep them out of the initial editor chunk and load on demand.
const CommentsPanel = dynamic(
  () =>
    import("@/components/editor/comments-panel").then((m) => m.CommentsPanel),
  { ssr: false },
);
const RecommendationsPanel = dynamic(
  () =>
    import("@/components/editor/recommendations-panel").then(
      (m) => m.RecommendationsPanel,
    ),
  { ssr: false },
);
import { DocumentProvider, useDocument } from "@/lib/store/document-store";
import { DiscussionSync } from "@/components/editor/discussion-sync";
import { AuthGuard } from "@/components/auth-guard";

export function PlateEditor({ docId }: { docId: string }) {
  return (
    <AuthGuard>
      <DocumentProvider docId={docId}>
        <Workspace />
      </DocumentProvider>
    </AuthGuard>
  );
}

function Workspace() {
  const { doc, loading } = useDocument();

  if (loading || !doc) return <LoadingShell />;
  // Re-mount the Plate editor when the underlying document changes.
  return <LoadedWorkspace key={doc.id} doc={doc} />;
}

function LoadedWorkspace({ doc }: { doc: DocumentRecord }) {
  // Real-time collaboration is always on: content is owned by Yjs/Hocuspocus
  // (the canonical, persisted path) and the REST `content` is only the seed used
  // when a document's shared Y.Doc is still empty.
  //
  // The Hocuspocus room is the RESOLVED backend document id (doc.id), never the
  // raw route id: on /editor (no ?doc=) the route id is the sentinel "new", and
  // using it as the room name would (a) drop every user creating a new document
  // into one shared room and (b) persist to a non-existent row, losing content.
  const cursorData = React.useMemo(() => {
    const me = getCurrentUser();
    return buildCursorIdentity(
      me ?? { id: "anonymous", name: "Anonymous", email: "" },
    );
  }, []);

  const editor = usePlateEditor({
    // Yjs owns initialization — skip Plate's value seeding and init the shared
    // doc in the effect below (which seeds from the REST content only when the
    // shared doc is empty).
    skipInitialization: true,
    plugins: React.useMemo(
      () => [...EditorKit, createYjsPlugin(doc.id, cursorData)],
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    ),
  });
  const { readOnly, commentsOpen, recommendationsOpen, saveNow, caps } = useDocument();
  // Latest caps in a ref so the yjs cleanup effect (deps: []) can read them at
  // unmount time without re-subscribing to every caps change.
  const canEditRef = React.useRef(caps.canEdit);
  React.useEffect(() => {
    canEditRef.current = caps.canEdit;
  }, [caps.canEdit]);
  // With skipInitialization the editor starts with empty children and
  // PlateContent renders null. yjs.init() populates children asynchronously,
  // but nothing re-renders the tree when it finishes — onReady flips this state
  // so the editable actually mounts. (This was the "blank editor body" bug.)
  const [, setYjsReady] = React.useState(false);

  // Connect to Hocuspocus and seed the shared Y.Doc. On the very first connect
  // for a document (yjs_state is NULL server-side) the shared doc is empty, so
  // we seed it from the REST `content` we already loaded. Once content lives in
  // Yjs, that seed is ignored (init only seeds when the shared doc is empty).
  //
  // React StrictMode (dev only) runs this effect, its cleanup, then the effect
  // again — synchronously, before any of init()'s internal awaits resolve. Two
  // real bugs follow from that if handled naively:
  //   1. Calling init() twice creates a duplicate provider/WebSocket.
  //   2. Calling destroy() on the phantom first cleanup runs BEFORE init() ever
  //      reaches YjsEditor.connect() (which registers the Y.Doc observer), so
  //      the internal unobserveDeep() call removes a listener that was never
  //      added — Yjs logs "[yjs] Tried to remove event handler that doesn't
  //      exist." (harmless, but noisy and trips the Next.js error overlay).
  // Fix: init() runs at most once (guarded by a ref); destroy() is deferred by
  // one macrotask so the (synchronous) StrictMode remount can cancel it before
  // it fires. In production there's no double-invoke, so the timer always
  // fires and this behaves like a normal single init/destroy pair.
  const yjsInitedRef = React.useRef(false);
  const destroyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    const yjs = editor.getApi(YjsPlugin).yjs;
    if (destroyTimerRef.current) {
      // This is the StrictMode remount — cancel the phantom teardown and reuse
      // the still-live (or still-initializing) binding from the first run.
      clearTimeout(destroyTimerRef.current);
      destroyTimerRef.current = null;
    } else if (!yjsInitedRef.current) {
      yjsInitedRef.current = true;
      void yjs.init({
        id: doc.id,
        value: doc.content,
        autoConnect: true,
        onReady: () => setYjsReady(true),
      });
    }
    // Publish the local user's presence identity immediately (before the first
    // cursor move) so the avatar stack shows this user as soon as they join.
    try {
      editor.getOptions(YjsPlugin).awareness?.setLocalStateField("data", cursorData);
    } catch {
      /* awareness not ready yet — autoSend will publish on first selection */
    }
    return () => {
      // This timeout only actually fires on a REAL unmount (a StrictMode
      // phantom-unmount's synchronous remount cancels it above) — so it's
      // also the right, once-only place to push a final IDLE-tier content
      // snapshot for "leaving the document" (see saveCurrentSnapshot).
      destroyTimerRef.current = setTimeout(() => {
        destroyTimerRef.current = null;
        if (canEditRef.current) {
          void saveCurrentSnapshot(doc.id, structuredClone(editor.children)).catch(() => {
            /* best-effort backup write — Yjs's own persistence is the source of truth */
          });
        }
        yjs.destroy();
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ⌘S / Ctrl+S flushes a manual save: title/status metadata (content is
  // Yjs-owned and already continuously persisted) PLUS an explicit refresh of
  // the single IDLE-tier content snapshot, so "Save" always leaves behind an
  // up-to-date backup even if nobody is online later.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveNow();
        if (canEditRef.current) {
          void saveCurrentSnapshot(doc.id, structuredClone(editor.children)).catch(() => {});
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveNow, doc.id, editor]);

  return (
    <Plate editor={editor}>
      <CollabStatus />
      <DiscussionSync docId={doc.id} />
      <div className="flex h-screen flex-col overflow-hidden">
        <EditorTopBar />
        <div className="flex min-h-0 flex-1">
          <EditorContainer className="h-full flex-1 bg-app-bg">
            <Editor
              variant="default"
              readOnly={readOnly}
              className="bg-document-surface"
            />
          </EditorContainer>
          {commentsOpen && <CommentsPanel />}
          {recommendationsOpen && <RecommendationsPanel />}
        </div>
      </div>
    </Plate>
  );
}

// Surfaces the live Hocuspocus connection state as a non-intrusive toast: a
// sticky "reconnecting" warning while the socket is down (only after we were
// connected at least once), cleared when the link comes back. Must render
// inside <Plate> so it can read the YjsPlugin option.
function CollabStatus() {
  const isConnected = usePluginOption(YjsPlugin, "_isConnected");
  const wasConnected = React.useRef(false);

  React.useEffect(() => {
    if (isConnected) {
      if (wasConnected.current) {
        toast.success("Reconnected", { id: "collab-conn", duration: 2000 });
      }
      wasConnected.current = true;
    } else if (wasConnected.current) {
      toast.warning("Connection lost — reconnecting…", {
        id: "collab-conn",
        duration: Infinity,
      });
    }
  }, [isConnected]);

  return null;
}

function LoadingShell() {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border-subtle bg-surface px-lg">
        <div className="size-7 rounded bg-surface-container" />
        <div className="h-5 w-48 animate-pulse rounded bg-surface-container" />
        <div className="ml-auto h-8 w-20 animate-pulse rounded bg-surface-container" />
      </header>
      <div className="flex-1 bg-app-bg">
        <div className="mx-auto mt-16 w-full max-w-2xl space-y-4 px-6">
          <div className="h-9 w-2/3 animate-pulse rounded bg-surface-container" />
          <div className="h-4 w-full animate-pulse rounded bg-surface-container" />
          <div className="h-4 w-11/12 animate-pulse rounded bg-surface-container" />
          <div className="h-4 w-4/5 animate-pulse rounded bg-surface-container" />
        </div>
      </div>
    </div>
  );
}
