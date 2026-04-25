import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { getOptionalEnv, getRequiredEnv } from "@/lib/cloudflare";
import { ensureCurrentProfile } from "@/lib/profiles";
import { getStripe } from "@/lib/stripe";

export async function POST(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Sign in before starting checkout." }, { status: 401 });
  }

  const profile = await ensureCurrentProfile();
  const appUrl = getOptionalEnv("NEXT_PUBLIC_APP_URL") ?? new URL(request.url).origin;

  const session = await getStripe().checkout.sessions.create({
    line_items: [
      {
        price: getAccessTokenPriceId(),
        quantity: 1,
      },
    ],
    mode: "payment",
    success_url: `${appUrl}/payment-result?status=success`,
    cancel_url: `${appUrl}/payment-result?status=cancel`,
    metadata: {
      clerkUserId: userId,
      profileId: String(profile.id),
      product: "gridworld-access-token",
    },
  });

  return NextResponse.json({ url: session.url });
}

function getAccessTokenPriceId() {
  return getOptionalEnv("STRIPE_ACCESS_PRICE_ID") ?? getRequiredEnv("ACCESS_TOKEN_PRICE_ID");
}
