"use client";
import React from "react";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("AuraSynq Client Crash:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: "2rem",
          background: "#0a0a14",
          color: "#ec4899",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          fontFamily: "monospace",
          boxSizing: "border-box"
        }}>
          <h1 style={{ fontSize: "1.8rem", marginBottom: "1rem", color: "#ec4899", textShadow: "0 0 10px rgba(236, 72, 153, 0.4)" }}>⚠️ AuraSynq Crash</h1>
          <p style={{ color: "rgba(255, 255, 255, 0.8)", marginBottom: "1.5rem", maxWidth: "500px", lineHeight: "1.5" }}>
            {this.state.error?.toString() || "Unknown rendering exception occurred."}
          </p>
          <button 
            onClick={() => window.location.reload()}
            style={{
              padding: "0.75rem 2rem",
              background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
              color: "white",
              border: "none",
              borderRadius: "12px",
              fontWeight: "bold",
              cursor: "pointer",
              boxShadow: "0 4px 15px rgba(168, 85, 247, 0.4)"
            }}
          >
            Reload App
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
