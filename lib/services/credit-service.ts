import * as ledger from "@/lib/db/repositories/ledger";

export const SIGNUP_GRANT_CREDITS = 100;
export const RUN_COST_CREDITS = 10;

export async function grantSignupCredits(userId: string) {
  return ledger.grant(userId, SIGNUP_GRANT_CREDITS);
}

/** Reserve credits before dispatch. Returns the ledger row id (the "hold id"). */
export async function hold(userId: string, dispatchId: string, amount: number = RUN_COST_CREDITS) {
  const row = await ledger.insertHold(userId, dispatchId, amount);
  return row.id;
}

/** Finalize a hold once the artifact is persisted. No-op if already released. */
export async function settle(holdId: string) {
  await ledger.settleHold(holdId);
}

/** Reverse a hold on classifier rejection, render error, or client abort. No-op if already settled. */
export async function release(holdId: string) {
  await ledger.releaseHold(holdId);
}

export async function balance(userId: string) {
  return ledger.getBalance(userId);
}
