const logger = require('../../utils/logger');

const PROCESSING_TEXT = 'Request processing...';

async function sendProcessingMessage(client, chatId) {
  try {
    return await client.sendMessage(chatId, PROCESSING_TEXT);
  } catch (err) {
    logger.error({ err, chatId }, 'bot: failed to send processing message');
    return null;
  }
}

async function sendProcessingReply(client, chatId, processingMessage, text, options = {}) {
  if (processingMessage?.message_id != null) {
    try {
      return await client.editMessageText(text, {
        chat_id: chatId,
        message_id: processingMessage.message_id,
        ...options,
      });
    } catch (err) {
      logger.error(
        { err, chatId, messageId: processingMessage.message_id },
        'bot: failed to edit processing message'
      );
    }
  }

  return client.sendMessage(chatId, text, options);
}

module.exports = { PROCESSING_TEXT, sendProcessingMessage, sendProcessingReply };
