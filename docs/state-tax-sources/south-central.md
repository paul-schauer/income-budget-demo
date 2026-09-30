# South and Central states: 2026 figures and sources

Figures in `js/states/south-central.js`, tested by `test/states-south-central.test.js`. Checked 2026-09-30.

States: Alabama, Arkansas, Kentucky, Louisiana, Mississippi, Missouri, North Carolina, Oklahoma, South Carolina, Virginia, West Virginia, Wisconsin.

## How these were checked, and what's still open

- The sandbox's proxy blocked direct fetches of every state revenue and legislature site. Figures were checked through web-search excerpts, with the search limited to the official domain where possible.
- The shared web-search budget ran out after Alabama, Arkansas, Missouri, Oklahoma, South Carolina, Virginia and one West Virginia search. **Kentucky, Louisiana, Mississippi, North Carolina and Wisconsin (and the rest of West Virginia) could not be searched.** For those, and to cross-check the rest, I used [PolicyEngine's open-source parameter files](https://github.com/PolicyEngine/policyengine-us) as of commit `f7c6525` (2026-09-29). Each file cites the official form, statute or bill, and the table lists that citation. These are flagged **secondary**.
- **Figures to check before release:** Kentucky's 2026 standard deduction, Wisconsin's 2026 standard deduction table, South Carolina's 2026 dependent exemption (all prior-year), Birmingham's rate and the Lexington school tax (unverified), and the overtime status of Missouri, Kentucky, Louisiana, Mississippi, North Carolina, West Virginia and Wisconsin (no enacted state deduction found, but not searched).
- **Federal income tax deduction.** Alabama allows a full deduction for federal income tax, and Missouri allows a partial one. Both use `ctx.federalTax`: household federal income tax after credits, not counting FICA.
- **One change from the brief.** South Carolina starts from **federal AGI** in 2026, not federal taxable income. H.4216 (Act 110, signed 2026-03-30) replaced the federal standard deduction with the SC Income Adjusted Deduction.

**Confidence flags**

- **excerpt (official)**: the exact number appeared in a search excerpt from the agency's or legislature's own page or PDF. I couldn't open the page itself.
- **secondary**: from PolicyEngine's parameter file, which cites the official source linked in the table, or from a news or advocacy source.
- **prior-year**: the latest confirmed amount is for an earlier year; the year is given.
- **derived**: computed from confirmed figures using a stated rule.
- **unverified**: from recall of the named source, not checked this session.

---

## Alabama (AL)

| Figure | Value | Source | Flag |
|---|---|---|---|
| Brackets | Single, MFS and HOH: 2% to $500, 4% to $3,000, 5% above. MFJ: 2% to $1,000, 4% to $6,000, 5% above | [ALDOR withholding booklet, Jan 2026](https://www.revenue.alabama.gov/wp-content/uploads/2026/01/whbooklet_0126.pdf); [2025 Form 40 booklet](https://www.revenue.alabama.gov/wp-content/uploads/2026/01/25f40bk.pdf) | excerpt (official); PolicyEngine agrees (Code 40-18-5) |
| Starting point | Alabama AGI, which for wages equals federal AGI | 2025 Form 40 booklet | secondary |
| Standard deduction (AGI-based chart) | Single: $3,000 below $25,500 AGI, less $25 per full $500 above, floor $2,500. MFJ: $8,500, less $175 per $500, floor $5,000. MFS: $4,250 below $12,750, less $88 per $250, floor $2,500. HOH: $5,200, less $135 per $500, floor $2,500 | [Code of Ala. 40-18-15](https://law.justia.com/codes/alabama/title-40/chapter-18/article-1/section-40-18-15/); [ALDOR FAQ](https://www.revenue.alabama.gov/faqs/how-much-is-the-alabama-standard-deduction/) | excerpt (statute text; the ALDOR chart's first row, $0–$25,999, confirms whole steps) |
| Personal exemption | $1,500 single and MFS; $3,000 MFJ and HOH | Withholding booklet 2026 | excerpt (official) |
| Dependent exemption | $1,000 each if AGI ≤ $50,000; $500 if ≤ $100,000; $300 above | Withholding booklet 2026 | excerpt (official). The booklet says "gross income"; the code uses AGI |
| Federal income tax deduction | Full federal income tax, from `ctx.federalTax` | Code 40-18-15; PolicyEngine (Code 40-18-21, Form 40 instructions) | secondary |
| Overtime | Act 2026-604 (HB 527, signed 2026-04-16): deduct the overtime premium, up to $1,000 per taxpayer, for 2026–2028. The full exemption for 2024 to June 2025 has expired. The code uses the lesser of the federal overtime deduction and $1,000 × filers. `overtimeDeduction` is false because the federal deduction isn't adopted | [ALDOR: Overtime Premium Deduction](https://www.revenue.alabama.gov/individual-corporate/overtime-premium-deduction-act-2026-604/) | excerpt (official) |
| 401(k) deferrals | Excluded | — | unverified |
| Supplemental rate | Not set; the app uses the marginal rate (5%) | — | — |
| Payroll deductions | None | — | unverified |
| Birmingham occupational tax | 1% of pay earned in the city, the same for residents and nonresidents | — | unverified |

## Arkansas (AR)

Act 1 of the 2026 First Extraordinary Session (HB 1001, signed 2026-05-06) cut the top rate to 3.7%, effective for 2026.

| Figure | Value | Source | Flag |
|---|---|---|---|
| Standard table (net income ≤ $94,700), all statuses | 0% to $5,599 · 2% $5,600–11,199 · 3% $11,200–15,999 · 3.4% $16,000–26,399 · 3.7% from $26,400 | [DFA fiscal impact statement, HB 1001](https://www.arkleg.state.ar.us/Home/FTPDocument?path=%2FAssembly%2F2025%2F2026S1%2FFiscal+Impacts%2FHB1001-DFA1.pdf); [Act 1 of 2026](https://www.arkleg.state.ar.us/Home/FTPDocument?path=%2FACTS%2F2026S1%2FPublic%2FACT1.pdf) | excerpt (official); PolicyEngine agrees |
| Upper table (net income > $94,700) | 2% on the first $4,700, 3.7% above, less a bracket adjustment for net income from $94,701 to $97,600 | DFA fiscal impact statement | excerpt (official) |
| Bracket adjustment | $290 at $94,700, $10 less per $100, $0 at $97,600 | PolicyEngine (citing Act 1) | secondary |
| Indexing | Act 1's bounds are indexed from 2027. DFA hasn't published a 2026 indexed-brackets card, and its 2026 withholding formula uses Act 1's bounds | PolicyEngine issue #9639 | secondary |
| Standard deduction | $2,470 per taxpayer ($4,940 MFJ) | [DFA 2026 withholding formula](https://www.dfa.arkansas.gov/wp-content/uploads/whformula_2026.pdf) | excerpt (official). The 2026 return instructions aren't out yet |
| Personal tax credit | $29 per filer and per dependent | [2025 AR1000F instructions](https://www.dfa.arkansas.gov/wp-content/uploads/2025_AR1000F_and_AR1000NR_Instructions.pdf) | excerpt (official), prior-year (2025) |
| Married filing separately on the same return (status 4) | Each spouse takes their own deduction and uses the table on their own income. The code uses the lower of this and filing jointly | 2025 AR1000F instructions | unverified |
| Supplemental rate | 3.7% | [DFA withholding instructions](https://www.dfa.arkansas.gov/wp-content/uploads/withholdInstructions.pdf), via a payroll site's summary | secondary |
| Overtime | Not adopted: HB 1822 (2025) died in committee | BillTrack50 | secondary |
| Starting point, 401(k), payroll deductions | AGI; deferrals excluded; none | — | unverified |

## Kentucky (KY)

| Figure | Value | Source | Flag |
|---|---|---|---|
| Rate | 3.5% flat for 2026 (HB 1 of 2025) | [HB 1 (2025)](https://apps.legislature.ky.gov/record/25rs/hb1.html) | secondary |
| Starting point | Federal AGI | [2025 Form 740](https://revenue.ky.gov/Forms/740%20(2025).pdf) | secondary |
| Standard deduction | $3,270 per return. When both spouses earn, filing separately on a combined return (status 3) gives each one a deduction, and the code does that | [KY DOR: 2025 standard deduction](https://revenue.ky.gov/News/Pages/Kentucky-DOR-Announces-2025-Standard-Deduction.aspx) | secondary, **prior-year (2025)**. The 2026 amount is indexed and unconfirmed |
| Personal exemptions | None; the family size credit applies to low incomes only | 2025 Form 740 | secondary |
| Louisville Metro (Jefferson County) | 2.20% for residents (1.25% Metro + 0.20% TARC + 0.75% school board), 1.45% for nonresidents | [Louisville Metro W-1KJC instructions, 2025](https://louisvilleky.gov/sites/default/files/2024-12/w-1kjc_instructions_2025.pdf) | secondary |
| Lexington-Fayette | LFUCG fee 2.25%. The code adds the 0.5% Fayette County schools tax for residents: 2.75% for residents, 2.25% for nonresidents | [LFUCG rates](https://www.lexingtonky.gov/working/business-licensing-taxes/occupational-license-fee-rates-current-forms) | 2.25%: secondary. 0.5%, and that only residents pay it: unverified |
| Overtime, supplemental rate, 401(k), payroll deductions | No state overtime deduction found; supplemental rate not set (the flat 3.5% is used); deferrals excluded; none | — | unverified |

## Louisiana (LA)

| Figure | Value | Source | Flag |
|---|---|---|---|
| Rate | 3% flat since 2025 (2024 Third Extraordinary Session) | [R.S. 47:32](https://www.legis.la.gov/legis/Law.aspx?d=101946); [2025 IT-540i](https://dam.ldr.la.gov/taxforms/IT540i%20WEB(2025)D11.pdf) | secondary |
| Standard deduction | 2026: $12,835 single and MFS; $25,670 MFJ and HOH. 2025 was $12,500 and $25,000, indexed to CPI from 2026 | [R.S. 47:293](https://www.legis.la.gov/legis/Law.aspx?d=101761); [Louisiana Register, Feb 2026](https://bese.louisiana.gov/docs/default-source/rulemaking-docket/feb-louisiana-register.pdf) | secondary |
| Personal and dependent exemptions | Repealed from 2025, replaced by the standard deduction | 2025 IT-540i | secondary |
| Overtime, supplemental rate, 401(k), payroll deductions | No state overtime deduction found; supplemental rate not set; deferrals excluded; none | — | unverified |

## Mississippi (MS)

| Figure | Value | Source | Flag |
|---|---|---|---|
| Rate | 0% on the first $10,000 of taxable income, 4.0% above for 2026 (HB 1 of 2025: 4.4% in 2025, then down 0.25 points a year to 3% in 2030) | [MS DOR tax rates](https://www.dor.ms.gov/individual/tax-rates); [Miss. Code 27-7-5](https://law.justia.com/codes/mississippi/title-27/chapter-7/article-1/section-27-7-5/) | secondary |
| Joint returns | Each spouse's tax is figured on their own income, and deductions and exemptions can be split any way, so each spouse can use a $10,000 zero band | [Miss. Code 27-7-21](https://law.justia.com/codes/mississippi/title-27/chapter-7/article-1/section-27-7-21/); [2025 Form 80-100 instructions](https://www.dor.ms.gov/sites/default/files/tax-forms/individual/80100251%202.pdf) | secondary |
| Standard deduction | $2,300 single · $4,600 MFJ · $2,300 MFS · $3,400 HOH | 2025 Form 80-100 instructions | secondary |
| Exemptions | $6,000 single · $12,000 MFJ · $6,000 MFS · $8,000 HOH, plus $1,500 per dependent | 2025 Form 80-100 instructions | secondary |
| Overtime, supplemental rate, 401(k), payroll deductions | No state overtime deduction found; supplemental rate not set; deferrals excluded; none | — | unverified |

## Missouri (MO)

| Figure | Value | Source | Flag |
|---|---|---|---|
| Brackets, all statuses | 0% to $1,348, then 2.0 / 2.5 / 3.0 / 3.5 / 4.0 / 4.5% on each further $1,348, and 4.7% above $9,436 | [2026 MO withholding formula](https://dor.mo.gov/forms/Withholding%20Formula_2026.pdf) | excerpt (official). The 2025 widths were $1,313 |
| Starting point / standard deduction | Federal AGI; the federal standard deduction | 2026 withholding formula | excerpt (official) |
| Federal income tax deduction | 35% of federal tax if MO AGI ≤ $25,000; 25% to $50,000; 15% to $100,000; 5% to $125,000; 0% above. Capped at $5,000, or $10,000 on a joint return | [MO DOR: federal income tax deduction](https://dor.mo.gov/personal/individual/fitdeduc.php) | excerpt (official). PolicyEngine caps single filers at $10,000; the code follows DOR's "$5,000 for an individual" |
| Head of household exemption | $1,400 | RSMo 143.161(2) and MO-1040 line 15, per PolicyEngine | secondary |
| Supplemental rate | 4.7% | 2026 withholding formula | excerpt (official) |
| Kansas City earnings tax | 1% on all earnings for residents, and on pay earned in the city for nonresidents. Renewed by voters 2026-04-07 | [KCMO earnings tax](https://www.kcmo.gov/city-hall/departments/finance/earnings-tax); KCUR, KCTV5 | secondary |
| St. Louis earnings tax | 1%, same rule. Renewed 2026-04-07 (Proposition E) | [St. Louis earnings tax](https://www.stlouis-mo.gov/government/departments/collector/earnings-tax/file-earnings-tax.cfm); STLPR | secondary |
| Overtime | Not adopted as far as I could confirm. HB 860 (a 100% overtime deduction from 2026) was pending, and no enacted overtime statute was found as of March 2026. Whether it passed is **unconfirmed** | BillTrack50; KBIA | secondary / unverified |

## North Carolina (NC)

| Figure | Value | Source | Flag |
|---|---|---|---|
| Rate | 3.99% flat for 2026 (4.25% in 2025) | [NCDOR tax rate schedules](https://www.ncdor.gov/taxes-forms/individual-income-tax/tax-rate-schedules) | secondary |
| Standard deduction | $12,750 single and MFS · $25,500 MFJ · $19,125 HOH | [NCDOR standard deduction](https://www.ncdor.gov/taxes-forms/individual-income-tax/filing-topics/north-carolina-standard-deduction-or-north-carolina-itemized-deductions) | secondary |
| Child deduction, per child | $3,000, less $500 per AGI step until $0. MFJ steps end at $40k/60k/80k/100k/120k/140k; single and MFS at $20k/30k/40k/50k/60k/70k; HOH at $30k/45k/60k/75k/90k/105k | [NCDOR child deduction](https://www.ncdor.gov/taxes-forms/individual-income-tax/filing-topics/north-carolina-child-deduction) | secondary |
| Supplemental rate | Not set. NC-30's supplemental rate wasn't checked | — | — |
| Overtime, 401(k), payroll deductions | No state overtime deduction found; deferrals excluded; none | — | unverified |

## Oklahoma (OK)

| Figure | Value | Source | Flag |
|---|---|---|---|
| Brackets (HB 2764 of 2025, from 2026) | Single and MFS: 0% to $3,750, 2.5% to $4,900, 3.5% to $7,200, 4.5% above. MFJ and HOH: $7,500 / $9,800 / $14,400 | [OTC 2025 legislative summary](https://oklahoma.gov/content/dam/ok/en/tax/documents/resources/publications/legislation/2025LegislativeUpdate.pdf); [2026 OW-2 tables](https://www.oklahoma.gov/content/dam/ok/en/tax/documents/resources/publications/businesses/withholding-tables/WHTables-2026.pdf) | excerpt (official); PolicyEngine agrees |
| Standard deduction | $6,350 single and MFS · $12,700 MFJ · $9,350 HOH | [OTC](https://oklahoma.gov/tax/individuals/exemptions.html) | excerpt (official) |
| Exemptions | $1,000 per filer and per dependent | OTC exemptions page | excerpt (official) |
| Supplemental rate | 4.5% (Rule 710:90-1-6: the year's top rate) | 2026 OW-2, via a payroll site's summary | secondary |
| Overtime | Not adopted. Oklahoma starts from federal AGI, and the federal overtime deduction comes after AGI. One secondary site claimed automatic conformity; I rejected that for this reason | — | derived |
| 401(k), payroll deductions | Deferrals excluded; none | — | unverified |

## South Carolina (SC)

H.4216 (Act 110 of 2026, signed 2026-03-30) applies from tax year 2026.

| Figure | Value | Source | Flag |
|---|---|---|---|
| Starting point | **Federal AGI** (was federal taxable income) | [SCDOR: Information about H. 4216](https://dor.sc.gov/news/information-about-h-4216) | excerpt (official) |
| Rates, all statuses | 1.99% on taxable income under $30,000. From $30,000: 5.21% minus $966, which is 1.99% on the first $30,000 and 5.21% above | SCDOR H. 4216 page | excerpt (official) |
| SC Income Adjusted Deduction (SCIAD) | $15,000 single and MFS · $30,000 MFJ · $22,500 HOH, reduced by the fraction (AGI − start) / width: single $40,000 / $55,000; MFJ $80,000 / $110,000; HOH $60,000 / $82,500 | SCDOR H. 4216 page; [H.4216 text](https://www.scstatehouse.gov/sess126_2025-2026/bills/4216.htm) | excerpt (official). MFS uses the single figures, per PolicyEngine citing 12-6-1140(15)(b) |
| Dependent exemption | $4,930 per dependent. H.4216 keeps all other deductions and exemptions | [2025 SC1040 instructions](https://dor.sc.gov/sites/dor/files/forms/SC1040Instr_2025.pdf); SCDOR H. 4216 page | excerpt (official), **prior-year (2025)**. The 2026 indexed amount isn't published |
| Two-wage-earner credit | 0.7% of the lower-earning spouse's earned income, up to $50,000 (max $350) | 2025 SC1040 instructions, per PolicyEngine | secondary |
| Overtime | Not adopted. H.3368 (exclude overtime and the first $2,500 of bonuses) passed the House and is in the Senate. For 2025, SC added back the federal overtime deduction | [H.3368](https://www.scstatehouse.gov/sess126_2025-2026/bills/3368.htm); SCDOR conformity update, per PolicyEngine | excerpt (official) |
| Supplemental rate | Not set. SCDOR publishes no flat rate; secondary sources disagree (6%, 6.2%, none) | — | secondary |
| 401(k), payroll deductions | Deferrals excluded; none | — | unverified |

## Virginia (VA)

| Figure | Value | Source | Flag |
|---|---|---|---|
| Brackets, all statuses | 2% to $3,000, 3% to $5,000, 5% to $17,000, 5.75% above. No 2026 change; the high-earner bracket bills (HB 979, HB 188) were continued | [Virginia Tax: new laws](https://www.tax.virginia.gov/news/new-virginia-tax-laws); [2025 Form 760 instructions](https://www.tax.virginia.gov/sites/default/files/vatax-pdf/2025-760-instructions.pdf) | excerpt (official); PolicyEngine agrees |
| Standard deduction | 2026: $8,750 single, MFS and HOH (Virginia has no HOH status, so it's the single amount); $17,500 MFJ. Rises to $9,200 / $18,400 in 2027 | [Virginia Tax: deductions](https://www.tax.virginia.gov/deductions) | excerpt (official) |
| Exemptions | $930 per filer and per dependent | Virginia Tax | excerpt (official) |
| Spouse tax adjustment | Joint filers who both have income: tax on joint taxable income minus the tax on each spouse's share figured separately, capped at $259. The code splits taxable income in proportion to earnings | 2025 Form 760 instructions, per PolicyEngine | secondary |
| Supplemental rate | 5.75% | [VA employer withholding guide](https://www.tax.virginia.gov/sites/default/files/vatax-pdf/employer-withholding-instructions.pdf) | excerpt (official) |
| Overtime | Not adopted. Virginia conforms to 2025 H.R. 1 only where it changes federal AGI or itemized deductions | [Tax Bulletin 26-1](https://www.tax.virginia.gov/laws-rules-decisions/tax-bulletins/26-1) | excerpt (official) + derived |
| 401(k), payroll deductions | Deferrals excluded; none | — | unverified |

## West Virginia (WV)

| Figure | Value | Source | Flag |
|---|---|---|---|
| Rates (SB 392, signed 2026-03-31, retroactive to 2026-01-01) | 2.11% to $10,000, 2.81% to $25,000, 3.16% to $40,000, 4.22% to $60,000, 4.58% above. Single, MFJ and HOH share these; MFS thresholds are half ($5k / $12.5k / $20k / $30k) | [WV Tax: 2026 rate cut](https://tax.wv.gov/Individuals/Pages/PersonalIncomeTaxReductionBill.aspx); [SB 392](https://www.wvlegislature.gov/Bill_Text_HTML/2026_SESSIONS/RS/bills/sb392%20sub1%20enr.pdf); [IT-100.2A](https://tax.wv.gov/Documents/Withholding/it100.2a.pdf) | excerpt (official) for the rates; secondary for the thresholds and MFS |
| Exemptions / standard deduction | $2,000 per filer and per dependent; no standard deduction | [2025 IT-140 instructions](https://tax.wv.gov/Documents/PIT/2025/it140.PersonalIncomeTaxFormsAndInstructions.2025.pdf) | secondary |
| Overtime, supplemental rate, 401(k), payroll deductions | No state overtime deduction found; supplemental rate not set; deferrals excluded; none | — | unverified |

## Wisconsin (WI)

| Figure | Value | Source | Flag |
|---|---|---|---|
| Brackets 2026 | Single and HOH: 3.5% to $15,110, 4.4% to $51,950, 5.3% to $332,720, 7.65% above. MFJ: $20,150 / $69,260 / $443,630. MFS: $10,080 / $34,630 / $221,820 | [2026 Form 1-ES instructions](https://www.revenue.wi.gov/TaxForms2026/2026-Form1-ES-Inst.pdf) | secondary |
| Standard deduction (sliding) | Single: $13,560 less 12% of AGI over $19,550. MFJ: $25,110 less 19.778% over $28,210. MFS: $11,930 less 19.778% over $13,390. HOH: $17,520 less 22.515% over $19,550 until it meets the single amount, then the single amount | [2025 Form 1 instructions](https://www.revenue.wi.gov/TaxForms2025/2025-Form1-inst.pdf); [Wis. Stat. 71.05(22)(dm)](https://docs.legis.wisconsin.gov/statutes/statutes/71/i/05/22/dm) | secondary, **prior-year (2025)**. The 2026 amounts are indexed and unconfirmed |
| Exemptions | $700 per filer and per dependent | 2025 Form 1 instructions | secondary |
| Married couple credit | 3% of the lower-earning spouse's earned income, up to $16,000 (max $480) | 2025 Form 1 instructions | secondary |
| Overtime, supplemental rate, 401(k), payroll deductions | No state overtime deduction found; supplemental rate not set; deferrals excluded; none | — | unverified |

---

## Not modeled

- Itemized deductions, and credits other than those listed above: EITCs, child-care credits, and Arkansas's and Kentucky's low-income credits.
- Arkansas's low-income tax tables, and the $100-row rounding in state tax tables generally (Arkansas, Missouri, Virginia, Wisconsin). The code applies the rate schedules directly.
- Age, blindness and retirement-income exemptions everywhere, including Wisconsin's new retirement exclusion.
- South Carolina's extra deduction for dependents under 6 (needs ages).
- North Carolina's child deduction, which counts every dependent as a qualifying child (the app doesn't separate children from other dependents).
- Alabama's overtime cap applies per taxpayer; the code caps the household at $1,000 × filers because it doesn't know each spouse's overtime.
- The Louisville and Lexington school-tax wage caps. Local occupational and earnings taxes other than Birmingham, Kansas City, St. Louis, Louisville and Lexington: use Other local tax %.
- The federal income tax deduction (AL, MO) uses federal tax after all credits. Alabama and Missouri add back only some refundable credits, so this is slightly off when refundable credits apply.
