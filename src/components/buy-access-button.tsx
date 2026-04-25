"use client";

/* eslint-disable @next/next/no-img-element */

import { useUser } from "@clerk/nextjs";
import { useState } from "react";

export function BuyAccessButton() {
  const { isSignedIn } = useUser();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout() {
    if (!isSignedIn) {
      setError("Please log in or create an account first.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/checkout", { method: "POST" });
      const data = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !data.url) {
        throw new Error(data.error ?? "Unable to start checkout.");
      }

      window.location.assign(data.url);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Unable to start checkout.");
      setIsLoading(false);
    }
  }

  return (
    <div className="buy-access-module">
      <div className="buy-access-token">
        <button
          type="button"
          onClick={startCheckout}
          disabled={isLoading}
          className="legacy-button buy-access-button"
        >
          {isLoading ? "Opening Stripe..." : "Buy Access Token"}
        </button>
        <img src="/images/access_token/bounce_2.gif" alt="Token" className="buy-token-image" />
      </div>
      {error ? <p className="buy-access-error">{error}</p> : null}
    </div>
  );
}
