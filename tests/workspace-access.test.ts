import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspaceAccess } from "../src/components/harness-app";

describe("workspace account controls", () => {
  it("labels an explicit local development workspace without offering an ineffective sign-out", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceAccess, { development: true }),
    );
    expect(html).toContain("Local development workspace");
    expect(html).toContain("No account is signed in here.");
    expect(html).not.toContain("/api/auth/signout");
    expect(html).not.toContain("Sign out");
  });

  it("preserves the Auth.js sign-out control for authenticated workspaces", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceAccess, { development: false }),
    );
    expect(html).toContain('href="/api/auth/signout"');
    expect(html).toContain("Sign out");
    expect(html).not.toContain("No account is signed in here.");
  });
});
