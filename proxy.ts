import { clerkMiddleware } from "@clerk/nextjs/server";

// Resource-based auth (requireAppUser / requireOwnedProject in lib/auth.ts) gates
// every page, server action, and API route individually -- this proxy only makes
// the Clerk auth context available, it doesn't path-match to protect routes.
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
