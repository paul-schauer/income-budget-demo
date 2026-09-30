# 2026 state tax figures: no-tax and flat-rate states

Every figure in `js/states/no-tax-flat.js` and where it came from. Checked 2026-09-30 for tax year 2026.

**How these were checked.** The sandbox's network proxy blocked direct fetches of every state site (revenue departments, legislatures, paid-leave agencies, city sites), so no page could be opened and read in full. Figures were checked in three ways, and each row says which:

- **Official (search excerpt)**: the number appeared in a web-search excerpt of the official page listed.
- **Secondary**: from a source that isn't the issuing agency. Mostly the [PolicyEngine-US parameter files](https://github.com/PolicyEngine/policyengine-us/tree/master/policyengine_us/parameters/gov/states) (an open-source tax model; every parameter cites the statute or form it came from; read at commit `f7c6525`, 2026-09-29). Also Tax Foundation, CPA firms and payroll sites.
- **Prior-year**: no 2026 figure could be confirmed, so the latest confirmed one (2025) is used.
- **Not re-verified**: a long-standing published figure that no 2026 source could be checked against. The shared web-search budget ran out partway through this work.

Nothing below is marked "confirmed on the official site", because no official page could be opened directly.

Common values used in the tests: the 2026 federal standard deduction is $16,100 single, $32,200 joint and $24,150 head of household (see `docs/tax-sources.md`). The 2026 Social Security wage base is $184,500 (quoted in the WA ESD and Colorado FAMLI excerpts below).

---

## No income tax on wages

### Alaska (AK)

