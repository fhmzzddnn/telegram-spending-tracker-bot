import { ParsedIntent, SkillResult } from '../types/index.js';
import {
  appendExpenseRecord,
  appendIncomeRecord,
  getExpensesSummary,
  getIncomeSummary,
  deleteLastExpenseRecord,
  deleteLastIncomeRecord,
  updateLastExpenseRecord,
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

async function getCurrentMonthBalance(): Promise<number> {
  const [inc, exp] = await Promise.all([
    getIncomeSummary('this_month', 'all'),
    getExpensesSummary('this_month', 'all'),
  ]);
  return inc.total - exp.total;
}

export async function executeSkill(
  intent: ParsedIntent,
  rawText: string,
  spender = 'User'
): Promise<SkillResult> {
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

      const balance = await getCurrentMonthBalance();
      const balanceLabel = balance < 0 ? ' (defisit)' : balance === 0 ? ' (imbang)' : '';
      const notification =
        `🔔 Pengeluaran Baru dari ${spender}\n\n` +
        `💵 Jumlah: ${formatCurrency(intent.amount)}\n` +
        `📂 Kategori: ${intent.category}\n` +
        `📝 Catatan: ${intent.description}\n` +
        `📅 Tanggal: ${date.split(' ')[0]}\n\n` +
        `🧮 Saldo Bulan Ini: ${formatCurrency(balance)}${balanceLabel}`;

      return {
        reply:
          `✅ Pengeluaran Berhasil Dicatat\n\n` +
          `👤 Pengeluar: ${spender}\n` +
          `💵 Jumlah: ${formatCurrency(intent.amount)}\n` +
          `📂 Kategori: ${intent.category}\n` +
          `📝 Catatan: ${intent.description}\n` +
          `📅 Tanggal: ${date.split(' ')[0]}`,
        notification,
      };
    }

    case 'ADD_INCOME': {
      const date = intent.date ? `${intent.date} 12:00:00` : formatDate();
      await appendIncomeRecord({
        date,
        spender,
        category: intent.category,
        amount: intent.amount,
        description: intent.description,
        rawText,
      });

      const balance = await getCurrentMonthBalance();
      const balanceLabel = balance < 0 ? ' (defisit)' : balance === 0 ? ' (imbang)' : '';
      const notification =
        `🔔 Pemasukan Baru dari ${spender}\n\n` +
        `💵 Jumlah: ${formatCurrency(intent.amount)}\n` +
        `📂 Sumber: ${intent.category}\n` +
        `📝 Catatan: ${intent.description}\n` +
        `📅 Tanggal: ${date.split(' ')[0]}\n\n` +
        `🧮 Saldo Bulan Ini: ${formatCurrency(balance)}${balanceLabel}`;

      return {
        reply:
          `✅ Pemasukan Berhasil Dicatat\n\n` +
          `👤 Penerima: ${spender}\n` +
          `💵 Jumlah: ${formatCurrency(intent.amount)}\n` +
          `📂 Sumber: ${intent.category}\n` +
          `📝 Catatan: ${intent.description}\n` +
          `📅 Tanggal: ${date.split(' ')[0]}`,
        notification,
      };
    }

    case 'GET_SUMMARY': {
      const [income, expense] = await Promise.all([
        getIncomeSummary(intent.period, 'all'),
        getExpensesSummary(intent.period, intent.targetSpender, spender),
      ]);
      const periodLabel = {
        today: 'Hari Ini',
        this_week: 'Minggu Ini',
        this_month: 'Bulan Ini',
        all: 'Semua Waktu',
      }[intent.period];

      const balance = income.total - expense.total;
      const balanceLabel = balance < 0 ? ' (defisit)' : balance === 0 ? ' (imbang)' : '';

      if (income.count === 0 && expense.count === 0) {
        return { reply: `📊 Ringkasan Keuangan ${expense.spenderLabel} (${periodLabel})\n\nBelum ada transaksi untuk periode ini.` };
      }

      let text = `📊 Ringkasan Keuangan ${expense.spenderLabel} (${periodLabel})\n\n`;
      text += `💰 Pemasukan (semua pengguna): ${formatCurrency(income.total)} (${income.count} transaksi)\n`;
      text += `💸 Pengeluaran: ${formatCurrency(expense.total)} (${expense.count} transaksi)\n`;
      text += `🧮 Saldo: ${formatCurrency(balance)}${balanceLabel}\n\n`;

      if (income.count > 0) {
        text += `Rincian Pemasukan per Sumber:\n`;
        const sortedSources = Object.entries(income.byCategory).sort(([, a], [, b]) => b - a);
        for (const [src, amt] of sortedSources) {
          const pct = income.total > 0 ? ((amt / income.total) * 100).toFixed(1) : '0.0';
          text += `• ${src}: ${formatCurrency(amt)} (${pct}%)\n`;
        }
        text += `\n`;
      }

      if (expense.bySpender && Object.keys(expense.bySpender).length > 1) {
        text += `Rincian per Pengguna:\n`;
        const sortedSpenders = Object.entries(expense.bySpender).sort(([, a], [, b]) => b - a);
        for (const [name, amt] of sortedSpenders) {
          const pct = expense.total > 0 ? ((amt / expense.total) * 100).toFixed(1) : '0.0';
          text += `• ${name}: ${formatCurrency(amt)} (${pct}%)\n`;
        }
        text += `\n`;
      }

      if (expense.count > 0) {
        text += `Rincian Kategori:\n`;
        const sortedCategories = Object.entries(expense.byCategory).sort(
          ([, a], [, b]) => b - a
        );
        for (const [cat, amt] of sortedCategories) {
          const pct = expense.total > 0 ? ((amt / expense.total) * 100).toFixed(1) : '0.0';
          text += `• ${cat}: ${formatCurrency(amt)} (${pct}%)\n`;
        }
      }

      return { reply: text };
    }

    case 'DELETE_LAST_EXPENSE': {
      const res = await deleteLastExpenseRecord(spender);
      if (!res.success) {
        return { reply: `⚠️ Tidak ada data pengeluaran milik Anda (${spender}) yang bisa dihapus.` };
      }
      return { reply: `🗑️ Berhasil menghapus pengeluaran terakhir Anda:\n${res.deletedDescription || 'Data transaksi'}` };
    }

    case 'DELETE_LAST_INCOME': {
      const res = await deleteLastIncomeRecord(spender);
      if (!res.success) {
        return { reply: `⚠️ Tidak ada data pemasukan milik Anda (${spender}) yang bisa dihapus.` };
      }
      return { reply: `🗑️ Berhasil menghapus pemasukan terakhir Anda:\n${res.deletedDescription || 'Data pemasukan'}` };
    }

    case 'EDIT_LAST_EXPENSE': {
      const res = await updateLastExpenseRecord(spender, {
        newAmount: intent.newAmount,
        newCategory: intent.newCategory,
        newDescription: intent.newDescription,
      });

      if (!res.success || !res.updatedRecord) {
        return { reply: `⚠️ Tidak ada data pengeluaran milik Anda (${spender}) yang bisa diedit.` };
      }

      return {
        reply:
          `✏️ Pengeluaran Terakhir Berhasil Diperbarui!\n\n` +
          `👤 Pengeluar: ${res.updatedRecord.spender}\n` +
          `💵 Jumlah: ${formatCurrency(res.updatedRecord.amount)}\n` +
          `📂 Kategori: ${res.updatedRecord.category}\n` +
          `📝 Catatan: ${res.updatedRecord.description}\n` +
          `📅 Tanggal: ${res.updatedRecord.date.split(' ')[0]}`,
      };
    }

    case 'HELP': {
      return {
        reply:
          `🤖 Panduan Bot Pencatat Pengeluaran\n\n` +
          `Kirim pesan santai seperti ngobrol biasa! Contoh:\n\n` +
          `➕ Catat Pengeluaran:\n` +
          `• "Beli nasi goreng 15rb"\n` +
          `• "Kopi kenangan 28k"\n` +
          `• "Isi bensin motor 50rb tadi pagi"\n` +
          `• "Bayar tagihan listrik 150 ribu"\n` +
          `• "Belanja bulanan 350k kemarin"\n` +
          `• "Grab 25rb"\n\n` +
          `💰 Catat Pemasukan:\n` +
          `• "Gaji 5jt"\n` +
          `• "Bonus 500rb kemarin"\n` +
          `• "Dapat freelance 1.5jt"\n` +
          `• "Terima hadiah 200rb"\n\n` +
          `✏️ Edit / Koreksi Transaksi Sendiri:\n` +
          `• "Eh salah harganya 20rb bukan 15rb"\n` +
          `• "Koreksi tadi jadi 35k"\n` +
          `• "Ganti kategori jadi Transportasi"\n` +
          `• "Ubah catatannya jadi martabak manis"\n\n` +
          `📊 Cek Rekap & Saldo:\n` +
          `• "Habis berapa hari ini?" (Pengeluaran sendiri)\n` +
          `• "Pengeluaran Sarah minggu ini" (Cek orang lain)\n` +
          `• "Rekap semua pengeluaran bulan ini" (Total gabungan)\n` +
          `• "Saldo bulan ini" (Pemasukan - Pengeluaran)\n` +
          `• "Uangku berapa?" (Ringkasan keuangan)\n\n` +
          `🗑️ Batalkan Pengeluaran:\n` +
          `• "Hapus yang tadi"\n` +
          `• "Undo transaksi terakhir"\n\n` +
          `🗑️ Batalkan Pemasukan:\n` +
          `• "Hapus pemasukan terakhir"\n` +
          `• "Hapus gaji tadi"\n` +
          `• "Undo pemasukan"\n`,
      };
    }

    case 'UNKNOWN':
    default: {
      return {
        reply:
          intent.message ||
          `Maaf, saya kurang paham. Coba ketik seperti "Beli kopi 25rb" atau ketik "help".`,
      };
    }
  }
}
