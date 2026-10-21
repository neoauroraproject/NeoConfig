import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Brand } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomInt } from 'crypto';
import { BrandsService } from '../brands/brands.service';
import { decryptSecret, encryptSecret } from '../common/crypto/secret.crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PublicService } from '../public/public.service';

export interface SubRef {
  subId: string;
  url: string;
}

const USERNAME_RE = /^[a-z0-9][a-z0-9_.]{2,31}$/;
const MAX_SUBS = 20;
/** Easy to read out and type on a phone: no 0/o, 1/l/i. */
const PASSWORD_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

export function cleanUsername(raw: string) {
  return String(raw || '').trim().toLowerCase();
}

export function generatePassword(length = 8) {
  let out = '';
  for (let i = 0; i < length; i++) out += PASSWORD_CHARS[randomInt(PASSWORD_CHARS.length)];
  return out;
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Customer logins for a storefront: a username + password that carries the
 * customer's subscription links, so any device can sign in instead of pasting
 * a link. The first link is still how people start; a password comes after,
 * or with a purchase.
 */
@Injectable()
export class CustomersService {
  /** Compared against when the username doesn't exist, so both cases take as long. */
  private readonly dummyHash = bcrypt.hashSync('not-a-password', 10);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly brands: BrandsService,
    private readonly lookup: PublicService,
  ) {}

  private key() {
    return this.config.getOrThrow<string>('ENCRYPTION_KEY');
  }

  private async brand(tenant?: string) {
    const brand = await this.brands.resolve(tenant);
    if (!brand) throw new NotFoundException('No storefront is configured yet');
    return brand;
  }

  /** Only links that really resolve on this brand go into an account (whoever has the link may add it). */
  private async verified(brand: Awaited<ReturnType<BrandsService['resolve']>>, subs: SubRef[]): Promise<SubRef[]> {
    if (!brand) return [];
    const unique = [...new Map(subs.filter((s) => s?.url).map((s) => [s.url, s])).values()].slice(0, MAX_SUBS);
    const checked = await Promise.all(
      unique.map(async (s) => {
        try {
          const r = await this.lookup.lookup(brand, s.url);
          return { subId: (r.subId ?? r.snapshot.subscriptionId ?? s.subId).slice(0, 128), url: s.url };
        } catch {
          return null;
        }
      }),
    );
    return checked.filter((s): s is SubRef => s !== null);
  }

  private async session(accountId: string) {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.customerSession.create({ data: { accountId, tokenHash: hashToken(token) } });
    return token;
  }

  private async subsOf(accountId: string): Promise<SubRef[]> {
    const rows = await this.prisma.customerSub.findMany({ where: { accountId }, orderBy: { createdAt: 'asc' } });
    const key = this.key();
    return rows.flatMap((r) => {
      try {
        return [{ subId: r.subId, url: decryptSecret(r.urlEnc, key) }];
      } catch {
        return [];
      }
    });
  }

  private async addSubs(accountId: string, subs: SubRef[]) {
    const key = this.key();
    const have = await this.prisma.customerSub.count({ where: { accountId } });
    for (const s of subs.slice(0, Math.max(0, MAX_SUBS - have))) {
      await this.prisma.customerSub.upsert({
        where: { accountId_subId: { accountId, subId: s.subId } },
        create: { accountId, subId: s.subId, urlEnc: encryptSecret(s.url, key) },
        update: { urlEnc: encryptSecret(s.url, key) },
      });
    }
  }

  private async view(account: { id: string; username: string }, token?: string) {
    return { username: account.username, subscriptions: await this.subsOf(account.id), ...(token ? { token } : {}) };
  }

  /** The account behind a session token, on this brand. */
  async fromToken(token: string | undefined, brandId?: string) {
    if (!token) throw new UnauthorizedException('Sign in again');
    const s = await this.prisma.customerSession.findUnique({ where: { tokenHash: hashToken(token) }, include: { account: true } });
    if (!s || (brandId && s.account.brandId !== brandId)) throw new UnauthorizedException('Sign in again');
    if (Date.now() - s.lastUsedAt.getTime() > 3_600_000) {
      void this.prisma.customerSession.update({ where: { id: s.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    }
    return s.account;
  }

  /** Set a username + password for the subscriptions on this device. */
  async register(input: { tenant?: string; username: string; password: string; accounts: SubRef[] }) {
    const brand = await this.brand(input.tenant);
    const username = cleanUsername(input.username);
    if (!USERNAME_RE.test(username)) throw new BadRequestException('Username: 3–32 letters, digits, _ or .');
    if (String(input.password || '').length < 6) throw new BadRequestException('Password: at least 6 characters');
    if (await this.prisma.customerAccount.findUnique({ where: { brandId_username: { brandId: brand.id, username } } })) {
      throw new BadRequestException('This username is taken');
    }
    const subs = await this.verified(brand, input.accounts ?? []);
    if (!subs.length) throw new BadRequestException('Add your subscription first');
    const account = await this.prisma.customerAccount.create({
      data: { brandId: brand.id, username, passwordHash: await bcrypt.hash(input.password, 10) },
    });
    await this.addSubs(account.id, subs);
    return this.view(account, await this.session(account.id));
  }

  async login(input: { tenant?: string; username: string; password: string }) {
    const brand = await this.brand(input.tenant);
    const account = await this.prisma.customerAccount.findUnique({
      where: { brandId_username: { brandId: brand.id, username: cleanUsername(input.username) } },
    });
    // Same answer and similar time whether the username exists or not.
    const ok = await bcrypt.compare(String(input.password || ''), account?.passwordHash ?? this.dummyHash);
    if (!account || !ok) throw new UnauthorizedException('Wrong username or password');
    return this.view(account, await this.session(account.id));
  }

  async me(input: { tenant?: string; token: string }) {
    const brand = await this.brand(input.tenant);
    return this.view(await this.fromToken(input.token, brand.id));
  }

  /** Links added on this device join the account; returns everything the account has. */
  async sync(input: { tenant?: string; token: string; accounts: SubRef[] }) {
    const brand = await this.brand(input.tenant);
    const account = await this.fromToken(input.token, brand.id);
    const known = new Set((await this.subsOf(account.id)).map((s) => s.url));
    const fresh = (input.accounts ?? []).filter((s) => s?.url && !known.has(s.url));
    if (fresh.length) await this.addSubs(account.id, await this.verified(brand, fresh));
    return this.view(account);
  }

  async changePassword(input: { tenant?: string; token: string; current: string; next: string }) {
    const brand = await this.brand(input.tenant);
    const account = await this.fromToken(input.token, brand.id);
    if (!(await bcrypt.compare(String(input.current || ''), account.passwordHash))) {
      throw new UnauthorizedException('Current password is wrong');
    }
    if (String(input.next || '').length < 6) throw new BadRequestException('Password: at least 6 characters');
    await this.prisma.customerAccount.update({ where: { id: account.id }, data: { passwordHash: await bcrypt.hash(input.next, 10) } });
    // Everyone else signed in with the old password is signed out.
    await this.prisma.customerSession.deleteMany({ where: { accountId: account.id, tokenHash: { not: hashToken(input.token) } } });
    return { ok: true };
  }

  async logout(token: string) {
    await this.prisma.customerSession.deleteMany({ where: { tokenHash: hashToken(token) } });
    return { ok: true };
  }

  // ---------- purchases ----------

  /**
   * The buyer's account: the one they are signed in to, or a new one with a
   * generated username and starting password (returned once, to show them).
   */
  async forPurchase(brand: Brand, token: string | undefined, name: string | null) {
    if (token) {
      const account = await this.fromToken(token, brand.id).catch(() => null);
      if (account) return { id: account.id, credentials: null };
    }
    const base = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12);
    const stem = base.length >= 3 ? base : 'user';
    for (let i = 0; i < 8; i++) {
      const username = `${stem}${randomInt(1000, 99999)}`;
      const taken = await this.prisma.customerAccount.findUnique({ where: { brandId_username: { brandId: brand.id, username } } });
      if (taken) continue;
      const password = generatePassword();
      const account = await this.prisma.customerAccount.create({
        data: { brandId: brand.id, username, passwordHash: await bcrypt.hash(password, 10) },
      });
      return { id: account.id, credentials: { username, password, token: await this.session(account.id) } };
    }
    throw new BadRequestException('Could not create your account, try again');
  }

  /** A bought service was delivered: it joins the buyer's account, so every device they sign in on gets it. */
  async attach(accountId: string, subId: string, url: string) {
    await this.addSubs(accountId, [{ subId: subId.slice(0, 128), url }]);
  }
}
