import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { z } from 'zod';
import { ParsedIntent } from '../types/index.js';

const AddExpenseSchema = z.object({
  action: z.literal('ADD_EXPENSE'),
  amount: z.number().positive(),
  category: z.string().min(1),
  description: z.string().min(1),
  date: z.string().optional(),
});

const GetSummarySchema = z.object({
  action: z.literal('GET_SUMMARY'),
  period: z.enum(['today', 'this_week', 'this_month', 'all']),
  targetSpender: z.string().optional(),
});

const DeleteLastExpenseSchema = z.object({
  action: z.literal('DELETE_LAST_EXPENSE'),
});

const EditLastExpenseSchema = z.object({
  action: z.literal('EDIT_LAST_EXPENSE'),
  newAmount: z.number().positive().optional(),
  newCategory: z.string().min(1).optional(),
  newDescription: z.string().min(1).optional(),
});

const HelpSchema = z.object({
  action: z.literal('HELP'),
});

const UnknownSchema = z.object({
  action: z.literal('UNKNOWN'),
  message: z.string(),
});

const IntentSchema = z.discriminatedUnion('action', [
  AddExpenseSchema,
  GetSummarySchema,
  DeleteLastExpenseSchema,
  EditLastExpenseSchema,
  HelpSchema,
  UnknownSchema,
]);

let genAIClient: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!genAIClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('[Gemini] Missing GEMINI_API_KEY environment variable');
    }
    genAIClient = new GoogleGenerativeAI(apiKey);
  }
  return genAIClient;
}

const SYSTEM_INSTRUCTION = `Anda adalah asisten perute niat keuangan untuk bot Telegram pencatat pengeluaran pribadi (pembukuan).
Analisis input bahasa alami dari pengguna (bahasa Indonesia atau Inggris) dan petakan ke tepat SATU skill action:

1. "ADD_EXPENSE": Ketika pengguna mencatat pengeluaran atau transaksi pembelian.
   - Ekstrak "amount" sebagai angka numerik positif murni. Pahami konvensi penyebutan uang di Indonesia:
     * "15k", "15rb", "15 ribu", "15.000" -> 15000
     * "50rb", "50k", "50 ribu", "50.000" -> 50000
     * "1.5jt", "1,5jt", "1.5 juta", "1,5 juta" -> 1500000
     * "25000", "25.000" -> 25000
   - Ekstrak "category" ke dalam kategori standar bahasa Indonesia (contoh: "Makanan & Minuman", "Transportasi", "Belanja", "Tagihan", "Hiburan", "Kesehatan", "Pendidikan", "Kebutuhan", "Lainnya").
   - Ekstrak "description" berupa ringkasan barang/layanan/keperluan yang dibeli.
   - Ekstrak "date" (format YYYY-MM-DD) jika pengguna menyebutkan waktu tertentu (contoh: "kemarin", "hari senin", "tadi pagi").

2. "GET_SUMMARY": Ketika pengguna meminta ringkasan, rekap, atau total pengeluaran.
   - Contoh input:
     * "pengeluaran hari ini" -> period: "today"
     * "rekap minggu ini" -> period: "this_week"
     * "pengeluaran Sarah minggu ini" -> period: "this_week", targetSpender: "Sarah"
     * "cek pengeluaran Fahmi bulan ini" -> period: "this_month", targetSpender: "Fahmi"
     * "total semua pengeluaran" -> period: "all", targetSpender: "all"
     * "rekap gabungan minggu ini" -> period: "this_week", targetSpender: "all"
   - Ekstrak "period": "today" (hari ini), "this_week" (minggu ini), "this_month" (bulan ini), atau "all" (semua). Default ke "this_month" jika tidak disebutkan.
   - Ekstrak "targetSpender": jika pengguna secara spesifik menyebutkan nama seseorang (contoh: "Sarah", "Fahmi") atau kata "semua" / "gabungan". Jika pengguna hanya bertanya secara umum ("habis berapa hari ini"), kosongkan targetSpender.

3. "DELETE_LAST_EXPENSE": Ketika pengguna ingin membatalkan, menghapus, atau undo transaksi terakhir miliknya sendiri (contoh: "hapus transaksi terakhir", "undo", "batalin yang tadi", "delete last").

4. "EDIT_LAST_EXPENSE": Ketika pengguna ingin mengoreksi, merevisi, atau mengedit data pengeluaran terakhir miliknya yang baru saja dicatat.
   - Contoh input:
     * "eh salah harganya 20rb bukan 15rb" -> action: EDIT_LAST_EXPENSE, newAmount: 20000
     * "koreksi tadi jadi 35k" -> action: EDIT_LAST_EXPENSE, newAmount: 35000
     * "ganti kategori transaksi tadi jadi Transportasi" -> action: EDIT_LAST_EXPENSE, newCategory: "Transportasi"
     * "ubah catatannya jadi nasi uduk" -> action: EDIT_LAST_EXPENSE, newDescription: "nasi uduk"
     * "yang tadi buat bayar bensin 50rb" -> action: EDIT_LAST_EXPENSE, newAmount: 50000, newDescription: "bayar bensin", newCategory: "Transportasi"
   - Ekstrak "newAmount" (number positif), "newCategory" (string), dan/atau "newDescription" (string) sesuai apa yang ingin diperbarui.

5. "HELP": Ketika pengguna menanyakan cara pakai, bantuan, atau perintah "/help" / "/start".

6. "UNKNOWN": Jika input tidak berkaitan dengan pencatatan keuangan atau tidak dapat dimengerti.
   - Berikan "message" dalam bahasa Indonesia yang ramah dan membantu.

Konteks tanggal hari ini: ${new Date().toISOString().split('T')[0]}.
Kembalikan strictly structured JSON sesuai responseSchema.`;

export async function parseUserIntent(text: string): Promise<ParsedIntent> {
  const ai = getClient();
  const modelName = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const model = ai.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_INSTRUCTION,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          action: {
            type: SchemaType.STRING,
            format: 'enum',
            enum: ['ADD_EXPENSE', 'GET_SUMMARY', 'DELETE_LAST_EXPENSE', 'EDIT_LAST_EXPENSE', 'HELP', 'UNKNOWN'],
          },
          amount: { type: SchemaType.NUMBER },
          category: { type: SchemaType.STRING },
          description: { type: SchemaType.STRING },
          date: { type: SchemaType.STRING },
          period: {
            type: SchemaType.STRING,
            format: 'enum',
            enum: ['today', 'this_week', 'this_month', 'all'],
          },
          targetSpender: { type: SchemaType.STRING },
          newAmount: { type: SchemaType.NUMBER },
          newCategory: { type: SchemaType.STRING },
          newDescription: { type: SchemaType.STRING },
          message: { type: SchemaType.STRING },
        },
        required: ['action'],
      },
    },
  });

  try {
    const result = await model.generateContent(text);
    const rawJson = result.response.text();
    const parsed = JSON.parse(rawJson);

    // Validate with Zod
    const validated = IntentSchema.safeParse(parsed);
    if (!validated.success) {
      console.warn('[Gemini] Schema validation failed:', validated.error.format());
      return {
        action: 'UNKNOWN',
        message: 'Could not understand the transaction details. Please specify an amount and item, e.g., "spent $10 on lunch".',
      };
    }

    return validated.data;
  } catch (error) {
    console.error('[Gemini] Error calling Gemini API:', error);
    return {
      action: 'UNKNOWN',
      message: 'Sorry, I encountered an error analyzing your request. Please try again.',
    };
  }
}
