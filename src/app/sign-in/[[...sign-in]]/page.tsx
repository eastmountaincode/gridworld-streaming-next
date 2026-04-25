import { CustomAuthForm } from "@/components/custom-auth-form";

export default function SignInPage() {
  return (
    <main className="auth-page">
      <CustomAuthForm mode="sign-in" />
    </main>
  );
}
