import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

export default function SsoCallbackPage() {
  return (
    <main className="auth-page">
      <AuthenticateWithRedirectCallback />
    </main>
  );
}
