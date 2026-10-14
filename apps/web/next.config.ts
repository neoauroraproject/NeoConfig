import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/install.sh',
        destination: '/api/install.sh',
      },
    ];
  },
};

export default nextConfig;
