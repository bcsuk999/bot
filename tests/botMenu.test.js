import { describe, it, expect, vi } from 'vitest';
import { GROUP_MENU, OWNER_MENU, setupCommandMenus } from '../services/bot/commands.js';
import { helpText } from '../services/bot/handlers/help.js';

describe('group command menu', () => {
  it('never advertises /reg', () => {
    expect(GROUP_MENU.map((c) => c.command)).toEqual(['start', 'balance', 'deposit', 'status', 'daily']);
    expect(GROUP_MENU.some((c) => c.command === 'reg')).toBe(false);
  });

  it('has a description for every command', () => {
    for (const c of GROUP_MENU) {
      expect(c.description.length).toBeGreaterThanOrEqual(3);
      expect(c.description.length).toBeLessThanOrEqual(256);
    }
  });
});

describe('owner command menu', () => {
  it('advertises /reg', () => {
    expect(OWNER_MENU.map((c) => c.command)).toContain('reg');
  });
});

describe('setupCommandMenus', () => {
  it('publishes the group menu and the owner-private menu', async () => {
    const setMyCommands = vi.fn().mockResolvedValue(true);
    const ok = await setupCommandMenus({ setMyCommands }, { ownerId: 42 });

    expect(ok).toBe(true);
    expect(setMyCommands).toHaveBeenCalledTimes(2);
    expect(setMyCommands).toHaveBeenNthCalledWith(1, GROUP_MENU, {
      scope: { type: 'all_group_chats' },
    });
    expect(setMyCommands).toHaveBeenNthCalledWith(2, OWNER_MENU, {
      scope: { type: 'chat', chat_id: 42 },
    });
  });

  it('skips the owner scope when no owner is configured', async () => {
    const setMyCommands = vi.fn().mockResolvedValue(true);
    const ok = await setupCommandMenus({ setMyCommands }, { ownerId: null });

    expect(ok).toBe(true);
    expect(setMyCommands).toHaveBeenCalledTimes(1);
  });

  it('never throws when Telegram rejects a scope', async () => {
    const setMyCommands = vi.fn().mockRejectedValue(new Error('chat not found'));
    const ok = await setupCommandMenus({ setMyCommands }, { ownerId: 42 });

    expect(ok).toBe(false);
    expect(setMyCommands).toHaveBeenCalledTimes(2);
  });
});

describe('helpText', () => {
  it('hides /reg in groups', () => {
    expect(helpText()).not.toContain('/reg');
    expect(helpText({ isOwner: false })).not.toContain('/reg');
  });

  it('shows /reg in the owner private chat', () => {
    expect(helpText({ isOwner: true })).toContain('/reg');
  });
});
