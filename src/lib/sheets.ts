import { google } from 'googleapis';
import { ExpenseRecord, SummaryResult, RolloverResult } from '../types/index.js';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

export const SHEET_NAMES = {
  EXPENSES: 'Expenses',
  HISTORY: 'History',
  USER_MONTHLY: 'User (Monthly)',
  CATEGORY_MONTHLY: 'Category (Monthly)',
} as const;

export const EXPENSES_HEADERS = ['Date', 'Spender', 'Category', 'Amount', 'Description', 'Raw Text'];
export const HISTORY_HEADERS = ['Date', 'Spender', 'Category', 'Amount', 'Description', 'Raw Text'];
export const USER_MONTHLY_HEADERS = ['Name', 'mm-yyyy', 'Amount'];
export const CATEGORY_MONTHLY_HEADERS = ['Category', 'mm-yyyy', 'Amount'];

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
 * Extracts "mm-yyyy" from a date string (e.g., "2026-09-15 12:00:00" -> "09-2026")
 */
export function parseMonthYear(dateStr: string): string | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  const matchYMD = trimmed.match(/^(\d{4})[-/](\d{1,2})/);
  if (matchYMD) {
    const year = matchYMD[1];
    const month = matchYMD[2].padStart(2, '0');
    return `${month}-${year}`;
  }
  const matchDMY = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (matchDMY) {
    const month = matchDMY[2].padStart(2, '0');
    const year = matchDMY[3];
    return `${month}-${year}`;
  }
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const y = d.getFullYear();
    return `${m}-${y}`;
  }
  return null;
}

export function getCurrentMonthYear(d = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const y = d.getFullYear();
  return `${m}-${y}`;
}

/**
 * Ensures all required sheets exist and have their initial header rows
 */
export async function ensureSheetInitialized(): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheets = new Set(
      (meta.data.sheets || []).map((s) => s.properties?.title?.toLowerCase())
    );

    const sheetDefs = [
      { name: SHEET_NAMES.EXPENSES, headers: EXPENSES_HEADERS },
      { name: SHEET_NAMES.HISTORY, headers: HISTORY_HEADERS },
      { name: SHEET_NAMES.USER_MONTHLY, headers: USER_MONTHLY_HEADERS },
      { name: SHEET_NAMES.CATEGORY_MONTHLY, headers: CATEGORY_MONTHLY_HEADERS },
    ];

    const addRequests: any[] = [];
    for (const def of sheetDefs) {
      if (!existingSheets.has(def.name.toLowerCase())) {
        addRequests.push({
          addSheet: {
            properties: { title: def.name },
          },
        });
      }
    }

    if (addRequests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: addRequests },
      });
    }

    // Verify headers for all sheets
    const headerRanges = sheetDefs.map((def) => {
      const endCol = def.headers.length === 6 ? 'F' : 'C';
      return `'${def.name}'!A1:${endCol}1`;
    });

    const headersData = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: headerRanges,
    });

    const updateData: any[] = [];
    headersData.data.valueRanges?.forEach((vr, idx) => {
      if (!vr.values || vr.values.length === 0 || vr.values[0].length === 0) {
        const def = sheetDefs[idx];
        const endCol = def.headers.length === 6 ? 'F' : 'C';
        updateData.push({
          range: `'${def.name}'!A1:${endCol}1`,
          values: [def.headers],
        });
      }
    });

    if (updateData.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: updateData,
        },
      });
    }
  } catch (err) {
    console.error('[Google Sheets] Error initializing sheets:', err);
    throw err;
  }
}

/**
 * Upserts monthly summaries into 'User (Monthly)' and 'Category (Monthly)'
 */
