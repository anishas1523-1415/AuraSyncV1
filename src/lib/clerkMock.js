"use client";
import React from "react";

export const mockUser = {
  isLoaded: true,
  isSignedIn: true,
  user: {
    id: "mock_user_123",
    firstName: "Aura",
    lastName: "User",
    fullName: "Aura User",
    imageUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&q=80",
    createdAt: "2026-05-20T12:00:00.000Z",
    primaryEmailAddress: {
      emailAddress: "aurauser@aurasynq.app"
    }
  }
};

export const mockAuth = {
  isLoaded: true,
  isSignedIn: true,
  userId: "mock_user_123"
};

export const mockClerk = {
  signOut: (opts) => {
    console.log("AuraSynq Auth: Signing out...");
    if (typeof window !== "undefined") {
      window.location.href = "/";
    }
  }
};

export function MockClerkProvider({ children }) {
  return <>{children}</>;
}

export function MockUserButton() {
  return (
    <div 
      style={{
        width: "42px",
        height: "42px",
        borderRadius: "50%",
        border: "2px solid rgba(255,255,255,0.12)",
        backgroundImage: "url(https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&q=80)",
        backgroundSize: "cover",
        backgroundPosition: "center",
        cursor: "pointer"
      }}
    />
  );
}

export function MockSignIn() {
  const handleLogin = () => {
    if (typeof window !== "undefined") {
      window.location.href = "/";
    }
  };
  
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", padding: "2rem", background: "rgba(255,255,255,0.03)", borderRadius: "20px", border: "1px solid rgba(255,255,255,0.08)" }}>
      <h2>Sign In to AuraSynq</h2>
      <p style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.9rem" }}>Local Mock Mode Active</p>
      <button 
        onClick={handleLogin}
        style={{ padding: "0.75rem 2rem", borderRadius: "10px", background: "#a855f7", color: "white", border: "none", fontWeight: "bold", cursor: "pointer" }}
      >
        Sign In with Mock Account
      </button>
    </div>
  );
}

export function MockSignUp() {
  const handleSignUp = () => {
    if (typeof window !== "undefined") {
      window.location.href = "/";
    }
  };
  
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", padding: "2rem", background: "rgba(255,255,255,0.03)", borderRadius: "20px", border: "1px solid rgba(255,255,255,0.08)" }}>
      <h2>Sign Up for AuraSynq</h2>
      <p style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.9rem" }}>Local Mock Mode Active</p>
      <button 
        onClick={handleSignUp}
        style={{ padding: "0.75rem 2rem", borderRadius: "10px", background: "#ec4899", color: "white", border: "none", fontWeight: "bold", cursor: "pointer" }}
      >
        Create Mock Account
      </button>
    </div>
  );
}
