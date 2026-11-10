import { Body, Controller, Get, Global, Injectable, Module, NotFoundException, Patch, Post, Req, Res, UseGuards, ForbiddenException, Logger } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule, PassportStrategy, AuthGuard as PassportGuard } from '@nestjs/passport';
import { randomBytes } from 'crypto';
import { IsEmail, IsOptional, IsString, IsUrl } from 'class-validator';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as GithubStrategy } from 'passport-github2';
import { PrismaService } from '../common/prisma.service';
import { API_KEY_PREFIX, AuthGuard, CurrentUser, SESSION_COOKIE, hashKey, readCookie, sessionCookieOptions } from './auth.guard';

type OAuthProfile = { provider: 'google' | 'github'; id: string; email: string; name?: string };

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async upsertOAuth(p: OAuthProfile) {
    const idField = p.provider === 'google' ? 'googleId' : 'githubId';
    const existing = (await this.prisma.user.findUnique({ where: { [idField]: p.id } as never })) ?? (await this.prisma.user.findUnique({ where: { email: p.email } }));
    if (existing) return this.prisma.user.update({ where: { id: existing.id }, data: { [idField]: p.id, name: existing.name ?? p.name } });
    return this.prisma.user.create({ data: { email: p.email, name: p.name, [idField]: p.id } });
  }

  sign(userId: string) {
    return this.jwt.signAsync({ sub: userId });
  }
}

const enabled = (id?: string, secret?: string) => Boolean(id && secret);

@Injectable()
export class GoogleOAuth extends PassportStrategy(GoogleStrategy, 'google') {
  constructor(private auth: AuthService) {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID || 'unset',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'unset',
      callbackURL: `${process.env.API_URL ?? 'http://localhost:4000'}/auth/google/callback`,
      scope: ['email', 'profile'],
    });
  }
  async validate(_a: string, _r: string, profile: any) {
    const email = profile.emails?.[0]?.value;
    if (!email) throw new ForbiddenException('Google account has no email');
    return this.auth.upsertOAuth({ provider: 'google', id: profile.id, email, name: profile.displayName });
  }
}

@Injectable()
export class GithubOAuth extends PassportStrategy(GithubStrategy, 'github') {
  constructor(private auth: AuthService) {
    super({
      clientID: process.env.GITHUB_CLIENT_ID || 'unset',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || 'unset',
      callbackURL: `${process.env.API_URL ?? 'http://localhost:4000'}/auth/github/callback`,
      scope: ['user:email'],
    });
  }
  async validate(_a: string, _r: string, profile: any) {
    const email = profile.emails?.[0]?.value;
    if (!email) throw new ForbiddenException('GitHub account has no public email');
    return this.auth.upsertOAuth({ provider: 'github', id: String(profile.id), email, name: profile.displayName ?? profile.username });
  }
}

class DevLoginDto {
  @IsEmail() email: string;
}
class SettingsDto {
  @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) slackWebhookUrl?: string;
  @IsOptional() @IsEmail() alertEmail?: string;
  @IsOptional() @IsString() name?: string;
}

@Controller()
export class AuthController {
  private log = new Logger(AuthController.name);
  constructor(private auth: AuthService, private prisma: PrismaService, private jwt: JwtService) {}

  private async finish(req: any, res: any) {
    // The session lives in an httpOnly cookie; no token ever appears in a URL or in page JavaScript.
    res.cookie(SESSION_COOKIE, await this.auth.sign(req.user.id), sessionCookieOptions());
    res.redirect(`${(process.env.WEB_URL ?? 'http://localhost:3000').split(',')[0]}/auth/callback`);
  }

  @Get('auth/google') @UseGuards(PassportGuard('google')) google() {}
  @Get('auth/google/callback') @UseGuards(PassportGuard('google')) googleCb(@Req() req: any, @Res() res: any) {
    return this.finish(req, res);
  }
  @Get('auth/github') @UseGuards(PassportGuard('github')) github() {}
  @Get('auth/github/callback') @UseGuards(PassportGuard('github')) githubCb(@Req() req: any, @Res() res: any) {
    return this.finish(req, res);
  }

  /** Local development only: sign in without OAuth. Disabled in production. */
  @Post('auth/dev-login')
  async devLogin(@Body() dto: DevLoginDto, @Res({ passthrough: true }) res: any) {
    if (process.env.NODE_ENV === 'production') throw new NotFoundException();
    const user = await this.prisma.user.upsert({ where: { email: dto.email }, update: {}, create: { email: dto.email, name: dto.email.split('@')[0] } });
    const token = await this.auth.sign(user.id);
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
    return { ok: true, token }; // token in the body is for scripts/tests only; the web app uses the cookie
  }

  @Post('auth/logout')
  logout(@Res({ passthrough: true }) res: any) {
    const { maxAge: _m, ...opts } = sessionCookieOptions();
    res.clearCookie(SESSION_COOKIE, opts);
    return { ok: true };
  }

  @Post('auth/api-key') @UseGuards(AuthGuard)
  async createApiKey(@CurrentUser() u: { id: string }) {
    const key = API_KEY_PREFIX + randomBytes(24).toString('hex');
    await this.prisma.user.update({ where: { id: u.id }, data: { apiKeyHash: hashKey(key) } });
    return { apiKey: key, note: 'Shown once. Creating a new key revokes the old one.' };
  }

  private shape(user: any) {
    return { id: user.id, email: user.email, name: user.name, slackWebhookUrl: user.slackWebhookUrl, alertEmail: user.alertEmail, githubConnected: Boolean(user.githubInstallationId), hasApiKey: Boolean(user.apiKeyHash) };
  }

  @Get('me') @UseGuards(AuthGuard)
  async me(@CurrentUser() u: { id: string }) {
    return this.shape(await this.prisma.user.findUniqueOrThrow({ where: { id: u.id } }));
  }

  /** Who is signed in? Always 200 so anonymous visitors don't see failed requests; `me` is null when signed out. */
  @Get('auth/session')
  async session(@Req() req: any) {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (!token) return { me: null };
    try {
      const { sub } = await this.jwt.verifyAsync<{ sub: string }>(token);
      const user = await this.prisma.user.findUnique({ where: { id: sub } });
      return { me: user ? this.shape(user) : null };
    } catch {
      return { me: null };
    }
  }

  @Patch('me') @UseGuards(AuthGuard)
  async update(@CurrentUser() u: { id: string }, @Body() dto: SettingsDto) {
    await this.prisma.user.update({ where: { id: u.id }, data: dto });
    return { ok: true };
  }
}

@Global()
@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? (() => { throw new Error('JWT_SECRET required'); })() : 'dev-secret'),
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, ...(enabled(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET) ? [GoogleOAuth] : []), ...(enabled(process.env.GITHUB_CLIENT_ID, process.env.GITHUB_CLIENT_SECRET) ? [GithubOAuth] : [])],
  exports: [AuthGuard, AuthService],
})
export class AuthModule {}
