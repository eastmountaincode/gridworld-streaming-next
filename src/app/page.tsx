import { auth } from "@clerk/nextjs/server";

import { GridworldHome } from "@/components/gridworld-home";
import { listAlbums } from "@/lib/content";
import { getProfileByClerkId } from "@/lib/profiles";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { userId } = await auth();
  const profile = userId ? await getProfileByClerkId(userId) : null;
  const hasAccessToken = Boolean(profile?.has_access_token);
  const albums = await safeListAlbums(hasAccessToken);

  return <GridworldHome albums={albums} hasAccessToken={hasAccessToken} />;
}

async function safeListAlbums(includePremium: boolean) {
  try {
    return await listAlbums({ includePremium });
  } catch (error) {
    console.warn("Catalog unavailable:", error);
    return [];
  }
}
