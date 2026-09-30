/**
 * Types for the Calendar (js/calendar.js) and Goals (js/goals.js) modules.
 * Type-only: nothing here exists at runtime. Dates are ISO strings ("YYYY-MM-DD").
 */
import type { BudgetItem, BudgetLine, CategoryId, Income, Tab } from "./app";
import type { PayPeriod, Period } from "./tax";

// ---------------------------------------------------------------- calendar

/** Input to PayCalendar.plan(). Everything is optional and checked at runtime. */
export interface PlanInput {
  items?: BudgetItem[] | null;
  /** read-only budget lines from other modules (e.g. savings goals) */
  extras?: BudgetLine[] | null;
  income?: Partial<Pick<Income, "payPeriod" | "nextPayday">> | null;
  /** take-home per paycheck */
  netPerPaycheck?: number;
  /** defaults to today */
  today?: string;
  /** paychecks to plan (default: about three months, see HORIZON) */
  count?: number;
}

/** One due date of a dated bill (a monthly item with a due day). */
export interface BillOccurrence {
  /** index of the item in the items list */
  index: number;
  id: string;
  name: string;
  category: CategoryId;
  amount: number;
  dueDay: number;
  /** the due day, clamped to the month's length */
  due: string;
}

/** A budget item without a due date, spread evenly across paychecks. */
export interface SpreadItem {
  kind: "item";
  index: number;
  id: string;
  name: string;
  category: CategoryId;
  recurrence: Period;
  amount: number;
  annual: number;
  perPaycheck: number;
  /** a monthly bill that only lacks a due day */
  noDueDay: boolean;
}

/** A read-only budget line from another module, spread evenly across paychecks. */
export interface SpreadExtra {
  kind: "extra";
  id: string | undefined;
  source: string | undefined;
  name: string;
  category: CategoryId | undefined;
  note: string | undefined;
  tab: Tab | undefined;
  annual: number;
  perPaycheck: number;
  noDueDay: false;
}

export type SpreadLine = SpreadItem | SpreadExtra;

export interface Paycheck {
  index: number;
  /** payday */
  date: string;
  /** last day this paycheck covers: the day before the next payday */
  end: string;
  net: number;
  bills: BillOccurrence[];
  billsTotal: number;
  spreadTotal: number;
  /** bills + spread */
  total: number;
  left: number;
  over: boolean;
  tight: boolean;
}

/** Result of PayCalendar.plan(). */
export interface CalendarPlan {
  today: string;
  payPeriod: PayPeriod;
  perYear: number;
  net: number;
  count: number;
  /** no known payday: the dates follow the default schedule */
  estimated: boolean;
  /** payday anchor for other date ranges ("" = Schedule's default) */
  anchor: string;
  /** last day covered by the last planned paycheck */
  horizonEnd: string;
  paychecks: Paycheck[];
  /** dated bills due between today and the first payday */
  beforeFirst: BillOccurrence[];
  spread: SpreadLine[];
  spreadTotal: number;
  /** spread lines that are monthly bills without a due day */
  undated: SpreadLine[];
  avgLeft: number;
  tightest: Paycheck;
  daysUntilNext: number;
}

/** Result of PayCalendar.suggestMove(): move one bill's due day to even out paychecks. */
export interface MoveSuggestion {
  index: number;
  id: string;
  name: string;
  amount: number;
  fromDay: number;
  toDay: number;
  /** the tightest paycheck's payday */
  date: string;
  before: number;
  after: number;
  gain: number;
}

export interface MonthInput {
  items?: BudgetItem[] | null;
  payPeriod: PayPeriod | string;
  anchor?: string | null;
  year: number;
  /** 0-11 */
  month: number;
}

export interface MonthDay {
  iso: string;
  day: number;
  /** 0 = Sunday */
  dow: number;
  payday: boolean;
  bills: BillOccurrence[];
}

/** Result of PayCalendar.month(). */
export interface MonthGrid {
  year: number;
  month: number;
  /** weekday of the 1st (0 = Sunday), for blank cells before it */
  lead: number;
  days: MonthDay[];
}

export interface CalendarApi {
  HORIZON: Record<PayPeriod, number>;
  plan(o?: PlanInput): CalendarPlan;
  occurrences(items: BudgetItem[] | null | undefined, fromIso: string, toIso: string): BillOccurrence[];
  flagTight<T extends { left: number; tight?: boolean }>(paychecks: T[], net?: number): T[];
  suggestMove(o?: PlanInput, base?: CalendarPlan): MoveSuggestion | null;
  payingPayday(anchor: string | null | undefined, payPeriod: string, iso: string): string | null;
  month(input: MonthInput): MonthGrid;
  isDated(item: BudgetItem | null | undefined): boolean;
}

// ---------------------------------------------------------------- goals

export type GoalMode = "date" | "amount";

