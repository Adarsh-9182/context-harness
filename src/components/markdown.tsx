"use client";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Check, Copy } from "lucide-react";
import { useUI } from "@/lib/store";
import { safeExternalImageUrl } from "@/lib/client-state";
import { toast } from "sonner";

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [html, setHtml] = useState(""),
    [copied, setCopied] = useState(false),
    theme = useUI((s) => s.theme);
  useEffect(() => {
    let active = true;
    setHtml("");
    import("shiki")
      .then(async ({ codeToHtml }) => {
        try {
          const result = await codeToHtml(code, {
            lang: language || "text",
            theme: theme === "dark" ? "github-dark" : "github-light",
          });
          if (active) setHtml(result);
        } catch {
          if (active) setHtml("");
        }
      })
      .catch(() => {
        if (active) setHtml("");
      });
    return () => {
      active = false;
    };
  }, [code, language, theme]);
  return (
    <div className="code-block">
      <div className="code-toolbar">
        <span>{language || "text"}</span>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            } catch {
              toast.error(
                "Clipboard access is unavailable. Select the code to copy it manually.",
              );
            }
          }}
          aria-label="Copy code"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}{" "}
          {copied ? "Copied" : "Copy code"}
        </button>
      </div>
      {html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre>
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
export function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ children, className, node, ...props }) => {
            const code = String(children).replace(/\n$/, "");
            const lang = /language-([^\s]+)/.exec(className || "")?.[1] || "";
            return lang || String(children).includes("\n") ? (
              <CodeBlock code={code} language={lang} />
            ) : (
              <code className="inline-code" {...props}>
                {children}
              </code>
            );
          },
          table: ({ children }) => (
            <div className="table-scroll">
              <table>{children}</table>
            </div>
          ),
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ src, alt }) => {
            const url = safeExternalImageUrl(src);
            return (
              <span className="remote-image-notice">
                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                  >
                    Open external image{alt ? `: ${alt}` : ""} (
                    {new URL(url).hostname})
                  </a>
                ) : (
                  <span>Image omitted{alt ? `: ${alt}` : ""}</span>
                )}
                <small>
                  External images load only when you choose to open them.
                </small>
              </span>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
