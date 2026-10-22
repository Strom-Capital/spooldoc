import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const here = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  // The workspace root, so Turbopack resolves the linked @spooldoc packages.
  turbopack: { root: path.resolve(here, '../..') },
  outputFileTracingRoot: path.resolve(here, '../..'),
  // Loaded by Node at runtime, never bundled: the jt400 bridge starts a JVM through
  // the native `java` addon. ssh2 loads its optional native parts at runtime.
  serverExternalPackages: ['@spooldoc/ibmi', 'node-jt400', 'java', 'ssh2'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
