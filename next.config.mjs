/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  async redirects() {
    return [{ source: "/scents", destination: "/", permanent: true }];
  },
};
export default nextConfig;
