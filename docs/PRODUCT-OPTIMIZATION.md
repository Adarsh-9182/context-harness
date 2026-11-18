# Harness product audit

Harness is for people who repeat model-assisted work, such as analysts turning notes into a brief, product teams comparing decisions, and learners reusing the same study setup. Its strongest workflow is a local, versioned context that works with both ChatGPT and Claude. The baseline passed 139 unit and integration tests and 19 desktop and mobile browser workflows. The app already preserves the context version across model switches and supports custom roles, reusable briefs, and transcript export.

The baseline exposed a gap between setup and results. A saved goal carried into the system context, but the user arrived at a blank composer. The chat context badge opened the general editor, where it could show another brief. Streaming moved the viewport while reading older messages, and failures could leave an already-saved question looking like an unsent draft. Every finished reply also triggered full transcript and workspace reloads.

ChatGPT Projects combines reusable instructions, uploaded sources, and project memory. Claude Projects combines project instructions with a knowledge base, and its paid plans support retrieval as the knowledge base grows. Harness can differentiate through inspectable, versioned context across both providers. Its immediate opportunity is to make the saved brief easy to reuse, verify, and recover. [ChatGPT Projects](https://help.openai.com/en/articles/10169521-projects-in-chatgpt) · [Claude Projects](https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects)

## Ranked improvements

| Rank | Improvement | User impact | Complexity | Product value |
| ---: | --- | --- | --- | --- |
| 1 | Carry the brief’s goal into an editable first task | High | Low | High |
| 2 | Recover failed or interrupted turns without duplicating a saved question | High | Medium | High |
| 3 | Show the exact context revision in chat and import reusable text references | High | Medium | High |
| 4 | Keep the user’s reading position while a reply streams | High | Medium | High |
| 5 | Ground answers in named sources and keep incomplete replies out of future context | High | Medium | High |
| 6 | Merge authoritative stream results and reduce redundant transcript and workspace reads | High | Medium | High |
| 7 | Make model choice and account recovery explicit | High | Medium | High |
| 8 | Evaluate long briefs against realistic source sets and add retrieval if results justify it | High | High | High |
| 9 | Reuse role compilation across task briefs and measure time to the first useful result | Medium | Medium | Medium |
| 10 | Establish hosted identity, provider authorization, and distributed generation safeguards | High | High | High |

Sequencing favors changes with a short path to better answers and predictable recovery. Retrieval and shared memory need explicit source ownership and tests for relevance. Execute-capable tools require a separate permissions model, provider support, and isolation. An account failure should leave the user in control of retries and provider choice.

## Implemented in beta 3

- **First task.** Starting from a saved context puts the exact pinned goal in the composer. Setup answers for a profession can also seed a first draft. The user can edit the draft and choose when to send it. Setup identifies the model that will be used.
- **Context and sources.** The chat shows its own revision, including user-authored goal, instructions, reference text, and output format. Editing opens the current revision separately. The builder imports TXT, Markdown, CSV, and JSON with source names, checks the existing reference budget, and preserves the old text when an import fails.
- **Response quality.** Both brief types ask for evidence, source names, assumptions, and gaps. The transcript retains failed and stopped answers for review. Later model requests exclude those fragments. Provider fixtures verify the prompts and inputs. Real-model answer quality still needs evaluation.
- **Recovery and reading.** The UI shows whether a saved question can retry its reply or an interrupted send needs a status check. Account and plan failures surface the relevant action. Stable message IDs prevent a repeated send from inserting the same question twice. The transcript follows the latest reply until the reader scrolls up. Text renders at most once per animation frame.
- **Performance.** Successful turns return committed metadata in the stream, removing the follow-up transcript and bootstrap requests. The account and persona listings use narrower queries. Context fitting estimates each message cost once. In a synthetic 299-message test on the development Mac, median fitting time fell from 3.01 ms to 0.04 ms with identical history retained and identical estimated tokens. This measures local fitting only.

## Remaining work

- Evaluate grounded response quality and first-use completion with real, consented provider accounts and representative tasks. The automated suite uses local provider fixtures.
- Add structured source retrieval after collecting evidence about long reference sets. Current import uses bounded plain text. Cross-chat memory, PDF ingestion, and external tool execution need their own design and quality checks.
- Separate the reusable base role compilation from its brief-specific snapshot. Continue to measure account usage and time to a useful first answer.
- Hosted chat needs approved account flows, production identity and durable storage, and a distributed generation lock. The Vercel release page distributes the local app. [ChatGPT plan usage integration](https://developers.openai.com/siwc/token-sharing-open-source) · [Deploying Git repositories on Vercel](https://vercel.com/docs/git)
