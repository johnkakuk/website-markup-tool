import type { Session } from "@supabase/supabase-js";
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  LogOut,
  MessageCircle,
  Plus,
  RefreshCw,
  Send,
  X
} from "lucide-react";
import { FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { buildProxyUrl, pagePathFromProxyUrl } from "./lib/proxyUrl";
import { captureAndUploadScreenshot } from "./lib/screenshot";
import { getElementTarget, resolveElement } from "./lib/selectors";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import type { Canvas, Comment, ElementTarget, PinPosition, Reply } from "./types";

type DraftComment = {
  x: number;
  y: number;
  xPct: number;
  yPct: number;
  pagePath: string;
  target: ElementTarget;
};

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoadingSession(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoadingSession(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  if (!hasSupabaseConfig) {
    return <MissingConfig />;
  }

  if (loadingSession) {
    return <main className="center-state">Loading workspace...</main>;
  }

  if (!session) {
    return <AuthScreen />;
  }

  return <Dashboard session={session} />;
}

function MissingConfig() {
  return (
    <main className="center-state">
      <section className="setup-panel">
        <h1>Supabase env vars are missing</h1>
        <p>Create `apps/frontend/.env.local` from `.env.example`, then restart Vite.</p>
      </section>
    </main>
  );
}

function AuthScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) {
      return;
    }

    setBusy(true);
    setError(null);

    const result =
      mode === "sign-in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    if (result.error) {
      setError(result.error.message);
    }

    setBusy(false);
  }

  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div>
          <span className="eyebrow">Website Markup Tool</span>
          <h1>{mode === "sign-in" ? "Sign in" : "Create account"}</h1>
        </div>
        <label>
          Email
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
        </label>
        <label>
          Password
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            minLength={6}
            required
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="primary-button" type="submit" disabled={busy}>
          <Send size={16} />
          {busy ? "Working..." : mode === "sign-in" ? "Sign in" : "Create account"}
        </button>
        <button
          className="text-button"
          type="button"
          onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
        >
          {mode === "sign-in" ? "Need an account?" : "Already have an account?"}
        </button>
      </form>
    </main>
  );
}

