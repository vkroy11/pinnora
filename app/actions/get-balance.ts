"use server";

import { requireAppUser } from "@/lib/auth";
import { balance } from "@/lib/services/credit-service";

export async function getMyBalance(): Promise<number> {
  const user = await requireAppUser();
  return balance(user.id);
}
