/**
 * Types for bonus.ts: the bonus and overtime estimates and the card's saved inputs.
 * Type-only: nothing here exists at runtime.
 */
import type { TaxInput } from "../tax/types";

export interface BonusInput {
  /** Tax.calculate input for regular pay (annual) */
  taxInput: TaxInput;
  /** gross bonus */
  amount: number;
  /** the plan takes the 401(k) % from bonuses too (default true) */
  apply401k?: boolean;
  /** Social Security / Medicare wages already paid this year */
  ytdWages?: number;
  /** supplemental wages already paid this year (for the $1M tier) */
  priorSupplemental?: number;
}

/**
 * Tax the bonus really costs at year end: the return with the bonus minus the return without it.
 * `michigan` and `city` are the state and local tax (older names).
 */
export interface BonusActual {
  federal: number;
  michigan: number;
  city: number;
  socialSecurity: number;
  medicare: number;
}

/** A bonus paid on its own supplemental-wage check. */
export interface BonusResult {
  amount: number;
  k401: number;
  isRoth: boolean;
  /** the bonus less a traditional 401(k) deferral: what income tax is withheld on */
  incomeWages: number;
  federal: number;
  socialSecurity: number;
  medicare: number;
  /** state withholding at the state's supplemental rate (older name) */
  michigan: number;
  /** local tax (older name) */
  city: number;
  cityRate: number;
  /** state payroll deductions (SDI, paid leave, ...) */
  payroll: number;
  stateName: string;
  stateRate: number;
  localName: string;
  federalRate: number;
  withheld: number;
  net: number;
  actual: BonusActual;
  /** income tax withheld on the bonus vs. owed on it; balance > 0 means a refund */
  yearEnd: { withheld: number; actual: number; balance: number };
}

export interface OvertimeInput {
  taxInput: TaxInput;
  /** paychecks per year (default 26) */
  perYear: number;
  hourlyRate: number;
  hoursPerPaycheck: number;
  /** default 1.5 */
  multiplier?: number;
}

/** TaxResult amounts the overtime estimate reports the change in. */
export type OvertimeTaxKey = "k401" | "federal" | "socialSecurity" | "medicare" | "michigan" | "city" | "payroll";
/** Change caused by the overtime; takeHome counts extra withholding as take-home. */
export type OvertimeAmounts = Record<OvertimeTaxKey | "takeHome", number>;

export interface OvertimeResult {
  hourlyRate: number;
  overtimeRate: number;
  hours: number;
  perYear: number;
  payPerCheck: number;
  payAnnual: number;
  premiumAnnual: number;
  annual: OvertimeAmounts;
  perCheck: OvertimeAmounts;
  /** false for married filing separately, which can't take the overtime deduction */
  eligible: boolean;
  cap: number;
  deduction: number;
  limitedBy: "mfs" | "phaseout" | "cap" | null;
  federalSaving: number;
  michiganSaving: number;
  refund: number;
  stateName: string;
  localName: string;
}

export interface HourlyRate {
  rate: number;
  /** true when converted from a salary at 2,080 hours a year */
  estimated: boolean;
}

/** The card's inputs, kept in localStorage (this browser only). Amounts stay as typed. */
export interface BonusPrefs {
  mode: "bonus" | "overtime";
  amount: string;
  ytd: string;
  apply401k: boolean;
  otHours: string;
}

/** The BonusPrefs fields that hold a typed amount. */
export type BonusNumKey = "amount" | "ytd" | "otHours";
