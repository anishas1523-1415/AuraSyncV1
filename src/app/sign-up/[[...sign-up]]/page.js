import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      background: "linear-gradient(145deg, #1a0533 0%, #0d0d1a 50%, #0a0a12 100%)",
      padding: "1rem"
    }}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{
          fontSize: "2rem",
          fontWeight: 800,
          background: "linear-gradient(135deg, #a855f7, #ec4899)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          marginBottom: "0.25rem",
          letterSpacing: "-0.5px"
        }}>AuraSynq</h1>
        <p style={{
          color: "#a1a1aa",
          fontSize: "0.9rem",
          marginBottom: "1.5rem"
        }}>Create your account</p>
        <SignUp 
          appearance={{
            variables: {
              colorPrimary: "#a855f7",
              colorBackground: "#18181b",
              colorInputBackground: "#27272a",
              colorText: "#fafafa",
              colorTextSecondary: "#a1a1aa",
              colorInputText: "#fafafa",
              borderRadius: "12px",
              fontSize: "0.95rem"
            },
            elements: {
              card: { 
                backgroundColor: "#18181b",
                border: "1px solid #3f3f46",
                boxShadow: "0 25px 50px rgba(0,0,0,0.5)"
              },
              headerTitle: { color: "#fafafa", fontSize: "1.2rem" },
              headerSubtitle: { color: "#a1a1aa" },
              socialButtonsBlockButton: { 
                backgroundColor: "#27272a",
                border: "1px solid #3f3f46",
                color: "#fafafa"
              },
              socialButtonsBlockButtonText: { color: "#fafafa" },
              formFieldLabel: { color: "#d4d4d8" },
              formFieldInput: { 
                backgroundColor: "#27272a",
                border: "1px solid #3f3f46",
                color: "#fafafa"
              },
              footerActionLink: { color: "#c084fc" },
              footerActionText: { color: "#a1a1aa" },
              dividerLine: { backgroundColor: "#3f3f46" },
              dividerText: { color: "#71717a" },
              formButtonPrimary: {
                backgroundColor: "#a855f7",
                color: "#ffffff",
                fontWeight: 600
              }
            }
          }}
        />
      </div>
    </div>
  );
}
