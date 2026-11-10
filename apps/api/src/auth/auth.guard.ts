import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import { PrismaService } from '../common/prisma.service';

export const hashKey = (k: string) => createHash('sha256').update(k).digest('hex');
export const API_KEY_PREFIX = 'a11y_';
export const SESSION_COOKIE = 'a11y_session';
export const CSRF_HEADER = 'x-csrf';

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true, // not readable by page scripts, so XSS cannot steal the session
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 7 * 24 * 3600 * 1000,
  };
}

/**
 * Accepts, in order: a CI API key (`x-api-key` or `Authorization: Bearer a11y_...`), a bearer JWT, or the httpOnly session cookie.
 * Cookie-authenticated writes also need the `x-csrf` header: browsers will not let other origins add it without a CORS
 * preflight, which our CORS allow-list refuses (defence in depth on top of SameSite=Lax).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const bearer = (req.headers.authorization as string | undefined)?.replace(/^Bearer\s+/i, '');
    const explicit: string | undefined = (req.headers['x-api-key'] as string) || bearer;
    const cookie = readCookie(req.headers.cookie, SESSION_COOKIE);
    const token = explicit || cookie;
    if (!token) throw new UnauthorizedException();

    if (token.startsWith(API_KEY_PREFIX)) {
      const user = await this.prisma.user.findUnique({ where: { apiKeyHash: hashKey(token) } });
      if (!user) throw new UnauthorizedException();
      req.user = { id: user.id };
      return true;
    }
    let sub: string;
    try {
      sub = (await this.jwt.verifyAsync<{ sub: string }>(token)).sub;
    } catch {
      throw new UnauthorizedException();
    }
    const viaCookie = !explicit && Boolean(cookie);
    if (viaCookie && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers[CSRF_HEADER] !== '1') {
      throw new ForbiddenException('Missing CSRF header');
    }
    req.user = { id: sub };
    return true;
  }
}

export const CurrentUser = createParamDecorator((_d, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user as { id: string });
