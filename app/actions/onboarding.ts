"use server";

import { redirect } from "next/navigation";
import { requireClerkIdentity } from "@/lib/auth";
import { getOrgBySlug } from "@/lib/db/repositories/orgs";
import { createUser } from "@/lib/db/repositories/users";
import { grantSignupCredits } from "@/lib/services/credit-service";
import { onboardingSchema } from "@/lib/schemas/onboarding-input";

export async function completeOnboarding(formData: FormData) {
  const { clerkUserId, email } = await requireClerkIdentity();
  const { orgSlug } = onboardingSchema.parse({ orgSlug: formData.get("orgSlug") });

  const org = await getOrgBySlug(orgSlug);
  if (!org) throw new Error("Unknown org");

  const user = await createUser({ clerkUserId, orgId: org.id, email });
  await grantSignupCredits(user.id);

  redirect("/projects");
}
