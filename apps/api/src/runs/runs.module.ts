import { BadRequestException, Body, Controller, Get, HttpException, HttpStatus, Injectable, Logger, MessageEvent, Module, NotFoundException, Param, Post, Sse, UseGuards } from '@nestjs/common';
import { ArrayNotEmpty, IsArray, IsIn, IsOptional, IsString, IsUrl } from 'class-validator';
import { Observable, concat, map, of } from 'rxjs';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { PrismaService } from '../common/prisma.service';
import { assertScannableUrl } from '../common/url';
import { EventsService } from '../events/events.module';
import { QueueService } from '../queue/queue.module';
import { ProjectsModule, ProjectsService } from '../projects/projects.module';

export const PERSONAS = ['blind', 'low_vision', 'color_blind', 'motor_tremor', 'elderly_first_time', 'indian_language'] as const;
const DEFAULT_GOAL = 'Explore the main page and try the primary call-to-action, as a first-time visitor would.';

export class CreateRunDto {
  /** Either an existing project (and optionally task) ... */
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() taskId?: string;
  /** ... or just a URL (CI): a project is found or created for the caller. */
  @IsOptional() @IsUrl({ require_protocol: true, require_tld: false }) url?: string;
  @IsOptional() @IsString() goal?: string;
  @IsOptional() @IsArray() @ArrayNotEmpty() @IsIn(PERSONAS, { each: true }) personas?: string[];
}

@Injectable()
export class RunsService {
  private log = new Logger(RunsService.name);
  constructor(private prisma: PrismaService, private projects: ProjectsService, private queue: QueueService, private events: EventsService) {}

  /** Per-user limits so one account cannot run up the Gemini/compute bill. Env-tunable. */
  async assertQuota(userId: string, newPersonaRuns: number) {
    const limit = (k: string, d: number) => Number(process.env[k] ?? d);
    const now = new Date();
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const owned = { run: { project: { userId } } };
    const [running, today, month] = await Promise.all([
      this.prisma.run.count({ where: { status: 'running', project: { userId } } }),
      this.prisma.personaRun.count({ where: { ...owned, run: { ...owned.run, startedAt: { gte: dayStart } } } }),
      this.prisma.personaRun.aggregate({ _sum: { costUsd: true }, where: { run: { project: { userId }, startedAt: { gte: monthStart } } } }),
    ]);
    const tooMany = (msg: string) => new HttpException({ statusCode: 429, error: 'Quota exceeded', message: msg }, HttpStatus.TOO_MANY_REQUESTS);
    if (running >= limit('MAX_CONCURRENT_RUNS', 3)) throw tooMany(`You already have ${running} scans running. Wait for one to finish.`);
    if (today + newPersonaRuns > limit('DAILY_PERSONA_RUN_LIMIT', 50)) throw tooMany(`Daily limit of ${limit('DAILY_PERSONA_RUN_LIMIT', 50)} persona runs reached. It resets at 00:00 UTC.`);
    if ((month._sum.costUsd ?? 0) >= limit('MONTHLY_COST_CAP_USD', 20)) throw tooMany('Monthly AI usage cap reached.');
  }

  async create(userId: string, dto: CreateRunDto, urlOverride?: string) {
    let project;
    if (dto.projectId) {
      project = await this.projects.getOwned(userId, dto.projectId);
    } else if (dto.url) {
      const url = await assertScannableUrl(dto.url);
      project = (await this.prisma.project.findFirst({ where: { userId, url } })) ?? (await this.projects.create(userId, { url }));
    } else {
      throw new BadRequestException('projectId or url is required');
    }

    let task = dto.taskId ? await this.prisma.task.findFirst({ where: { id: dto.taskId, projectId: project.id } }) : null;
    if (dto.taskId && !task) throw new NotFoundException('Task not found');
    task ??= await this.prisma.task.create({ data: { projectId: project.id, name: dto.goal ? 'Custom task' : 'Explore homepage', goal: dto.goal ?? DEFAULT_GOAL } });

    const personas = dto.personas?.length ? [...new Set(dto.personas)] : ['blind'];
    await this.assertQuota(userId, personas.length);
    const run = await this.prisma.run.create({
      data: { projectId: project.id, taskId: task.id, status: 'running', personaRuns: { create: personas.map((personaType) => ({ personaType })) } },
      include: { personaRuns: true },
    });

    for (const pr of run.personaRuns) {
      try {
        await this.queue.enqueue({ runId: run.id, personaRunId: pr.id, persona: pr.personaType, url: urlOverride ?? project.url, goal: task.goal, locale: project.locale, maxSteps: 40 });
      } catch (e) {
        this.log.error({ err: String(e), personaRunId: pr.id }, 'enqueue failed');
        await this.prisma.personaRun.update({ where: { id: pr.id }, data: { status: 'failed', summary: 'Could not queue job' } });
      }
    }
    await this.maybeFinish(run.id);
    return { id: run.id, status: run.status, personaRuns: run.personaRuns.map((p) => ({ id: p.id, personaType: p.personaType })) };
  }