| Figure | Value | Source | Confidence |
|---|---|---|---|
| Income tax | None | [Tax Foundation 2026 table](https://taxfoundation.org/data/all/state/state-income-tax-rates-2026/) | Secondary |
| Employee unemployment insurance | 0.50% of wages up to $54,200 | [AK DOLWD 2026 UI tax rates](https://labor.alaska.gov/estax/2026-experience-rates.html) | Official (search excerpt) |

Alaska is one of three states where employees pay unemployment insurance. The other two are New Jersey and Pennsylvania.

### Florida (FL), Nevada (NV), South Dakota (SD), Texas (TX), Wyoming (WY)

| Figure | Value | Source | Confidence |
|---|---|---|---|
| Income tax | None | [Tax Foundation 2026 table](https://taxfoundation.org/data/all/state/state-income-tax-rates-2026/) | Secondary |
| Employee payroll deductions | None. Nevada's Modified Business Tax and all five states' unemployment taxes are employer-paid. | PolicyEngine-US lists only employer-side UI for these states | Secondary |

### New Hampshire (NH)

| Figure | Value | Source | Confidence |
|---|---|---|---|
| Income tax on wages | None. The interest and dividends tax was 3% for 2024 and was repealed for 2025 and later. | [Tax Foundation 2026 table](https://taxfoundation.org/data/all/state/state-income-tax-rates-2026/); PolicyEngine `nh/tax/income/rate.yaml` | Secondary |
| Employee payroll deductions | None. NH's paid family leave plan is voluntary. | Not confirmed in 2026 sources | Not re-verified |

### Tennessee (TN)

| Figure | Value | Source | Confidence |
|---|---|---|---|
| Income tax | None (the Hall tax on investment income ended in 2021) | [Tax Foundation 2026 table](https://taxfoundation.org/data/all/state/state-income-tax-rates-2026/) | Secondary |

### Washington (WA)

| Figure | Value | Source | Confidence |
|---|---|---|---|
| Income tax on wages | None. The capital gains tax doesn't apply to wages. A new "millionaires" income tax is scheduled for 2028, not 2026. | PolicyEngine `wa/tax/income/millionaires_tax/in_effect.yaml` | Secondary |
| PFML total premium | 1.13% of wages up to the SS wage base ($184,500) | [ESD news release](https://esd.wa.gov/about-us/news-release/2025/paid-family-medical-leave-premium-rate-increases-113-2026); [Paid Leave employer page](https://paidleave.wa.gov/employer-roles-responsibilities/) | Official (search excerpt) |
| PFML employee share | Up to 71.43%, so the employee rate is 1.13% × 71.43% ≈ 0.8072% | Same pages; PolicyEngine gives the 2026 employer share as 28.57% | Official (search excerpt) |
| PFML 2027 change | HB 2345 (2026) changes how the premium is split starting in 2027, not 2026 | [House bill report HB 2345](https://lawfilesext.leg.wa.gov/biennium/2025-26/Pdf/Bill%20Reports/House/2345%20HBR%20LAWS%2026.pdf) | Official (search excerpt) |
| WA Cares (long-term care) | 0.58% of all wages, no cap | [WA Cares FAQ](https://wacaresfund.wa.gov/help-support/frequently-asked-questions); [WA Cares employers](https://wacaresfund.wa.gov/employers) | Official (search excerpt) |

---

## Flat-rate states

### Arizona (AZ)

| Figure | Value | Source | Confidence |
|---|---|---|---|
| Rate | 2.5% flat | [2026 Form A-4](https://azdor.gov/sites/default/files/document/FORMS_WITHHOLDING_2026_A-4_f.pdf) ("for tax year 2023 and beyond… 2.5%") | Official (search excerpt) |
| Starting point | Federal AGI | [2025 Form 140 instructions](https://azdor.gov/sites/default/files/document/FORMS_INDIVIDUAL_2025_140i.pdf) | Secondary (PolicyEngine) |
| Standard deduction | Same as federal. HB 4168 (signed June 13, 2026) moves Arizona's IRC conformity date to Jan 1, 2026. 2025 was $15,750 single / $31,500 joint, matching federal. | [HB 4168 summary](https://www.azleg.gov/legtext/57leg/2R/summary/H.HB4168_061026_CAUCUSCOW.DOCX.htm); [Forvis Mazars](https://www.forvismazars.us/forsights/2026/07/arizona-updates-irc-conformity-date-to-january-1-2026) | Official (search excerpt) + secondary |
| Dependent credit | $125 per dependent under 17 (was $100); $25 for 17 and older. Loses 5% per $1,000 (or part) of AGI over $200,000, or $400,000 joint. | [HB 4168 text, §43-1073.01](https://www.azleg.gov/legtext/57leg/2R/bills/HB4168H.pdf) | Secondary (PolicyEngine, citing HB 4168) |
| Overtime | Deductible. HB 4168 adds subtractions for the federal tips and overtime deductions (A.R.S. 43-1022(31)-(32)) from 2025. | [Forvis Mazars](https://www.forvismazars.us/forsights/2026/07/arizona-updates-irc-conformity-date-to-january-1-2026) | Secondary |
| 401(k) | Not taxed | Follows federal AGI | Secondary |
| Supplemental rate | None set. Employees choose a withholding percentage on Form A-4 (2.0% if they don't choose). The engine falls back to the 2.5% marginal rate. | [Form A-4 employer instructions](https://azdor.gov/sites/default/files/document/FORMS_WITHHOLDING_2026_A-4i.pdf) | Official (search excerpt) |
| Payroll / locals | None | | |

### Colorado (CO)

| Figure | Value | Source | Confidence |
|---|---|---|---|
| Rate | 4.40%. The September 2026 forecast says the TABOR temporary rate cut is not triggered for 2025, 2026 or 2027. | [Legislative Council Sept 2026 forecast](https://content.leg.colorado.gov/sites/default/files/sept2026-forecast-with-cover-for-remediation-and-posting-accessible_0.pdf); [DR 1098 (2026 withholding)](https://tax.colorado.gov/DR1098) | Official (search excerpt) |
| Starting point | Federal taxable income | [Individual income tax guide](https://tax.colorado.gov/individual-income-tax-guide) | Official (search excerpt) |
| Overtime | Added back for 2026 (HB25-1296, C.R.S. 39-22-104(3)(u)). Tips are not added back. SB26-056 would limit the add-back to 2026 only; its final status wasn't confirmed, but 2026 is covered either way. | [HB25-1296 signed](https://content.leg.colorado.gov/sites/default/files/2025a_1296_signed.pdf); [Jan 2026 tax policy updates](https://tax.colorado.gov/january-2026-tax-policy-updates); [SB26-056](https://leg.colorado.gov/bills/SB26-056) | Official (search excerpt) + secondary (PolicyEngine) |
| High-income add-back | If AGI is over $300,000, add back the federal standard or itemized deduction above $1,000 ($2,000 joint). These amounts start in 2026 (HB25-1274, which took effect when Proposition MM passed); they were $12,000 / $16,000 before. | PolicyEngine `co/tax/income/additions/federal_deductions/` | Secondary |
| FAMLI | 0.88% total for 2026; employee pays 0.44%, up to the SS wage base ($184,500). It drops to 0.86% in 2027. | [FAMLI employers](https://famli.colorado.gov/employers); [premium calculator](https://famli.colorado.gov/individuals-and-families/premium-and-benefits-calculator) | Official (search excerpt) |
| 401(k) | Not taxed | Follows federal | Secondary |
| Supplemental rate | Not set. The engine uses 4.4%. | | |
| Locals | Not modeled. Denver charges a $5.75/month employee occupational privilege tax; Glendale ($5), Sheridan ($3) and Greenwood Village ($2) have their own. Aurora has one too, but its amount wasn't checked. These are flat monthly amounts, which no local type in the engine can express. | PolicyEngine `local/co/*/occupational_privilege` (citing Denver's business tax FAQ) | Secondary |

### Georgia (GA)

| Figure | Value | Source | Confidence |
|---|---|---|---|
| Rate | 4.99% for 2026 (HB 463, signed May 11, 2026; was 5.19%) | [Governor's release](https://gov.georgia.gov/press-releases/2026-05-11/gov-kemp-signs-legislation-lowering-taxes-and-supporting-economic-growth); [HB 463](https://gov.georgia.gov/document/2026-signed-legislation/hb-463/download) | Official (search excerpt) |
| Standard deduction | $15,000 single, head of household and married filing separately; $30,000 joint | [Employer's tax guide, June 2026](https://dor.georgia.gov/document/document-document/2026-employers-tax-guide-updated-june-2026/download); [Important tax updates](https://dor.georgia.gov/taxes/important-tax-updates) | Official (search excerpt). One secondary source (BDO) dated these to 2027; DOR's June 2026 guide and PolicyEngine both say 2026. |
| Personal exemption | None for filers (removed in 2024) | PolicyEngine `ga/tax/income/exemptions/personal/availability.yaml` | Secondary |
| Dependent exemption | $5,000 (was $4,000) | HB 463 §2-2; DOR guide excerpt | Official (search excerpt) + secondary |
| Overtime | Up to $1,750 of qualified overtime per full-time hourly worker, 2026–2028. There is a separate $1,750 cap for cash tips. Georgia doesn't follow the federal deduction itself. | HB 463 §2-4 (O.C.G.A. 48-7-27(a)(16)) | Official (search excerpt) + secondary (PolicyEngine) |
| Supplemental rate | 4.99% (withholding moved from 5.19% to 4.99% for pay from May 11, 2026) | DOR guide; payroll-site excerpts | Official (search excerpt) + secondary |
| 401(k) | Not taxed | | Secondary |
| Payroll / locals | None | | |

### Idaho (ID)

| Figure | Value | Source | Confidence |
|---|---|---|---|
| Rate | 5.3% (HB 40, 2025). No 2026 change found. | [Rate schedule](https://tax.idaho.gov/taxes/income-tax/individual-income/individual-income-tax-rate-schedule/); [HB 40](https://legislature.idaho.gov/sessioninfo/2025/legislation/H0040/) | Secondary (PolicyEngine, citing both) |
| 0% band | First $4,811 single / MFS; $9,622 joint / HOH. These are 2025 amounts; they're indexed and the 2026 amounts weren't found. This band is why Idaho is modeled as `graduated`. | [2025 instructions](https://tax.idaho.gov/wp-content/uploads/forms/EIN00046/EIN00046_09-29-2025.pdf) | Prior-year (2025) |
| Starting point | Federal AGI less the federal standard deduction and the Schedule 1-A deductions, which is effectively federal taxable income | [Idaho Tax Commission: conformity is law](https://tax.idaho.gov/pressrelease/update-on-filing-2025-idaho-income-taxes-now-that-conformity-is-law/) | Secondary (PolicyEngine) |
| Overtime | Follows the federal deduction for 2025–2028 | Same | Secondary |
| Child tax credit | $205 per qualifying child (nonrefundable) | PolicyEngine `id/tax/income/credits/ctc/amount.yaml` | Secondary |
| 401(k) | Not taxed | | Secondary |
| Supplemental rate | Not set. The engine uses 5.3%. | | |

### Illinois (IL)

| Figure | Value | Source | Confidence |
|---|---|---|---|
| Rate | 4.95% | [IDOR income tax rates](https://www2.illinois.gov/rev/research/taxrates/Pages/income.aspx); [35 ILCS 5/201](https://www.ilga.gov/legislation/ilcs/ilcs5.asp?ActID=577&ChapterID=8) | Secondary (PolicyEngine, citing both) |
| Exemption | $2,850 per filer and dependent. This is the 2025 amount; the 2026 cost-of-living amount wasn't found. | [2025 IL-1040 instructions](https://tax.illinois.gov/content/dam/soi/en/web/tax/forms/incometax/documents/currentyear/individual/il-1040-instr.pdf) | **Prior-year (2025)** |
| Exemption cutoff | None if AGI is over $250,000 ($500,000 joint) | 35 ILCS 5/204(g) | Secondary (PolicyEngine) |
| Starting point | Federal AGI; 401(k) not taxed | | Secondary |
| Overtime | Not deductible | [Search summaries of state conformity](https://bipartisanpolicy.org/explainer/no-tax-on-overtime-in-2026/) | Secondary |
| Payroll / locals | None. Chicago has no income tax. | | |

### Indiana (IN)

| Figure | Value | Source | Confidence |
|---|---|---|---|
| Rate | 2.95% for 2026 (IC 6-3-2-1 steps it down from 3.0% in 2025) | [IC 6-3-2-1](https://iga.in.gov/laws/2024/ic/titles/6#6-3-2-1) | Secondary (PolicyEngine) |
| Exemptions | $1,000 per filer and dependent, plus $1,500 per dependent child. The model gives every dependent $2,500. | [IC 6-3-1-3.5](https://iga.in.gov/laws/2024/ic/titles/6#6-3-1-3.5); [2025 IT-40 booklet](https://forms.in.gov/Download.aspx?id=16915) | Secondary |
| Overtime | Deductible for 2026 only (SB 243, IC 6-3-2-32). Tips have a matching deduction. | PolicyEngine `in/tax/income/deductions/deductions.yaml` | Secondary |
| County tax | **Not added.** No 2026 county rate table from in.gov could be found. The latest one PolicyEngine cites is the [2025 table](https://forms.in.gov/Download.aspx?id=16925) (rates 0.5% to 3.0%). The note asks users to enter their county's rate. | | |
| 401(k) | Not taxed | | Secondary |

### Iowa (IA)

| Figure | Value | Source | Confidence |
|---|---|---|---|
| Rate | 3.8% flat since 2025 | [IA 1040 instructions: Iowa tax](https://revenue.iowa.gov/taxes/tax-guidance/individual-income-tax/1040-expanded-instructions/iowa-tax); [2025 bracket release](https://revenue.iowa.gov/press-release/2024-10-16/idr-announces-2025-individual-income-tax-brackets-and-interest-rates) | Secondary (PolicyEngine, citing both) |
| Starting point | Federal taxable income, since 2023 | [IA 1040 instructions: Iowa taxable income](https://revenue.iowa.gov/taxes/tax-guidance/individual-income-tax/1040-expanded-instructions/iowa-taxable-income) | Secondary |
| Exemption credits | $40 per filer and dependent | PolicyEngine `ia/tax/income/credits/exemption/` | Secondary |
| Overtime | Deductible: the federal deduction carries through federal taxable income under Iowa's rolling IRC conformity, and no Iowa add-back was found. | PolicyEngine (no add-back listed) | **Secondary, unconfirmed** |
| Low-income exemption | No tax if income is $9,000 or less (single) or $13,500 or less (others). Not modeled. | PolicyEngine | Secondary |
| Supplemental rate | Not set. The engine uses 3.8%. | | |

### Massachusetts (MA)

| Figure | Value | Source | Confidence |
|---|---|---|---|
| Rate | 5.0% | [Circular M 2026](https://www.mass.gov/doc/massachusetts-circular-m-income-tax-withholding-tables-at-50-effective-january-1-2026/download) | Official (search excerpt) |
| 4% surtax threshold | $1,107,750 of taxable income in 2026 ($1,083,150 in 2025) | [4% surtax page](https://www.mass.gov/info-details/massachusetts-4-surtax-on-taxable-income); [2026 Form 1-ES](https://www.mass.gov/doc/2026-form-1-es-estimated-tax-payment-vouchers-instructions-and-worksheets/download) | Official (search excerpt) |
| Personal exemption | $4,400 single / MFS; $6,800 HOH; $8,800 joint (fixed in statute, not indexed) | [Personal exemptions](https://www.mass.gov/info-details/massachusetts-personal-income-tax-exemptions) | Official (search excerpt) |
| Dependent exemption | $1,000 | Same | Official (search excerpt) |
| FICA deduction | Social Security and Medicare withheld, up to $2,000 per person | [FICA and Medicare deduction](https://www.mass.gov/info-details/massachusetts-social-security-fica-and-medicare-deduction) | Official (search excerpt) |
| 401(k) | Not taxed | | Not re-verified |
| PFML | 0.88% total: 0.18% family plus 0.70% medical. Employees pay up to 100% of the family share and 40% of the medical share, so 0.18% + 0.28% = 0.46% of wages up to the SS wage base. | [PFML contribution rates](https://www.mass.gov/info-details/paid-family-and-medical-leave-employer-contribution-rates-and-calculator) | Official (search excerpt) + secondary (PolicyEngine) |
| Supplemental rate | 5.0% | Circular M | Not re-verified (equal to the flat rate) |
| Overtime | Not deductible | | Secondary |

### Michigan (MI)

Already present and unchanged. See `docs/tax-sources.md`.

### Ohio (OH)

| Figure | Value | Source | Confidence |
|---|---|---|---|
| Rate schedule | 0% up to $26,050 of taxable nonbusiness income; above that, $332 plus 2.75% of the excess. That's a small cliff at $26,050, so Ohio is modeled as `graduated`, with the $332 applied in `compute`. | [HB 96 bill analysis (enacted)](https://www.lsc.ohio.gov/assets/legislation/136/hb96/en0/files/hb96-tax-bill-analysis-as-enacted-136th-general-assembly.pdf); [2026 IT 1040ES worksheet](https://dam.assets.ohio.gov/image/upload/v1735926006/tax.ohio.gov/forms/ohio_individual/individual/2026/ites-instructions-fi.pdf) | Official (search excerpt) + secondary. PolicyEngine's 2026 implied rate × $26,050 = $332.00. The base was $342 in 2025 and $360.69 in 2024. |
| Exemptions | $2,400 per person if MAGI ≤ $40,000; $2,150 if ≤ $80,000; $1,900 above that; none above $500,000 (the cutoff was $750,000 in 2025) | [2025 IT 1040 booklet](https://dam.assets.ohio.gov/image/upload/v1767095693/tax.ohio.gov/forms/ohio_individual/individual/2025/it1040-booklet.pdf); [R.C. 5747.025](https://codes.ohio.gov/ohio-revised-code/section-5747.025) | Official (search excerpt). The 2026 ES worksheet uses $1,900, which matches the 2025 tiers. One search summary gave $2,350 / $2,100 / $1,850 for 2026, but that couldn't be confirmed and conflicts with the worksheet. |
| Exemption credit | $20 per exemption if income is under $30,000 | [R.C. 5747.022](https://codes.ohio.gov/ohio-revised-code/section-5747.022) | Official (search excerpt) |
| Joint filing credit | 20% / 15% / 10% / 5% of tax for income less exemptions of ≤ $25,000 / $50,000 / $75,000 / more; at most $650. Both spouses need $500+ of income, and MAGI must be under $500,000 in 2026. | [R.C. 5747.05](https://codes.ohio.gov/ohio-revised-code/section-5747.05/9-30-2025) | Official (search excerpt) + secondary |
| Supplemental rate | 2.75%, the top rate in R.C. 5747.02(A)(3) | [OAC 5703-7-10](https://codes.ohio.gov/ohio-administrative-code/rule-5703-7-10) | Official (search excerpt) |
| Overtime | Not deductible (Ohio starts from federal AGI) | | Secondary |
| Columbus | 2.5% | No 2026 source retrieved | **Not re-verified** |
| Cleveland | 2.5% | No 2026 source retrieved | **Not re-verified** |
| Cincinnati | 1.8% | No 2026 source retrieved | **Not re-verified** |

Ohio cities tax wages earned in the city at the same rate for residents and nonresidents. Residents who work somewhere else get a credit that varies by city, which isn't modeled. The tax base is Medicare wages, which include 401(k) deferrals; the engine's `wages` includes them too.

### Pennsylvania (PA)

| Figure | Value | Source | Confidence |
|---|---|---|---|
| Rate | 3.07% | [PA tax rates](https://www.revenue.pa.gov/Tax%20Rates/Pages/default.aspx) | Official (search excerpt) |
| Base | All compensation. Employee 401(k) deferrals are taxable (`taxes401k: true`). No standard deduction or exemptions. | [PA personal income tax](https://www.revenue.pa.gov/TaxTypes/PIT/Pages/default.aspx) | Not re-verified (well-established) |
| Employee UC withholding | 0.07% of all wages, no cap (2026) | [PA L&I employee withholding](https://www.pa.gov/agencies/dli/resources/for-employers-and-educators/how-to-file/uc-tax/employee-withholding) | Official (search excerpt) |
| Philadelphia wage tax | 3.735% resident / 3.425% nonresident for pay dates from July 1, 2026 (3.74% / 3.43% through June 30, 2026). The code uses the current rates. | [Wage Tax (employers)](https://www.phila.gov/services/payments-assistance-taxes/taxes/business-taxes/business-taxes-by-type/wage-tax-employers/) | Official (search excerpt) + secondary (CPA firm notices) |
| Pittsburgh EIT | 3% resident (1% city plus 2% school district); 1% nonresident. Nonresidents are withheld at the higher of this and their home municipality's rate. | [Pittsburgh tax FAQs](https://www.pittsburghpa.gov/City-Government/Finance-Budget/Taxes/Tax-FAQs); [DCED PSD codes and EIT rates](https://dced.pa.gov/local-government/local-income-tax-information/psd-codes-and-eit-rates/) | Secondary (search summary) |
| Supplemental rate | 3.07% | | Not re-verified (equal to the flat rate) |
| Overtime | Not deductible | | Secondary |

### Utah (UT)

| Figure | Value | Source | Confidence |
|---|---|---|---|
| Rate | 4.45% (SB 60, 2026; was 4.5%) | [SB 60](https://le.utah.gov/~2026/bills/static/SB0060.html); [enrolled text](https://le.utah.gov/Session/2026/bills/enrolled/SB0060.pdf) | Secondary (PolicyEngine, citing SB 60) |
| Taxpayer tax credit | 6% of (federal standard deduction + $2,111 per dependent), less 1.3% of income over $18,213 single / MFS, $27,320 HOH or $36,426 joint. These are 2025 amounts; they're indexed and the 2026 amounts weren't found. | [Taxpayer tax credit](https://incometax.utah.gov/credits/taxpayer-tax-credit); [TC-40 instructions](https://tax.utah.gov/forms/current/tc-40inst.pdf) | **Prior-year (2025)**, secondary |
| Child tax credit | $1,000 per child under 6; phases out at 10% above $49,000 single / HOH, $61,000 joint or $30,500 MFS (HB 290, 2026). Not modeled, because child ages aren't known. | [HB 290](https://le.utah.gov/~2026/bills/static/HB0290.html) | Secondary |
| Overtime | Not deductible | | Secondary |
| 401(k) | Not taxed | | Secondary |

---

## Not modeled

- **Indiana county income tax** (every county, on Indiana AGI). No 2026 in.gov table could be found; users can enter it as Other local tax %.
- **Ohio school district income tax**, and credits Ohio cities give residents who work elsewhere.
- **Iowa school district surtax** (a percentage of state tax, varies by district).
- **Pennsylvania local EIT outside Philadelphia and Pittsburgh**, and the Local Services Tax (up to $52 a year).
- **Colorado occupational privilege taxes** (flat monthly amounts in Denver, Aurora, Glendale, Greenwood Village and Sheridan).
- **Washington L&I workers' comp employee share** (hourly, varies by risk class). WA Cares also doesn't apply to workers with an approved exemption.
- **Refundable and age-based credits**: MA Child and Family Tax Credit ($440 per child under 13), Utah child tax credit (children under 6), Idaho grocery credit, Illinois child tax credit and state EITCs, Arizona's $25 credit for dependents 17 and older (every dependent gets $125).
- **Low-income rules**: PA tax forgiveness, MA No Tax Status and Limited Income Credit, Iowa's low-income exemption.
- **Georgia's overtime cap is applied per filer**, not per worker. The engine only knows the household's total overtime deduction, so one spouse's overtime can use both spouses' $1,750 caps.
- **Indiana's extra $1,500 exemption** is given to every dependent, not only dependent children.
- **Colorado's high-income add-back** uses the federal standard deduction, even for filers who itemize.
- **Tip deductions** in any state.
