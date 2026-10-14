import { Role } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  orgId: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  orgId: string | null;
  name: string | null;
  locale: string;
  theme: string;
}
