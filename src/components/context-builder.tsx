"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Check, Layers, Link2, LoaderCircle, Paperclip, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { appendContextReferences, CONTEXT_REFERENCE_ACCEPT } from "@/lib/context-reference-import";
import { CONTEXT_LIMITS, type ContextBrief, type ContextInput, type ContextSummary } from "@/lib/contexts";
import "@/app/context-builder.css";

const emptyContext: ContextInput = {
  name: "",
  goal: "",
  instructions: "",
  references: "",
  outputFormat: "",
};

const exampleContext: ContextInput = {
  name: "Research synthesis",
  goal: "Help me answer a research question using the notes and excerpts I provide.",
  instructions: "Separate evidence from interpretation. Flag missing information and compare sources when they disagree.",
  references: "",
  outputFormat: "A short answer, supporting evidence with source names, and open questions.",
};

type Props = {
  active: boolean;
  request: <T>(path: string, method?: string, body?: unknown) => Promise<T>;
  onRun: (id: string, goal: string) => Promise<boolean>;
  onConnect?: () => void;
  onBack?: () => void;
  modelName?: string;
  busy?: boolean;
  requestedContextId?: string;
};

type Operation = "opening" | "saving" | "starting" | "importing";

function contextInput(brief: ContextBrief): ContextInput {
  const { name, goal, instructions, references, outputFormat } = brief;
  return { name, goal, instructions, references, outputFormat };
}

function contextSummary(brief: ContextBrief): ContextSummary {
  const { id, name, goal, revision, updatedAt } = brief;
  return { id, name, goal, revision, updatedAt };
}

