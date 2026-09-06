import { getDb } from "./index";
import { orgs } from "./schema";

const SEED_ORGS = [
  { name: "Pinnora", slug: "pinnora" },
  { name: "Skala", slug: "skala" },
  { name: "Google", slug: "google" },
];

async function main() {
  const db = getDb();
  await db.insert(orgs).values(SEED_ORGS).onConflictDoNothing({ target: orgs.slug });
  const rows = await db.select().from(orgs);
  console.log(`orgs table has ${rows.length} rows:`, rows.map((r) => r.slug));
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
