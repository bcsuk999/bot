import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveAuthority, shouldAlert, pruneAlertCache, resetAlertCache, alertOwner, chatDeepLink, DENY } from '../services/bot/guard.js';
import { loadConfig, parseAllowlist, parsePositiveNumber, parseExpiredStatuses, validateConfig } from '../services/bot/config.js';
import { EXPIRED_STATUSES } from '../controllers/botWebhookController.js';

const OWNER_ID = 987654321;
const ALLOWED_GROUP = -1001234567890;

function makeConfig(overrides = {}) {
  return loadConfig({
    BOT_ENABLED: 'true',
    TELEGRAM_BOT_TOKEN: 'token',
    TELEGRAM_OWNER_ID: String(OWNER_ID),
    TELEGRAM_ALLOWED_GROUP_IDS: String(ALLOWED_GROUP),
    SIMPLYPAY_BOT_NOTIFY_URL: 'https://x.dev/webhook/simplypay/bot',
    ...overrides,
  });
}

describe('parseAllowlist', () => {
  it('parses comma-separated group ids', () => {
    const { ids } = parseAllowlist('-1001234567890,-1009876543210');
    expect([...ids]).toEqual(['-1001234567890', '-1009876543210']);
  });

  it('trims whitespace and drops empty entries', () => {
    const { ids } = parseAllowlist(' -1001234567890 , , -1009876543210 ,');
    expect(ids.size).toBe(2);
  });

  it('separates @usernames from numeric ids', () => {
    const { ids, usernames } = parseAllowlist('-1001234567890,@somegroup');
    expect(ids.size).toBe(1);
    expect([...usernames]).toEqual(['@somegroup']);
  });

  it('collects malformed entries instead of throwing', () => {
    const { ids, invalid } = parseAllowlist('-1001234567890,not-an-id,abc.def');
    expect(ids.size).toBe(1);
    expect(invalid).toEqual(['not-an-id', 'abc.def']);
  });

  it('handles an empty or missing value', () => {
    expect(parseAllowlist('').ids.size).toBe(0);
    expect(parseAllowlist(undefined).ids.size).toBe(0);
    expect(parseAllowlist(null).ids.size).toBe(0);
  });

  it('de-duplicates repeated ids', () => {
    expect(parseAllowlist('-1001234567890,-1001234567890').ids.size).toBe(1);
  });
});

describe('parsePositiveNumber', () => {
  it('parses a positive numeric string', () => {
    expect(parsePositiveNumber('250', 100)).toBe(250);
  });

  it('falls back for missing, zero, negative and non-numeric values', () => {
    expect(parsePositiveNumber('', 7)).toBe(7);
    expect(parsePositiveNumber(undefined, 7)).toBe(7);
    expect(parsePositiveNumber('0', 7)).toBe(7);
    expect(parsePositiveNumber('-5', 7)).toBe(7);
    expect(parsePositiveNumber('abc', 7)).toBe(7);
  });
});

