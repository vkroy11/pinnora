import {
  pgTable,
  uuid,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  clerkOrgId: text("clerk_org_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  orgId: uuid("org_id").notNull().references(() => orgs.id),
  email: text("email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("projects_user_id_idx").on(t.userId)],
);

export const dispatchKindEnum = ["image", "landing-page", "email"] as const;
export type DispatchKind = (typeof dispatchKindEnum)[number];

export const dispatchStatusEnum = [
  "queued",
  "classifying",
  "ambiguous",
  "unsupported",
  "awaiting_confirmation",
  "dispatched",
  "streaming",
  "done",
  "failed",
  "cancelled",
] as const;
export type DispatchStatus = (typeof dispatchStatusEnum)[number];

export const kindSourceEnum = ["llm", "human"] as const;
export type KindSource = (typeof kindSourceEnum)[number];

// The run log. One row per operator prompt dispatch.
export const dispatches = pgTable(
  "dispatches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    prompt: text("prompt").notNull(),
    // Caller-supplied intent (e.g. from "Improvise") skips the classifier call.
    explicitIntent: text("explicit_intent").$type<DispatchKind | null>(),
    classifiedKind: text("classified_kind").$type<DispatchKind | null>(),
    classifiedConfidence: doublePrecision("classified_confidence"),
    kindSource: text("kind_source").$type<KindSource | null>(),
    // Lineage: points at the parent creative this run improved on.
    parentArtifactId: uuid("parent_artifact_id").references((): AnyPgColumn => outputs.id),
    status: text("status").$type<DispatchStatus>().notNull().default("queued"),
    model: text("model"),
    error: text("error"),
    // Cross-instance cancellation signal: the SSE route (which may run on a different
    // serverless instance than the generation job) sets this instead of relying on an
    // in-memory AbortController it may not have access to. The pipeline polls it.
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    idempotencyKey: text("idempotency_key").notNull(),
    // [{ phase: string, at: string (ISO), detail?: string }]
    phases: jsonb("phases").$type<{ phase: string; at: string; detail?: string }[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("dispatches_project_created_idx").on(t.projectId, t.createdAt),
    uniqueIndex("dispatches_idempotency_key_idx").on(t.idempotencyKey),
  ],
);

export type RenderContent = {
  url?: string; // image
  html?: string; // landing-page: full self-contained HTML document
  headline?: string; // landing-page: hero headline, duplicated as plain text for previews
  subject?: string; // email
  body?: string; // email
};

// Creative outputs. 1:1 with a dispatch, self-referential for lineage.
export const outputs = pgTable(
  "outputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dispatchId: uuid("dispatch_id").notNull().references(() => dispatches.id),
    parentId: uuid("parent_id").references((): AnyPgColumn => outputs.id),
    kind: text("kind").$type<DispatchKind>().notNull(),
    content: jsonb("content").$type<RenderContent | null>(),
    partialContent: jsonb("partial_content").$type<RenderContent | null>(),
    rationale: text("rationale"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("outputs_dispatch_id_idx").on(t.dispatchId),
    index("outputs_parent_id_idx").on(t.parentId),
  ],
);

export const ledgerKindEnum = ["grant", "hold"] as const;

// Append-mostly credit ledger. Balance = SUM(amount) WHERE released_at IS NULL.
// No cached balance column anywhere -- this table is the only source of truth.
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    dispatchId: uuid("dispatch_id").references(() => dispatches.id), // null only for the signup grant
    kind: text("kind").$type<(typeof ledgerKindEnum)[number]>().notNull(),
    amount: integer("amount").notNull(), // +100 grant, -10 hold
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (t) => [
    index("credit_ledger_user_id_idx").on(t.userId),
    index("credit_ledger_dispatch_id_idx").on(t.dispatchId),
  ],
);