export function ContextBuilder({ active, request, onRun, onConnect, onBack, modelName, busy = false, requestedContextId }: Props) {
  const [contexts, setContexts] = useState<ContextSummary[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState("");
  const [draft, setDraft] = useState<ContextInput>(emptyContext);
  const [saved, setSaved] = useState<ContextBrief | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [error, setError] = useState("");
  const [referenceFeedback, setReferenceFeedback] = useState<{ success: boolean; message: string }>();
  const [pendingSelection, setPendingSelection] = useState<{ id?: string } | null>(null);
  const listRequest = useRef(0);
  const lastLibraryRead = useRef(0);
  const handledRequest = useRef<string | undefined>(undefined);
  const operationPending = useRef(false);
  const builderHeading = useRef<HTMLHeadingElement>(null);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const referenceInput = useRef<HTMLInputElement>(null);
  const keepEditingButton = useRef<HTMLButtonElement>(null);

  const readContexts = useCallback(async () => {
    const attempt = ++listRequest.current;
    setLibraryLoading(true);
    setLibraryError("");
    try {
      const result = await request<ContextSummary[]>("/api/contexts");
      if (attempt !== listRequest.current) return;
      lastLibraryRead.current = Date.now();
      setContexts(current => {
        const merged = new Map(current.map(context => [context.id, context]));
        for (const context of result) {
          if ((merged.get(context.id)?.revision ?? 0) <= context.revision) merged.set(context.id, context);
        }
        return [...merged.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      });
    } catch (cause) {
      if (attempt === listRequest.current) {
        lastLibraryRead.current = 0;
        setLibraryError((cause as Error).message);
      }
    } finally {
      if (attempt === listRequest.current) setLibraryLoading(false);
    }
  }, [request]);

  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => builderHeading.current?.focus());
    if (Date.now() - lastLibraryRead.current > 30_000) void readContexts();
    return () => cancelAnimationFrame(frame);
  }, [active, readContexts]);

  useEffect(() => {
    if (active && pendingSelection) keepEditingButton.current?.focus();
  }, [active, pendingSelection]);

  const baseline = saved ? contextInput(saved) : emptyContext;
  const dirty = (Object.keys(draft) as Array<keyof ContextInput>).some(key => draft[key] !== baseline[key]);
  const nameValid = draft.name.trim().length >= 2;
  const goalValid = draft.goal.trim().length >= 4;
  const valid = nameValid && goalValid;
  const locked = busy || operation !== null || pendingSelection !== null;

  function changeField(key: keyof ContextInput, value: string) {
    setDraft(previous => ({ ...previous, [key]: value }));
    setError("");
    if (key === "references") setReferenceFeedback(undefined);
  }

  const perform = useCallback(async (next: Operation, task: () => Promise<void>) => {
    if (busy || operationPending.current) return;
    operationPending.current = true;
    setOperation(next);
    setError("");
    try {
      await task();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setOperation(null);
      operationPending.current = false;
    }
  }, [busy]);

  const showContext = useCallback((id?: string) => {
    setPendingSelection(null);
    setError("");
    setReferenceFeedback(undefined);
    if (!id) {
      setSaved(null);
      setDraft(emptyContext);
      requestAnimationFrame(() => nameInput.current?.focus());
      return;
    }
    void perform("opening", async () => {
      const brief = await request<ContextBrief>(`/api/contexts/${encodeURIComponent(id)}`);
      setSaved(brief);
      setDraft(contextInput(brief));
      requestAnimationFrame(() => editorHeading.current?.focus());
    });
  }, [perform, request]);

  const selectContext = useCallback((id?: string) => {
    if (dirty) setPendingSelection({ id });
    else showContext(id);
  }, [dirty, showContext]);

  useEffect(() => {
    if (!active || !requestedContextId) {
      handledRequest.current = undefined;
      return;
    }
    if (locked || handledRequest.current === requestedContextId) return;
    handledRequest.current = requestedContextId;
    if (requestedContextId !== saved?.id || !dirty) selectContext(requestedContextId);
  }, [active, dirty, locked, requestedContextId, saved?.id, selectContext]);

  function importReferences(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (locked || !files.length) return;
    setReferenceFeedback(undefined);
    void perform("importing", async () => {
      try {
        const references = await appendContextReferences(draft.references, files);
        setDraft(previous => ({ ...previous, references }));
        setReferenceFeedback({ success: true, message: `Added ${files.length} ${files.length === 1 ? "file" : "files"}.` });
      } catch (cause) {
        setReferenceFeedback({ success: false, message: (cause as Error).message });
      }
    });
  }

  async function saveDraft(): Promise<ContextBrief> {
    if (saved && !dirty) return saved;
    const brief = saved
      ? await request<ContextBrief>(`/api/contexts/${encodeURIComponent(saved.id)}`, "PATCH", draft)
      : await request<ContextBrief>("/api/contexts", "POST", draft);
    setSaved(brief);
    setDraft(contextInput(brief));
    setContexts(previous => [contextSummary(brief), ...previous.filter(item => item.id !== brief.id)]);
    return brief;
  }

  function startChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || locked) return;
    void perform("starting", async () => {
      const brief = await saveDraft();
      await onRun(brief.id, brief.goal);
    });
  }

  return (
    <section className="context-builder" aria-labelledby="context-builder-heading" hidden={!active}>
      {onBack && (
        <button type="button" className="context-builder-back" onClick={onBack} disabled={operation !== null || busy}>
          <ArrowLeft size={15} /> Back to conversation
        </button>
      )}
      <header className="context-builder-intro">
        <span className="context-builder-mark" aria-hidden="true"><Layers size={22} /></span>
        <div>
          <h1 id="context-builder-heading" ref={builderHeading} tabIndex={-1}>Context builder</h1>
          <p>Define what the model should do, what it should know, and what it should return.</p>
        </div>
      </header>
      <div className="context-builder-grid">
        <section className={`context-panel context-library${!libraryLoading && !libraryError && !contexts.length ? " context-library-empty" : ""}`} aria-labelledby="saved-contexts-heading">
          <div className="context-library-heading">
            <h2 id="saved-contexts-heading">Saved contexts</h2>
            <Button type="button" variant="outline" size="sm" disabled={locked} onClick={() => selectContext()}>
              <Plus size={14} /> New context
            </Button>
          </div>
          {libraryError && (
            <div className="context-library-state">
              <p role="alert">{libraryError}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void readContexts()}>Retry</Button>
            </div>
          )}
          {libraryLoading && !contexts.length && <p className="context-library-state" role="status">Loading contexts…</p>}
          {!libraryLoading && !libraryError && !contexts.length && (
            <div className="context-library-state">
              <BookOpen size={20} aria-hidden="true" />
              <p>Saved contexts will appear here.</p>
            </div>
          )}
          {!!contexts.length && (
            <ul className="context-list">
              {contexts.map(context => (
                <li key={context.id}>
                  <button type="button" disabled={locked} aria-current={saved?.id === context.id ? "true" : undefined}
                    onClick={() => selectContext(context.id)}>
                    <Layers size={15} aria-hidden="true" />
                    <span><strong>{context.name}</strong><small>{context.goal}</small></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <form className="context-panel context-editor" onSubmit={startChat} aria-labelledby="context-editor-heading">
          <div className="context-editor-heading">
            <div>
              <h2 id="context-editor-heading" ref={editorHeading} tabIndex={-1}>{saved ? "Edit context" : "New context"}</h2>
              <p>Use the same brief in multiple conversations.</p>
            </div>
            <div className="context-editor-state" role="status">
              {operation === "opening" ? "Opening context…" : operation === "saving" ? "Saving…" : operation === "starting" ? "Starting chat…" : operation === "importing" ? "Reading references…" : (
                dirty ? "Unsaved changes" : saved ? <><Check size={14} /> Saved · revision {saved.revision}</> : null
              )}
            </div>
          </div>
          {pendingSelection && (
            <div className="context-editor-alert" role="group" aria-label="Discard unsaved edits?">
              <p>Switching contexts will discard your unsaved edits.</p>
              <div>
                <Button ref={keepEditingButton} type="button" variant="ghost" size="sm" onClick={() => {
                  setPendingSelection(null);
                  requestAnimationFrame(() => editorHeading.current?.focus());
                }}>Keep editing</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => showContext(pendingSelection.id)}>Discard edits</Button>
              </div>
            </div>
          )}
          <fieldset className="context-fields" disabled={locked}>
            <legend className="sr-only">Context details</legend>
            <div className="context-field context-field-wide">
              <label htmlFor="context-name">Name <span aria-hidden="true">Required</span></label>
              <input id="context-name" ref={nameInput} required minLength={2} maxLength={CONTEXT_LIMITS.name}
                aria-invalid={!!draft.name && !nameValid}
                aria-describedby={draft.name && !nameValid ? "context-name-note" : undefined}
                value={draft.name} onChange={event => changeField("name", event.target.value)} placeholder="e.g. Research synthesis" />
              {draft.name && !nameValid && <p id="context-name-note" className="context-field-note">Use at least 2 characters.</p>}
            </div>
            <div className="context-field context-field-wide">
              <label htmlFor="context-goal">Goal <span aria-hidden="true">Required</span></label>
              <textarea id="context-goal" required rows={3} minLength={4} maxLength={CONTEXT_LIMITS.goal}
                aria-invalid={!!draft.goal && !goalValid}
                aria-describedby={draft.goal && !goalValid ? "context-goal-note" : undefined}
                value={draft.goal} onChange={event => changeField("goal", event.target.value)} placeholder="What should the model help you accomplish?" />
              {draft.goal && !goalValid && <p id="context-goal-note" className="context-field-note">Use at least 4 characters.</p>}
            </div>
            <div className="context-field">
              <label htmlFor="context-instructions">Instructions <span aria-hidden="true">Optional</span></label>
              <textarea id="context-instructions" rows={3} maxLength={CONTEXT_LIMITS.instructions}
                value={draft.instructions} onChange={event => changeField("instructions", event.target.value)} placeholder="How should it approach the work?" />
            </div>
            <div className="context-field">
              <label htmlFor="context-output">Output format <span aria-hidden="true">Optional</span></label>
              <textarea id="context-output" rows={3} maxLength={CONTEXT_LIMITS.outputFormat}
                value={draft.outputFormat} onChange={event => changeField("outputFormat", event.target.value)} placeholder="e.g. A summary, a comparison table, and a recommendation" />
            </div>
            <div className="context-field context-field-wide">
              <div className="context-reference-heading">
                <label htmlFor="context-references">Reference material <span aria-hidden="true">Optional</span></label>
                <Button type="button" variant="outline" size="sm" onClick={() => referenceInput.current?.click()}
                  aria-describedby="context-reference-formats"><Paperclip size={14} /> Add text files</Button>
                <input ref={referenceInput} hidden type="file" multiple accept={CONTEXT_REFERENCE_ACCEPT}
                  aria-label="Add context reference files" onChange={importReferences} />
              </div>
              <textarea id="context-references" rows={4} maxLength={CONTEXT_LIMITS.references} aria-describedby="context-references-note context-reference-count"
                value={draft.references} onChange={event => changeField("references", event.target.value)} placeholder="Paste notes, examples, or background the model should use." />
              <div className="context-reference-meta">
                <p id="context-references-note" className="context-field-note">Saved references go to the selected model when you chat.</p>
                <p id="context-reference-count" className="context-field-note">{draft.references.length.toLocaleString()} / {CONTEXT_LIMITS.references.toLocaleString()} characters</p>
              </div>
              <p id="context-reference-formats" className="sr-only">Choose TXT, Markdown, CSV, or JSON files.</p>
              {referenceFeedback && <p role={referenceFeedback.success ? "status" : "alert"} className={referenceFeedback.success ? "context-field-note" : "management-error context-reference-error"}>{referenceFeedback.message}</p>}
            </div>
          </fieldset>
          {!saved && !dirty && (
            <button type="button" className="context-example" disabled={locked} onClick={() => {
              setDraft(exampleContext);
              nameInput.current?.focus();
            }}>Try a research example <ArrowRight size={14} /></button>
          )}
          {error && <p className="context-editor-alert" role="alert">{error}</p>}
          <footer className="context-editor-footer">
            <p>{modelName ? <>Model <strong>{modelName}</strong></> : "Connect a model to start a chat."}</p>
            <div className="context-editor-actions">
              <Button type="button" variant="outline" disabled={locked || !valid || !dirty}
                onClick={() => void perform("saving", async () => { await saveDraft(); })}>
                {operation === "saving" && <LoaderCircle size={15} className="spin" />}
                Save context
              </Button>
              {!modelName && onConnect ? (
                <Button type="button" disabled={locked} onClick={onConnect}><Link2 size={15} /> Connect a model</Button>
              ) : (
                <Button type="submit" disabled={locked || !valid}>
                  {operation === "starting" ? <LoaderCircle size={15} className="spin" /> : <ArrowRight size={15} />} Start chat
                </Button>
              )}
            </div>
          </footer>
        </form>
      </div>
    </section>
  );
}
