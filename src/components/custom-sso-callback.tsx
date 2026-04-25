"use client";

import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

type CustomSsoCallbackProps = {
  flow: "sign-in" | "sign-up";
};

export function CustomSsoCallback({ flow }: CustomSsoCallbackProps) {
  const signInUrl = flow === "sign-in" ? "/sign-in?auth_reason=google-no-account" : "/sign-in";
  const signUpUrl = flow === "sign-up" ? "/sign-up?auth_reason=google-existing-account" : "/sign-up";

  return (
    <>
      <AuthenticateWithRedirectCallback
        signInUrl={signInUrl}
        signUpUrl={signUpUrl}
        transferable={false}
      />
      <div id="clerk-captcha" className="custom-auth-captcha" data-cl-theme="light" data-cl-size="flexible" />
    </>
  );
}
