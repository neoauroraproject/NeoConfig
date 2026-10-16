/**
 * Reset the owner (or any admin) password from the server shell.
 * Used by `neoconfig password`:
 *   printf '%s' "$PASSWORD" | [NEW_EMAIL='…'] [TARGET_EMAIL='…'] node dist/cli/reset-password.js
 * The password arrives on stdin (or NEW_PASSWORD) so it never shows up in `ps`.
 */
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

async function main() {
  const password = process.env.NEW_PASSWORD ?? (await readStdin());
  const newEmail = process.env.NEW_EMAIL?.trim().toLowerCase();
  const target = process.env.TARGET_EMAIL?.trim().toLowerCase();
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  const prisma = new PrismaClient();
  try {
    const user = target
      ? await prisma.user.findUnique({ where: { email: target } })
      : await prisma.user.findFirst({ where: { role: Role.SUPER_ADMIN }, orderBy: { createdAt: 'asc' } });
    if (!user) throw new Error(target ? `No account with email ${target}` : 'No owner account found');

    if (newEmail && newEmail !== user.email) {
      const taken = await prisma.user.findUnique({ where: { email: newEmail } });
      if (taken) throw new Error(`${newEmail} is already used by another account`);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(password, 12),
        ...(newEmail ? { email: newEmail } : {}),
      },
    });
    // Sign out everywhere the old password was used.
    await prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    console.log(`OK ${newEmail || user.email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(`ERROR ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
