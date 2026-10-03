---
title: Ask
description: How Ask answers a question about a project — the organization's own key, grounding from the graph and live file contents, citations, caching and limits.
---

# Ask

Ask answers questions about one project. **Each organization brings its own Gemini key.** There is
no platform key, so with no key, Ask is off and its tab does not appear.

## The key

`ManageAiSettingsUseCase` (`organization.ai.manage`, held by owner and admin) stores the key
encrypted with `SecretCipher`:
- the format is AES-256-GCM, `<version>:<iv>:<tag>:<ciphertext>`;
- the key comes from `SECRET_ENCRYPTION_KEY`;
- the version picks the key, so a rotation keeps reading the old values.

The key is write-only. Settings show `••••` and its last four characters, and the audit row records
that it changed, never what it is. Without `SECRET_ENCRYPTION_KEY`, saving a key fails plainly.

## Grounding

`AskProjectUseCase` (`project.ask.use`, every project role) reads the latest succeeded scan's graph
back from storage. Then `AskContext.ground` builds the context:
- the project overview;
- every route with its handler and guards;
- the most depended-on files;
- the files the question names, by path, file name and exported names, each with its imports and
  importers. With no named file, or the onboarding preset, it takes the most depended-on files and
  the route handlers instead.

**Up to 8 of those files are read live** through the GitHub App, at the scanned commit, numbered by
line so the answer can cite `path:line`. Contents are cached in Redis for 10 minutes and **never
stored**. An uploaded graph has no App behind it, so its answers rest on the graph alone.

The system prompt requires a citation, `path:line` or `METHOD /path`, for every claim about the
code. The Ask panel turns a citation of a real file or route into a link that selects the node; a
citation of nothing stays plain text.

## Cost and limits

| | |
|---|---|
| Per person | 20 questions an hour (`RateLimitPolicy`, `ask.question`) |
| Per organization | 200 a day (`RateLimitStore`, in the use-case) |
| Repeat question | Served from cache for an hour, keyed by scan and question, when there is no thread history |
| Onboarding summary | Generated once per scan and kept on `scans.summary` |

The answer streams as an oRPC event iterator. Closing the tab or pressing Stop aborts the request,
and with it the model call.
