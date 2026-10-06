import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/search(.*)',
  '/api/stream(.*)',
  '/api/lyrics(.*)'
]);

const hasClerkKey = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

// Offline mock mode (no Clerk key): clerkMiddleware itself requires a key and
// breaks every route without one, so skip it entirely and let the mock provider handle auth.
export default hasClerkKey
  ? clerkMiddleware((auth, req) => {
      if (!isPublicRoute(req)) {
        auth().protect();
      }
    })
  : function mockAuthMiddleware() {
      return NextResponse.next();
    };

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
