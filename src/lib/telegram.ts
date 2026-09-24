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

/**
 * Parses the comma-separated authorized user IDs from env.
 */
export function getAuthorizedUserIds(): string[] {
  const raw = process.env.AUTHORIZED_USER_IDS || process.env.AUTHORIZED_USER_ID || '';
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

/**
 * Broadcasts a message to all authorized users except the sender.
 * Never throws — notification failures only log.
 */
export async function notifyOtherAuthorizedUsers(
  text: string,
  excludeUserId?: number | string
): Promise<void> {
  const all = getAuthorizedUserIds();
  const exclude = excludeUserId !== undefined ? String(excludeUserId) : undefined;
  const targets = all.filter((id) => id !== exclude);

  if (all.length === 0) {
    console.warn(
      '[Telegram] notify skipped: AUTHORIZED_USER_IDS / AUTHORIZED_USER_ID is empty — no recipients'
    );
    return;
  }
  if (targets.length === 0) {
    console.log(
      `[Telegram] notify skipped: no other authorized users (all=${all.length}, exclude=${exclude})`
    );
    return;
  }

  console.log(
    `[Telegram] notifying ${targets.length} user(s), exclude=${exclude}: ${targets.join(', ')}`
  );

  const results = await Promise.allSettled(
    targets.map((id) => sendTelegramMessage(id, text))
  );
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const target = targets[i];
    if (r.status === 'rejected') {
      console.error(`[Telegram] Notification send error to ${target}:`, r.reason);
    } else if (r.value === false) {
      console.error(
        `[Telegram] Notification send FAILED to ${target} (see sendMessage logs above — often "chat not found" if that user has never /start'd the bot)`
      );
    } else {
      console.log(`[Telegram] Notification sent to ${target}`);
    }
  }
}
