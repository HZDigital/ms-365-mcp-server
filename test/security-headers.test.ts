import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { securityHeaders } from '../src/lib/security-headers.js';

describe('securityHeaders', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    const app = express();
    app.use(securityHeaders());
    app.get('/authorize', (_req, res) => res.redirect('https://login.microsoftonline.com/'));
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('omits Cross-Origin-Opener-Policy so an OAuth popup keeps window.opener', async () => {
    const res = await fetch(`${baseUrl}/authorize`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('cross-origin-opener-policy')).toBeNull();
  });

  it('keeps the remaining helmet headers', async () => {
    const res = await fetch(`${baseUrl}/authorize`, { redirect: 'manual' });
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('strict-transport-security')).toBe(
      'max-age=31536000; includeSubDomains; preload'
    );
    expect(res.headers.get('content-security-policy')).toBeNull();
  });
});
