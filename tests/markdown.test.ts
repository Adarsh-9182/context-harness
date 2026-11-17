import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { Markdown } from "../src/components/markdown";

const render = (content: string) =>
  renderToStaticMarkup(createElement(Markdown, { content }));
describe("safe rich chat rendering", () => {
  it("never automatically loads an image URL supplied by model markdown", () => {
    const html = render("![A diagram](https://example.org/private-query.png)");
    expect(html).not.toContain("<img");
    expect(html).toContain("Open external image");
    expect(html).toContain("https://example.org/private-query.png");
    expect(html).toContain("noreferrer");
  });
  it("keeps raw HTML and JavaScript links inert", () => {
    const html = render(
      "<script>alert(1)</script>\n\n[bad](javascript:alert(1))",
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
  });
  it("renders math, tables, and fenced code as usable rich content", () => {
    const html = render(
      'A formula: $x^2 + y^2$.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```python\nprint("hello")\n```',
    );
    expect(html).toContain("katex");
    expect(html).toContain("<table>");
    expect(html).toContain("Copy code");
    expect(html).toContain("print(");
  });
});
