import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { grantAccessToken } from "@/lib/profiles";
import { getStripe } from "@/lib/stripe";

export async function POST(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Sign in before confirming checkout." }, { status: 401 });
  }

  const { sessionId } = (await request.json()) as { sessionId?: string };

  if (!sessionId) {
    return NextResponse.json({ error: "Missing checkout session." }, { status: 400 });
  }

  const session = await getStripe().checkout.sessions.retrieve(sessionId);
  const sessionUserId = session.metadata?.clerkUserId ?? session.client_reference_id;

  if (sessionUserId !== userId) {
    return NextResponse.json({ error: "Checkout session does not belong to this account." }, { status: 403 });
  }

  if (session.mode !== "payment" || session.payment_status !== "paid") {
    return NextResponse.json({ error: "Payment is not complete yet." }, { status: 409 });
  }

  await grantAccessToken(userId, getStripeCustomerId(session.customer));

  return NextResponse.json({ complete: true });
}

function getStripeCustomerId(customer: Stripe.Checkout.Session["customer"]) {
  if (!customer) {
    return null;
  }

  return typeof customer === "string" ? customer : customer.id;
}
