"use client";

import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { getCreditLedger, type LedgerEntry } from "@/app/actions/get-credit-ledger";

const STATE_LABELS: Record<LedgerEntry["state"], { label: string; variant: "default" | "secondary" | "outline" }> = {
  granted: { label: "Granted", variant: "default" },
  held: { label: "Held", variant: "secondary" },
  settled: { label: "Settled", variant: "default" },
  released: { label: "Released", variant: "outline" },
};

export function CreditLedgerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["credit-ledger"],
    queryFn: () => getCreditLedger(),
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[75vh] w-[70vw] max-w-3xl flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Credits</DialogTitle>
          <DialogDescription>
            Every hold, settlement and release. A released hold costs nothing — balance is the sum
            of everything not released.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-baseline gap-2 border-b pb-3">
          <span className="text-3xl font-semibold tabular-nums">{data?.balance ?? "—"}</span>
          <span className="text-sm text-muted-foreground">credits available</span>
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

        <div className="flex-1 overflow-y-auto">
          {data?.entries.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
          <ul className="flex flex-col divide-y">
            {data?.entries.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    {entry.kind === "grant" ? "Signup grant" : (entry.prompt ?? "Run")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(entry.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge variant={STATE_LABELS[entry.state].variant}>{STATE_LABELS[entry.state].label}</Badge>
                  <span
                    className={`w-14 text-right text-sm tabular-nums ${
                      entry.state === "released" ? "text-muted-foreground line-through" : ""
                    }`}
                  >
                    {entry.amount > 0 ? `+${entry.amount}` : entry.amount}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