/** A savings goal, as stored in state.goals (after Goals.sanitize()). */
export interface Goal {
  id: string;
  name: string;
  target: number;
  saved: number;
  /** "date": reach target by targetDate; "amount": save perPaycheck each payday */
  mode: GoalMode;
  /** "" = none */
  targetDate: string;
  perPaycheck: number;
  includeInBudget: boolean;
  /** ms since the epoch, 0 = unknown */
  createdAt: number;
}

/** A goal from storage, an import or the server, before sanitize(). */
export type GoalInput = { [K in keyof Goal]?: unknown };

/** A goal being added or edited, before it gets an id. */
export type GoalDraft = Omit<Goal, "id" | "createdAt">;

/** A payday schedule. */
export interface GoalSchedule {
  /** the user's next payday ("" = Schedule's default) */
  anchor: string;
  payPeriod: PayPeriod;
  today: string;
  perYear: number;
}

/** What callers pass as a schedule; normalized with defaults. */
export interface GoalScheduleInput {
  anchor?: string | null;
  payPeriod?: PayPeriod | string;
  today?: string;
  perYear?: number;
}

export type GoalStatus = "active" | "complete" | "overdue" | "unset";

interface GoalPlanBase {
  remaining: number;
  /** 0-1 */
  progress: number;
  /** "overdue" because the target date has passed */
  pastDate: boolean;
  /** amount mode: more than MAX_YEARS away */
  tooFar: boolean;
}

/** A goal that still needs money on a schedule. */
export interface ActiveGoalPlan extends GoalPlanBase {
  status: "active";
  perPaycheck: number;
  paychecksLeft: number;
  monthly: number;
  /** amount mode: the projected payday (null when tooFar, and in date mode) */
  finishDate: string | null;
}

/** complete: saved >= target; overdue: date mode, date passed or no paydays left; unset: no date / amount yet. */
export interface IdleGoalPlan extends GoalPlanBase {
  status: "complete" | "overdue" | "unset";
  perPaycheck: null;
  paychecksLeft: null;
  monthly: null;
  finishDate: null;
}

/** Result of Goals.plan(). */
export type GoalPlan = ActiveGoalPlan | IdleGoalPlan;

/** The object Goals' planWith() fills in before returning it as a GoalPlan. */
export interface GoalPlanFields extends GoalPlanBase {
  status: GoalStatus;
  perPaycheck: number | null;
  paychecksLeft: number | null;
  monthly: number | null;
  finishDate: string | null;
}

/** Result of Goals.summarize(). */
export interface GoalSummary {
  saved: number;
  target: number;
  progress: number;
  /** every active goal */
  perPaycheck: number;
  /** active goals in the budget */
  budgeted: number;
  monthly: number;
  counts: Record<GoalStatus, number>;
  /** by goal id */
  plans: Map<string, GoalPlan>;
}

export interface GoalTemplate {
  key: "emergency" | "vacation" | "car" | "holiday";
  name: string;
  target: number;
  mode: "date";
  targetDate: string;
  note: string;
}

export interface GoalTemplateOptions {
  itemsAnnual?: number;
  today: string;
}

/** A goal's budget row (a BudgetLine with every field set). */
export interface GoalBudgetLine extends BudgetLine {
  id: string;
  category: "savings";
  tab: "goals";
  note: string;
}

export interface GoalsApi {
  MODES: GoalMode[];
  MAX_GOALS: number;
  MAX_AMOUNT: number;
  MAX_YEARS: number;
  isISODate(s: unknown): s is string;
  addMonths(iso: string, n: number): string;
  sanitize(raw: unknown): Goal[];
  plan(goal: Partial<Goal> | null | undefined, sched?: GoalScheduleInput | null): GoalPlan;
  summarize(goals: Goal[] | null | undefined, sched?: GoalScheduleInput | null): GoalSummary;
  budgetLines(goals: Goal[] | null | undefined, sched?: GoalScheduleInput | null): GoalBudgetLine[];
  templates(opts?: GoalTemplateOptions): GoalTemplate[];
  emergencyFundTarget(itemsAnnual: number): number;
  holidayDate(today: string): string;
}

/** The Goals form's elements (built once by the tab's skeleton). */
export interface GoalFormEls {
  card: HTMLElement;
  form: HTMLFormElement;
  title: HTMLElement;
  submit: HTMLButtonElement;
  name: HTMLInputElement;
  target: HTMLInputElement;
  saved: HTMLInputElement;
  date: HTMLInputElement;
  per: HTMLInputElement;
  include: HTMLButtonElement;
  preview: HTMLElement;
}

declare global {
  interface Window {
    PayCalendar: CalendarApi;
    Goals: GoalsApi;
  }
  var PayCalendar: CalendarApi;
  var Goals: GoalsApi;
}
