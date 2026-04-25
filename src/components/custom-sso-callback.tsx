"use client";

import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

type CustomSsoCallbackProps = {
  flow: "sign-in" | "sign-up";
};

export function CustomSsoCallback({ flow }: CustomSsoCallbackProps) {
  return (
    <>
      <AuthenticateWithRedirectCallback
        signInUrl="/sign-in"
        signUpUrl="/sign-up"
        transferable={flow === "sign-up"}
      />
      <div id="clerk-captcha" className="custom-auth-captcha" data-cl-theme="light" data-cl-size="flexible" />
    </>
  );
}
