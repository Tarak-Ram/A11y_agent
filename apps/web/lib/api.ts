export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface Options extends RequestInit {
  json?: unknown;
  /** Don't bounce to /login on 401 (used by the session probe on public pages). */
  quiet?: boolean;
}

/**
 * The session is an httpOnly cookie set by the API, so scripts never see a token.
 * `x-csrf` is required by the API for cookie-authenticated writes; other origins cannot add it without a CORS preflight.
 */
export async function api<T>(path: string, init: Options = {}): Promise<T> {
  const { json, quiet, ...rest } = init;
  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    credentials: 'include',
    headers: { 'x-csrf': '1', ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401) {
    if (!quiet && typeof window !== 'undefined') window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    throw new ApiError(401, 'Please sign in again.');
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      msg = Array.isArray(body.message) ? body.message.join('. ') : body.message ?? msg;
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

/** EventSource sends the cookie when `withCredentials` is set; no token in the URL. */
export const openRunStream = (runId: string) => new EventSource(`${API_URL}/runs/${runId}/stream`, { withCredentials: true });

/** Only same-site relative paths, so `?next=` cannot become an open redirect. */
export const safeNext = (n: string | null | undefined) => (n && /^\/(?!\/)[\w\-/?=&.%]*$/.test(n) ? n : '/dashboard');
