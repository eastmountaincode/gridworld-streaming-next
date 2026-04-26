"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function PaymentResult() {
  const router = useRouter();
  const [message, setMessage] = useState("Confirming payment...");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    const sessionId = params.get("session_id");

    if (status !== "success") {
      router.replace("/");
      return;
    }

    if (!sessionId) {
      queueMicrotask(() => {
        setMessage("Payment was completed, but the checkout session was missing.");
      });
      return;
    }

    let cancelled = false;

    async function confirmCheckout() {
      try {
        const response = await fetch("/api/checkout/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });

        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data.error ?? "Unable to confirm payment.");
        }

        if (!cancelled) {
          router.replace("/");
          router.refresh();
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "Unable to confirm payment.");
        }
      }
    }

    void confirmCheckout();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="auth-page">
      <section className="custom-auth-card">
        <p className="custom-auth-error">{message}</p>
      </section>
    </main>
  );
}
