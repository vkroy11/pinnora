import { getDb } from "@/db";
import { creditLedger, dispatches } from "@/db/schema";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

export async function grant(userId: string, amount: number) {
  const rows = await getDb().insert(creditLedger).values({ userId, kind: "grant", amount }).returning();
  return rows[0];
}

/** Inserts the hold only if the balance covers it, in a single statement so a burst of
 * concurrent dispatches can't race two holds past the same remaining credits. Returns the
 * hold id, or null when the user can't afford the run. */
export async function insertHoldIfSufficient(
  userId: string,
  dispatchId: string,
  amount: number,
): Promise<string | null> {
  const cost = Math.abs(amount);
  const result = await getDb().execute(sql`
    insert into credit_ledger (user_id, dispatch_id, kind, amount)
    select ${userId}::uuid, ${dispatchId}::uuid, 'hold', ${-cost}
    where (
      select coalesce(sum(amount), 0) from credit_ledger
      where user_id = ${userId}::uuid and released_at is null
    ) >= ${cost}
    returning id
  `);
  const rows = (result as unknown as { rows: { id: string }[] }).rows;
  return rows[0]?.id ?? null;
}

export async function settleHold(holdId: string) {
  await getDb()
    .update(creditLedger)
    .set({ settledAt: new Date() })
    .where(and(eq(creditLedger.id, holdId), isNull(creditLedger.releasedAt)));
}

export async function releaseHold(holdId: string) {
  await getDb()
    .update(creditLedger)
    .set({ releasedAt: new Date() })
    .where(and(eq(creditLedger.id, holdId), isNull(creditLedger.settledAt)));
}

/** Releases every still-open hold for a dispatch. Used when a run is finalized by something
 * other than its own pipeline (an operator's Stop, or the stale-run reaper), where the hold
 * id isn't in hand -- an interrupted pipeline would otherwise leak its reservation forever. */
export async function releaseOpenHoldsForDispatch(dispatchId: string) {
  await getDb()
    .update(creditLedger)
    .set({ releasedAt: new Date() })
    .where(
      and(
        eq(creditLedger.dispatchId, dispatchId),
        eq(creditLedger.kind, "hold"),
        isNull(creditLedger.settledAt),
        isNull(creditLedger.releasedAt),
      ),
    );
}

/** Statement view: every ledger entry for a user, newest first, with the prompt it paid for. */
export function listLedgerForUser(userId: string, limit = 100) {
  return getDb()
    .select({
      id: creditLedger.id,
      kind: creditLedger.kind,
      amount: creditLedger.amount,
      createdAt: creditLedger.createdAt,
      settledAt: creditLedger.settledAt,
      releasedAt: creditLedger.releasedAt,
      dispatchId: creditLedger.dispatchId,
      prompt: dispatches.prompt,
      dispatchStatus: dispatches.status,
    })
    .from(creditLedger)
    .leftJoin(dispatches, eq(creditLedger.dispatchId, dispatches.id))
    .where(eq(creditLedger.userId, userId))
    .orderBy(desc(creditLedger.createdAt))
    .limit(limit);
}

export async function getBalance(userId: string): Promise<number> {
  const rows = await getDb()
    .select({ balance: sql<string>`coalesce(sum(${creditLedger.amount}), 0)` })
    .from(creditLedger)
    .where(and(eq(creditLedger.userId, userId), isNull(creditLedger.releasedAt)));
  return Number(rows[0]?.balance ?? 0);
}

/** The hold that actually paid for the run. A dispatch can have more than one: a 0.6-0.8
 * run releases its classifier-time hold while parked, then takes a fresh one on confirm. */
export async function getLedgerRowByDispatchId(dispatchId: string) {
  const rows = await getDb()
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.dispatchId, dispatchId))
    .orderBy(desc(creditLedger.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function getLedgerRow(id: string) {
  const rows = await getDb().select().from(creditLedger).where(eq(creditLedger.id, id)).limit(1);
  return rows[0] ?? null;
}
