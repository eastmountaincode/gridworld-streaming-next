import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
};

export default nextConfig;

if (process.env.USE_OPENNEXT_DEV_BINDINGS === "1") {
  const requireOpenNext = eval("require") as NodeRequire;
  const { initOpenNextCloudflareForDev } = requireOpenNext("@opennextjs/cloudflare") as typeof import("@opennextjs/cloudflare");
  initOpenNextCloudflareForDev();
}
