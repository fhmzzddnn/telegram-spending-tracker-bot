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
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 1. Validate HTTP Method
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  // 2. Optional: Verify Telegram Webhook Secret Token
  const secretToken = process.env.TELEGRAM_SECRET_TOKEN;
  if (secretToken) {
    const receivedHeader = req.headers['x-telegram-bot-api-secret-token'];
    if (receivedHeader !== secretToken) {
      console.warn('[Security] Invalid or missing Telegram secret token header');
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
  }

  // 3. Parse Body
  let update: TelegramUpdate;
  try {
    update = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (err) {
    console.error('[Webhook] Failed to parse request body:', err);
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  const message = update?.message || update?.edited_message;
  if (!message || !message.text) {
    // Acknowledge non-text messages (photos, stickers, bot join events) with 200 OK
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
    console.warn(`[Security] Unauthorized access attempt from user ID: ${senderId} (@${message.from?.username || 'unknown'})`);
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

    console.log(`[Webhook] Processing message from ${spenderName} (${senderId}): "${message.text}"`);

    // Parse intent via Gemini 3.5 Flash-Lite
    const intent = await parseUserIntent(message.text);
    console.log('[Webhook] Parsed intent:', JSON.stringify(intent));

    // Execute skill with spender name
    const { reply: replyText, notification } = await executeSkill(intent, message.text, spenderName);

    // Send confirmation back to Telegram
    await sendTelegramMessage(chatId, replyText);

    // Fan out notification to other authorized users (fire-and-forget)
    if (notification && senderId !== undefined) {
      notifyOtherAuthorizedUsers(notification, senderId).catch(() => {});
    }

    res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('[Webhook] Processing error:', err);
    await sendTelegramMessage(
      chatId,
      '❌ Terjadi kesalahan saat memproses permintaan Anda. Silakan coba beberapa saat lagi.'
    );
    res.status(200).json({ ok: false, error: err?.message || 'Internal error' });
  }
}
