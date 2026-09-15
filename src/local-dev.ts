import http from 'http';
import dotenv from 'dotenv';
import handler from '../api/webhook.js';

// Load environment variables from .env
dotenv.config();

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';

  // Health check endpoint
  if (req.method === 'GET' && (url === '/' || url === '/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'telegram-money-bot' }));
    return;
  }

  // Webhook endpoints
  if (req.method === 'POST' && (url === '/api/webhook' || url === '/webhook')) {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', async () => {
      let parsedBody: any;
      try {
        parsedBody = JSON.parse(body);
      } catch {
        parsedBody = body;
      }

      // Mock Vercel request & response wrappers
      const vercelReq = {
        method: req.method,
        headers: req.headers,
        body: parsedBody,
      };

      const vercelRes = {
        status(statusCode: number) {
          res.statusCode = statusCode;
          return this;
        },
        json(data: any) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(data));
        },
        send(data: any) {
          res.end(data);
        },
      };

      try {
        await handler(vercelReq, vercelRes);
      } catch (err) {
        console.error('[Dev Server] Unhandled handler error:', err);
        if (!res.writableEnded) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      }
    });

    return;
  }

  // 404 for other endpoints
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(PORT, () => {
  console.log(`\n=============================================`);
  console.log(`🚀 Local dev server running on port ${PORT}`);
  console.log(`👉 Webhook endpoint: http://localhost:${PORT}/api/webhook`);
  console.log(`👉 Health check:     http://localhost:${PORT}/health`);
  console.log(`=============================================\n`);

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.warn(`⚠️  WARNING: TELEGRAM_BOT_TOKEN is missing in .env!`);
  }
  if (!process.env.GEMINI_API_KEY) {
    console.warn(`⚠️  WARNING: GEMINI_API_KEY is missing in .env!`);
  }
  if (!process.env.GOOGLE_SHEET_ID) {
    console.warn(`⚠️  WARNING: GOOGLE_SHEET_ID is missing in .env!`);
  }
  if (!process.env.AUTHORIZED_USER_IDS && !process.env.AUTHORIZED_USER_ID) {
    console.warn(`⚠️  WARNING: AUTHORIZED_USER_IDS (or AUTHORIZED_USER_ID) is missing in .env!`);
  }
});
