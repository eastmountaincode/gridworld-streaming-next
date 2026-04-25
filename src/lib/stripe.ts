import Stripe from "stripe";

import { getRequiredEnv } from "@/lib/cloudflare";

export function getStripe() {
  return new Stripe(getRequiredEnv("STRIPE_SECRET_KEY"), {
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export const stripeCryptoProvider = Stripe.createSubtleCryptoProvider();