async function updateMonthlySummaries(
  sheets: any,
  spreadsheetId: string,
  userTotalsByMonth: Map<string, Map<string, number>>,
  categoryTotalsByMonth: Map<string, Map<string, number>>
): Promise<void> {
  // 1. Update User (Monthly)
  if (userTotalsByMonth.size > 0) {
    const userRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SHEET_NAMES.USER_MONTHLY}'!A2:C`,
    });
    const userRows: any[][] = userRes.data.values || [];
    const updates: any[] = [];
    const newRows: any[][] = [];

    for (const [mYear, spenders] of userTotalsByMonth.entries()) {
      for (const [spender, amount] of spenders.entries()) {
        const existingIdx = userRows.findIndex(
          (r) => String(r[0] || '').trim().toLowerCase() === spender.trim().toLowerCase() &&
                 String(r[1] || '').trim() === mYear
        );

        if (existingIdx !== -1) {
          const currentAmt = parseFloat(String(userRows[existingIdx][2] || '0').replace(/[^0-9.-]+/g, '')) || 0;
          const updatedAmt = currentAmt + amount;
          userRows[existingIdx][2] = updatedAmt;
          updates.push({
            range: `'${SHEET_NAMES.USER_MONTHLY}'!C${existingIdx + 2}`,
            values: [[updatedAmt]],
          });
        } else {
          const row = [spender, mYear, amount];
          userRows.push(row);
          newRows.push(row);
        }
      }
    }

    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: updates,
        },
      });
    }

    if (newRows.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `'${SHEET_NAMES.USER_MONTHLY}'!A:C`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: newRows },
      });
    }
  }

  // 2. Update Category (Monthly)
  if (categoryTotalsByMonth.size > 0) {
    const catRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SHEET_NAMES.CATEGORY_MONTHLY}'!A2:C`,
    });
    const catRows: any[][] = catRes.data.values || [];
    const updates: any[] = [];
    const newRows: any[][] = [];

    for (const [mYear, cats] of categoryTotalsByMonth.entries()) {
      for (const [cat, amount] of cats.entries()) {
        const existingIdx = catRows.findIndex(
          (r) => String(r[0] || '').trim().toLowerCase() === cat.trim().toLowerCase() &&
                 String(r[1] || '').trim() === mYear
        );

        if (existingIdx !== -1) {
          const currentAmt = parseFloat(String(catRows[existingIdx][2] || '0').replace(/[^0-9.-]+/g, '')) || 0;
          const updatedAmt = currentAmt + amount;
          catRows[existingIdx][2] = updatedAmt;
          updates.push({
            range: `'${SHEET_NAMES.CATEGORY_MONTHLY}'!C${existingIdx + 2}`,
            values: [[updatedAmt]],
          });
        } else {
          const row = [cat, mYear, amount];
          catRows.push(row);
          newRows.push(row);
        }
      }
    }

    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: updates,
        },
      });
    }

    if (newRows.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `'${SHEET_NAMES.CATEGORY_MONTHLY}'!A:C`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: newRows },
      });
    }
  }
}

/**
 * Rolls over expenses from the 'Expenses' sheet to 'History', and updates monthly summaries.
 * If forceAll is true, all rows currently in 'Expenses' are archived.
 * Otherwise, only rows belonging to months other than targetMonthYear are archived.
 */
export async function rolloverMonth(options?: {
  forceAll?: boolean;
  targetMonthYear?: string;
}): Promise<RolloverResult> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  await ensureSheetInitialized();

  const data = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_NAMES.EXPENSES}'!A2:F`,
  });

  const rows = data.data.values || [];
  if (rows.length === 0) {
    return { rolledOver: false, recordCount: 0, months: [] };
  }

  const targetMonthYear = options?.targetMonthYear || getCurrentMonthYear();
  const forceAll = options?.forceAll ?? false;

  const rowsToArchive: any[][] = [];
  const rowsToKeep: any[][] = [];

  const userTotalsByMonth = new Map<string, Map<string, number>>();
  const categoryTotalsByMonth = new Map<string, Map<string, number>>();
  const affectedMonths = new Set<string>();

  for (const row of rows) {
    const rowMonthYear = parseMonthYear(String(row[0] || '')) || 'unknown';
    const shouldArchive = forceAll || (rowMonthYear !== targetMonthYear);

    if (shouldArchive) {
      rowsToArchive.push(row);
      affectedMonths.add(rowMonthYear);

      const spender = String(row[1] || 'User').trim();
      const category = String(row[2] || 'Lainnya').trim();
      const amount = parseFloat(String(row[3] || '0').replace(/[^0-9.-]+/g, '')) || 0;

      // User aggregations
      if (!userTotalsByMonth.has(rowMonthYear)) {
        userTotalsByMonth.set(rowMonthYear, new Map());
      }
      const userMap = userTotalsByMonth.get(rowMonthYear)!;
      userMap.set(spender, (userMap.get(spender) || 0) + amount);

      // Category aggregations
      if (!categoryTotalsByMonth.has(rowMonthYear)) {
        categoryTotalsByMonth.set(rowMonthYear, new Map());
      }
      const catMap = categoryTotalsByMonth.get(rowMonthYear)!;
      catMap.set(category, (catMap.get(category) || 0) + amount);
    } else {
      rowsToKeep.push(row);
    }
  }

  if (rowsToArchive.length === 0) {
    return { rolledOver: false, recordCount: 0, months: [] };
  }

  // 1. Append archived rows to History
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${SHEET_NAMES.HISTORY}'!A:F`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rowsToArchive },
  });

  // 2. Update monthly summaries
  await updateMonthlySummaries(sheets, spreadsheetId, userTotalsByMonth, categoryTotalsByMonth);

  // 3. Update Expenses sheet: clear and rewrite remaining rows (if any)
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${SHEET_NAMES.EXPENSES}'!A2:F`,
  });

  if (rowsToKeep.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_NAMES.EXPENSES}'!A2:F${1 + rowsToKeep.length}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rowsToKeep },
    });
  }

  return {
    rolledOver: true,
    recordCount: rowsToArchive.length,
    months: Array.from(affectedMonths),
  };
}

