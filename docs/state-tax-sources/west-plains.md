# West and Plains states: 2026 figures and sources

Figures in `src/tax/states/west-plains.ts`, tested by `test/states-west-plains.test.ts`. Checked 2026-09-30.

## How these were checked, and what's still open

- The sandbox's proxy blocked direct fetches of every official site (ftb.ca.gov, edd.ca.gov, oregon.gov, tax.hawaii.gov, the Minnesota, Montana, North Dakota, Nebraska, Kansas and New Mexico revenue sites, and the legislatures). Figures were checked through web-search excerpts instead, with the search limited to the official domain where possible.
- The session's web-search budget, which all the parallel workers share, ran out partway through (after California, Oregon and part of Hawaii). **New Mexico, Montana, North Dakota, Nebraska, Kansas and Minnesota could not be searched at all** in that pass, so their figures came from recall and were flagged **unverified**. The second pass below checked them.
- A few Hawaii and Oregon figures were cross-checked against [PolicyEngine's open-source parameter files](https://github.com/PolicyEngine/policyengine-us) (secondary; each file cites the official form). After that, the session's permission policy stopped further reads of that clone, so it wasn't used for anything else.

### Second pass: NM, MT, ND, NE, KS and MN (2026-09-30)

- Direct fetches of the official sites were still blocked, so every figure below comes from web searches limited to the agency's or legislature's own domain. None could be read on the page itself.
- Where a number only surfaced after I put it in the query ("seeded"), the row says so and names what corroborates it. Usually that's a base-tax amount the agency printed, which the coded schedule reproduces exactly; those checks are tests.
- Tax Foundation, news reports and bill trackers were used only as cross-checks, marked secondary. PolicyEngine wasn't used, because this session's GitHub access covers only this repository.
- A second round the same day ("base-tax searches") closed most of what was left. Searching the official domain for just the base-tax amount a candidate threshold would produce (e.g. "2,164.99") returns the agency's rate schedule only when that amount is printed there, which pins down the threshold. The method was checked first on amounts already known to be printed ($4,118.40 in North Dakota, $101.60 in Nebraska).
- **Kansas, Montana, Minnesota, North Dakota and Nebraska** are now fully confirmed and no longer flagged. **New Mexico** keeps `unverified: true`; its section ends with what's still missing.

**Confidence flags**

- **official site**: read on the agency's own page. Nothing in this file reached that level, because direct fetches were blocked.
- **excerpt (official)**: the exact number appeared in a search excerpt from the agency's (or legislature's) own page or PDF. I couldn't open the page itself.
- **secondary**: from a non-agency source.
- **prior-year**: the latest confirmed amount is for an earlier year; the year is given.
- **derived**: computed from a confirmed figure using a statutory rule, or a pattern the confirmed figures follow (said which).
- **unverified**: from recall of the named source, not checked.

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

## New Mexico (NM): still unverified

