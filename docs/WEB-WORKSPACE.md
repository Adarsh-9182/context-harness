# Harness web workspace

The [web app](https://context-harness-web.vercel.app/) uses the same Harness interface as the local app. Browse professions, answer optional setup questions, and save reusable briefs in Context Builder. With the local workspace linked, it also shows your existing chats and streams new replies from your connected models.

## Link your workspace

1. Run Harness on the same computer with `npm start` and open `http://127.0.0.1:4318/`. Connect ChatGPT or Claude from **Your models**.
2. In the web app, choose **Connect a model → Link local Harness**. Choose **Allow access** in the local window, then return to the web tab.
3. Keep the link window open. Close it or choose **Unlink local Harness** when you're done. If you just connected another account locally, choose **Refresh models** in the web app.

During an approved link, the web tab requests workspace data through the local window. Provider sign-in, credentials, model requests, and linked conversation storage stay with local Harness. The link ends when either tab closes. The hosted app serves the interface and its static assets.

## Move briefs between workspaces

Without a link, briefs are saved in this browser. Briefs from the earlier editor on this same domain appear in Context Builder. While linked, the library uses your local Harness workspace. Choose **Export brief** in the source workspace and **Import brief** in the destination to move a copy.

## Build and verify

Run `npm run build:web` to export the shared Next.js interface to `.local/web-shell`. The web build includes only static pages and assets. The root `vercel.json` serves that output. Run `npm run test:e2e` after building to test the browser workspace and the local link.
