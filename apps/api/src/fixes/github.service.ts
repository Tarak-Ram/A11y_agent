import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createSign } from 'crypto';

const API = 'https://api.github.com';
const SOURCE_EXT = /\.(html?|jsx|tsx|vue|svelte|css|scss|sass|less|php|erb|hbs|njk|astro|js|ts)$/i;
const SKIP = /(^|\/)(node_modules|dist|build|\.next|vendor|coverage|\.git)\//;

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** GitHub App client. Installation tokens are short-lived and never stored. */
@Injectable()
export class GithubService {
  configured() {
    return Boolean(process.env.GITHUB_APP_ID && process.env.GITHUB_PRIVATE_KEY);
  }

  private appJwt(): string {
    if (!this.configured()) throw new ServiceUnavailableException('GitHub App is not configured (GITHUB_APP_ID / GITHUB_PRIVATE_KEY)');
    const now = Math.floor(Date.now() / 1000);
    const data = `${b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64u(JSON.stringify({ iat: now - 30, exp: now + 540, iss: process.env.GITHUB_APP_ID }))}`;
    const key = process.env.GITHUB_PRIVATE_KEY!.replace(/\\n/g, '\n');
    return `${data}.${createSign('RSA-SHA256').update(data).sign(key).toString('base64url')}`;
  }

  private async req<T>(token: string, method: string, path: string, body?: unknown, ok: number[] = [200, 201]): Promise<T> {
    const res = await fetch(path.startsWith('http') ? path : API + path, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json', 'user-agent': 'a11yagents' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    if (!ok.includes(res.status)) throw new BadGatewayException(`GitHub ${method} ${path.split('?')[0]} -> ${res.status}`);
    return (res.status === 204 ? {} : await res.json()) as T;
  }

  async installationToken(installationId: string): Promise<string> {
    const r = await this.req<{ token: string }>(this.appJwt(), 'POST', `/app/installations/${installationId}/access_tokens`);
    return r.token;
  }

  /** Confirm the signed-in GitHub user really has this installation (stops claiming someone else's). */
  async userHasInstallation(oauthCode: string, installationId: string): Promise<boolean> {
    const tok = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code: oauthCode }),
    }).then((r) => r.json() as Promise<{ access_token?: string }>);
    if (!tok.access_token) return false;
    const list = await this.req<{ installations: { id: number }[] }>(tok.access_token, 'GET', '/user/installations');
    return list.installations.some((i) => String(i.id) === installationId);
  }

  defaultBranch(t: string, repo: string) {
    return this.req<{ default_branch: string }>(t, 'GET', `/repos/${repo}`).then((r) => r.default_branch);
  }

  /** Candidate source files: code search for each term, falling back to the repo tree. */
  async candidatePaths(t: string, repo: string, terms: string[]): Promise<string[]> {
    const hits = new Map<string, number>();
    for (const term of terms.slice(0, 5)) {
      try {
        const r = await this.req<{ items: { path: string }[] }>(t, 'GET', `/search/code?q=${encodeURIComponent(`"${term}" repo:${repo}`)}&per_page=10`);
        for (const i of r.items) if (SOURCE_EXT.test(i.path) && !SKIP.test(i.path)) hits.set(i.path, (hits.get(i.path) ?? 0) + 1);
      } catch {
        /* search is best-effort (rate limited, or index not ready) */
      }
    }
    if (hits.size) return [...hits.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p).slice(0, 6);
    const branch = await this.defaultBranch(t, repo);
    const tree = await this.req<{ tree: { path: string; type: string; size?: number }[] }>(t, 'GET', `/repos/${repo}/git/trees/${branch}?recursive=1`);
    return tree.tree.filter((n) => n.type === 'blob' && SOURCE_EXT.test(n.path) && !SKIP.test(n.path) && (n.size ?? 0) < 200_000).map((n) => n.path).slice(0, 25);
  }

  async getFile(t: string, repo: string, path: string, ref?: string): Promise<{ content: string; sha: string }> {
    const r = await this.req<{ content: string; sha: string; encoding: string }>(t, 'GET', `/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`);
    return { content: Buffer.from(r.content, 'base64').toString('utf8'), sha: r.sha };
  }

  async createBranch(t: string, repo: string, name: string, from: string) {
    const ref = await this.req<{ object: { sha: string } }>(t, 'GET', `/repos/${repo}/git/ref/heads/${from}`);
    await this.req(t, 'POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${name}`, sha: ref.object.sha });
  }

  putFile(t: string, repo: string, path: string, branch: string, content: string, sha: string, message: string) {
    return this.req(t, 'PUT', `/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, { message, content: Buffer.from(content).toString('base64'), sha, branch });
  }

  createPr(t: string, repo: string, head: string, base: string, title: string, body: string) {
    return this.req<{ html_url: string; number: number }>(t, 'POST', `/repos/${repo}/pulls`, { title, head, base, body, maintainer_can_modify: true });
  }

  comment(t: string, repo: string, prNumber: number, body: string) {
    return this.req(t, 'POST', `/repos/${repo}/issues/${prNumber}/comments`, { body });
  }

  /** Preview deployment URL for a branch (Vercel/Netlify/Cloud Run etc. report it via the Deployments API). */
  async previewUrl(t: string, repo: string, branch: string): Promise<string | null> {
    const deps = await this.req<{ id: number }[]>(t, 'GET', `/repos/${repo}/deployments?ref=${encodeURIComponent(branch)}&per_page=3`).catch(() => []);
    for (const d of deps) {
      const sts = await this.req<{ state: string; environment_url?: string }[]>(t, 'GET', `/repos/${repo}/deployments/${d.id}/statuses?per_page=5`).catch(() => []);
      const ok = sts.find((s) => s.state === 'success' && s.environment_url);
      if (ok) return ok.environment_url!;
    }
    return null;
  }
}
