"use client";
// Accounts: Firebase Authentication with Google (native account picker in the Android app, a
// popup on the website) or email + password. Listeners who'd rather not sign in can continue as a
// guest; their library then stays on the device until they sign in, when it merges into the account.
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  onAuthStateChanged, signInWithPopup, signInWithCredential, GoogleAuthProvider,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail,
  updateProfile, signOut as firebaseSignOut, deleteUser, reauthenticateWithCredential,
  reauthenticateWithPopup,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { isMobileApp } from "@/lib/api";

const GUEST_KEY = "aurasynq_guest";
const AuthContext = createContext(null);

const readGuest = () => {
  try { return localStorage.getItem(GUEST_KEY) === "1"; } catch (e) { return false; }
};
const writeGuest = (value) => {
  try {
    if (value) localStorage.setItem(GUEST_KEY, "1");
    else localStorage.removeItem(GUEST_KEY);
  } catch (e) {}
};

// The shape the rest of the app reads (id, names, photo, email, join date)
const toUser = (u) => u && {
  id: u.uid,
  fullName: u.displayName || "",
  firstName: (u.displayName || "").split(" ")[0] || "",
  imageUrl: u.photoURL || null,
  email: u.email || "",
  primaryEmailAddress: { emailAddress: u.email || "" },
  createdAt: u.metadata?.creationTime || null,
  providers: (u.providerData || []).map((p) => p.providerId),
};

// Friendly messages for the errors people actually hit
export const authErrorMessage = (err) => {
  const code = err?.code || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "That email and password don't match an account.";
  }
  if (code.includes("email-already-in-use")) return "There's already an account with this email. Sign in instead.";
  if (code.includes("weak-password")) return "Use a password with at least 6 characters.";
  if (code.includes("invalid-email")) return "That doesn't look like an email address.";
  if (code.includes("too-many-requests")) return "Too many attempts. Wait a minute and try again.";
  if (code.includes("network-request-failed")) return "No connection. Check your internet and try again.";
  if (code.includes("popup-closed") || code.includes("cancelled") || /cancel/i.test(err?.message || "")) return null;
  if (code.includes("operation-not-allowed") || code.includes("configuration-not-found")) {
    return "This sign-in method isn't switched on yet.";
  }
  if (code.includes("requires-recent-login")) return "For your security, sign in again and then retry.";
  // Google Play services codes from the native picker: 10 = app not registered (fingerprint /
  // client ID), 16 = the picker could not finish (sign-in method not set up or interrupted)
  if (/\[(10|16)\]|reauth failed|DEVELOPER_ERROR/i.test(err?.message || "")) {
    return "Google sign-in isn't ready for this app yet. Try email, or continue as a guest for now.";
  }
  return err?.message || "Something went wrong. Please try again.";
};

// Google: the phone's own account picker in the app, a popup on the website
async function googleCredential() {
  const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
  const result = await FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: true });
  const idToken = result?.credential?.idToken;
  if (!idToken) throw Object.assign(new Error("Google sign-in was cancelled"), { code: "auth/cancelled" });
  return GoogleAuthProvider.credential(idToken, result.credential.accessToken);
}

export function AuthProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isGuest, setIsGuest] = useState(false);
  const [, setVersion] = useState(0); // re-render after profile edits (same user object)

  useEffect(() => {
    setIsGuest(readGuest());
    if (!auth) {
      setIsLoaded(true);
      return;
    }
    return onAuthStateChanged(auth, (u) => {
      setFirebaseUser(u);
      if (u) {
        setIsGuest(false);
        writeGuest(false);
      }
      setIsLoaded(true);
    });
  }, []);

  const actions = useMemo(() => ({
    async signInWithGoogle() {
      if (!auth) throw new Error("Accounts aren't available right now.");
      if (isMobileApp) return signInWithCredential(auth, await googleCredential());
      return signInWithPopup(auth, new GoogleAuthProvider());
    },
    signInWithEmail: (email, password) => signInWithEmailAndPassword(auth, email.trim(), password),
    async signUpWithEmail(name, email, password) {
      const { user } = await createUserWithEmailAndPassword(auth, email.trim(), password);
      if (name?.trim()) {
        await updateProfile(user, { displayName: name.trim() });
        setVersion((v) => v + 1);
      }
      return user;
    },
    resetPassword: (email) => sendPasswordResetEmail(auth, email.trim()),
    continueAsGuest() {
      writeGuest(true);
      setIsGuest(true);
    },
    // Back to the sign-in screen (also used for "Sign in" from guest mode)
    async signOut() {
      writeGuest(false);
      setIsGuest(false);
      if (isMobileApp) {
        // Also forget the phone's chosen Google account, so "switch account" offers the picker again
        import("@capacitor-firebase/authentication")
          .then(({ FirebaseAuthentication }) => FirebaseAuthentication.signOut())
          .catch(() => {});
      }
      if (auth?.currentUser) await firebaseSignOut(auth);
    },
    async updateDisplayName(name) {
      if (!auth?.currentUser) return;
      await updateProfile(auth.currentUser, { displayName: name.trim() });
      setVersion((v) => v + 1);
    },
    // Deleting needs a fresh sign-in; Google accounts confirm with the picker/popup again
    async deleteAccount() {
      const user = auth?.currentUser;
      if (!user) return;
      try {
        await deleteUser(user);
      } catch (err) {
        if (!String(err?.code).includes("requires-recent-login")) throw err;
        if (!user.providerData.some((p) => p.providerId === "google.com")) throw err;
        if (isMobileApp) await reauthenticateWithCredential(user, await googleCredential());
        else await reauthenticateWithPopup(user, new GoogleAuthProvider());
        await deleteUser(user);
      }
      writeGuest(false);
      setIsGuest(false);
    },
  }), []);

  const value = {
    isLoaded,
    isSignedIn: !!firebaseUser,
    isGuest: !firebaseUser && isGuest,
    // Signed-out and not a guest: show the sign-in screen
    needsSignIn: isLoaded && !firebaseUser && !isGuest,
    user: toUser(firebaseUser),
    available: !!auth,
    ...actions,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

const useAuthContext = () => useContext(AuthContext) || {
  isLoaded: true, isSignedIn: false, isGuest: true, needsSignIn: false, user: null, available: false,
};

// { isLoaded, isSignedIn, user }
export function useUser() {
  const { isLoaded, isSignedIn, user } = useAuthContext();
  return { isLoaded, isSignedIn, user };
}

// Everything: state plus sign-in / sign-out actions
export const useAccount = useAuthContext;
