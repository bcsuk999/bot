import { describe, expect, it, vi } from 'vitest';
import {
  PROCESSING_TEXT,
  sendProcessingMessage,
  sendProcessingReply,
} from '../services/bot/reply.js';

describe('bot processing replies', () => {
  it('sends a processing message before editing it with the final reply', async () => {
    const processingMessage = { message_id: 42 };
    const client = {
      sendMessage: vi.fn().mockResolvedValue(processingMessage),
      editMessageText: vi.fn().mockResolvedValue(true),
    };

    const message = await sendProcessingMessage(client, -100123);
    await sendProcessingReply(client, -100123, message, 'Order created', {
      reply_markup: { inline_keyboard: [[{ text: 'Pay now', url: 'https://example.test/pay' }]] },
    });

    expect(client.sendMessage).toHaveBeenCalledWith(-100123, PROCESSING_TEXT);
    expect(client.editMessageText).toHaveBeenCalledWith('Order created', {
      chat_id: -100123,
      message_id: 42,
      reply_markup: { inline_keyboard: [[{ text: 'Pay now', url: 'https://example.test/pay' }]] },
    });
  });

  it('sends the final reply normally when the processing message could not be sent', async () => {
    const client = {
      sendMessage: vi.fn()
        .mockRejectedValueOnce(new Error('temporary Telegram error'))
        .mockResolvedValueOnce(true),
      editMessageText: vi.fn(),
    };

    const message = await sendProcessingMessage(client, -100123);
    await sendProcessingReply(client, -100123, message, 'Command result');

    expect(message).toBeNull();
    expect(client.editMessageText).not.toHaveBeenCalled();
    expect(client.sendMessage).toHaveBeenLastCalledWith(-100123, 'Command result', {});
  });

  it('sends a new final reply if Telegram cannot edit the processing message', async () => {
    const client = {
      sendMessage: vi.fn().mockResolvedValue(true),
      editMessageText: vi.fn().mockRejectedValue(new Error('edit rejected')),
    };

    await sendProcessingReply(client, -100123, { message_id: 42 }, 'Command result');

    expect(client.editMessageText).toHaveBeenCalledWith('Command result', {
      chat_id: -100123,
      message_id: 42,
    });
    expect(client.sendMessage).toHaveBeenCalledWith(-100123, 'Command result', {});
  });
});
