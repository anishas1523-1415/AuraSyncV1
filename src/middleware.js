import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/search(.*)'
]);

export default clerkMiddleware((auth, req) => {
  // If we're using offline mock mode, skip protection
  if (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    if (!isPublicRoute(req)) {
      auth().protect();
    }
  }
});

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
