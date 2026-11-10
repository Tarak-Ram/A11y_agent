import { BadRequestException, Controller, Get, Injectable, Logger, Module, NotFoundException, Param, Post, Query, Redirect, UnprocessableEntityException, UseGuards, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { PrismaService } from '../common/prisma.service';
import { explain } from '../common/wcag';
import { RunsModule, RunsService } from '../runs/runs.module';
import { GithubService } from './github.service';
import { Edit, RULES, applyEdits, assertMinimal, makeDiff, rankFile, ruleKey, searchTerms } from './patch';

/** Pluggable so tests can run without Gemini. */
export abstract class PatchModel {
  abstract propose(input: { rule: string; hint: string; finding: { selector: string; description: string; html?: string | null; wcagRule: string }; files: { path: string; content: string }[] }): Promise<{ file: string; edits: Edit[]; explanation: string }>;
}

@Injectable()
export class GeminiPatchModel extends PatchModel {
  async propose(input: Parameters<PatchModel['propose']>[0]) {
    if (!process.env.GEMINI_API_KEY) throw new ServiceUnavailableException('GEMINI_API_KEY is not set');
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const files = input.files.map((f) => `=== FILE: ${f.path} ===\n${f.content.slice(0, 60_000)}`).join('\n\n');
    const prompt = `You fix ONE accessibility defect with the smallest possible source change.
WCAG rule: ${input.rule} (${input.finding.wcagRule}). Guidance: ${input.hint}
Defect: ${input.finding.description}
Selector: ${input.finding.selector}
Rendered HTML of the element: ${input.finding.html ?? '(not available)'}

Source files (the rendered HTML may come from a template/component in one of them):
${files}

Return JSON: {"file": "<path of exactly one file above>", "edits": [{"old": "<exact text from that file, unique in it>", "new": "<replacement>"}], "explanation": "<2 sentences, plain English, why this fixes it for people>"}.
Rules: every "old" must be copied verbatim and appear exactly once in the file; change only what the defect needs; do not reformat, rename, or touch other code; at most 4 edits. If the defect cannot be fixed in these files, return {"file":"","edits":[],"explanation":"<why>"}.`;
    const res = await ai.models.generateContent({ model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash', contents: prompt, config: { responseMimeType: 'application/json', temperature: 0.1 } });
    const out = JSON.parse(res.text ?? '{}');
    return { file: String(out.file ?? ''), edits: Array.isArray(out.edits) ? out.edits.map((e: any) => ({ old: String(e.old ?? ''), new: String(e.new ?? '') })) : [], explanation: String(out.explanation ?? '') };
  }
}

@Injectable()
export class FixesService {
  private log = new Logger(FixesService.name);
  constructor(private prisma: PrismaService, private gh: GithubService, private model: PatchModel, private runs: RunsService) {}

  private async ownedFinding(userId: string, id: string) {
    const f = await this.prisma.finding.findFirst({
      where: { id, personaRun: { run: { project: { userId } } } },
      include: { personaRun: { include: { run: { include: { project: { include: { user: true } }, task: true } } } } },
    });
    if (!f) throw new NotFoundException('Finding not found');
    return f;
  }

  private async token(user: { githubInstallationId: string | null }) {
    if (!user.githubInstallationId) throw new ConflictException('Connect GitHub first (Settings -> GitHub)');
    return this.gh.installationToken(user.githubInstallationId);
  }

  /** Map the finding to a source file, ask Gemini for a minimal patch, and save it as a proposed Fix (nothing is pushed yet). */
  async propose(userId: string, findingId: string) {
    const f = await this.ownedFinding(userId, findingId);
    const project = f.personaRun.run.project;
    const key = ruleKey(f);
    if (!key) throw new UnprocessableEntityException(`Automatic fixes are not supported for this rule yet. Supported: ${Object.keys(RULES).join(', ')}`);
    if (!project.repoFullName) throw new ConflictException('Connect a GitHub repository to this project first');
    const rule = RULES[key];
    const token = await this.token(project.user);

    const terms = searchTerms(f);
    const paths = await this.gh.candidatePaths(token, project.repoFullName, terms);
    const loaded = (await Promise.all(paths.slice(0, 12).map((p) => this.gh.getFile(token, project.repoFullName!, p).then((c) => ({ path: p, content: c.content })).catch(() => null)))).filter((x): x is { path: string; content: string } => !!x);
    const ranked = loaded.map((l) => ({ ...l, score: rankFile(l.content, terms, rule.prefer, l.path) })).sort((a, b) => b.score - a.score).filter((l) => l.score > 0).slice(0, 2);
    if (!ranked.length) throw new UnprocessableEntityException('Could not find the failing element in the repository source');

    const proposal = await this.model.propose({ rule: rule.title, hint: rule.hint, finding: f, files: ranked });
    const target = ranked.find((r) => r.path === proposal.file);
    if (!target || !proposal.edits.length) throw new UnprocessableEntityException(proposal.explanation || 'No safe patch could be generated');
    let patched: string;
    try {
      assertMinimal(target.content, proposal.edits);
      patched = applyEdits(target.content, proposal.edits);
    } catch (e) {
      throw new UnprocessableEntityException(`Generated patch was rejected: ${(e as Error).message}`);
    }
    return this.prisma.fix.create({
      data: { findingId, filePath: target.path, diff: makeDiff(target.path, target.content, patched), edits: proposal.edits as never, explanation: proposal.explanation, ruleKey: key, personaType: f.personaRun.personaType, beforeScore: f.personaRun.score },
    });
  }

  async getOwned(userId: string, id: string) {
    const fix = await this.prisma.fix.findFirst({ where: { id, finding: { personaRun: { run: { project: { userId } } } } }, include: { finding: true } });
    if (!fix) throw new NotFoundException('Fix not found');
    return fix;
  }

  /** Branch + commit + PR. Never merges: a human reviews and merges. */
  async openPr(userId: string, fixId: string) {
    const fix = await this.getOwned(userId, fixId);
    if (fix.status !== 'proposed') throw new ConflictException(`Fix is already ${fix.status}`);
    const f = await this.ownedFinding(userId, fix.findingId);
    const project = f.personaRun.run.project;
    const repo = project.repoFullName!;
    const token = await this.token(project.user);
    const base = await this.gh.defaultBranch(token, repo);
    const branch = `a11yagents/fix-${fix.ruleKey}-${fix.id.slice(-6)}`;

    // Re-apply against the CURRENT file so we never clobber changes made since the proposal.
    const current = await this.gh.getFile(token, repo, fix.filePath, base);
    let patched: string;
    try {
      patched = applyEdits(current.content, fix.edits as unknown as Edit[]);
    } catch (e) {
      await this.prisma.fix.update({ where: { id: fix.id }, data: { status: 'failed' } });
      throw new ConflictException(`The file changed since this fix was generated: ${(e as Error).message}. Generate the fix again.`);
    }
    const info = explain(f.wcagRule, f.axeRuleId);
    await this.gh.createBranch(token, repo, branch, base);
    await this.gh.putFile(token, repo, fix.filePath, branch, patched, current.sha, `fix(a11y): ${info.title}`);
    const pr = await this.gh.createPr(token, repo, branch, base, `fix(a11y): ${info.title}`, this.prBody(fix, f, info));
    const updated = await this.prisma.fix.update({ where: { id: fix.id }, data: { status: 'pr_open', prUrl: pr.html_url, branch } });
    this.verifyOnPreview(fix.id, token, repo, branch, pr.number).catch((e) => this.log.warn({ err: String(e) }, 'preview verification skipped'));
    return updated;
  }

  prBody(fix: { diff: string; explanation: string | null; filePath: string }, f: any, info: { title: string; why: string; howToFix: string }) {
    return `## Accessibility fix: ${info.title}

**Found by:** ${f.personaRun.personaType} persona${f.confirmedByAxe ? ' (confirmed by axe-core)' : ' (agent-observed, not confirmed by axe)'}
**WCAG:** ${f.wcagRule}  |  **Severity:** ${f.severity}
**Element:** \`${f.selector}\`

### Before
${f.description}

${info.why}

### After
${fix.explanation ?? info.howToFix}

\`${fix.filePath}\` changed with the smallest edit that fixes this.

<details><summary>Diff</summary>

\`\`\`diff
${fix.diff}
\`\`\`
</details>

---
Generated by A11yAgents. **This PR is never merged automatically**; please review it, and check the result with a screen reader or keyboard if you can. If a preview deployment is available, the same persona will be re-run on it and the result posted here.`;
  }

  /** If the branch gets a preview deployment, re-run the persona on it and comment before/after on the PR. */
  private async verifyOnPreview(fixId: string, token: string, repo: string, branch: string, prNumber: number) {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 15_000));
      const url = await this.gh.previewUrl(token, repo, branch);
      if (!url) continue;
      const fix = await this.prisma.fix.findUnique({ where: { id: fixId }, include: { finding: { include: { personaRun: { include: { run: { include: { project: true } } } } } } } });
      if (!fix || !fix.personaType) return;
      const run = fix.finding.personaRun.run;
      const created = await this.runs.createForUrl(run.project.userId, run.project.id, run.taskId, [fix.personaType], url);
      await this.prisma.fix.update({ where: { id: fixId }, data: { verifyRunId: created.id } });
      await this.gh.comment(token, repo, prNumber, `Preview found (${url}). Re-running the **${fix.personaType}** persona to verify; results will be posted here.`);
      return;
    }
  }

  /** Called when a run finishes: post before/after scores on the PR of any fix that was verifying on this run. */
  async onRunFinished(runId: string) {
    const fixes = await this.prisma.fix.findMany({ where: { verifyRunId: runId }, include: { finding: { include: { personaRun: { include: { run: { include: { project: { include: { user: true } } } } } } } } } });
    for (const fix of fixes) {
      const run = await this.prisma.run.findUnique({ where: { id: runId }, include: { personaRuns: { include: { findings: true } } } });
      const after = run?.personaRuns.find((p) => p.personaType === fix.personaType);
      const project = fix.finding.personaRun.run.project;
      if (!after || !fix.prUrl || !project.repoFullName) continue;
      const stillThere = after.findings.some((x) => x.axeRuleId === fix.finding.axeRuleId && x.selector === fix.finding.selector);
      const num = Number(fix.prUrl.split('/').pop());
      const token = await this.token(project.user);
      await this.gh.comment(token, project.repoFullName, num, `### Verification on preview\n**${fix.personaType}** score: ${fix.beforeScore ?? '?'} -> **${after.score ?? '?'}**\nOriginal issue ${stillThere ? ':x: still present' : ':white_check_mark: no longer detected'}.`);
    }
  }
}

