import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { getRequiredEnv } from "@/lib/cloudflare";
import { ensureCurrentProfile } from "@/lib/profiles";
import { getStripe } from "@/lib/stripe";

export async function POST() {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Sign in before starting checkout." }, { status: 401 });
  }

  const profile = await ensureCurrentProfile();
  const appUrl = getRequiredEnv("NEXT_PUBLIC_APP_URL");

  const session = await getStripe().checkout.sessions.create({
    line_items: [
      {
        price: getRequiredEnv("STRIPE_ACCESS_PRICE_ID"),
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
