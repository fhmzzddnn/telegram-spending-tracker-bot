/**
 * Telegram Bot API client wrapper
 */

export interface SendMessageOptions {
  parse_mode?: 'MarkdownV2' | 'HTML' | 'Markdown';
  reply_to_message_id?: number;
}

export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  options?: SendMessageOptions
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('[Telegram] TELEGRAM_BOT_TOKEN is not configured');
    return false;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const payload = {
      chat_id: chatId,
      text,
      ...options,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = (await response.json()) as { ok: boolean; description?: string };

    if (!data.ok) {
      console.error(`[Telegram] Send failed: ${data.description || 'Unknown error'}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error('[Telegram] Network error sending message:', err);
    return false;
  }
}

/**
 * Sends a "typing..." chat action to let the user know the bot is processing
 */
export async function sendTelegramTyping(chatId: number | string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        action: 'typing',
      }),
    });
  } catch (err) {
    console.warn('[Telegram] Failed to send typing indicator:', err);
  }
}
