import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { getUserByClerkId } from "@/lib/db/repositories/users";
import { listProjectsForUser } from "@/lib/db/repositories/projects";
import { balance } from "@/lib/services/credit-service";
import { createNewProject } from "@/app/actions/projects";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";

export default async function ProjectsPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect("/sign-in");

  const user = await getUserByClerkId(clerkUserId);
  if (!user) redirect("/onboarding");

  const [projects, credits] = await Promise.all([listProjectsForUser(user.id), balance(user.id)]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Your chats</h1>
          <p className="text-sm text-muted-foreground">{credits} credits remaining</p>
        </div>
        <div className="flex items-center gap-3">
          <form action={createNewProject}>
            <Button type="submit">New chat</Button>
          </form>
          <UserButton />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {projects.length === 0 && (
          <p className="text-sm text-muted-foreground">No chats yet — start one above.</p>
        )}
        {projects.map((project) => (
          <Link key={project.id} href={`/projects/${project.id}`}>
            <Card className="transition-colors hover:bg-accent/50">
              <CardHeader>
                <CardTitle className="text-base font-medium">{project.name}</CardTitle>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