  /** Re-run a task on another URL (e.g. a PR preview) for fix verification. */
  createForUrl(userId: string, projectId: string, taskId: string, personas: string[], url: string) {
    return this.create(userId, { projectId, taskId, personas }, url);
  }

  async getOwned(userId: string, id: string) {
    const run = await this.prisma.run.findFirst({
      where: { id, project: { userId } },
      include: { personaRuns: { include: { findings: { orderBy: { severity: 'asc' } } } }, task: true, project: { select: { id: true, name: true, url: true, repoFullName: true } } },
    });
    if (!run) throw new NotFoundException('Run not found');
    return run;
  }

  async view(userId: string, id: string) {
    const run = await this.getOwned(userId, id);
    const scored = run.personaRuns.filter((p) => p.score !== null);
    const all = run.personaRuns.flatMap((p) => p.findings);
    const bySeverity = { critical: 0, serious: 0, moderate: 0, minor: 0 } as Record<string, number>;
    for (const f of all) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    return {
      ...run,
      overallScore: scored.length ? Math.round(scored.reduce((s, p) => s + (p.score ?? 0), 0) / scored.length) : null,
      summary: { findings: all.length, ...bySeverity },
    };
  }

  /** When every persona run has settled, close the run and tell listeners. */
  async maybeFinish(runId: string) {
    const prs = await this.prisma.personaRun.findMany({ where: { runId } });
    if (!prs.length || prs.some((p) => p.status === 'queued' || p.status === 'running')) return false;
    const failed = prs.every((p) => p.status === 'failed');
    const claimed = await this.prisma.run.updateMany({ where: { id: runId, finishedAt: null }, data: { status: failed ? 'failed' : 'completed', finishedAt: new Date() } });
    if (claimed.count === 0) return false; // another worker already finished it
    await this.events.publish(runId, { type: 'run_done', status: failed ? 'failed' : 'completed' });
    return true;
  }

  stream(userId: string, runId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((sub) => {
      this.view(userId, runId)
        .then((snap) => {
          const initial = of<MessageEvent>({ type: 'snapshot', data: snap });
          const live = this.events.stream(runId).pipe(map((e): MessageEvent => ({ type: e.type, data: e })));
          // already finished? emit snapshot then close
          const src = snap.status === 'running' || snap.status === 'queued' ? concat(initial, live) : concat(initial, of<MessageEvent>({ type: 'run_done', data: { type: 'run_done', status: snap.status } }));
          src.subscribe(sub);
        })
        .catch((e) => sub.error(e));
    });
  }
}

@Controller('runs')
@UseGuards(AuthGuard)
export class RunsController {
  constructor(private svc: RunsService) {}

  @Post() create(@CurrentUser() u: { id: string }, @Body() dto: CreateRunDto) {
    return this.svc.create(u.id, dto);
  }
  @Get(':id') get(@CurrentUser() u: { id: string }, @Param('id') id: string) {
    return this.svc.view(u.id, id);
  }
  @Sse(':id/stream') stream(@CurrentUser() u: { id: string }, @Param('id') id: string) {
    return this.svc.stream(u.id, id);
  }
}

@Module({ imports: [ProjectsModule], controllers: [RunsController], providers: [RunsService], exports: [RunsService] })
export class RunsModule {}
