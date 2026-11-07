import { describe, expect, it } from 'vitest';
import { DENY } from '../services/bot/guard.js';
import {
  ALL_COMMANDS,
  getGroupAccessDenial,
  getRegistrationDenial,
  parseCommand,
} from '../services/bot/commands.js';

const config = { ownerId: 987654321 };

describe('group command authorization', () => {
  it('requires a group record before group-scoped commands', () => {
    expect(getGroupAccessDenial('/balance', null)).toBe(DENY.NOT_REGISTERED);
    expect(getGroupAccessDenial('/d', null)).toBe(DENY.NOT_REGISTERED);
  });

  it('allows only the configured owner to register a group', () => {
    expect(getRegistrationDenial({ id: 987654321 }, config)).toBeNull();
    expect(getRegistrationDenial({ id: '987654321' }, config)).toBeNull();
    expect(getRegistrationDenial({ id: 123456789 }, config)).toContain('Only the bot owner');
    expect(getRegistrationDenial({}, config)).toContain('Only the bot owner');
    expect(getRegistrationDenial({ id: 987654321 }, {})).toContain('Only the bot owner');
  });

  it('registers /how, including when typed as "/how to use"', () => {
    expect(ALL_COMMANDS.has('/how')).toBe(true);
    expect(parseCommand('/how')).toEqual({ command: '/how', args: [], unknown: false });
    expect(parseCommand('/how to use')).toEqual({
      command: '/how',
      args: ['to', 'use'],
      unknown: false,
    });
  });

  it('allows group commands for any member when the group is active', () => {
    expect(
      getGroupAccessDenial('/balance', {
        groupId: '-1001234567890',
        status: 'active',
      })
    ).toBeNull();
  });

  it.each([
    ['banned', DENY.BANNED],
    ['suspended', DENY.SUSPENDED],
    ['unknown', DENY.INACTIVE],
  ])('blocks a registered group whose status is %s', (status, denial) => {
    expect(
      getGroupAccessDenial('/balance', {
        groupId: '-1001234567890',
        status,
      })
    ).toBe(denial);
  });
});
