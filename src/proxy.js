import { NextResponse } from "next/server";

// Completely bypassed Clerk proxy.
// All auth is handled client-side via mock provider for standalone APK execution.
export default function proxy(req) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!.+\\.[\\w]+$|_next).*)",
    "/",
    "/(api|trpc)(.*)"
  ]
};