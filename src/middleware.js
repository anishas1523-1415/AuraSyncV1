import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Define which routes are publicly accessible without authentication
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/search(.*)", // Let song searches pass through
  "/api/lyrics(.*)"
]);

export default clerkMiddleware(async (auth, req) => {
  // Always enforce protection for non-public routes. Development bypass removed
  // to keep local and production auth behavior consistent.
  if (!isPublicRoute(req)) {
    // Protect the route and redirect to Clerk sign-in if not authenticated
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Matches all routes except static files (.css, .js, .png, etc.) and Next.js internals
    "/((?!.+\\.[\\w]+$|_next).*)",
    "/",
    "/(api|trpc)(.*)"
  ]
};