describe('loadConfig / validateConfig', () => {
  it('is disabled unless BOT_ENABLED is exactly true', () => {
    expect(loadConfig({}).enabled).toBe(false);
    expect(loadConfig({ BOT_ENABLED: 'false' }).enabled).toBe(false);
    expect(loadConfig({ BOT_ENABLED: 'TRUE' }).enabled).toBe(true);
    expect(loadConfig({ BOT_ENABLED: 'true' }).enabled).toBe(true);
  });

  it('defaults the deposit bounds', () => {
    const c = loadConfig({});
    expect(c.minDeposit).toBe(100);
    expect(c.maxDeposit).toBe(100000);
  });

  it('reads explicit deposit bounds', () => {
    const c = loadConfig({ BOT_MIN_DEPOSIT_AMOUNT: '50', BOT_MAX_DEPOSIT_AMOUNT: '5000' });
    expect(c.minDeposit).toBe(50);
    expect(c.maxDeposit).toBe(5000);
  });

  it('flags a max below min', () => {
    const c = makeConfig({ BOT_MIN_DEPOSIT_AMOUNT: '500', BOT_MAX_DEPOSIT_AMOUNT: '100' });
    expect(c.maxDepositLowerThanMin).toBe(true);
    expect(validateConfig(c)).toContain('BOT_MAX_DEPOSIT_AMOUNT is below BOT_MIN_DEPOSIT_AMOUNT');
  });

  it('does not flag a max below min when the bot is disabled', () => {
    const c = loadConfig({ BOT_MIN_DEPOSIT_AMOUNT: '500', BOT_MAX_DEPOSIT_AMOUNT: '100' });
    expect(c.maxDepositLowerThanMin).toBe(true);
    expect(validateConfig(c)).toEqual([]);
  });

  it('requires a token and an owner id when enabled', () => {
    const c = loadConfig({ BOT_ENABLED: 'true', TELEGRAM_ALLOWED_GROUP_IDS: '-1001' });
    const problems = validateConfig(c);
    expect(problems).toContain('TELEGRAM_BOT_TOKEN is missing');
    expect(problems).toContain('TELEGRAM_OWNER_ID is missing or not a number');
  });

  it('does not require an allowlist when enabled', () => {
    const c = makeConfig({ TELEGRAM_ALLOWED_GROUP_IDS: '' });
    expect(validateConfig(c)).toEqual([]);
  });

  it('passes validation for a well-formed config', () => {
    expect(validateConfig(makeConfig())).toEqual([]);
  });

  it('skips validation when disabled', () => {
    expect(validateConfig(loadConfig({}))).toEqual([]);
  });

  it('requires a webhook url and a secret in webhook mode', () => {
    const c = makeConfig({ BOT_MODE: 'webhook' });
    expect(validateConfig(c)).toContain('BOT_MODE=webhook requires BOT_WEBHOOK_URL');
    expect(
      validateConfig(makeConfig({ BOT_MODE: 'webhook', BOT_WEBHOOK_URL: 'https://x.dev/bot' }))
    ).toContain('BOT_MODE=webhook requires BOT_WEBHOOK_SECRET');
    expect(
      validateConfig(
        makeConfig({
          BOT_MODE: 'webhook',
          BOT_WEBHOOK_URL: 'https://x.dev/bot',
          BOT_WEBHOOK_SECRET: 's3cr3t',
        })
      )
    ).toEqual([]);
  });

  it('does NOT fall back to the generic payin notify url', () => {
    // Falling back would point group deposits at simplypayController, which looks
    // up Payin by payinId, finds nothing, and silently discards the payment.
    expect(loadConfig({ SIMPLYPAY_NOTIFY_URL: 'https://x.dev/webhook/simplypay/payin' }).botNotifyUrl).toBe('');
    expect(validateConfig(makeConfig({ SIMPLYPAY_BOT_NOTIFY_URL: '' }))).toContain(
      'SIMPLYPAY_BOT_NOTIFY_URL is missing - group deposits could never be settled'
    );
  });

  it('rejects a bot notify url that points at the generic payin callback', () => {
    expect(validateConfig(makeConfig({ SIMPLYPAY_BOT_NOTIFY_URL: 'https://x.dev/webhook/simplypay/payin' }))).toContain(
      'SIMPLYPAY_BOT_NOTIFY_URL must point at /webhook/simplypay/bot'
    );
  });

  it('defaults expired statuses to empty so a live payment is never wrongly expired', () => {
    // The local SimplyPay doc lists 0, 1 and -4 as PENDING and documents no
    // expired code, so guessing one would silently drop a real deposit.
    expect(EXPIRED_STATUSES).toEqual([]);
    expect(parseExpiredStatuses(undefined)).toEqual([]);
    expect(parseExpiredStatuses('')).toEqual([]);
    expect(loadConfig({}).expiredStatuses).toEqual([]);
  });

  it('parses configured expired statuses and ignores junk entries', () => {
    expect(parseExpiredStatuses('4')).toEqual([4]);
    expect(parseExpiredStatuses('4, -5 ,6')).toEqual([4, -5, 6]);
    expect(parseExpiredStatuses('4,abc,')).toEqual([4]);
    expect(loadConfig({ SIMPLYPAY_EXPIRED_STATUSES: '9' }).expiredStatuses).toEqual([9]);
  });
});

