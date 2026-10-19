/**
 * Types for compare.ts: comparing your take-home at another salary, everything else the same.
 * Type-only: nothing here exists at runtime.
 */
import type { TaxInput, TaxResult } from "../tax/types";

export interface CompareInput {
  /** Tax.calculate input for your current pay (annual) */
  taxInput: TaxInput;
  /** your gross pay to compare with, annual */
  grossAnnual: number;
}

/** Household totals that change with your pay, as other - current (annual). */
export interface CompareChange {
  /** your gross pay */
  pay: number;
  benefits: number;
  k401: number;
  taxes: number;
  /** take-home pay */
  net: number;
}

export interface CompareResult {
  /** Tax.calculate at your current pay */
  now: TaxResult;
  /** Tax.calculate at the other pay */
  next: TaxResult;
  change: CompareChange;
  /** share of the change in pay that reaches take-home; null when the pay is the same */
  kept: number | null;
  /** your 401(k) hits the annual limit at the other pay but not now */
  k401CapReached: boolean;
  /** child and dependent credits lost (or gained, if negative) to the income phase-out */
  creditsLost: number;
}

/** The card's inputs, kept in localStorage (this browser only). Amounts stay as typed. */
export interface ComparePrefs {
  /** "" follows your own pay type */
  mode: "" | "salary" | "hourly";
  salary: string;
  hourlyRate: string;
  hours: string;
  period: "paycheck" | "month" | "year";
}

/** The ComparePrefs fields that hold a typed amount. */
export type CompareNumKey = "salary" | "hourlyRate" | "hours";
