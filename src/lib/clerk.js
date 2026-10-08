"use client";
import * as RealClerk from "@clerk/nextjs";
import { dark as RealDark } from "@clerk/themes";
import { MockClerkProvider, mockUser, mockAuth, mockClerk, MockUserButton, MockSignIn, MockSignUp } from "./clerkMock";

// Conditionally use real Clerk if API key is present in env, otherwise fallback to offline mock.
// The bundled mobile app always uses the local profile: Clerk's web sign-in flow (redirects and
// cookies on https://localhost) hangs inside the Android WebView.
const hasKey = typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_APP_TARGET !== "mobile" &&
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export const ClerkProvider = hasKey ? RealClerk.ClerkProvider : MockClerkProvider;
export const useUser = hasKey ? RealClerk.useUser : () => mockUser;
export const useAuth = hasKey ? RealClerk.useAuth : () => mockAuth;
export const useClerk = hasKey ? RealClerk.useClerk : () => mockClerk;
export const UserButton = hasKey ? RealClerk.UserButton : MockUserButton;
export const SignIn = hasKey ? RealClerk.SignIn : MockSignIn;
export const SignUp = hasKey ? RealClerk.SignUp : MockSignUp;
export const dark = hasKey ? RealDark : {};
