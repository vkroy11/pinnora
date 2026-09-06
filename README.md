**Loom walkthrough:** _paste your public Loom URL here before submitting._

# Pinnora — chat-driven creative generator

An operator types a prompt; a small classifier decides whether they want an **image**, a
**landing page**, or an **email**; an LLM streams the result; the UI renders it as a tile in a
canvas grid. Credits are held before any work starts and settled or released afterwards.
Lineage threads each new tile back to the creative that spawned it. A side drawer answers
"why this output?" straight from the database, with no extra LLM calls.

---

## Run

Env vars (all provisioned through the Vercel Marketplace — `vercel env pull --yes` writes them to `.env.local`):

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon Postgres, pooled — app runtime |
| `DATABASE_URL_UNPOOLED` | Neon direct connection — migrations only |
| `CLERK_SECRET_KEY` / `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk auth |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-in`, `/sign-up` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI Studio key (Gemini) — classifier + generation |

```bash
pnpm install
pnpm db:migrate   # applies the tracked migrations in drizzle/
pnpm db:seed      # seeds the three orgs: Pinnora, Skala, Google
pnpm dev
```

Sign up through Clerk, pick an org on the onboarding screen (you start with **100 credits**),
click **New chat** — each chat is a project — and send a prompt. Each run costs **10 credits**.

`pnpm test` and `pnpm typecheck` are the green-bar gates; `pnpm lint` is also clean.

**To demo:** send "a landing page for a running club" (watch the HTML type out, then render),
click **Improvise** on the finished tile to see lineage, hit **Stop** mid-run on another one,
then query the ledger to see the hold released rather than settled:

```sql
select kind, amount, settled_at, released_at from credit_ledger where dispatch_id = '<run-id>';
```

---

## Request lifecycle

```
composer ──▶ dispatchCreative() ──▶ insert dispatch (queued) ──▶ returns { runId }  [no streaming]
                                          │
                                     after() ──▶ classify ──▶ route on confidence
                                                   │
                                     hold credits ─┴─▶ insert outputs row ──▶ stream generation
                                                              │                   │
                                                     persist partials      publish events
                                                              │                   │
tile ◀── SSE /api/runs/[id]/stream ◀──────────────────────────┴───────────────────┘
                                     (push off-Vercel · DB polling on Vercel)
```

---

## Key decisions

### 1. The action dispatches; it never streams

`dispatchCreative` only validates input (Zod), auth-gates via `requireOwnedProject`, checks
idempotency, writes a `queued` row, and returns `{ runId }`. The pipeline runs in `after()` so
it keeps executing past the response, and a separate SSE route is the only thing a client
subscribes to. Server actions can't return streams, and a slow classifier shouldn't hold the
request open — the run id is the handle everything else hangs off.

### 2. Credits: an append-mostly ledger with no cached balance

`hold(amount)` inserts one row (negative amount). `settle` and `release` only ever stamp
`settled_at` / `released_at` on **that same row** — they never insert compensating rows and never
mutate a balance column, because **there is no balance column**. Balance is always:

```sql
select coalesce(sum(amount), 0) from credit_ledger where user_id = $1 and released_at is null;
```

Nothing can drift, because there is no second copy of the truth to drift from. `settle` and
`release` are also mutually exclusive at the SQL level (`... where id = $1 and released_at is null`
and vice versa), so a late-arriving completion can't settle a hold that was already released.

`release` is called from exactly three places: classifier rejection, render error, and client
abort. A failed run leaves `dispatches.status = 'failed'` and zero settled credits.

### 3. Confidence bands

| Confidence | Behaviour |
| --- | --- |
| `< 0.6` | Abort as `ambiguous`. No hold, no output row, no render. |
| `0.6 – 0.8` | Persist `awaiting_confirmation`, surface "did you mean…" chips. Still no hold. |
| `> 0.8` | Proceed automatically, `kind_source = 'llm'`. |
| explicit intent | Skip the classifier entirely, `kind_source = 'human'` (used by **Improvise**). |

