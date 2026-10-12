"use client";
import { useAccount } from "@/lib/auth";
import AuthScreen from "./AuthScreen";

// Shows the sign-in screen until the listener signs in or chooses guest mode. While the saved
// session is read (a fraction of a second) only the logo shows, so signed-in people never see
// the sign-in screen flash.
export default function AuthGate({ children }) {
  const { isLoaded, needsSignIn } = useAccount();

  if (!isLoaded) {
    return (
      <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <img
          src="/logo-emblem.png"
          alt=""
          width={96}
          height={78}
          style={{ animation: "pulse 1.6s ease-in-out infinite", filter: "drop-shadow(0 0 18px rgba(168, 85, 247, 0.35))" }}
        />
      </div>
    );
  }
  if (needsSignIn) return <AuthScreen />;
  return children;
}
