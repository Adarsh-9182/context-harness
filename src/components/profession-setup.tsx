"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, BriefcaseBusiness, Link2, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { PROFESSION_BRIEF_LIMITS, type ProfessionBrief } from "@/lib/profession-brief";
import styles from "./profession-setup.module.css";

type Props = {
  role: string;
  focus: string;
  open: boolean;
  busy: boolean;
  canStart?: boolean;
  modelLabel?: string;
  error?: string;
  onOpenChange: (open: boolean) => void;
  onStart: (brief?: ProfessionBrief) => void;
};

const questions = [
  { field: "goal", label: "Goal", placeholder: "What do you want to accomplish?", rows: 2 },
  { field: "details", label: "Relevant details", placeholder: "Add background, constraints, or reference notes.", rows: 3 },
  { field: "outputFormat", label: "Expected output", placeholder: "For example, a checklist, a draft, or a comparison table.", rows: 2 },
] as const;

export function ProfessionSetup(props: Props) {
  return <ProfessionQuestions key={props.role} {...props} />;
}

function ProfessionQuestions({ role, focus, open, busy, canStart = true, modelLabel, error, onOpenChange, onStart }: Props) {
  const [draft, setDraft] = useState<ProfessionBrief>({ goal: "", details: "", outputFormat: "" });
  const action = canStart ? { icon: ArrowRight, label: "Start chat" } : { icon: Link2, label: "Connect a model" };
  const ActionIcon = busy ? LoaderCircle : action.icon;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const brief = {
      goal: draft.goal.trim(),
      details: draft.details.trim(),
      outputFormat: draft.outputFormat.trim(),
    };
    onStart(brief.goal || brief.details || brief.outputFormat ? brief : undefined);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { if (!busy) onOpenChange(next); }}
      title="Before you start"
      description="Give your expert a little direction. Answer any of these questions or go straight to chat."
    >
      <form className={styles.form} onSubmit={submit} aria-busy={busy}>
        <div className={styles.role} tabIndex={-1} data-dialog-autofocus>
          <span className={styles.roleIcon}><BriefcaseBusiness size={17} aria-hidden="true" /></span>
          <div>
            <strong>{role}</strong>
            {focus && <p>{focus}</p>}
            {modelLabel && <p>Model · {modelLabel}</p>}
          </div>
        </div>

        <fieldset className={styles.questions} disabled={busy}>
          <legend className="sr-only">Optional setup questions</legend>
          {questions.map(({ field, label, placeholder, rows }) => (
            <label key={field} className={styles.question}>
              <span>{label}</span>
              <textarea
                rows={rows}
                maxLength={PROFESSION_BRIEF_LIMITS[field]}
                placeholder={placeholder}
                value={draft[field]}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setDraft((current) => ({ ...current, [field]: value }));
                }}
              />
            </label>
          ))}
        </fieldset>

        {error && <p className={`management-error ${styles.error}`} role="alert">{error}</p>}

        <div className={styles.actions}>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => onStart()}>
            Skip questions
          </Button>
          <Button type="submit" disabled={busy}>
            <ActionIcon className={busy ? "spin" : undefined} size={16} aria-hidden="true" />
            {busy ? "Preparing chat…" : action.label}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
