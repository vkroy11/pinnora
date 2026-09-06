import { getDb } from "@/db";
import { orgs } from "@/db/schema";
import { eq } from "drizzle-orm";

export function listOrgs() {
  return getDb().select().from(orgs);
}

export async function getOrgBySlug(slug: string) {
  const rows = await getDb().select().from(orgs).where(eq(orgs.slug, slug)).limit(1);
  return rows[0] ?? null;
}
