import type { Metadata } from "next";
import localFont from "next/font/local";
import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import "./globals.css";

import { SiteNav } from "@/components/site-nav";
import { getProfileByClerkId } from "@/lib/profiles";

const goga = localFont({
  src: "../assets/fonts/GogaTest-Regular.otf",
  variable: "--font-goga",
});

const alcala = localFont({
  src: "../assets/fonts/Alcala.ttf",
  variable: "--font-alcala",
});

export const metadata: Metadata = {
  title: "Gridworld Streaming",
  description: "Streaming and downloads for Gridworld releases.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const hasAccessToken = await getNavAccessToken();

  return (
    <html lang="en" className={`${goga.variable} ${alcala.variable} h-full antialiased`}>
      <body className="min-h-full bg-[var(--legacy-orange)] text-black">
        <ClerkProvider
          signInUrl="/sign-in"
          signUpUrl="/sign-up"
          signInFallbackRedirectUrl="/"
          signUpFallbackRedirectUrl="/"
          afterSignOutUrl="/"
        >
          <SiteNav hasAccessToken={hasAccessToken} />
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}

async function getNavAccessToken() {
  try {
    const { userId } = await auth();
    const profile = userId ? await getProfileByClerkId(userId) : null;
    return Boolean(profile?.has_access_token);
  } catch (error) {
    console.warn("Unable to load nav profile:", error);
    return false;
  }
}
