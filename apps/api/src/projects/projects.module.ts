import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, IsUrl, MaxLength, Matches } from 'class-validator';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { PrismaService } from '../common/prisma.service';
import { assertScannableUrl } from '../common/url';

export class CreateProjectDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsUrl({ require_protocol: true, require_tld: false }) url: string;
  @IsOptional() @Matches(/^[\w.-]+\/[\w.-]+$/, { message: 'repoFullName must look like owner/repo' }) repoFullName?: string;
  @IsOptional() @IsString() @MaxLength(10) locale?: string;
}
export class UpdateProjectDto {
  @IsOptional() @Matches(/^[\w.-]+\/[\w.-]+$/, { message: 'repoFullName must look like owner/repo' }) repoFullName?: string | null;
  @IsOptional() @IsString() @MaxLength(100) name?: string;
}
export class CreateTaskDto {
  @IsString() @MaxLength(100) name: string;
  @IsString() @MaxLength(1000) goal: string;
}
export class SuggestDto {
  @IsUrl({ require_protocol: true, require_tld: false }) url: string;
}

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  async getOwned(userId: string, id: string) {
    const p = await this.prisma.project.findFirst({ where: { id, userId } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  async list(userId: string) {
    const projects = await this.prisma.project.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        tasks: true,
        runs: { orderBy: { startedAt: 'desc' }, take: 1, include: { personaRuns: { select: { personaType: true, score: true, status: true } } } },
      },
    });
    return projects.map(({ runs, ...p }) => ({
      ...p,
      latestRun: runs[0] ? { id: runs[0].id, status: runs[0].status, startedAt: runs[0].startedAt, scores: runs[0].personaRuns } : null,
    }));
  }

  async create(userId: string, dto: CreateProjectDto) {
    const url = await assertScannableUrl(dto.url);
    return this.prisma.project.create({ data: { userId, url, name: dto.name || new URL(url).hostname, repoFullName: dto.repoFullName, locale: dto.locale ?? 'en' } });
  }

  async update(userId: string, id: string, dto: UpdateProjectDto) {
    await this.getOwned(userId, id);
    return this.prisma.project.update({ where: { id }, data: { name: dto.name, repoFullName: dto.repoFullName === undefined ? undefined : dto.repoFullName || null } });
  }

  async addTask(userId: string, projectId: string, dto: CreateTaskDto) {
    await this.getOwned(userId, projectId);
    return this.prisma.task.create({ data: { projectId, ...dto } });
  }

  /** Ask Gemini what a real visitor would try to do on this homepage. */
  async suggestTasks(url: string): Promise<{ name: string; goal: string }[]> {
    const safe = await assertScannableUrl(url);
    const fallback = [{ name: 'Explore the homepage', goal: 'Understand what this site offers and find the main call-to-action.' }];
    if (!process.env.GEMINI_API_KEY) return fallback;
    try {
      const html = await fetch(safe, { signal: AbortSignal.timeout(10_000), redirect: 'follow' }).then((r) => r.text());
      const text = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 6000);
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, ...(process.env.GEMINI_BASE_URL ? { httpOptions: { baseUrl: process.env.GEMINI_BASE_URL } } : {}) });
      const res = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL ?? 'gemini-3.8-flash',
        contents: `Homepage text of ${safe}:\n${text}\n\nSuggest 3 to 5 key tasks a first-time visitor would try (e.g. sign up, buy a product, find contact info). Return JSON: [{"name": short title, "goal": one-sentence instruction for a tester}].`,
        config: { responseMimeType: 'application/json' },
      });
      const parsed = JSON.parse(res.text ?? '[]');
      const tasks = (Array.isArray(parsed) ? parsed : []).filter((t) => typeof t?.name === 'string' && typeof t?.goal === 'string').slice(0, 5);
      return tasks.length ? tasks : fallback;
    } catch {
      return fallback;
    }
  }
}

@Controller('projects')
@UseGuards(AuthGuard)
export class ProjectsController {
  constructor(private svc: ProjectsService) {}

  @Get() list(@CurrentUser() u: { id: string }) {
    return this.svc.list(u.id);
  }
  @Post() create(@CurrentUser() u: { id: string }, @Body() dto: CreateProjectDto) {
    return this.svc.create(u.id, dto);
  }
  @Post('suggest-tasks') async suggest(@Body() dto: SuggestDto) {
    return { tasks: await this.svc.suggestTasks(dto.url) };
  }
  @Get(':id') get(@CurrentUser() u: { id: string }, @Param('id') id: string) {
    return this.svc.getOwned(u.id, id);
  }
  @Patch(':id') update(@CurrentUser() u: { id: string }, @Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.svc.update(u.id, id, dto);
  }
  @Post(':id/tasks') addTask(@CurrentUser() u: { id: string }, @Param('id') id: string, @Body() dto: CreateTaskDto) {
    return this.svc.addTask(u.id, id, dto);
  }
}

@Module({ controllers: [ProjectsController], providers: [ProjectsService], exports: [ProjectsService] })
export class ProjectsModule {}