The classifier can also return `unsupported` (a fourth value it may emit, not a stored kind) —
anything outside the three render kinds aborts with **"Not supported yet."** before any hold.

The routing decision itself is a pure function (`lib/services/classifier-routing.ts`) with no DB
or network in it, which is what makes the band behaviour cheap to unit test.

### 4. Streaming: SSE transport, environment-aware delivery

The endpoint is always SSE with the correct headers (`text/event-stream`, `Cache-Control:
no-cache, no-transform`, `Connection: keep-alive`, plus `X-Accel-Buffering: no`). How events
*reach* it depends on where the app runs, keyed off `process.env.VERCEL` (`lib/config.ts`):

- **Off Vercel** (local dev, or a long-running host like EC2): a single persistent process, so an
  in-memory pub/sub is genuinely correct — real push, near-zero latency.
- **On Vercel**: serverless instances don't share memory, so the route polls the DB every 400 ms
  and diffs against what it already sent. Slower, but correct regardless of which instance is
  doing the generation.

Both paths replay from the DB on connect, so a reload or reconnect resumes rather than going
blank, and both emit a heartbeat comment every 10 s. That heartbeat matters: a model with a
15–20 s time-to-first-token leaves the response with zero bytes written long enough for
intermediary proxies to kill the connection as idle, at which point `EventSource` silently
reconnects and the whole thing *looks* broken.

### 5. The server is the source of truth; the stream is only a fast path

