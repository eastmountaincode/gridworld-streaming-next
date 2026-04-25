import { currentUser } from "@clerk/nextjs/server";

import { getDb } from "@/lib/cloudflare";

export type Profile = {
  id: number;
  clerk_user_id: string;
  legacy_user_id: string | null;
  email: string | null;
  has_access_token: number;
  stripe_customer_id: string | null;
  created_at: string;
};

export async function getProfileByClerkId(clerkUserId: string): Promise<Profile | null> {
  return getDb()
    .prepare(
      `SELECT id, clerk_user_id, legacy_user_id, email, has_access_token, stripe_customer_id, created_at
       FROM profiles
       WHERE clerk_user_id = ?`,
    )
    .bind(clerkUserId)
    .first<Profile>();
}

export async function ensureCurrentProfile(): Promise<Profile> {
  const user = await currentUser();

  if (!user) {
    throw new Error("Cannot create a profile without an authenticated Clerk user.");
  }

  const email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;

  await getDb()
    .prepare(
      `INSERT INTO profiles (clerk_user_id, email)
       VALUES (?, ?)
       ON CONFLICT(clerk_user_id) DO UPDATE SET
         email = excluded.email,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(user.id, email)
    .run();

  const profile = await getProfileByClerkId(user.id);

  if (!profile) {
    throw new Error("Profile creation did not return a profile.");
  }

  return profile;
}

export async function grantAccessToken(clerkUserId: string, stripeCustomerId?: string | null) {
  await getDb()
    .prepare(
      `INSERT INTO profiles (clerk_user_id, has_access_token, stripe_customer_id)
       VALUES (?, 1, ?)
       ON CONFLICT(clerk_user_id) DO UPDATE SET
         has_access_token = 1,
         stripe_customer_id = COALESCE(excluded.stripe_customer_id, profiles.stripe_customer_id),
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(clerkUserId, stripeCustomerId ?? null)
    .run();
}
