import { CustomAuthForm } from "@/components/custom-auth-form";

export default function SignUpPage() {
  return (
    <main className="auth-page">
      <CustomAuthForm mode="sign-up" />
    </main>
  );
}
