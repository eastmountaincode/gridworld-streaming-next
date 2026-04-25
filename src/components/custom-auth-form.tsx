"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useSignIn, useSignUp } from "@clerk/nextjs/legacy";

type AuthMode = "sign-in" | "sign-up";
type AuthStep = "email" | "sign-in-password" | "sign-in-code" | "sign-up-password" | "sign-up-code";

type CustomAuthFormProps = {
  mode: AuthMode;
  initialReason?: string;
};

type FirstFactor = {
  strategy: string;
  emailAddressId?: string;
};

export function CustomAuthForm({ mode, initialReason }: CustomAuthFormProps) {
  const router = useRouter();
  const signInState = useSignIn();
  const signUpState = useSignUp();
  const [step, setStep] = useState<AuthStep>("email");
  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isLoaded = signInState.isLoaded && signUpState.isLoaded;
  const isSignIn = mode === "sign-in";
  const title = isSignIn ? "Sign in to Gridworld Streaming" : "Create your Gridworld Streaming account";
  const subtitle = isSignIn ? "Enter your email to continue." : "Use your email to start an account.";
  const googleLabel = isSignIn ? "Sign in with Google" : "Create account with Google";
  const alternateHref = isSignIn ? "/sign-up" : "/sign-in";
  const alternateText = isSignIn ? "Need an account?" : "Already have an account?";
  const alternateAction = isSignIn ? "Create one" : "Sign in";
  const notice = error || getAuthNotice(initialReason, isSignIn);

  const finishAuth = async (sessionId: string | null | undefined) => {
    if (!sessionId) {
      setError("Authentication completed without a session.");
      return;
    }

    const setActive = isSignIn ? signInState.setActive : signUpState.setActive;
    if (!setActive) {
      setError("Clerk is still loading.");
      return;
    }

    await setActive({ session: sessionId });
    router.push("/");
    router.refresh();
  };

  const handleEmailSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!isLoaded) {
      return;
    }

    await submit(async () => {
      if (isSignIn) {
        const result = await signInState.signIn.create({ identifier: emailAddress.trim() });

        if (result.status === "complete") {
          await finishAuth(result.createdSessionId);
          return;
        }

        const factors = (result.supportedFirstFactors ?? []) as FirstFactor[];
        const passwordFactor = factors.find((factor) => factor.strategy === "password");
        const emailCodeFactor = factors.find((factor) => factor.strategy === "email_code");
        const resetPasswordFactor = factors.find((factor) => factor.strategy.startsWith("reset_password_"));

        if (passwordFactor) {
          setStep("sign-in-password");
          return;
        }

        if (emailCodeFactor?.emailAddressId) {
          await signInState.signIn.prepareFirstFactor({
            strategy: "email_code",
            emailAddressId: emailCodeFactor.emailAddressId,
          });
          setStep("sign-in-code");
          return;
        }

        if (resetPasswordFactor || result.status === "needs_new_password") {
          setError(
            "This email has an account, but password sign-in is not set up yet. Use Google with this email, or create an account to finish setup.",
          );
          return;
        }

        setError("This account does not have a supported sign-in method.");
        return;
      }

      const result = await signUpState.signUp.create({ emailAddress: emailAddress.trim() });
      await continueSignUp(result.status, result.createdSessionId, result.missingFields, result.unverifiedFields);
    });
  };

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!isLoaded) {
      return;
    }

    await submit(async () => {
      if (step === "sign-in-password") {
        const result = await signInState.signIn.attemptFirstFactor({ strategy: "password", password });

        if (result.status === "complete") {
          await finishAuth(result.createdSessionId);
          return;
        }

        setError("Additional verification is required for this account.");
        return;
      }

      const result = await signUpState.signUp.update({ password });
      await continueSignUp(result.status, result.createdSessionId, result.missingFields, result.unverifiedFields);
    });
  };

  const handleCodeSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!isLoaded) {
      return;
    }

    await submit(async () => {
      if (step === "sign-in-code") {
        const result = await signInState.signIn.attemptFirstFactor({ strategy: "email_code", code: code.trim() });

        if (result.status === "complete") {
          await finishAuth(result.createdSessionId);
          return;
        }

        setError("Additional verification is required for this account.");
        return;
      }

      const result = await signUpState.signUp.attemptEmailAddressVerification({ code: code.trim() });
      await continueSignUp(result.status, result.createdSessionId, result.missingFields, result.unverifiedFields);
    });
  };

  const continueSignUp = async (
    status: string | null,
    sessionId: string | null,
    missingFields: string[],
    unverifiedFields: string[],
  ) => {
    if (status === "complete") {
      await finishAuth(sessionId);
      return;
    }

    if (missingFields.includes("password")) {
      setStep("sign-up-password");
      return;
    }

    if (unverifiedFields.includes("email_address") || unverifiedFields.includes("emailAddress")) {
      if (!signUpState.signUp) {
        setError("Clerk is still loading.");
        return;
      }

      await signUpState.signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setStep("sign-up-code");
      return;
    }

    setError("Unable to finish creating the account.");
  };

  const handleGoogleAuth = async () => {
    if (!isLoaded) {
      return;
    }

    await submit(async () => {
      if (isSignIn) {
        await signInState.signIn.authenticateWithRedirect({
          strategy: "oauth_google",
          redirectUrl: "/sso-callback?flow=sign-in",
          redirectUrlComplete: "/",
        });
      } else {
        await signUpState.signUp.authenticateWithRedirect({
          strategy: "oauth_google",
          redirectUrl: "/sso-callback?flow=sign-up",
          redirectUrlComplete: "/",
        });
      }
    });
  };

  const submit = async (action: () => Promise<void>) => {
    setError("");
    setIsSubmitting(true);

    try {
      await action();
    } catch (authError) {
      setError(getAuthErrorMessage(authError));
    } finally {
      setIsSubmitting(false);
    }
  };

  const backToEmail = () => {
    setStep("email");
    setPassword("");
    setCode("");
    setError("");
  };

  return (
    <section className="custom-auth-card" aria-labelledby="auth-title">
      <div className="custom-auth-header">
        <h1 id="auth-title">{title}</h1>
        <p>{subtitle}</p>
      </div>

      <button
        type="button"
        className="custom-auth-google"
        onClick={handleGoogleAuth}
        disabled={!isLoaded || isSubmitting}
      >
        <span aria-hidden="true">G</span>
        {googleLabel}
      </button>

      <div className="custom-auth-divider">
        <span />
        <p>or</p>
        <span />
      </div>

      {step === "email" ? (
        <form className="custom-auth-form" onSubmit={handleEmailSubmit}>
          <label htmlFor="auth-email">Email address</label>
          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            value={emailAddress}
            onChange={(event) => setEmailAddress(event.target.value)}
            required
          />
          {!isSignIn ? (
            <div
              id="clerk-captcha"
              className="custom-auth-captcha"
              data-cl-theme="light"
              data-cl-size="flexible"
            />
          ) : null}
          <button type="submit" className="custom-auth-submit" disabled={!isLoaded || isSubmitting}>
            Continue
          </button>
        </form>
      ) : null}

      {step === "sign-in-password" || step === "sign-up-password" ? (
        <form className="custom-auth-form" onSubmit={handlePasswordSubmit}>
          <button type="button" className="custom-auth-back" onClick={backToEmail}>
            Change email
          </button>
          <label htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            type="password"
            autoComplete={isSignIn ? "current-password" : "new-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {!isSignIn ? (
            <div
              id="clerk-captcha"
              className="custom-auth-captcha"
              data-cl-theme="light"
              data-cl-size="flexible"
            />
          ) : null}
          <button type="submit" className="custom-auth-submit" disabled={!isLoaded || isSubmitting}>
            {isSignIn ? "Sign in" : "Create account"}
          </button>
        </form>
      ) : null}

      {step === "sign-in-code" || step === "sign-up-code" ? (
        <form className="custom-auth-form" onSubmit={handleCodeSubmit}>
          <button type="button" className="custom-auth-back" onClick={backToEmail}>
            Change email
          </button>
          <label htmlFor="auth-code">Verification code</label>
          <input
            id="auth-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
          />
          <button type="submit" className="custom-auth-submit" disabled={!isLoaded || isSubmitting}>
            Verify
          </button>
        </form>
      ) : null}

      {notice ? <p className="custom-auth-error">{notice}</p> : null}

      <p className="custom-auth-footer">
        {alternateText} <Link href={alternateHref}>{alternateAction}</Link>
      </p>
    </section>
  );
}

