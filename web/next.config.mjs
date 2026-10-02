/** @type {import('next').NextConfig} */
const nextConfig = {
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
