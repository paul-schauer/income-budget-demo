/*
 * State tax data: states with no wage income tax, and flat-rate states (tax year 2026).
 * Schema: see STATE_SCHEMA in src/tax/state-tax.ts. Sources and a confidence flag for each figure are in
 * docs/state-tax-sources/no-tax-flat.md.
 */
import type { StateEntry, StateTable } from "../types";

const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

// 2026 Social Security wage base; WA PFML, CO FAMLI and MA PFML premiums stop at it.
const SS_WAGE_BASE_2026 = 184500;

const TAX_FOUNDATION_2026 = "https://taxfoundation.org/data/all/state/state-income-tax-rates-2026/";

/** A state with no tax on wages. */
const noTax = (code: string, name: string, extra: Partial<StateEntry> = {}): StateEntry => ({
  code, name, year: 2026, kind: "none", payroll: [], locals: [], notes: [], sources: [TAX_FOUNDATION_2026], ...extra,
});

export const STATES: StateTable = {
  // ---------------- No income tax on wages ----------------
  AK: noTax("AK", "Alaska", {
    // One of the few states where employees pay unemployment insurance: 0.5% of wages up to $54,200 (2026).
    payroll: [{ id: "ak-ui", name: "Alaska unemployment insurance", rate: 0.005, wageCap: 54200 }],
    sources: [
      "https://labor.alaska.gov/estax/2026-experience-rates.html",
      "https://www.labor.alaska.gov/estax/faq/w1.htm",
      TAX_FOUNDATION_2026,
    ],
  }),
  FL: noTax("FL", "Florida"),
  NV: noTax("NV", "Nevada"),
  // The interest and dividends tax was repealed for 2025 and later; wages were never taxed.
  NH: noTax("NH", "New Hampshire"),
  SD: noTax("SD", "South Dakota"),
  TN: noTax("TN", "Tennessee"),
  TX: noTax("TX", "Texas"),
  WA: noTax("WA", "Washington", {
    payroll: [
      // Paid Family & Medical Leave: 1.13% total premium in 2026; employees pay up to 71.43% of it, up to the SS wage base.
      { id: "wa-pfml", name: "WA Paid Family & Medical Leave", rate: 0.0113 * 0.7143, wageCap: SS_WAGE_BASE_2026 },
      // WA Cares Fund (long-term care): 0.58% of all wages, no cap.
      { id: "wa-cares", name: "WA Cares long-term care", rate: 0.0058 },
    ],
    notes: [
      "WA Cares doesn't apply if you have an approved exemption.",
      "Employees also pay part of L&I workers' comp (an hourly amount that varies by job); not included.",
    ],
    sources: [
      "https://esd.wa.gov/about-us/news-release/2025/paid-family-medical-leave-premium-rate-increases-113-2026",
      "https://paidleave.wa.gov/employer-roles-responsibilities/",
      "https://wacaresfund.wa.gov/employers",
      "https://wacaresfund.wa.gov/help-support/frequently-asked-questions",
    ],
  }),
  WY: noTax("WY", "Wyoming"),

  // ---------------- Flat-rate states ----------------
  AZ: {
    code: "AZ",
    name: "Arizona",
    year: 2026,
    kind: "flat",
    rate: 0.025,
    startsFrom: "agi",
    // Arizona's standard deduction equals the federal one (IRC conformity as of Jan 1, 2026, HB 4168).
    standardDeduction: "federal",
    // Dependent credit: $125 per dependent under 17 in 2026 ($25 for older dependents).
    exemptionCredit: { filer: 0, dependent: 125 },
    taxes401k: false,
    overtimeDeduction: true, // HB 4168 (2026): subtraction for the federal tips and overtime deductions, 2025 onward
    payroll: [],
    locals: [],
    // The dependent credit shrinks 5% for each $1,000 (or part) of federal AGI over $200,000 ($400,000 joint).
    compute(ctx, generic) {
      const over = Math.max(0, n(ctx.agi) - (ctx.status === "mfj" ? 400000 : 200000));
      const keep = Math.max(0, 1 - 0.05 * Math.ceil(over / 1000));
      return { taxable: generic.taxable, tax: Math.max(0, generic.taxable * 0.025 - 125 * ctx.dependents * keep) };
    },
    notes: [],
    sources: [
      "https://www.azleg.gov/legtext/57leg/2R/bills/HB4168H.pdf",
      "https://www.azleg.gov/legtext/57leg/2R/summary/H.HB4168_061026_CAUCUSCOW.DOCX.htm",
      "https://www.forvismazars.us/forsights/2026/07/arizona-updates-irc-conformity-date-to-january-1-2026",
      "https://azdor.gov/sites/default/files/document/FORMS_INDIVIDUAL_2025_140i.pdf",
      "https://azdor.gov/sites/default/files/document/FORMS_WITHHOLDING_2026_A-4_f.pdf",
    ],
  },

  CO: {
    code: "CO",
    name: "Colorado",
    year: 2026,
    kind: "flat",
    rate: 0.044, // no TABOR temporary rate cut for 2026 (Legislative Council, Sept 2026 forecast)
    startsFrom: "federalTaxable",
    standardDeduction: 0,
    taxes401k: false,
    // Colorado starts from federal taxable income but adds the federal overtime deduction back for 2026 (HB25-1296).
    overtimeDeduction: false,
    payroll: [{ id: "co-famli", name: "Colorado FAMLI", rate: 0.0044, wageCap: SS_WAGE_BASE_2026 }],
    locals: [],
    compute(ctx) {
      let taxable = n(ctx.base) + n(ctx.overtimeDeduction);
      // AGI over $300,000: the federal standard deduction above $1,000 ($2,000 joint) is added back (2026+).
      if (n(ctx.agi) > 300000) taxable += Math.max(0, n(ctx.federalStandardDeduction) - (ctx.status === "mfj" ? 2000 : 1000));
      return { taxable, tax: taxable * 0.044 };
    },
    notes: ["Denver ($5.75/month) and a few other cities charge a flat occupational privilege tax; not included."],
    sources: [
      "https://tax.colorado.gov/individual-income-tax-guide",
      "https://content.leg.colorado.gov/sites/default/files/sept2026-forecast-with-cover-for-remediation-and-posting-accessible_0.pdf",
      "https://content.leg.colorado.gov/sites/default/files/2025a_1296_signed.pdf",
      "https://tax.colorado.gov/january-2026-tax-policy-updates",
      "https://tax.colorado.gov/DR1098",
      "https://famli.colorado.gov/employers",
    ],
  },

  GA: {
    code: "GA",
    name: "Georgia",
    year: 2026,
    kind: "flat",
    rate: 0.0499, // HB 463 (2026): 5.19% -> 4.99% for tax year 2026
    startsFrom: "agi",
    standardDeduction: { single: 15000, mfj: 30000, mfs: 15000, hoh: 15000 },
    personalExemption: { filer: 0, dependent: 5000 },
    taxes401k: false,
    // HB 463: up to $1,750 of overtime per full-time hourly worker is excluded for 2026-2028 (capped in compute).
    overtimeDeduction: true,
    supplementalRate: 0.0499,
    payroll: [],
    locals: [],
    compute(ctx) {
      const ot = n(ctx.overtimeDeduction);
      const excluded = Math.min(ot, 1750 * ctx.filers);
      const taxable = Math.max(0, n(ctx.base) + ot - excluded - ctx.standardDeduction - 5000 * ctx.dependents);
      return { taxable, tax: taxable * 0.0499 };
    },
    notes: [],
    sources: [
      "https://gov.georgia.gov/document/2026-signed-legislation/hb-463/download",
      "https://gov.georgia.gov/press-releases/2026-05-11/gov-kemp-signs-legislation-lowering-taxes-and-supporting-economic-growth",
      "https://dor.georgia.gov/document/document-document/2026-employers-tax-guide-updated-june-2026/download",
      "https://dor.georgia.gov/taxes/important-tax-updates",
    ],
  },

  // Idaho taxes the first $4,811 ($9,622 joint / head of household) of taxable income at 0% and the rest at 5.3%.
  // The thresholds are the 2025 figures (indexed yearly; the 2026 amounts are not confirmed).
  ID: {
    code: "ID",
    name: "Idaho",
    year: 2026,
    kind: "graduated",
    brackets: {
      single: [[4811, 0], [Infinity, 0.053]],
      mfj: [[9622, 0], [Infinity, 0.053]],
      mfs: [[4811, 0], [Infinity, 0.053]],
      hoh: [[9622, 0], [Infinity, 0.053]],
    },
    // Idaho taxable income = federal AGI less the federal standard deduction and the Schedule 1-A deductions.
    startsFrom: "federalTaxable",
    standardDeduction: 0,
    exemptionCredit: { filer: 0, dependent: 205 }, // child tax credit per qualifying child
    taxes401k: false,
    overtimeDeduction: true, // Idaho's 2026 conformity law keeps the federal tips/overtime deductions (2025-2028)
    payroll: [],
    locals: [],
    notes: [],
    sources: [
      "https://tax.idaho.gov/taxes/income-tax/individual-income/individual-income-tax-rate-schedule/",
      "https://legislature.idaho.gov/sessioninfo/2025/legislation/H0040/",
      "https://tax.idaho.gov/wp-content/uploads/forms/EIN00046/EIN00046_09-29-2025.pdf",
      "https://tax.idaho.gov/pressrelease/update-on-filing-2025-idaho-income-taxes-now-that-conformity-is-law/",
    ],
  },

  IL: {
    code: "IL",
    name: "Illinois",
    year: 2026,
    kind: "flat",
    rate: 0.0495,
    startsFrom: "agi",
    standardDeduction: 0,
    personalExemption: { filer: 2850, dependent: 2850 }, // 2025 amount; the 2026 inflation-adjusted amount is not confirmed
    taxes401k: false,
    overtimeDeduction: false,
    payroll: [],
    locals: [],
    // No exemptions at all once federal AGI is over $250,000 ($500,000 joint).
    compute(ctx, generic) {
      if (n(ctx.agi) <= (ctx.status === "mfj" ? 500000 : 250000)) return generic;
      return { taxable: n(ctx.base), tax: n(ctx.base) * 0.0495 };
    },
    notes: [],
    sources: [
      "https://tax.illinois.gov/content/dam/soi/en/web/tax/forms/incometax/documents/currentyear/individual/il-1040-instr.pdf",
      "https://www2.illinois.gov/rev/research/taxrates/Pages/income.aspx",
      "https://www.ilga.gov/legislation/ilcs/ilcs5.asp?ActID=577&ChapterID=8",
    ],
  },

  IN: {
    code: "IN",
    name: "Indiana",
    year: 2026,
    kind: "flat",
    rate: 0.0295, // IC 6-3-2-1: 3.0% (2025) -> 2.95% (2026)
    startsFrom: "agi",
    standardDeduction: 0,
    // $1,000 per person, plus $1,500 more for each dependent child (other dependents get $1,000 only).
    personalExemption: { filer: 1000, dependent: 2500 },
    taxes401k: false,
    overtimeDeduction: true, // SB 243 (2026): Indiana deduction mirroring the federal overtime deduction, 2026 only
    payroll: [],
    // County income taxes are not listed: no 2026 county rate table from in.gov could be sourced.
    locals: [],
    notes: ["Every county adds its own income tax on Indiana AGI; enter your county's rate as Other local tax %."],
    sources: [
      "https://iga.in.gov/laws/2024/ic/titles/6#6-3-2-1",
      "https://iga.in.gov/laws/2024/ic/titles/6#6-3-1-3.5",
      "https://forms.in.gov/Download.aspx?id=16915",
      "https://iga.in.gov/laws/2024/ic/titles/6#6-3.6",
    ],
  },

  IA: {
    code: "IA",
    name: "Iowa",
    year: 2026,
    kind: "flat",
    rate: 0.038,
    // Since 2023 Iowa starts from federal taxable income (the federal standard deduction applies).
    startsFrom: "federalTaxable",
    standardDeduction: 0,
    exemptionCredit: { filer: 40, dependent: 40 },
    taxes401k: false,
    overtimeDeduction: true, // rolling IRC conformity: the federal deduction flows through federal taxable income
    payroll: [],
    locals: [],
    notes: ["Iowa school district surtax (a percentage of state tax) isn't included."],
    sources: [
      "https://revenue.iowa.gov/taxes/tax-guidance/individual-income-tax/1040-expanded-instructions/iowa-tax",
      "https://revenue.iowa.gov/taxes/tax-guidance/individual-income-tax/1040-expanded-instructions/iowa-taxable-income",
      "https://revenue.iowa.gov/press-release/2024-10-16/idr-announces-2025-individual-income-tax-brackets-and-interest-rates",
    ],
  },

  MA: {
    code: "MA",
    name: "Massachusetts",
    year: 2026,
    kind: "flat",
    rate: 0.05,
    startsFrom: "agi",
    standardDeduction: 0,
    // $4,400 per filer ($6,800 for head of household, handled in compute) and $1,000 per dependent.
    personalExemption: { filer: 4400, dependent: 1000 },
    taxes401k: false,
    overtimeDeduction: false,
    supplementalRate: 0.05,
    // PFML 2026: 0.88% total; employees pay up to all of the 0.18% family share and 40% of the 0.70% medical share.
    payroll: [{ id: "ma-pfml", name: "MA Paid Family & Medical Leave", rate: 0.0018 + 0.4 * 0.007, wageCap: SS_WAGE_BASE_2026 }],
    locals: [],
    compute(ctx) {
      const exemption = ctx.status === "hoh" ? 6800 : 4400 * ctx.filers;
      // Deduction for Social Security and Medicare withheld, up to $2,000 per earner.
      const fica = (ctx.earners || []).reduce((s, e) => s + Math.min(2000, n(e.wages) * 0.0765), 0);
      const taxable = Math.max(0, n(ctx.base) - exemption - 1000 * ctx.dependents - fica);
      // 4% surtax on taxable income over $1,107,750 (2026).
      return { taxable, tax: taxable * 0.05 + Math.max(0, taxable - 1107750) * 0.04 };
    },
    notes: ["The refundable Child and Family Tax Credit ($440 per child under 13) isn't included."],
    sources: [
      "https://www.mass.gov/info-details/massachusetts-4-surtax-on-taxable-income",
      "https://www.mass.gov/doc/2026-form-1-es-estimated-tax-payment-vouchers-instructions-and-worksheets/download",
      "https://www.mass.gov/doc/massachusetts-circular-m-income-tax-withholding-tables-at-50-effective-january-1-2026/download",
      "https://www.mass.gov/info-details/massachusetts-personal-income-tax-exemptions",
      "https://www.mass.gov/info-details/massachusetts-social-security-fica-and-medicare-deduction",
      "https://www.mass.gov/info-details/paid-family-and-medical-leave-employer-contribution-rates-and-calculator",
    ],
  },

  MI: {
    code: "MI",
    name: "Michigan",
    year: 2026,
    kind: "flat",
    rate: 0.0425,
    startsFrom: "agi",
    standardDeduction: 0,
    personalExemption: { filer: 5900, dependent: 5900 },
    taxes401k: false,
    overtimeDeduction: true, // 2025 PA 24: Michigan follows the federal overtime deduction for 2026-2028
    supplementalRate: 0.0425,
    payroll: [],
    // The 24 cities with an income tax (Uniform City Income Tax Ordinance). 401(k) deferrals stay taxable.
    locals: [
      { id: "albion", name: "Albion", type: "mi-city", resident: 0.01, nonresident: 0.005, exemption: 600 },
      { id: "battle-creek", name: "Battle Creek", type: "mi-city", resident: 0.01, nonresident: 0.005, exemption: 750 },
      { id: "benton-harbor", name: "Benton Harbor", type: "mi-city", resident: 0.01, nonresident: 0.005, exemption: 750 },
      { id: "big-rapids", name: "Big Rapids", type: "mi-city", resident: 0.01, nonresident: 0.005, exemption: 600 },
      { id: "detroit", name: "Detroit", type: "mi-city", resident: 0.024, nonresident: 0.012, exemption: 600 },
      { id: "east-lansing", name: "East Lansing", type: "mi-city", resident: 0.01, nonresident: 0.005, exemption: 600 },
      { id: "flint", name: "Flint", type: "mi-city", resident: 0.01, nonresident: 0.005, exemption: 600 },
      { id: "grand-rapids", name: "Grand Rapids", type: "mi-city", resident: 0.015, nonresident: 0.0075, exemption: 600 },
      { id: "grayling", name: "Grayling", type: "mi-city", resident: 0.01, nonresident: 0.005, exemption: 3000 },
      { id: "hamtramck", name: "Hamtramck", type: "mi-city", resident: 0.01, nonresident: 0.005, exemption: 600 },
      { id: "highland-park", name: "Highland Park", type: "mi-city", resident: 0.02, nonresident: 0.01, exemption: 600 },
      { id: "hudson", name: "Hudson", type: "mi-city", resident: 0.01, nonresident: 0.005, exemption: 1000 },
      { id: "ionia", name: "Ionia", type: "mi-city", resident: 0.01, nonresident: 0.005, exemption: 700 },
      { id: "jackson", name: "Jackson", type: "mi-city", resident: 0.01, nonresident: 0.005, exemption: 600 },
      { id: "lansing", name: "Lansing", type: "mi-city", resident: 0.01, nonresident: 0.005, exemption: 600 },
      { id: "lapeer", name: "Lapeer", type: "mi-city", resident: 0.01, nonresident: 0.005, exemption: 600 },
      { id: "muskegon", name: "Muskegon", type: "mi-city", resident: 0.01, nonresident: 0.005, exemption: 600 },
      { id: "muskegon-heights", name: "Muskegon Heights", type: "mi-city", resident: 0.01, nonresident: 0.005, exemption: 600 },
      { id: "pontiac", name: "Pontiac", type: "mi-city", resident: 0.01, nonresident: 0.005, exemption: 600 },
      { id: "port-huron", name: "Port Huron", type: "mi-city", resident: 0.01, nonresident: 0.005, exemption: 600 },
      { id: "portland", name: "Portland", type: "mi-city", resident: 0.01, nonresident: 0.005, exemption: 1000 },
      { id: "saginaw", name: "Saginaw", type: "mi-city", resident: 0.015, nonresident: 0.0075, exemption: 750 },
      { id: "springfield", name: "Springfield", type: "mi-city", resident: 0.01, nonresident: 0.005, exemption: 750 },
      { id: "walker", name: "Walker", type: "mi-city", resident: 0.01, nonresident: 0.005, exemption: 600 },
    ],
    notes: [],
    sources: [
      "https://www.michigan.gov/taxes/iit",
      "https://www.michigan.gov/taxes/citytax",
    ],
  },

  // Ohio 2026 (HB 96): 0% on the first $26,050 of taxable nonbusiness income; above that, $332 plus 2.75% of the
  // excess (so there is a small cliff at $26,050). Exemptions depend on MAGI, and a joint filing credit applies.
  // The brackets show the shape; compute applies the $332 base amount, exemptions and credits.
  OH: {
    code: "OH",
    name: "Ohio",
    year: 2026,
    kind: "graduated",
    brackets: {
      single: [[26050, 0], [Infinity, 0.0275]],
      mfj: [[26050, 0], [Infinity, 0.0275]],
      mfs: [[26050, 0], [Infinity, 0.0275]],
      hoh: [[26050, 0], [Infinity, 0.0275]],
    },
    startsFrom: "agi",
    standardDeduction: 0,
    taxes401k: false,
    overtimeDeduction: false,
    supplementalRate: 0.0275, // OAC 5703-7-10: the top rate in R.C. 5747.02(A)(3)
    payroll: [],
    // Municipal income tax on wages earned in the city; nonresidents who work there pay the same rate.
    locals: [
      { id: "columbus", name: "Columbus", type: "rate-on-wages", rate: 0.025 },
      { id: "cleveland", name: "Cleveland", type: "rate-on-wages", rate: 0.025 },
      { id: "cincinnati", name: "Cincinnati", type: "rate-on-wages", rate: 0.018 },
    ],
    compute(ctx) {
      const magi = n(ctx.agi);
      const people = ctx.filers + ctx.dependents;
      // Per-person exemption by MAGI; none above $500,000 from 2026.
      const each = magi > 500000 ? 0 : magi <= 40000 ? 2400 : magi <= 80000 ? 2150 : 1900;
      const taxable = Math.max(0, n(ctx.base) - each * people);
      let tax = taxable > 26050 ? 332 + (taxable - 26050) * 0.0275 : 0;
      if (magi < 30000) tax = Math.max(0, tax - 20 * people); // $20 exemption credit
      // Joint filing credit: both spouses with $500+ of income and MAGI under $500,000. A percentage of tax set by
      // income less exemptions (20% up to $25,000 ... 5% over $75,000), at most $650.
      const workers = (ctx.earners || []).filter((e) => n(e.wages) >= 500).length;
      if (ctx.status === "mfj" && workers >= 2 && magi < 500000) {
        const pct = taxable <= 25000 ? 0.2 : taxable <= 50000 ? 0.15 : taxable <= 75000 ? 0.1 : 0.05;
        tax -= Math.min(650, tax * pct);
      }
      return { taxable, tax };
    },
    notes: ["School district income tax isn't included; enter it as Other local tax %."],
    sources: [
      "https://www.lsc.ohio.gov/assets/legislation/136/hb96/en0/files/hb96-tax-bill-analysis-as-enacted-136th-general-assembly.pdf",
      "https://dam.assets.ohio.gov/image/upload/v1735926006/tax.ohio.gov/forms/ohio_individual/individual/2026/ites-instructions-fi.pdf",
      "https://dam.assets.ohio.gov/image/upload/v1767095693/tax.ohio.gov/forms/ohio_individual/individual/2025/it1040-booklet.pdf",
      "https://codes.ohio.gov/ohio-revised-code/section-5747.025",
      "https://codes.ohio.gov/ohio-revised-code/section-5747.05/9-30-2025",
      "https://codes.ohio.gov/ohio-administrative-code/rule-5703-7-10",
    ],
  },

  PA: {
    code: "PA",
    name: "Pennsylvania",
    year: 2026,
    kind: "flat",
    rate: 0.0307,
    startsFrom: "agi",
    standardDeduction: 0,
    taxes401k: true, // Pennsylvania taxes employee 401(k) deferrals when earned
    overtimeDeduction: false,
    supplementalRate: 0.0307,
    // Employee unemployment compensation withholding: 0.07% of all wages, no cap (2026).
    payroll: [{ id: "pa-uc", name: "PA unemployment compensation", rate: 0.0007 }],
    locals: [
      // Wage tax for pay dates from July 1, 2026 (3.74% / 3.43% before then).
      { id: "philadelphia", name: "Philadelphia", type: "rate-on-wages", resident: 0.03735, nonresident: 0.03425 },
      // Earned income tax: 1% city + 2% school district for residents; 1% for nonresidents who work in the city.
      { id: "pittsburgh", name: "Pittsburgh", type: "rate-on-wages", resident: 0.03, nonresident: 0.01 },
    ],
    notes: ["Most other municipalities levy a local earned income tax; enter it as Other local tax %."],
    sources: [
      "https://www.revenue.pa.gov/Tax%20Rates/Pages/default.aspx",
      "https://www.revenue.pa.gov/TaxTypes/PIT/Pages/default.aspx",
      "https://www.pa.gov/agencies/dli/resources/for-employers-and-educators/how-to-file/uc-tax/employee-withholding",
      "https://www.phila.gov/services/payments-assistance-taxes/taxes/business-taxes/business-taxes-by-type/wage-tax-employers/",
      "https://www.pittsburghpa.gov/City-Government/Finance-Budget/Taxes/Tax-FAQs",
      "https://dced.pa.gov/local-government/local-income-tax-information/psd-codes-and-eit-rates/",
    ],
  },

  UT: {
    code: "UT",
    name: "Utah",
    year: 2026,
    kind: "flat",
    rate: 0.0445, // SB 60 (2026): 4.5% -> 4.45%
    startsFrom: "agi",
    standardDeduction: 0,
    taxes401k: false,
    overtimeDeduction: false,
    payroll: [],
    locals: [],
    // Taxpayer tax credit: 6% of (federal standard deduction + $2,111 per dependent), reduced by 1.3% of income over
    // $18,213 single / $27,320 head of household / $36,426 joint. 2025 amounts; the 2026 indexed amounts are not confirmed.
    compute(ctx, generic) {
      const start = { single: 18213, mfs: 18213, hoh: 27320, mfj: 36426 }[ctx.status];
      const credit = Math.max(0, 0.06 * (n(ctx.federalStandardDeduction) + 2111 * ctx.dependents) - 0.013 * Math.max(0, n(ctx.base) - start));
      return { taxable: generic.taxable, tax: Math.max(0, generic.tax - credit) };
    },
    notes: ["The child tax credit ($1,000 per child under 6, phased out from $49,000 single / $61,000 joint income) isn't included."],
    sources: [
      "https://le.utah.gov/~2026/bills/static/SB0060.html",
      "https://le.utah.gov/Session/2026/bills/enrolled/SB0060.pdf",
      "https://incometax.utah.gov/credits/taxpayer-tax-credit",
      "https://tax.utah.gov/forms/current/tc-40inst.pdf",
      "https://le.utah.gov/~2026/bills/static/HB0290.html",
    ],
  },
};
