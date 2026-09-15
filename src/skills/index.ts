import { ParsedIntent } from '../types/index.js';
import {
  appendExpenseRecord,
  getExpensesSummary,
  deleteLastExpenseRecord,
} from '../lib/sheets.js';

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

export async function executeSkill(
  intent: ParsedIntent,
  rawText: string,
  spender = 'User'
): Promise<string> {
  switch (intent.action) {
    case 'ADD_EXPENSE': {
      const date = intent.date ? `${intent.date} 12:00:00` : formatDate();
      await appendExpenseRecord({
        date,
        spender,
        category: intent.category,
        amount: intent.amount,
        description: intent.description,
        rawText,
      });

      return (
        `✅ Pengeluaran Berhasil Dicatat\n\n` +
        `👤 Pengeluar: ${spender}\n` +
        `💵 Jumlah: ${formatCurrency(intent.amount)}\n` +
        `📂 Kategori: ${intent.category}\n` +
        `📝 Catatan: ${intent.description}\n` +
        `📅 Tanggal: ${date.split(' ')[0]}`
      );
    }

    case 'GET_SUMMARY': {
      const summary = await getExpensesSummary(intent.period);
      const periodLabel = {
        today: 'Hari Ini',
        this_week: 'Minggu Ini',
        this_month: 'Bulan Ini',
        all: 'Semua Waktu',
      }[intent.period];

      if (summary.count === 0) {
        return `📊 Ringkasan Pengeluaran (${periodLabel})\n\nBelum ada pengeluaran yang tercatat untuk periode ini.`;
      }

      let text = `📊 Ringkasan Pengeluaran (${periodLabel})\n\n`;
      text += `Total: ${formatCurrency(summary.total)} (${summary.count} transaksi)\n\n`;
      text += `Rincian Kategori:\n`;

      const sortedCategories = Object.entries(summary.byCategory).sort(
        ([, a], [, b]) => b - a
      );

      for (const [cat, amt] of sortedCategories) {
        const pct = ((amt / summary.total) * 100).toFixed(1);
        text += `• ${cat}: ${formatCurrency(amt)} (${pct}%)\n`;
      }

      return text;
    }

    case 'DELETE_LAST_EXPENSE': {
      const res = await deleteLastExpenseRecord();
      if (!res.success) {
        return `⚠️ Tidak ada data pengeluaran yang bisa dihapus.`;
      }
      return `🗑️ Berhasil menghapus pengeluaran terakhir:\n${res.deletedDescription || 'Data transaksi'}`;
    }

    case 'HELP': {
      return (
        `🤖 Panduan Bot Pencatat Pengeluaran\n\n` +
        `Kirim pesan santai seperti ngobrol biasa! Contoh:\n\n` +
        `➕ Catat Pengeluaran:\n` +
        `• "Beli nasi goreng 15rb"\n` +
        `• "Kopi kenangan 28k"\n` +
        `• "Isi bensin motor 50rb tadi pagi"\n` +
        `• "Bayar tagihan listrik 150 ribu"\n` +
        `• "Belanja bulanan 350k kemarin"\n` +
        `• "Grab 25rb"\n\n` +
        `📊 Cek Rekap Pengeluaran:\n` +
        `• "Habis berapa hari ini?"\n` +
        `• "Rekap minggu ini"\n` +
        `• "Pengeluaran bulan ini"\n` +
        `• "Total semua pengeluaran"\n\n` +
        `🗑️ Batalkan Transaksi:\n` +
        `• "Hapus yang tadi"\n` +
        `• "Undo transaksi terakhir"\n`
      );
    }

    case 'UNKNOWN':
    default: {
      return intent.message || `Maaf, saya kurang paham. Coba ketik seperti "Beli kopi 25rb" atau ketik "help".`;
    }
  }
}
