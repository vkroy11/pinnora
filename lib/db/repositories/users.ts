import { getDb } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function getUserByClerkId(clerkUserId: string) {
  const rows = await getDb().select().from(users).where(eq(users.clerkUserId, clerkUserId)).limit(1);
  return rows[0] ?? null;
}

export async function createUser(input: { clerkUserId: string; orgId: string; email: string }) {
  const rows = await getDb().insert(users).values(input).returning();
  return rows[0];
}