| Figure | Value | Source | Flag |
|---|---|---|---|
| Brackets (NMSA 7-2-7 as amended by 2024 HB 252; tax years from 2025, not indexed) | Single: 1.5% to 5,500 · 3.2% to 16,500 · 4.3% to 33,500 · 4.7% to 66,500 · 4.9% to 210,000 · 5.9% above. MFJ, HOH and surviving spouse: 8,000 · 25,000 · 50,000 · 100,000 · 315,000. MFS: 4,000 · 12,500 · 25,000 · 50,000 · 157,500. | [HB 252 (2024) text](https://www.nmlegis.gov/Sessions/24%20Regular/bills/house/HB0252.HTML), [TRD personal income tax rates](https://www.tax.newmexico.gov/all-nm-taxes/current-historic-tax-rates-overview/personal-income-tax-rates/) | excerpt (official). The bill's printed top-bracket base tax is $9,748 single, $14,624 joint/HOH and $7,312 MFS, and the schedules reproduce all three exactly (tested). The joint schedule covering HOH comes from the same excerpt. One excerpt quoted a 1.7% bottom MFS rate, but that is the struck pre-2025 text: the $7,312 base only works with 1.5%. No 2026 change was enacted. |
| Starting point | Federal AGI | [TRD OBBBA presentation to the legislature, July 2025](https://www.nmlegis.gov/handouts/ZFFSS%20073125%20Item%203%20OBBBA%20Tax%20Presentation.pdf) ("federal definitions of income flow through to PIT") | excerpt (official) |
| Standard deduction | The federal one: 16,100 / 32,200 / 16,100 / 24,150 for 2026 | Same presentation: "New Mexico conforms to the federal standard deduction increase". The [2026 HB 93 fiscal report](https://www.nmlegis.gov/Sessions/26%20Regular/firs/HB0093.PDF) also describes the state deduction as the federal one. HB 93 would have raised it to 205% of federal, but it's not in the enacted 2026 tax package. Federal amounts: `docs/tax-sources.md`. | excerpt (official). HB 93's fate: secondary. |
| Low- and middle-income exemption (NMSA 7-2-5.8) | For each exemption (filers and dependents): $2,500 while AGI is at most $20,000 single, $30,000 joint/HOH/surviving spouse or $15,000 MFS; above that, $2,500 less 15% (single), 10% (joint/HOH) or 20% (MFS) of the excess. That makes it zero at $36,667, $55,000 and $27,500. | Statute text: [NMSA 7-2-5.8 on Justia](https://law.justia.com/codes/new-mexico/chapter-7/article-2/section-7-2-5-8/) ("for each federal exemption"); the $2,500 maximum: [TRD personal income tax overview](https://www.tax.newmexico.gov/individuals/personal-income-tax-information-overview/) | Maximum: excerpt (official). Formula: **secondary** (Justia hosts the statute; the official compilation wasn't reachable). The MFS 20% is derived from its $15,000 start and $27,500 end. **New**: coded in `compute`. It only matters below $55,000 of AGI. |
| Dependent deduction (NMSA 7-2-39) | $4,000 | [TRD OBBBA presentation](https://www.nmlegis.gov/handouts/ZFFSS%20073125%20Item%203%20OBBBA%20Tax%20Presentation.pdf) ("$4,000 dependent deduction (7-2-39)") | Amount: excerpt (official). **Who qualifies, and whether the first dependent is excluded, wasn't confirmed.** Not modeled. For the joint test household it overstates tax by $196 (one child counted) or $392 (both). |
| taxes401k | false: deferrals are outside federal AGI | [TRD OBBBA presentation](https://www.nmlegis.gov/handouts/ZFFSS%20073125%20Item%203%20OBBBA%20Tax%20Presentation.pdf) (starting point) | follows from the starting point |
| overtimeDeduction | false. The federal deduction comes after AGI, so it doesn't reach New Mexico's base. 2026 HB 264 would have created a state deduction for it but was postponed indefinitely. The tax package that was signed is SB 151, which has no overtime deduction. | [HB 264 fiscal report](https://www.nmlegis.gov/Sessions/26%20Regular/AgencyAnalysis/HB0264_333.pdf) shows the deduction had to be created. The bill's fate is from FastDemocracy and BillTrack50; SB 151's contents are from [Source NM](https://sourcenm.com/2026/03/12/nm-gov-lujan-grisham-enacts-tax-package-including-unusual-1-pay-raises-for-state-employees/). | excerpt (official) for the mechanism; **secondary** for HB 264's fate |
| supplementalRate | Not set, so the engine uses the marginal rate. Payroll sites cite FYI-104 as setting 5.9%, but no official excerpt showed the figure. | [FYI-104](https://www.tax.newmexico.gov/businesses/wp-content/uploads/sites/4/2022/12/FYI-104_2025.pdf) | secondary only; not used |
| Payroll | No rate-based deductions. The Workers' Compensation fee is $2.00 per employee per quarter (the employer pays $2.30), a flat amount the engine can't express. There's no paid-leave program: 2025 HB 11 died in Senate Finance and nothing passed in 2026. | [TRD withholding and workers' comp](https://www.tax.newmexico.gov/businesses/withholding-tax-and-workers-compensation/) (fee); PFML status from secondary trackers | excerpt (official) for the fee; secondary for PFML |

**Still missing before the flag can go:** an official source for the low- and middle-income exemption formula (only the Justia copy of the statute was found); the dependent deduction's eligibility rule (7-2-39 has a version effective January 1, 2026, whose text wasn't found); an official excerpt for the 5.9% supplemental rate (the 2026 FYI-104, Rev. 11/2025, is indexed but its excerpts don't show the rate); an official record of HB 264's fate.

## Montana (MT): verified

Montana DOR moved from mtrevenue.gov to revenue.mt.gov.

| Figure | Value | Source | Flag |
|---|---|---|---|
| Brackets 2026 (HB 337, 2025) | 4.7% to 47,500 for single, MFS and every other status not listed · 95,000 MFJ · 71,250 HOH; **5.65%** above. HB 337 lowers the top rate to 5.4% in 2027. | [MT DOR: HB 337 2026–2027 changes](https://revenue.mt.gov/news/recent-news/HB-337), [2026 withholding update](https://revenue.mt.gov/news/recent-news/2026-withholding-updates) | excerpt (official) |
| Starting point | Federal taxable income, less the federal QBI deduction. The federal standard deduction applies, and Montana has no standard deduction or exemptions of its own. | [Tax Simplification Resource Hub](https://revenue.mt.gov/montana-tax-simplification-resource-hub), [Overview of changes to Form 2](https://revenue.mt.gov/files/Forms/Montana-Individual-Income-Tax-Return-Form-2/Form-2-Changes.pdf) | excerpt (official). The engine doesn't pass the QBI deduction to state entries, so the add-back isn't modeled; a user-facing note says so. |
| taxes401k | false: deferrals are outside federal taxable income | [Overview of changes to Form 2](https://revenue.mt.gov/files/Forms/Montana-Individual-Income-Tax-Return-Form-2/Form-2-Changes.pdf) (starting point) | follows from the starting point |
| overtimeDeduction | true. The deduction lowers federal taxable income and Montana has no add-back. The Legislative Fiscal Division counts it among the H.R. 1 provisions that reduce Montana collections. There was no 2026 session (the legislature meets in odd years). | [LFD memo, July 11, 2025](https://archive.legmt.gov/content/Committees/Interim/2025-2026/RIC/Meetings/July_11_2025/2.12.Updated-HR1-Impacts-to-Montana-Revenue.pdf) | excerpt (official) |
| supplementalRate | **5%**, an optional flat rate on supplemental wages paid separately. A 2024 webinar slide said 6%; the current guide says 5%. | [Montana Employer and Information Agent Guide](https://revenue.mt.gov/files/BIT/Montana_Employer_and_Information_Agent_Guide_with_Tax_Tables-1.pdf), linked from the 2026 withholding update | excerpt (official). Payroll sites agree (secondary). **Changed**: was unset. |
| Payroll | None. Unemployment insurance is employer-paid, and deducting it from wages is illegal. | [MCA 39-51-3103](https://mca.legmt.gov/bills/mca/title_0390/chapter_0510/part_0310/section_0030/0390-0510-0310-0030.html), DLI employer handbook | excerpt (official) |

## North Dakota (ND): verified

| Figure | Value | Source | Flag |
|---|---|---|---|
| Brackets 2026 (0% / 1.95% / 2.5%) | Single 49,575 / 250,400 · MFJ 82,800 / 304,850 · HOH 66,400 / 277,600 · MFS 41,400 / 152,425 | [Form ND-1ES 2026](https://www.tax.nd.gov/sites/www/files/documents/forms/software-developer/individual-income-forms/28709-form-nd-1es-2026%20final.pdf) | excerpt (official). Some numbers were seeded, but each schedule reproduces the base tax the form prints: $3,916.09 at 250,400 single, $4,329.98 at 304,850 MFJ, $4,118.40 at 277,600 HOH and $2,164.99 at 152,425 MFS (tested). The MFS figure came from a base-tax search: "2,164.99" returns only the ND-1ES 2026, reading "$2,164.99 + 2.50% of amount over $152,425"; the bases for $152,400 or $152,450 don't appear. **Changed** from the 2025 figures. |
| Starting point | Federal taxable income (2025 Form ND-1, line 1b; before 2025 the form started from AGI) | [Form ND-1 2025](https://www.tax.nd.gov/sites/www/files/documents/forms/individual/2025-iit/28702-form-nd-1-2025.pdf) | excerpt (official) |
| taxes401k | false. Deferrals are outside federal taxable income, and ND withholding terms take their IRC meaning. | [ND income tax withholding guideline](https://www.tax.nd.gov/sites/www/files/documents/guidelines/business/it-withhold/income-tax-withholding-information-returns-guideline.pdf) | excerpt (official) |
| overtimeDeduction | true. The Tax Commissioner's OBBBA table for the interim committee lists the overtime exclusion ($12,500 / $25,000) as reducing ND collections. | [OBBBA impacts, Office of State Tax Commissioner](https://ndlegis.gov/sites/default/files/pdf/committees/69-2025/27.5083.03000appendixf.pdf) | excerpt (official). North Dakota Monitor quotes the Commissioner saying the OBBBA deductions cut state liability (secondary). |
| supplementalRate | **1.5%** of supplemental wages paid separately | [2026 withholding rates and instructions](https://www.tax.nd.gov/sites/www/files/documents/forms/individual/2026-iit/2026-income-tax-withholding-rates-booklet.pdf) | excerpt (official). **Changed**: was unset. |
| Payroll | None. Unemployment insurance is employer-paid ("no money is deducted from your paycheck"). | [Job Service ND](https://www.jobsnd.com/unemployment-business-tax/employers-guide) handbooks | excerpt (official) |

## Nebraska (NE): verified

| Figure | Value | Source | Flag |
|---|---|---|---|
| Rates 2026 (LB 754, 2023) | 2.46% · 3.51% · 4.55% · 4.55%. The third and fourth brackets are both 4.55%, so the code merges them. | [2026 Form 1040N-ES](https://revenue.nebraska.gov/sites/default/files/doc/tax-forms/drafts/f_1040n-es.pdf) | excerpt (official) |
| Thresholds, single / MFS | 4,130 · 24,760 (· 39,900, unused) | [NE DOR tax rate chronologies](https://revenue.nebraska.gov/sites/default/files/doc/research/chronology/4-607table1.pdf) | excerpt (official). **Changed** from 2025. |
| Thresholds, MFJ | 8,260 · 49,520 (· 79,860, unused) | Same, and the [2026 tax tables (draft)](https://revenue.nebraska.gov/sites/default/files/doc/tax-forms/drafts/2026_tax_tables.pdf) | excerpt (official, seeded). An unseeded excerpt of the tax table gave $3,032 (MFJ) and $3,333 (single) at $79,860, and the schedules reproduce both to the dollar (tested). **Changed.** |
| Thresholds, HOH | 7,700 · 39,620 (· 59,160, unused) | [2026 Form 1040N-ES](https://revenue.nebraska.gov/sites/default/files/doc/tax-forms/2025/f_1040N-ES.pdf), [2026 tax tables (draft)](https://revenue.nebraska.gov/sites/default/files/doc/tax-forms/drafts/2026_tax_tables.pdf) | excerpt (official), from base-tax searches: "189.42" gives "$189.42 + 3.51% of the excess over $7,700" for HOH, and "1,309.81" gives the HOH base for $39,620 to $59,160. The bases for neighbouring candidates ($7,690, $7,710, $7,720) don't appear. The schedule also reproduces the table's $3,141 at $79,860 (tested). **Changed** from the recalled 2025 figures (7,510 · 38,590). |
| Standard deduction 2026 | 8,850 single/MFS · 17,700 MFJ · 12,950 HOH | [2026 Form 1040N-ES](https://revenue.nebraska.gov/sites/default/files/doc/tax-forms/drafts/f_1040n-es.pdf), [2026 tax tables (draft)](https://revenue.nebraska.gov/sites/default/files/doc/tax-forms/drafts/2026_tax_tables.pdf) | excerpt (official). **Changed** from 8,600 / 17,200 / 12,600. |
| Personal exemption credit 2026 | $176 for each exemption (filer, spouse, dependents). The 2025 instructions show no phase-out. | [2026 Form 1040N-ES](https://revenue.nebraska.gov/sites/default/files/doc/tax-forms/drafts/f_1040n-es.pdf); [2025 booklet](https://revenue.nebraska.gov/sites/default/files/doc/tax-forms/2025/f_Individual_Income_Tax_Booklet.pdf) (no phase-out) | excerpt (official). **Changed** from $171. |
| Starting point / taxes401k | Federal AGI (Form 1040N, line 5) / false | [2025 individual income tax booklet](https://revenue.nebraska.gov/sites/default/files/doc/tax-forms/2025/f_Individual_Income_Tax_Booklet.pdf) | excerpt (official) |
| overtimeDeduction | false. Nebraska starts from federal AGI, which the federal deduction doesn't reduce. LB 932 (2026) would have added a state deduction; it got a Revenue Committee hearing on February 20 and never advanced. DOR's list of 2026 legislative changes for individuals has only a National Guard deduction (from 2027) and an adoption credit (LB 647). | [LB 932](https://nebraskalegislature.gov/bills/view_bill.php?DocumentID=63391), [2026 Nebraska legislative changes](https://revenue.nebraska.gov/about/2026-nebraska-legislative-changes) | excerpt (official). Nebraska Public Media and The American Prospect report the bill didn't pass (secondary). |
| supplementalRate | **3.5%** optional flat rate (5% in 2025) | [2026 Circular EN](https://revenue.nebraska.gov/sites/default/files/doc/business/Cir_En_2025/2026cir_en_whole.pdf) | excerpt (official). **Changed**: was unset. |
| Payroll | None. Unemployment insurance is employer-paid, and state law bars deducting it from wages. | [Neb. Rev. Stat. 48-648](https://www.nebraskalegislature.gov/laws/statutes.php?statute=48-648), [NDOL employer's guide](https://dol.nebraska.gov/webdocs/getfile/da557858-b2cd-412f-a78b-caf4ff0cd131) | excerpt (official) |

## Kansas (KS): verified

| Figure | Value | Source | Flag |
|---|---|---|---|
| Brackets | 5.2% to 23,000 (single, HOH, MFS) or 46,000 (MFJ); 5.58% above | [K.S.A. 79-32,110](https://ksrevisor.gov/statutes/chapters/ch79/079_032_0110.html). The 2025 K-40ES schedules print the base tax as $1,196 and $2,392. | excerpt (official) |
| SB 269 rate trigger | Didn't fire for 2026. FY 2025 adjusted general-fund collections were below the inflation-adjusted base, even though the rainy-day-fund test passed. | [KDOR 2025 legislative update](https://www.ksrevenue.gov/pdf/2025LegChangesPresentation.pdf), [Notice 25-06](https://ksrevenue.gov/taxnotices/notice25-06.pdf), Division of the Budget memo | excerpt (official). Bloomberg Tax agrees (secondary). |
| Standard deduction | 3,605 single · 8,240 MFJ · 4,120 MFS · 6,180 HOH, fixed "for tax year 2024 and all tax years thereafter" (not indexed) | [K.S.A. 79-32,119](https://ksrevisor.gov/statutes/chapters/ch79/079_032_0119.html) | excerpt (official) |
| Personal exemption | $9,160 single/HOH/MFS or $18,320 MFJ, $2,320 per dependent, and **another $2,320 for head of household** (codified by the 2025 session) | [K.S.A. 79-32,121](https://ksrevisor.gov/statutes/chapters/ch79/079_032_0121.html), [KDOR 2025 legislative changes](https://www.ksrevenue.gov/pdf/2025LegChanges.pdf) | excerpt (official). **Changed**: the HOH exemption was missing; it's coded in `compute`. |
| Starting point / taxes401k | Federal AGI / false. KPERS contributions are added back, but only public employees make them. | [KW-100](https://www.ksrevenue.gov/pdf/kw100.pdf), [KDOR KPERS page](https://www.ksrevenue.gov/kpers.html) | excerpt (official) |
| overtimeDeduction | false. SB 311 (2026) was introduced and referred to committee but never enacted. KDOR's 2026 notices (26-06 to 26-09) cover other changes. | [SB 311](https://kslegislature.gov/li/b2025_26/measures/sb311), [KDOR new tax notices](https://ksrevenue.gov/prnewtaxnotices.html) | excerpt (official). LegiScan shows no action after the committee referral (secondary). |
| supplementalRate | **5%** when supplemental wages are paid separately | [KW-100](https://www.ksrevenue.gov/pdf/kw100.pdf) | excerpt (official). **Changed**: was unset. |
| Payroll | None. Unemployment insurance is employer-funded. | [KDOL unemployment tax](https://www.dol.ks.gov/employers/employer-services/unemployment-tax) | excerpt (official) |

## Minnesota (MN): verified

| Figure | Value | Source | Flag |
|---|---|---|---|
| Brackets 2026 (5.35 / 6.8 / 7.85 / 9.85%) | Single 33,310 / 109,430 / 203,150 · MFJ 48,700 / 193,480 / 337,930 · MFS 24,350 / 96,740 / 168,965 · HOH 41,010 / 164,800 / 270,060 | [MN Revenue 2026 release](https://www.revenue.state.mn.us/press-release/2025-12-16/minnesota-income-tax-brackets-standard-deduction-and-dependent-exemption), [rates and brackets](https://www.revenue.state.mn.us/minnesota-income-tax-rates-and-brackets) | excerpt (official). MFS/HOH were seeded after a news excerpt; MFS is exactly half of MFJ. The release says brackets "change by 2.369 percent", but every published threshold is about 2.27% above 2025's; the code uses the published thresholds. **Changed** from 2025. |
| Standard deduction 2026 | 15,300 single/MFS · 30,600 MFJ · 23,000 HOH | [2026 release](https://www.revenue.state.mn.us/press-release/2025-12-16/minnesota-income-tax-brackets-standard-deduction-and-dependent-exemption) | excerpt (official). **Changed.** |
| Dependent exemption 2026 | $5,300. There's no exemption for filers. | [2026 release](https://www.revenue.state.mn.us/press-release/2025-12-16/minnesota-income-tax-brackets-standard-deduction-and-dependent-exemption) | excerpt (official). **Changed** from $5,200. |
| Standard deduction reduction | 3% of AGI over 244,400 (122,200 MFS) up to 337,800 (168,900 MFS), plus 10% of AGI above that, at most 80% of the deduction | [Minn. Stat. 290.0123](https://www.revisor.mn.gov/statutes/cite/290.0123) (the 2023 base amounts are 220,650 / 304,970); 2026 amounts from [Tax Year 2026 Inflation-Adjusted Amounts](https://www.revenue.state.mn.us/sites/default/files/2025-12/inflation-adjusted-amounts-2026.pdf) | excerpt (official). The Tax Foundation's 2026 footnote agrees (secondary). **Changed**: the code had only the 3% tier, on 2025's 238,950. |
| Dependent exemption phase-out (Minn. Stat. 290.0121 subd. 2) | Down 2 percentage points for each $2,500 ($1,250 MFS), or part of it, of AGI over 244,500 single · 366,700 MFJ · 305,600 HOH · 183,350 MFS | [Tax Year 2026 Inflation-Adjusted Amounts](https://www.revenue.state.mn.us/sites/default/files/2025-12/inflation-adjusted-amounts-2026.pdf), [2026 W-4MN](https://www.revenue.state.mn.us/sites/default/files/2026-04/w-4mn.pdf); the rule: [2025 inflation-adjusted amounts](https://www.revenue.state.mn.us/sites/default/files/2024-12/inflation-adjusted-amounts-2025.pdf) | excerpt (official). The MFJ and HOH figures were seeded, but the excerpt also gave the row's label ("Disallowed Exemption Amount") and statute, which I hadn't supplied, and all four figures together. The single and MFS figures appeared unprompted in the W-4MN excerpt. **New**: this phase-out wasn't modeled before. It's coded in `compute`. |
| Starting point / taxes401k | Federal AGI (Form M1, line 1) / false. The M1 instructions list elective deferrals as income not on the starting lines. | [2025 Form M1 instructions](https://www.revenue.state.mn.us/sites/default/files/2026-04/m1-inst-25.pdf) | excerpt (official) |
| overtimeDeduction | false. The federal deduction comes after AGI. The 2026 tax bill (Laws 2026, ch. 128) moved conformity to May 1, 2026 but added no overtime subtraction. | [Tax law changes](https://www.revenue.state.mn.us/tax-law-changes), [2025 federal nonconformity](https://www.revenue.state.mn.us/2025-federal-nonconformity-income-tax), [OBBBA overtime analysis](https://www.revenue.state.mn.us/sites/default/files/2025-10/federal-update-overtime-subtraction.pdf) | excerpt (official). A CPA firm's summary of the 2026 bill agrees (secondary). |
| supplementalRate | **6.25%** on supplemental payments made separately | [2026 withholding instructions](https://www.revenue.state.mn.us/sites/default/files/2025-12/wh-inst-26.pdf) | excerpt (official). **Changed**: was unset. |
| Paid Leave (from Jan 1, 2026) | The premium is 0.88% (0.61% medical + 0.27% family), and employers may deduct up to 0.44% from wages. Wages are capped at **$185,000**, the SSA base ($184,500) rounded to the nearest $1,000, so the most an employee pays is $814. | [Paid Leave premium rate and contributions](https://pl.mn.gov/resources/calculators/premium-rate-and-contributions), [Minn. Stat. 268B.14](https://www.revisor.mn.gov/statutes/cite/268B.14) | excerpt (official). **Changed**: the cap was 184,500. |

---

## Not modeled

- **Refundable and low-income credits**: California EITC and Young Child Tax Credit, the Oregon Kids Credit and WFHDC, Minnesota's Child Tax Credit, New Mexico's child income tax credit, Hawaii's food/excise credit, and the Kansas food sales tax credit.
- **California**: HSA add-back (California taxes HSA contributions); renter's credit; 2026 indexing (2025 figures used).
- **Oregon**: Portland Arts Tax ($35 per adult; the engine has no per-person local type); the kicker; Multnomah PFA *without* Metro SHS (a few areas outside the Metro boundary).
- **New Mexico**: the $4,000 dependent deduction, whose current rule I couldn't confirm; the Workers' Compensation fee ($2 a quarter, a flat amount).
- **Montana**: the add-back of the federal QBI deduction (the state engine isn't given it) and the $5,500 subtraction for taxpayers 65 and older.
- **Bonus withholding** for HI and NM: `supplementalRate` is left unset, so the engine uses the marginal rate.
