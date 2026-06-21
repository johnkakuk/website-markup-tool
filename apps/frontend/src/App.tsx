import type { Session } from "@supabase/supabase-js";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  File as FileIcon,
  LogOut,
  MessageCircle,
  MessageSquarePlus,
  MousePointer2,
  Paperclip,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  X
} from "lucide-react";
import {
  FormEvent,
  MouseEvent,
  WheelEvent as ReactWheelEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { buildProxyUrl, pagePathFromProxyUrl } from "./lib/proxyUrl";
import { captureAndUploadScreenshot } from "./lib/screenshot";
import { getElementTarget, resolveElement } from "./lib/selectors";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import type { Attachment, Canvas, Comment, ElementTarget, PinPosition, Reply } from "./types";

type DraftComment = {
  x: number;
  y: number;
  xPct: number;
  yPct: number;
  pagePath: string;
  target: ElementTarget;
  elementXRatio: number | null;
  elementYRatio: number | null;
  documentScrollY: number;
  documentHeight: number;
};

type ElementHighlight = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function getDocumentHeight(documentRef: Document) {
  const body = documentRef.body;
  const root = documentRef.documentElement;

  return Math.max(
    body?.scrollHeight ?? 0,
    body?.offsetHeight ?? 0,
    root.scrollHeight,
    root.offsetHeight,
    root.clientHeight
  );
}

const MAX_ATTACHMENT_FILES = 5;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.svg,.txt,.docx,.xlsx,.pptx,.zip";
const attachmentMimeTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "text/plain",
  txt: "text/plain",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip"
};

function getAttachmentExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function getAllowedAttachmentMimeType(file: File) {
  const extension = getAttachmentExtension(file.name);
  const expectedMimeType = attachmentMimeTypes[extension];
  if (extension === "svg") {
    return !file.type || file.type === "image/svg+xml" || file.type === "text/plain"
      ? "text/plain"
      : null;
  }

  if (extension === "zip") {
    return !file.type || file.type === "application/zip" || file.type === "application/x-zip-compressed"
      ? "application/zip"
      : null;
  }

  if (!expectedMimeType || (file.type && file.type !== expectedMimeType)) {
    return null;
  }

  return expectedMimeType;
}

function getAttachmentStorageExtension(file: File) {
  const extension = getAttachmentExtension(file.name);
  return extension === "svg" ? "txt" : extension;
}

