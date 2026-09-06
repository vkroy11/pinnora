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

## Design rationale

*(The submission asks for this under 300 words. Everything below this section is optional
depth — read it only if you want the reasoning behind a specific decision.)*

**Why classifier-then-dispatch.** The action does the cheap, synchronous, refusable work —
Zod validation, auth, idempotency, a `queued` row — and returns a run id. Everything slow
happens in `after()`, and the run id is the handle the stream, the drawer, and lineage all
hang off. A server action can't return a stream, and a slow classifier shouldn't hold the
request open.

**How the credit lifecycle is modelled.** One row per hold, negative amount, in an
append-mostly ledger. `settle`/`release` only stamp `settled_at`/`released_at` on that row —
they never insert compensating rows and never touch a cached balance, because there is no
balance column. Balance is `sum(amount) where released_at is null`, so there's no second copy
of the truth to drift from. The two are mutually exclusive in SQL (`... and released_at is
null` / `... and settled_at is null`), so a late completion can't settle an already-released
hold. Crucially the hold is taken **before** the classifier runs, so it covers the whole run —
which is what makes "release on classifier rejection" a real release rather than a no-op. It's
released on classifier rejection, low confidence, a parked confirmation, render error, and
client abort; settled only once the artifact is persisted. Holds are also balance-checked in
the same statement that inserts them, so concurrent dispatches can't drive credits negative.

**Next four hours.** Batch (`count: N`) fan-out over one hold; replace the off-Vercel
in-process emitter with Postgres `LISTEN/NOTIFY` so push survives horizontal scaling; and
persist the classifier's raw verdict so rejected runs show a kind in the drawer instead of "—".

---

## Request lifecycle

