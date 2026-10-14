import { readFile } from 'fs/promises';
import path from 'path';

export async function GET() {
  // Prefer repo scripts/install.sh when available in deployment image
  const candidates = [
    path.join(process.cwd(), '../../scripts/install.sh'),
    path.join(process.cwd(), 'scripts/install.sh'),
    path.join(process.cwd(), 'public/install.sh'),
  ];

  for (const file of candidates) {
    try {
      const body = await readFile(file, 'utf8');
      return new Response(body, {
        headers: {
          'Content-Type': 'text/x-shellscript; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    } catch {
      // try next
    }
  }

  return new Response('#!/usr/bin/env bash\necho "install.sh not packaged" >&2\nexit 1\n', {
    status: 404,
    headers: { 'Content-Type': 'text/x-shellscript; charset=utf-8' },
  });
}
