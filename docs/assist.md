# Reviewer assistant

A helper for the people who curate "Both sides" topics in the reviewer console (`review.html`). It is powered by Claude and runs as a Supabase Edge Function. It is **advisory only**: it never writes to the database, and nothing it says is published. A reviewer still approves every topic, as `docs/content-sources.md` requires.

It does three things:

| Action | What it does | Uses Claude |
|---|---|---|
| `check_topic` | Reads a draft topic and lists what breaks the house rules: loaded or partisan wording in the title or fact, a fact that isn't neutral or doesn't match its source as described, quotes that look paraphrased, missing dates or roles, a missing side, quotes from different weeks or subjects. Suggests a neutral title or fact where needed. Never rewrites a quote and never says which side is right. | Yes |
| `verify_quote` | Opens the quote's source page and checks the quote appears there word for word. | No |
| `draft_from_source` | Opens a page (a floor transcript, a press release) and proposes quotes from named officials on the topic, each one re-checked word for word against the page before it is returned. Party is never guessed; the reviewer sets the side. | Yes |

## How it is built

- **Where it runs:** `supabase/functions/assist/index.ts`, a Deno Edge Function in the Gatecast Supabase project. The pure logic (text normalisation, the word-for-word check, the private-address check, the schemas and prompt, response shaping) is in `supabase/functions/assist/logic.mjs`, a plain JavaScript module tested from Node by `tests/assist.test.mjs`.
- **The key:** the Anthropic API key is a Supabase Edge Function secret. The browser never sees it, and it is never in the repository. The function reads the first of these secret names that is set: `ANTHROPIC_API_KEY`, `Anthropic`, `ANTHROPIC`.
- **Who may call it:** the function is deployed with `verify_jwt` on, so Supabase turns away calls without a valid token before the code runs. The code then checks the token belongs to a signed-in user (`/auth/v1/user`; the public key alone has no user) and that the user is listed in `public.reviewers` (it reads `reviewers` with the caller's own token; row-level security returns their row only if they are a reviewer).
- **Claude:** called through the official SDK (`npm:@anthropic-ai/sdk@1.8.0`) on the beta messages endpoint. Model `claude-opus-5-5`, effort `high`, thinking left at the model's default (always on for this model), `max_tokens` 8000, structured JSON output with a closed schema, and refusal fallbacks on (`fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta): if Claude Opus 5.5 declines on policy grounds, the API retries the same request on the model Anthropic recommends for that case, and the response says so (`fallback: true`). The system prompt is one fixed text shared by both Claude actions and marked for prompt caching.

## Guardrails

- **Reviewers only.** Not signed in: 401. Signed in but not a reviewer: 403.
- **Advisory.** Nothing is saved. The console shows suggestions; a person decides.
- **Quotes are re-verified.** Every quote Claude drafts is checked against the fetched page after the same normalisation as `verify_quote`. Any quote not found word for word is dropped, and the response says how many (`dropped`).
- **Page text is untrusted.** Fetched pages go to Claude as a document marked as untrusted source material, and the system prompt says page text is data, never instructions. A page that says "ignore your rules" cannot make the assistant publish anything: it has no way to write.
- **Nothing auto-publishes.** The function has no database write access of its own and uses only the caller's token, which row-level security already limits.
- **What "word for word" means.** Both texts are compared after folding typography only: curly quotes become straight, every kind of dash becomes a hyphen, whitespace and invisible characters are collapsed, "…" becomes "...". Words, spelling and capitalisation must match. The quote's own final punctuation mark may differ (a quote ending "act." on a page that has "act,"). Outer quotation marks pasted with the quote are ignored. Quotes joined with an ellipsis are not found, by design: the house rule is full quotes.
- **Fetching is fenced in.** Only `https` links on the default port, no user names or passwords in the link, at most 3 redirects (each one checked again), 10 seconds in all, 3 MB at most. Every name is looked up (A and AAAA) and refused if any answer is a private, loopback, link-local (cloud metadata), carrier-grade NAT, multicast, reserved or documentation address, or an IPv6 form wrapping one. Names such as `localhost` or `*.local` are refused without a lookup. Web pages and plain text are read; a PDF gets a clear message to check it by hand; anything else is refused.
- **Long pages are cut and flagged, never silently.** `draft_from_source` reads the first 80,000 characters and returns `truncated: true` with the page's full length when it had to cut.
- **Limits.** 30 requests per reviewer per hour (`status` is free). See "Known gaps" for why this is best effort.
- **Logs.** Token use (input, output, cache write, cache read) and Claude error codes go to the function's log in Supabase. They are never sent to the browser. Topic text and quotes are not logged.

## Request and response contract

```
POST {SUPABASE_URL}/functions/v1/assist
Authorization: Bearer <the reviewer's access token>
apikey: <the publishable key>
Content-Type: application/json
```

Allowed browser origins (CORS): `https://gatecast.vercel.app` and Gatecast's preview deployments (`https://gatecast-*.vercel.app`), `http://localhost:<port>` and `http://127.0.0.1:<port>`, plus any origins listed, comma-separated, in the optional `ASSIST_ALLOWED_ORIGINS` secret (for a custom domain).

### `status`

Request `{ "action": "status" }` → `200 { "configured": true, "limit": 30, "remaining": 27 }`. Free: not counted against the limit. The console can call this first and hide the Claude actions when `configured` is `false`.

### `check_topic`

```json
{ "action": "check_topic",
  "topic": { "title": "", "place": "US", "neutral_fact": "", "neutral_fact_source": "https://...",
             "statements": [{ "side": "D", "speaker": "", "role": "", "quote": "", "said_on": "2026-11-12", "source_url": "https://..." }] } }
```

At most 12 statements. → `200`

```json
{ "verdict": "ready" | "needs_changes",
  "issues": [{ "field": "title" | "neutral_fact" | "statements[0].quote" | "statements" | ..., "problem": "", "suggestion": "" }],
  "suggested_title": "",   // empty when the current one is fine
  "suggested_fact": "",    // empty when the current one is fine
  "balance_note": "",
  "model": "claude-opus-5-5",
  "fallback": false }
```

`verdict` is `ready` only when there are no issues.

### `verify_quote`

`{ "action": "verify_quote", "quote": "...", "source_url": "https://..." }` → `200` with one of:

- `{ "status": "found", "context": "<up to 200 characters around the match, normalised>" }`
- `{ "status": "not_found" }`
- `{ "status": "unreachable", "reason": "<code>", "message": "<sentence for the reviewer>", "http_status": 404 | null }`

`reason` codes: `bad_url`, `private_host`, `dns`, `timeout`, `too_large`, `too_many_redirects`, `http_error`, `pdf`, `unsupported_type`, `network`, `empty`.

Works even when the Anthropic key is not set.

### `draft_from_source`

`{ "action": "draft_from_source", "source_url": "https://...", "topic_hint": "optional, up to 300 characters" }` → `200`

```json
{ "statements": [{ "speaker": "", "role": "", "quote": "", "said_on": "YYYY-MM-DD or empty",
                   "why_relevant": "", "source_url": "<the page actually read, after redirects>",
                   "context": "<up to 200 characters around the quote>" }],
  "neutral_fact_ideas": [""],
  "dropped": 1,
  "truncated": false, "chars_read": 12345, "total_chars": 12345,
  "model": "claude-opus-5-5", "fallback": false }
```

No `side` or party: the reviewer sets it. A page that can't be read → `422 { "error": "source_unreadable", "reason", "message", "http_status" }` with the same reason codes as `verify_quote`.

### Errors (every action)

| Status | Body | Meaning |
|---|---|---|
| 400 | `{ "error": "bad_request", "message" }` | Not JSON, unknown action, or a missing or empty field |
| 401 | `{ "error": "unauthorized" }` | No token, an invalid or expired token, or the public key without a user (Supabase's own `verify_jwt` check may answer 401 first, with its own body) |
| 403 | `{ "error": "not_a_reviewer" }` | Signed in, not in `public.reviewers` |
| 405 | `{ "error": "method_not_allowed" }` | Not POST (OPTIONS answers the CORS preflight) |
| 413 | `{ "error": "bad_request", "message" }` | Body over 64 KB |
| 422 | `{ "error": "declined", "category" }` | Claude declined, and so did the fallback |
| 422 | `{ "error": "source_unreadable", ... }` | `draft_from_source` could not read the page |
| 429 | `{ "error": "rate_limited", "retry_after" }` + `Retry-After` header | Over 30 requests in the last hour |
| 429 | `{ "error": "claude_busy" }` | Anthropic's rate limit; try again shortly |
| 502 | `{ "error": "incomplete" \| "bad_output" \| "unexpected_stop" }` | Claude's answer was cut off or unusable; nothing half-parsed is returned |
| 502 | `{ "error": "assistant_key_rejected" \| "claude_bad_request" \| "claude_overloaded" \| "claude_unavailable" \| "claude_timeout" \| "claude_unreachable" \| "claude_error" }` | The call to Claude failed (details in the function log) |
| 502 | `{ "error": "auth_unavailable" }` | Supabase Auth could not be reached |
| 503 | `{ "error": "assistant_not_configured" }` | No Anthropic key secret is set (Claude actions only) |

## Cost

Claude Opus 5.5 is $4 per million input tokens and $20 per million output tokens (cache reads $0.20 per million). With effort `high` the model thinks before answering, and thinking is billed as output. Rough ranges per call:

| Action | Input | Output (incl. thinking) | Cost |
|---|---|---|---|
| `check_topic` | ~1,500 to 2,500 tokens (about 1,000 of them the cached system prompt) | ~1,000 to 5,000 | about $0.03 to $0.11 |
| `draft_from_source`, short page (a press release) | ~2,000 to 6,000 | ~2,000 to 6,000 | about $0.05 to $0.15 |
| `draft_from_source`, long page (80,000 characters, the cap) | ~20,000 to 22,000 | ~3,000 to 7,000 | about $0.15 to $0.25 |
| `verify_quote`, `status` | none | none | $0 |

The rate limit caps one reviewer at roughly $7.50 an hour in the worst case. A request rescued by the fallback model is billed at that model's rates. Real numbers are in the function log (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`) and the Anthropic Console.

## Setup (owner and lead)

1. **The key.** In the Supabase dashboard: Project → Edge Functions → Secrets, add `ANTHROPIC_API_KEY` with the key from the Anthropic Console. (Or: `supabase secrets set ANTHROPIC_API_KEY=... --project-ref hfdwmzuedjcsaxgzhzmu`.) Never commit it, and never put it in front-end code or Vercel. If the secret already exists under the name `Anthropic` or `ANTHROPIC`, that works too.
2. **Optional:** `ASSIST_ALLOWED_ORIGINS` secret, comma-separated, if the site gets a custom domain.
3. **Deploy** both files with JWT verification on (the default; do not pass `--no-verify-jwt`):
   `supabase functions deploy assist --project-ref hfdwmzuedjcsaxgzhzmu`
   (or the Supabase MCP `deploy_edge_function` with `verify_jwt: true` and the files `index.ts` and `logic.mjs`).
4. **Check** with a reviewer's session: `{"action":"status"}` should answer `configured: true`. Without a token it should answer 401, and as a signed-in non-reviewer 403.

## Testing

- `npm test` runs `tests/assist.test.mjs`: normalisation, the word-for-word check, HTML to text, the private-address and link checks, request validation, the schemas, the exact Claude request (model, effort, fallbacks, cache control, no `thinking`), reading Claude's reply (refusal, cut-off, fallback), response shaping, CORS and the rate limit. No network and no API calls.
- `index.ts` was also run end to end under Node with a small Deno stand-in, the real SDK pointed at a local fake Anthropic server (`ANTHROPIC_BASE_URL`), a fake Supabase auth, and an intercepted test page. It covered auth (401, 403), CORS, every fetch refusal, a redirect to the metadata address, a name resolving to a private address, PDF, oversize, refusal, cut-off, typed SDK errors, quote re-verification and the rate limit. The real Anthropic API was not called (no spend approved) and no real tokens were used. That harness lives outside the repository; Deno was not available to run the function natively.

## Known gaps and follow-ups

- **Rate limit is per isolate.** Supabase may run several copies of the function, each with its own counter, so the real limit can be higher than 30 an hour. Follow-up (not applied; the database is not changed by this work): a small table and a check in the function, for example

  ```sql
  create table private.assist_usage (
    user_id uuid not null references auth.users (id) on delete cascade,
    at      timestamptz not null default now(),
    action  text not null
  );
  create index on private.assist_usage (user_id, at desc);
  -- plus a security definer function, e.g. private.assist_take(limit int, window interval) returns boolean,
  -- that counts the caller's rows in the window and inserts one when under the limit.
  ```
- **DNS can change between the check and the fetch.** The function checks every address a name resolves to, but the fetch resolves the name again. A hostile name server could answer differently the second time (DNS rebinding). Pinning the checked address would need a lower-level client than `fetch`. The risk is limited to what an Edge Function can reach on Supabase's network, and the function sends no credentials to fetched pages.
- **If `Deno.resolveDns` is unavailable** in the Edge Runtime, every link fails closed with "The site's address could not be looked up". Check `verify_quote` once after deploying.
- **Pages built by JavaScript** show little text to a plain fetch; the assistant then finds nothing. PDFs are not read.
- **`verify_jwt` and the new signing keys.** If the project moves to asymmetric JWT signing keys and Supabase's `verify_jwt` gate stops accepting tokens, deploy with it off: the function still checks the user and reviewer status itself.
- **Long pages take time.** A full 80,000-character page at effort `high` can take a minute or more. Supabase limits an Edge Function's wall-clock time (150 seconds on the free plan at the time of writing; check the current limits), so the console should show progress and treat a timeout as "try a shorter page or a narrower hint".
