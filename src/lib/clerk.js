"use client";
import { MockClerkProvider, mockUser, mockAuth, mockClerk, MockUserButton, MockSignIn, MockSignUp } from "./clerkMock";

// All auth is mocked for standalone offline-ready APK execution.
// No Clerk SDK imports to prevent any initialization side-effects.

export const ClerkProvider = MockClerkProvider;
export const useUser = () => mockUser;
export const useAuth = () => mockAuth;
export const useClerk = () => mockClerk;
export const UserButton = MockUserButton;
export const SignIn = MockSignIn;
export const SignUp = MockSignUp;
export const dark = {};
