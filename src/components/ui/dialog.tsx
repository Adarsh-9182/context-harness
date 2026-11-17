"use client";
import * as React from "react";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const contentRef = React.useRef<HTMLDivElement>(null);
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="dialog-overlay" />
        <D.Content
          ref={contentRef}
          className={cn("dialog-content", className)}
          onOpenAutoFocus={(event) => {
            const target = contentRef.current?.querySelector<HTMLElement>("[data-dialog-autofocus]");
            if (target) {
              event.preventDefault();
              target.focus();
            }
          }}
        >
          <div className="dialog-heading">
            <div>
              <D.Title>{title}</D.Title>
              {description ? (
                <D.Description>{description}</D.Description>
              ) : (
                <D.Description className="sr-only">{title}</D.Description>
              )}
            </div>
            <D.Close className="icon-button" aria-label="Close dialog">
              <X size={18} />
            </D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
