import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import {
  getCombinedPresetPattern,
  presetRequiresOrgMode,
  TOOL_CATEGORIES,
} from '../src/tool-categories.js';
import { DYNAMICS_TOOL_PRESETS } from '../src/dynamics-tools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const endpoints: Array<{ toolName: string; pathPattern: string; presets?: string[] }> = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'src', 'endpoints.json'), 'utf8')
);
const allToolNames = [...new Set([...endpoints.map((e) => e.toolName), ...DYNAMICS_TOOL_PRESETS])];

function matchedTools(preset: string): string[] {
  const re = new RegExp(TOOL_CATEGORIES[preset].pattern.source, 'i');
  return allToolNames.filter((name) => re.test(name));
}

describe('tool presets', () => {
  it('endpoints.json presets values are limited to known preset names', () => {
    const known = new Set(Object.keys(TOOL_CATEGORIES).filter((name) => name !== 'all'));
    const unknown = endpoints.filter((e) => e.presets?.some((p) => !known.has(p)));
    expect(unknown.map((e) => `${e.toolName}: ${e.presets}`)).toEqual([]);
  });

  it('every preset matches a non-empty tool set', () => {
    for (const name of Object.keys(TOOL_CATEGORIES)) {
      expect(matchedTools(name).length, `preset ${name}`).toBeGreaterThan(0);
    }
  });

  it('preset patterns are exact (anchored), not substring matches', () => {
    const re = new RegExp(TOOL_CATEGORIES.mail.pattern.source, 'i');
    expect(re.test('list-mail-messages')).toBe(true);
    expect(re.test('list-mail-messages-extra')).toBe(false);
    expect(re.test('x-list-mail-messages')).toBe(false);
  });

  it('mail covers personal mail without shared-mailbox leakage', () => {
    const tools = matchedTools('mail');
    expect(tools).toContain('list-mail-messages');
    expect(tools).toContain('send-mail');
    expect(tools).not.toContain('list-shared-mailbox-messages');
    expect(tools).not.toContain('send-shared-mailbox-mail');
  });

  it('files covers OneDrive without mail-folder or sharepoint leakage', () => {
    const tools = matchedTools('files');
    expect(tools).toContain('get-drive-item');
    expect(tools).toContain('upload-file-content');
    expect(tools).not.toContain('list-mail-folders');
    expect(tools).not.toContain('list-contact-folders');
    expect(tools).not.toContain('list-sharepoint-site-drives');
  });

  it('work covers org tools without leaking personal list-* tools', () => {
    const tools = matchedTools('work');
    expect(tools).toContain('list-shared-mailbox-messages');
    expect(tools).toContain('list-sharepoint-site-lists');
    expect(tools).toContain('list-chats');
    expect(tools).not.toContain('list-mail-messages');
    expect(tools).not.toContain('list-todo-tasks');
  });

  it('outlook covers mail, calendar and contacts without shared-mailbox or drive leakage', () => {
    const tools = matchedTools('outlook');
    expect(tools).toContain('list-mail-messages');
    expect(tools).toContain('create-calendar-event');
    expect(tools).toContain('list-shared-calendar-events');
    expect(tools).toContain('get-shared-calendar-view');
    expect(tools).toContain('list-outlook-contacts');
    expect(tools).not.toContain('list-shared-mailbox-messages');
    expect(tools).not.toContain('get-drive-item');
    expect(tools).not.toContain('list-chats');
  });

  it('calendar includes shared-calendar reads without shared-mailbox leakage', () => {
    const tools = matchedTools('calendar');
    expect(tools).toContain('list-calendar-events');
    expect(tools).toContain('list-shared-calendar-events');
    expect(tools).toContain('get-shared-calendar-view');
    expect(tools).not.toContain('list-shared-mailbox-messages');
  });

  it('onedrive covers drive operations without excel or mail-folder leakage', () => {
    const tools = matchedTools('onedrive');
    expect(tools).toContain('get-drive-root-item');
    expect(tools).toContain('upload-file-content');
    expect(tools).toContain('search-onedrive-files');
    expect(tools).not.toContain('get-excel-range');
    expect(tools).not.toContain('list-mail-folders');
    expect(tools).not.toContain('list-sharepoint-site-drives');
  });

  it('teams covers chats, channels, meetings and presence', () => {
    const tools = matchedTools('teams');
    expect(tools).toContain('list-chats');
    expect(tools).toContain('send-channel-message');
    expect(tools).toContain('create-online-meeting');
    expect(tools).toContain('set-my-presence');
    expect(tools).not.toContain('list-mail-messages');
    expect(tools).not.toContain('list-sharepoint-site-lists');
  });

  it('org-mode requirements are preserved', () => {
    expect(presetRequiresOrgMode('work')).toBe(true);
    expect(presetRequiresOrgMode('users')).toBe(true);
    expect(presetRequiresOrgMode('teams')).toBe(true);
    expect(presetRequiresOrgMode('mail')).toBe(false);
    expect(presetRequiresOrgMode('outlook')).toBe(false);
    expect(presetRequiresOrgMode('onedrive')).toBe(false);
    expect(presetRequiresOrgMode('dynamics')).toBe(true);
  });

  it('dynamics contains only configured Dynamics tools', () => {
    const tools = matchedTools('dynamics');
    expect(tools).toContain('dynamics-query-records');
    expect(tools).toContain('dynamics-create-account');
    expect(tools).not.toContain('list-mail-messages');
  });

  it('presets compose via getCombinedPresetPattern', () => {
    const re = new RegExp(getCombinedPresetPattern(['outlook', 'onedrive']), 'i');
    expect(re.test('list-mail-messages')).toBe(true);
    expect(re.test('get-drive-root-item')).toBe(true);
    expect(re.test('dynamics-query-records')).toBe(false);
    expect(re.test('list-chats')).toBe(false);

    const withDynamics = new RegExp(getCombinedPresetPattern(['mail', 'dynamics']), 'i');
    expect(withDynamics.test('list-mail-messages')).toBe(true);
    expect(withDynamics.test('dynamics-query-records')).toBe(true);
  });

  it('all matches everything', () => {
    expect(matchedTools('all')).toEqual(allToolNames);
  });
});
