# Northeast and Mid-Atlantic: 2026 state tax figures and sources

Every figure in `js/states/northeast.js` and where it came from. Checked 2026-09-30.

**How these were checked.** The sandbox's network proxy blocked every state website (tax.ny.gov, nj.gov, portal.ct.gov, tax.ri.gov, tax.vermont.gov, maine.gov, delaware.gov, marylandcomptroller.gov, otr.cfo.dc.gov), so no official page could be opened directly. Figures were checked two ways:

1. **Search excerpt only**: a web search restricted to the official domain returned an excerpt showing the number. The shared search quota ran out partway through (New York, New Jersey, Connecticut, Rhode Island and the payroll programs were checked this way).
2. **Secondary**: two open-source tax datasets on GitHub that cite the official document for each value. [PolicyEngine US](https://github.com/PolicyEngine/policyengine-us) (parameters at commit `f7c6525`, 2026-09-29) and the [income-tax-calculator 2026 data](https://github.com/Ebonsignori/income-tax-calculator/tree/main/src/data/2026) (entries marked verified 2026-09). Where they cite a document, the table lists that document. A third calculator dataset was used once, as noted.

Flags: **confirmed** (read on the official site: none this time), **excerpt** (search excerpt from the official domain), **secondary** (one or both datasets above, quoting the official document), **prior-year** (the latest confirmed value, from an earlier year, because 2026 couldn't be confirmed).

Test households used in `test/states-northeast.test.js`: single, $55,000 wages, 5% traditional 401(k), AGI $52,250; married filing jointly, $95,000 + $45,000 wages, two children, no 401(k), AGI $140,000.

## New York

| Figure | Value | Source | Flag |
|---|---|---|---|
| 2026 rates for the first five brackets | 3.9%, 4.4%, 5.15%, 5.4%, 5.9% (each cut 0.1 point, Ch. 59 of 2025, Part A) | [Withholding tax rate changes](https://www.tax.ny.gov/bus/wt/rate.htm), [NYS-50-T-NYS (1/26)](https://www.tax.ny.gov/pdf/publications/withholding/nys50_t_nys.pdf), [IT-2105-I (2026)](https://www.tax.ny.gov/pdf/current_forms/it/it2105i.pdf) | excerpt |
| Upper rates | 6.85%, 9.65%, 10.3%, 10.9% | IT-201-I rate schedules (via PolicyEngine) | secondary |
| Bracket thresholds (not indexed) | Single/MFS 8,500 / 11,700 / 13,900 / 80,650 / 215,400 / 1,077,550 / 5M / 25M. MFJ 17,150 / 23,600 / 27,900 / 161,550 / 323,200 / 2,155,350 / 5M / 25M. HOH 12,800 / 17,650 / 20,900 / 107,650 / 269,300 / 1,616,450 / 5M / 25M | IT-201-I; the 2026 change notice mentions rates only | secondary |
| Standard deduction | 8,000 / 16,050 / 8,000 / 11,200 (single / MFJ / MFS / HOH) | IT-201-I | secondary |
| Dependent exemption | $1,000 each; no exemption for the filers | IT-201-I | secondary |
| Recapture (supplemental tax) | NY AGI over $107,650: the worksheets are modeled in `nyTax()`. Recapture bases are computed from the schedule: $333 / $1,140 / $4,211 joint match the 2026 dataset values. For single filers the first base computes to $568.25; one dataset lists $567, so a cent-to-a-dollar difference is possible. | [IT-2105-I (2026)](https://www.tax.ny.gov/pdf/current_forms/it/it2105i.pdf) worksheets (the excerpt shows the 5.40% and 5.90% steps) | excerpt + secondary |
| Supplemental (bonus) withholding | 11.70% | Derived: [OSC Bulletin 2416](https://www.osc.ny.gov/state-agencies/payroll-bulletins/state-agencies/2416-summary-tax-related-changes-2026) gives the 2026 Yonkers flat rate as 1.95975%, which is 16.75% × 11.70% | excerpt (derived) |
| NYC resident tax | 3.078% / 3.762% / 3.819% / 3.876%. Single/MFS tops 12,000 / 25,000 / 50,000; MFJ 21,600 / 45,000 / 90,000; HOH 14,400 / 30,000 / 60,000 | OSC Bulletin 2416 ("NYC requirements for 2026 remain unchanged from 2025"); brackets from IT-201-I; [NYS-50-T-NYC](https://www.tax.ny.gov/pdf/publications/withholding/nys50_t_nyc.pdf) | excerpt + secondary |
| Yonkers | Residents 16.75% of NYS tax; nonresidents 0.5% of wages | [NYS-50-T-Y (1/26)](https://www.tax.ny.gov/pdf/publications/withholding/nys50_t_y.pdf), IT-201-I line 55, Y-203-I | secondary (implied by the excerpt's 1.95975%) |
| Disability benefits (SDI) | 0.5% of wages, max $0.60/week = $31.20/yr | [WCL §209](https://www.nysenate.gov/legislation/laws/WKC/209) | secondary (statutory, unchanged since 1950) |
| Paid Family Leave | 0.432% of wages, max $411.91 | [PFL 2026 updates](https://paidfamilyleave.ny.gov/2026), [DFS rate decision](https://www.dfs.ny.gov/apps-and-licensing/health-insurers/pfl-rate-decision-2026-page) | excerpt |
| 401(k), overtime | 401(k) deferrals excluded (NY starts from federal AGI); no state overtime deduction | — | secondary |

## New Jersey

| Figure | Value | Source | Flag |
|---|---|---|---|
| Brackets, single/MFS | 1.4% to 20,000; 1.75% to 35,000; 3.5% to 40,000; 5.525% to 75,000; 6.37% to 500,000; 8.97% to 1M; 10.75% above | [NJ tax rate schedules](https://www.nj.gov/treasury/taxation/pdf/current/njtaxratesch.pdf) (unchanged since 2020) | excerpt |
| Brackets, MFJ/HOH | 1.4% to 20,000; 1.75% to 50,000; 2.45% to 70,000; 3.5% to 80,000; 5.525% to 150,000; 6.37% to 500,000; 8.97% to 1M; 10.75% above | Same | excerpt |
| Standard deduction | None | [Gross Income Tax overview](https://www.nj.gov/treasury/taxation/git_over.shtml) | excerpt |
| Exemptions | $1,000 per filer; $1,500 per dependent | [2025 NJ-1040 instructions](https://www.nj.gov/treasury/taxation/pdf/current/1040i.pdf) | excerpt |
| 401(k) | Excluded (403(b) and 457 are not, but this app models 401(k)) | Task brief; NJ-1040 instructions | secondary |
| TDI (employee) | 0.19% of the first $171,100 (max $325.09) | [NJDOL 2026 rates](https://www.nj.gov/labor/lwdhome/press/2025/20251229_newbenefitrates2026.shtml) | excerpt |
| FLI (employee) | 0.23% of the first $171,100 (max $393.53) | Same | excerpt |
| UI/WF/SWF (employee) | 0.425% (0.3825% UI + 0.0425% WF/SWF) of the first $44,800 (max $190.40) | Wage base: [NJDOL rate info](https://www.nj.gov/labor/ea/employer-services/rate-info/); rate: payroll-provider pages and the 2026 dataset | wage base excerpt; rate secondary |
| Supplemental rate | None set (NJ uses its wage tables), so the app uses the marginal rate | [NJ-WT](https://www.nj.gov/treasury/taxation/pdf/current/njwt.pdf) | excerpt |

## Connecticut

| Figure | Value | Source | Flag |
|---|---|---|---|
| Brackets | Single/MFS 2% to 10,000; 4.5% to 50,000; 5.5% to 100,000; 6% to 200,000; 6.5% to 250,000; 6.9% to 500,000; 6.99% above. MFJ doubles every threshold; HOH 16,000 / 80,000 / 160,000 / 320,000 / 400,000 / 800,000 | [OLR guide](https://www.cga.ct.gov/2024/rpt/pdf/2024-R-0130.pdf), [2025 CT-1040 instructions](https://portal.ct.gov/-/media/drs/forms/2025/income/2025-ct-1040-instructions_1225.pdf) | excerpt (single) + secondary |
| Personal exemption (Table A) | 15,000 / 24,000 / 12,000 / 19,000, less $1,000 per $1,000 (or part) of AGI over 30,000 / 48,000 / 24,000 / 38,000 | Same; [CT-1040 TCS](https://portal.ct.gov/-/media/drs/forms/2025/income/ct-1040-tcs_1225.pdf) | excerpt + secondary |
| 2% rate phase-out add-back (Table C) | Single $25 per $5,000 over 56,500 (max 250); MFJ $50 per $5,000 over 100,500 (max 500); MFS $25 per $2,500 over 50,250 (max 250); HOH $40 per $4,000 over 78,500 (max 400) | CT-1040 TCS | secondary |
| Recapture (Table D) | Single/MFS $25 per $5,000 over 105,000 (max 250), $90 per $5,000 over 200,000 (max 2,700), $50 per $5,000 over 500,000 (max 450). MFJ $50/$10,000 over 210,000 (500), $180/$10,000 over 400,000 (5,400), $100/$10,000 over 1M (900). HOH $40/$8,000 over 168,000 (400), $140/$8,000 over 320,000 (4,200), $80/$8,000 over 800,000 (720) | CT-1040 TCS; totals ($3,400 single / $6,800 joint) match a search excerpt | secondary |
| Personal tax credit (Table E) | 75% down to 1%, gone above 64,500 single / 100,500 MFJ / 52,500 MFS / 78,500 HOH (full table in the code) | 2025 CT-1040 instructions p. 23 | secondary |
| 2026 changes | None to these tables found. The TPG-211 2026 rules were issued 12/25; the 2026 session's indexing bill (HB 5444) wasn't found enacted | [TPG-211 (2026)](https://portal.ct.gov/-/media/drs/forms/2025/wth/tpg-211_1225.pdf), [2026 developments](https://portal.ct.gov/drs/miscellaneous-taxes/other-tax-page/state-tax-developments/2026-developments) | excerpt; carried from 2025 (not indexed) |
| CT Paid Leave | 0.5% up to the Social Security wage base ($184,500) | [CT Paid Leave contributions](https://www.ctpaidleave.org/how-ct-paid-leave-works/contributions) | excerpt |
| Supplemental rate | None (CT has no flat or percentage method) | TPG-211 | excerpt |

## Rhode Island

| Figure | Value | Source | Flag |
|---|---|---|---|
| Brackets (all statuses) | 3.75% to 82,050; 4.75% to 186,450; 5.99% above | [2026 withholding booklet](https://tax.ri.gov/sites/g/files/xkgbur541/files/2025-12/2026%20Withholding%20Tax%20Booklet.pdf), [2026 RI-1040ES](https://tax.ri.gov/sites/g/files/xkgbur541/files/2026-01/2026%20RI-1040ES_w.pdf) | excerpt |
| Standard deduction | 11,200 / 22,400 / 11,200 / 16,800 | [ADV 2025-22](https://tax.ri.gov/sites/g/files/xkgbur541/files/2025-11/ADV_2025_22_Inflation_Adjustments.pdf) | secondary (both datasets) |
| Exemption | $5,250 per person, filers and dependents | ADV 2025-22 | secondary |
| Phase-out | Deduction and exemptions lose 20% per $7,450 (or part) of AGI over $261,000; gone above $290,800 | ADV 2025-22, RI-1040ES worksheets | secondary |
| TDI | 1.1% of the first $100,000 (max $1,100) | [DLT 2026 rates](https://dlt.ri.gov/press-releases/2026-tax-rates-unemployment-insurance-and-temporary-disability-insurance) | excerpt |
| New for 2027, not 2026 | A child tax credit and a high-income surtax (2026 H 7127) start in 2027 | [H 7127](https://webserver.rilegislature.gov/BillText/BillText26/HouseText26/H7127Aaa.html) | secondary |

## Vermont

| Figure | Value | Source | Flag |
|---|---|---|---|
| Brackets | 3.35% / 6.6% / 7.6% / 8.75%. Single tops 50,750 / 122,850 / 256,300; MFJ 84,700 / 204,750 / 312,050; MFS 42,350 / 102,375 / 156,025; HOH 68,000 / 175,500 / 284,150 | "2026 Preliminary Vermont Tax Rates" in the [2026 IN-114 instructions](https://tax.vermont.gov/sites/tax/files/documents/IN-114-Instr-2026.pdf) | secondary, **preliminary**. 2025 schedule for reference: single 49,400 / 119,700 / 249,700 |
| Standard deduction | 7,850 / 15,700 / 7,850 / 11,800 | Worked back from the [2026 withholding guide GB-1210](https://tax.vermont.gov/sites/tax/files/documents/GB-1210-2026.pdf) by one dataset; HOH is that dataset's inflation estimate | secondary, **derived**. 2025: 7,650 / 15,300 / 7,650 / 11,450 |
| Personal exemption | $5,400 per person (filers and dependents) | GB-1210-2026 (as quoted by one dataset) | secondary. 2025: $5,300 |
| Minimum tax | Above $150,000 AGI, at least 3% of AGI | [32 V.S.A. §5822](https://legislature.vermont.gov/statutes/section/32/151/05822) | secondary |
| Child care contribution | Employer pays 0.44% of wages and may deduct up to 0.11% from pay; no wage cap. Modeled as a 0.11% deduction | [GB-1326](https://tax.vermont.gov/sites/tax/files/documents/GB-1326.pdf), 32 V.S.A. ch. 246 | secondary |
| Paid leave | None mandatory (Vermont's family leave insurance is voluntary) | — | **unconfirmed** (not re-checked this session) |

## Maine

| Figure | Value | Source | Flag |
|---|---|---|---|
| Brackets | 5.8% / 6.75% / 7.15%. Single/MFS tops 27,400 / 64,850; MFJ 54,850 / 129,750; HOH 41,100 / 97,300 | [2026 rate schedules (rev. May 2026)](https://www.maine.gov/revenue/sites/maine.gov.revenue/files/2026-05/ind_tax_rate_sched_2026_rev.pdf) | secondary (three datasets agree) |
| Standard deduction | Maine's own 2026 amounts: 15,700 / 31,400 / 15,700 / 23,550 (back to federal in 2027) | LD 2212 (P.L. 2025 c. 650), [2026 legislative changes](https://www.maine.gov/revenue/sites/maine.gov.revenue/files/inline-files/legischange26.pdf) | secondary |
| Standard deduction phase-out | Straight line over 75,000 / 150,000 / 75,000 / 112,500 above 102,250 / 204,550 / 102,250 / 153,400 | [2026 phase-out worksheet](https://www.maine.gov/revenue/sites/maine.gov.revenue/files/inline-files/26_item_stand_%20ded_phaseout_wksht_0.pdf) | secondary |
| Personal exemption | $5,300 per filer (dependents get the credit instead) | One calculator dataset's 2026 values | secondary, single source. 2025 confirmed: $5,150 |
| Exemption phase-out | Over 125,000 (62,500 MFS) above 333,450 / 400,100 / 200,050 / 366,750 | 2025 1040ME instructions | **prior-year** (2025) |
| Dependent exemption credit | $305 per dependent (doubled under age 6); loses $20 per $500 (or part) of AGI over 100,000 / 150,000 / 75,000 / 125,000 | [36 M.R.S. §5219-SS](https://www.mainelegislature.org/legis/statutes/36/title36sec5219-SS.html), 2025 budget (LD 210) | secondary; **prior-year** amount (2025) |
| Paid Family & Medical Leave | Employee share 0.5% (half of 1%), up to the Social Security wage base | [26 M.R.S. §850-F](https://legislature.maine.gov/legis/statutes/26/title26sec850-F.html) | secondary; 2026 rate not re-confirmed |
| Supplemental rate | Not set (couldn't confirm), so the app uses the marginal rate | — | — |

## Delaware

| Figure | Value | Source | Flag |
|---|---|---|---|
| Brackets (all statuses) | 0% to 2,000; 2.2% to 5,000; 3.9% to 10,000; 4.8% to 20,000; 5.2% to 25,000; 5.55% to 60,000; 6.6% above | [30 Del. C. §1102](https://delcode.delaware.gov/title30/c011/sc01/index.html); 2026 PIT-EST schedule | secondary |
| Standard deduction | 3,250 / 6,500 / 3,250 / 3,250 (statutory) | [30 Del. C. §1108](https://delcode.delaware.gov/title30/c011/sc02/index.html), [2025 PIT-RES instructions](https://revenuefiles.delaware.gov/2025/PITForms_Instructions/Instructions/PIT-RES_Instructions_2025-01.pdf) | secondary |
| Personal credit | $110 per filer and dependent | Same | secondary |
| Paid Leave | 0.8% total at employers with 25+ employees (0.32% parental, 0.40% medical, 0.08% caregiving). Employers may deduct up to half, so 0.4% is modeled. Capped at the Social Security wage base | [19 Del. C. ch. 37](https://delcode.delaware.gov/title19/c037/), [Delaware Paid Leave](https://labor.delaware.gov/delaware-paid-leave/) | secondary; the wage cap is **unconfirmed** |
| Wilmington | 1.25% earned income tax, residents and people who work there | [FY2027 city tax rates](https://wilmdebudget.org/wp-content/uploads/2026/03/fy27-tax-rates.pdf) | secondary |

## Maryland

| Figure | Value | Source | Flag |
|---|---|---|---|
| Brackets | Single/MFS: 2% / 3% / 4% on the first 3,000; 4.75% to 100,000; 5% to 125,000; 5.25% to 150,000; 5.5% to 250,000; 5.75% to 500,000; 6.25% to 1M; 6.5% above. MFJ/HOH: 4.75% to 150,000; 5% to 175,000; 5.25% to 225,000; 5.5% to 300,000; 5.75% to 600,000; 6.25% to 1.2M; 6.5% above | [HB 352 (Ch. 604, 2025)](https://mgaleg.maryland.gov/2025RS/Chapters_noln/CH_604_hb0352e.pdf), [2025 resident booklet](https://www.marylandcomptroller.gov/content/dam/mdcomp/tax/instructions/2025/resident-booklet.pdf) | secondary (three datasets agree) |
| Standard deduction | Flat 3,350 / 6,700 / 3,350 / 6,700 | HB 352 | secondary. One dataset says the 2026 withholding guide shows $3,400 single (indexed) with joint unpublished; **unconfirmed** |
| Personal exemption | $3,200 each; $1,600 / $800 / $0 above 100k / 125k / 150k AGI (single, MFS), 150k / 175k / 200k (MFJ, HOH) | 2025 resident booklet | secondary |
| County rates | Allegany 3.20%, Baltimore City 3.20%, Baltimore Co. 3.20%, Calvert 3.20%, Caroline 3.20%, Carroll 3.03%, Cecil 2.74%, Charles 3.03%, Dorchester 3.30%, Garrett 2.65%, Harford 3.06%, Howard 3.20%, Kent 3.30%, Montgomery 3.20%, Prince George's 3.20%, Queen Anne's 3.20%, St. Mary's 3.20%, Somerset 3.20%, Talbot 2.40%, Washington 2.95%, Wicomico 3.20%, Worcester 2.25%. Changed for 2026: Allegany (was 3.03%) and Kent (was 3.20%) | [Withholding Tax Facts 2026](https://www.marylandcomptroller.gov/content/dam/mdcomp/tax/legal-publications/facts/withholding-tax-facts-2026.pdf) (COM RAD 098, rev. 12/25) | secondary (two datasets quoting it agree) |
| Anne Arundel | Marginal: 2.70% to 50,000 (75,000 MFJ/HOH), 2.94% to 400,000 (480,000), 3.20% above | Same | secondary |
| Frederick | One rate on all taxable income, picked by income: 2.25% up to 25,000; 2.75% to 50,000 (100,000 MFJ/HOH); 2.96% to 150,000 (250,000); 3.20% above. Both datasets treat it as not marginal | Same | secondary; see engine note below |
| FAMLI | No employee contributions in 2026 (a 2025 law pushed contributions to 2027) | Not reachable this session | **unconfirmed** |

## District of Columbia

| Figure | Value | Source | Flag |
|---|---|---|---|
| Brackets (all statuses) | 4% to 10,000; 6% to 40,000; 6.5% to 60,000; 8.5% to 250,000; 9.25% to 500,000; 9.75% to 1M; 10.75% above | [2026 D-40ES](https://otr.cfo.dc.gov/sites/default/files/dc/sites/otr/publication/attachments/2026_D40ES_Book_wLinks04012026.pdf) | secondary |
| Standard deduction | Federal amounts for 2026 ($16,100 / $32,200 / $24,150). Congress disapproved DC's 2025 decoupling act ([H.J.Res. 142](https://www.congress.gov/bill/119th-congress/house-joint-resolution/142), P.L. 119-78, 2026-02-18) | 2026 D-40ES line 2b (as quoted by one dataset) | secondary, single source. PolicyEngine still carries DC's own 2025 amount ($15,000 single) |
| Paid Family Leave | Employer-only (0.75%); nothing is withheld from pay | [D.C. Code §32-541.03](https://code.dccouncil.gov/us/dc/council/code/sections/32-541.03) | secondary |

## Other local taxes

No other income or wage taxes on employees were found in these states. New York's MCTMT and Newark's payroll tax fall on employers. Anything else can go in the app's "Other local tax %" field.

## Not modeled

- **State child and family credits.** These are NY's Empire State child credit, NJ's child tax credit, VT's child tax credit, DC's child tax credit and Keep Child Care Affordable credit, the CT property tax credit, and state EITCs. They depend on children's ages or other inputs the engine doesn't have.
- **NYC and Yonkers credits.** The household credit, the school tax credit and the NYC rate-reduction credit are left out. NYC tax runs a little high because of that.
- **Maine.** The dependent credit doubles for children under 6; the code assumes 6 or older. The 2% surcharge above $1M single / $1.5M joint (new for 2026) isn't included.
- **Delaware.** Married couples can file "combined separate" returns to lower tax; the code uses a joint return. Smaller employers (10–24 employees) collect only the parental share of Paid Leave (up to 0.16%).
- **Maryland.** The 2.25% special nonresident tax for people who live outside Maryland, the 2% capital gains surtax above $350,000, the itemized deduction phase-out, and the pension and poverty-level credits aren't included.
- **Frederick County.** The step up at each threshold is spread over a short ramp: the first $700 to $4,100 above 25k, 50k, 100k, 150k and 250k. Inside that ramp the county tax can run up to $600 low.
- **Above $500,000.** NY's flat 10.9% rule above $25M of AGI is only approximated.
- **Additional deductions or credits for age 65+ and for blindness.** None are modeled in any state.