async function getAttachmentValidationError(file: File) {
  if (!getAllowedAttachmentMimeType(file)) {
    return `${file.name} is not an allowed file type.`;
  }

  if (file.size === 0 || file.size > MAX_ATTACHMENT_BYTES) {
    return `${file.name} must be between 1 byte and 10 MB.`;
  }

  const extension = getAttachmentExtension(file.name);
  const zipBasedExtensions = new Set(["docx", "xlsx", "pptx", "zip"]);
  if (zipBasedExtensions.has(extension)) {
    const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    const hasZipSignature =
      header[0] === 0x50 &&
      header[1] === 0x4b &&
      ((header[2] === 0x03 && header[3] === 0x04) ||
        (header[2] === 0x05 && header[3] === 0x06) ||
        (header[2] === 0x07 && header[3] === 0x08));

    if (!hasZipSignature) {
      return `${file.name} is not a valid ZIP-based file.`;
    }

    if (extension !== "zip") {
      const archiveText = new TextDecoder("iso-8859-1")
        .decode(await file.arrayBuffer())
        .toLowerCase();
      const unsafeOfficeMarkers = [
        "vbaproject.bin",
        "vbadata.xml",
        "/activex/",
        "/embeddings/"
      ];

      if (unsafeOfficeMarkers.some((marker) => archiveText.includes(marker))) {
        return `${file.name} contains macros, ActiveX, or embedded objects.`;
      }
    }
  }

  if (extension !== "svg") {
    return null;
  }

  const source = await file.text();
  if (/<\s*!(?:doctype|entity)|<\?xml-stylesheet/i.test(source)) {
    return `${file.name} contains unsupported XML declarations.`;
  }

  const svgDocument = new DOMParser().parseFromString(source, "image/svg+xml");
  if (svgDocument.querySelector("parsererror") || svgDocument.documentElement.localName !== "svg") {
    return `${file.name} is not a valid SVG.`;
  }

  const forbiddenElements = new Set([
    "script",
    "foreignobject",
    "iframe",
    "object",
    "embed",
    "image",
    "audio",
    "video",
    "canvas",
    "style",
    "link",
    "meta",
    "base",
    "form",
    "input",
    "button",
    "animate",
    "animatemotion",
    "animatetransform",
    "set"
  ]);

  for (const element of Array.from(svgDocument.querySelectorAll("*"))) {
    if (forbiddenElements.has(element.localName.toLowerCase())) {
      return `${file.name} contains active or embedded content.`;
    }

    for (const attribute of Array.from(element.attributes)) {
      const attributeName = attribute.name.toLowerCase();
      const value = attribute.value.trim();

      if (attributeName.startsWith("on") || attributeName === "style") {
        return `${file.name} contains active attributes.`;
      }

      if ((attributeName === "href" || attributeName.endsWith(":href")) && !value.startsWith("#")) {
        return `${file.name} contains an external reference.`;
      }

      if (/(?:javascript|vbscript|data):/i.test(value)) {
        return `${file.name} contains an unsafe URL.`;
      }

      for (const match of value.matchAll(/url\(([^)]+)\)/gi)) {
        const referencedUrl = match[1].trim().replace(/^['"]|['"]$/g, "");
        if (!referencedUrl.startsWith("#")) {
          return `${file.name} contains an external resource.`;
        }
      }
    }
  }

  return null;
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

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
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) {
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    const result =
      mode === "sign-in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: `${window.location.origin}/` }
          });

    if (result.error) {
      setError(result.error.message);
    } else if (mode === "sign-up" && !result.data.session) {
      setMode("sign-in");
      setPassword("");
      setMessage(`Account created. Check ${email} for a confirmation link, then sign in.`);
    }

    setBusy(false);
  }

  function toggleMode() {
    setMode(mode === "sign-in" ? "sign-up" : "sign-in");
    setError(null);
    setMessage(null);
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
        {message ? (
          <p className="form-success" role="status">
            {message}
          </p>
        ) : null}
        <button className="primary-button" type="submit" disabled={busy}>
          <Send size={16} />
          {busy ? "Working..." : mode === "sign-in" ? "Sign in" : "Create account"}
        </button>
        <button
          className="text-button"
          type="button"
          onClick={toggleMode}
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
  const requestedCanvasId = useMemo(
    () => new URLSearchParams(window.location.search).get("canvas"),
    []
  );

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
      const nextCanvases = data ?? [];
      setCanvases(nextCanvases);
      if (requestedCanvasId) {
        setSelectedCanvas(nextCanvases.find((canvas) => canvas.id === requestedCanvasId) ?? null);
      }
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadCanvases();
  }, []);

  if (selectedCanvas) {
    return <CanvasWorkspace canvas={selectedCanvas} session={session} />;
  }

  if (requestedCanvasId && loading) {
    return <main className="center-state">Loading canvas...</main>;
  }

  if (requestedCanvasId && !loading) {
    return <main className="center-state">Canvas not found or access denied.</main>;
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
              <div key={canvas.id} className="canvas-row">
                <span>
                  <strong>{canvas.name}</strong>
                  <small>{canvas.site_url}</small>
                </span>
                <a
                  className="open-canvas-link"
                  href={`${window.location.pathname}?canvas=${encodeURIComponent(canvas.id)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in new tab
                  <ExternalLink size={15} />
                </a>
              </div>
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
      const siteOrigin = new URL(normalizedUrl).origin;
      const { data: canvas, error: canvasError } = await supabase
        .from("canvases")
        .insert({ name, site_url: normalizedUrl, site_origin: siteOrigin, owner_id: ownerId })
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
      setError(getErrorMessage(submitError, "Could not create canvas."));
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

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return fallback;
}

function CanvasWorkspace({ canvas, session }: { canvas: Canvas; session: Session }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [draft, setDraft] = useState<DraftComment | null>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [pinPositions, setPinPositions] = useState<Record<string, PinPosition>>({});
  const [pagePath, setPagePath] = useState("/");
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [savingComment, setSavingComment] = useState(false);
  const [interactionMode, setInteractionMode] = useState<"browse" | "comment">("browse");
  const [elementHighlight, setElementHighlight] = useState<ElementHighlight | null>(null);
  const [commentsDrawerOpen, setCommentsDrawerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const iframeSrc = useMemo(() => buildProxyUrl(canvas.site_url), [canvas.site_url]);
  const visibleComments = comments.filter(
    (comment) => comment.page_path === pagePath && comment.status === "open"
  );
  const openCommentCount = comments.filter((comment) => comment.status === "open").length;
  const activeComment = comments.find((comment) => comment.id === activeCommentId) ?? null;

  async function loadDiscussion() {
    if (!supabase) {
      return;
    }

    const supabaseClient = supabase;

    const { data: nextComments, error: commentsError } = await supabase
      .from("comments")
      .select("*")
      .eq("canvas_id", canvas.id)
      .order("created_at", { ascending: false });

    if (commentsError) {
      setError(commentsError.message);
      return;
    }

    const commentsWithSignedScreenshots = await Promise.all(
      (nextComments ?? []).map(async (comment) => {
        if (!comment.screenshot_path) {
          return comment;
        }

        const { data: signedScreenshot } = await supabaseClient.storage
          .from("comment-screenshots")
          .createSignedUrl(comment.screenshot_path, 3600);

        return {
          ...comment,
          screenshot_url: signedScreenshot?.signedUrl ?? null
        };
      })
    );

    setComments(commentsWithSignedScreenshots);

    const commentIds = commentsWithSignedScreenshots.map((comment) => comment.id);
    if (!commentIds.length) {
      setReplies([]);
      setAttachments([]);
      return;
    }

    const [repliesResult, attachmentsResult] = await Promise.all([
      supabase
        .from("replies")
        .select("*")
        .in("comment_id", commentIds)
        .order("created_at", { ascending: true }),
      supabase
        .from("comment_attachments")
        .select("*")
        .in("comment_id", commentIds)
        .order("created_at", { ascending: true })
    ]);

    if (repliesResult.error) {
      setError(repliesResult.error.message);
    } else {
      setReplies(repliesResult.data ?? []);
    }

    if (attachmentsResult.error) {
      setError(attachmentsResult.error.message);
      return;
    }

    const attachmentsWithUrls = await Promise.all(
      (attachmentsResult.data ?? []).map(async (attachment) => {
        const { data: signedUrl } = await supabaseClient.storage
          .from("comment-attachments")
          .createSignedUrl(attachment.storage_path, 3600, { download: attachment.file_name });

        return {
          ...attachment,
          download_url: signedUrl?.signedUrl ?? null
        };
      })
    );

    setAttachments(attachmentsWithUrls);
  }

  useEffect(() => {
    void loadDiscussion();
  }, [canvas.id]);

  useEffect(() => {
    if (!iframeLoaded || !iframeRef.current?.contentDocument) {
      return;
    }

    const iframe = iframeRef.current;
    const documentRef = iframe.contentDocument;
    const windowRef = iframe.contentWindow;
    if (!documentRef) {
      return;
    }

    const updatePinPositions = () => {
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
            xPct: ((rect.left + rect.width / 2) / iframe.clientWidth) * 100,
            yPct: ((rect.top + rect.height / 2) / iframe.clientHeight) * 100,
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
    };

    updatePinPositions();
    windowRef?.addEventListener("scroll", updatePinPositions, { passive: true });
    windowRef?.addEventListener("resize", updatePinPositions);

    return () => {
      windowRef?.removeEventListener("scroll", updatePinPositions);
      windowRef?.removeEventListener("resize", updatePinPositions);
    };
  }, [comments, iframeLoaded, pagePath]);

  useEffect(() => {
    const iframe = iframeRef.current;
    const documentRef = iframe?.contentDocument;
    const windowRef = iframe?.contentWindow;
    if (
      !draft ||
      !iframe ||
      !documentRef ||
      !windowRef ||
      draft.elementXRatio === null ||
      draft.elementYRatio === null
    ) {
      return;
    }

    const target = draft.target;
    const elementXRatio = draft.elementXRatio;
    const elementYRatio = draft.elementYRatio;

    const updateDraftAnchor = () => {
      const element = resolveElement(documentRef, target);
      if (!element) {
        return;
      }

      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width * elementXRatio;
      const y = rect.top + rect.height * elementYRatio;

      setElementHighlight({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      });
      setDraft((currentDraft) =>
        currentDraft
          ? {
              ...currentDraft,
              x,
              y,
              xPct: (x / iframe.clientWidth) * 100,
              yPct: (y / iframe.clientHeight) * 100,
              documentScrollY: windowRef.scrollY,
              documentHeight: getDocumentHeight(documentRef)
            }
          : null
      );
    };

    updateDraftAnchor();
    windowRef.addEventListener("scroll", updateDraftAnchor, { passive: true });
    windowRef.addEventListener("resize", updateDraftAnchor);

    return () => {
      windowRef.removeEventListener("scroll", updateDraftAnchor);
      windowRef.removeEventListener("resize", updateDraftAnchor);
    };
  }, [
    draft?.target.elementId,
    draft?.target.dataSelector,
    draft?.target.xpath,
    draft?.elementXRatio,
    draft?.elementYRatio,
    iframeLoaded
  ]);

  function handleFrameLoad() {
    const frameLocation = iframeRef.current?.contentWindow?.location;
    setPagePath(frameLocation ? pagePathFromProxyUrl(frameLocation.pathname) : "/");
    setIframeLoaded(true);
  }

  function handleOverlayClick(event: MouseEvent<HTMLDivElement>) {
    if (interactionMode !== "comment") {
      return;
    }

    if ((event.target as HTMLElement).closest("button, form, .comment-drawer")) {
      return;
    }

    const iframe = iframeRef.current;
    const documentRef = iframe?.contentDocument;
    const windowRef = iframe?.contentWindow;
    if (!iframe || !documentRef || !windowRef) {
      setError("The iframe is not ready yet.");
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const clickedElement = documentRef.elementFromPoint(x, y);
    const clickedRect = clickedElement?.getBoundingClientRect();
    const elementXRatio =
      clickedRect && clickedRect.width > 0
        ? Math.min(Math.max((x - clickedRect.left) / clickedRect.width, 0), 1)
        : null;
    const elementYRatio =
      clickedRect && clickedRect.height > 0
        ? Math.min(Math.max((y - clickedRect.top) / clickedRect.height, 0), 1)
        : null;

    setElementHighlight(
      clickedRect
        ? {
            left: clickedRect.left,
            top: clickedRect.top,
            width: clickedRect.width,
            height: clickedRect.height
          }
        : null
    );
    setDraft({
      x,
      y,
      xPct: (x / rect.width) * 100,
      yPct: (y / rect.height) * 100,
      pagePath,
      target: getElementTarget(clickedElement),
      elementXRatio,
      elementYRatio,
      documentScrollY: windowRef.scrollY,
      documentHeight: getDocumentHeight(documentRef)
    });
    setActiveCommentId(null);
  }

  function handleOverlayMouseMove(event: MouseEvent<HTMLDivElement>) {
    if (interactionMode !== "comment") {
      setElementHighlight(null);
      return;
    }

    if (draft) {
      return;
    }

    const iframe = iframeRef.current;
    const documentRef = iframe?.contentDocument;
    if (!iframe || !documentRef) {
      return;
    }

    const overlayRect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - overlayRect.left;
    const y = event.clientY - overlayRect.top;
    const hoveredElement = documentRef.elementFromPoint(x, y);

    if (!hoveredElement) {
      setElementHighlight(null);
      return;
    }

    const elementRect = hoveredElement.getBoundingClientRect();
    setElementHighlight({
      left: elementRect.left,
      top: elementRect.top,
      width: elementRect.width,
      height: elementRect.height
    });
  }

  function handleOverlayWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (interactionMode !== "comment") {
      return;
    }

    event.preventDefault();
    if (!draft) {
      setElementHighlight(null);
    }
    iframeRef.current?.contentWindow?.scrollBy({
      left: event.deltaX,
      top: event.deltaY
    });
  }

  async function saveComment(body: string, files: File[]) {
    if (!supabase || !draft || !iframeRef.current?.contentDocument) {
      return;
    }

    setSavingComment(true);
    setError(null);
    const commentId = crypto.randomUUID();
    const expectedScreenshotPath = `${canvas.id}/${commentId}.png`;
    const uploadedAttachmentPaths: string[] = [];
    let screenshotUploaded = false;
    let commentCreated = false;

    try {
      if (files.length > MAX_ATTACHMENT_FILES) {
        throw new Error(`Attach no more than ${MAX_ATTACHMENT_FILES} files.`);
      }

      for (const file of files) {
        const validationError = await getAttachmentValidationError(file);
        if (validationError) {
          throw new Error(validationError);
        }
      }

      const screenshotPath = await captureAndUploadScreenshot(
        iframeRef.current.contentDocument,
        canvas.id,
        commentId,
        { x: draft.x, y: draft.y }
      );
      screenshotUploaded = true;

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
        screenshot_path: screenshotPath,
        screenshot_url: null,
        status: "open"
      });

      if (insertError) {
        throw insertError;
      }

      commentCreated = true;
      const attachmentRows = [];

      for (const file of files) {
        const attachmentId = crypto.randomUUID();
        const extension = getAttachmentStorageExtension(file);
        const mimeType = getAllowedAttachmentMimeType(file)!;
        const storagePath = `${canvas.id}/${commentId}/${attachmentId}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from("comment-attachments")
          .upload(storagePath, file, {
            contentType: mimeType,
            upsert: false
          });

        if (uploadError) {
          throw uploadError;
        }

        uploadedAttachmentPaths.push(storagePath);
        attachmentRows.push({
          id: attachmentId,
          comment_id: commentId,
          uploader_id: session.user.id,
          file_name: file.name,
          storage_path: storagePath,
          mime_type: mimeType,
          size_bytes: file.size
        });
      }

      if (attachmentRows.length) {
        const { error: attachmentsError } = await supabase
          .from("comment_attachments")
          .insert(attachmentRows);

        if (attachmentsError) {
          throw attachmentsError;
        }
      }

      setDraft(null);
      setElementHighlight(null);
      await loadDiscussion();
    } catch (saveError) {
      if (commentCreated) {
        await supabase.from("comments").delete().eq("id", commentId);
      }

      if (uploadedAttachmentPaths.length) {
        await supabase.storage.from("comment-attachments").remove(uploadedAttachmentPaths);
      }

      if (screenshotUploaded) {
        await supabase.storage.from("comment-screenshots").remove([expectedScreenshotPath]);
      }

      setError(getErrorMessage(saveError, "Could not save comment."));
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

  async function deleteComment(comment: Comment) {
    if (!supabase) {
      return;
    }

    setError(null);
    const { error: deleteError } = await supabase.from("comments").delete().eq("id", comment.id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    const attachmentPaths = attachments
      .filter((attachment) => attachment.comment_id === comment.id)
      .map((attachment) => attachment.storage_path);
    const { error: screenshotStorageError } = await supabase.storage
      .from("comment-screenshots")
      .remove([`${canvas.id}/${comment.id}.png`]);
    const { error: attachmentStorageError } = attachmentPaths.length
      ? await supabase.storage.from("comment-attachments").remove(attachmentPaths)
      : { error: null };

    if (screenshotStorageError || attachmentStorageError) {
      setError(
        `Comment deleted, but file cleanup failed: ${
          screenshotStorageError?.message ?? attachmentStorageError?.message
        }`
      );
    }

    setActiveCommentId(null);
    await loadDiscussion();
  }

  return (
    <main className="workspace">
      {error ? <p className="workspace-error">{error}</p> : null}

      <section className="canvas-stage">
        <iframe ref={iframeRef} title={canvas.name} src={iframeSrc} onLoad={handleFrameLoad} />
        <div
          className={`annotation-layer ${interactionMode}`}
          onClick={handleOverlayClick}
          onMouseLeave={() => setElementHighlight(null)}
          onMouseMove={handleOverlayMouseMove}
          onWheel={handleOverlayWheel}
        >
          {elementHighlight ? (
            <div
              className="element-highlight"
              style={{
                left: elementHighlight.left,
                top: elementHighlight.top,
                width: elementHighlight.width,
                height: elementHighlight.height
              }}
            />
          ) : null}
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
                  setCommentsDrawerOpen(true);
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
              onCancel={() => {
                setDraft(null);
                setElementHighlight(null);
              }}
              onSubmit={saveComment}
            />
          ) : null}
        </div>
      </section>

      <div className="canvas-mode-control">
        <div className="mode-switch" aria-label="Canvas interaction mode">
          <button
            className={interactionMode === "browse" ? "active" : ""}
              onClick={() => {
                setInteractionMode("browse");
                setDraft(null);
                setElementHighlight(null);
              }}
            type="button"
          >
            <MousePointer2 size={15} />
            Browse
          </button>
          <button
            className={interactionMode === "comment" ? "active" : ""}
            onClick={() => setInteractionMode("comment")}
            type="button"
          >
            <MessageSquarePlus size={15} />
            Comment
          </button>
        </div>
      </div>

      <button
        className="comments-launcher"
        onClick={() => {
          setActiveCommentId(null);
          setCommentsDrawerOpen(true);
        }}
        aria-label={`Open comments, ${openCommentCount} active`}
        type="button"
      >
        <MessageCircle size={22} />
        <span>{openCommentCount}</span>
      </button>

      {commentsDrawerOpen ? (
        activeComment ? (
          <CommentDrawer
            attachments={attachments.filter(
              (attachment) => attachment.comment_id === activeComment.id
            )}
            comment={activeComment}
            replies={replies.filter((reply) => reply.comment_id === activeComment.id)}
            onBack={() => setActiveCommentId(null)}
            onClose={() => {
              setCommentsDrawerOpen(false);
              setActiveCommentId(null);
            }}
            onDelete={() => deleteComment(activeComment)}
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
        ) : (
          <CommentListDrawer
            comments={comments}
            onClose={() => setCommentsDrawerOpen(false)}
            onSelect={setActiveCommentId}
          />
        )
      ) : null}
    </main>
  );
}

