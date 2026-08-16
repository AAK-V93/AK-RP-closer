/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-neon", "bcryptjs"],
  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/, // Look for .svg files
      use: ["@svgr/webpack"], // Use @svgr/webpack to handle them
    });

    return config; // Always return the modified config
  },
};

export default nextConfig;
