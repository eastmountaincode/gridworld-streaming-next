import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { getDb, getRequiredEnv } from "@/lib/cloudflare";
import { grantAccessToken } from "@/lib/profiles";
import { getStripe, stripeCryptoProvider } from "@/lib/stripe";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });
  }

  const body = await request.text();
  let event: Stripe.Event;

  try {
    event = await getStripe().webhooks.constructEventAsync(
      body,
      signature,
      getRequiredEnv("STRIPE_WEBHOOK_SECRET"),
      undefined,
      stripeCryptoProvider,
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid Stripe webhook." },
      { status: 400 },
    );
  }

  const alreadyProcessed = await getDb()
    .prepare("SELECT id FROM stripe_events WHERE id = ?")
    .bind(event.id)
    .first<{ id: string }>();

  if (alreadyProcessed) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const clerkUserId = session.metadata?.clerkUserId;

    if (!clerkUserId) {
      return NextResponse.json({ error: "Missing clerkUserId metadata." }, { status: 400 });
    }

    const stripeCustomerId =
      typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;

    await grantAccessToken(clerkUserId, stripeCustomerId);
  }

  await getDb()
    .prepare("INSERT INTO stripe_events (id, type) VALUES (?, ?)")
    .bind(event.id, event.type)
    .run();

  return NextResponse.json({ received: true });
}