function getAuthErrorMessage(error: unknown) {
  const code = getAuthErrorCode(error);

  if (code === "form_identifier_not_found" || code === "external_account_not_found") {
    return "No account exists for that email yet. Create an account to continue.";
  }

  if (
    code === "form_identifier_exists" ||
    code === "form_identifier_exists__email_address" ||
    code === "identifier_already_exists"
  ) {
    return "An account already exists for that email. Sign in instead.";
  }

  if (isUnsupportedClerkResponse(error)) {
    return "No account exists for that email yet. Create an account to continue.";
  }

  if (
    error &&
    typeof error === "object" &&
    "errors" in error &&
    Array.isArray(error.errors) &&
    error.errors[0] &&
    typeof error.errors[0] === "object" &&
    "message" in error.errors[0]
  ) {
    return String(error.errors[0].message);
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unable to complete authentication.";
}

function getAuthNotice(reason: string | undefined, isSignIn: boolean) {
  if (reason === "google-no-account") {
    return "No account exists for that email yet. Create an account to continue.";
  }

  if (reason === "google-existing-account") {
    return "An account already exists for that email. Sign in instead.";
  }

  if (reason === "oauth-cancelled") {
    return isSignIn ? "Google sign-in was cancelled." : "Google account creation was cancelled.";
  }

  return "";
}

function getAuthErrorCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "errors" in error &&
    Array.isArray(error.errors) &&
    error.errors[0] &&
    typeof error.errors[0] === "object" &&
    "code" in error.errors[0]
  ) {
    return String(error.errors[0].code);
  }

  return "";
}

function isUnsupportedClerkResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.includes("ClerkJS: Response: 0 not supported yet");
}
