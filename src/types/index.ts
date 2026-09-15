// Telegram Webhook Types
export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

// Router & Skill Types
export type SkillAction =
  | 'ADD_EXPENSE'
  | 'GET_SUMMARY'
  | 'DELETE_LAST_EXPENSE'
  | 'EDIT_LAST_EXPENSE'
  | 'HELP'
  | 'UNKNOWN';

export interface AddExpenseIntent {
  action: 'ADD_EXPENSE';
  amount: number;
  category: string;
  description: string;
  date?: string; // Optional custom date (YYYY-MM-DD) if specified in text
}

export interface GetSummaryIntent {
  action: 'GET_SUMMARY';
  period: 'today' | 'this_week' | 'this_month' | 'all';
  targetSpender?: string; // Optional: name of the specific spender to check, or 'all'
}

export interface DeleteLastExpenseIntent {
  action: 'DELETE_LAST_EXPENSE';
}

export interface EditLastExpenseIntent {
  action: 'EDIT_LAST_EXPENSE';
  newAmount?: number;
  newCategory?: string;
  newDescription?: string;
}

export interface HelpIntent {
  action: 'HELP';
}

export interface UnknownIntent {
  action: 'UNKNOWN';
  message: string;
}

export type ParsedIntent =
  | AddExpenseIntent
  | GetSummaryIntent
  | DeleteLastExpenseIntent
  | EditLastExpenseIntent
  | HelpIntent
  | UnknownIntent;

// Database Types (Google Sheets)
export interface ExpenseRecord {
  date: string;       // YYYY-MM-DD HH:mm:ss
  spender: string;    // Name of the person who spent
  category: string;   // e.g. Makanan, Transportasi, etc.
  amount: number;     // Numeric amount (IDR)
  description: string;// Detailed note
  rawText: string;    // Original Telegram message
}

export interface SummaryResult {
  total: number;
  count: number;
  period: string;
  spenderLabel: string;
  byCategory: Record<string, number>;
  bySpender?: Record<string, number>;
}
