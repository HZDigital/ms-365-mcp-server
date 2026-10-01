import helmet from 'helmet';
import type { RequestHandler } from 'express';

/**
 * Security headers shared by every HTTP listener.
 *
 * CSP is disabled because this server returns JSON and OAuth metadata, not
 * HTML; HSTS assumes TLS is terminated upstream.
 *
 * Cross-Origin-Opener-Policy is disabled because browsers enforce it on
 * redirect responses too. MCP clients commonly run the OAuth flow in a popup
 * whose first hop is this server's /authorize redirect; `same-origin` there
 * moves the popup into a new browsing context group, severs `window.opener`,
 * and the client's callback page can no longer hand the code back. The server
 * serves no documents for COOP to protect.
 */
export function securityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  });
}
