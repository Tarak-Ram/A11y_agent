import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { FixesService } from '../src/fixes/fixes.module';
import { RULES, applyEdits, assertMinimal, makeDiff, rankFile, ruleKey, searchTerms } from '../src/fixes/patch';

const HTML = `<html>\n<body>\n  <img src="shoe.jpg">\n  <button class="icon-btn" id="add-shoe"></button>\n</body>\n</html>\n`;

describe('patch engine', () => {
  it('applies unique exact edits and makes a unified diff', () => {
    const out = applyEdits(HTML, [{ old: '<img src="shoe.jpg">', new: '<img src="shoe.jpg" alt="Red running shoe">' }]);
    expect(out).toContain('alt="Red running shoe"');
    const diff = makeDiff('index.html', HTML, out);
    expect(diff).toMatch(/^-\s+<img src="shoe.jpg">/m);
    expect(diff).toMatch(/^\+\s+<img src="shoe.jpg" alt=/m);
  });
  it('rejects missing, ambiguous and empty edits', () => {
    expect(() => applyEdits(HTML, [{ old: 'nope', new: 'x' }])).toThrow(/not found/);
    expect(() => applyEdits('<p></p><p></p>', [{ old: '<p>', new: '<p class=a>' }])).toThrow(/ambiguous/);
    expect(() => applyEdits(HTML, [])).toThrow();
  });
  it('refuses patches that are not minimal', () => {
    const big = 'x'.repeat(5000);
    expect(() => assertMinimal(HTML, [{ old: HTML, new: big }])).toThrow(/minimal/);
    expect(() => assertMinimal(HTML, Array(8).fill({ old: 'a', new: 'b' }))).toThrow(/minimal/);
  });
  it('maps findings to supported rules, by axe id then by SC', () => {
    expect(ruleKey({ axeRuleId: 'image-alt', wcagRule: '1.1.1' })).toBe('image-alt');
    expect(ruleKey({ axeRuleId: null, wcagRule: '1.4.3' })).toBe('color-contrast');
    expect(ruleKey({ axeRuleId: 'region', wcagRule: 'region' })).toBeNull();
  });
  it('derives search terms from selector and html, and ranks files by them', () => {
    const terms = searchTerms({ selector: '#add-shoe', html: '<button class="icon-btn" id="add-shoe"></button>' });
    expect(terms).toEqual(expect.arrayContaining(['add-shoe', 'icon-btn']));
    expect(rankFile(HTML, terms, 'markup', 'index.html')).toBeGreaterThan(rankFile('<p>nothing</p>', terms, 'markup', 'other.html'));
    expect(rankFile('.icon-btn{}', terms, 'style', 'a.css')).toBeGreaterThan(rankFile('.icon-btn{}', terms, 'style', 'a.html'));
  });
});

describe('rule coverage', () => {
  it('supports the original six plus the extended set', () => {
    for (const k of ['color-contrast', 'image-alt', 'label', 'select-name', 'button-name', 'link-name', 'html-has-lang', 'tabindex', 'document-title', 'meta-viewport', 'frame-title', 'input-button-name', 'svg-img-alt', 'scrollable-region-focusable', 'autocomplete-valid', 'bypass', 'target-size', 'link-in-text-block']) {
      expect(RULES[k]).toBeDefined();
      expect(ruleKey({ axeRuleId: k, wcagRule: '0.0.0' })).toBe(k);
      expect(RULES[k].hint.length).toBeGreaterThan(20);
    }
  });
  it('falls back from SC when the axe id is unsupported', () => {
    expect(ruleKey({ axeRuleId: 'region', wcagRule: '2.4.2' })).toBe('document-title');
    expect(ruleKey({ axeRuleId: 'region', wcagRule: '9.9.9' })).toBeNull();
  });
});

