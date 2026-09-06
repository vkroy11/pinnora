import * as ledger from "@/lib/db/repositories/ledger";

export const SIGNUP_GRANT_CREDITS = 100;
export const RUN_COST_CREDITS = 10;

export async function grantSignupCredits(userId: string) {
  return ledger.grant(userId, SIGNUP_GRANT_CREDITS);
}

/** Reserve credits before any work starts. Returns the ledger row id (the "hold id"), or
 * null when the balance doesn't cover the run -- the check and the insert are one statement,
 * so the balance can never be driven negative by concurrent dispatches. */
export async function hold(
  userId: string,
  dispatchId: string,
  amount: number = RUN_COST_CREDITS,
): Promise<string | null> {
  return ledger.insertHoldIfSufficient(userId, dispatchId, amount);
}

/** Finalize a hold once the artifact is persisted. No-op if already released. */
export async function settle(holdId: string) {
  await ledger.settleHold(holdId);
}

/** Reverse a hold on classifier rejection, render error, or client abort. No-op if already settled. */
export async function release(holdId: string) {
  await ledger.releaseHold(holdId);
}

/** Release whatever this dispatch still has reserved, without needing the hold id -- for
 * finalizing a run whose pipeline is no longer alive to release it itself. */
export async function releaseOpenHolds(dispatchId: string) {
  await ledger.releaseOpenHoldsForDispatch(dispatchId);
}

export async function balance(userId: string) {
  return ledger.getBalance(userId);
}
