import { google } from 'googleapis';
import { ExpenseRecord, SummaryResult } from '../types/index.js';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const SHEET_NAME = 'Expenses';
const HEADERS = ['Date', 'Spender', 'Category', 'Amount', 'Description', 'Raw Text'];

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !privateKey) {
    throw new Error('[Google Sheets] Missing service account email or private key');
  }

  // Replace literal '\n' with actual newline characters
  privateKey = privateKey.replace(/\\n/g, '\n');

  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: SCOPES,
  });
}

function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

function getSpreadsheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) {
    throw new Error('[Google Sheets] Missing GOOGLE_SHEET_ID');
  }
  return id;
}

/**
 * Ensures the 'Expenses' sheet exists and has headers
 */
export async function ensureSheetInitialized(): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetExists = meta.data.sheets?.some(
      (s) => s.properties?.title?.toLowerCase() === SHEET_NAME.toLowerCase()
    );

    if (!sheetExists) {
      // Add sheet
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: { title: SHEET_NAME },
              },
            },
          ],
        },
      });
    }

    // Check header row
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAME}!A1:F1`,
    });

    if (!response.data.values || response.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_NAME}!A1:F1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [HEADERS],
        },
      });
    }
  } catch (err) {
    console.error('[Google Sheets] Error initializing sheet:', err);
    throw err;
  }
}

/**
 * Appends a new expense record to the sheet
 */
export async function appendExpenseRecord(record: ExpenseRecord): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  await ensureSheetInitialized();

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_NAME}!A:F`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        record.date,
        record.spender,
        record.category,
        record.amount,
        record.description,
        record.rawText,
      ]],
    },
  });
}

/**
 * Deletes the most recent expense row for a specific spender
 */
export async function deleteLastExpenseRecord(spender?: string): Promise<{ success: boolean; deletedDescription?: string }> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  await ensureSheetInitialized();

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetObj = meta.data.sheets?.find(
    (s) => s.properties?.title?.toLowerCase() === SHEET_NAME.toLowerCase()
  );
  const sheetId = sheetObj?.properties?.sheetId ?? 0;

  const data = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A:F`,
  });

  const rows = data.data.values;
  if (!rows || rows.length <= 1) {
    return { success: false };
  }

  // Find the last row belonging to this specific spender (or absolute last row if spender is omitted)
  let targetRowIndex = -1;
  for (let i = rows.length - 1; i >= 1; i--) {
    const rowSpender = String(rows[i][1] || '').trim().toLowerCase();
    if (!spender || rowSpender === spender.trim().toLowerCase() || rowSpender.includes(spender.trim().toLowerCase())) {
      targetRowIndex = i;
      break;
    }
  }

  if (targetRowIndex === -1) {
    return { success: false };
  }

  const lastRowData = rows[targetRowIndex];
  const formattedAmt = isNaN(Number(lastRowData[3])) ? lastRowData[3] : `Rp ${Number(lastRowData[3]).toLocaleString('id-ID')}`;
  const deletedDescription = `${lastRowData[1]} (${lastRowData[2]} - ${formattedAmt}: ${lastRowData[4]})`;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: targetRowIndex,
              endIndex: targetRowIndex + 1,
            },
          },
        },
      ],
    },
  });

  return { success: true, deletedDescription };
}

/**
 * Updates the most recent expense record for a specific spender with new values
 */
export async function updateLastExpenseRecord(
  spender: string,
  updates: {
    newAmount?: number;
    newCategory?: string;
    newDescription?: string;
  }
): Promise<{
  success: boolean;
  oldRecord?: ExpenseRecord;
  updatedRecord?: ExpenseRecord;
}> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  await ensureSheetInitialized();

  const data = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A:F`,
  });

  const rows = data.data.values;
  if (!rows || rows.length <= 1) {
    return { success: false };
  }

  // Find the last row belonging to this specific spender
  let targetRowIndex = -1;
  for (let i = rows.length - 1; i >= 1; i--) {
    const rowSpender = String(rows[i][1] || '').trim().toLowerCase();
    if (rowSpender === spender.trim().toLowerCase() || rowSpender.includes(spender.trim().toLowerCase())) {
      targetRowIndex = i;
      break;
    }
  }

  if (targetRowIndex === -1) {
    return { success: false };
  }

  const rowNumber = targetRowIndex + 1; // 1-indexed row number in Google Sheets
  const lastRowData = rows[targetRowIndex];

  const oldRecord: ExpenseRecord = {
    date: String(lastRowData[0] || ''),
    spender: String(lastRowData[1] || ''),
    category: String(lastRowData[2] || ''),
    amount: Number(lastRowData[3]) || 0,
    description: String(lastRowData[4] || ''),
    rawText: String(lastRowData[5] || ''),
  };

  const updatedRecord: ExpenseRecord = {
    date: oldRecord.date,
    spender: oldRecord.spender,
    category: updates.newCategory || oldRecord.category,
    amount: updates.newAmount !== undefined ? updates.newAmount : oldRecord.amount,
    description: updates.newDescription || oldRecord.description,
    rawText: `[Diedit] ${oldRecord.rawText}`,
  };

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!A${rowNumber}:F${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        updatedRecord.date,
        updatedRecord.spender,
        updatedRecord.category,
        updatedRecord.amount,
        updatedRecord.description,
        updatedRecord.rawText,
      ]],
    },
  });

  return { success: true, oldRecord, updatedRecord };
}

/**
 * Computes expense summary for a given period, optionally scoped to a target spender or caller
 */
export async function getExpensesSummary(
  period: 'today' | 'this_week' | 'this_month' | 'all',
  targetSpender?: string,
  callerSpender?: string
): Promise<SummaryResult> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  await ensureSheetInitialized();

  const data = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A2:F`,
  });

  const rows = data.data.values || [];
  const now = new Date();

  // Start boundaries
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayOfWeek = now.getDay() || 7; // Monday = 1
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek + 1);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  let total = 0;
  let count = 0;
  const byCategory: Record<string, number> = {};
  const bySpender: Record<string, number> = {};

  // Determine spender filter
  const isAll = targetSpender === 'all';
  const filterName = isAll ? undefined : (targetSpender || callerSpender);
  const spenderLabel = isAll ? 'Semua Pengguna' : (filterName || 'Anda');

  for (const row of rows) {
    const dateStr = row[0] as string;
    const rowSpender = (row[1] as string) || 'User';
    const category = (row[2] as string) || 'Lainnya';
    const amount = parseFloat(String(row[3]).replace(/[^0-9.-]+/g, '')) || 0;

    const entryDate = new Date(dateStr);
    if (isNaN(entryDate.getTime())) {
      continue;
    }

    // Timeframe filter
    let includeTime = false;
    if (period === 'all') {
      includeTime = true;
    } else if (period === 'today' && entryDate >= startOfDay) {
      includeTime = true;
    } else if (period === 'this_week' && entryDate >= startOfWeek) {
      includeTime = true;
    } else if (period === 'this_month' && entryDate >= startOfMonth) {
      includeTime = true;
    }

    if (!includeTime) continue;

    // Spender filter
    if (filterName) {
      const match = rowSpender.toLowerCase().includes(filterName.toLowerCase()) ||
                    filterName.toLowerCase().includes(rowSpender.toLowerCase());
      if (!match) continue;
    }

    total += amount;
    count += 1;
    byCategory[category] = (byCategory[category] || 0) + amount;
    bySpender[rowSpender] = (bySpender[rowSpender] || 0) + amount;
  }

  return {
    total,
    count,
    period,
    spenderLabel,
    byCategory,
    bySpender: isAll ? bySpender : undefined,
  };
}
