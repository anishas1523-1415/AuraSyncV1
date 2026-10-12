"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "@/lib/auth";
import AuthScreen from "@/components/AuthScreen";

export default function SignUpPage() {
  const router = useRouter();
  const { isSignedIn } = useAccount();

  useEffect(() => {
    if (isSignedIn) router.replace("/");
  }, [isSignedIn]);

  return <AuthScreen initialMode="signup" onDone={() => router.replace("/")} />;
}
