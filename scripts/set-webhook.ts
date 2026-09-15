import dotenv from 'dotenv';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const webhookUrl = process.argv[2];
const secretToken = process.env.TELEGRAM_SECRET_TOKEN;

if (!token) {
  console.error('❌ Error: TELEGRAM_BOT_TOKEN is not set in .env');
  process.exit(1);
}

async function manageWebhook() {
  if (!webhookUrl) {
    // If no URL provided, fetch current webhook info
    console.log('🔍 Checking current webhook status...');
    const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const data = await res.json();
    console.log('Telegram response:', JSON.stringify(data, null, 2));
    console.log('\n💡 To set a new webhook, run:');
    console.log('   npm run set-webhook -- https://your-domain.vercel.app/api/webhook');
    return;
  }

  console.log(`🌐 Setting Telegram Webhook to: ${webhookUrl}`);
  const payload: Record<string, any> = { url: webhookUrl };
  if (secretToken) {
    payload.secret_token = secretToken;
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  console.log('Telegram response:', JSON.stringify(data, null, 2));
}

manageWebhook().catch(console.error);
