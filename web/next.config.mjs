/** @type {import('next').NextConfig} */
// One id per build, baked into both the pages and /api/version, so an open tab can tell
// a newer deploy is live («Hay una versión nueva · Recargar»).
const BUILD_ID =
  process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || `local-${Date.now()}`;

const nextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-neon", "bcryptjs", "web-push", "unpdf"],
  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/,
      use: ["@svgr/webpack"],
    });

    return config;
  },
  async redirects() {
    return [
      { source: "/practica", destination: "/practicar", permanent: false },
      { source: "/oferta", destination: "/ofertas", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Cache-Control", value: "no-cache" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Content-Type", value: "application/manifest+json" }],
      },
    ];
  },
};

export default nextConfig;
