# 💸 Telegram Expense Tracker Bot

A serverless Telegram bot that uses **Google Gemini 1.5 Flash** as an intelligent intent router and logs financial transactions directly to **Google Sheets** using the official Google Sheets API.

Deployed for free on **Vercel**.

---

## 🏗️ Architecture

1. **Telegram Webhook**: User sends a natural language message (e.g. *"Spent $14.50 on lunch"*).
2. **Vercel Serverless Function** (`api/webhook.ts`): Receives the webhook, verifies the sender's Telegram User ID for security.
3. **Gemini 1.5 Flash**: Classifies the message into a typed action (`ADD_EXPENSE`, `GET_SUMMARY`, `DELETE_LAST_EXPENSE`, `HELP`) and extracts amounts, categories, and descriptions into structured JSON.
4. **Skills Dispatcher**: Executes the corresponding action against Google Sheets via a Google Cloud Service Account.
5. **Confirmation**: Sends a clean formatted summary back to the user on Telegram.

---

## 🔑 Prerequisites & Credentials Setup

### 1. Telegram Bot Token & Authorized User IDs
1. Open Telegram and search for [@BotFather](https://t.me/botfather).
2. Send `/newbot` and follow the prompts to get your `TELEGRAM_BOT_TOKEN`.
3. Search for [@userinfobot](https://t.me/userinfobot) and send `/start` to obtain your numerical `Id`. You can add multiple authorized users separated by commas (`AUTHORIZED_USER_IDS="123456789,987654321"`).

### 2. Google Gemini API Key
1. Go to [Google AI Studio](https://aistudio.google.com/).
2. Click **Get API key** and create a free key.
3. Copy the key to `GEMINI_API_KEY`.

### 3. Google Sheets & Service Account
1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project and enable the **Google Sheets API**.
3. Go to **IAM & Admin > Service Accounts** and click **Create Service Account**.
4. Once created, click on the service account > **Keys** tab > **Add Key** > **Create new key (JSON)**.
5. Download the JSON key file.
6. Create a new Google Spreadsheet at [sheets.new](https://sheets.new).
7. Copy the spreadsheet ID from the URL (`https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`).
8. **IMPORTANT:** Click **Share** on your Google Sheet and invite your service account email (`xxx@xxx.iam.gserviceaccount.com`) as **Editor**.

---

## ⚙️ Environment Configuration

Create a `.env` file from the template:

```bash
cp .env.example .env
```

Fill in the credentials in `.env`:
```env
TELEGRAM_BOT_TOKEN="your_bot_token"
AUTHORIZED_USER_IDS="your_telegram_user_id,partner_telegram_user_id"
GEMINI_API_KEY="your_gemini_key"
GOOGLE_SHEET_ID="your_google_sheet_id"
GOOGLE_SERVICE_ACCOUNT_EMAIL="your-service-account@project.iam.gserviceaccount.com"
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

---

## 💻 Local Development

### 1. Run the Local Server
```bash
npm install
npm run dev
```
The server will start on `http://localhost:3000`.

### 2. Expose via Cloudflare Tunnel
In a second terminal:
```bash
cloudflared tunnel --url http://localhost:3000
```
Copy the generated `https://<random-id>.trycloudflare.com` URL.

### 3. Register the Webhook
Register your tunnel URL with Telegram:
```bash
npm run set-webhook -- https://<random-id>.trycloudflare.com/api/webhook
```

### 4. Test Intent Router Offline
You can test how Gemini interprets various spending phrases without sending live Telegram messages:
```bash
npm run test:router
```

---

## 🚀 Deploying to Vercel

1. Push your code to GitHub (or use the Vercel CLI with `npx vercel`).
2. Import the repository in [Vercel](https://vercel.com/).
3. Add all the environment variables from your `.env` to the Vercel Project Settings (**Settings > Environment Variables**).
   - *Note on `GOOGLE_PRIVATE_KEY`:* Ensure you paste the full private key including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` headers.
4. Deploy the project.
5. Register your production Vercel webhook with Telegram:
```bash
npm run set-webhook -- https://your-project.vercel.app/api/webhook
```

---

## 💬 Natural Language Examples

You can chat with your bot just like a human assistant:

* **Adding Expenses:**
  * *"Spent $14.50 on lunch at chipotle"*
  * *"Bought groceries 45.20 yesterday"*
  * *"Uber ride 22"*
  * *"Paid electricity bill 120"*
* **Checking Spending:**
  * *"How much did I spend this week?"*
  * *"Show spending for today"*
  * *"Summary for this month"*
* **Undoing Mistakes:**
  * *"Undo last expense"*
  * *"Delete last entry"*
