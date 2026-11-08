const { escapeHtml } = require('../format');

/**
 * The /id reply: this group's Telegram id and public uid, each with a
 * one-tap copy button. Values are also rendered as <code> so tapping the
 * text copies it on clients that support that.
 */
function buildIdReply(group = {}) {
  const groupId = group.groupId == null || group.groupId === '' ? '-' : String(group.groupId);
  const uid = group.uid == null || group.uid === '' ? '-' : String(group.uid);

  const lines = [
    `Group ID: <code>${escapeHtml(groupId)}</code>`,
    `UID: <code>${escapeHtml(uid)}</code>`,
  ];

  const buttons = [];
  if (group.groupId != null && group.groupId !== '') {
    buttons.push({ text: 'Copy Group ID', copy_text: { text: groupId } });
  }
  if (group.uid != null && group.uid !== '') {
    buttons.push({ text: 'Copy UID', copy_text: { text: uid } });
  }

  const options = { parse_mode: 'HTML' };
  if (buttons.length) {
    options.reply_markup = { inline_keyboard: [buttons] };
  }

  return { text: lines.join('\n'), options };
}

async function cmdId(ctx) {
  return buildIdReply(ctx.group || {});
}

module.exports = { cmdId, buildIdReply };
