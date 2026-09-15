import dotenv from 'dotenv';
import { parseUserIntent } from '../src/lib/gemini.js';

dotenv.config();

const testPhrases = [
  'beli nasi goreng 15rb di depan gang',
  'eh salah harganya 20rb bukan 15rb',
  'ganti kategori jadi Transportasi',
  'ubah catatannya jadi nasi uduk komplit',
  'habis berapa hari ini?',
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
