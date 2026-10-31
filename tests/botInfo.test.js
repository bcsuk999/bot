import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdInfo, getInfoMessage, broadcastInfo } from '../services/bot/handlers/info.js';

describe('/info broadcast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts the full message, including spaces and newlines', () => {
    expect(getInfoMessage('/info Hello @all\nService resumes at 5 PM')).toBe(
      'Hello @all\nService resumes at 5 PM'
    );
    expect(getInfoMessage('/info@my_bot Hello')).toBe('Hello');
    expect(getInfoMessage('/info')).toBe('');
  });

  it('sends the owner message to each active group and reports the count', async () => {
    const client = { sendMessage: vi.fn().mockResolvedValue(true) };

    const result = await cmdInfo({ messageText: '/info Maintenance at midnight', client }, ['-1001', '-1002']);

    expect(client.sendMessage).toHaveBeenNthCalledWith(1, '-1001', 'Maintenance at midnight');
    expect(client.sendMessage).toHaveBeenNthCalledWith(2, '-1002', 'Maintenance at midnight');
    expect(result.text).toBe('Info broadcast sent to 2 active group(s).');
  });

  it('continues delivery after an individual group send fails', async () => {
    const client = {
      sendMessage: vi.fn()
        .mockRejectedValueOnce(new Error('blocked'))
        .mockResolvedValueOnce(true),
    };

    const result = await broadcastInfo(client, ['-1001', '-1002'], 'Notice');

    expect(client.sendMessage).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ sent: 1, failed: 1 });
  });

  it('reports individual delivery failures to the owner', async () => {
    const client = {
      sendMessage: vi.fn()
        .mockRejectedValueOnce(new Error('blocked'))
        .mockResolvedValueOnce(true),
    };

    const result = await cmdInfo({ messageText: '/info Notice', client }, ['-1001', '-1002']);

    expect(result.text).toBe('Info broadcast complete. Sent to 1 active group(s); failed for 1.');
  });

  it('validates missing and overlong messages without querying groups', async () => {
    const client = { sendMessage: vi.fn() };

    expect((await cmdInfo({ messageText: '/info', client })).text).toBe('Usage: /info <message>');
    expect((await cmdInfo({ messageText: `/info ${'x'.repeat(4097)}`, client })).text)
      .toContain('Maximum length is 4096');
  });

  it('handles the absence of active registered groups', async () => {
    const result = await cmdInfo({ messageText: '/info Notice', client: { sendMessage: vi.fn() } }, []);

    expect(result.text).toBe('There are no active registered groups to notify.');
  });
});
