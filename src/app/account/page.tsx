import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { ensureCurrentProfile } from "@/lib/profiles";

export default async function AccountPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  const profile = await ensureCurrentProfile();

  return (
    <main className="account-page">
      <h1>Account Information</h1>
      <p>Email: {profile.email ?? "No email on file"}</p>
      <p>Access Token: {profile.has_access_token ? "Yes" : "No"}</p>
      <p>Created on: {formatDate(profile.created_at)}</p>
    </main>
  );
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleDateString("en-US");
}
