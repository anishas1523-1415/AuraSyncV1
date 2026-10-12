import { NextResponse } from "next/server";

// Sign-in happens in the browser (Firebase Authentication) and the app shows its own sign-in
// screen, so no route needs a server-side gate. The API routes stay public, read-only GETs.
export function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
