import { SignIn } from "@clerk/nextjs";

import { gridworldClerkAppearance } from "@/lib/clerk-appearance";

export default function SignInPage() {
  return (
    <main className="auth-page">
      <SignIn
        appearance={gridworldClerkAppearance}
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        fallbackRedirectUrl="/"
      />
    </main>
  );
}
