# West and Plains states: 2026 figures and sources

Figures in `src/tax/states/west-plains.ts`, tested by `test/states-west-plains.test.ts`. Checked 2026-09-30.

## How these were checked, and what's still open

- The sandbox's proxy blocked direct fetches of every official site (ftb.ca.gov, edd.ca.gov, oregon.gov, tax.hawaii.gov, the Minnesota, Montana, North Dakota, Nebraska, Kansas and New Mexico revenue sites, and the legislatures). Figures were checked through web-search excerpts instead, with the search limited to the official domain where possible.
- The session's web-search budget, which all the parallel workers share, ran out partway through (after California, Oregon and part of Hawaii). **New Mexico, Montana, North Dakota, Nebraska, Kansas and Minnesota could not be searched at all.** Their figures are the ones I recall from the named sources and are flagged **unverified**. Check them before release.
- A few Hawaii and Oregon figures were cross-checked against [PolicyEngine's open-source parameter files](https://github.com/PolicyEngine/policyengine-us) (secondary; each file cites the official form). After that, the session's permission policy stopped further reads of that clone, so it wasn't used for anything else.

**Confidence flags**

- **excerpt (official)**: the exact number appeared in a search excerpt from the agency's own page or PDF. I couldn't open the page itself.
- **secondary**: from a non-agency source.
- **prior-year**: the latest confirmed amount is for an earlier year; the year is given.
- **derived**: computed from a confirmed figure using a statutory rule.
- **unverified**: from recall of the named source, not checked this session.

---

## California (CA)

FTB indexes brackets, the standard deduction and the credits each fall, using the June-to-June California CPI. The 2025 indexing (3.0%) came out in the October 2025 Tax News, so the 2026 amounts aren't published yet. One secondary site found no 2026 FTB schedule on 2026-09-13. The 2026 Form 540-ES tells filers to use the 2025 exemption credits, and EDD's 2026 withholding schedules use the 2025 brackets and standard deduction. The code does the same.

| Figure | Value | Source | Flag |
|---|---|---|---|
| Brackets, single / MFS | 1% to 11,079 · 2% to 26,264 · 4% to 41,452 · 6% to 57,542 · 8% to 72,724 · 9.3% to 371,479 · 10.3% to 445,771 · 11.3% to 742,953 · 12.3% above | [FTB 2025 tax rate schedules](https://www.ftb.ca.gov/forms/2025/2025-540-tax-rate-schedules.pdf); [EDD 2026 Method B](https://edd.ca.gov/siteassets/files/pdf_pub_ctr/26methb.pdf) Table 5 uses the same 11,079 / 26,264 | excerpt (official), prior-year (2025) |
| Brackets, MFJ | Twice single: 22,158 · 52,528 · 82,904 · 115,084 · 145,448 · 742,958 · 891,542 · 1,485,906 | FTB 2025 tax rate schedules (Schedule Y) | excerpt (official): the thresholds are right, but the excerpt garbled the base-tax column. prior-year (2025) |
| Brackets, HOH | 22,173 · 52,530 · 67,716 · 83,805 · 98,990 · 505,208 · 606,251 · 1,010,417 | Western CPE and NerdWallet summaries of FTB 2025 Schedule Z | secondary, prior-year (2025) |
| Mental Health Services Tax | +1% on taxable income over $1,000,000, all statuses (not indexed), so 13.3% at the top | Secondary 2026 bracket guides | secondary |
| Standard deduction | 5,706 single/MFS · 11,412 MFJ/HOH | [EDD DE 4 (2026)](https://edd.ca.gov/siteassets/files/pdf_pub_ctr/de4.pdf), 2026 Method B | excerpt (official), prior-year (2025) |
| Exemption credits | $153 per filer (2 on MFJ) · $475 per dependent | [FTB 2025 Form 540 instructions](https://www.ftb.ca.gov/forms/2025/2025-540-instructions.html); FTB's SB 1144 analysis also gives $475 for 2025 | excerpt (official), prior-year (2025) |
| Exemption credit phase-out | Each credit drops $6 for every $2,500 ($1,250 MFS), or part of it, of federal AGI over 252,203 single/MFS · 504,411 MFJ · 378,310 HOH | FTB 2025 Form 540 instructions (AGI limitation worksheet) | excerpt (official), prior-year (2025). Coded in `compute`. |
| SB 1144 ($700 dependent credit from 2026) | Not enacted: still in committee on 2026-04-27 | [FTB bill analysis](https://www.ftb.ca.gov/tax-pros/law/legislation/2025-2026/SB1144-021826.pdf), legislature trackers | excerpt. Not modeled. |
| Starting point | Federal AGI | — | unverified (standard) |
| taxes401k | false | — | unverified (standard) |
| overtimeDeduction | false. SB 711 moved California's IRC conformity date to Jan 1, 2025, which is before the OBBBA. | [FTB Summary of Federal Income Tax Changes](https://www.ftb.ca.gov/about-ftb/data-reports-plans/Summary-of-Federal-Income-Tax-Changes/index.html) | excerpt (official) |
| supplementalRate | **10.23%** on bonuses and stock options; 6.6% on other supplemental wages. The brief said 6.6%, but EDD applies 10.23% to bonuses. | [EDD DE 231PS](https://edd.ca.gov/siteassets/files/pdf_pub_ctr/de231ps.pdf) | excerpt (official) |
| SDI | 1.3% of all wages, no wage cap (SB 951, from 2024) | [EDD rates and withholding](https://edd.ca.gov/en/payroll_taxes/rates_and_withholding/) | excerpt (official) |

## Oregon (OR)

| Figure | Value | Source | Flag |
|---|---|---|---|
| Brackets, single / MFS (2026) | 4.75% to 4,550 · 6.75% to 11,400 · 8.75% to 125,000 · 9.9% above. The base-tax column ($216 / $678 / $10,618) matches. | [2026 Publication OR-ESTIMATE](https://www.oregon.gov/dor/forms/FormsPubs/publication-or-estimate_101-026_2026.pdf) | excerpt (official) |
| Brackets, MFJ / HOH / QSS (Chart J) | 4.75% to 9,100 · 6.75% to 22,800 · 8.75% to 250,000 · 9.9% above. The base-tax column ($432 / $1,357 / $21,237) matches. | 2026 OR-ESTIMATE | excerpt (official) |
| Standard deduction (2026) | 2,910 single/MFS · 5,820 MFJ · 4,685 HOH | [2026 OR-W-4 instructions](https://www.oregon.gov/dor/forms/FormsPubs/form-or-W-4-instr_101-402-1_2026.pdf), 2026 combined payroll instructions. The 2025 amounts (2,835 / 5,670 / 4,560) in PolicyEngine fit the same pattern. | excerpt (official) |
| Personal exemption credit (2026) | $260 per exemption. It's $0 if federal AGI is over $100,000 (single/MFS) or $200,000 (MFJ/HOH/QSS): a cliff, not a phase-out. | 2026 OR-ESTIMATE | excerpt (official). Coded in `compute`. |
| Federal tax subtraction cap (2026) | **$8,750** ($4,375 MFS) | The 2026 OR-ESTIMATE worksheet excerpt shows "$0 to $8,750", and secondary 2026 guides agree. **But** the excerpt of DOR's payroll-updates page says "increased federal tax subtraction to $8,500", which is probably the 2025 wording carried over. | excerpt (official), with a conflict. The 2025 cap was $8,500 (secondary: PolicyEngine, citing 2025 OR-40 instructions). |
| Subtraction phase-out | The cap falls to 80/60/40/20/0% in $5,000 steps of federal AGI from $125,000 to $145,000 (single/MFS), and in $10,000 steps from $250,000 to $290,000 (MFJ) | 2024 OR-40 instructions MFS table (4,125 → 3,300 → 2,475 → 1,650 → 825 → 0), excerpt; 2025 table (8,500 → 6,800 → 5,100 → 3,400 → 1,700 → 0), secondary (PolicyEngine) | excerpt / secondary. HOH is put with MFJ: **unverified**. Coded in `compute` using `ctx.federalTax`. |
| Starting point | Federal AGI | — | unverified (standard) |
| taxes401k / overtimeDeduction | false / false. Oregon starts from AGI and the overtime deduction comes after AGI. | — | unverified |
| supplementalRate | 8% optional flat rate on supplemental wages paid separately | [Oregon withholding tax formulas 2026](https://www.oregon.gov/dor/forms/FormsPubs/withholding-tax-formulas_206-436_2026.pdf) | excerpt (official) |
| Paid Leave Oregon | 1% total rate, employee pays 60% (0.6%), up to the SSA wage base of $184,500 | [OED 2026 rate press release](https://www.oregon.gov/employ/NewsAndMedia/Documents/2025-11-18_Tax_Rate_2026_Press_Release.pdf), [Paid Leave Oregon](https://paidleave.oregon.gov/employers/contributions-calculator.html) | excerpt (official) |
| Statewide transit tax | 0.1% of wages, no cap. Measure 120 failed on May 19, 2026, so the rate stays at 0.1%. | [DOR statewide transit tax](https://www.oregon.gov/dor/programs/businesses/pages/statewide-transit-tax.aspx) | excerpt (official) |
| Local: Metro SHS | 1% of Oregon taxable income over **$128,000** (single/MFS) or **$205,000** (MFJ/HOH/QSS), residents only | Indexing from 2026 and the status grouping: [Metro SHS FAQ](https://www.oregonmetro.gov/what-metro-does/housing-and-homelessness/supportive-housing-services/pay-my-shs-taxes/shs-taxes-faq), excerpt (official). The $128k / $205k amounts: Bridgetown Bookkeeping and countrytaxcalc 2026 guides. | **secondary**. The 2021–2025 amounts were $125k / $200k. |
| Local: Multnomah PFA | 1.5% over $125,000 / $200,000, plus 1.5% more over $250,000 / $400,000. Not indexed. The 0.8% increase is delayed to 2028. MFS counts as single and HOH as joint. | [Multnomah County PFA](https://multco.us/info/multnomah-county-preschool-all-personal-income-tax), 2026 PFA tax tables | excerpt (official) |
| Local entries | `metro-shs` (Metro only) and `metro-shs-multnomah-pfa` (both combined, e.g. Portland) as `brackets-on-state-taxable` | — | — |

## Hawaii (HI)

| Figure | Value | Source | Flag |
|---|---|---|---|
| Brackets, single / MFS (tax years beginning after Dec 31, 2024; no change until 2027) | 1.4% to 9,600 · 3.2% to 14,400 · 5.5% to 19,200 · 6.4% to 24,000 · 6.8% to 36,000 · 7.2% to 48,000 · 7.6% to 125,000 · 7.9% to 175,000 · 8.25% to 225,000 · 9% to 275,000 · 10% to 325,000 · 11% above | [Act 46, SLH 2024](https://data.capitol.hawaii.gov/sessions/sessionlaws/Years/SLH2024/SLH2024_Act46.pdf); [DOTAX rate schedules](https://tax.hawaii.gov/forms/d_25table-on/d_25table-on_p13/) | First four thresholds and base tax: excerpt (official). 11% over $325,000 from 2025: Tax Foundation excerpt (secondary). Rest: secondary (PolicyEngine, citing DOTAX 2025 schedules). |
| Brackets, MFJ / HOH | 2× and 1.5× the single thresholds | HRS §235-51 has always set joint at twice and head of household at 1.5 times the single table | **derived, unverified** for the Act 46 tables |
| 2027 onward (not used) | Act 24, SLH 2026 (S.B. 3125) restructures the brackets and adds a 13% bracket from 2027 | PolicyEngine note | secondary |
| Standard deduction (2026) | 8,000 single/MFS · 16,000 MFJ · 12,000 HOH | [DOTAX 2026 employer payroll updates](https://tax.hawaii.gov/payrollupdate/); PolicyEngine agrees | excerpt (official) + secondary |
| Personal exemption | $1,144 per filer and dependent | 2025 N-11 instructions, line 25 (via PolicyEngine) | secondary |
| Starting point / taxes401k / overtime | AGI / false / false | — | unverified |
| TDI | Employee pays up to 0.5% of wages, capped at a weekly maximum. **2025**: $6.87 a week (on a $1,374.78 wage base), which is $357.24 a year. | [DLIR Disability Compensation Division](https://labor.hawaii.gov/dcd/) | **unverified, prior-year (2025)**. I couldn't find the 2026 maximum weekly wage base. |

## New Mexico (NM): all unverified

| Figure | Value | Source | Flag |
|---|---|---|---|
| Brackets (2024 HB 252, from tax year 2025) | Single: 1.5% to 5,500 · 3.2% to 16,500 · 4.3% to 33,500 · 4.7% to 66,500 · 4.9% to 210,000 · 5.9% above. MFJ/HOH: 8,000 · 25,000 · 50,000 · 100,000 · 315,000. MFS: 4,000 · 12,500 · 25,000 · 50,000 · 157,500. | [HB 252 (2024)](https://www.nmlegis.gov/Legislation/Legislation?chamber=H&legType=B&legNo=252&year=24), [NM TRD](https://www.tax.newmexico.gov/) | unverified |
| Deductions | Federal standard deduction (NM follows IRC §63), so $16,100 / $32,200 for 2026 | — | unverified |
| Starting point / taxes401k / overtime | Federal AGI / false / false | — | unverified |
| Payroll | None rate-based. The Workers' Compensation fee is a flat amount per quarter, which the engine can't express. | — | unverified |
| supplementalRate | Not set (I recall 5.9%, but couldn't confirm) | — | — |

## Montana (MT): all unverified

| Figure | Value | Source | Flag |
|---|---|---|---|
| Brackets 2026 (HB 337, 2025) | 4.7% to 47,500 single/MFS · 95,000 MFJ · 71,250 HOH; **5.65%** above. HB 337 also sets 5.4% and a $52,000 single threshold for 2027. | [HB 337 (2025)](https://leg.mt.gov/bills/2025/billpdf/HB0337.pdf), [MT DOR](https://mtrevenue.gov/taxes/individual-income-tax/) | unverified |
| Starting point | Federal taxable income (since 2024), so the federal standard deduction applies. No state exemptions. | — | unverified |
| overtimeDeduction | true: it flows through federal taxable income, and I know of no Montana add-back | — | unverified |
| Payroll / locals | None | — | — |

## North Dakota (ND): all unverified

| Figure | Value | Source | Flag |
|---|---|---|---|
| Brackets (0% / 1.95% / 2.5%) | Single 48,475 / 244,825 · MFJ 80,975 / 298,075 · MFS 40,475 / 149,050 · HOH 64,950 / 271,450 | [ND Tax](https://www.tax.nd.gov/) | **unverified, prior-year (2025)**. The 2026 indexing isn't known. |
| Starting point | Federal taxable income | — | unverified |
| overtimeDeduction | true: it flows through federal taxable income, and I know of no add-back | — | unverified |
| supplementalRate | Not set | — | — |

## Nebraska (NE): all unverified

| Figure | Value | Source | Flag |
|---|---|---|---|
| Rates 2026 (LB 754, 2023) | 2.46% · 3.51% · 4.55% · 4.55%. The top rate falls 5.2% → 4.55%, and the third bracket is at or below the top. | [Neb. Rev. Stat. 77-2715.03](https://nebraskalegislature.gov/laws/statutes.php?statute=77-2715.03) | unverified |
| Thresholds | Single/MFS 4,030 / 24,120 / 38,870 · MFJ 8,040 / 48,250 / 77,730 · HOH 7,510 / 38,590 / 57,630 | [NE DOR](https://revenue.nebraska.gov/individuals) | **unverified, prior-year (2025)** |
| Standard deduction | 8,600 / 17,200 / 8,600 / 12,600 | NE DOR | **unverified, prior-year (2025)** |
| Personal exemption credit | $171 per filer and dependent | NE DOR | **unverified, prior-year (2025)** |

## Kansas (KS): all unverified

| Figure | Value | Source | Flag |
|---|---|---|---|
| Brackets (2024 SB 1) | 5.2% to 23,000 (single/HOH/MFS) or 46,000 (MFJ); 5.58% above | [KDOR individual income tax](https://www.ksrevenue.gov/perstaxtypesii.html) | unverified. I don't know whether 2025 SB 269's revenue trigger lowered the 2026 top rate. |
| Standard deduction | 3,605 single · 8,240 MFJ · 4,120 MFS · 6,180 HOH | KDOR | unverified (2024 amounts; indexing not confirmed) |
| Personal exemption | $9,160 per filer ($18,320 MFJ) · $2,320 per dependent | KDOR | unverified |
| supplementalRate | Not set (I recall 5%) | — | — |

## Minnesota (MN): all unverified

| Figure | Value | Source | Flag |
|---|---|---|---|
| Brackets (5.35 / 6.8 / 7.85 / 9.85%) | Single 32,570 / 106,990 / 198,630 · MFJ 47,620 / 189,180 / 330,410 · MFS 23,810 / 94,590 / 165,205 · HOH 40,100 / 161,130 / 264,050 | [MN Revenue rates and brackets](https://www.revenue.state.mn.us/minnesota-income-tax-rates-and-brackets) | **unverified, prior-year (2025)** |
| Standard deduction | 14,950 single/MFS · 29,900 MFJ · 22,500 HOH | MN Revenue | **unverified, prior-year (2025)** |
| Standard deduction phase-out | Reduced by 3% of AGI over $238,950 ($119,475 MFS), by at most 80% | MN Revenue | **unverified, prior-year (2025)**. Coded in `compute`. |
| Dependent exemption | $5,200 per dependent | MN Revenue | **unverified, prior-year (2025)** |
| Paid Leave (from Jan 1, 2026) | 0.88% premium; employers may deduct up to 50% (0.44%) from employees, up to the SSA wage base of $184,500 | [MN Paid Leave](https://paidleave.mn.gov/); wage base from `docs/tax-sources.md` | unverified (rate and share) |
| supplementalRate | Not set (I recall 6.25%) | — | — |

---

## Not modeled

- **Refundable and low-income credits**: California EITC and Young Child Tax Credit, the Oregon Kids Credit and WFHDC, Minnesota's Child Tax Credit, New Mexico's child income tax credit, Hawaii's food/excise credit, and the Kansas food sales tax credit.
- **California**: HSA add-back (California taxes HSA contributions); renter's credit; 2026 indexing (2025 figures used).
- **Oregon**: Portland Arts Tax ($35 per adult; the engine has no per-person local type); the kicker; Multnomah PFA *without* Metro SHS (a few areas outside the Metro boundary).
- **New Mexico**: the low- and middle-income exemption and the $4,000 deduction for each dependent after the first. I couldn't confirm the current rules for either.
- **Minnesota**: the dependent exemption phase-out at high AGI.
- **Kansas**: whether SB 269's 2026 rate trigger fired.
- **Bonus withholding** for HI, NM, MT, ND, NE, KS and MN: `supplementalRate` is left unset, so the engine uses the marginal rate.
