import { parseUserIntent } from '../src/lib/gemini.js';
import { executeSkill } from '../src/skills/index.js';
import { sendTelegramMessage, sendTelegramTyping, notifyOtherAuthorizedUsers } from '../src/lib/telegram.js';
import { TelegramUpdate } from '../src/types/index.js';

interface VercelRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: any;
}

interface VercelResponse {
  status: (code: number) => VercelResponse;
  json: (body: any) => void;
  send: (body: any) => void;
  on?: (event: string, listener: () => void) => void;
}

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function log(level: 'log' | 'warn' | 'error', message: string, extra?: unknown): void {
  const line = `[Webhook] ${new Date().toISOString()} ${message}`;
  if (level === 'error') {
    extra !== undefined ? console.error(line, extra) : console.error(line);
  } else if (level === 'warn') {
    extra !== undefined ? console.warn(line, extra) : console.warn(line);
  } else {
    extra !== undefined ? console.log(line, extra) : console.log(line);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startedAt = Date.now();
  const requestId = headerValue(req.headers['x-vercel-id']) || headerValue(req.headers['x-request-id']) || 'local';
  const method = req.method || 'UNKNOWN';
  const secretConfigured = Boolean(process.env.TELEGRAM_SECRET_TOKEN);
  const envSnapshot = {
    method,
    requestId,
    secretConfigured,
    authorizedUsersConfigured: Boolean(
      process.env.AUTHORIZED_USER_IDS || process.env.AUTHORIZED_USER_ID
    ),
    geminiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
    geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite (default)',
    sheetIdConfigured: Boolean(process.env.GOOGLE_SHEET_ID),
    functionMs: Date.now() - startedAt,
  };

  // Entry log — fires on every request so Runtime Logs are never empty
  log('log', `ENTER ${method} secretConfigured=${secretConfigured}`, envSnapshot);

  res.on?.('finish', () => {
    log('log', `EXIT ${method} durationMs=${Date.now() - startedAt} requestId=${requestId}`);
  });

  // 1. Validate HTTP Method
  if (method !== 'POST') {
    log('warn', `Rejected non-POST method=${method}`);
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  // 2. Optional: Verify Telegram Webhook Secret Token
  const secretToken = process.env.TELEGRAM_SECRET_TOKEN;
  if (secretToken) {
    const receivedHeader = headerValue(req.headers['x-telegram-bot-api-secret-token']);
    if (receivedHeader !== secretToken) {
      log('warn', `Secret token mismatch (got length=${receivedHeader.length}, configured=true)`);
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    log('log', 'Secret token OK');
  } else {
    log('log', 'Secret token check skipped (TELEGRAM_SECRET_TOKEN not set)');
  }

  // 3. Parse Body
  let update: TelegramUpdate;
  try {
    update = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (err) {
    log('error', 'Failed to parse request body', err);
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  const message = update?.message || update?.edited_message;
  if (!message || !message.text) {
    log('log', `Acknowledged non-text update update_id=${update?.update_id ?? 'n/a'}`);
    res.status(200).json({ ok: true, note: 'No text to process' });
    return;
  }

  const chatId = message.chat.id;
  const senderId = message.from?.id;

  // 4. Zero-Trust Security: Verify Sender Authorization
  const rawAuthorizedIds = process.env.AUTHORIZED_USER_IDS || process.env.AUTHORIZED_USER_ID || '';
  const authorizedIds = rawAuthorizedIds
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  if (authorizedIds.length > 0 && (!senderId || !authorizedIds.includes(String(senderId)))) {
    log('warn', `Unauthorized sender user_id=${senderId} username=@${message.from?.username || 'unknown'}`);
    await sendTelegramMessage(chatId, '⛔ Akses Ditolak: Anda tidak terdaftar sebagai pengguna yang diizinkan.');
    res.status(200).json({ ok: true, status: 'unauthorized_ignored' });
    return;
  }

  // 5. Acknowledge and process
  try {
    // Show typing status in Telegram while LLM and Google Sheets work
    sendTelegramTyping(chatId).catch(() => {});

    const spenderName = [message.from?.first_name, message.from?.last_name]
      .filter(Boolean)
      .join(' ') || (message.from?.username ? `@${message.from.username}` : `User ${senderId}`);

    log('log', `Processing from ${spenderName} (${senderId}): "${message.text}"`);

    // Slash commands skip the LLM — /start and /help reply with HELP directly
    const slashCommand = message.text.trim().split(/\s+/)[0].split('@')[0].toLowerCase();
    let intent;
    if (slashCommand === '/start' || slashCommand === '/help') {
      log('log', `Shortcut ${slashCommand} → HELP (no LLM call)`);
      intent = { action: 'HELP' as const };
    } else {
      const intentStartedAt = Date.now();
      intent = await parseUserIntent(message.text);
      log('log', `Parsed intent in ${Date.now() - intentStartedAt}ms:`, intent);
    }

    const skillStartedAt = Date.now();
    const { reply: replyText, notification } = await executeSkill(intent, message.text, spenderName);
    log('log', `Skill completed in ${Date.now() - skillStartedAt}ms notification=${Boolean(notification)}`);

    await sendTelegramMessage(chatId, replyText);

    if (notification && senderId !== undefined) {
      try {
        await notifyOtherAuthorizedUsers(notification, senderId);
      } catch (err) {
        log('error', 'Notification fan-out error', err);
      }
    }

    res.status(200).json({ ok: true });
  } catch (err: any) {
    log('error', `Processing error after ${Date.now() - startedAt}ms`, err);
    await sendTelegramMessage(
      chatId,
      '❌ Terjadi kesalahan saat memproses permintaan Anda. Silakan coba beberapa saat lagi.'
    );
    res.status(200).json({ ok: false, error: err?.message || 'Internal error' });
  }
}
