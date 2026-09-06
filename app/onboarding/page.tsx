import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getUserByClerkId } from "@/lib/db/repositories/users";
import { listOrgs } from "@/lib/db/repositories/orgs";
import { completeOnboarding } from "@/app/actions/onboarding";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default async function OnboardingPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect("/sign-in");

  const existing = await getUserByClerkId(clerkUserId);
  if (existing) redirect("/projects");

  const orgs = await listOrgs();

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Which org are you with?</CardTitle>
          <CardDescription>
            You&apos;ll start with 100 credits. Each run costs 10 credits.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {orgs.map((org) => (
            <form key={org.id} action={completeOnboarding}>
              <input type="hidden" name="orgSlug" value={org.slug} />
              <Button type="submit" variant="outline" className="w-full justify-start">
                {org.name}
              </Button>
            </form>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
