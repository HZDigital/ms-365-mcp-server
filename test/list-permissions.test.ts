import { describe, expect, it } from 'vitest';
import { buildAllowedScopeDiagnostics, buildScopeDiagnostics } from '../src/auth.js';

describe('--list-permissions diagnostics', () => {
  it('prints legacy permissions alias for effective permissions', () => {
    const output = buildAllowedScopeDiagnostics({
      enabledTools: 'list-mail-messages|list-drive-items',
      allowedScopes: 'Mail.ReadWrite Files.ReadWrite.All User.Read',
    });

    expect(output.permissions).toEqual(output.effectivePermissions);
    expect(output.allowedScopes).toEqual(['Files.ReadWrite.All', 'Mail.ReadWrite', 'User.Read']);
    expect(output.missingAllowedScopesForTools).toEqual([]);
    expect(output.extraAllowedScopesNotUsedByTools).not.toContain('Mail.ReadWrite');
  });

  it('reports disabled tools and missing scopes', () => {
    const output = buildAllowedScopeDiagnostics({
      enabledTools: 'list-mail-messages|list-calendar-events',
      allowedScopes: 'Mail.Read',
    });

    expect(output.toolPermissions).toEqual(expect.arrayContaining(['Mail.Read', 'Calendars.Read']));
    expect(output.effectivePermissions).toEqual(['Mail.Read']);
    expect(output.permissions).toEqual(output.effectivePermissions);
    expect(output.disabledTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'list-calendar-events',
          missingScopes: ['Calendars.Read'],
        }),
      ])
    );
  });

  it('keeps shared-calendar tools enabled with their delegated shared scope', () => {
    const output = buildAllowedScopeDiagnostics({
      orgMode: true,
      enabledTools: 'list-shared-calendar-events|get-shared-calendar-view',
      allowedScopes: 'Calendars.Read.Shared',
    });

    expect(output.toolPermissions).toEqual(['Calendars.Read.Shared']);
    expect(output.effectivePermissions).toEqual(['Calendars.Read.Shared']);
    expect(output.disabledTools).toEqual([]);
  });

  it('reports shared-calendar tools as disabled without their delegated shared scope', () => {
    const output = buildAllowedScopeDiagnostics({
      orgMode: true,
      enabledTools: 'list-shared-calendar-events|get-shared-calendar-view',
      allowedScopes: 'Calendars.Read',
    });

    expect(output.disabledTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'list-shared-calendar-events',
          missingScopes: ['Calendars.Read.Shared'],
        }),
        expect.objectContaining({
          toolName: 'get-shared-calendar-view',
          missingScopes: ['Calendars.Read.Shared'],
        }),
      ])
    );
  });

  it('keeps hierarchy coverage from reporting false missing scopes', () => {
    const output = buildScopeDiagnostics(['Files.Read', 'Mail.Read'], ['Mail.Read']);

    expect(output.missingAllowedScopesForTools).toEqual(['Files.Read']);
  });
});
