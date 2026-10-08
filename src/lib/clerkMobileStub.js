"use client";
// Stand-in for @clerk/nextjs and @clerk/themes in the mobile build (aliased in next.config.mjs).
// The bundled app uses the local profile, and Clerk's package ships server actions, which a
// static export rejects.
import {
  MockClerkProvider, MockUserButton, MockSignIn, MockSignUp, mockUser, mockAuth, mockClerk
} from "./clerkMock";

export const ClerkProvider = MockClerkProvider;
export const UserButton = MockUserButton;
export const SignIn = MockSignIn;
export const SignUp = MockSignUp;
export const useUser = () => mockUser;
export const useAuth = () => mockAuth;
export const useClerk = () => mockClerk;
export const dark = {};
