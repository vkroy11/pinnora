"use server";

import { requireAppUser, UnauthorizedError } from "@/lib/auth";
import { getDispatch } from "@/lib/db/repositories/dispatches";
import { getOutputWithParent } from "@/lib/db/repositories/outputs";
import { getLedgerRowByDispatchId } from "@/lib/db/repositories/ledger";

/** Pure DB read for the "why this?" drawer -- no LLM calls. */
export async function getRunDetails(runId: string) {
  const user = await requireAppUser();
  const dispatch = await getDispatch(runId);
  if (!dispatch || dispatch.userId !== user.id) throw new UnauthorizedError();

  const [outputRow, ledgerRow] = await Promise.all([
    getOutputWithParent(runId),
    getLedgerRowByDispatchId(runId),
  ]);

  return {
    runId: dispatch.id,
    prompt: dispatch.prompt,
    classifiedKind: dispatch.classifiedKind,
    classifiedConfidence: dispatch.classifiedConfidence,
    kindSource: dispatch.kindSource,
    model: dispatch.model,
    status: dispatch.status,
    error: dispatch.error,
    phases: dispatch.phases,
    rationale: outputRow?.output.rationale ?? null,
    content: outputRow?.output.content ?? null,
    parent: outputRow?.parent
      ? { id: outputRow.parent.id, kind: outputRow.parent.kind, content: outputRow.parent.content }
      : null,
    credit: ledgerRow
      ? { amount: Math.abs(ledgerRow.amount), settled: Boolean(ledgerRow.settledAt), released: Boolean(ledgerRow.releasedAt) }
      : null,
  };
}
