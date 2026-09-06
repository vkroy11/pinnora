"use server";

import { requireAppUser } from "@/lib/auth";
import { listLedgerForUser } from "@/lib/db/repositories/ledger";
import { balance } from "@/lib/services/credit-service";

export type LedgerEntry = {
  id: string;
  kind: "grant" | "hold";
  amount: number;
  createdAt: string;
  state: "granted" | "held" | "settled" | "released";
  prompt: string | null;
  dispatchId: string | null;
};

/** Pure read of the credit ledger for the statement view. `state` is derived rather than
 * stored -- the row's settled/released stamps are the only source of truth. */
export async function getCreditLedger(): Promise<{ entries: LedgerEntry[]; balance: number }> {
  const user = await requireAppUser();
  const [rows, currentBalance] = await Promise.all([listLedgerForUser(user.id), balance(user.id)]);

  const entries: LedgerEntry[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    amount: r.amount,
    createdAt: r.createdAt.toISOString(),
    state: r.kind === "grant" ? "granted" : r.releasedAt ? "released" : r.settledAt ? "settled" : "held",
    prompt: r.prompt,
    dispatchId: r.dispatchId,
  }));

  return { entries, balance: currentBalance };
}