describe('FixesService', () => {
  const finding = {
    id: 'f1', axeRuleId: 'button-name', wcagRule: '4.1.2', selector: '#add-shoe', severity: 'critical', description: 'Buttons must have discernible text', html: '<button class="icon-btn" id="add-shoe"></button>', confirmedByAxe: true,
    personaRun: { personaType: 'blind', score: 40, run: { taskId: 't1', project: { id: 'p1', userId: 'u1', repoFullName: 'o/r', user: { githubInstallationId: '99' } } } },
  };
  const mk = (over: Partial<{ file: string; edits: any[]; fileContent: string }> = {}) => {
    const content = over.fileContent ?? HTML;
    const prisma: any = {
      finding: { findFirst: jest.fn().mockResolvedValue(finding) },
      fix: { create: jest.fn(async ({ data }) => ({ id: 'fix123456', ...data })), findFirst: jest.fn(), update: jest.fn(async ({ data }) => ({ id: 'fix123456', ...data })) },
    };
    const gh: any = {
      installationToken: jest.fn().mockResolvedValue('tok'),
      candidatePaths: jest.fn().mockResolvedValue(['index.html']),
      getFile: jest.fn().mockResolvedValue({ content, sha: 'sha1' }),
      defaultBranch: jest.fn().mockResolvedValue('main'),
      createBranch: jest.fn(), putFile: jest.fn(), createPr: jest.fn().mockResolvedValue({ html_url: 'https://github.com/o/r/pull/7', number: 7 }),
      previewUrl: jest.fn().mockResolvedValue(null), comment: jest.fn(),
      merge: jest.fn(), mergePr: jest.fn(),
    };
    const model: any = { propose: jest.fn().mockResolvedValue({ file: over.file ?? 'index.html', edits: over.edits ?? [{ old: '<button class="icon-btn" id="add-shoe"></button>', new: '<button class="icon-btn" id="add-shoe" aria-label="Add shoe to cart"></button>' }], explanation: 'Names the button.' }) };
    const svc = new FixesService(prisma, gh, model, {} as any);
    jest.spyOn(svc as any, 'verifyOnPreview').mockResolvedValue(undefined);
    return { svc, prisma, gh, model };
  };

  it('proposes a patch without touching the repo', async () => {
    const { svc, gh, prisma } = mk();
    const fix = await svc.propose('u1', 'f1');
    expect(fix.filePath).toBe('index.html');
    expect(fix.diff).toContain('aria-label="Add shoe to cart"');
    expect(prisma.fix.create).toHaveBeenCalledTimes(1);
    expect(gh.createBranch).not.toHaveBeenCalled();
    expect(gh.putFile).not.toHaveBeenCalled();
  });
  it('rejects a model patch that does not apply, or targets an unknown file', async () => {
    await expect(mk({ edits: [{ old: 'does not exist', new: 'x' }] }).svc.propose('u1', 'f1')).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(mk({ file: 'secrets.env' }).svc.propose('u1', 'f1')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
  it('rejects unsupported rules', async () => {
    const m = mk();
    m.prisma.finding.findFirst.mockResolvedValue({ ...finding, axeRuleId: 'region', wcagRule: 'region' });
    await expect(m.svc.propose('u1', 'f1')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
  it('requires a connected repo and GitHub installation', async () => {
    const m = mk();
    m.prisma.finding.findFirst.mockResolvedValue({ ...finding, personaRun: { ...finding.personaRun, run: { ...finding.personaRun.run, project: { ...finding.personaRun.run.project, repoFullName: null } } } });
    await expect(m.svc.propose('u1', 'f1')).rejects.toBeInstanceOf(ConflictException);
  });

  const proposed = { id: 'fix123456', findingId: 'f1', status: 'proposed', filePath: 'index.html', ruleKey: 'button-name', diff: 'd', explanation: 'Names the button.', edits: [{ old: '<button class="icon-btn" id="add-shoe"></button>', new: '<button class="icon-btn" id="add-shoe" aria-label="Add shoe"></button>' }], finding };
  it('opens a PR on a new branch and never merges', async () => {
    const m = mk();
    m.prisma.fix.findFirst.mockResolvedValue(proposed);
    const out = await m.svc.openPr('u1', 'fix123456');
    expect(m.gh.createBranch).toHaveBeenCalledWith('tok', 'o/r', expect.stringMatching(/^a11yagents\/fix-button-name-/), 'main');
    expect(m.gh.putFile).toHaveBeenCalledWith('tok', 'o/r', 'index.html', expect.stringMatching(/^a11yagents\//), expect.stringContaining('aria-label="Add shoe"'), 'sha1', expect.any(String));
    const body = m.gh.createPr.mock.calls[0][5] as string;
    expect(body).toMatch(/Before/);
    expect(body).toMatch(/After/);
    expect(body).toMatch(/never merged automatically/);
    expect(m.gh.merge).not.toHaveBeenCalled();
    expect(m.gh.mergePr).not.toHaveBeenCalled();
    expect(out).toMatchObject({ status: 'pr_open', prUrl: 'https://github.com/o/r/pull/7' });
  });
  it('fails safe if the file changed since the proposal', async () => {
    const m = mk({ fileContent: '<html>completely different</html>' });
    m.prisma.fix.findFirst.mockResolvedValue(proposed);
    await expect(m.svc.openPr('u1', 'fix123456')).rejects.toBeInstanceOf(ConflictException);
    expect(m.gh.putFile).not.toHaveBeenCalled();
    expect(m.prisma.fix.update).toHaveBeenCalledWith({ where: { id: 'fix123456' }, data: { status: 'failed' } });
  });
  it('refuses to open a PR twice', async () => {
    const m = mk();
    m.prisma.fix.findFirst.mockResolvedValue({ ...proposed, status: 'pr_open' });
    await expect(m.svc.openPr('u1', 'fix123456')).rejects.toBeInstanceOf(ConflictException);
  });
});
