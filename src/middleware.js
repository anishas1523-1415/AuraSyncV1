import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Define which routes are publicly accessible without authentication
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/search(.*)", // Let song searches pass through
  "/api/lyrics(.*)"
]);

export default clerkMiddleware(async (auth, req) => {
  // In development we may want to bypass Clerk to speed up debugging locally.
  // This check only runs when `NODE_ENV` is 'development' and will not affect production.
  if (process.env.NODE_ENV === 'development') {
    return;
  }
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
