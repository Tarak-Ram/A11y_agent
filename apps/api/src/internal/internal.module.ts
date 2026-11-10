import { Body, Controller, Headers, Injectable, Logger, Module, NotFoundException, Param, Post, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../common/prisma.service';
import { EventsService } from '../events/events.module';
import { RunsModule, RunsService } from '../runs/runs.module';
import { FixesModule, FixesService } from '../fixes/fixes.module';
import { MailService } from '../mail/mail.module';

class FindingDto {
  @IsString() wcag_rule: string;
  @IsIn(['critical', 'serious', 'moderate', 'minor']) severity: string;
  @IsOptional() @IsString() selector?: string;
  @IsString() description: string;
  @IsOptional() @IsString() screenshot_url?: string | null;
  @IsBoolean() confirmed_by_axe: boolean;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() axe_rule_id?: string | null;
  @IsOptional() @IsString() html?: string | null;
}

export class ResultDto {
  @IsIn(['done', 'failed']) status: 'done' | 'failed';
  @IsOptional() @IsBoolean() success?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(100) score?: number;
  @IsOptional() @IsString() video_url?: string | null;
  @IsOptional() @IsString() summary?: string;
  @IsOptional() @IsString() stopped_reason?: string;
  @IsOptional() @IsNumber() cost_usd?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => FindingDto) findings?: FindingDto[];
}

export function assertInternal(token: string | undefined) {
  const expected = process.env.INTERNAL_TOKEN ?? '';
  const a = Buffer.from(token ?? '');
  const b = Buffer.from(expected);
  if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();
}

@Injectable()
export class InternalService {
  private log = new Logger(InternalService.name);
  constructor(private prisma: PrismaService, private runs: RunsService, private events: EventsService, private fixes: FixesService, private mail: MailService) {}

  async markStarted(personaRunId: string) {
    const pr = await this.prisma.personaRun.update({ where: { id: personaRunId }, data: { status: 'running' } });
    await this.events.publish(pr.runId, { type: 'status', persona: pr.personaType, state: 'running' });
    return { ok: true };
  }

  async saveResult(personaRunId: string, dto: ResultDto) {
    const pr = await this.prisma.personaRun.findUnique({ where: { id: personaRunId }, include: { run: { include: { project: { include: { user: true } } } } } });
    if (!pr) throw new NotFoundException();
    await this.prisma.$transaction([
      this.prisma.finding.deleteMany({ where: { personaRunId } }), // idempotent on worker retry
      this.prisma.finding.createMany({
        data: (dto.findings ?? []).map((f) => ({
          personaRunId,
          wcagRule: f.wcag_rule,
          severity: f.severity,
          selector: f.selector ?? '',
          description: f.description,
          screenshotUrl: f.screenshot_url ?? null,
          confirmedByAxe: f.confirmed_by_axe,
          source: f.source ?? 'agent',
          axeRuleId: f.axe_rule_id ?? null,
          html: f.html ?? null,
        })),
      }),
      this.prisma.personaRun.update({
        where: { id: personaRunId },
        data: { status: dto.status, success: dto.success, score: dto.score, videoUrl: dto.video_url, summary: dto.summary, stoppedReason: dto.stopped_reason, costUsd: dto.cost_usd ?? 0 },
      }),
    ]);
    await this.events.publish(pr.runId, { type: 'persona_done', persona: pr.personaType, status: dto.status, score: dto.score, success: dto.success, findings: dto.findings?.length ?? 0 });
    const finished = await this.runs.maybeFinish(pr.runId);
    if (finished) {
      await this.alert(pr.runId).catch((e) => this.log.warn({ err: String(e) }, 'alert failed'));
      await this.fixes.onRunFinished(pr.runId).catch((e) => this.log.warn({ err: String(e) }, 'fix verification comment failed'));
    }
    return { ok: true };
  }

  /** When a finished run has critical findings, notify the owner by Slack and/or email (each only if configured). */
  async alert(runId: string) {
    const run = await this.prisma.run.findUnique({ where: { id: runId }, include: { project: { include: { user: true } }, personaRuns: { include: { findings: true } } } });
    const user = run?.project.user;
    if (!run || !user) return;
    const critical = run.personaRuns.flatMap((p) => p.findings).filter((f) => f.severity === 'critical').length;
    if (!critical) return;
    const link = `${process.env.WEB_URL ?? ''}/runs/${run.id}/report`;
    const text = `${critical} critical accessibility issue(s) on ${run.project.url}. ${link}`;
    const jobs: Promise<unknown>[] = [];
    if (user.slackWebhookUrl) {
      jobs.push(fetch(user.slackWebhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `A11yAgents: ${text}` }), signal: AbortSignal.timeout(5000) }));
    }
    if (user.alertEmail) jobs.push(this.mail.send(user.alertEmail, `A11yAgents: ${critical} critical issue(s) on ${run.project.name}`, text));
    // One failing channel must not hide the other.
    for (const r of await Promise.allSettled(jobs)) if (r.status === 'rejected') this.log.warn({ err: String(r.reason) }, 'alert channel failed');
  }
}

@Controller('internal')
export class InternalController {
  constructor(private svc: InternalService) {}

  /** Called by agent workers. Protected by a shared secret, not user auth. */
  @Post('persona-runs/:id/result')
  result(@Headers('x-internal-token') token: string | undefined, @Param('id') id: string, @Body() dto: ResultDto) {
    assertInternal(token);
    return this.svc.saveResult(id, dto);
  }

  @Post('persona-runs/:id/started')
  async started(@Headers('x-internal-token') token: string | undefined, @Param('id') id: string) {
    assertInternal(token);
    return this.svc.markStarted(id);
  }
}

@Module({ imports: [RunsModule, FixesModule], controllers: [InternalController], providers: [InternalService] })
export class InternalModule {}
