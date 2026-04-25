import { CustomAuthForm } from "@/components/custom-auth-form";

type SignUpPageProps = {
  searchParams: Promise<{
    auth_reason?: string | string[];
  }>;
};

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const params = await searchParams;
  const authReason = Array.isArray(params.auth_reason) ? params.auth_reason[0] : params.auth_reason;

  return (
    <main className="auth-page">
      <CustomAuthForm mode="sign-up" initialReason={authReason} />
    </main>
  );
}
