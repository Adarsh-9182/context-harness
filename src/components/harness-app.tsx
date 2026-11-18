"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type CSSProperties,
} from "react";
import { Toaster, toast } from "sonner";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ArrowUp,
  ArrowDown,
  ArrowRight,
  Plus,
  Search,
  Settings2,
  PanelLeftClose,
  PanelLeft,
  MessageSquare,
  Link2,
  ChevronDown,
  ChevronRight,
  Check,
  Copy,
  Pencil,
  RotateCcw,
  Square,
  Paperclip,
  X,
  Sun,
  Moon,
  LogOut,
  BookOpen,
  Orbit,
  Heart,
  Code2,
  Sigma,
  Clapperboard,
  BrainCircuit,
  Landmark,
  Sparkles,
  ShieldCheck,
  LoaderCircle,
  Trash2,
  GraduationCap,
  FlaskConical,
  Compass,
  MoreHorizontal,
  ImageIcon,
  AlertCircle,
  Archive,
  ArchiveRestore,
  Download,
  Layers3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Markdown } from "@/components/markdown";
import { AccountConnections as Connections } from "@/components/account-connections";
import { ContextBuilder } from "@/components/context-builder";
import { ContextDetails } from "@/components/context-details";
import { ProfessionLibrary } from "@/components/profession-library";
import { ProfessionSetup } from "@/components/profession-setup";
import TextareaAutosize from "react-textarea-autosize";
import { useUI } from "@/lib/store";
import { chatFrames, ChatResponseError, type CommittedTurn } from "@/lib/chat-stream";
import { PROFESSION_COUNT } from "@/lib/professions";
import type { ProfessionBrief } from "@/lib/profession-brief";
import type {
  Bootstrap,
  Connection,
  Persona,
  Conversation,
  ConversationDetail,
  Message,
  Attachment,
} from "@/lib/client-types";
import {
  apiHeaders,
  attachmentsForTurn,
  canApplyUpload,
  composerIdentity,
  selectionAfterConnectionSave,
} from "@/lib/client-state";

const PRESETS = [
  {
    role: "Mathematician",
    note: "Find the beauty in the numbers.",
    icon: Sigma,
    color: "#eae4fb",
    category: "Learn",
  },
  {
    role: "Astronomer",
    note: "A little closer to the cosmos.",
    icon: Orbit,
    color: "#e0eaf4",
    category: "Explore",
  },
  {
    role: "Teacher",
    note: "Make the difficult finally click.",
    icon: GraduationCap,
    color: "#f5ecd9",
    category: "Learn",
  },
  {
    role: "AI Researcher",
    note: "Follow an idea to its frontier.",
    icon: BrainCircuit,
    color: "#e1eee5",
    category: "Explore",
  },
  {
    role: "Coding Mentor",
    note: "Think it through. Build it well.",
    icon: Code2,
    color: "#e0e9f4",
    category: "Build",
  },
  {
    role: "Historian",
    note: "Put the present in perspective.",
    icon: Landmark,
    color: "#f1e5dc",
    category: "Learn",
  },
  {
    role: "Video Editor",
    note: "Find the story in every frame.",
    icon: Clapperboard,
    color: "#eee3ee",
    category: "Create",
  },
  {
    role: "Doctor",
    note: "Understand health. Prepare for care.",
    icon: Heart,
    color: "#f4e3e5",
    category: "Care",
  },
  {
    role: "Writer",
    note: "Find the words that feel like you.",
    icon: Pencil,
    color: "#f1e6d9",
    category: "Create",
  },
  {
    role: "Physicist",
    note: "Get curious about how things work.",
    icon: FlaskConical,
    color: "#e3eaf5",
    category: "Explore",
  },
  {
    role: "Career Coach",
    note: "Make room for what comes next.",
    icon: Compass,
    color: "#e4ede4",
    category: "Grow",
  },
  {
    role: "Designer",
    note: "Turn a good idea into an experience.",
    icon: Sparkles,
    color: "#eee4f3",
    category: "Create",
  },
];
const PROVIDERS = [
  { id: "chatgpt", name: "ChatGPT" },
  { id: "claude", name: "Claude" },
];
const providerName = (id: string) =>
  PROVIDERS.find((p) => p.id === id)?.name || id;

type TurnIssue = {
  conversationId: string;
  message: string;
  code?: string;
  recovery: "retry" | "draft" | "check" | "edit";
  sent?: { id: string; draft: string };
};
const safeColor = (color?: string) =>
  color && /^#[a-f\d]{6}$/i.test(color)
    ? color
    : {
        violet: "#eae4fb",
        blue: "#e0eaf4",
        amber: "#f5ecd9",
        teal: "#e1eee5",
        rose: "#f4e3e5",
        indigo: "#e0e4f5",
      }[color || "violet"] || "#eae4fb";
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: apiHeaders(method, body !== undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      data.error?.message ||
        data.message ||
        "Something went wrong. Please try again.",
    );
  return data as T;
}
function Mark({ small = false }: { small?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 40 40"
      width={small ? 26 : 42}
      height={small ? 26 : 42}
      className="harness-mark"
    >
      <path
        d="M12 5v30M28 5v30M5 12h30M5 28h30"
        fill="none"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <path d="M12 12h16v16H12z" fill="currentColor" opacity=".12" />
    </svg>
  );
}
function ExpertAvatar({
  role,
  color,
  size = "small",
}: {
  role: string;
  color?: string;
  size?: string;
}) {
  const Icon =
    PRESETS.find((p) => p.role.toLowerCase() === role.toLowerCase())?.icon ||
    Sparkles;
  return (
    <span
      className={`expert-avatar ${size}`}
      style={{ "--persona-color": safeColor(color) } as React.CSSProperties}
    >
      <Icon size={size === "large" ? 26 : 17} />
    </span>
  );
}

export function WorkspaceAccess({ development }: { development: boolean }) {
  if (development)
    return (
      <section className="settings-note" aria-label="Local development workspace">
        <ShieldCheck size={19} />
        <p>
          No account is signed in here. This local development workspace stays
          available when you reopen Harness.
        </p>
      </section>
    );
  return (
    <a className="signout-link" href="/api/auth/signout">
      <LogOut size={14} />
      Sign out
    </a>
  );
}

