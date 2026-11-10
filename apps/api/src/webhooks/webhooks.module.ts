import { BadRequestException, Controller, Headers, HttpCode, Injectable, Module, Post, RawBodyRequest, Req, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../common/prisma.service';

export function verifyGithubSignature(secret: string, raw: Buffer, header: string | undefined): boolean {
  if (!secret || !header?.startsWith('sha256=')) return false;
  const expected = Buffer.from('sha256=' + createHmac('sha256', secret).update(raw).digest('hex'));
  const got = Buffer.from(header);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

@Injectable()
export class WebhooksService {
  constructor(private prisma: PrismaService) {}

  async handle(event: string, body: any) {
    if (event === 'pull_request' && body.pull_request?.html_url) {
      const status = body.pull_request.merged ? 'merged' : body.action === 'closed' ? 'closed' : null;
      if (status) await this.prisma.fix.updateMany({ where: { prUrl: body.pull_request.html_url }, data: { status } });
    }
    if (event === 'installation' && body.action === 'deleted') {
      await this.prisma.user.updateMany({ where: { githubInstallationId: String(body.installation.id) }, data: { githubInstallationId: null } });
    }
    return { ok: true };
  }
}

@Controller('webhooks')
export class WebhooksController {
  constructor(private svc: WebhooksService) {}

  @Post('github') @HttpCode(200)
  github(@Req() req: RawBodyRequest<any>, @Headers('x-hub-signature-256') sig: string | undefined, @Headers('x-github-event') event: string | undefined) {
    if (!req.rawBody || !verifyGithubSignature(process.env.GITHUB_WEBHOOK_SECRET ?? '', req.rawBody, sig)) throw new UnauthorizedException('bad signature');
    if (!event) throw new BadRequestException();
    return this.svc.handle(event, req.body);
  }
}

@Module({ controllers: [WebhooksController], providers: [WebhooksService] })
export class WebhooksModule {}