This is the decision I'd most want to defend. Run state lives in a React Query cache seeded by
the RSC render (`initialData`, so there's no double-render flash on hydrate). SSE events call
`setQueryData` — they update the cache, they are not *themselves* the state. On top of that:

- refetch when the stream errors or drops,
- refetch on window refocus,
- refetch every 4 s while any run is non-terminal.

The earlier design had the stream as the only path to truth, which meant **any** missed event
stranded a tile in a skeleton forever, recoverable only by a manual reload. Now a missed event
costs a few seconds of staleness. That property is worth more than the latency it costs.

### 6. Cancellation is DB-backed, not memory-backed

The SSE route may not share a process with the generation job, so "client disconnected" can't
rely on reaching an in-memory `AbortController`. Instead the route sets
`dispatches.cancel_requested`, and the pipeline polls that flag every 500 ms and aborts its own
local controller — which is threaded into the AI SDK call, so cancelling stops real token
generation rather than just closing the HTTP response. The same flag backs the explicit **Stop**
button.

Aborts are debounced by 1 s before they count. React Strict Mode double-invokes effects in dev
(mount → cleanup → mount), so the first `EventSource` opens and immediately closes; without the
grace period every fresh local dispatch would flag itself for cancellation before the real
connection took over.

### 7. Output shape is per-kind, not one shared schema

- **image** — no LLM call at all; a deterministic `picsum.photos/seed/<runId>` URL.
- **landing-page** — `{ html, headline, rationale }`, where `html` is a complete self-contained
  document with inline CSS. The tile renders a real scaled-down `<iframe>` thumbnail; the modal
  offers Preview / Code / Download.
- **email** — `{ subject, body, rationale }` with a copy button.

`rationale` is the "why this" the spec asks for, and it lives on the **outputs** row, not the run
log — it describes the artifact, not the dispatch. While a landing page is still streaming the
tile shows the HTML typing out, and only swaps to the rendered iframe once the document is
complete, because a half-parsed document in an iframe renders as garbage.

### 8. Models

- **Classifier:** `gemini-2.5-flash-lite` — the job is one cheap JSON label plus a confidence.
- **Generation:** `gemini-3.1-pro-preview`. `gemini-2.5-pro` returns 404 for new API keys now
  ("no longer available to new users"), and Google's own error names this as the replacement.

---

## Schema: keys and indexes

Six tables, all UUID primary keys with `defaultRandom()`. Every migration is drizzle-kit
generated and tracked in `drizzle/` — no hand-written SQL, so CI replays cleanly.

### Primary and unique keys

| Table | Primary key | Unique constraints | Why |
| --- | --- | --- | --- |
| `orgs` | `id` | `slug` | Seed/lookup by a stable human key (`pinnora`) rather than a generated id. |
| `users` | `id` | `clerk_user_id` | One app user per Clerk identity; the natural join key from every authed request. |
| `projects` | `id` | — | |
| `dispatches` | `id` (= the **run id**) | `idempotency_key` | The run id is the handle the action returns and the stream is keyed by. |
| `outputs` | `id` (= the **artifact id**) | `dispatch_id` | Unique enforces the 1:1 with a dispatch at the DB level, not just by convention. |
| `credit_ledger` | `id` (= the **hold id**) | — | `hold()` returns this id; `settle`/`release` address that exact row. |

Three different ids are deliberately distinct, because they're handles for three different
things: **run id** (`dispatches.id`) identifies the dispatch and drives the stream URL,
**artifact id** (`outputs.id`) is what lineage points at, and **hold id** (`credit_ledger.id`) is
what the credit service settles or releases.

### Foreign keys

```
users.org_id            → orgs.id
projects.org_id         → orgs.id
projects.user_id        → users.id
dispatches.project_id   → projects.id
dispatches.user_id      → users.id
dispatches.parent_artifact_id → outputs.id      (nullable — lineage input)
outputs.dispatch_id     → dispatches.id         (unique — 1:1)
outputs.parent_id       → outputs.id            (self-referential — lineage edge)
credit_ledger.user_id   → users.id
credit_ledger.dispatch_id → dispatches.id       (nullable — null only for the signup grant)
```

`dispatches` and `outputs` reference each other, which Drizzle needs an `AnyPgColumn` annotation
to type. The cycle is intentional: `dispatches.parent_artifact_id` records *what the operator
asked to improve on* (an input to the run), while `outputs.parent_id` records *what the artifact
actually descends from* (the lineage edge the UI walks). Keeping both means the run log stays a
faithful record of the request even if the render later fails and no artifact exists.

### Indexes, and the query each one exists for

| Index | Columns | Serves |
| --- | --- | --- |
| `dispatches_project_created_idx` | `(project_id, created_at)` | The canvas read path: every run for a project, newest first. Composite so ordering is satisfied by the index, not a sort. |
| `dispatches_idempotency_key_idx` | `idempotency_key` (unique) | The double-submit lookup on every dispatch, and the DB-level guarantee behind it. |
| `outputs_dispatch_id_idx` | `dispatch_id` (unique) | Joining an output to its run on the canvas, and enforcing 1:1. |
| `outputs_parent_id_idx` | `parent_id` | Walking lineage — "what descends from this artifact". |
| `projects_user_id_idx` | `user_id` | The chats list. |
| `credit_ledger_user_id_idx` | `user_id` | Balance: `sum(amount) where user_id = $1 and released_at is null`. |
| `credit_ledger_dispatch_id_idx` | `dispatch_id` | The one-line correctness check: what happened to this run's hold. |

**`outputs` deliberately has no `project_id`.** It would be a redundant denormalization: every
read path reaches an output through its dispatch (`dispatches` is already indexed by
`project_id`, and `outputs.dispatch_id` is unique-indexed), so a second copy of project ownership
would be one more thing that can disagree with itself.

### The idempotency key

```
sha256( userId :: projectId :: prompt.trim() :: intent ?? "" )
```

Hashed rather than stored as a composite so a prompt of any length still fits a btree index
comfortably. It's `userId` rather than `orgId` because org is reachable through the project and
two users in one org sending the same prompt are two genuinely different runs. The unique index
makes it a DB-level guarantee, and the lookup is additionally windowed to **5 seconds** — the goal
is swallowing a double-submit, not preventing someone from legitimately re-running the same
prompt later.

### Enums are TypeScript unions over `text`

`status`, `kind`, and `kind_source` are `text` columns typed with Drizzle's `$type<>()` rather
than Postgres enums. Adding a state (`unsupported` was added mid-build) is then a type-level
change with no migration and no `ALTER TYPE` — a reasonable trade at this size, given the
application is the only writer.

### `phases` as `jsonb`

The phase timeline is an append-only `jsonb` array on the dispatch row
(`[{ phase, at, detail? }]`), appended atomically with `phases || $1::jsonb`. It's read as a whole
by exactly one consumer (the drawer) and never queried across rows, so a separate events table
would have bought a join and nothing else. It doubles as the stream's replay log: a reconnecting
client's events are derived from it.

---

## The hard part: why the stream looked broken

Worth writing down, because the symptom pointed everywhere except the cause.

Tiles sat on skeletons until a manual reload. The database was always correct, the "why this?"
drawer always showed a completed run, and `curl` against the stream endpoint showed events
arriving progressively. Three plausible-looking bugs got found and fixed along the way — a
missing heartbeat, terminal events that never closed the client `EventSource`, and Strict Mode's
double-mount tripping the abort path — and none of them was it.

The actual cause showed up only after instrumenting both sides at once:

```
[stream 139403c9] connected. status=classifying isVercel=false
[stream 139403c9] subscribing (push mode)
[publish 139403c9] classified -> 0 listener(s)
[publish 139403c9] partial    -> 0 listener(s)   ...×60
[publish 139403c9] done       -> 0 listener(s)
```

The route subscribed. The pipeline published. Zero listeners.

Next.js bundles the `react-server` layer (server components and server actions — where `after()`
runs the pipeline) separately from route handlers (where the SSE endpoint lives). A module-level
`Map` in `run-events.ts` was therefore instantiated **twice inside one process**. The pipeline
published into one map while the stream subscribed to the other; the two never met.

That single fact explains every confusing data point: the DB was fine because Postgres is
genuinely shared; Vercel worked because polling never touches shared memory; and my `curl` tests
passed because they dispatched *from a route handler* — same layer, same map. The fix is to hang
the registries off `globalThis`, the standard Next.js pattern for exactly this. Verified by
publishing from a server component and receiving it in a route handler.

The lesson I'd keep: the real bug was only visible with the publisher and the subscriber
instrumented **in the same trace**. Every earlier fix was aimed at a symptom that a healthy
system could also produce.

---

## Tests

`pnpm test` — 20 tests, no network and no database, so they're deterministic in CI:

- **Classifier routing** — every confidence band, `unsupported`, and the explicit-intent skip.
- **Pipeline routing** — that `< 0.6` and `unsupported` take no hold, that `0.6–0.8` holds nothing
  and generates nothing until confirmed, and that explicit intent bypasses the classifier.
- **Credit lifecycle** — released on abort and on render error, settled only on success, and never
  both.
- **Idempotency** — same tuple hashes equal, any differing field doesn't, whitespace is trimmed.

## Known limitations / next four hours

1. **Batch (`count: N`)** fan-out sharing one hold — the stretch goal I didn't reach.
2. **Off-Vercel push doesn't survive multiple instances.** Correct for one process (local, single
   EC2 box); horizontal scaling there would want Postgres `LISTEN/NOTIFY` or Redis rather than an
   in-process emitter. The Vercel path already sidesteps this by polling.
3. **Vercel polling is a 400 ms compromise.** Vercel now supports WebSockets on Fluid Compute,
   which would allow real push there too, but it means restructuring so the connection owns the
   generation (plus a claim lock so reconnects don't double-run), and it drops the SSE transport
   this exercise asks for.
4. **`unsupported` runs record no `classified_kind`**, so the drawer shows "—" for kind and
   confidence on those. Storing the classifier's raw verdict separately would fill that in.
5. **Image generation is a placeholder URL**, per the brief.