function Dashboard({ session }: { session: Session }) {
  const [canvases, setCanvases] = useState<Canvas[]>([]);
  const [selectedCanvas, setSelectedCanvas] = useState<Canvas | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadCanvases() {
    if (!supabase) {
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error: loadError } = await supabase
      .from("canvases")
      .select("*")
      .order("created_at", { ascending: false });

    if (loadError) {
      setError(loadError.message);
    } else {
      setCanvases(data ?? []);
      if (selectedCanvas) {
        setSelectedCanvas((data ?? []).find((canvas) => canvas.id === selectedCanvas.id) ?? null);
      }
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadCanvases();
  }, []);

  if (selectedCanvas) {
    return (
      <CanvasWorkspace
        canvas={selectedCanvas}
        session={session}
        onBack={() => {
          setSelectedCanvas(null);
          void loadCanvases();
        }}
      />
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">Dashboard</span>
          <h1>Client canvases</h1>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" onClick={loadCanvases} aria-label="Refresh canvases">
            <RefreshCw size={18} />
          </button>
          <button className="ghost-button" onClick={() => supabase?.auth.signOut()}>
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </header>

      <section className="dashboard-grid">
        <CreateCanvasForm ownerId={session.user.id} onCreated={loadCanvases} />
        <section className="panel">
          <div className="panel-heading">
            <h2>Projects</h2>
            <span>{loading ? "Loading" : `${canvases.length} total`}</span>
          </div>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="canvas-list">
            {canvases.map((canvas) => (
              <button key={canvas.id} className="canvas-row" onClick={() => setSelectedCanvas(canvas)}>
                <span>
                  <strong>{canvas.name}</strong>
                  <small>{canvas.site_url}</small>
                </span>
                <ExternalLink size={16} />
              </button>
            ))}
            {!loading && canvases.length === 0 ? <p className="empty-state">Create a canvas to start.</p> : null}
          </div>
        </section>
      </section>
    </main>
  );
}

function CreateCanvasForm({ ownerId, onCreated }: { ownerId: string; onCreated: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const normalizedUrl = new URL(siteUrl).toString();
      const { data: canvas, error: canvasError } = await supabase
        .from("canvases")
        .insert({ name, site_url: normalizedUrl, owner_id: ownerId })
        .select("*")
        .single();

      if (canvasError) {
        throw canvasError;
      }

      if (clientEmail.trim()) {
        const { error: linkError } = await supabase.from("canvas_users").insert({
          canvas_id: canvas.id,
          email: clientEmail.trim().toLowerCase()
        });

        if (linkError) {
          throw linkError;
        }
      }

      setName("");
      setSiteUrl("");
      setClientEmail("");
      await onCreated();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not create canvas.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel form-panel" onSubmit={handleSubmit}>
      <div className="panel-heading">
        <h2>New canvas</h2>
        <Plus size={18} />
      </div>
      <label>
        Project name
        <input value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <label>
        Website URL
        <input
          value={siteUrl}
          onChange={(event) => setSiteUrl(event.target.value)}
          placeholder="https://client-site.com"
          type="url"
          required
        />
      </label>
      <label>
        Client email
        <input value={clientEmail} onChange={(event) => setClientEmail(event.target.value)} type="email" />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      <button className="primary-button" disabled={busy} type="submit">
        <Plus size={16} />
        {busy ? "Creating..." : "Create canvas"}
      </button>
    </form>
  );
}

function CanvasWorkspace({
  canvas,
  session,
  onBack
}: {
  canvas: Canvas;
  session: Session;
  onBack: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [draft, setDraft] = useState<DraftComment | null>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [pinPositions, setPinPositions] = useState<Record<string, PinPosition>>({});
  const [pagePath, setPagePath] = useState("/");
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [savingComment, setSavingComment] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const iframeSrc = useMemo(() => buildProxyUrl(canvas.site_url), [canvas.site_url]);
  const visibleComments = comments.filter((comment) => comment.page_path === pagePath);
  const activeComment = comments.find((comment) => comment.id === activeCommentId) ?? null;

  async function loadDiscussion() {
    if (!supabase) {
      return;
    }

    const { data: nextComments, error: commentsError } = await supabase
      .from("comments")
      .select("*")
      .eq("canvas_id", canvas.id)
      .order("created_at", { ascending: false });

    if (commentsError) {
      setError(commentsError.message);
      return;
    }

    setComments(nextComments ?? []);

    const commentIds = (nextComments ?? []).map((comment) => comment.id);
    if (!commentIds.length) {
      setReplies([]);
      return;
    }

    const { data: nextReplies, error: repliesError } = await supabase
      .from("replies")
      .select("*")
      .in("comment_id", commentIds)
      .order("created_at", { ascending: true });

    if (repliesError) {
      setError(repliesError.message);
    } else {
      setReplies(nextReplies ?? []);
    }
  }

  useEffect(() => {
    void loadDiscussion();
  }, [canvas.id]);

  useEffect(() => {
    if (!iframeLoaded || !iframeRef.current?.contentDocument) {
      return;
    }

    const documentRef = iframeRef.current.contentDocument;
    const nextPositions: Record<string, PinPosition> = {};

    for (const comment of visibleComments) {
      const element = resolveElement(documentRef, {
        elementSelector: comment.element_selector,
        elementId: comment.element_id,
        dataSelector: comment.data_selector,
        xpath: comment.xpath
      });

      if (element) {
        const rect = element.getBoundingClientRect();
        nextPositions[comment.id] = {
          xPct: ((rect.left + rect.width / 2) / iframeRef.current.clientWidth) * 100,
          yPct: ((rect.top + rect.height / 2) / iframeRef.current.clientHeight) * 100,
          displaced: false
        };
      } else {
        nextPositions[comment.id] = {
          xPct: comment.x_pct,
          yPct: comment.y_pct,
          displaced: true
        };
      }
    }

    setPinPositions(nextPositions);
  }, [comments, iframeLoaded, pagePath]);

  function handleFrameLoad() {
    const frameLocation = iframeRef.current?.contentWindow?.location;
    setPagePath(frameLocation ? pagePathFromProxyUrl(frameLocation.pathname) : "/");
    setIframeLoaded(true);
  }

  function handleOverlayClick(event: MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button, form, .comment-drawer")) {
      return;
    }

    const iframe = iframeRef.current;
    const documentRef = iframe?.contentDocument;
    if (!iframe || !documentRef) {
      setError("The iframe is not ready yet.");
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const clickedElement = documentRef.elementFromPoint(x, y);

    setDraft({
      x,
      y,
      xPct: (x / rect.width) * 100,
      yPct: (y / rect.height) * 100,
      pagePath,
      target: getElementTarget(clickedElement)
    });
    setActiveCommentId(null);
  }

  async function saveComment(body: string) {
    if (!supabase || !draft || !iframeRef.current?.contentDocument) {
      return;
    }

    setSavingComment(true);
    setError(null);

    try {
      const commentId = crypto.randomUUID();
      const screenshotUrl = await captureAndUploadScreenshot(
        iframeRef.current.contentDocument,
        canvas.id,
        commentId,
        { x: draft.x, y: draft.y }
      );

      const { error: insertError } = await supabase.from("comments").insert({
        id: commentId,
        canvas_id: canvas.id,
        author_id: session.user.id,
        element_selector: draft.target.elementSelector,
        element_id: draft.target.elementId,
        data_selector: draft.target.dataSelector,
        xpath: draft.target.xpath,
        x_pct: draft.xPct,
        y_pct: draft.yPct,
        viewport_width: iframeRef.current.clientWidth,
        page_path: draft.pagePath,
        body,
        screenshot_url: screenshotUrl,
        status: "open"
      });

      if (insertError) {
        throw insertError;
      }

      setDraft(null);
      await loadDiscussion();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save comment.");
    } finally {
      setSavingComment(false);
    }
  }

  async function toggleStatus(comment: Comment) {
    if (!supabase) {
      return;
    }

    const nextStatus = comment.status === "open" ? "resolved" : "open";
    const { error: updateError } = await supabase
      .from("comments")
      .update({ status: nextStatus })
      .eq("id", comment.id);

    if (updateError) {
      setError(updateError.message);
    } else {
      await loadDiscussion();
    }
  }

  return (
    <main className="workspace">
      <header className="workspace-bar">
        <button className="ghost-button" onClick={onBack}>
          <ArrowLeft size={16} />
          Back
        </button>
        <div>
          <h1>{canvas.name}</h1>
          <span>{canvas.site_url}</span>
        </div>
        <button className="icon-button" onClick={loadDiscussion} aria-label="Refresh comments">
          <RefreshCw size={18} />
        </button>
      </header>

      {error ? <p className="workspace-error">{error}</p> : null}

      <section className="canvas-stage">
        <iframe ref={iframeRef} title={canvas.name} src={iframeSrc} onLoad={handleFrameLoad} />
        <div className="annotation-layer" onClick={handleOverlayClick}>
          {visibleComments.map((comment) => {
            const position = pinPositions[comment.id];
            if (!position) {
              return null;
            }

            return (
              <button
                key={comment.id}
                className={`pin ${position.displaced ? "pin-displaced" : ""}`}
                style={{ left: `${position.xPct}%`, top: `${position.yPct}%` }}
                onClick={(event) => {
                  event.stopPropagation();
                  setActiveCommentId(comment.id);
                  setDraft(null);
                }}
                aria-label="Open comment"
              >
                <MessageCircle size={15} />
              </button>
            );
          })}
          {draft ? (
            <CommentComposer
              draft={draft}
              busy={savingComment}
              onCancel={() => setDraft(null)}
              onSubmit={saveComment}
            />
          ) : null}
        </div>
      </section>

      {activeComment ? (
        <CommentDrawer
          comment={activeComment}
          replies={replies.filter((reply) => reply.comment_id === activeComment.id)}
          onClose={() => setActiveCommentId(null)}
          onStatus={() => toggleStatus(activeComment)}
          onReply={async (body) => {
            if (!supabase) {
              return;
            }

            const { error: replyError } = await supabase.from("replies").insert({
              comment_id: activeComment.id,
              author_id: session.user.id,
              body
            });

            if (replyError) {
              setError(replyError.message);
            } else {
              await loadDiscussion();
            }
          }}
        />
      ) : null}
    </main>
  );
}

function CommentComposer({
  draft,
  busy,
  onCancel,
  onSubmit
}: {
  draft: DraftComment;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: string) => Promise<void>;
}) {
  const [body, setBody] = useState("");

  return (
    <form
      className="comment-composer"
      style={{ left: draft.x, top: draft.y }}
      onClick={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(body);
      }}
    >
      <button className="close-button" type="button" onClick={onCancel} aria-label="Cancel comment">
        <X size={14} />
      </button>
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Leave feedback..."
        rows={4}
        required
        autoFocus
      />
      <button className="primary-button" type="submit" disabled={busy}>
        <Send size={15} />
        {busy ? "Saving screenshot..." : "Save comment"}
      </button>
    </form>
  );
}

