import type { NextConfig } from 'next';

const API = process.env.API_INTERNAL_URL || 'http://localhost:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  async rewrites() {
    return [
      { source: '/install.sh', destination: '/api/install.sh' },
      // Same-origin API for every storefront domain (the proxy does this in production too).
      { source: '/api/v1/:path*', destination: `${API}/api/v1/:path*` },
    ];
  },
};

export default nextConfig;
