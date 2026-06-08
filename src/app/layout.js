import "./globals.css";
import { Inter } from "next/font/google";
import AppShell from "@/components/AppShell";
import { AudioProvider } from "@/contexts/AudioContext";
import { ClerkProvider } from "@/lib/clerk";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Suspense } from "react";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "AuraSynq",
  description: "Immersive Social Music App",
  manifest: "/manifest.json",
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export const viewport = {
  themeColor: "#050505",
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: "window.Capacitor = window.Capacitor || {}; if (typeof window.Capacitor.triggerEvent !== 'function') { window.Capacitor.triggerEvent = function () { return false; }; }" }} />
      </head>
      <body className={inter.className}>
        <ClerkProvider>
          <ErrorBoundary>
            <AudioProvider>
              <div className="app-container">
                <main className="main-content" style={{ paddingBottom: "0" }}>
                  {children}
                </main>
                <Suspense fallback={null}>
                  <AppShell />
                </Suspense>
              </div>
            </AudioProvider>
          </ErrorBoundary>
        </ClerkProvider>
      </body>
    </html>
  );
}