export function HarnessApp() {
  const [data, setData] = useState<Bootstrap | null>(null),
    [loading, setLoading] = useState(true),
    [fatal, setFatal] = useState("");
  const [connectionId, setConnectionId] = useState(""),
    [modelId, setModelId] = useState(""),
    [chat, setChat] = useState<ConversationDetail | null>(null),
    [view, setView] = useState<"home" | "library" | "builder" | "chat">("home");
  const [connectOpen, setConnectOpen] = useState(false),
    [searchOpen, setSearchOpen] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false),
    [personaEditOpen, setPersonaEditOpen] = useState(false);
  const [professionSetup, setProfessionSetup] = useState<{ role: string; focus: string } | null>(null);
  const [professionError, setProfessionError] = useState("");
  const [setupConnecting, setSetupConnecting] = useState(false);
  const [contextDetailsOpen, setContextDetailsOpen] = useState(false);
  const [requestedContextId, setRequestedContextId] = useState<string>();
  const [turnIssue, setTurnIssue] = useState<TurnIssue | null>(null);
  const [checkingTurn, setCheckingTurn] = useState(false);
  const [showLatest, setShowLatest] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null),
    [renameTitle, setRenameTitle] = useState(""),
    [renameError, setRenameError] = useState(""),
    [renaming, setRenaming] = useState(false),
    [actionsOpen, setActionsOpen] = useState(false),
    [exporting, setExporting] = useState(false),
    [archivesOpen, setArchivesOpen] = useState(false),
    [archives, setArchives] = useState<Conversation[]>([]),
    [archiveQuery, setArchiveQuery] = useState(""),
    [archivesLoading, setArchivesLoading] = useState(false),
    [archivesError, setArchivesError] = useState(""),
    [restoringId, setRestoringId] = useState("");
  const [role, setRole] = useState(""),
    [focus, setFocus] = useState(""),
    [showFocus, setShowFocus] = useState(false),
    [compiling, setCompiling] = useState(false),
    [draft, setDraft] = useState(""),
    [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false),
    [switching, setSwitching] = useState(false),
    [usage, setUsage] = useState<{
      inputTokens: number;
      outputTokens: number;
    } | null>(null),
    [attachments, setAttachments] = useState<Attachment[]>([]),
    [documents, setDocuments] = useState<{ name: string; text: string }[]>([]),
    [editId, setEditId] = useState<string | null>(null),
    [editText, setEditText] = useState("");
  const controller = useRef<AbortController | null>(null),
    bottom = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    upload = useRef<HTMLInputElement>(null),
    roleInput = useRef<HTMLInputElement>(null),
    professionTrigger = useRef<HTMLElement | null>(null),
    composerRef = useRef<HTMLDivElement>(null),
    conversationRef = useRef<HTMLDivElement>(null);
  const { theme, toggleTheme, sidebarOpen, setSidebar, sidebarPinned, setSidebarPinned } = useUI();
  const [compactViewport, setCompactViewport] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarToggle = useRef<HTMLButtonElement>(null);
  const sidebarVisible = compactViewport ? sidebarOpen : sidebarPinned;
  const contextRef = useRef({
      chatId: "",
      connectionId: "",
      modelId: "",
      view: "home",
    }),
    uploadEpoch = useRef(0),
    uploadPending = useRef(false),
    viewEpoch = useRef(0),
    turnEpoch = useRef(0),
    archivesEpoch = useRef(0);
  const followsLatest = useRef(true);
  const previousScrollTop = useRef(0);
  contextRef.current = { chatId: chat?.id || "", connectionId, modelId, view };
  const currentIssue = view === "chat" && turnIssue?.conversationId === chat?.id ? turnIssue : null;
  const selected = data?.connections.find((c) => c.id === connectionId),
    model = selected?.models.find((m) => m.id === modelId);
  const professionConnection = model ? selected : data?.connections.find((connection) => connection.models.length);
  const professionModel = model || professionConnection?.models[0];
  const refresh = useCallback(async (canApply: () => boolean = () => true) => {
    const result = await api<Bootstrap>("/api/bootstrap");
    if (!canApply()) return result;
    setData(result);
    if (contextRef.current.view !== "chat") {
      const selected =
        result.connections.find(
          (c) => c.id === contextRef.current.connectionId,
        ) || result.connections[0];
      setConnectionId(selected?.id || "");
      setModelId(
        selected?.models.some((m) => m.id === contextRef.current.modelId)
          ? contextRef.current.modelId
          : selected?.models[0]?.id || "",
      );
    }
    return result;
  }, []);
  useEffect(() => {
    refresh()
      .catch((e) => setFatal(e.message))
      .finally(() => setLoading(false));
  }, [refresh]);
  useEffect(() => {
    function openAccountLink() {
      if (window.location.hash !== "#connect") return;
      setSidebar(false);
      setConnectOpen(true);
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
    openAccountLink();
    window.addEventListener("hashchange", openAccountLink);
    return () => window.removeEventListener("hashchange", openAccountLink);
  }, [setSidebar]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => { setCompactViewport(media.matches); if (!media.matches) setSidebar(false); };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [setSidebar]);
  useEffect(() => {
    if (!compactViewport || !sidebarOpen || loading) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebarRef.current?.querySelector<HTMLButtonElement>(".collapse-sidebar")?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (sidebarRef.current?.contains(document.activeElement) || document.activeElement === document.body)
        sidebarToggle.current?.focus();
    };
  }, [compactViewport, sidebarOpen, loading]);
  function toggleSidebar() {
    if (compactViewport) setSidebar(!sidebarOpen);
    else setSidebarPinned(!sidebarPinned);
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (professionSetup || contextDetailsOpen) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSidebar(false);
        setSearchOpen(true);
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "o"
      ) {
        e.preventDefault();
        newChat();
      }
      if (e.key === "Escape" && busy) controller.current?.abort();
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  useEffect(() => {
    const composer = composerRef.current;
    const conversation = conversationRef.current;
    if (!composer || !conversation) return;
    const measure = () => conversation.style.setProperty("--composer-clearance", `${composer.getBoundingClientRect().height}px`);
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(composer);
    return () => resize.disconnect();
  }, [view, chat?.id]);
  useEffect(() => {
    followsLatest.current = true;
    setShowLatest(false);
    if (view !== "chat") return;
    const readPosition = () => {
      const top = window.scrollY;
      const composer = composerRef.current?.getBoundingClientRect();
      const end = bottom.current?.getBoundingClientRect();
      const nearBottom = composer && end && end.bottom <= composer.top + 120;
      if (nearBottom) followsLatest.current = true;
      else if (top < previousScrollTop.current) followsLatest.current = false;
      previousScrollTop.current = top;
      setShowLatest(!followsLatest.current);
    };
    window.addEventListener("scroll", readPosition, { passive: true });
    return () => window.removeEventListener("scroll", readPosition);
  }, [view, chat?.id]);
  useEffect(() => {
    if (view === "chat" && chat?.messages.length && followsLatest.current) goToLatest();
  }, [view, chat?.messages, busy, currentIssue]);
  function goToLatest() {
    followsLatest.current = true;
    setShowLatest(false);
    bottom.current?.scrollIntoView({ behavior: "instant", block: "end" });
    previousScrollTop.current = window.scrollY;
  }
  function clearFiles() {
    uploadEpoch.current++;
    setAttachments([]);
    setDocuments([]);
    if (upload.current) upload.current.value = "";
  }
  function navigationBlocked() {
    if (busy) {
      toast("Stop the current response before changing your workspace.");
      return true;
    }
    if (compiling || switching) {
      toast(
        compiling
          ? "Your expert is being prepared. Give it a moment."
          : "Your workspace is loading. Give it a moment.",
      );
      return true;
    }
    return false;
  }
  function newChat() {
    if (navigationBlocked()) return;
    viewEpoch.current++;
    clearFiles();
    setChat(null);
    setContextDetailsOpen(false);
    setView("home");
    setRole("");
    setFocus("");
    setDraft("");
    setUsage(null);
    setEditId(null);
    setSidebar(false);
  }
  function openLibrary() {
    if (navigationBlocked()) return;
    viewEpoch.current++;
    clearFiles();
    setChat(null);
    setView("library");
    setDraft("");
    setUsage(null);
    setEditId(null);
    setSidebar(false);
  }
  function openContextBuilder(contextId?: string) {
    if (navigationBlocked()) return;
    viewEpoch.current++;
    if (!model) {
      const available = data?.connections.find((connection) => connection.models.length);
      if (available) {
        setConnectionId(available.id);
        setModelId(available.models[0].id);
      }
    }
    setRequestedContextId(contextId);
    setView("builder");
    setSidebar(false);
  }
  function resumeConversation() {
    if (!chat || navigationBlocked()) return;
    viewEpoch.current++;
    setConnectionId(chat.connectionId || "");
    setModelId(chat.modelId);
    setView("chat");
  }
  async function openConversation(id: string) {
    if (navigationBlocked()) return;
    const epoch = ++viewEpoch.current;
    setSwitching(true);
    clearFiles();
    try {
      const result = await api<ConversationDetail>(`/api/conversations/${id}`);
      if (viewEpoch.current !== epoch) return;
      clearFiles();
      setChat(result);
      setConnectionId(result.connectionId || "");
      setModelId(result.modelId);
      setView("chat");
      setSearchOpen(false);
      setSidebar(false);
      setUsage(null);
      setDraft("");
      setEditId(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSwitching(false);
    }
  }
  async function changeModel(value: string) {
    const [cid, ...rest] = value.split("::");
    const mid = rest.join("::");
    if (!cid || !mid || navigationBlocked()) return;
    setSwitching(true);
    if (view !== "builder") clearFiles();
    try {
      if (view === "chat" && chat) {
        await api(`/api/conversations/${chat.id}`, "PATCH", {
          connectionId: cid,
          modelId: mid,
        });
        setChat((s) =>
          s?.id === chat.id ? { ...s, connectionId: cid, modelId: mid } : s,
        );
      }
      if (view !== "builder") clearFiles();
      setConnectionId(cid);
      setModelId(mid);
      toast.success(view === "builder" ? "Model selected for your next conversation." : "Model selected.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSwitching(false);
    }
  }
  function rememberConversation(conversation: Conversation) {
    setData((current) => current ? {
      ...current,
      conversations: [conversation, ...current.conversations.filter((item) => item.id !== conversation.id)].slice(0, 100),
    } : current);
  }
  function showNewConversation(detail: ConversationDetail, firstTask = "") {
    clearFiles();
    setChat(detail);
    setConnectionId(detail.connectionId || "");
    setModelId(detail.modelId);
    setView("chat");
    setContextDetailsOpen(false);
    setPersonaEditOpen(false);
    setDraft(firstTask);
    setUsage(null);
    setEditId(null);
    const { persona, messages: _messages, initialGoal: _goal, ...conversation } = detail;
    setData((current) => current ? {
      ...current,
      personas: [persona, ...current.personas.filter((item) => item.id !== persona.id)].slice(0, 100),
      conversations: [conversation, ...current.conversations.filter((item) => item.id !== conversation.id)].slice(0, 100),
    } : current);
    setTimeout(() => input.current?.focus(), 100);
  }
  async function runSavedContext(id: string, goal: string): Promise<boolean> {
    if (contextRef.current.view !== "builder" || navigationBlocked()) return false;
    if (!selected || !model) {
      setConnectOpen(true);
      return false;
    }
    const epoch = ++viewEpoch.current;
    setSwitching(true);
    try {
      const detail = await api<ConversationDetail>(`/api/contexts/${id}/run`, "POST", { connectionId, modelId });
      if (viewEpoch.current !== epoch) return false;
      showNewConversation(detail, detail.initialGoal ?? goal);
      return true;
    } finally {
      setSwitching(false);
    }
  }
  function prepareExpert(roleName = role, focusText = focus) {
    if (navigationBlocked()) return;
    if (!roleName.trim()) {
      roleInput.current?.focus();
      return;
    }
    professionTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPersonaEditOpen(false);
    setProfessionError("");
    setProfessionSetup({ role: roleName.trim(), focus: focusText.trim() });
  }
  async function startExpert(brief?: ProfessionBrief) {
    if (!professionSetup || busy || compiling || switching) return;
    if (!professionConnection || !professionModel) {
      setSetupConnecting(true);
      setConnectOpen(true);
      return;
    }
    const epoch = ++viewEpoch.current;
    setProfessionError("");
    setCompiling(true);
    try {
      const persona = await api<Persona>("/api/personas", "POST", {
        ...professionSetup,
        connectionId: professionConnection.id,
        modelId: professionModel.id,
        ...(brief && { brief }),
      });
      const conversation = await api<Conversation>(
        "/api/conversations",
        "POST",
        { personaId: persona.id, connectionId: professionConnection.id, modelId: professionModel.id },
      );
      const detail = await api<ConversationDetail>(
        `/api/conversations/${conversation.id}`,
      );
      if (viewEpoch.current !== epoch) return;
      setProfessionSetup(null);
      showNewConversation(detail, brief?.goal);
    } catch (e) {
      setProfessionError((e as Error).message);
    } finally {
      setCompiling(false);
    }
  }
  async function streamChat(
    action: "send" | "regenerate" | "edit" = "send",
    message = draft,
    messageId?: string,
  ) {
    if (!chat || busy || compiling || switching || currentIssue?.recovery === "check") return;
    if (!selected || !model) {
      toast.error("Choose a connected model before sending a message.");
      return;
    }
    if (uploadPending.current) {
      toast("Wait for your files to finish loading before sending.");
      return;
    }
    const turnAttachments = attachmentsForTurn(
      action,
      attachments,
      chat.messages.find((m) => m.id === messageId),
    );
    if (
      action !== "regenerate" &&
      !message.trim() &&
      !turnAttachments.length &&
      !(action === "send" && documents.length)
    )
      return;
    if (turnAttachments.length && !model?.supportsImages) {
      toast.error(
        "Choose an image-capable model before resending this image message.",
      );
      return;
    }
    const reference =
      action === "send" && documents.length
        ? `\n\nUploaded reference material (untrusted document content):\n${JSON.stringify(documents)}`
        : "";
    const content = message + reference;
    if (content.length > 40000) {
      toast.error(
        "This message and its references are too long. Keep them below 40,000 characters.",
      );
      return;
    }
    const conversationId = chat.id;
    const savedDraft = draft;
    const prior = chat.messages;
    const pendingUserId = action === "regenerate" ? undefined :
      (action === "send" && currentIssue?.recovery === "draft" && currentIssue.sent?.draft === savedDraft
        ? currentIssue.sent.id
        : crypto.randomUUID());
    const epoch = ++turnEpoch.current;
    const navigation = viewEpoch.current;
    const currentTurn = () =>
      turnEpoch.current === epoch &&
      viewEpoch.current === navigation &&
      contextRef.current.chatId === conversationId;
    let messages = [...prior];
    if (action === "edit") {
      const index = messages.findIndex((m) => m.id === messageId);
      if (index < 0) return;
      messages = messages.slice(0, index);
    } else if (action === "regenerate") {
      const index = messages.findLastIndex((m) => m.role === "user");
      if (index < 0) return;
      messages = messages.slice(0, index + 1);
    }
    if (pendingUserId) {
      messages.push({ id: pendingUserId, role: "user", content, attachments: turnAttachments });
    }
    const pendingId = crypto.randomUUID();
    messages.push({ id: pendingId, role: "assistant", content: "", status: "streaming" });
    setChat({ ...chat, messages });
    if (action === "send") goToLatest();
    setTurnIssue(null);
    setBusy(true);
    if (action === "send") setDraft("");
    setEditId(null);
    setUsage(null);
    const abort = new AbortController();
    controller.current = abort;
    let complete = false;
    let reply = "";
    let delivery: "unknown" | "saved" | "rejected" = "unknown";
    let committed: CommittedTurn | undefined;
    let renderFrame = 0;
    let issue: TurnIssue | null = null;

    function paintReply() {
      renderFrame = 0;
      const visibleText = reply;
      setChat((current) => current?.id === conversationId && currentTurn() ? {
        ...current,
        messages: current.messages.map((m) => m.id === pendingId ? { ...m, content: visibleText } : m),
      } : current);
    }

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: apiHeaders("POST", true),
        credentials: "same-origin",
        signal: abort.signal,
        body: JSON.stringify({
          conversationId,
          message: action === "regenerate" ? undefined : content,
          action,
          messageId,
          clientMessageId: action === "send" ? pendingUserId : undefined,
          attachments: turnAttachments,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const code = body.error?.code;
        if (code === "message_already_sent") delivery = "saved";
        else if (response.status < 500 && code !== "generation_active") delivery = "rejected";
        throw new ChatResponseError(body.error?.message || "The model could not respond.", code);
      }
      if (!response.body) throw new Error("Streaming is unavailable. Please try again.");
      for await (const { event, payload } of chatFrames(response.body)) {
        if (event === "accepted" && action === "send" && payload.message?.id === pendingUserId) {
          delivery = "saved";
          const stamp = payload.message;
          messages = messages.map((m) => m.id === pendingUserId ? { ...m, ...stamp } : m);
        } else if (event === "text") {
          reply += payload.text;
          if (!renderFrame) renderFrame = requestAnimationFrame(paintReply);
        } else if (event === "usage" && currentTurn()) {
          setUsage(payload);
        } else if (event === "error") {
          throw new ChatResponseError(payload.message, payload.code);
        } else if (event === "done") {
          complete = true;
          if (payload.committed?.conversation?.id === conversationId) committed = payload.committed;
          if (payload.truncatedTurns && currentTurn()) toast("Earlier turns were shortened to fit this model’s context window.");
        }
      }
      if (!complete) throw new Error("The response ended early.");
    } catch (error) {
      if (!complete) {
        const stopped = abort.signal.aborted || (error as Error).name === "AbortError";
        const description = stopped
          ? action === "send" ? "Response stopped." : "Response stopped. Previous messages restored."
          : (error as Error).message || "The response could not complete.";
        issue = {
          conversationId,
          message: description,
          code: error instanceof ChatResponseError ? error.code : undefined,
          recovery: action === "edit" ? "edit" : action === "regenerate" || delivery === "saved" ? "retry"
            : delivery === "rejected" ? "draft" : "check",
          sent: action === "send" && pendingUserId ? { id: pendingUserId, draft: savedDraft } : undefined,
        };
        if (currentTurn() && action === "send" && delivery !== "saved") {
          setDraft((current) => current || savedDraft);
        }
      }
    } finally {
      if (renderFrame) cancelAnimationFrame(renderFrame);
      if (!complete) abort.abort();
      if (currentTurn()) {
        const terminal = committed;
        setChat((current) => {
          if (current?.id !== conversationId || !currentTurn()) return current;
          const result = complete ? messages.map((m) => {
            if (m.id === pendingId) return { ...m, status: "complete", ...terminal?.assistant, content: reply };
            if (m.id === pendingUserId && terminal?.user) return { ...m, ...terminal.user };
            return m;
          }) : action === "send" && delivery === "saved"
            ? messages.flatMap((m) => m.id !== pendingId ? [m] : reply ? [{
                ...m, content: reply, status: issue?.message === "Response stopped." ? "cancelled" : "failed",
              }] : [])
            : prior;
          return { ...current, ...terminal?.conversation, messages: result };
        });
        if (terminal) rememberConversation(terminal.conversation);
        if (action === "send" && (complete || delivery === "saved")) clearFiles();
        if (!complete && action === "edit") {
          setEditId(messageId || null);
          setEditText(message);
        }
        if (issue) setTurnIssue(issue);
        setBusy(false);
      }
      if (controller.current === abort) controller.current = null;
    }
    if (!committed && currentTurn()) {
      try {
        const detail = await loadCurrentConversation(conversationId, currentTurn);
        if (detail && issue?.sent) resolveSendIssue(issue, detail);
      } catch {
        // Keep the visible branch and retry controls when reconciliation is unavailable.
      }
    }
  }
  async function loadCurrentConversation(id: string, canApply: () => boolean) {
    const detail = await api<ConversationDetail>(`/api/conversations/${id}`);
    if (!canApply()) return null;
    setChat((current) => current?.id === id && canApply() ? detail : current);
    const { messages: _messages, persona: _persona, initialGoal: _goal, ...conversation } = detail;
    rememberConversation(conversation);
    return detail;
  }
  function resolveSendIssue(issue: TurnIssue, detail: ConversationDetail) {
    if (!issue.sent) return;
    const sent = issue.sent;
    const userIndex = detail.messages.findIndex((m) => m.id === sent.id);
    if (userIndex < 0) {
      if (issue.recovery === "check") setTurnIssue({ ...issue, recovery: "draft" });
      return;
    }
    const hasAnswer = detail.messages.slice(userIndex + 1).some((m) =>
      m.role === "assistant" && m.status !== "failed" && m.status !== "cancelled",
    );
    if (issue.recovery === "check") {
      setDraft((current) => current === sent.draft ? "" : current);
      clearFiles();
    }
    setTurnIssue(hasAnswer ? null : { ...issue, recovery: "retry" });
  }
  async function verifyDelivery(issue: TurnIssue) {
    if (checkingTurn || busy) return;
    const epoch = turnEpoch.current;
    const navigation = viewEpoch.current;
    const canApply = () => contextRef.current.chatId === issue.conversationId &&
      turnEpoch.current === epoch && viewEpoch.current === navigation;
    setCheckingTurn(true);
    try {
      const detail = await loadCurrentConversation(issue.conversationId, canApply);
      if (detail) resolveSendIssue(issue, detail);
    } catch {
      if (canApply()) setTurnIssue({ ...issue, message: "Could not check whether your message was saved. Try checking again." });
    } finally {
      setCheckingTurn(false);
    }
  }
  async function addFiles(files: FileList | null) {
    if (!files || !files.length) return;
    if (uploadPending.current) {
      toast("Wait for the current files to finish loading.");
      return;
    }
    const start = {
      identity: composerIdentity(contextRef.current),
      epoch: uploadEpoch.current,
    };
    uploadPending.current = true;
    try {
      let imageBytes = attachments.reduce(
        (n, a) => n + (a.data.length * 3) / 4,
        0,
      );
      const nextImages = [...attachments],
        nextDocs = [...documents];
      for (const file of Array.from(files)) {
        if (file.type.startsWith("image/")) {
          if (!model?.supportsImages)
            throw Error(
              "Choose a model that supports images before adding one.",
            );
          if (
            !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
              file.type,
            )
          )
            throw Error("Use PNG, JPEG, WebP, or GIF.");
          imageBytes += file.size;
          if (imageBytes > 2_000_000 || nextImages.length >= 3)
            throw Error("Attach up to 3 images, below 2 MB combined.");
          const data = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).split(",")[1]);
            r.onerror = () =>
              reject(new Error("This image could not be read."));
            r.readAsDataURL(file);
          });
          nextImages.push({
            type: "image",
            mimeType: file.type,
            data,
            name: file.name,
          });
        } else {
          if (!/\.(txt|md|csv|json)$/i.test(file.name) || file.size > 24000)
            throw Error(
              "Text references must be TXT, Markdown, CSV, or JSON, below 24 KB.",
            );
          if (nextDocs.length >= 4)
            throw Error("Attach up to 4 text references.");
          nextDocs.push({ name: file.name, text: await file.text() });
        }
      }
      if (
        !canApplyUpload(start, {
          identity: composerIdentity(contextRef.current),
          epoch: uploadEpoch.current,
        })
      ) {
        toast(
          "Files were not added because your conversation or model changed.",
        );
        return;
      }
      setAttachments(nextImages);
      setDocuments(nextDocs);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      uploadPending.current = false;
      if (upload.current) upload.current.value = "";
    }
  }
  async function removeConversation(c: Conversation) {
    if (navigationBlocked()) return;
    turnEpoch.current++;
    setSwitching(true);
    try {
      await api(`/api/conversations/${c.id}`, "DELETE");
      if (contextRef.current.chatId === c.id) {
        viewEpoch.current++;
        clearFiles();
        setChat(null);
        setView("home");
        setRole("");
        setFocus("");
        setDraft("");
        setUsage(null);
        setEditId(null);
        setSidebar(false);
      }
      await refresh();
      toast("Conversation archived.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSwitching(false);
    }
  }
  function beginRename(c: Conversation) {
    if (navigationBlocked()) return;
    turnEpoch.current++;
    setRenameTitle(c.title);
    setRenameError("");
    setRenameTarget(c);
  }
  async function saveRename(event: FormEvent) {
    event.preventDefault();
    if (!renameTarget || renaming) return;
    const title = renameTitle.trim();
    if (!title || title.length > 120) {
      setRenameError("Use a title between 1 and 120 characters.");
      return;
    }
    setRenaming(true);
    setSwitching(true);
    setRenameError("");
    try {
      const result = await api<Conversation>(`/api/conversations/${renameTarget.id}`, "PATCH", { title });
      setChat((current) => current?.id === result.id
        ? { ...current, title: result.title, updatedAt: result.updatedAt }
        : current);
      setData((current) => current ? {
        ...current,
        conversations: [result, ...current.conversations.filter((c) => c.id !== result.id)],
      } : current);
      setRenameTarget(null);
      toast.success("Conversation renamed.");
    } catch (error) {
      setRenameError((error as Error).message);
    } finally {
      setRenaming(false);
      setSwitching(false);
    }
  }
  async function exportConversation(c: Conversation) {
    if (navigationBlocked() || exporting) return;
    const navigation = viewEpoch.current;
    setExporting(true);
    try {
      const response = await fetch(`/api/conversations/${c.id}/export`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw Error(error.error?.message || "This conversation could not be downloaded. Try again.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") || "")?.[1] || "harness-conversation.md";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (viewEpoch.current === navigation) toast.error((error as Error).message);
    } finally {
      setExporting(false);
    }
  }
  async function loadArchives() {
    const epoch = ++archivesEpoch.current;
    setArchivesLoading(true);
    setArchivesError("");
    try {
      const result = await api<Conversation[]>("/api/conversations?archived=true");
      if (archivesEpoch.current === epoch) setArchives(result);
    } catch (error) {
      if (archivesEpoch.current === epoch) setArchivesError((error as Error).message);
    } finally {
      if (archivesEpoch.current === epoch) setArchivesLoading(false);
    }
  }
  function openArchives() {
    if (navigationBlocked()) return;
    turnEpoch.current++;
    setSettingsOpen(false);
    setSidebar(false);
    setArchiveQuery("");
    setArchives([]);
    setArchivesOpen(true);
    void loadArchives();
  }
  async function restoreConversation(c: Conversation) {
    if (restoringId) return;
    const epoch = archivesEpoch.current;
    setRestoringId(c.id);
    setArchivesError("");
    try {
      const restored = await api<Conversation>(`/api/conversations/${c.id}/restore`, "POST", {});
      if (archivesEpoch.current !== epoch) return;
      setArchives((current) => current.filter((item) => item.id !== c.id));
      setData((current) => current ? {
        ...current,
        conversations: [restored, ...current.conversations.filter((item) => item.id !== restored.id)],
      } : current);
      toast.success("Conversation restored to your history.");
    } catch (error) {
      if (archivesEpoch.current === epoch) setArchivesError((error as Error).message);
    } finally {
      setRestoringId("");
    }
  }
  if (loading)
    return (
      <div className="boot-screen">
        <Mark />
        <div className="skeleton-line" />
        <p>Making a little room for your ideas.</p>
      </div>
    );
  if (fatal)
    return (
      <div className="boot-screen">
        <Mark />
        <h1>Welcome to Harness.</h1>
        <p>{fatal}</p>
        <a href="/api/auth/signin" className="ui-button button-primary">
          Sign in to your workspace <ArrowRight size={16} />
        </a>
        <Button variant="ghost" onClick={() => location.reload()}>
          Try again
        </Button>
      </div>
    );
  const persona = chat?.persona;
  const showRetry = currentIssue?.recovery === "retry" ||
    (!currentIssue && chat?.messages.at(-1)?.role === "user");
  return (
    <>
      <Toaster theme={theme} position="top-right" offset={84} visibleToasts={2}
        toastOptions={{ className: "workspace-toast", duration: 2800 }} closeButton />
      <div className={`app-frame ${sidebarPinned ? "sidebar-pinned" : "sidebar-tucked"}`}>
        {sidebarOpen && (
          <button
            className="mobile-shade"
            aria-label="Dismiss navigation"
            tabIndex={-1}
            onClick={() => setSidebar(false)}
          />
        )}
        <aside ref={sidebarRef} id="workspace-sidebar" className={`app-sidebar ${sidebarOpen ? "is-open" : ""}`}
          aria-label="Workspace navigation" role={compactViewport ? "dialog" : undefined}
          aria-modal={compactViewport && sidebarOpen ? true : undefined}
          aria-hidden={!sidebarVisible} inert={!sidebarVisible}
          onKeyDown={(event) => {
            if (!compactViewport || !sidebarOpen) return;
            if (event.key === "Escape") { event.stopPropagation(); setSidebar(false); }
            if (event.key === "Tab") {
              const controls = [...(sidebarRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, [tabindex="0"]') || [])].filter(el => el.getClientRects().length > 0);
              const first = controls[0], last = controls.at(-1);
              if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
              else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
          }}>
          <div className="sidebar-brand">
            <div className="workspace-label"><span className="workspace-dot" />YOUR SPACE</div>
            <button
              className="icon-button collapse-sidebar"
              onClick={() => {
                if (compactViewport) setSidebar(false);
                else { setSidebarPinned(false); sidebarToggle.current?.focus(); }
              }}
              aria-label="Close sidebar"
            >
              <PanelLeftClose size={17} />
            </button>
          </div>
          <button className="new-chat" onClick={newChat}>
            <Plus size={17} />
            New conversation<span>⌘ ⇧ O</span>
          </button>
          <div className="sidebar-nav">
            <button className={view === "builder" ? "active" : ""} onClick={() => openContextBuilder()}
              aria-current={view === "builder" ? "page" : undefined}>
              <Layers3 size={16} />
              Context Builder
            </button>
            <button onClick={() => { setSidebar(false); setSearchOpen(true); }}>
              <Search size={16} />
              Search conversations<span>⌘ K</span>
            </button>
            <button
              className={view === "library" ? "active" : ""}
              onClick={openLibrary}
              aria-current={view === "library" ? "page" : undefined}
            >
              <Compass size={16} />
              Explore professions<span className="small-pill">{PROFESSION_COUNT}</span>
            </button>
            <button onClick={openArchives}>
              <Archive size={16} />
              Archived chats
            </button>
          </div>
          <div className="history-heading">YOUR CONVERSATIONS</div>
          <div className="history-list">
            {!data?.conversations.length ? (
              <div className="history-empty">
                <MessageSquare size={21} />
                <p>
                  Good conversations
                  <br />
                  start with a little curiosity.
                </p>
              </div>
            ) : (
              data.conversations.map((c) => {
                const p = data.personas.find((p) => p.id === c.personaId);
                return (
                  <div
                    key={c.id}
                    className={`history-item ${c.id === chat?.id && view === "chat" ? "active" : ""}`}
                  >
                    <button onClick={() => openConversation(c.id)}>
                      <ExpertAvatar
                        role={p?.role || "Expert"}
                        color={p?.color}
                      />
                      <span>{c.title}</span>
                    </button>
                    <button
                      className="history-delete icon-button"
                      aria-label={`Archive ${c.title}`}
                      onClick={() => removeConversation(c)}
                      disabled={busy || compiling || switching}
                    >
                      <Archive size={13} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
          <div className="sidebar-bottom">
            <button
              className="connections-link"
              onClick={() => { setSidebar(false); setConnectOpen(true); }}
            >
              <span className="connection-icon">
                <Link2 size={16} />
              </span>
              <span>
                <strong>Your models</strong>
                <small>
                  {data?.connections.length
                    ? `${data.connections.length} provider${data.connections.length > 1 ? "s" : ""} connected`
                    : "Connect your first provider"}
                </small>
              </span>
              <ChevronRight size={15} />
            </button>
            <div className="account-row">
              <span className="user-avatar">
                {data?.user.name?.slice(0, 1) || "Y"}
              </span>
              <span>
                <strong>{data?.user.name || "Your workspace"}</strong>
                <small>
                  {data?.user.development
                    ? "Local development"
                    : "Personal workspace"}
                </small>
              </span>
              <button
                className="icon-button"
                onClick={() => { setSidebar(false); setSettingsOpen(true); }}
                aria-label="Workspace settings"
              >
                <Settings2 size={16} />
              </button>
            </div>
          </div>
        </aside>
        <main className="app-main" data-view={view} inert={compactViewport && sidebarOpen} aria-hidden={compactViewport && sidebarOpen ? true : undefined}>
          <header className="chat-header">
            <div className="header-left">
              <button
                ref={sidebarToggle}
                className="icon-button sidebar-toggle"
                onClick={toggleSidebar}
                aria-label={sidebarVisible ? "Hide sidebar" : "Open sidebar"}
                aria-expanded={sidebarVisible}
                aria-controls="workspace-sidebar"
                title="Toggle sidebar (⌘\\)"
              >
                <PanelLeft size={19} />
              </button>
              <button className="header-brand" onClick={newChat} aria-label="Harness home"><Mark small /><span>harness</span><small>beta</small></button>
              <div className="model-select-wrap">
                {data?.connections.length ? (
                  <>
                    <select
                      aria-label="Choose model"
                      value={
                        selected && model ? `${connectionId}::${modelId}` : ""
                      }
                      onChange={(e) => changeModel(e.target.value)}
                      disabled={busy || compiling || switching}
                    >
                      {(!selected || !model) && (
                        <option value="" disabled>
                          Choose a model to continue
                        </option>
                      )}
                      {data?.connections.map((c) => (
                        <optgroup key={c.id} label={c.name}>
                          {c.models.map((m) => (
                            <option key={m.id} value={`${c.id}::${m.id}`}>
                              {m.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <ChevronDown size={14} />
                  </>
                ) : (
                  <button
                    className="choose-model"
                    onClick={() => setConnectOpen(true)}
                  >
                    Connect a model <ChevronDown size={14} />
                  </button>
                )}
              </div>
              {view === "chat" && persona && (
                <button
                  className="persona-chip"
                  aria-label={persona.context ? `Context ${persona.role}, version ${persona.context.revision}` : undefined}
                  title={persona.context ? `View context version ${persona.context.revision}` : undefined}
                  onClick={() => {
                    if (persona.context) { setContextDetailsOpen(true); return; }
                    setRole(persona.role);
                    setFocus(persona.focus);
                    setPersonaEditOpen(true);
                  }}
                >
                  <ExpertAvatar role={persona.role} color={persona.color} />
                  <span className="persona-chip-label">{persona.role}{persona.context ? ` · v${persona.context.revision}` : ""}</span>
                  <Settings2 size={12} />
                </button>
              )}
            </div>
            <div className="header-right">
              <span className="private-label">
                <ShieldCheck size={13} />
                Your private workspace
              </span>
              {view === "chat" && chat && (
                <DropdownMenu.Root open={actionsOpen} onOpenChange={setActionsOpen}>
                  <DropdownMenu.Trigger asChild>
                    <button className="icon-button" aria-label="Conversation actions" disabled={busy || compiling || switching}>
                      <MoreHorizontal size={19} />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      className="conversation-menu"
                      align="end"
                      sideOffset={8}
                      onCloseAutoFocus={(event) => { if (renameTarget) event.preventDefault(); }}
                    >
                      <DropdownMenu.Label>Conversation</DropdownMenu.Label>
                      <DropdownMenu.Item onSelect={() => setContextDetailsOpen(true)}><Layers3 size={15} />View context</DropdownMenu.Item>
                      <DropdownMenu.Item onSelect={() => beginRename(chat)}><Pencil size={15} />Rename</DropdownMenu.Item>
                      <DropdownMenu.Item onSelect={() => exportConversation(chat)} disabled={exporting}>
                        {exporting ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}Download Markdown
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item onSelect={() => removeConversation(chat)}><Archive size={15} />Archive</DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              )}
              <button
                className="icon-button"
                onClick={toggleTheme}
                aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
              >
                {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
              </button>
            </div>
          </header>
          <ContextBuilder active={view === "builder"} request={api} onRun={runSavedContext}
            requestedContextId={requestedContextId}
            modelName={model?.name} busy={busy || compiling || switching}
            onConnect={() => setConnectOpen(true)}
            onBack={chat ? resumeConversation : undefined} />
          {view === "builder" ? null : view === "library" ? (
            <ProfessionLibrary onSelect={(roleName) => prepareExpert(roleName, "")} />
          ) : view === "home" ? (
            <div className="home-content">
              <div className="home-intro">
                <div className="intro-symbol">
                  <Mark />
                </div>
                <div className="eyebrow">
                  A LITTLE CONTEXT. A WORLD OF POSSIBILITY.
                </div>
                <h1>
                  A mind for whatever’s
                  <br />
                  on yours.
                </h1>
                <p>
                  Choose your perspective. Make room for a better conversation.
                </p>
              </div>
              <form
                className="role-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  prepareExpert();
                }}
              >
                <label className="sr-only" htmlFor="role-input">
                  What should your AI be?
                </label>
                <div className="role-input-row">
                  <Sparkles size={20} />
                  <input
                    ref={roleInput}
                    id="role-input"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    placeholder="What should your AI be?"
                    maxLength={100}
                    disabled={compiling}
                  />
                  <Button
                    size="icon"
                    aria-label="Create expert"
                    type="submit"
                    disabled={!role.trim() || compiling}
                  >
                    {compiling ? (
                      <LoaderCircle className="spin" size={18} />
                    ) : (
                      <ArrowRight size={20} />
                    )}
                  </Button>
                </div>
                {showFocus && (
                  <input
                    aria-label="Optional focus"
                    className="focus-input"
                    placeholder="A little more direction? e.g. number theory, for a beginner"
                    value={focus}
                    onChange={(e) => setFocus(e.target.value)}
                    maxLength={300}
                  />
                )}
                <div className="role-composer-foot">
                  <button
                    type="button"
                    onClick={() => setShowFocus(!showFocus)}
                  >
                    <Plus size={12} />
                    {showFocus ? "Hide focus" : "Add a focus"}
                    <span>optional</span>
                  </button>
                  <span>
                    {compiling
                      ? "Preparing your expert…"
                      : selected
                        ? `With ${providerName(selected.provider)}`
                        : "Your models. Your possibilities."}
                  </span>
                </div>
              </form>
              <button className="connect-nudge context-builder-entry" onClick={() => openContextBuilder()}>
                <span className="nudge-icon"><Layers3 size={17} /></span>
                <span><strong>Build a reusable context</strong><small>Set the goal, references, and output format for Claude or ChatGPT.</small></span>
                <ArrowRight size={16} />
              </button>
              {!data?.connections.length && (
                <button
                  className="connect-nudge"
                  onClick={() => setConnectOpen(true)}
                >
                  <span className="nudge-icon">
                    <Link2 size={16} />
                  </span>
                  <span>
                    <strong>Bring the models you already love.</strong>
                    <small>
                      Connect with your Claude or ChatGPT account.
                    </small>
                  </span>
                  <ArrowRight size={16} />
                </button>
              )}
              <section className="expert-section">
                <div className="expert-section-heading">
                  <h2>Or follow a little curiosity</h2>
                  <button onClick={openLibrary}>Browse {PROFESSION_COUNT} professions <ArrowRight size={13} /></button>
                </div>
                <div className="preset-grid">
                  {PRESETS.slice(0, 8).map((p) => (
                    <button
                      key={p.role}
                      className="preset-card"
                      style={{ "--card-tint": p.color } as CSSProperties}
                      onClick={() => prepareExpert(p.role, "")}
                      disabled={compiling}
                    >
                      <span
                        className="preset-icon"
                        style={{ background: p.color }}
                      >
                        <p.icon size={21} />
                      </span>
                      <span className="preset-category">{p.category}</span>
                      <strong>{p.role}</strong>
                      <small>{p.note}</small>
                      <ArrowRight className="preset-arrow" size={14} />
                    </button>
                  ))}
                </div>
              </section>
              <div className="home-foot">
                <ShieldCheck size={12} />
                <span>Your accounts. Your conversations. Your expert.</span>
              </div>
            </div>
          ) : (
            <div className="conversation-layout" ref={conversationRef}>
              <div className="message-column" aria-busy={busy}>
                {chat?.messages.map((m, index) => (
                  <article key={m.id} className={`message-row ${m.role}`}>
                    <div className="message-avatar">
                      {m.role === "assistant" ? (
                        <ExpertAvatar
                          role={persona?.role || "Expert"}
                          color={persona?.color}
                        />
                      ) : (
                        <span className="user-avatar small">You</span>
                      )}
                    </div>
                    <div className="message-main">
                      <div className="message-label">
                        {m.role === "assistant" ? persona?.role : "You"}
                        {m.status === "cancelled" && <span>Stopped</span>}
                        {m.status === "failed" && <span>Incomplete</span>}
                      </div>
                      {editId === m.id ? (
                        <div className="edit-message">
                          <TextareaAutosize
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            aria-label="Edit your message"
                            autoFocus
                          />
                          <div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditId(null)}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => streamChat("edit", editText, m.id)}
                            >
                              Save & resend
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {m.attachments?.length ? (
                            <div className="message-images">
                              {m.attachments.map((a, i) => (
                                <img
                                  key={i}
                                  src={`data:${a.mimeType};base64,${a.data}`}
                                  alt={a.name}
                                />
                              ))}
                            </div>
                          ) : null}
                          {m.content ? (
                            <Markdown content={m.content} />
                          ) : m.status === "streaming" ? (
                            <span className="thinking-indicator" role="status">
                              <span />
                              <span />
                              <span />
                              <span className="sr-only">Thinking</span>
                            </span>
                          ) : (
                            <p className="message-state">
                              {m.status === "cancelled"
                                ? "Response stopped."
                                : "No complete response was received. You can regenerate it."}
                            </p>
                          )}
                          <div className="message-actions">
                            <button
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(
                                    m.content,
                                  );
                                  toast("Copied to clipboard.");
                                } catch {
                                  toast.error(
                                    "Clipboard access is unavailable.",
                                  );
                                }
                              }}
                              aria-label="Copy message"
                            >
                              <Copy size={14} />
                            </button>
                            {m.role === "user" && !busy && (
                              <button
                                onClick={() => {
                                  setEditId(m.id);
                                  setEditText(m.content);
                                }}
                                aria-label="Edit message"
                              >
                                <Pencil size={14} />
                              </button>
                            )}
                            {m.role === "assistant" &&
                              index === chat.messages.length - 1 &&
                              chat.messages.some((m) => m.role === "user") &&
                              !busy && (
                                <button
                                  onClick={() => streamChat("regenerate")}
                                  aria-label="Regenerate response"
                                  disabled={currentIssue?.recovery === "check"}
                                >
                                  <RotateCcw size={14} />
                                </button>
                              )}
                          </div>
                        </>
                      )}
                    </div>
                  </article>
                ))}
                <div className="conversation-end" ref={bottom} />
              </div>
              <div className="composer-zone" ref={composerRef}>
                {showLatest && <Button type="button" variant="outline" size="sm" className="jump-latest" onClick={goToLatest}>
                  <ArrowDown size={15} /> Jump to latest
                </Button>}
                {!busy && (currentIssue || showRetry) && (
                  <div className="turn-notice" role={currentIssue ? "alert" : "status"}>
                    <AlertCircle size={16} aria-hidden="true" />
                    <p>{currentIssue?.message || "Your message is saved. Try the reply again when you’re ready."}</p>
                    <div className="turn-notice-actions">
                      {currentIssue?.code === "sign_in_required" && <Button size="sm" variant="outline" onClick={() => setConnectOpen(true)}>Reconnect account</Button>}
                      {currentIssue?.code === "plan_limit" && <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">Manage plan usage</a>}
                      {currentIssue?.recovery === "check" && <Button size="sm" variant="outline" disabled={checkingTurn} onClick={() => void verifyDelivery(currentIssue)}>
                        {checkingTurn ? "Checking…" : "Check message status"}
                      </Button>}
                      {showRetry && <Button size="sm" variant="outline" onClick={() => void streamChat("regenerate")}>Retry reply</Button>}
                    </div>
                  </div>
                )}
                <div className="composer-box">
                  <div className="attachment-list">
                    {attachments.map((a, i) => (
                      <span key={i}>
                        <ImageIcon size={14} />
                        {a.name}
                        <button
                          aria-label={`Remove ${a.name}`}
                          onClick={() =>
                            setAttachments(
                              attachments.filter((_, j) => i !== j),
                            )
                          }
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                    {documents.map((d, i) => (
                      <span key={i}>
                        <BookOpen size={14} />
                        {d.name}
                        <button
                          aria-label={`Remove ${d.name}`}
                          onClick={() =>
                            setDocuments(documents.filter((_, j) => i !== j))
                          }
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                  <TextareaAutosize
                    ref={input}
                    minRows={1}
                    maxRows={7}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={`Message your ${persona?.role.toLowerCase() || "expert"}…`}
                    aria-label="Message your expert"
                    maxLength={40000}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        streamChat();
                      }
                    }}
                  />
                  <div className="composer-controls">
                    <div>
                      <button
                        className="icon-button"
                        onClick={() => upload.current?.click()}
                        aria-label="Attach image or text file"
                        disabled={busy || switching || compiling || currentIssue?.recovery === "check"}
                      >
                        <Paperclip size={18} />
                      </button>
                      <span>
                        {model?.supportsImages
                          ? "Images & text"
                          : "Text references"}
                      </span>
                    </div>
                    {busy ? (
                      <Button
                        size="icon"
                        onClick={() => controller.current?.abort()}
                        aria-label="Stop generation"
                      >
                        <Square fill="currentColor" size={13} />
                      </Button>
                    ) : (
                      <Button
                        size="icon"
                        onClick={() => streamChat()}
                        disabled={
                          currentIssue?.recovery === "check" || (!draft.trim() &&
                          !attachments.length &&
                          !documents.length)
                        }
                        aria-label="Send message"
                      >
                        <ArrowUp size={20} />
                      </Button>
                    )}
                  </div>
                </div>
                {selected?.provider === "chatgpt" && <div className="plan-usage-note">
                <span>Using ChatGPT plan</span>
                <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">Manage usage</a>
              </div>}
              <div className="composer-disclaimer">
                  {usage
                    ? `${usage.inputTokens.toLocaleString()} input · ${usage.outputTokens.toLocaleString()} output tokens · `
                    : ""}
                  AI can make mistakes. A thoughtful second look always helps.
                </div>
                <input
                  hidden
                  ref={upload}
                  aria-label="Conversation attachments"
                  type="file"
                  multiple
                  accept={
                    model?.supportsImages
                      ? "image/png,image/jpeg,image/webp,image/gif,.txt,.md,.csv,.json"
                      : ".txt,.md,.csv,.json"
                  }
                  onChange={(e) => addFiles(e.target.files)}
                />
              </div>
            </div>
          )}
        </main>
      </div>
      {chat && <ContextDetails open={contextDetailsOpen && view === "chat"} onOpenChange={setContextDetailsOpen}
        conversationId={chat.id} request={api} onOpenBuilder={(id) => { setContextDetailsOpen(false); openContextBuilder(id); }} />}
      {professionSetup && (
        <ProfessionSetup {...professionSetup} open={!setupConnecting} busy={compiling} error={professionError}
          modelLabel={professionConnection && professionModel ? `${providerName(professionConnection.provider)} · ${professionModel.name}` : undefined}
          canStart={!!professionModel} onStart={startExpert} onOpenChange={(open) => {
            if (open || compiling || setupConnecting) return;
            setProfessionSetup(null);
            requestAnimationFrame(() => professionTrigger.current?.focus({ preventScroll: true }));
          }} />
      )}
      <Connections
        open={connectOpen}
        onOpenChange={(open) => {
          setConnectOpen(open);
          if (!open) setSetupConnecting(false);
        }}
        connections={data?.connections || []}
        onSaved={async (c) => {
          await refresh();
          const current = contextRef.current;
          const next = selectionAfterConnectionSave(
            { connectionId: current.connectionId, modelId: current.modelId },
            c,
            current.view === "chat",
          );
          if (current.view !== "chat") {
            if (current.view !== "builder") clearFiles();
            setConnectionId(next.connectionId);
            setModelId(next.modelId);
          }
        }}
        onRemoved={async (id) => {
          if (id === contextRef.current.connectionId) {
            if (contextRef.current.view !== "builder") clearFiles();
            if (contextRef.current.view !== "chat") {
              setConnectionId("");
              setModelId("");
            }
            toast(
              "Choose a connected model before continuing this conversation.",
            );
          }
          await refresh();
        }}
      />
      <Dialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        title="Pick up a conversation"
        description="Search by a question, an idea, or an expert."
      >
        <div className="search-dialog">
          <div className="search-field">
            <Search size={17} />
            <input
              data-dialog-autofocus
              aria-label="Search conversations"
              placeholder="Find a conversation…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>⌘ K</kbd>
          </div>
          <div className="search-results">
            {data?.conversations
              .filter((c) =>
                `${c.title} ${data.personas.find((p) => p.id === c.personaId)?.role || ""}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .map((c) => (
                <button key={c.id} onClick={() => openConversation(c.id)}>
                  <MessageSquare size={15} />
                  <span>{c.title}</span>
                  <ArrowRight size={14} />
                </button>
              ))}
            {!data?.conversations.length ? (
              <p>Your first conversation is waiting to happen.</p>
            ) : (
              !data.conversations.some((c) =>
                `${c.title} ${data.personas.find((p) => p.id === c.personaId)?.role || ""}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              ) && <p>No conversations match that search. Try another word.</p>
            )}
          </div>
        </div>
      </Dialog>
      <Dialog
        open={!!renameTarget}
        onOpenChange={(open) => { if (!open && !renaming) setRenameTarget(null); }}
        title="Rename conversation"
        description="Give this conversation a name you’ll recognize."
      >
        <form className="simple-form" onSubmit={saveRename}>
          <label>
            Conversation title
            <input
              data-dialog-autofocus
              value={renameTitle}
              onChange={(event) => { setRenameTitle(event.target.value); setRenameError(""); }}
              maxLength={120}
              required
              disabled={renaming}
              aria-invalid={!!renameError}
              aria-describedby={renameError ? "rename-error" : "rename-help"}
            />
          </label>
          <p className="field-help" id="rename-help">Your title stays the same as the conversation grows.</p>
          {renameError && <p className="management-error" id="rename-error" role="alert"><AlertCircle size={15} />{renameError}</p>}
          <div className="management-actions">
            <Button type="button" variant="ghost" onClick={() => setRenameTarget(null)} disabled={renaming}>Cancel</Button>
            <Button type="submit" disabled={renaming || !renameTitle.trim()}>
              {renaming && <LoaderCircle size={15} className="spin" />}Save title
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={archivesOpen}
        onOpenChange={(open) => {
          if (!open && !restoringId) {
            archivesEpoch.current++;
            setArchivesOpen(false);
          }
        }}
        title="Archived conversations"
        description="Out of your way, ready when you need them. Restore a chat to bring it back to your history."
        className="archives-dialog"
      >
        <div className="archives-body">
          <div className="search-field">
            <Search size={17} />
            <input data-dialog-autofocus aria-label="Search archived conversations" placeholder="Find an archived conversation…" value={archiveQuery} onChange={(event) => setArchiveQuery(event.target.value)} />
          </div>
          {archivesError && <p className="management-error" role="alert"><AlertCircle size={15} />{archivesError}</p>}
          {archivesLoading ? (
            <div className="archive-empty" role="status"><LoaderCircle size={22} className="spin" /><p>Finding your conversations…</p></div>
          ) : archivesError && !archives.length ? (
            <div className="archive-empty"><Button variant="outline" onClick={() => void loadArchives()}>Try again</Button></div>
          ) : !archives.length ? (
            <div className="archive-empty"><Archive size={28} /><strong>A little room to think.</strong><p>Archived conversations will appear here. Your messages stay saved.</p></div>
          ) : (
            <div className="archive-list" aria-label="Archived conversations" aria-busy={!!restoringId}>
              {archives.filter((c) => c.title.toLowerCase().includes(archiveQuery.toLowerCase())).map((c) => {
                const expert = data?.personas.find((p) => p.id === c.personaId);
                return (
                  <div className="archive-item" key={c.id}>
                    <ExpertAvatar role={expert?.role || "Expert"} color={expert?.color} />
                    <span className="archive-item-label"><strong>{c.title}</strong><small>{expert?.role || "Expert conversation"}</small></span>
                    <Button variant="outline" size="sm" onClick={() => restoreConversation(c)} disabled={!!restoringId} aria-label={`Restore ${c.title}`}>
                      {restoringId === c.id ? <LoaderCircle size={14} className="spin" /> : <ArchiveRestore size={14} />}Restore
                    </Button>
                  </div>
                );
              })}
              {!archives.some((c) => c.title.toLowerCase().includes(archiveQuery.toLowerCase())) && <p className="archive-no-results" role="status">No archived conversations match that search.</p>}
            </div>
          )}
        </div>
      </Dialog>
      <Dialog
        open={personaEditOpen}
        onOpenChange={setPersonaEditOpen}
        title="A little more you."
        description="Give this expert a new direction. We’ll start a fresh conversation and keep this one safe."
      >
        <form
          className="simple-form"
          onSubmit={(e) => {
            e.preventDefault();
            prepareExpert();
          }}
        >
          <label>
            Role
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              required
              maxLength={100}
            />
          </label>
          <label>
            Focus <span>optional</span>
            <input
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="e.g. number theory, for a beginner"
              maxLength={300}
            />
          </label>
          <p className="field-help">
            Just tell us who you want to think with. Harness prepares the
            context privately.
          </p>
          <Button type="submit" disabled={compiling}>
            {compiling ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Plus size={16} />
            )}
            Start a new conversation
          </Button>
        </form>
      </Dialog>
      <Dialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title={data?.user.development ? "Local workspace" : "Your workspace"}
        description={
          data?.user.development
            ? "Your development space, without account sign-in."
            : "A few things to make yourself at home."
        }
      >
        <div className="settings-body">
          <div>
            <span>
              <strong>Appearance</strong>
              <small>A little lighter, or a little darker.</small>
            </span>
            <Button variant="outline" size="sm" onClick={toggleTheme}>
              {theme === "light" ? <Moon size={14} /> : <Sun size={14} />}{" "}
              {theme === "light" ? "Dark mode" : "Light mode"}
            </Button>
          </div>
          <div>
            <span>
              <strong>Your models</strong>
              <small>Manage your Claude and ChatGPT accounts.</small>
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSettingsOpen(false);
                setConnectOpen(true);
              }}
            >
              Manage <ArrowRight size={14} />
            </Button>
          </div>
          <div>
            <span><strong>Archived conversations</strong><small>Bring a saved conversation back to your history.</small></span>
            <Button variant="outline" size="sm" onClick={openArchives}><Archive size={14} />View archive</Button>
          </div>
          <section className="settings-note">
            <ShieldCheck size={19} />
            <p>
              Connect your accounts through secure sign-in. Your role’s
              instructions are prepared privately. Usage follows your Claude
              or ChatGPT plan and its limits.
            </p>
          </section>
          <div className="shortcuts">
            <span>
              Search conversations <kbd>⌘ K</kbd>
            </span>
            <span>
              New conversation <kbd>⌘ ⇧ O</kbd>
            </span>
            <span>
              Send a message <kbd>Enter</kbd>
            </span>
            <span>
              New line <kbd>Shift ↵</kbd>
            </span>
          </div>
          <WorkspaceAccess development={data?.user.development === true} />
        </div>
      </Dialog>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {busy
          ? "Your expert is responding."
          : chat?.messages.at(-1)?.role === "assistant"
            ? "Response ready."
            : ""}
      </div>
    </>
  );
}