/**
 * Checks if 'Expenses' sheet contains records from previous months, and triggers rollover if needed.
 */
export async function rolloverMonthIfNeeded(referenceDateStr?: string): Promise<RolloverResult> {
  const targetMonthYear = (referenceDateStr && parseMonthYear(referenceDateStr)) || getCurrentMonthYear();
  return rolloverMonth({ forceAll: false, targetMonthYear });
}

/**
 * Appends a new expense record. If the record belongs to the current active month,
 * it rolls over any previous month data and appends to 'Expenses'.
 * If the record is backdated to an older month, it archives directly to 'History'
 * and updates monthly summaries without polluting 'Expenses'.
 */
export async function appendExpenseRecord(record: ExpenseRecord): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  await ensureSheetInitialized();

  const recordMonthYear = parseMonthYear(record.date) || getCurrentMonthYear();
  const currentMonthYear = getCurrentMonthYear();

  // If the record belongs to a past month
  if (recordMonthYear !== currentMonthYear) {
    // Check if Expenses itself needs rollover
    await rolloverMonthIfNeeded(new Date().toISOString());

    // Append to History
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${SHEET_NAMES.HISTORY}'!A:F`,
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

    // Update monthly summaries for this past month
    const userMap = new Map<string, Map<string, number>>();
    userMap.set(recordMonthYear, new Map([[record.spender, record.amount]]));
    const catMap = new Map<string, Map<string, number>>();
    catMap.set(recordMonthYear, new Map([[record.category, record.amount]]));
    await updateMonthlySummaries(sheets, spreadsheetId, userMap, catMap);
    return;
  }

  // Normal current month record: rollover any past month records lingering in Expenses
  await rolloverMonthIfNeeded(record.date);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${SHEET_NAMES.EXPENSES}'!A:F`,
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
 * Deletes the most recent expense row for a specific spender from the current month ('Expenses')
 */
export async function deleteLastExpenseRecord(spender?: string): Promise<{ success: boolean; deletedDescription?: string }> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  await ensureSheetInitialized();

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetObj = meta.data.sheets?.find(
    (s) => s.properties?.title?.toLowerCase() === SHEET_NAMES.EXPENSES.toLowerCase()
  );
  const sheetId = sheetObj?.properties?.sheetId ?? 0;

  const data = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_NAMES.EXPENSES}'!A:F`,
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
 * Updates the most recent expense record for a specific spender with new values in the current month ('Expenses')
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
    range: `'${SHEET_NAMES.EXPENSES}'!A:F`,
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
    range: `'${SHEET_NAMES.EXPENSES}'!A${rowNumber}:F${rowNumber}`,
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
 * Computes expense summary for a given period, optionally scoped to a target spender or caller.
 * If period is 'all', includes data from both 'Expenses' and 'History'.
 */
export async function getExpensesSummary(
  period: 'today' | 'this_week' | 'this_month' | 'all',
  targetSpender?: string,
  callerSpender?: string
): Promise<SummaryResult> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  await ensureSheetInitialized();

  let rows: any[][] = [];

  if (period === 'all') {
    const [expRes, histRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: `'${SHEET_NAMES.EXPENSES}'!A2:F` }),
      sheets.spreadsheets.values.get({ spreadsheetId, range: `'${SHEET_NAMES.HISTORY}'!A2:F` }),
    ]);
    rows = [...(histRes.data.values || []), ...(expRes.data.values || [])];
  } else {
    const expRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SHEET_NAMES.EXPENSES}'!A2:F`,
    });
    rows = expRes.data.values || [];
  }

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
