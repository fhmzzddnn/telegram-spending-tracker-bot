import dotenv from 'dotenv';
import { parseUserIntent } from '../src/lib/gemini.js';

dotenv.config();

const testPhrases = [
  'beli nasi goreng 15rb di depan gang',
  'kopi kenangan 28k',
  'isi bensin motor 50rb',
  'bayar tagihan listrik 150 ribu kemarin',
  'belanja bulanan 1.5jt di superindo',
  'habis berapa hari ini?',
  'rekap pengeluaran minggu ini',
  'batalin yang tadi',
  'hapus transaksi terakhir',
  'bisa ngapain aja?',
];

async function runTests() {
  console.log('🧪 Testing Gemini Intent Router\n');

  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY is not set in .env');
    process.exit(1);
  }

  for (const phrase of testPhrases) {
    console.log(`💬 Input: "${phrase}"`);
    try {
      const intent = await parseUserIntent(phrase);
      console.log(`🎯 Parsed Intent:`, JSON.stringify(intent, null, 2));
    } catch (err) {
      console.error('❌ Error parsing:', err);
    }
    console.log('----------------------------------------');
  }
}

runTests();