```
composer ──▶ dispatchCreative() ──▶ insert dispatch (queued) ──▶ returns { runId }  [no streaming]
                                          │
                                     after() ──▶ hold credits ──▶ classify ──▶ route on confidence
                                                                                  │
                          release ◀── rejected / ambiguous / awaiting confirm ◀────┤
                                                                                  │
                                             insert outputs row ◀── proceed ◀──────┘
                                                    │
                                          stream generation ──▶ settle (or release on error/abort)
                                                    │                   │
                                            persist partials     publish events
                                                    │                   │
tile ◀── SSE /api/runs/[id]/stream ◀────────────────┴───────────────────┘
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

**The hold is taken before the classifier runs.** That ordering is deliberate: the brief says to
reserve before dispatch and release on classifier rejection, and rejection can only *release*
something if the reservation already covers the classification step. Holding afterwards would
have made "release on classifier rejection" a no-op that a `grep` would (correctly) fail.

`release(holdId)` therefore appears on five paths in `lib/services/pipeline.ts`:

| Path | Why |
| --- | --- |
| Classifier threw / was cancelled | Nothing was classified, let alone rendered. |
| `unsupported` | Classifier rejection — no render will happen. |
| Confidence `< 0.6` (`ambiguous`) | Classifier rejection. |
| Parked at `awaiting_confirmation` | Don't sit on an operator's credits while waiting on a human; `confirmAndProceed` takes a fresh hold when they pick. |
| Render error **and** client abort | The `catch` in `generateForDispatch`, branching on `signal.aborted`. |

`settle` is called from exactly one place: after the artifact is persisted. A failed run leaves
`dispatches.status = 'failed'` and zero settled credits.

**Balance can't go negative.** The check and the insert are a single statement — the row is only
written `where (select coalesce(sum(amount),0) ...) >= cost` — so two concurrent dispatches can't
both slip past the same remaining credits. `hold()` returns `null` when it can't afford the run,
and the pipeline fails the dispatch with "Not enough credits for this run." before touching the
classifier.

### 3. Confidence bands

| Confidence | Behaviour |
| --- | --- |
| `< 0.6` | Abort as `ambiguous`. Hold **released**, no output row, no render. |
| `0.6 – 0.8` | Persist `awaiting_confirmation`, surface "did you mean…" chips. Hold **released** while parked; a fresh one is taken when the operator picks. |
| `> 0.8` | Proceed automatically, `kind_source = 'llm'`, hold carried through to settle. |
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

### 6. Cancellation is DB-backed, and survives a dead pipeline

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

**A flag is only useful if something is alive to read it.** If the process restarted, the deploy
rolled, or a serverless instance was recycled mid-generation, no pipeline is polling — the run
would sit at `dispatched` forever with its credits still reserved. So `lib/services/run-recovery.ts`
adds two backstops:

- **Stop takes over.** `cancelRun` sets the flag, then after a 2 s grace period (longer than the
  pipeline's 500 ms poll, so a live pipeline gets first refusal) finalizes the run itself:
  release any open holds, mark it `cancelled`, publish the event.
- **A reaper on the read path.** Any non-terminal run untouched for 5 minutes is marked failed
  and has its holds released. It runs inside `getProjectRuns`, so simply opening or refetching a
  project reconciles it — no cron. `awaiting_confirmation` is excluded: it's waiting on a human,
  not stalled.

Releasing the orphaned holds is the point. Without it, every interrupted run silently keeps 10
credits reserved forever, and the ledger quietly stops reflecting what the operator can spend.

### 7. Output shape is per-kind, and a deliberate superset of the brief's

The brief suggests one shared schema, `{ headline, body, ctaLabel, ctaUrl }`. Each kind here
**still emits those fields**, but the shape is per-kind so each artifact is actually usable:

- **image** — no LLM call at all; a deterministic `picsum.photos/seed/<runId>` URL.
- **landing-page** — `{ html, headline, body, ctaLabel, ctaUrl, rationale }`. The structured
  fields are the brief's; `html` is a complete self-contained document with inline CSS, added so
  the tile can render a real scaled-down `<iframe>` thumbnail and the modal can offer
  Preview / Code / Download rather than showing four strings in a box.
- **email** — `{ subject, body, rationale }` with a copy button. An email has a subject line, and
  a CTA URL isn't a meaningful field for one; forcing the shared shape would have meant
  mislabelling the subject as `headline`.

This is a superset, not a substitution: everything the brief named is still generated and stored.

`rationale` is the "why this" the spec asks for, and it lives on the **outputs** row, not the run
log — it describes the artifact, not the dispatch. While a landing page is still streaming the
tile shows the HTML typing out, and only swaps to the rendered iframe once the document is
complete, because a half-parsed document in an iframe renders as garbage.

### 8. Models — two per run, recorded separately

- **Classifier:** `gemini-2.5-flash-lite` — the job is one cheap JSON label plus a confidence.
- **Generation:** `gemini-3.1-pro-preview`. `gemini-2.5-pro` returns 404 for new API keys now
  ("no longer available to new users"), and Google's own error names this as the replacement.

Two models run per dispatch, so the run log stores both: `classifier_model` is written when
classification starts, `model` when generation starts. The drawer shows them as separate fields,
because reporting the classifier as "the model used" for a landing page would be misleading.

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
| `dispatches` | `id` (= the **run id**) | `idempotency_key` | The run id is the handle the action returns and the stream is keyed by. Also carries `classifier_model` and `model` separately (two models run per dispatch). |
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
- **Credit lifecycle** — held before the classifier, released on abort and on render error,
  settled only on success, never both, and the run fails without generating when the balance
  can't cover the hold.
- **Idempotency** — same tuple hashes equal, any differing field doesn't, whitespace is trimmed.
- **Run recovery** — Stop finalizes a run whose pipeline is gone, doesn't steal one that
  finished inside the grace window, and the reaper releases orphaned holds.

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
   confidence on those. `unsupported` isn't one of the three stored kinds; persisting the
   classifier's raw verdict in its own column would fill that in.
5. **Image generation is a placeholder URL**, per the brief.
6. **The reaper is read-path triggered**, so an abandoned project's interrupted runs stay stale
   until someone opens it. A cron would close that gap; for a single-operator canvas the read
   path is where it matters.
7. **A 0.6-0.8 run takes two holds over its life** (one released while parked, one on confirm).
   The ledger reads correctly and the drawer shows the hold that paid, but a per-run credit
   report would want to sum by `dispatch_id` rather than take the latest row.
