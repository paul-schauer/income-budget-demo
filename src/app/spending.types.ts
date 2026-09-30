/**
 * Types for the Spending module (src/app/spending.ts): transactions, auto-assign rules,
 * bank CSV import and the planned-vs-actual month view.
 * Type-only: nothing here exists at runtime.
 */
import type { BudgetItem, CategoryId } from "./types";

// ---------------------------------------------------------------- saved state

/** One spending record. amount is + for money spent, − for a refund. */
export interface Transaction {
  id: string;
  /** "YYYY-MM-DD" */
  date: string;
  amount: number;
  description: string;
  /** Budget item id, or null when unassigned. */
  itemId: string | null;
  category: CategoryId | null;
}

/** Auto-assign rule: descriptions containing `match` (normalized, at a word start) go to itemId. */
export interface Rule {
  match: string;
  itemId: string;
}

/** state.spending */
export interface SpendingState {
  transactions: Transaction[];
  rules: Rule[];
}

// ---------------------------------------------------------------- CSV & columns

/** One parsed CSV line: raw cell strings. */
export type CsvRow = string[];

export type ColumnRole = "date" | "description" | "amount" | "debit" | "credit" | "type";
/** Column index for each role; -1 when the file has no such column. */
export type ColumnMapping = Record<ColumnRole, number>;

/** How to read the sign of each row (see detectSignMode). */
export type SignMode = "debitcredit" | "negative" | "positive" | "type";
/** Slash dates: month first (US) or day first. */
export type DateOrder = "mdy" | "dmy";

export interface HeaderMatch {
  /** Row index of the header line. */
  index: number;
  mapping: ColumnMapping;
}

// ---------------------------------------------------------------- matching

export type AssignSource = "rule" | "name";
export interface Assignment {
  itemId: string | null;
  source: AssignSource | null;
}
/** Money coming in: kept as negative spending ("refund") or skipped ("income"). */
export type InflowKind = "refund" | "income";

// ---------------------------------------------------------------- import

export interface ImportOptions {
  items?: BudgetItem[];
  rules?: Rule[];
  /** Transactions already saved, for duplicate detection. */
  existing?: Transaction[];
  /** Column overrides picked by the user; out-of-range values are ignored. */
  mapping?: Partial<ColumnMapping> | null;
  /** Used when it is one of the modes allowed for the mapping. */
  signMode?: SignMode | null;
  uid?: () => string;
}

export interface ImportColumn {
  index: number;
  /** Header text, or "Column N". */
  name: string;
  /** First non-empty value, trimmed to 40 characters. */
  sample: string;
}

/** A row whose date or amount couldn't be read. */
export interface InvalidImportRow {
  status: "invalid";
  date: string | null;
  rawDate: string;
  rawAmount: string;
  description: string;
  /** Always NaN. */
  amount: number;
}

/** A readable row. status is "" until it is classified. */
export interface ParsedImportRow {
  status: "" | "new" | "duplicate" | "income";
  date: string;
  description: string;
  amount: number;
  /** Raw value of the type column ("" when there is none). */
  type: string;
  refund?: boolean;
  itemId?: string | null;
  source?: AssignSource | null;
  rawDate?: undefined;
  rawAmount?: undefined;
}

export type ImportRow = InvalidImportRow | ParsedImportRow;

export interface ImportCounts {
  rows: number;
  new: number;
  duplicate: number;
  income: number;
  invalid: number;
  refunds: number;
}

export interface DateRange {
  from: string;
  to: string;
}

/** prepareImport() output: the preview plus the transactions ready to add. */
export interface ImportResult {
  ok: boolean;
  error: string;
  columns: ImportColumn[];
  hasHeader: boolean;
  mapping: ColumnMapping;
  detected: ColumnMapping;
  signMode: SignMode;
  detectedSign: SignMode;
  signModes: SignMode[];
  dateOrder: DateOrder;
  rows: ImportRow[];
  transactions: Transaction[];
  counts: ImportCounts;
  dateRange: DateRange | null;
}

/** The import preview being edited in the UI. */
export interface ImportDraft {
  fileName: string;
  text: string;
  /** User's column choices, or null for the detected ones. */
  mapping: ColumnMapping | null;
  signMode: SignMode | null;
  result: ImportResult;
  /** The result last drawn, so unrelated renders keep focus in the selects. */
  rendered: ImportResult | null;
}

// ---------------------------------------------------------------- month view

export interface SummaryCategory {
  id: string;
  name: string;
  color?: string;
}

export interface MonthSummaryInput {
  items?: BudgetItem[];
  transactions?: Transaction[];
  /** "YYYY-MM" */
  month?: string;
  /** "YYYY-MM-DD"; pace is computed when it falls in `month`. */
  today?: string | null;
  annualOf?: (item: BudgetItem) => number;
  categories?: readonly SummaryCategory[];
}

export interface SummaryRow {
  item: BudgetItem;
  planned: number;
  actual: number;
  diff: number;
  ratio: number;
  over: boolean;
}

export interface SummaryGroup {
  category: SummaryCategory;
  rows: SummaryRow[];
  planned: number;
  actual: number;
  diff: number;
  over: boolean;
}

export interface MonthPace {
  day: number;
  daysInMonth: number;
  fraction: number;
  expected: number;
  actual: number;
  diff: number;
}

export interface MonthSummary {
  month: string | undefined;
  groups: SummaryGroup[];
  count: number;
  unassigned: { actual: number; count: number };
  totals: { planned: number; actual: number; diff: number; over: boolean };
  pace: MonthPace | null;
}

// ---------------------------------------------------------------- UI

/** "Always assign …?" prompt shown under a reassigned transaction. */
export interface RulePrompt {
  txId: string;
  key: string;
  itemId: string;
  /** Other unassigned transactions the rule would also assign. */
  others: number;
}

/** Elements looked up by id once the module's markup is in place. */
export type SpendingElements = {
  spImport: HTMLElement;
  spIntro: HTMLElement;
  spIntroItems: HTMLElement;
  spMonth: HTMLElement;
  spMonthLabel: HTMLElement;
  spThisMonth: HTMLButtonElement;
  spSummary: HTMLElement;
  spPace: HTMLElement;
  spPlan: HTMLTableElement;
  spNoItems: HTMLElement;
  spTx: HTMLElement;
  spTxTitle: HTMLElement;
  spFile: HTMLInputElement;
  spAddForm: HTMLFormElement;
  spDesc: HTMLInputElement;
  spDate: HTMLInputElement;
  spAmount: HTMLInputElement;
  spItem: HTMLSelectElement;
  spListWrap: HTMLElement;
  spSearch: HTMLInputElement;
  spFilter: HTMLSelectElement;
  spCount: HTMLElement;
  spList: HTMLUListElement;
  spListEmpty: HTMLElement;
  spMore: HTMLElement;
  spRules: HTMLDetailsElement;
  spRulesSummary: HTMLElement;
  spRuleList: HTMLUListElement;
};
