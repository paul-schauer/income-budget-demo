/**
 * Types for the app core (core.ts) and the module API every feature module uses.
 * Type-only: nothing here exists at runtime.
 */
import type { FilingStatus, IncomeType, PayPeriod, Period, PeriodInfo, TaxInput, TaxResult } from "../tax/types";

export type Tab = "paycheck" | "budget" | "calendar" | "goals" | "spending";
export type CategoryId =
  | "housing" | "transport" | "food" | "utilities" | "debt" | "savings" | "subscriptions" | "personal" | "other";

export interface Category { id: CategoryId; name: string; color: string }

export interface Income {
  mode: "salary" | "hourly";
  salary: number;
  hourlyRate: number;
  hoursPerWeek: number;
  filingStatus: FilingStatus;
  payPeriod: PayPeriod;
  nextPayday: string;
  k401Percent: number;
  k401Type: "traditional" | "roth";
  preTaxBenefits: number;
  dependents: number;
  otherDependents: number;
  extraWithholding: number;
  state: string;
  localId: string;
  localResident: boolean;
  localRate: number;
}

export interface Spouse {
  mode: "salary" | "hourly";
  salary: number;
  hourlyRate: number;
  hoursPerWeek: number;
  payPeriod: PayPeriod;
  k401Percent: number;
  k401Type: "traditional" | "roth";
  preTaxBenefits: number;
}

export interface BudgetItem {
  id: string;
  name: string;
  amount: number;
  recurrence: Period;
  category: CategoryId;
  dueDay: number | null;
}

export interface ExtraIncome {
  id: string;
  name: string;
  amount: number;
  recurrence: Period;
  type: IncomeType;
  owner: "you" | "spouse";
}

/** The saved document (localStorage, exports, and the sync server). Modules own extra keys. */
export interface AppState {
  updatedAt: number;
  income: Income;
  view: Period | null;
  sort: { key: string | null; dir: "asc" | "desc" };
  items: BudgetItem[];
  spouse: Spouse;
  extraIncome: ExtraIncome[];
  [moduleKey: string]: unknown;
}

/** A read-only budget row contributed by a module (e.g. a savings goal). */
export interface BudgetLine {
  id?: string;
  name: string;
  annual: number;
  category?: CategoryId;
  tab?: Tab;
  note?: string;
  source?: string;
}

export interface BaseContext {
  state: AppState;
  result: TaxResult;
  taxInput: TaxInput;
  payPeriod: PayPeriod;
  perYear: number;
  viewPeriod: Period;
  viewPerYear: number;
  netAnnual: number;
  itemsAnnual: number;
  activeTab: Tab;
}

export interface AppContext extends BaseContext {
  extras: BudgetLine[];
  extrasAnnual: number;
  budgetAnnual: number;
  leftAnnual: number;
}

export interface AppModule<S = unknown> {
  id: string;
  stateKey?: string;
  defaults?: () => S;
  sanitize?: (raw: unknown) => S;
  init?: (ctx: AppContext) => void;
  render?: (ctx: AppContext) => void;
  budgetLines?: (ctx: BaseContext) => BudgetLine[] | null | undefined;
}

export type AppEvent = "save" | "render";

export interface AppUtil {
  /** querySelector for elements the page is known to contain. */
  $<E extends Element = HTMLElement>(sel: string, el?: ParentNode): E;
  $$<E extends Element = HTMLElement>(sel: string, el?: ParentNode): E[];
  money(n: number): string;
  usd0: Intl.NumberFormat;
  pct(n: number, digits?: number): string;
  esc(s: unknown): string;
  parseNum(v: unknown): number;
  uid(): string;
  options(list: [string | number, string][], selected?: string | number | null): string;
  /** Falls back to "Other" for a missing or unknown id. */
  category(id: string | null | undefined): Category;
  annualOf(item: { amount: number; recurrence: Period }): number;
  ordinal(n: number): string;
  clampDay(v: unknown): number | null;
  CATEGORIES: Category[];
  RECURRENCES: Period[];
  VIEW_PERIODS: Period[];
  PERIODS: Record<Period, PeriodInfo>;
  PAY_PERIODS: PayPeriod[];
  ICONS: Record<"edit" | "del" | "ok" | "x" | "arrow", string>;
}

export interface AppApi {
  register<S>(mod: AppModule<S>): void;
  state(): AppState;
  commit(): void;
  render(): void;
  replaceState(data: unknown, opts?: { markDirty?: boolean }): void;
  on(event: "save", fn: (state: AppState) => void): void;
  on(event: "render", fn: (ctx: AppContext) => void): void;
  context(): AppContext;
  switchTab(tab: string, opts?: { focus?: boolean }): void;
  showToast(text: string, onUndo?: (() => void) | null): void;
  util: AppUtil;
}
