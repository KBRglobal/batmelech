'use strict';

// Plain HTTPS POST to the Telegram Bot API — no SDK, matching the
// convention already documented for this bot (see STATE.md / creds).

async function sendTelegramMessage({ botToken, chatId, text, logger = console }) {
  if (typeof botToken !== 'string' || !botToken.trim()) {
    logger.error('sendTelegramMessage: missing bot token');
    return false;
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!response.ok) {
      logger.error('sendTelegramMessage: non-ok response', response.status, await response.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (error) {
    logger.error('sendTelegramMessage failed', error);
    return false;
  }
}

module.exports = { sendTelegramMessage };