describe('resolveAuthority', () => {
  const config = makeConfig();

  it('allows the owner in a DM', () => {
    const r = resolveAuthority(
      { from: { id: OWNER_ID }, chat: { id: OWNER_ID, type: 'private' }, command: '/balance' },
      config
    );
    expect(r).toEqual({ allowed: true, reason: 'owner', alert: false });
  });

  it('allows the owner inside a group that is not allowlisted', () => {
    const r = resolveAuthority(
      { from: { id: OWNER_ID }, chat: { id: -100999, type: 'supergroup' }, command: '/reg' },
      config
    );
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe('owner');
  });

  it('allows a group chat to be checked against its registered group record', () => {
    const r = resolveAuthority(
      { from: { id: 111 }, chat: { id: ALLOWED_GROUP, type: 'supergroup' }, command: '/reg' },
      config
    );
    expect(r).toEqual({ allowed: true, reason: 'group_chat', alert: false });
  });

  it('denies a private DM from a stranger and requests an alert', () => {
    const r = resolveAuthority(
      { from: { id: 555 }, chat: { id: 555, type: 'private' }, command: '/balance' },
      config
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('dm_not_allowed');
    expect(r.alert).toBe(true);
  });

  it('does not reject a group because it is absent from the legacy allowlist', () => {
    const r = resolveAuthority(
      { from: { id: 111 }, chat: { id: -1009998887776, type: 'supergroup' }, command: '/d 500' },
      config
    );
    expect(r).toEqual({ allowed: true, reason: 'group_chat', alert: false });
  });

  it('allows group chat authorization to proceed when the legacy allowlist is empty', () => {
    const empty = makeConfig({ TELEGRAM_ALLOWED_GROUP_IDS: '' });
    const r = resolveAuthority({ from: { id: 1 }, chat: { id: -1001, type: 'supergroup' } }, empty);
    expect(r).toEqual({ allowed: true, reason: 'group_chat', alert: false });
  });

  it('still denies a private DM when the allowlist is empty', () => {
    const empty = makeConfig({ TELEGRAM_ALLOWED_GROUP_IDS: '' });
    const r = resolveAuthority({ from: { id: 555 }, chat: { id: 555, type: 'private' } }, empty);
    expect(r).toEqual({ allowed: false, reason: 'dm_not_allowed', alert: true });
  });

  it('allows a plain group chat to be checked against its registered group record', () => {
    const r = resolveAuthority({ from: { id: 1 }, chat: { id: -500, type: 'group' } }, config);
    expect(r).toEqual({ allowed: true, reason: 'group_chat', alert: false });
  });
});

describe('alert de-duplication', () => {
  beforeEach(() => resetAlertCache());

  it('allows the first alert for a key', () => {
    expect(shouldAlert('a|1|/reg', 1000)).toBe(true);
  });

  it('suppresses a repeat within the ttl', () => {
    expect(shouldAlert('a|1|/reg', 1000)).toBe(true);
    expect(shouldAlert('a|1|/reg', 1000)).toBe(false);
  });

  it('allows again once the ttl has passed', () => {
    const now = Date.now();
    expect(shouldAlert('a|1|/reg', 10, now)).toBe(true);
    expect(shouldAlert('a|1|/reg', 10, now + 50)).toBe(true);
  });

  it('keys on chat, user and command independently', () => {
    expect(shouldAlert('a|1|/reg', 1000)).toBe(true);
    expect(shouldAlert('a|2|/reg', 1000)).toBe(true);
    expect(shouldAlert('b|1|/reg', 1000)).toBe(true);
    expect(shouldAlert('a|1|/balance', 1000)).toBe(true);
  });

  it('prunes stale entries', () => {
    const now = Date.now();
    shouldAlert('x|1|/reg', 5, now);
    pruneAlertCache(5, now + 100);
    expect(shouldAlert('x|1|/reg', 1000, now + 100)).toBe(true);
  });
});

describe('denial messages', () => {
  it('tells a banned group to contact support', () => {
    expect(DENY.BANNED).toBe('This group is banned. Please contact support for further help.');
  });

  it('tells a suspended group to contact support', () => {
    expect(DENY.SUSPENDED).toBe('This group is suspended. Please contact support for further help.');
  });
});

describe('alertOwner', () => {
  const ctx = {
    from: { id: 7705978345, username: 'CCTVPay168', first_name: '白骨精' },
    chat: { id: -5434506019, type: 'group', title: '平台户' },
    command: '/d',
  };

  it('adds a button that opens a DM with the offending user id', async () => {
    const sendMessage = vi.fn().mockResolvedValue(true);

    await alertOwner(ctx, 'gateway_error: No available payment channel account', { ownerId: 123 }, { sendMessage });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, options] = sendMessage.mock.calls[0];
    expect(chatId).toBe(123);
    expect(text).toContain('Unauthorized bot access');
    expect(options.parse_mode).toBe('HTML');
    expect(options.reply_markup.inline_keyboard.flat()).toEqual([
      { text: '💬 Message user', url: 'tg://user?id=7705978345' },
    ]);
  });

  it('adds an Open group button for a supergroup id', async () => {
    const sendMessage = vi.fn().mockResolvedValue(true);
    const supergroup = {
      ...ctx,
      chat: { id: -1001234567890, type: 'supergroup', title: '平台户' },
    };

    await alertOwner(supergroup, 'gateway_error', { ownerId: 123 }, { sendMessage });

    const options = sendMessage.mock.calls[0][2];
    expect(options.reply_markup.inline_keyboard.flat()).toEqual([
      { text: '💬 Message user', url: 'tg://user?id=7705978345' },
      { text: '👥 Open group', url: 'https://t.me/c/1234567890' },
    ]);
  });

  it('adds an Open group button from the public username when present', async () => {
    const sendMessage = vi.fn().mockResolvedValue(true);
    const publicGroup = {
      ...ctx,
      chat: { id: -1001234567890, type: 'supergroup', title: 'Platform', username: 'platformhub' },
    };

    await alertOwner(publicGroup, 'gateway_error', { ownerId: 123 }, { sendMessage });

    const options = sendMessage.mock.calls[0][2];
    expect(options.reply_markup.inline_keyboard.flat()).toContainEqual({
      text: '👥 Open group',
      url: 'https://t.me/platformhub',
    });
  });

  it('has no group link for a basic group (not a -100 id)', () => {
    expect(chatDeepLink({ id: -5434506019, type: 'group' })).toBeNull();
  });

  it('omits the button when the sender id is missing', async () => {
    const sendMessage = vi.fn().mockResolvedValue(true);

    await alertOwner({ ...ctx, from: {} }, 'dm_not_allowed', { ownerId: 123 }, { sendMessage });

    const options = sendMessage.mock.calls[0][2];
    expect(options.reply_markup).toBeUndefined();
  });

  it('does nothing without a client or owner id', async () => {
    const sendMessage = vi.fn();
    expect(await alertOwner(ctx, 'dm_not_allowed', { ownerId: 123 }, null)).toBe(false);
    expect(await alertOwner(ctx, 'dm_not_allowed', {}, { sendMessage })).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