function CommentListDrawer({
  comments,
  onClose,
  onSelect
}: {
  comments: Comment[];
  onClose: () => void;
  onSelect: (commentId: string) => void;
}) {
  const openComments = comments.filter((comment) => comment.status === "open");
  const resolvedComments = comments.filter((comment) => comment.status === "resolved");

  return (
    <aside className="comment-drawer comment-list-drawer">
      <header>
        <div>
          <span className="eyebrow">Canvas discussion</span>
          <h2>Comments</h2>
        </div>
        <button className="close-button" onClick={onClose} aria-label="Close comments">
          <X size={16} />
        </button>
      </header>

      <CommentListSection
        title="Active"
        comments={openComments}
        emptyMessage="No active comments."
        onSelect={onSelect}
      />
      <CommentListSection
        title="Resolved"
        comments={resolvedComments}
        emptyMessage="No resolved comments."
        onSelect={onSelect}
      />
    </aside>
  );
}

function CommentListSection({
  title,
  comments,
  emptyMessage,
  onSelect
}: {
  title: string;
  comments: Comment[];
  emptyMessage: string;
  onSelect: (commentId: string) => void;
}) {
  return (
    <section className="comment-list-section">
      <div className="comment-list-heading">
        <h3>{title}</h3>
        <span>{comments.length}</span>
      </div>
      <div className="comment-list">
        {comments.map((comment) => (
          <button
            className={`comment-list-item ${comment.status}`}
            key={comment.id}
            onClick={() => onSelect(comment.id)}
            type="button"
          >
            <strong>{comment.body}</strong>
            <span>{comment.page_path}</span>
          </button>
        ))}
        {comments.length === 0 ? <p className="comment-list-empty">{emptyMessage}</p> : null}
      </div>
    </section>
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
  onSubmit: (body: string, files: File[]) => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const verticalSideRef = useRef<"above" | "below" | null>(null);
  const [position, setPosition] = useState({ left: draft.x + 12, top: draft.y + 12 });

  useLayoutEffect(() => {
    const composer = composerRef.current;
    const container = composer?.parentElement;
    if (!composer || !container) {
      return;
    }

    const updatePosition = () => {
      const gap = 12;
      const viewportPadding = 12;
      const width = composer.offsetWidth;
      const height = composer.offsetHeight;
      const maxLeft = Math.max(viewportPadding, container.clientWidth - width - viewportPadding);
      const documentTop = -draft.documentScrollY + viewportPadding;
      const documentBottom = draft.documentHeight - draft.documentScrollY - viewportPadding;
      const maxDocumentTop = Math.max(documentTop, documentBottom - height);

      let left = draft.x + gap;

      if (left + width > container.clientWidth - viewportPadding) {
        left = draft.x - width - gap;
      }

      if (!verticalSideRef.current) {
        verticalSideRef.current =
          draft.y + gap + height <= container.clientHeight - viewportPadding ? "below" : "above";
      }

      const anchoredTop =
        verticalSideRef.current === "below" ? draft.y + gap : draft.y - height - gap;

      setPosition({
        left: Math.min(Math.max(left, viewportPadding), maxLeft),
        top: Math.min(Math.max(anchoredTop, documentTop), maxDocumentTop)
      });
    };

    updatePosition();
    const resizeObserver = new ResizeObserver(updatePosition);
    resizeObserver.observe(composer);
    resizeObserver.observe(container);
    window.visualViewport?.addEventListener("resize", updatePosition);

    return () => {
      resizeObserver.disconnect();
      window.visualViewport?.removeEventListener("resize", updatePosition);
    };
  }, [draft.x, draft.y, draft.documentHeight, draft.documentScrollY]);

  return (
    <form
      ref={composerRef}
      className="comment-composer"
      style={position}
      onClick={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(body, files);
      }}
    >
      <div className="composer-toolbar">
        <label className="attachment-picker">
          <Paperclip size={14} />
          Add files
          <input
            accept={ATTACHMENT_ACCEPT}
            multiple
            type="file"
            onChange={async (event) => {
              const selectedFiles = Array.from(event.target.files ?? []);
              event.target.value = "";
              setFileError(null);

              if (files.length + selectedFiles.length > MAX_ATTACHMENT_FILES) {
                setFileError(`Attach no more than ${MAX_ATTACHMENT_FILES} files.`);
                return;
              }

              for (const file of selectedFiles) {
                const validationError = await getAttachmentValidationError(file);
                if (validationError) {
                  setFileError(validationError);
                  return;
                }
              }

              setFiles((currentFiles) => [...currentFiles, ...selectedFiles]);
            }}
          />
        </label>
        <button className="close-button" type="button" onClick={onCancel} aria-label="Cancel comment">
          <X size={14} />
        </button>
      </div>
      {files.length ? (
        <div className="selected-attachments">
          {files.map((file, index) => (
            <div key={`${file.name}-${file.lastModified}-${index}`}>
              <FileIcon size={14} />
              <span>
                <strong>{file.name}</strong>
                <small>{formatFileSize(file.size)}</small>
              </span>
              <button
                type="button"
                onClick={() => setFiles((currentFiles) => currentFiles.filter((_, itemIndex) => itemIndex !== index))}
                aria-label={`Remove ${file.name}`}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {fileError ? <p className="attachment-error">{fileError}</p> : null}
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
  attachments,
  comment,
  replies,
  onBack,
  onClose,
  onDelete,
  onStatus,
  onReply
}: {
  attachments: Attachment[];
  comment: Comment;
  replies: Reply[];
  onBack: () => void;
  onClose: () => void;
  onDelete: () => Promise<void>;
  onStatus: () => void;
  onReply: (body: string) => Promise<void>;
}) {
  const [replyBody, setReplyBody] = useState("");
  const [deleting, setDeleting] = useState(false);

  return (
    <aside className="comment-drawer">
      <header className="drawer-navigation">
        <button className="close-button" onClick={onBack} aria-label="Back to comments">
          <ArrowLeft size={16} />
        </button>
        <strong>Comment</strong>
        <button className="close-button" onClick={onClose} aria-label="Close comment">
          <X size={16} />
        </button>
      </header>
      <div>
        <span className={`status-pill ${comment.status}`}>{comment.status}</span>
        <h2>{comment.body}</h2>
      </div>
      {comment.screenshot_url ? (
        <a href={comment.screenshot_url} target="_blank" rel="noreferrer" className="screenshot-link">
          <img src={comment.screenshot_url} alt="Captured click context" />
        </a>
      ) : null}
      {attachments.length ? (
        <section className="attachment-downloads">
          <h3>Files</h3>
          <div>
            {attachments.map((attachment) =>
              attachment.download_url ? (
                <a
                  download={attachment.file_name}
                  href={attachment.download_url}
                  key={attachment.id}
                >
                  <FileIcon size={16} />
                  <span>
                    <strong>{attachment.file_name}</strong>
                    <small>{formatFileSize(attachment.size_bytes)}</small>
                  </span>
                  <Download size={15} />
                </a>
              ) : (
                <span className="attachment-unavailable" key={attachment.id}>
                  {attachment.file_name} is unavailable
                </span>
              )
            )}
          </div>
        </section>
      ) : null}
      <div className="comment-actions">
        <button className="ghost-button" onClick={onStatus}>
          <CheckCircle2 size={16} />
          Mark {comment.status === "open" ? "resolved" : "open"}
        </button>
        <button
          className="danger-button"
          disabled={deleting}
          onClick={async () => {
            if (!window.confirm("Delete this comment and all of its replies?")) {
              return;
            }

            setDeleting(true);
            try {
              await onDelete();
            } finally {
              setDeleting(false);
            }
          }}
          type="button"
        >
          <Trash2 size={16} />
          {deleting ? "Deleting..." : "Delete"}
        </button>
      </div>
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
