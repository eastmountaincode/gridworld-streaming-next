import { CustomAuthForm } from "@/components/custom-auth-form";

type SignInPageProps = {
  searchParams: Promise<{
    auth_reason?: string | string[];
  }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  const authReason = Array.isArray(params.auth_reason) ? params.auth_reason[0] : params.auth_reason;

  return (
    <main className="auth-page">
      <CustomAuthForm mode="sign-in" initialReason={authReason} />
    </main>
  );
}
