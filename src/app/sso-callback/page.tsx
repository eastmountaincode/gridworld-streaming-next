import { CustomSsoCallback } from "@/components/custom-sso-callback";

type SsoCallbackPageProps = {
  searchParams: Promise<{
    flow?: string | string[];
  }>;
};

export default async function SsoCallbackPage({ searchParams }: SsoCallbackPageProps) {
  const params = await searchParams;
  const flow = Array.isArray(params.flow) ? params.flow[0] : params.flow;
  const authFlow = flow === "sign-up" ? "sign-up" : "sign-in";

  return (
    <main className="auth-page">
      <CustomSsoCallback flow={authFlow} />
    </main>
  );
}
