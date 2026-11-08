import { describe, expect, it } from 'vitest';
import { buildIdReply, cmdId } from '../services/bot/handlers/id.js';

describe('buildIdReply', () => {
  const group = { groupId: '-1001234567890', uid: '32045' };

  it('shows the group id and uid', () => {
    const { text } = buildIdReply(group);
    expect(text).toContain('Group ID: <code>-1001234567890</code>');
    expect(text).toContain('UID: <code>32045</code>');
  });

  it('adds a copy button for both values', () => {
    const { options } = buildIdReply(group);
    expect(options.parse_mode).toBe('HTML');
    expect(options.reply_markup.inline_keyboard.flat()).toEqual([
      { text: '📋 Copy Group ID', copy_text: { text: '-1001234567890' } },
      { text: '📋 Copy UID', copy_text: { text: '32045' } },
    ]);
  });

  it('omits the uid button when the group has no uid', () => {
    const { text, options } = buildIdReply({ groupId: '-1001234567890' });
    expect(text).toContain('UID: <code>-</code>');
    expect(options.reply_markup.inline_keyboard.flat()).toEqual([
      { text: '📋 Copy Group ID', copy_text: { text: '-1001234567890' } },
    ]);
  });

  it('escapes HTML in the rendered values', () => {
    const { text } = buildIdReply({ groupId: '<bad>', uid: '32045' });
    expect(text).toContain('&lt;bad&gt;');
  });

  it('reads the group from the command context', async () => {
    const result = await cmdId({ group });
    expect(result.text).toContain('UID: <code>32045</code>');
  });
});
