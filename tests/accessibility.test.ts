import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const css = readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);
function variables(selector: RegExp) {
  const result: Record<string, string> = {};
  for (const match of css.matchAll(selector)) {
    for (const value of match[1].matchAll(
      /--([\w-]+):\s*(#[\da-f]{3,6})(?:;|})?/gi,
    ))
      result[value[1]] = value[2];
  }
  return result;
}
function luminance(hex: string) {
  const value = hex.replace("#", "");
  const expanded =
    value.length === 3
      ? value
          .split("")
          .map((v) => v + v)
          .join("")
      : value;
  const rgb = expanded
    .match(/../g)!
    .map((v) => parseInt(v, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
describe("accessible theme tokens", () => {
  it("keeps normal-size foreground, muted, and subtle text at AA contrast on every app surface", () => {
    const base = variables(/:root\s*\{([^}]*)\}/g);
    const dark = {
      ...base,
      ...variables(/html\[data-theme=["\x27]?dark["\x27]?\]\s*\{([^}]*)\}/g),
    };
    for (const theme of [base, dark])
      for (const foreground of ["text", "muted", "subtle"])
        for (const surface of ["bg", "panel", "sidebar", "accent-soft"])
          expect(
            contrast(theme[foreground], theme[surface]),
            `${foreground} on ${surface}`,
          ).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps action text and input boundaries distinguishable in both themes", () => {
    const base = variables(/:root\s*\{([^}]*)\}/g);
    const dark = {
      ...base,
      ...variables(/html\[data-theme=["\x27]?dark["\x27]?\]\s*\{([^}]*)\}/g),
    };
    for (const theme of [base, dark]) {
      for (const surface of ["bg", "panel", "sidebar", "accent-soft"])
        expect(contrast(theme.accent, theme[surface])).toBeGreaterThanOrEqual(
          4.5,
        );
      for (const surface of ["bg", "panel"])
        expect(
          contrast(theme["control-border"], theme[surface]),
        ).toBeGreaterThanOrEqual(3);
    }
    expect(contrast("#ffffff", base.accent)).toBeGreaterThanOrEqual(4.5);
  });
});
