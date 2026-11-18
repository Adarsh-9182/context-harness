# Harness web workspace

The standalone web app opens directly to the context editor. Write a goal, give it a name, and pick a profession from the shared catalog. Open **More context** to add instructions, references, or an output format. Save the brief in your browser or copy the prompt and use it on the ChatGPT or Claude site.

## Move a brief between versions

Choose **Export brief** in the source workspace, then **Import brief** in the destination. The file opens as a new draft. Review it and save when ready. Both versions use the same JSON format for the five user-authored fields. Browser saves are specific to the site where you created them, so use the same transfer steps if moving to a new domain.

## Build and deploy

Run `npm run build:web` with Node.js 24 or later. The build writes `index.html` and hashed assets to `.local/web-app` and prints the file list. The professions list and field limits come from the same source as the local app. Serve the output directory as a static site over HTTPS. The root `vercel.json` builds and serves the web app from this repository as a standalone Vercel project.

The browser app uses browser storage and local file selection. Direct account sign-in and streaming inside Harness are available in the native app. A remotely hosted plan integration needs a supported provider authorization path. [ChatGPT plan usage](https://developers.openai.com/siwc/token-sharing-open-source) · [Claude Code authentication terms](https://code.claude.com/docs/en/legal-and-compliance)
