import { SignUp } from "@clerk/nextjs";

import { gridworldClerkAppearance } from "@/lib/clerk-appearance";

export default function SignUpPage() {
  return (
    <main className="auth-page">
      <SignUp
        appearance={gridworldClerkAppearance}
        routing="path"
        path="/sign-up"
        signInUrl="/sign-in"
        fallbackRedirectUrl="/"
      />
    </main>
  );
}
