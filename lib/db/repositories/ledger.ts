import { getDb } from "@/db";
import { creditLedger } from "@/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";

export async function grant(userId: string, amount: number) {
  const rows = await getDb().insert(creditLedger).values({ userId, kind: "grant", amount }).returning();
  return rows[0];
}

export async function insertHold(userId: string, dispatchId: string, amount: number) {
  const rows = await getDb()
    .insert(creditLedger)
    .values({ userId, dispatchId, kind: "hold", amount: -Math.abs(amount) })
    .returning();
  return rows[0];
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

export async function getBalance(userId: string): Promise<number> {
  const rows = await getDb()
    .select({ balance: sql<string>`coalesce(sum(${creditLedger.amount}), 0)` })
    .from(creditLedger)
    .where(and(eq(creditLedger.userId, userId), isNull(creditLedger.releasedAt)));
  return Number(rows[0]?.balance ?? 0);
}

export async function getLedgerRowByDispatchId(dispatchId: string) {
  const rows = await getDb().select().from(creditLedger).where(eq(creditLedger.dispatchId, dispatchId)).limit(1);
  return rows[0] ?? null;
}

export async function getLedgerRow(id: string) {
  const rows = await getDb().select().from(creditLedger).where(eq(creditLedger.id, id)).limit(1);
  return rows[0] ?? null;
}
