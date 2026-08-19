// Shared browser-origin allowlist for every Edge Function that answers a
// request from the app itself rather than another service.
//
// Reflects the request's own `Origin` back only when it is one RotaFlow
// actually ships from, instead of a blanket '*'. A wildcard lets any origin
// holding a leaked access token read the response; this does not. Non-browser
// callers (curl, another server, Inngest's own signed requests) are
// unaffected either way — CORS is a browser-only check, and every function
// using this still requires its own valid auth independently.
const ALLOWED_ORIGINS = new Set<string>([
  'https://rota.gakinz.com',
  // Per-project dev ports (CLAUDE.md §4): 5042 is rotaflow's assigned port,
  // 5142/5842 cover a second worktree and a preview run on the Supabase Auth
  // redirect allowlist.
  'http://localhost:5042',
  'http://localhost:5142',
  'http://localhost:5842',
]);

export function corsHeaders(
  req: Request,
  allowHeaders: string,
  allowMethods = 'POST, OPTIONS',
): Record<string, string> {
  const origin = req.headers.get('Origin');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': allowHeaders,
    'Access-Control-Allow-Methods': allowMethods,
    Vary: 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}