@Controller()
@UseGuards(AuthGuard)
export class FixesController {
  constructor(private svc: FixesService, private prisma: PrismaService, private gh: GithubService) {}

  @Post('findings/:id/fix') propose(@CurrentUser() u: { id: string }, @Param('id') id: string) {
    return this.svc.propose(u.id, id);
  }
  @Get('fixes/:id') get(@CurrentUser() u: { id: string }, @Param('id') id: string) {
    return this.svc.getOwned(u.id, id);
  }
  @Post('fixes/:id/pr') pr(@CurrentUser() u: { id: string }, @Param('id') id: string) {
    return this.svc.openPr(u.id, id);
  }

  /** Settings -> "Connect GitHub": send the user to install the GitHub App. */
  @Get('github/install-url') installUrl() {
    if (!process.env.GITHUB_APP_SLUG) throw new ServiceUnavailableException('GITHUB_APP_SLUG is not set');
    return { url: `https://github.com/apps/${process.env.GITHUB_APP_SLUG}/installations/new` };
  }

  /** Setup URL of the GitHub App (with "Request user authorization during installation" on). */
  @Post('github/connect')
  async connect(@CurrentUser() u: { id: string }, @Query('installation_id') installationId: string, @Query('code') code: string) {
    if (!/^\d+$/.test(installationId ?? '') || !code) throw new BadRequestException('installation_id and code are required');
    if (!(await this.gh.userHasInstallation(code, installationId))) throw new BadRequestException('That installation does not belong to your GitHub account');
    await this.prisma.user.update({ where: { id: u.id }, data: { githubInstallationId: installationId } });
    return { ok: true };
  }
}

@Module({
  imports: [RunsModule],
  controllers: [FixesController],
  providers: [FixesService, GithubService, { provide: PatchModel, useClass: GeminiPatchModel }],
  exports: [FixesService],
})
export class FixesModule {}
