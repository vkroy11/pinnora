import "server-only";
import { auth as clerkAuth, currentUser as clerkCurrentUser } from "@clerk/nextjs/server";
import { getUserByClerkId } from "@/lib/db/repositories/users";
import { getProject } from "@/lib/db/repositories/projects";

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class NeedsOnboardingError extends Error {
  constructor() {
    super("User has not picked an org yet");
    this.name = "NeedsOnboardingError";
  }
}

/** Confirms the caller is signed in and has completed org onboarding. Throws otherwise. */
export async function requireAppUser() {
  const { userId: clerkUserId } = await clerkAuth();
  if (!clerkUserId) throw new UnauthorizedError();

  const user = await getUserByClerkId(clerkUserId);
  if (!user) throw new NeedsOnboardingError();
  return user;
}

/** For the onboarding page: signed-in Clerk identity, no app-user row required yet. */
export async function requireClerkIdentity() {
  const { userId: clerkUserId } = await clerkAuth();
  if (!clerkUserId) throw new UnauthorizedError();
  const user = await clerkCurrentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress ?? "";
  return { clerkUserId, email };
}

/** Auth-gates a project: confirms the caller owns it. Throws otherwise. */
export async function requireOwnedProject(projectId: string) {
  const user = await requireAppUser();
  const project = await getProject(projectId);
  if (!project || project.userId !== user.id) {
    throw new UnauthorizedError("You do not own this project");
  }
  return { user, project };
}
