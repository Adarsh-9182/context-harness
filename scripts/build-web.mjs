import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROFESSION_GROUPS } from "../src/lib/professions.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = process.argv[2] ? resolve(process.argv[2]) : join(root, ".local", "web-release");
const assets = join(output, "assets");
await Promise.all([mkdir(assets, { recursive: true }), mkdir(join(output, "harness"), { recursive: true })]);

async function asset(label, extension, source) {
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 12);
  const filename = `harness-${label}-${hash}.${extension}`;
  await writeFile(join(assets, filename), source);
  return filename;
}

const [template, css, client, core] = await Promise.all([
  readFile(join(root, "web", "studio.html"), "utf8"),
  readFile(join(root, "web", "studio.css"), "utf8"),
  readFile(join(root, "web", "studio.mjs"), "utf8"),
  readFile(join(root, "src", "lib", "context-portable.mjs"), "utf8"),
]);
const professions = PROFESSION_GROUPS.flatMap(({ roles }) => roles);
const [cssFile, coreFile, rolesFile] = await Promise.all([
  asset("studio", "css", css),
  asset("portable-context", "mjs", core),
  asset("professions", "mjs", `export const PROFESSIONS = ${JSON.stringify(professions)};\n`),
]);
const scriptFile = await asset("studio", "mjs", client
  .replaceAll("./context-core.mjs", `./${coreFile}`)
  .replaceAll("./professions.mjs", `./${rolesFile}`));

const html = template.replaceAll("__STUDIO_CSS__", `/assets/${cssFile}`)
  .replaceAll("__STUDIO_JS__", `/assets/${scriptFile}`)
  .replaceAll("__PROFESSION_COUNT__", String(professions.length));
await writeFile(join(output, "harness", "app.html"), html);
console.log(JSON.stringify({ output, files: ["harness/app.html", ...[cssFile, scriptFile, coreFile, rolesFile].map((name) => `assets/${name}`)] }, null, 2));
