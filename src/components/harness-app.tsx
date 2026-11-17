"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Toaster, toast } from "sonner";
import {
  ArrowUp,
  ArrowRight,
  Plus,
  Search,
  Settings2,
  PanelLeftClose,
  PanelLeft,
  MessageSquare,
  KeyRound,
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
  ExternalLink,
  GraduationCap,
  FlaskConical,
  Compass,
  MoreHorizontal,
  ImageIcon,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Markdown } from "@/components/markdown";
import TextareaAutosize from "react-textarea-autosize";
import { useUI } from "@/lib/store";
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
  {
    id: "openai",
    name: "OpenAI",
    symbol: "◎",
    description: "GPT models",
    link: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    symbol: "✳",
    description: "Claude models",
    link: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "google",
    name: "Google Gemini",
    symbol: "✦",
    description: "Gemini models",
    link: "https://aistudio.google.com/api-keys",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    symbol: "≈",
    description: "DeepSeek models",
    link: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "compatible",
    name: "OpenAI-compatible",
    symbol: "⌘",
    description: "OpenRouter, Groq, Ollama & more",
    link: "",
  },
];
const providerName = (id: string) =>
  PROVIDERS.find((p) => p.id === id)?.name || id;
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

export function HarnessApp() {
  const [data, setData] = useState<Bootstrap | null>(null),
    [loading, setLoading] = useState(true),
    [fatal, setFatal] = useState("");
  const [connectionId, setConnectionId] = useState(""),
    [modelId, setModelId] = useState(""),
    [chat, setChat] = useState<ConversationDetail | null>(null),
    [view, setView] = useState<"home" | "library" | "chat">("home");
  const [connectOpen, setConnectOpen] = useState(false),
    [searchOpen, setSearchOpen] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false),
    [personaEditOpen, setPersonaEditOpen] = useState(false);
  const [role, setRole] = useState(""),
    [focus, setFocus] = useState(""),
    [showFocus, setShowFocus] = useState(false),
    [compiling, setCompiling] = useState(false),
    [draft, setDraft] = useState(""),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("All experts");
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
    roleInput = useRef<HTMLInputElement>(null);
  const { theme, toggleTheme, sidebarOpen, setSidebar } = useUI();
  const contextRef = useRef({
      chatId: "",
      connectionId: "",
      modelId: "",
      view: "home",
    }),
    uploadEpoch = useRef(0),
    uploadPending = useRef(false),
    viewEpoch = useRef(0);
  contextRef.current = { chatId: chat?.id || "", connectionId, modelId, view };
  const selected = data?.connections.find((c) => c.id === connectionId),
    model = selected?.models.find((m) => m.id === modelId);
  const refresh = useCallback(async () => {
    const result = await api<Bootstrap>("/api/bootstrap");
    setData(result);
    if (!contextRef.current.chatId) {
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
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
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
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  useEffect(() => {
    if (chat?.messages.length)
      bottom.current?.scrollIntoView({
        behavior: busy ? "instant" : "smooth",
        block: "end",
      });
  }, [chat?.messages, busy]);
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
    clearFiles();
    try {
      if (chat) {
        await api(`/api/conversations/${chat.id}`, "PATCH", {
          connectionId: cid,
          modelId: mid,
        });
        setChat((s) =>
          s?.id === chat.id ? { ...s, connectionId: cid, modelId: mid } : s,
        );
      }
      clearFiles();
      setConnectionId(cid);
      setModelId(mid);
      toast.success("Model selected. Your expert stays the same.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSwitching(false);
    }
  }
  async function startExpert(roleName = role, focusText = focus) {
    if (busy || compiling || switching) return;
    if (!roleName.trim()) {
      roleInput.current?.focus();
      return;
    }
    if (!selected || !modelId) {
      setRole(roleName);
      setFocus(focusText);
      setConnectOpen(true);
      return;
    }
    const epoch = ++viewEpoch.current;
    clearFiles();
    setCompiling(true);
    try {
      const persona = await api<Persona>("/api/personas", "POST", {
        role: roleName.trim(),
        focus: focusText.trim(),
        connectionId,
        modelId,
      });
      const conversation = await api<Conversation>(
        "/api/conversations",
        "POST",
        { personaId: persona.id, connectionId, modelId },
      );
      const detail = await api<ConversationDetail>(
        `/api/conversations/${conversation.id}`,
      );
      if (viewEpoch.current !== epoch) return;
      setChat(detail);
      setView("chat");
      setPersonaEditOpen(false);
      setDraft("");
      setEditId(null);
      await refresh();
      setTimeout(() => input.current?.focus(), 100);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCompiling(false);
    }
  }
  async function streamChat(
    action: "send" | "regenerate" | "edit" = "send",
    message = draft,
    messageId?: string,
  ) {
    if (!chat || busy || compiling || switching) return;
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
    const savedDraft = draft,
      prior = chat.messages;
    let messages = [...prior];
    if (action === "edit") {
      const index = messages.findIndex((m) => m.id === messageId);
      if (index < 0) return;
      messages = messages.slice(0, index);
    }
    if (action === "regenerate") {
      const index = messages.findLastIndex((m) => m.role === "user");
      messages = messages.slice(0, index + 1);
    } else
      messages.push({
        id: crypto.randomUUID(),
        role: "user",
        content,
        attachments: turnAttachments,
      });
    const pendingId = crypto.randomUUID();
    messages.push({
      id: pendingId,
      role: "assistant",
      content: "",
      status: "streaming",
    });
    setChat({ ...chat, messages });
    setBusy(true);
    setDraft("");
    setEditId(null);
    setUsage(null);
    const abort = new AbortController();
    controller.current = abort;
    let complete = false,
      reply = "",
      terminalStatus = "failed";
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Harness-Request": "1",
        },
        credentials: "same-origin",
        signal: abort.signal,
        body: JSON.stringify({
          conversationId: chat.id,
          message: action === "regenerate" ? undefined : content,
          action,
          messageId,
          attachments: turnAttachments,
        }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || "The model could not respond.");
      }
      if (!response.body)
        throw Error("Streaming is unavailable. Please try again.");
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      function frame(raw: string) {
        let event = "message",
          str = "";
        for (const line of raw.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:")) str += line.slice(5).trimStart();
        }
        if (!str) return;
        const payload = JSON.parse(str);
        if (event === "text") {
          reply += payload.text;
          setChat((current) =>
            current
              ? {
                  ...current,
                  messages: current.messages.map((m) =>
                    m.id === pendingId ? { ...m, content: reply } : m,
                  ),
                }
              : current,
          );
        }
        if (event === "usage") setUsage(payload);
        if (event === "error") throw Error(payload.message);
        if (event === "done") {
          complete = true;
          if (payload.truncatedTurns)
            toast(
              "Earlier turns were shortened to fit this model’s context window.",
            );
        }
      }
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder
          .decode(next.value, { stream: true })
          .replace(/\r\n/g, "\n");
        let index;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const raw = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          frame(raw);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) frame(buffer);
      if (!complete)
        throw Error("The response ended early. You can regenerate it.");
      terminalStatus = "complete";
      clearFiles();
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        terminalStatus = "cancelled";
        toast("Response stopped.");
      } else {
        toast.error((e as Error).message);
        if (!reply && action === "send") setDraft(savedDraft);
      }
    } finally {
      if (!complete) abort.abort();
      setChat((current) =>
        current?.id === chat.id
          ? {
              ...current,
              messages: current.messages.map((m) =>
                m.id === pendingId
                  ? {
                      ...m,
                      status: terminalStatus,
                      content:
                        reply ||
                        (terminalStatus === "cancelled"
                          ? "Response stopped."
                          : "The response could not complete. You can regenerate it."),
                    }
                  : m,
              ),
            }
          : current,
      );
      setBusy(false);
      controller.current = null;
      try {
        const detail = await api<ConversationDetail>(
          `/api/conversations/${chat.id}`,
        );
        setChat((current) => (current?.id === chat.id ? detail : current));
        await refresh();
      } catch {
        /* the settled local response remains visible when a connection drops */
      }
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
    try {
      await api(`/api/conversations/${c.id}`, "DELETE");
      if (chat?.id === c.id) newChat();
      await refresh();
      toast("Conversation archived.");
    } catch (e) {
      toast.error((e as Error).message);
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
  return (
    <>
      <Toaster theme={theme} position="bottom-center" richColors closeButton />
      <div className="app-frame">
        {sidebarOpen && (
          <button
            className="mobile-shade"
            aria-label="Close sidebar"
            onClick={() => setSidebar(false)}
          />
        )}
        <aside className={`app-sidebar ${sidebarOpen ? "is-open" : ""}`}>
          <div className="sidebar-brand">
            <button onClick={newChat} aria-label="Harness home">
              <Mark small />
              <span>harness</span>
              <small>beta</small>
            </button>
            <button
              className="icon-button collapse-sidebar"
              onClick={() => setSidebar(false)}
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
            <button onClick={() => setSearchOpen(true)}>
              <Search size={16} />
              Search conversations<span>⌘ K</span>
            </button>
            <button
              className={view === "library" ? "active" : ""}
              onClick={openLibrary}
            >
              <Compass size={16} />
              Explore experts<span className="small-pill">12</span>
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
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
          <div className="sidebar-bottom">
            <button
              className="connections-link"
              onClick={() => setConnectOpen(true)}
            >
              <span className="connection-icon">
                <KeyRound size={16} />
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
                <small>Personal workspace</small>
              </span>
              <button
                className="icon-button"
                onClick={() => setSettingsOpen(true)}
                aria-label="Workspace settings"
              >
                <Settings2 size={16} />
              </button>
            </div>
          </div>
        </aside>
        <main className="app-main">
          <header className="chat-header">
            <div className="header-left">
              <button
                className="icon-button mobile-menu"
                onClick={() => setSidebar(true)}
                aria-label="Open sidebar"
                aria-expanded={sidebarOpen}
              >
                <PanelLeft size={19} />
              </button>
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
                  onClick={() => {
                    setRole(persona.role);
                    setFocus(persona.focus);
                    setPersonaEditOpen(true);
                  }}
                >
                  <ExpertAvatar role={persona.role} color={persona.color} />
                  {persona.role}
                  <Settings2 size={12} />
                </button>
              )}
            </div>
            <div className="header-right">
              <span className="private-label">
                <ShieldCheck size={13} />
                Your private workspace
              </span>
              <button
                className="icon-button"
                onClick={toggleTheme}
                aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
              >
                {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
              </button>
            </div>
          </header>
          {view !== "chat" ? (
            <div
              className={`home-content ${view === "library" ? "library-page" : ""}`}
            >
              <div className="home-intro">
                <div className="intro-symbol">
                  <Mark />
                </div>
                <div className="eyebrow">
                  A LITTLE CONTEXT. A WORLD OF POSSIBILITY.
                </div>
                <h1>
                  {view === "library" ? (
                    <>
                      Good company for
                      <br />
                      every kind of curiosity.
                    </>
                  ) : (
                    <>
                      A mind for whatever’s
                      <br />
                      on yours.
                    </>
                  )}
                </h1>
                <p>
                  Choose who your AI should be. We’ll take care of the context.
                </p>
              </div>
              <form
                className="role-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  startExpert();
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
              {!data?.connections.length && (
                <button
                  className="connect-nudge"
                  onClick={() => setConnectOpen(true)}
                >
                  <span className="nudge-icon">
                    <KeyRound size={16} />
                  </span>
                  <span>
                    <strong>Bring the models you already love.</strong>
                    <small>
                      Connect an API key from Claude, OpenAI, Gemini, and more.
                    </small>
                  </span>
                  <ArrowRight size={16} />
                </button>
              )}
              <section className="expert-section">
                <div className="expert-section-heading">
                  <h2>
                    {view === "library"
                      ? "Find a thinking partner"
                      : "Or follow a little curiosity"}
                  </h2>
                  {view === "home" ? (
                    <button onClick={openLibrary}>
                      Explore all experts <ArrowRight size={13} />
                    </button>
                  ) : (
                    <span>Or type any role above</span>
                  )}
                </div>
                {view === "library" && (
                  <div className="gallery-filters">
                    {[
                      "All experts",
                      "Learn",
                      "Explore",
                      "Build",
                      "Create",
                      "Care",
                      "Grow",
                    ].map((v) => (
                      <button
                        key={v}
                        className={filter === v ? "active" : ""}
                        aria-pressed={filter === v}
                        onClick={() => setFilter(v)}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                )}
                <div className="preset-grid">
                  {PRESETS.filter((p) =>
                    view === "home"
                      ? PRESETS.indexOf(p) < 8
                      : filter === "All experts" || p.category === filter,
                  ).map((p) => (
                    <button
                      key={p.role}
                      className="preset-card"
                      onClick={() => {
                        setRole(p.role);
                        setFocus("");
                        startExpert(p.role, "");
                      }}
                      disabled={compiling}
                    >
                      <span
                        className="preset-icon"
                        style={{ background: p.color }}
                      >
                        <p.icon size={21} />
                      </span>
                      <strong>{p.role}</strong>
                      <small>{p.note}</small>
                      <ArrowRight className="preset-arrow" size={14} />
                    </button>
                  ))}
                </div>
              </section>
              <div className="home-foot">
                <ShieldCheck size={12} />
                <span>API keys stay encrypted. Your expert stays yours.</span>
              </div>
            </div>
          ) : (
            <div className="conversation-layout">
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
                <div ref={bottom} />
              </div>
              <div className="composer-zone">
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
                        disabled={busy || switching || compiling}
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
                          !draft.trim() &&
                          !attachments.length &&
                          !documents.length
                        }
                        aria-label="Send message"
                      >
                        <ArrowUp size={20} />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="composer-disclaimer">
                  {usage
                    ? `${usage.inputTokens.toLocaleString()} input · ${usage.outputTokens.toLocaleString()} output tokens · `
                    : ""}
                  AI can make mistakes. A thoughtful second look always helps.
                </div>
                <input
                  hidden
                  ref={upload}
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
      <Connections
        open={connectOpen}
        onOpenChange={setConnectOpen}
        connections={data?.connections || []}
        onSaved={async (c) => {
          await refresh();
          const current = contextRef.current;
          const next = selectionAfterConnectionSave(
            { connectionId: current.connectionId, modelId: current.modelId },
            c,
            !!current.chatId,
          );
          if (!current.chatId) {
            clearFiles();
            setConnectionId(next.connectionId);
            setModelId(next.modelId);
          }
        }}
        onRemoved={async (id) => {
          if (id === contextRef.current.connectionId) {
            clearFiles();
            if (!contextRef.current.chatId) {
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
              autoFocus
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
        open={personaEditOpen}
        onOpenChange={setPersonaEditOpen}
        title="A little more you."
        description="Give this expert a new direction. We’ll start a fresh conversation and keep this one safe."
      >
        <form
          className="simple-form"
          onSubmit={(e) => {
            e.preventDefault();
            startExpert();
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
        title="Your workspace"
        description="A few things to make yourself at home."
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
              <small>Manage your encrypted provider connections.</small>
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
          <section className="settings-note">
            <ShieldCheck size={19} />
            <p>
              Provider API keys are encrypted on the server and only their last
              four characters are displayed. Your role’s instructions are
              prepared privately. API usage is billed by your provider; chat
              subscriptions aren’t API keys.
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
          <a className="signout-link" href="/api/auth/signout">
            <LogOut size={14} />
            Sign out
          </a>
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

function Connections({
  open,
  onOpenChange,
  connections,
  onSaved,
  onRemoved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  connections: Connection[];
  onSaved: (c: Connection) => Promise<void>;
  onRemoved: (id: string) => Promise<void>;
}) {
  const [provider, setProvider] = useState("openai"),
    [key, setKey] = useState(""),
    [baseUrl, setBaseUrl] = useState(""),
    [name, setName] = useState(""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [deleting, setDeleting] = useState("");
  useEffect(() => {
    if (!open) {
      setKey("");
      setError("");
    }
  }, [open]);
  const info = PROVIDERS.find((p) => p.id === provider)!;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const c = await api<Connection>("/api/connections", "POST", {
        provider,
        apiKey: key,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(provider === "compatible" ? { baseUrl } : {}),
      });
      setKey("");
      await onSaved(c);
      toast.success(
        `${c.name} connected. ${c.models.length} models available.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!saving) onOpenChange(v);
      }}
      title="Bring your intelligence."
      description="Your favorite models, together in one thoughtful space."
      className="connections-dialog"
    >
      <div className="connections-body">
        <div className="provider-picker">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              className={provider === p.id ? "active" : ""}
              aria-pressed={provider === p.id}
              onClick={() => {
                setProvider(p.id);
                setKey("");
                setError("");
              }}
              disabled={saving}
            >
              <span className={`provider-symbol ${p.id}`}>{p.symbol}</span>
              <span>
                <strong>{p.name}</strong>
                <small>{p.description}</small>
              </span>
              <ChevronRight size={13} />
            </button>
          ))}
        </div>
        <div className="connection-form-area">
          <form onSubmit={submit}>
            <div className="provider-form-title">
              <span className={`provider-symbol large ${provider}`}>
                {info.symbol}
              </span>
              <div>
                <h3>Connect {info.name}</h3>
                <p>A direct connection to your provider.</p>
              </div>
            </div>
            <label htmlFor="api-key">API key</label>
            <input
              id="api-key"
              type="password"
              autoComplete="new-password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={
                provider === "compatible"
                  ? "Your endpoint’s API key"
                  : "Paste your API key"
              }
              required
              maxLength={4096}
              disabled={saving}
            />
            {info.link && (
              <a
                className="get-key-link"
                href={info.link}
                target="_blank"
                rel="noopener noreferrer"
              >
                Get an API key <ExternalLink size={11} />
              </a>
            )}
            {provider === "compatible" && (
              <>
                <label htmlFor="base-url">API base URL</label>
                <input
                  id="base-url"
                  type="url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://openrouter.ai/api/v1"
                  required
                  maxLength={400}
                />
                <p className="field-help">
                  An OpenAI-compatible /v1 endpoint. Local model addresses
                  require the server’s local-model setting.
                </p>
              </>
            )}
            <label htmlFor="connection-name">
              Connection name <span>optional</span>
            </label>
            <input
              id="connection-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`My ${info.name} account`}
              maxLength={80}
            />
            {error && (
              <div className="form-error" role="alert">
                <AlertCircle size={15} />
                {error}
              </div>
            )}
            <Button
              type="submit"
              disabled={saving || !key.trim()}
              className="connect-submit"
            >
              {saving ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <KeyRound size={15} />
              )}{" "}
              {saving ? "Validating & finding models…" : "Validate & connect"}
            </Button>
            <div className="key-privacy">
              <ShieldCheck size={14} />
              <p>
                Encrypted before storage. Never returned to your browser after
                saving.
              </p>
            </div>
          </form>
        </div>
      </div>
      {connections.length > 0 && (
        <div className="saved-connections">
          <h4>
            YOUR CONNECTIONS <span>{connections.length}</span>
          </h4>
          {connections.map((c) => (
            <div key={c.id}>
              <span className={`provider-symbol ${c.provider}`}>
                {PROVIDERS.find((p) => p.id === c.provider)?.symbol}
              </span>
              <span>
                <strong>{c.name}</strong>
                <small>
                  {c.models.length} models · •••• {c.last4}
                </small>
              </span>
              <span className="connected-badge">
                <Check size={10} />
                Connected
              </span>
              <button
                className="icon-button"
                aria-label={`Disconnect ${c.name}`}
                disabled={!!deleting || saving}
                onClick={async () => {
                  setDeleting(c.id);
                  try {
                    await api(`/api/connections/${c.id}`, "DELETE");
                    await onRemoved(c.id);
                    toast("Provider disconnected. Its key was removed.");
                  } catch (e) {
                    toast.error((e as Error).message);
                  } finally {
                    setDeleting("");
                  }
                }}
              >
                {deleting === c.id ? (
                  <LoaderCircle className="spin" size={14} />
                ) : (
                  <Trash2 size={14} />
                )}
              </button>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            disabled={saving || !!deleting}
            onClick={() => onOpenChange(false)}
          >
            Done <ArrowRight size={14} />
          </Button>
        </div>
      )}
    </Dialog>
  );
}
