**Loom walkthrough:** _paste your public Loom URL here before submitting._

# Pinnora — chat-driven creative generator

A take-home build for Skala Media's technical exercise: an operator types a prompt, a small
classifier decides image / landing-page / email, an LLM streams the result, and the UI renders
it as a tile in a grid — with credit hold/settle/release correctness and prompt lineage.

## Run

Env vars (all provisioned via Vercel Marketplace — `vercel env pull --yes` populates `.env.local`):

- `DATABASE_URL`, `DATABASE_URL_UNPOOLED` — Neon Postgres (pooled for app runtime, unpooled for migrations)
- `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — Clerk auth
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`
- `GOOGLE_GENERATIVE_AI_API_KEY` — direct Google AI Studio key (Gemini), used for both the classifier and the main generation call

```bash
pnpm install
pnpm db:migrate   # applies the tracked migration in drizzle/
pnpm db:seed      # seeds the 3 orgs: Pinnora, Skala, Google
pnpm dev
```

Sign up via Clerk, pick an org on the onboarding screen (you start with 100 credits), click
**New chat** (each chat is a project), and send a prompt. Each run costs 10 credits.

`pnpm test` and `pnpm typecheck` are green.

## Design rationale

**Classifier-then-dispatch.** The dispatch server action only validates input, auth-gates, checks
idempotency, and persists a `queued` row — it never blocks on an LLM call (server actions can't
stream, and a slow classifier shouldn't hold the request open). The actual classify → hold →
generate pipeline runs via `after()` so it keeps executing past the returned response; a separate
SSE route is the only way a client observes progress, and it replays persisted state on
connect/reload so a refresh never shows a blank tile — it just resumes from whatever phase and
partial content is in the DB.

**Credit lifecycle.** `credit_ledger` is append-mostly: a `hold` row is inserted (negative amount)
before any generation work; `settle`/`release` only ever flip `settledAt`/`releasedAt` on that same
row. Balance is always `SUM(amount) WHERE releasedAt IS NULL` — there's no cached balance column
anywhere, so there's nothing to drift. Release is called from exactly three places: classifier
rejection (`<0.6` confidence or `unsupported`), a render error, and client abort (the SSE route's
`request.signal` is the only correct abort hook — it fires an `AbortController` that's threaded
into the actual AI SDK call, so aborting stops real work, not just the HTTP response).

**Confidence bands.** `<0.6` aborts with no hold; `0.6–0.8` persists the dispatch (for audit/lineage)
in `awaiting_confirmation` and surfaces confirm chips in the tile — clicking one records
`kindSource: 'human'` before proceeding; `>0.8` (or an explicit intent from "Improvise") proceeds
automatically with `kindSource: 'llm'`/`'human'`. Anything outside the three kinds classifies as
`unsupported` and aborts with "Not supported yet." before any hold or render.

**What I'd do next.** Add batch (`count: N`) fan-out sharing one hold; move the in-memory
run-events pub/sub to something that survives across serverless instances (Vercel Queues or a
Postgres LISTEN/NOTIFY) since right now a reload against a *different* instance only gets the
last DB-persisted state, not live updates, until it terminates; and add optimistic-UI polish for
the confirm-chip flow so the tile doesn't flash between "awaiting confirmation" and "dispatched."
