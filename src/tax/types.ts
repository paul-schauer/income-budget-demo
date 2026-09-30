/**
 * Types for the tax engines: src/tax/tax.ts (household, federal, FICA) and src/tax/state-tax.ts
 * (state + local), and for the payday schedule in src/lib/schedule.ts.
 * Type-only: nothing here exists at runtime. TaxApi, StateTaxApi and ScheduleApi describe each
 * module's exports (what `import * as Tax from "../tax/tax"` and the like give you).
 */

export type FilingStatus = "single" | "mfj" | "mfs" | "hoh";
/** [upper bound of the bracket (Infinity for the last), rate] */
export type Bracket = [number, number];
export type Brackets = Bracket[];
export type ByStatus<T> = Record<FilingStatus, T>;
export type PayPeriod = "weekly" | "biweekly" | "semimonthly" | "monthly";
export type Period = PayPeriod | "quarterly" | "annual";
export type IncomeType = "w2" | "self" | "taxable" | "nontaxable";

export interface PeriodInfo { label: string; perYear: number; noun: string }

// ---------------------------------------------------------------- state engine

export type LocalType =
  | "mi-city"
  | "rate-on-wages"
  | "rate-on-state-taxable"
  | "brackets-on-state-taxable"
  | "percent-of-state-tax";

export interface StateLocal {
  id: string;
  name: string;
  type: LocalType;
  resident?: number;
  nonresident?: number;
  rate?: number;
  /** per-person exemption, for "mi-city" */
  exemption?: number;
  brackets?: ByStatus<Brackets>;
}

export interface StatePayroll {
  id: string;
  name: string;
  rate: number;
  wageCap?: number | null;
  maxAnnual?: number | null;
}

export interface LocalChoice {
  id?: string;
  resident?: boolean;
  /** percent, for id "custom" */
  customRate?: number;
}

export interface StateEarner { wages: number; k401Trad: number }

/** What the household engine passes to StateTax.compute(). */
export interface StateContext {
  status: FilingStatus | string;
  filers: number;
  dependents: number;
  earners: StateEarner[];
  agi: number;
  federalTaxable: number;
  federalStandardDeduction: number;
  overtimeDeduction?: number;
  /** household federal income tax after credits (no FICA or SE tax) */
  federalTax?: number;
  local?: LocalChoice;
}

/** What a state's compute() override receives: the context, normalized, plus the generic base. */
export interface StateComputeContext extends StateContext {
  status: FilingStatus;
  filers: 1 | 2;
  dependents: number;
  base: number;
  standardDeduction: number;
}

export interface StateTaxAmount { taxable: number; tax: number }

export interface StateEntry {
  code: string;
  name: string;
  year: 2026;
  kind: "none" | "flat" | "graduated";
  rate?: number;
  brackets?: ByStatus<Brackets>;
  startsFrom?: "agi" | "federalTaxable";
  standardDeduction?: ByStatus<number> | "federal" | 0 | null;
  personalExemption?: { filer?: number; dependent?: number };
  exemptionCredit?: { filer?: number; dependent?: number };
  taxes401k?: boolean;
  overtimeDeduction?: boolean;
  supplementalRate?: number;
  payroll?: StatePayroll[];
  locals?: StateLocal[];
  compute?: (ctx: StateComputeContext, generic: StateTaxAmount) => { taxable?: number; tax: number } | null | undefined | void;
  notes?: string[];
  unverified?: boolean;
  sources: string[];
}

export type StateTable = Record<string, StateEntry>;

export interface LocalResult { id: string; name: string; tax: number; rate: number | null }
export interface PayrollAmount { id: string; name: string; amount: number }

export interface StateResult {
  code: string;
  name: string;
  kind: StateEntry["kind"];
  taxable: number;
  tax: number;
  local: LocalResult;
  /** per earner */
  payroll: PayrollAmount[][];
  payrollTotal: number;
  marginalRate: number;
  supplementalRate: number;
  overtimeDeduction?: boolean;
  unverified?: boolean;
  notes: string[];
}

export interface StateTaxApi {
  STATUSES: FilingStatus[];
  register(entries: StateTable): void;
  get(code: string): StateEntry | null;
  list(): { code: string; name: string }[];
  compute(code: string, ctx: StateContext): StateResult;
  incomeTax(d: StateEntry, ctx: StateContext): { base: number; taxable: number; tax: number };
  computeLocal(d: Partial<StateEntry>, local: LocalChoice | undefined, wages: number, stateTaxable: number, ctx: StateContext, stateTax?: number): LocalResult;
  payrollFor(d: Partial<StateEntry>, wages: number): PayrollAmount[];
  bracketTax(taxable: number, brackets: Brackets): number;
  validate(d: unknown): string[];
}

// ---------------------------------------------------------------- household engine

export interface EarnerInput {
  grossAnnual?: number;
  k401Percent?: number;
  k401Type?: "traditional" | "roth" | string;
  k401Annual?: number | string | null;
  age?: number;
  preTaxBenefits?: number;
  extraWithholdingAnnual?: number;
  overtimePremium?: number;
}

export interface OtherIncomeInput {
  type?: IncomeType | string;
  annual?: number;
  owner?: "you" | "spouse" | string;
}

