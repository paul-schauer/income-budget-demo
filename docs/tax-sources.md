# 2026 tax figures and sources

Every number in `src/tax/tax.ts` and where it came from. Checked 2026-09-30.

**How these were checked.** The sandbox's network proxy blocked direct page fetches, including irs.gov, michigan.gov, ssa.gov and the city sites. Every figure was instead confirmed through web-search excerpts of the official page listed next to it, and the search had to show the exact number. Figures marked **(secondary)** came from an official source that isn't the issuing agency itself (for example, Grand Rapids' table of other cities) or from an older form, and could not be confirmed from the issuing agency's current page.

## Federal income tax (Rev. Proc. 2025-32, after the One Big Beautiful Bill Act)

Sources: [IRS news release, 2026 inflation adjustments](https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill), [Rev. Proc. 2025-32](https://www.irs.gov/pub/irs-drop/rp-25-32.pdf), [IRS federal income tax rates and brackets](https://www.irs.gov/filing/federal-income-tax-rates-and-brackets)

| Figure | Value in code | Status |
|---|---|---|
| Standard deduction | Single $16,100 · MFJ $32,200 · MFS $16,100 · HOH $24,150 | Confirmed (IRS release) |
| Brackets, single (tops of 10/12/22/24/32/35%) | 12,400 / 50,400 / 105,700 / 201,775 / 256,225 / 640,600 | Confirmed (IRS release) |
| Brackets, MFJ | 24,800 / 100,800 / 211,400 / 403,550 / 512,450 / 768,700 | Confirmed (IRS release) |
| Brackets, MFS | Same as single up to the 35% bracket, which ends at 384,350 | Confirmed (Rev. Proc. 2025-32, as quoted in search results) |
| Brackets, HOH | 17,700 / 67,450 / 105,700 / 201,750 / 256,200 / 640,600 | Confirmed. 17,700 and 67,450 came from search excerpts. The upper four match [Tax Foundation's 2026 table](https://taxfoundation.org/data/all/federal/2026-tax-brackets/), which lists them with the $24,150 standard deduction added (129,850 / 225,900 / 280,350 / 664,750). |
| Child tax credit | $2,200 per child. The refundable part ($1,700) is stored but not used. | Confirmed ([IRS Child Tax Credit](https://www.irs.gov/credits-deductions/individuals/child-tax-credit); Rev. Proc. 2025-32 §4.05) |
| CTC phase-out | Starts at $400,000 MFJ and $200,000 for everyone else; the credit drops $50 per $1,000 or part of $1,000 | Confirmed (IRS Child Tax Credit page). The OBBBA made these permanent and they aren't indexed. |
| Credit for other dependents | $500 | Confirmed ([IRS: Understanding the credit for other dependents](https://www.irs.gov/newsroom/understanding-the-credit-for-other-dependents)) |

## Retirement (IRS Notice 2025-67)

Sources: [IRS: 401(k) limit increases to $24,500 for 2026](https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500), [Notice 2025-67](https://www.irs.gov/pub/irs-drop/n-25-67.pdf), [IRS catch-up contributions](https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-topics-catch-up-contributions)

| Figure | Value | Status |
|---|---|---|
| 401(k) elective deferral limit | $24,500 | Confirmed |
| Catch-up, age 50+ | $8,000 (total $32,500) | Confirmed. Added as an optional `age` input to `calculate()` and `Tax.k401LimitFor(age)`. There's no UI for it. |
| Catch-up, ages 60–63 (SECURE 2.0) | $11,250 (total $35,750) | Confirmed |
| Roth catch-up wage threshold | $150,000 of 2025 FICA wages from the same employer | Confirmed, but not modeled. If your wages are above it, your catch-up must go in as Roth. |

## Payroll taxes

| Figure | Value | Source |
|---|---|---|
| Social Security rate / wage base | 6.2% / $184,500 | [SSA 2026 COLA fact sheet](https://www.ssa.gov/news/en/cola/factsheets/2026.html), [SSA contribution and benefit base](https://www.ssa.gov/oact/cola/cbb.html) |
| Medicare | 1.45%, no cap | [IRS Topic 751](https://www.irs.gov/taxtopics/tc751) |
| Additional Medicare 0.9%, annual thresholds | $200,000 single/HOH · $250,000 MFJ · $125,000 MFS | [IRS Topic 560](https://www.irs.gov/taxtopics/tc560) |
| Additional Medicare withholding | Employers withhold the 0.9% on wages above $200,000 whatever your filing status | Same. The bonus estimator uses this. |

## Supplemental wages (bonuses)

| Figure | Value | Source |
|---|---|---|
| Federal flat rate | 22%, and a mandatory 37% on supplemental wages over $1,000,000 for the year | [IRS Pub. 15 (2026), section 7](https://www.irs.gov/publications/p15) |
| Michigan | 4.25% flat on bonuses | [Michigan Form 446, 2026 Withholding Guide](https://www.michigan.gov/taxes/-/media/Project/Websites/taxes/Forms/SUW/TY2026/446_Withholding-Guide_2026.pdf) |

## "No tax on overtime" (OBBBA, IRC §225, tax years 2025–2028)

Sources: [IRS Q&A on the qualified overtime deduction](https://www.irs.gov/newsroom/questions-and-answers-about-the-new-deduction-for-qualified-overtime-compensation), [IRS: What to know about the No Tax on Overtime deduction](https://www.irs.gov/newsroom/what-to-know-about-the-no-tax-on-overtime-deduction), [26 U.S.C. 225](https://uscode.house.gov/view.xhtml?req=granuleid%3AUSC-prelim-title26-section225&num=0&edition=prelim), [Schedule 1-A](https://www.irs.gov/pub/irs-pdf/f1040s1a.pdf), [2026 Form W-4](https://www.irs.gov/pub/irs-pdf/fw4.pdf)

| Item | Value | Status |
|---|---|---|
| What qualifies | Only the FLSA §7 overtime premium, meaning the extra half of time-and-a-half | Confirmed |
| Cap | $12,500 per return, or $25,000 on a joint return | Confirmed |
| Married filing separately | Can't take the deduction; married couples must file jointly | Confirmed |
| Phase-out | $100 off for each $1,000 of MAGI above $150,000, or $300,000 joint. Schedule 1-A drops partial thousands. | Confirmed |
| Effect on FICA | None: Social Security and Medicare still apply | Confirmed |
| Effect on withholding | It's an annual-return deduction. Paychecks only reflect it if you enter it on W-4 step 4(b), which the 2026 W-4 worksheet allows. | Confirmed |

### Michigan overtime and tips (2025 PA 24, HB 4961)

Michigan now lets you deduct the same qualified overtime (and tips) you claim on your federal return, for tax years **2026–2028**. Nonresidents can only deduct the part earned for work in Michigan. Michigan payroll withholding doesn't change, so the benefit arrives as a refund. Sources: [Michigan Treasury notice](https://www.michigan.gov/treasury/reference/taxpayer-notices/2026/01/06/new-deductions-for-qualified-overtime-compensation-and-qualified-tips), [HB 4961 (PA 24 of 2025)](https://legislature.mi.gov/Bills/Bill?ObjectName=2025-HB-4961).

City income tax doesn't get the overtime or tips deduction: the only deductions state law allows cities are IRA contributions, certain employee business expenses, moving expenses and alimony ([City of Pontiac notice](https://www.pontiac.mi.us/news_detail_T12_R295.php)). The code doesn't apply the deduction to city tax.

## Michigan income tax

| Figure | Value | Source |
|---|---|---|
| Rate, tax year 2026 | 4.25%. No rate cut was triggered because general fund revenue fell 1.56% while inflation was 2.70%. | [Treasury: 2026 rate determined](https://www.michigan.gov/treasury/news/2026/04/15/state-individual-income-tax-rate-for-2026-tax-year-determined), [taxpayer notice](https://www.michigan.gov/treasury/reference/taxpayer-notices/2026/04/15/425-income-tax-rate-for-individuals-and-fiduciaries-in-2026-tax-year) |
| Personal exemption, 2026 | $5,900 per person | [Form 446, 2026 Withholding Guide](https://www.michigan.gov/taxes/-/media/Project/Websites/taxes/Forms/SUW/TY2026/446_Withholding-Guide_2026.pdf) says "Personal Exemption Amount: $5,900". Confirmed. |

## Michigan city income tax

**Which cities.** Michigan Treasury lists exactly 24 cities with an income tax, and they match `CITIES`: Albion, Battle Creek, Benton Harbor, Big Rapids, Detroit, East Lansing, Flint, Grand Rapids, Grayling, Hamtramck, Highland Park, Hudson, Ionia, Jackson, Lansing, Lapeer, Muskegon, Muskegon Heights, Pontiac, Port Huron, Portland, Saginaw, Springfield, Walker ([Treasury: Which cities impose an income tax?](https://www.michigan.gov/taxes/questions/iit/accordion/general/what-cities-impose-an-income-tax)). No city is missing and none is listed wrongly.

**401(k) deferrals.** They are taxable city wages: employers can't exclude 401(k), 403(b) or 457 deferrals the employee elects ([Grand Rapids nonresident instructions](https://www.grandrapidsmi.gov/media/5jsaybz5/2025-non-resident-printable.pdf)). The code keeps deferrals in city wages and leaves Section 125 benefits out, so it was already correct.

Cross-reference for every city: [Grand Rapids, "Other Michigan Cities with Income Tax"](https://www.grandrapidsmi.gov/departments/fiscal-services/income-tax/other-michigan-cities-with-income-tax/) (called "GR table" below).

| City | Resident / nonresident | Exemption | Source | Change |
|---|---|---|---|---|
| Albion | 1% / 0.5% | **$600** | [Albion income tax page](https://www.cityofalbionmi.gov/departments/finance_and_treasury/income_tax/index.php), AL-1040 booklet, GR table | **was $750** |
| Battle Creek | 1% / 0.5% | $750 | [Battle Creek income tax](https://battlecreekmi.gov/206/Income-Tax), GR table | — |
| Benton Harbor | 1% / 0.5% | $750 | [Benton Harbor FAQ](https://www.bhcity.us/files/documents/2021-10-faq-city-of-benton-harbor-2.pdf), CF-W-4 | — |
| Big Rapids | 1% / 0.5% | $600 | [BR-1040 instructions](https://cms6.revize.com/revize/bigrapids/Document%20Center/Departments/Income%20Tax/Forms/Big%20Rapids%20Tax%20Forms/2024/2024%20BR-1040%20Individual%20Instructions.pdf), GR table | — |
| Detroit | 2.4% / 1.2% | $600 | [Form 5469, 2026 Detroit Withholding Guide](https://www.michigan.gov/taxes/-/media/Project/Websites/taxes/Forms/City-Withholding/TY2026/5469_ty2026.pdf), GR table | — |
| East Lansing | 1% / 0.5% | $600 | [East Lansing income tax FAQ](https://www.cityofeastlansing.com/faq.aspx?TID=51) | — |
| Flint | 1% / 0.5% | $600 | [Flint F-1040 instructions](https://www.cityofflint.com/wp-content/uploads/2025/01/2024-F-1040-Instructions.pdf), GR table. Treasury takes over Flint's administration for tax year 2026. | — |
| Grand Rapids | 1.5% / 0.75% | $600 | [GR income tax guide](https://www.grandrapidsmi.gov/departments/fiscal-services/income-tax/individual-taxpayers/income-tax-guide-for-individuals/) | — |
| Grayling | 1% / 0.5% | **$3,000** | GR table, [CF-W-4 (2014)](https://www.grandrapidsmi.gov/media/tcxly2c0/form-cf-w-4-employees-withholding-certificate-mi-cities-levying-an-inc-tax-12022014.pdf) **(secondary)**. Grayling's own GR-1040 didn't show the amount in search excerpts. | **was $600** |
| Hamtramck | 1% / 0.5% | $600 | [Hamtramck income tax](https://hamtramckcity.gov/departments/income-tax/), GR table | — |
| Highland Park | 2% / 1% | $600 | [HP-1040 / HP-1040ES instructions](https://hamtramckcity.gov/wp-content/uploads/2026/01/HP-1040-Individual-Tax-Booklet-with-1040-Tax-Form-and-Instructions-2025-Copy.pdf), GR table | — |
| Hudson | 1% / 0.5% | **$1,000** | GR table, CF-W-4 (2014) **(secondary)**. Hudson's own booklet couldn't be read. | **was $600** |
| Ionia | 1% / 0.5% | **$700** | [Ionia I-1040 instructions](https://www.cityofionia.org/DocumentCenter/View/928/2023-Individual-Income-Tax-Forms-Instructions-PDF), CF-W-4 | **was $600** |
| Jackson | 1% / 0.5% | $600 | [Jackson J-1040](https://www.cityofjackson.org/DocumentCenter/View/13260/2024---J-1040-Individual-Return-with-instructions-non-fillable) | — |
| Lansing | 1% / 0.5% | $600 | [Lansing 2025 individual return](https://content.civicplus.com/api/assets/957f1f8b-a276-4316-80ea-14f66ad36c29?cache=1800), [Lansing exemptions](https://www.lansingmi.gov/263/Exemptions) | — |
| Lapeer | 1% / 0.5% | $600 | [Lapeer income tax](https://www.ci.lapeer.mi.us/finance/income_tax/index.php) | — |
| Muskegon | 1% / 0.5% | $600 | [2025 CF-M1040 instructions](https://muskegon-mi.gov/cresources/2025-CF-M1040-Form-and-Instructions-PROOF-3.pdf-final.pdf) | — |
| Muskegon Heights | 1% / 0.5% | $600 | [tax-rates.org](https://www.tax-rates.org/michigan/muskegon-heights-income-tax), old MH-1065 form **(secondary)** | — |
| Pontiac | 1% / 0.5% | $600 | [Pontiac income tax FAQ](https://www.pontiac.mi.us/departments/finance/income_tax/faqs.php) | — |
| Port Huron | 1% / 0.5% | $600 | [PH-1040 instructions](https://cms9files.revize.com/porthuronminw/Documents/Government/Departments/Finance/Income%20Tax/2023/1040%20instructions.pdf), GR table | — |
| Portland | 1% / 0.5% | **$1,000** | [Portland P-1040 instructions (2023)](https://www.portland-michigan.org/DocumentCenter/View/715/-Instructions-for-P-1040), GR table | **was $600** |
| Saginaw | 1.5% / 0.75% | $750 | [Saginaw S-1040 instructions](https://www.saginaw-mi.com/DocumentCenter/View/2818) say $750 and 1.5%. **Conflict:** the GR table excerpt showed $600 and the 2014 CF-W-4 showed $1,000; the code keeps the city's own $750. | — |
| Springfield | 1% / 0.5% | $750 | GR table, CF-W-4 (2014) **(secondary)** | — |
| Walker | 1% / 0.5% | $600 | [Walker withholding FAQ](https://walkermi.gov/FAQ.aspx?QID=105) | — |

Every city's nonresident rate is half its resident rate, as the Uniform City Income Tax Ordinance requires.

## Known simplifications

- The child tax credit is treated as nonrefundable, so the $1,700 refundable part isn't paid out when your federal tax is already $0.
- Michigan-taxable wages start from federal wages. Other Michigan subtractions (retirement income and similar) are left out.
- Cities get the same number of exemptions as Michigan. Extra city exemptions for age 65+, blind or disabled are left out.
- The bonus estimator assumes the employer uses the flat supplemental rate and pays the bonus on a separate check, not the aggregate method.
- The Roth catch-up rule for people with 2025 wages over $150,000 isn't modeled.
