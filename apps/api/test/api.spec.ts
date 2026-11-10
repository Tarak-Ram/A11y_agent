import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHmac } from 'crypto';
import { AuthGuard, API_KEY_PREFIX, SESSION_COOKIE, hashKey, readCookie } from '../src/auth/auth.guard';
import { assertScannableUrl } from '../src/common/url';
import { explain } from '../src/common/wcag';
import { RunsService } from '../src/runs/runs.module';
import { InternalService, assertInternal } from '../src/internal/internal.module';
import { verifyGithubSignature } from '../src/webhooks/webhooks.module';

const ctx = (headers: any = {}, query: any = {}, method = 'GET') => {
  const req: any = { headers, query, method };
  return { req, c: { switchToHttp: () => ({ getRequest: () => req }) } as any };
};

describe('AuthGuard', () => {
  const jwt = new JwtService({ secret: 's' });
  const prisma: any = { user: { findUnique: jest.fn() } };
  const guard = new AuthGuard(jwt, prisma);

  it('rejects missing token', async () => {
    await expect(guard.canActivate(ctx().c)).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('accepts a valid JWT', async () => {
    const { req, c } = ctx({ authorization: `Bearer ${await jwt.signAsync({ sub: 'u1' })}` });
    await expect(guard.canActivate(c)).resolves.toBe(true);
    expect(req.user.id).toBe('u1');
  });
  it('rejects a JWT signed with another secret', async () => {
    const bad = await new JwtService({ secret: 'other' }).signAsync({ sub: 'u1' });
    await expect(guard.canActivate(ctx({ authorization: `Bearer ${bad}` }).c)).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('accepts an API key via x-api-key, looked up by hash', async () => {
    const key = API_KEY_PREFIX + 'abc';
    prisma.user.findUnique.mockResolvedValue({ id: 'u2' });
    const { req, c } = ctx({ 'x-api-key': key });
    await expect(guard.canActivate(c)).resolves.toBe(true);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { apiKeyHash: hashKey(key) } });
    expect(req.user.id).toBe('u2');
  });
  it('rejects an unknown API key', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(ctx({ 'x-api-key': API_KEY_PREFIX + 'nope' }).c)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('assertScannableUrl', () => {
  const old = process.env.ALLOW_PRIVATE_URLS;
  afterEach(() => (process.env.ALLOW_PRIVATE_URLS = old));
  it('rejects non-http schemes', async () => {
    await expect(assertScannableUrl('file:///etc/passwd')).rejects.toBeInstanceOf(BadRequestException);
    await expect(assertScannableUrl('javascript:alert(1)')).rejects.toBeInstanceOf(BadRequestException);
  });
  it('blocks private and metadata addresses when private URLs are disallowed', async () => {
    process.env.ALLOW_PRIVATE_URLS = '0';
    for (const u of ['http://127.0.0.1', 'http://10.0.0.5/x', 'http://169.254.169.254/latest', 'http://192.168.1.1', 'http://[::1]/']) {
      await expect(assertScannableUrl(u)).rejects.toBeInstanceOf(BadRequestException);
    }
  });
  it('allows public IPs', async () => {
    process.env.ALLOW_PRIVATE_URLS = '0';
    await expect(assertScannableUrl('https://8.8.8.8/')).resolves.toBe('https://8.8.8.8/');
  });
});

describe('github webhook signature', () => {
  const body = Buffer.from('{"a":1}');
  const sig = 'sha256=' + createHmac('sha256', 'sec').update(body).digest('hex');
  it('accepts a correct signature', () => expect(verifyGithubSignature('sec', body, sig)).toBe(true));
  it('rejects wrong secret, missing header, and unset secret', () => {
    expect(verifyGithubSignature('other', body, sig)).toBe(false);
    expect(verifyGithubSignature('sec', body, undefined)).toBe(false);
    expect(verifyGithubSignature('', body, sig)).toBe(false);
  });
});

describe('internal token', () => {
  it('requires the shared secret', () => {
    process.env.INTERNAL_TOKEN = 'tok';
    expect(() => assertInternal('wrong')).toThrow(UnauthorizedException);
    expect(() => assertInternal(undefined)).toThrow(UnauthorizedException);
    expect(() => assertInternal('tok')).not.toThrow();
    delete process.env.INTERNAL_TOKEN;
    expect(() => assertInternal('')).toThrow(UnauthorizedException);
  });
});

describe('RunsService', () => {
  const mk = () => {
    const prisma: any = {
      project: { findFirst: jest.fn() },
      task: { findFirst: jest.fn(), create: jest.fn().mockResolvedValue({ id: 't1', goal: 'g' }) },
      run: {
        create: jest.fn().mockResolvedValue({ id: 'r1', status: 'running', personaRuns: [{ id: 'pr1', personaType: 'blind' }, { id: 'pr2', personaType: 'low_vision' }] }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
      },
      personaRun: { update: jest.fn(), findMany: jest.fn().mockResolvedValue([{ status: 'running' }]), count: jest.fn().mockResolvedValue(0), aggregate: jest.fn().mockResolvedValue({ _sum: { costUsd: 0 } }) },
    };
    const projects: any = { getOwned: jest.fn().mockResolvedValue({ id: 'p1', url: 'http://x.test', locale: 'en' }), create: jest.fn() };
    const queue: any = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const events: any = { publish: jest.fn() };
    return { prisma, projects, queue, events, svc: new RunsService(prisma, projects, queue, events) };
  };

  it('creates one queued job per persona', async () => {
    const { svc, queue } = mk();
    const res = await svc.create('u1', { projectId: 'p1', personas: ['blind', 'low_vision'] });
    expect(res.id).toBe('r1');
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
    expect(queue.enqueue.mock.calls.map((c: any) => c[0].persona)).toEqual(['blind', 'low_vision']);
  });
  it('enforces concurrent, daily and monthly-cost quotas with 429', async () => {
    const m = mk();
    m.prisma.run.count.mockResolvedValue(3);
    await expect(m.svc.create('u1', { projectId: 'p1' })).rejects.toMatchObject({ status: 429 });
    expect(m.queue.enqueue).not.toHaveBeenCalled();
    m.prisma.run.count.mockResolvedValue(0);
    m.prisma.personaRun.count.mockResolvedValue(49);
    await expect(m.svc.create('u1', { projectId: 'p1', personas: ['blind', 'low_vision'] })).rejects.toMatchObject({ status: 429 }); // 49 + 2 > 50
    m.prisma.personaRun.count.mockResolvedValue(0);
    m.prisma.personaRun.aggregate.mockResolvedValue({ _sum: { costUsd: 20.5 } });
    await expect(m.svc.create('u1', { projectId: 'p1' })).rejects.toMatchObject({ status: 429 });
    m.prisma.personaRun.aggregate.mockResolvedValue({ _sum: { costUsd: 1 } });
    await expect(m.svc.create('u1', { projectId: 'p1' })).resolves.toBeDefined();
  });
  it('requires projectId or url', async () => {
    await expect(mk().svc.create('u1', {})).rejects.toBeInstanceOf(BadRequestException);
  });
  it('marks a persona failed (not the whole request) when enqueue throws', async () => {
    const m = mk();
    m.queue.enqueue.mockRejectedValueOnce(new Error('redis down'));
    await m.svc.create('u1', { projectId: 'p1' });
    expect(m.prisma.personaRun.update).toHaveBeenCalledWith({ where: { id: 'pr1' }, data: expect.objectContaining({ status: 'failed' }) });
  });
  it('maybeFinish waits for running personas, finishes exactly once', async () => {
    const m = mk();
    expect(await m.svc.maybeFinish('r1')).toBe(false);
    m.prisma.personaRun.findMany.mockResolvedValue([{ status: 'done' }, { status: 'failed' }]);
    expect(await m.svc.maybeFinish('r1')).toBe(true);
    expect(m.events.publish).toHaveBeenCalledWith('r1', { type: 'run_done', status: 'completed' });
    m.prisma.run.updateMany.mockResolvedValue({ count: 0 });
    expect(await m.svc.maybeFinish('r1')).toBe(false);
  });
});

describe('explain', () => {
  it('prefers axe rule, falls back to SC, then generic', () => {
    expect(explain('1.4.3', 'image-alt').title).toMatch(/Image/);
    expect(explain('1.4.3').title).toMatch(/faint/);
    expect(explain('9.9.9').title).toMatch(/barrier/);
  });
});

describe('InternalService.saveResult', () => {
  it('replaces findings and publishes persona_done', async () => {
    const prisma: any = {
      personaRun: { findUnique: jest.fn().mockResolvedValue({ id: 'pr1', runId: 'r1', personaType: 'blind' }), update: jest.fn() },
      finding: { deleteMany: jest.fn(), createMany: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const events: any = { publish: jest.fn() };
    const runs: any = { maybeFinish: jest.fn().mockResolvedValue(false) };
    const svc = new InternalService(prisma, runs, events, { onRunFinished: jest.fn() } as any, { send: jest.fn() } as any);
    await svc.saveResult('pr1', { status: 'done', score: 40, success: false, findings: [{ wcag_rule: '1.1.1', severity: 'critical', description: 'x', confirmed_by_axe: true }] });
    expect(prisma.finding.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ personaRunId: 'pr1', wcagRule: '1.1.1', confirmedByAxe: true })] });
    expect(events.publish).toHaveBeenCalledWith('r1', expect.objectContaining({ type: 'persona_done', score: 40 }));
    expect(runs.maybeFinish).toHaveBeenCalledWith('r1');
  });
});

describe('InternalService.alert', () => {
  const mkAlert = (user: any, findings: any[]) => {
    const prisma: any = { run: { findUnique: jest.fn().mockResolvedValue({ id: 'r1', project: { url: 'http://x.test', name: 'x', user }, personaRuns: [{ findings }] }) } };
    const mail: any = { send: jest.fn().mockResolvedValue(true) };
    const svc: any = new InternalService(prisma, {} as any, {} as any, {} as any, mail);
    return { svc, mail };
  };
  const fetchMock = jest.fn().mockResolvedValue({ ok: true });
  beforeEach(() => ((global as any).fetch = fetchMock.mockClear()));

  it('sends email and Slack when criticals exist', async () => {
    const { svc, mail } = mkAlert({ slackWebhookUrl: 'https://hooks.slack.test/x', alertEmail: 'a@b.test' }, [{ severity: 'critical' }, { severity: 'minor' }]);
    await svc.alert('r1');
    expect(mail.send).toHaveBeenCalledWith('a@b.test', expect.stringContaining('1 critical'), expect.stringContaining('http://x.test'));
    expect(fetchMock).toHaveBeenCalledWith('https://hooks.slack.test/x', expect.objectContaining({ method: 'POST' }));
  });
  it('stays silent without critical findings or without channels', async () => {
    const a = mkAlert({ alertEmail: 'a@b.test' }, [{ severity: 'serious' }]);
    await a.svc.alert('r1');
    expect(a.mail.send).not.toHaveBeenCalled();
    const b = mkAlert({}, [{ severity: 'critical' }]);
    await b.svc.alert('r1');
    expect(b.mail.send).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('one failing channel does not block the other', async () => {
    const { svc, mail } = mkAlert({ slackWebhookUrl: 'https://hooks.slack.test/x', alertEmail: 'a@b.test' }, [{ severity: 'critical' }]);
    fetchMock.mockRejectedValueOnce(new Error('slack down'));
    await expect(svc.alert('r1')).resolves.toBeUndefined();
    expect(mail.send).toHaveBeenCalled();
  });
});

describe('session cookie auth', () => {
  const jwt = new JwtService({ secret: 's' });
  const guard = new AuthGuard(jwt, { user: { findUnique: jest.fn() } } as any);
  const cookieFor = async (sub: string) => `other=1; ${SESSION_COOKIE}=${await jwt.signAsync({ sub })}; x=y`;

  it('parses cookies', () => {
    expect(readCookie('a=1; b=two%20words', 'b')).toBe('two words');
    expect(readCookie('a=1', 'b')).toBeUndefined();
    expect(readCookie(undefined, 'b')).toBeUndefined();
  });
  it('authenticates GET requests from the httpOnly cookie', async () => {
    const { req, c } = ctx({ cookie: await cookieFor('u9') });
    await expect(guard.canActivate(c)).resolves.toBe(true);
    expect(req.user.id).toBe('u9');
  });
  it('requires the CSRF header for cookie-authenticated writes', async () => {
    const cookie = await cookieFor('u9');
    await expect(guard.canActivate(ctx({ cookie }, {}, 'POST').c)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(ctx({ cookie, 'x-csrf': '1' }, {}, 'POST').c)).resolves.toBe(true);
  });
  it('does not need the CSRF header for explicit bearer/API-key auth (not ambient credentials)', async () => {
    const t = await jwt.signAsync({ sub: 'u1' });
    await expect(guard.canActivate(ctx({ authorization: `Bearer ${t}` }, {}, 'POST').c)).resolves.toBe(true);
  });
  it('ignores a token passed in the URL', async () => {
    const t = await jwt.signAsync({ sub: 'u1' });
    await expect(guard.canActivate(ctx({}, { token: t }).c)).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('rejects a forged cookie', async () => {
    const bad = await new JwtService({ secret: 'evil' }).signAsync({ sub: 'u1' });
    await expect(guard.canActivate(ctx({ cookie: `${SESSION_COOKIE}=${bad}` }).c)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
