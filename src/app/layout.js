import "./globals.css";
import { Inter } from "next/font/google";
import AppShell from "@/components/AppShell";
import { AudioProvider } from "@/contexts/AudioContext";
import { ClerkProvider } from "@clerk/nextjs";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "AuraSynq",
  description: "Immersive Social Music App",
  manifest: "/manifest.json",
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
    <ClerkProvider>
      <html lang="en">
        <body className={inter.className}>
          <AudioProvider>
            <div className="app-container">
              <main className="main-content" style={{ paddingBottom: "0" }}>
                {children}
              </main>
              <AppShell />
            </div>
          </AudioProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