/** Input to Tax.calculate(). Your own pay is at the top level. */
export interface TaxInput extends EarnerInput {
  filingStatus?: FilingStatus | string;
  dependents?: number;
  otherDependents?: number;
  /** two-letter code; "" = none chosen; omitted = Michigan (older callers) */
  state?: string;
  local?: LocalChoice;
  /** older callers: a Michigan city */
  cityId?: string;
  cityResident?: boolean;
  spouse?: EarnerInput | null;
  otherIncome?: (OtherIncomeInput | null | undefined)[];
}

/** One earner's paycheck view. */
export interface Person {
  role: "you" | "spouse";
  gross: number;
  benefits: number;
  k401: number;
  k401Capped: boolean;
  k401Limit: number;
  isRoth: boolean;
  federal: number;
  state: number;
  local: number;
  incomeTax: number;
  socialSecurity: number;
  medicare: number;
  payroll: number;
  taxes: number;
  extraWithholding: number;
  net: number;
}

export interface Extras {
  gross: number;
  taxable: number;
  nontaxable: number;
  selfEmployment: number;
  seTax: number;
  tax: number;
  net: number;
  setAside: number;
}

/** Result of Tax.calculate(). Top-level amounts are annual household totals. */
export interface TaxResult {
  gross: number;
  wages: number;
  benefits: number;
  k401: number;
  federal: number;
  socialSecurity: number;
  medicare: number;
  seTax: number;
  stateTax: number;
  localTax: number;
  payroll: number;
  payrollItems: PayrollAmount[];
  taxes: number;
  extraWithholding: number;
  net: number;
  effectiveRate: number;
  agi: number;
  federalTaxable: number;
  federalWages: number;
  ficaWages: number;
  federalMarginal: number;
  childCredit: number;
  overtimeDeduction: number;
  qbiDeduction: number;
  state: {
    code: string; name: string; kind: StateEntry["kind"]; taxable: number;
    marginalRate: number; supplementalRate: number; overtimeDeduction: boolean; unverified: boolean; notes: string[];
  };
  local: { id: string; name: string; rate: number | null; tax: number };
  people: Person[];
  extras: Extras;
  isRoth: boolean;
  k401Capped: boolean;
  k401Limit: number;
  /** older names for the state and local tax */
  michigan: number;
  michiganTaxable: number;
  city: number;
  cityRate: number;
  cityTaxable: number;
}

export interface City { id: string; name: string; resident: number; nonresident: number; exemption: number }

export interface TaxApi {
  TAX_YEAR: number;
  FEDERAL: {
    standardDeduction: ByStatus<number>;
    brackets: ByStatus<Brackets>;
    childTaxCredit: number;
    childTaxCreditRefundable: number;
    otherDependentCredit: number;
    childTaxCreditPhaseoutStart: ByStatus<number>;
    childTaxCreditPhaseoutPer1000: number;
    k401Limit: number;
    k401CatchUp: number;
    k401CatchUp60to63: number;
    supplementalRate: number;
    supplementalRateOver1M: number;
    supplementalMandatoryThreshold: number;
    overtime: { cap: ByStatus<number>; phaseoutStart: ByStatus<number>; phaseoutPer1000: number; firstYear: number; lastYear: number };
    qbi: { rate: number; threshold: ByStatus<number>; phaseIn: ByStatus<number>; minimum: number; minimumQbi: number };
  };
  FICA: {
    socialSecurityRate: number;
    socialSecurityWageBase: number;
    medicareRate: number;
    additionalMedicareRate: number;
    selfEmploymentFactor: number;
    selfEmploymentSocialSecurityRate: number;
    selfEmploymentMedicareRate: number;
    additionalMedicareThreshold: ByStatus<number>;
    additionalMedicareWithholdingThreshold: number;
  };
  MICHIGAN: { rate: number; personalExemption: number; supplementalRate: number; overtimeDeduction: boolean };
  CITIES: City[];
  FILING_STATUSES: { id: FilingStatus; name: string }[];
  PERIODS: Record<Period, PeriodInfo>;
  PAY_PERIODS: PayPeriod[];
  INCOME_TYPES: IncomeType[];
  calculate(input: TaxInput): TaxResult;
  raiseImpact(input: TaxInput, amount: number): number;
  convert(amount: number, fromPeriod: Period, toPeriod: Period): number;
  bracketTax(taxable: number, brackets: Brackets): number;
  findCity(id: string): City;
  k401LimitFor(age: unknown): number;
  overtimeDeduction(premium: number, filingStatus: string, magi: number): number;
  qbiDeduction(qbi: number, taxableBeforeQbi: number, filingStatus: string): number;
  supplementalFederalWithholding(amount: number, priorSupplemental?: number): number;
}

// ---------------------------------------------------------------- payday schedule

export interface ScheduleApi {
  parse(iso: string | null | undefined): Date | null;
  fmt(d: Date): string;
  addDays(iso: string, n: number): string;
  daysBetween(aIso: string, bIso: string): number;
  todayISO(now?: Date): string;
  daysInMonth(y: number, m: number): number;
  onDay(y: number, m: number, day: number): string;
  prevBusinessDay(iso: string): string;
  paydays(anchorIso: string | null | undefined, payPeriod: string, fromIso: string, count: number): string[];
  countPaydays(anchorIso: string | null | undefined, payPeriod: string, fromIso: string, toIso: string): number;
}
