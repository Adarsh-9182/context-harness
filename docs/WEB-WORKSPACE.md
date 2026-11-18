# Harness web workspace

The [web workspace](https://adarshbhardwaj.space/harness/app) runs in a browser. Write a goal, add instructions and references, and describe the output. You can add a profession from the shared catalog, save a brief in this browser, and copy the resulting prompt. Open ChatGPT or Claude and paste it there to get a reply. Harness does not receive your provider credentials or send the prompt when you open a provider link.

## Move a brief between versions

Choose **Export brief** in either version, then **Import brief** in the destination workspace. The file opens as a new draft. Review it and save when ready. Both versions use the same JSON format for the five user-authored fields. The file contains the text you included in your brief.

## Build and deploy

Run `npm run build:web` with Node.js 24 or later. The build writes the page and hashed assets to `.local/web-release` and prints the exact file list. The professions list and field limits come from the same source as the native app. The existing Vercel portfolio serves the generated `harness/app.html` at `/harness/app`. When publishing from that repository, copy the generated files by their relative paths and keep the release page link at `/harness`.

The browser app uses browser storage and local file selection. Direct account sign-in and streaming inside Harness are available in the native app. A remotely hosted plan integration needs a supported provider authorization path. [ChatGPT plan usage](https://developers.openai.com/siwc/token-sharing-open-source) · [Claude Code authentication terms](https://code.claude.com/docs/en/legal-and-compliance)