function CommentDrawer({
  comment,
  replies,
  onClose,
  onStatus,
  onReply
}: {
  comment: Comment;
  replies: Reply[];
  onClose: () => void;
  onStatus: () => void;
  onReply: (body: string) => Promise<void>;
}) {
  const [replyBody, setReplyBody] = useState("");

  return (
    <aside className="comment-drawer">
      <header>
        <div>
          <span className={`status-pill ${comment.status}`}>{comment.status}</span>
          <h2>{comment.body}</h2>
        </div>
        <button className="close-button" onClick={onClose} aria-label="Close comment">
          <X size={16} />
        </button>
      </header>
      {comment.screenshot_url ? (
        <a href={comment.screenshot_url} target="_blank" rel="noreferrer" className="screenshot-link">
          <img src={comment.screenshot_url} alt="Captured click context" />
        </a>
      ) : null}
      <button className="ghost-button" onClick={onStatus}>
        <CheckCircle2 size={16} />
        Mark {comment.status === "open" ? "resolved" : "open"}
      </button>
      <div className="reply-list">
        {replies.map((reply) => (
          <p key={reply.id}>{reply.body}</p>
        ))}
      </div>
      <form
        className="reply-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onReply(replyBody).then(() => setReplyBody(""));
        }}
      >
        <input value={replyBody} onChange={(event) => setReplyBody(event.target.value)} placeholder="Reply..." required />
        <button className="icon-button" type="submit" aria-label="Send reply">
          <Send size={16} />
        </button>
      </form>
    </aside>
  );
}
