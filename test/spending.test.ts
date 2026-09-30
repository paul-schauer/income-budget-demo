const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const S = require("../js/spending.js");

const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", `spending-${name}.csv`), "utf8");

const ITEMS = [
  { id: "rent", name: "Rent", amount: 1250, recurrence: "monthly", category: "housing" },
  { id: "groc", name: "Groceries", amount: 110, recurrence: "weekly", category: "food" },
  { id: "gas", name: "Gas", amount: 45, recurrence: "weekly", category: "transport" },
  { id: "netflix", name: "Netflix", amount: 15.49, recurrence: "monthly", category: "subscriptions" },
  { id: "dte", name: "DTE Energy", amount: 130, recurrence: "monthly", category: "utilities" },
  { id: "ins", name: "Car insurance", amount: 720, recurrence: "annual", category: "transport" },
];
const CATS = [
  { id: "housing", name: "Housing" }, { id: "transport", name: "Transportation" }, { id: "food", name: "Food" },
  { id: "utilities", name: "Utilities" }, { id: "subscriptions", name: "Subscriptions" }, { id: "other", name: "Other" },
];

// ---------- CSV parsing ----------

test("parseCSV handles quotes, escaped quotes, embedded delimiters and newlines", () => {
  const rows = S.parseCSV('a,"b, with comma","say ""hi""","multi\nline",\n1,2,3,4,5');
  assert.deepEqual(rows, [["a", "b, with comma", 'say "hi"', "multi\nline", ""], ["1", "2", "3", "4", "5"]]);
});

test("parseCSV handles CRLF, lone CR, BOM, blank lines and a trailing newline", () => {
  assert.deepEqual(S.parseCSV("﻿Date,Amount\r\n09/01/2026,-5\r\n\r\n09/02/2026,-6\r\n"), [["Date", "Amount"], ["09/01/2026", "-5"], ["09/02/2026", "-6"]]);
  assert.deepEqual(S.parseCSV("a,b\rc,d\r"), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(S.parseCSV(""), []);
  assert.deepEqual(S.parseCSV("\n\n  \n"), []);
});

test("parseCSV detects semicolon, tab and pipe delimiters and honors sep= lines", () => {
  assert.deepEqual(S.parseCSV("Date;Description;Amount\n2026-09-01;KROGER, ANN ARBOR;-54,23\n2026-09-02;SHELL;-40,00"), [
    ["Date", "Description", "Amount"], ["2026-09-01", "KROGER, ANN ARBOR", "-54,23"], ["2026-09-02", "SHELL", "-40,00"],
  ]);
  assert.deepEqual(S.parseCSV("a\tb\tc\n1\t2\t3"), [["a", "b", "c"], ["1", "2", "3"]]);
  assert.deepEqual(S.parseCSV("a|b\n1|2"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(S.parseCSV("sep=;\na;b,c\n1;2,5"), [["a", "b,c"], ["1", "2,5"]]);
  assert.equal(S.detectDelimiter('x,y,z\n"1;2",3,4'), ",");
});

test("parseCSV tolerates spaces before quotes and stray quotes mid-field", () => {
  assert.deepEqual(S.parseCSV('a, "b",c\n5" TV,x,y'), [["a", "b", "c"], ['5" TV', "x", "y"]]);
});

// ---------- Dates & amounts ----------

test("parseDate reads the common bank formats", () => {
  assert.equal(S.parseDate("09/28/2026"), "2026-09-28");
  assert.equal(S.parseDate("9/3/26"), "2026-09-03");
  assert.equal(S.parseDate("2026-09-03"), "2026-09-03");
  assert.equal(S.parseDate("2026/9/3"), "2026-09-03");
  assert.equal(S.parseDate("09-28-2026"), "2026-09-28");
  assert.equal(S.parseDate("2026-09-03T00:00:00Z"), "2026-09-03");
  assert.equal(S.parseDate("09/28/2026 12:00:00 AM"), "2026-09-28");
  assert.equal(S.parseDate("20260903"), "2026-09-03");
  assert.equal(S.parseDate("Sep 3, 2026"), "2026-09-03");
  assert.equal(S.parseDate("3 Sept 2026"), "2026-09-03");
  assert.equal(S.parseDate("28/09/2026", "dmy"), "2026-09-28");
  assert.equal(S.parseDate("12/31/99"), "1999-12-31");
});

test("parseDate rejects impossible or junk dates", () => {
  for (const bad of ["", "02/30/2026", "13/01/2026", "2026-13-01", "2026-02-29", "hello", "Total", "1234", null, undefined]) {
    assert.equal(S.parseDate(bad), null, String(bad));
  }
  assert.equal(S.parseDate("2028-02-29"), "2028-02-29");
});

test("detectDateOrder switches to day-first only when the data demands it", () => {
  assert.equal(S.detectDateOrder(["01/02/2026", "03/04/2026"]), "mdy");
  assert.equal(S.detectDateOrder(["01/02/2026", "28/09/2026"]), "dmy");
  assert.equal(S.detectDateOrder(["09/28/2026", "2026-09-01"]), "mdy");
});

test("parseAmount handles currency, thousands, parentheses and trailing minus", () => {
  const cases = [
    ["-54.23", -54.23], ["54.23", 54.23], ["$1,234.56", 1234.56], ["-$1,234.56", -1234.56], ["$-12.00", -12],
    ["(12.50)", -12.5], ["($1,250.00)", -1250], ["12.50-", -12.5], ["+7", 7], ["-76.4000", -76.4],
    ["1.234,56", 1234.56], ["-54,23", -54.23], ["1,234", 1234], [" 3 ", 3], ["−10.00", -10], ["USD 5.00", 5], [".5", 0.5],
  ];
  for (const [input, want] of cases) assert.equal(S.parseAmount(input), want, input);
  for (const bad of ["", "abc", "1.2.3", "--5", "12a", null]) assert.ok(Number.isNaN(S.parseAmount(bad)), String(bad));
});

// ---------- Column detection ----------

test("detectColumns finds each bank's columns by header name", () => {
  const cols = (line) => S.detectColumns(S.parseCSV(line)[0]);
  assert.deepEqual(cols("Transaction Date,Post Date,Description,Category,Type,Amount,Memo"),
    { date: 0, description: 2, amount: 5, debit: -1, credit: -1, type: 4 });
  assert.deepEqual(cols("Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #"),
    { date: 1, description: 2, amount: 3, debit: -1, credit: -1, type: 4 });
  assert.deepEqual(cols("Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit"),
    { date: 0, description: 3, amount: -1, debit: 5, credit: 6, type: -1 });
  assert.deepEqual(cols("Date,Transaction Description,Withdrawal,Deposit,Balance"),
    { date: 0, description: 1, amount: -1, debit: 2, credit: 3, type: -1 });
  assert.deepEqual(cols("Account Number,Transaction Description,Transaction Date,Transaction Type,Transaction Amount,Balance"),
    { date: 2, description: 1, amount: 4, debit: -1, credit: -1, type: 3 });
  // Payee / Memo style (e.g. personal finance exports) and fuzzy names
  assert.deepEqual(cols("Posted,Payee,Memo,Amount (USD),Running Balance"),
    { date: 0, description: 1, amount: 3, debit: -1, credit: -1, type: -1 });
  assert.deepEqual(cols("Trans. Date,Merchant Name,Debit Amt,Credit Amt"),
    { date: 0, description: 1, amount: -1, debit: 2, credit: 3, type: -1 });
});

test("detectColumns never uses balance, card or account columns as amounts", () => {
  const m = S.detectColumns(["Date", "Name", "Card Number", "Account Balance", "Amount"]);
  assert.equal(m.amount, 4);
  const none = S.detectColumns(["Date", "Name", "Balance"]);
  assert.equal(S.isValidMapping(none), false);
});

test("findHeader skips a Bank of America summary preamble", () => {
  const rows = S.parseCSV(fixture("bofa-checking"));
  const h = S.findHeader(rows);
  assert.equal(rows[h.index].join(","), "Date,Description,Amount,Running Bal.");
  assert.deepEqual(h.mapping, { date: 0, description: 1, amount: 2, debit: -1, credit: -1, type: -1 });
});

test("header-less exports (Wells Fargo style) get columns guessed from the data", () => {
  const csv = [
    '"09/28/2026","-54.23","*","","PURCHASE AUTHORIZED ON 09/27 KROGER #123 ANN ARBOR MI S386244772123456 CARD 1234"',
    '"09/26/2026","2100.00","*","","ACME CORP PAYROLL 260926 XXXXX1234 DOE JANE"',
    '"09/24/2026","-41.02","*","","PURCHASE AUTHORIZED ON 09/23 SHELL OIL 57444598705 DETROIT MI S1234 CARD 1234"',
  ].join("\n");
  const r = S.prepareImport(csv, { items: ITEMS });
  assert.equal(r.ok, true);
  assert.equal(r.hasHeader, false);
  assert.equal(r.mapping.date, 0);
  assert.equal(r.mapping.amount, 1);
  assert.equal(r.mapping.description, 4);
  assert.equal(r.signMode, "negative");
  assert.deepEqual(r.transactions.map((t) => [t.date, t.amount]), [["2026-09-28", 54.23], ["2026-09-24", 41.02]]);
  assert.equal(r.counts.income, 1);
});

// ---------- Sign handling per bank ----------

const importFixture = (name, opts = {}) => S.prepareImport(fixture(name), { items: ITEMS, ...opts });

test("Chase credit card: negatives are purchases, payments skipped, returns kept as refunds", () => {
  const r = importFixture("chase-credit");
  assert.equal(r.ok, true);
  assert.equal(r.signMode, "negative");
  assert.deepEqual(r.counts, { rows: 12, new: 11, duplicate: 0, income: 1, invalid: 0, refunds: 1 });
  const byDesc = Object.fromEntries(r.transactions.map((t) => [t.description, t]));
  assert.equal(byDesc["STARBUCKS STORE 12345"].amount, 6.45);
  assert.equal(r.transactions.find((t) => t.amount < 0).amount, -25.99); // TARGET return
  assert.ok(!r.transactions.some((t) => /Payment Thank You/.test(t.description)));
  assert.equal(byDesc['DTE ENERGY, BILL PAY'].itemId, "dte"); // quoted field with a comma; name match
  assert.equal(byDesc["NETFLIX.COM"].itemId, "netflix");
  assert.equal(byDesc["NETFLIX.COM"].category, "subscriptions");
  assert.deepEqual(r.dateRange, { from: "2026-09-01", to: "2026-09-28" });
});

test("Chase checking: payroll and Zelle-in skipped, store refund kept, trailing commas OK", () => {
  const r = importFixture("chase-checking");
  assert.equal(r.signMode, "negative");
  assert.equal(r.counts.income, 2);
  assert.equal(r.counts.new, 7);
  const refund = r.transactions.find((t) => t.amount < 0);
  assert.equal(refund.amount, -12.99);
  assert.match(refund.description, /^KROGER/);
  assert.equal(r.transactions.find((t) => /CHECK 1042/.test(t.description)).amount, 1250);
  // padded fixed-width descriptions are collapsed
  assert.equal(r.transactions[0].description, "KROGER #123 ANN ARBOR MI 09/28");
});

test("Bank of America checking: preamble and balance line ignored, deposits skipped", () => {
  const r = importFixture("bofa-checking");
  assert.equal(r.signMode, "negative");
  assert.deepEqual(r.counts, { rows: 9, new: 7, duplicate: 0, income: 2, invalid: 0, refunds: 0 });
  assert.equal(r.transactions.find((t) => /RENT PAYMENT/.test(t.description)).amount, 1250);
  assert.equal(r.transactions.find((t) => /RENT PAYMENT/.test(t.description)).itemId, "rent");
  assert.ok(r.transactions.every((t) => t.amount > 0));
});

test("Capital One card: Debit/Credit columns; card payment skipped, Amazon credit is a refund", () => {
  const r = importFixture("capitalone-credit");
  assert.equal(r.signMode, "debitcredit");
  assert.equal(r.counts.income, 1);
  assert.equal(r.counts.refunds, 1);
  const amazon = r.transactions.filter((t) => /AMAZON/.test(t.description)).map((t) => t.amount).sort();
  assert.deepEqual(amazon, [-23.1, 23.1]);
  assert.equal(r.transactions.find((t) => /KROGER/.test(t.description)).amount, 54.23);
});

test("Capital One 360: unsigned amounts use the Debit/Credit type column", () => {
  const r = importFixture("capitalone-360");
  assert.equal(r.signMode, "type");
  assert.equal(r.counts.income, 2); // payroll deposit + interest
  assert.deepEqual(r.transactions.map((t) => t.amount), [54.23, 88.17, 15.49, 40]);
  assert.equal(r.transactions[0].date, "2026-09-28"); // M/D/YY
});

test("Michigan credit union (signed Amount, 4 decimals, Effective Date)", () => {
  const r = importFixture("mi-credit-union");
  assert.equal(r.signMode, "negative");
  assert.equal(r.mapping.date, 2); // Effective Date: when you actually bought it
  assert.equal(r.mapping.description, 7);
  assert.equal(r.counts.income, 2); // payroll + dividend
  const meijer = r.transactions.find((t) => /MEIJER/.test(t.description));
  assert.deepEqual([meijer.date, meijer.amount], ["2026-09-28", 76.4]);
  assert.equal(r.transactions.find((t) => t.description === "DTE ENERGY").itemId, "dte");
});

test("Michigan credit union (Withdrawal/Deposit, $ amounts, M/D/YY)", () => {
  const r = importFixture("mi-credit-union-2");
  assert.equal(r.signMode, "debitcredit");
  assert.equal(r.counts.income, 2);
  assert.equal(r.counts.refunds, 1);
  assert.deepEqual(r.transactions.map((t) => [t.date, t.amount]), [
    ["2026-09-28", 76.4], ["2026-09-25", 1250], ["2026-09-20", -12.99], ["2026-09-18", 88.17], ["2026-09-03", 6.45],
  ]);
});

test("positive-is-spending card exports (Discover style) keep refunds, skip payments", () => {
  const csv = "Trans. Date,Post Date,Description,Amount,Category\n" +
    "09/02/2026,09/02/2026,KROGER #678 ANN ARBOR MI,84.12,Supermarkets\n" +
    "09/05/2026,09/05/2026,KROGER #678 ANN ARBOR MI,-10.00,Supermarkets\n" +
    "09/10/2026,09/10/2026,INTERNET PAYMENT - THANK YOU,-300.00,Payments and Credits\n" +
    "09/12/2026,09/12/2026,SPEEDWAY 08541,38.00,Gasoline\n";
  const r = S.prepareImport(csv, { items: ITEMS });
  assert.equal(r.signMode, "positive");
  assert.deepEqual(r.transactions.map((t) => t.amount), [84.12, -10, 38]);
  assert.equal(r.counts.income, 1);
});

test("semicolon files with decimal commas import", () => {
  const csv = "﻿Date;Description;Amount\r\n2026-09-01;NETFLIX.COM;-15,49\r\n2026-09-02;KROGER;-54,23\r\n";
  const r = S.prepareImport(csv, { items: ITEMS });
  assert.deepEqual(r.transactions.map((t) => t.amount), [15.49, 54.23]);
  assert.equal(r.transactions[0].itemId, "netflix");
});

test("unrecognized header names: columns are guessed and the header row is kept as names", () => {
  const r = S.prepareImport("When,What,Value\n09/01/2026,KROGER,54.23\n09/02/2026,SHELL,40\n");
  assert.equal(r.ok, true);
  assert.equal(r.hasHeader, true);
  assert.deepEqual(r.columns.map((c) => c.name), ["When", "What", "Value"]);
  assert.equal(r.counts.invalid, 0);
  assert.equal(r.counts.new, 2);
});

test("mapping and sign overrides from the preview dropdowns are applied", () => {
  const csv = "Col A,Col B,Col C\n09/01/2026,KROGER,54.23\n09/02/2026,SHELL,40\n";
  const auto = S.prepareImport(csv, { mapping: { date: -1 } });
  assert.equal(auto.ok, false);
  assert.match(auto.error, /Pick them below/);
  assert.equal(auto.columns.length, 3);
  const nothing = S.prepareImport("Foo,Bar\nx,y\nz,w\n");
  assert.equal(nothing.ok, false);
  const fixed = S.prepareImport(csv, { mapping: { date: 0, description: 1, amount: 2 } });
  assert.equal(fixed.ok, true);
  assert.equal(fixed.signMode, "positive");
  assert.deepEqual(fixed.transactions.map((t) => t.amount), [54.23, 40]);
  const flipped = S.prepareImport(csv, { mapping: { date: 0, description: 1, amount: 2 }, signMode: "negative" });
  assert.equal(flipped.counts.new, 0); // unknown money in → skipped as deposits
  assert.equal(flipped.counts.income, 2);
  const ignored = S.prepareImport(csv, { mapping: { date: 0, description: 1, amount: 2 }, signMode: "debitcredit" });
  assert.equal(ignored.signMode, "positive"); // incompatible override falls back to detection
  const outOfRange = S.prepareImport(csv, { mapping: { date: 9, description: "x", amount: 2 } });
  assert.equal(outOfRange.mapping.date, 0); // bad overrides are ignored; detection stays
  assert.equal(outOfRange.mapping.description, 1);
});

test("unreadable rows are counted, not imported; empty files are reported", () => {
  const csv = "Date,Description,Amount\n09/01/2026,OK,-5\nnot a date,BAD DATE,-5\n09/03/2026,BAD AMOUNT,abc\n09/04/2026,ZERO,0.00\n";
  const r = S.prepareImport(csv);
  assert.equal(r.counts.invalid, 2);
  assert.equal(r.counts.new, 1);
  assert.equal(r.counts.rows, 3);
  assert.equal(S.prepareImport("").ok, false);
  assert.equal(S.prepareImport("").error, "That file is empty.");
});

// ---------- Dedupe ----------

test("re-importing the same file finds only duplicates", () => {
  const first = importFixture("chase-credit");
  const again = importFixture("chase-credit", { existing: first.transactions });
  assert.equal(again.counts.new, 0);
  assert.equal(again.counts.duplicate, first.counts.new);
});

test("dedupe matches date + amount + normalized description, and counts repeats", () => {
  const existing = [{ date: "2026-09-02", amount: 4.5, description: "STARBUCKS  STORE 12345" }];
  const csv = "Date,Description,Amount\n09/02/2026,Starbucks Store 12345,-4.50\n09/02/2026,STARBUCKS STORE 12345,-4.50\n09/03/2026,STARBUCKS STORE 12345,-4.50\n";
  const r = S.prepareImport(csv, { existing });
  assert.equal(r.counts.duplicate, 1); // one already there; the second coffee that day is new
  assert.equal(r.counts.new, 2);
  assert.equal(S.dedupeKey({ date: "2026-09-02", amount: 4.5, description: "Starbucks, store #12345" }), "2026-09-02|450|starbucks store 12345");
});

// ---------- Merchant keys ----------

test("merchantKey strips prefixes, processors, dates, store numbers and locations", () => {
  const cases = [
    ["POS DEBIT 09/01 MEIJER #225 ROCHESTER HIL MI", "meijer"],
    ["DEBIT CARD PURCHASE - STARBUCKS STORE 12345 EAST LANSING MI", "starbucks"],
    ["SQ *BLUE BOTTLE COFFEE", "blue bottle coffee"],
    ["TST* ZINGERMANS DELICATESSEN", "zingermans delicatessen"],
    ["TST*SAVAS", "savas"],
    ["PURCHASE AUTHORIZED ON 09/27 KROGER #123 ANN ARBOR MI S386244772123456 CARD 1234", "kroger"],
    ["CHECKCARD 0731 KROGER #1234 ANN ARBOR MI 24431066212345678901234", "kroger"],
    ["KROGER #123 ANN ARBOR MI            09/28", "kroger"],
    ["SHELL OIL 57444598705 DETROIT MI", "shell oil"],
    ["COSTCO WHSE #0385 AUBURN HILLS MI", "costco whse"],
    ["HOME DEPOT NOVI MI", "home depot"],
    ["BLUE BOTTLE COFFEE ANN ARBOR MI", "blue bottle coffee"],
    ["NETFLIX.COM", "netflix com"],
    ["AMZN Mktp US*2K4LL0XY2", "amzn mktp us"],
    ["UBER *EATS", "uber eats"],
    ["PAYPAL *STEAMGAMES 4029357733 WA", "steamgames"],
    ["McDonald's F1234", "mcdonalds"],
    ["CONSUMERS ENERGY BILL PAY  PPD ID: 9876543210", "consumers energy"],
    ["RENT PAYMENT DES:WEB PMTS ID:XXXXX1234 INDN:DOE JANE", "rent"],
    ["POS RETURN MEIJER #225 ROCHESTER HILLS MI", "meijer"],
    ["Zelle payment to JOHN SMITH JPM99A1B2C3D", "zelle payment to john smith"],
    ["CHECK 1042", "check"],
    ["12345", ""],
    ["", ""],
  ];
  for (const [desc, want] of cases) assert.equal(S.merchantKey(desc), want, desc);
});

test("merchantKey is always a word-start match for its own description", () => {
  const descs = fs.readdirSync(path.join(__dirname, "fixtures"))
    .filter((f) => f.startsWith("spending-"))
    .flatMap((f) => S.prepareImport(fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8")).rows.map((r) => r.description));
  assert.ok(descs.length > 40);
  for (const d of descs) {
    const key = S.merchantKey(d);
    if (key) assert.ok(S.ruleMatches(key, d), `${key} ⊄ ${d}`);
  }
});

test("generic keys (checks, ATM, transfers) don't become rules", () => {
  assert.equal(S.isGenericKey(S.merchantKey("CHECK 1042")), true);
  assert.equal(S.isGenericKey(S.merchantKey("ATM WITHDRAWAL 001234 09/15")), true);
  assert.equal(S.isGenericKey("kroger"), false);
});

// ---------- Rules & name matching ----------

test("rules match at word starts; the longest rule wins; rules for deleted items are ignored", () => {
  const rules = [{ match: "kroger", itemId: "groc" }, { match: "kroger fuel", itemId: "gas" }, { match: "shell", itemId: "gone" }];
  const ids = new Set(ITEMS.map((i) => i.id));
  assert.equal(S.findRule(rules, "KROGER #123 ANN ARBOR", ids).itemId, "groc");
  assert.equal(S.findRule(rules, "KROGER FUEL #456", ids).itemId, "gas");
  assert.equal(S.findRule(rules, "SHELL OIL 123", ids), null);
  assert.equal(S.findRule(rules, "MCKROGERS", ids), null);
  assert.equal(S.ruleMatches("netflix.com", "NETFLIX.COM 866-579-7172"), true);
  assert.equal(S.ruleMatches("", "anything"), false);
});

test("item names match whole words, case-insensitively; longest name wins", () => {
  const items = [...ITEMS, { id: "gasbill", name: "Gas bill", category: "utilities" }, { id: "tv", name: "TV", category: "other" }, { id: "tmo", name: "T-Mobile", category: "utilities" }];
  assert.equal(S.matchItemByName("netflix.com 866", items).id, "netflix");
  assert.equal(S.matchItemByName("SHELL GAS STATION", items).id, "gas");
  assert.equal(S.matchItemByName("CONSUMERS GAS BILL", items).id, "gasbill");
  assert.equal(S.matchItemByName("GASOLINE ALLEY", items), null); // not a whole word
  assert.equal(S.matchItemByName("BEST BUY TV", items), null); // names under 3 letters are ignored
  assert.equal(S.matchItemByName("TMOBILE*AUTOPAY", items).id, "tmo");
  assert.equal(S.matchItemByName("DTE ENERGY PAYMENT", items).id, "dte");
});

test("autoAssign tries rules first, then item names, else unassigned", () => {
  const rules = [{ match: "netflix", itemId: "groc" }];
  assert.deepEqual(S.autoAssign("NETFLIX.COM", ITEMS, rules), { itemId: "groc", source: "rule" });
  assert.deepEqual(S.autoAssign("NETFLIX.COM", ITEMS, []), { itemId: "netflix", source: "name" });
  assert.deepEqual(S.autoAssign("SPOTIFY USA", ITEMS, rules), { itemId: null, source: null });
});

test("imports use saved rules", () => {
  const r = importFixture("chase-credit", { rules: [{ match: "kroger", itemId: "groc" }, { match: "shell oil", itemId: "gas" }] });
  const kroger = r.transactions.find((t) => /KROGER/.test(t.description));
  assert.equal(kroger.itemId, "groc");
  assert.equal(kroger.category, "food");
  assert.equal(r.rows.find((p) => /SHELL/.test(p.description)).source, "rule");
});

test("classifyInflow: tax refunds and payroll are income, store returns are refunds", () => {
  const seen = new Set(["target"]);
  assert.equal(S.classifyInflow("IRS TREAS 310 TAX REF", "", seen), "income");
  assert.equal(S.classifyInflow("ACME CORP PAYROLL", "ACH_CREDIT", seen), "income");
  assert.equal(S.classifyInflow("TARGET 00012345", "Return", seen), "refund");
  assert.equal(S.classifyInflow("TARGET 00012345", "", seen), "refund"); // bought there before
  assert.equal(S.classifyInflow("AMAZON REFUND", "", seen), "refund");
  assert.equal(S.classifyInflow("MYSTERY CO", "", seen), "income");
});

// ---------- Month math ----------

test("monthSummary: planned is annual / 12, actual sums the month, unassigned is separate", () => {
  const tx = [
    { id: "1", date: "2026-09-01", amount: 1250, itemId: "rent" },
    { id: "2", date: "2026-09-03", amount: 120.5, itemId: "groc" },
    { id: "3", date: "2026-09-10", amount: 210.25, itemId: "groc" },
    { id: "4", date: "2026-09-12", amount: -20, itemId: "groc" }, // refund
    { id: "5", date: "2026-09-14", amount: 60, itemId: "gas" },
    { id: "6", date: "2026-09-15", amount: 30, itemId: null },
    { id: "7", date: "2026-09-16", amount: 9.99, itemId: "deleted-item" }, // counts as unassigned
    { id: "8", date: "2026-08-31", amount: 999, itemId: "groc" }, // other month
    { id: "9", date: "2026-10-01", amount: 999, itemId: "rent" },
  ];
  const s = S.monthSummary({ items: ITEMS, transactions: tx, month: "2026-09", today: "2026-09-15", categories: CATS });
  assert.equal(s.count, 7);
  assert.deepEqual(s.groups.map((g) => g.category.id), ["housing", "transport", "food", "utilities", "subscriptions"]);
  const row = (id) => s.groups.flatMap((g) => g.rows).find((r) => r.item.id === id);
  assert.equal(row("groc").planned, 476.67); // 110 × 52 / 12
  assert.equal(row("groc").actual, 310.75);
  assert.equal(row("groc").diff, 165.92);
  assert.equal(row("groc").over, false);
  assert.equal(row("gas").planned, 195);
  assert.equal(row("ins").planned, 60); // annual 720 / 12
  assert.equal(row("rent").actual, 1250);
  assert.equal(row("rent").over, false);
  assert.equal(row("netflix").actual, 0);
  const transport = s.groups.find((g) => g.category.id === "transport");
  assert.equal(transport.planned, 255);
  assert.equal(transport.actual, 60);
  assert.deepEqual(s.unassigned, { actual: 39.99, count: 2 });
  assert.equal(s.totals.planned, 2127.16); // 1250 + 195 + 60 + 476.67 + 130 + 15.49
  assert.equal(s.totals.actual, 1660.74); // 1250 + 310.75 + 60 + 39.99
  assert.equal(s.totals.diff, 466.42);
  assert.equal(s.pace.day, 15);
  assert.equal(s.pace.daysInMonth, 30);
  assert.equal(s.pace.expected, 1063.58); // planned × 15 / 30
  assert.equal(s.pace.diff, round(1063.58 - 1660.74));
});

test("monthSummary: over budget, unplanned spending and no pace outside the current month", () => {
  const items = [{ id: "a", name: "Coffee", amount: 0, recurrence: "monthly", category: "food" }, { id: "b", name: "Fun", amount: 50, recurrence: "monthly", category: "mystery" }];
  const tx = [{ date: "2026-02-10", amount: 12, itemId: "a" }, { date: "2026-02-11", amount: 80, itemId: "b" }];
  const s = S.monthSummary({ items, transactions: tx, month: "2026-02", today: "2026-09-30", categories: CATS });
  const [coffee] = s.groups.find((g) => g.category.id === "food").rows;
  assert.equal(coffee.over, true);
  assert.equal(coffee.ratio, Infinity);
  const fun = s.groups.find((g) => g.category.id === "mystery"); // unknown category still shown
  assert.equal(fun.rows[0].over, true);
  assert.equal(fun.diff, -30);
  assert.equal(s.totals.over, true);
  assert.equal(s.pace, null);
  const noCats = S.monthSummary({ items, transactions: tx, month: "2026-02" });
  assert.equal(noCats.groups.length, 2);
});

test("month helpers", () => {
  assert.equal(S.shiftMonth("2026-01", -1), "2025-12");
  assert.equal(S.shiftMonth("2026-12", 1), "2027-01");
  assert.equal(S.shiftMonth("2026-09", -21), "2024-12");
  assert.equal(S.monthLabel("2026-09"), "September 2026");
  assert.equal(S.daysInMonth(2028, 2), 29);
  assert.equal(S.todayISO(new Date(2026, 8, 30, 23, 59)), "2026-09-30");
});

// ---------- Sanitize ----------

test("defaults are empty", () => {
  assert.deepEqual(S.defaults(), { transactions: [], rules: [] });
});

test("sanitize rejects junk and cleans fields", () => {
  for (const raw of [null, undefined, 5, "x", [], [1, 2]]) assert.deepEqual(S.sanitize(raw), S.defaults());
  const clean = S.sanitize({
    transactions: [
      null, 7, "str", [], { date: "2026-02-30", amount: 5 }, { date: "09/01/2026", amount: 5 }, { date: "2026-09-01" },
      { date: "2026-09-01", amount: NaN }, { date: "2026-09-01", amount: Infinity }, { date: "2026-09-01", amount: 1e12 },
      { date: "2026-09-01", amount: "abc" }, { date: 20260901, amount: 5 },
      { id: "keep", date: "2026-09-02T10:00:00Z", amount: "12.345", description: "  KROGER   #1  ", itemId: 42, category: "food" },
      { id: "keep", date: "2026-09-03", amount: -4.5, description: { evil: true }, itemId: "", category: "<script>" },
      { id: { x: 1 }, date: "2026-09-04", amount: 1, description: "x".repeat(500), itemId: ["a"] },
    ],
    rules: [null, { match: "k", itemId: "a" }, { match: "Kroger!", itemId: "groc" }, { match: "kroger", itemId: "other" }, { match: 5, itemId: "a" }, { match: "shell", itemId: "" }, { match: "SHELL OIL", itemId: 9 }],
  }, { categoryIds: ["food", "other"] });
  assert.equal(clean.transactions.length, 3);
  const [a, b, c] = clean.transactions;
  assert.deepEqual(a, { id: "keep", date: "2026-09-02", amount: 12.35, description: "KROGER #1", itemId: "42", category: "food" });
  assert.notEqual(b.id, "keep"); // duplicate ids are replaced
  assert.deepEqual([b.amount, b.description, b.itemId, b.category], [-4.5, "", null, null]);
  assert.equal(typeof c.id, "string");
  assert.ok(c.id.length > 0);
  assert.equal(c.description.length, 200);
  assert.equal(c.itemId, null);
  assert.deepEqual(clean.rules, [{ match: "kroger", itemId: "other" }, { match: "shell oil", itemId: "9" }]);
});

test("sanitize keeps only the newest 5,000 transactions", () => {
  const start = Date.UTC(2020, 0, 1);
  const raw = Array.from({ length: 5010 }, (_, i) => ({
    id: `t${i}`, date: new Date(start + i * 86400000).toISOString().slice(0, 10), amount: 1, description: `row ${i}`,
  }));
  // move an old row to the end and a new one to the front: dates decide, not position
  raw.push(raw.splice(3, 1)[0]);
  raw.unshift(raw.splice(raw.findIndex((t) => t.id === "t5005"), 1)[0]);
  const clean = S.sanitize({ transactions: raw, rules: [] });
  assert.equal(clean.transactions.length, S.MAX_TRANSACTIONS);
  const ids = new Set(clean.transactions.map((t) => t.id));
  for (let i = 0; i < 10; i++) assert.equal(ids.has(`t${i}`), false, `t${i} is among the oldest`);
  assert.equal(ids.has("t10"), true);
  assert.equal(ids.has("t5009"), true);
  assert.equal(clean.transactions[0].id, "t5005"); // order preserved
  assert.equal(clean.transactions[clean.transactions.length - 1].id, "t5009");
});

test("sanitize is idempotent and caps rules", () => {
  const rules = Array.from({ length: 600 }, (_, i) => ({ match: `merchant ${i}`, itemId: "a" }));
  const once = S.sanitize({ transactions: [{ id: "a", date: "2026-09-01", amount: 3, description: "x", itemId: null, category: null }], rules });
  assert.equal(once.rules.length, S.MAX_RULES);
  assert.equal(once.rules[S.MAX_RULES - 1].match, "merchant 599");
  assert.deepEqual(S.sanitize(once), once);
});

test("capTransactions drops the oldest and reports them", () => {
  const list = [{ date: "2026-03-01" }, { date: "2026-01-01" }, { date: "2026-02-01" }];
  const { kept, removed } = S.capTransactions(list, 2);
  assert.deepEqual(kept.map((t) => t.date), ["2026-03-01", "2026-02-01"]);
  assert.deepEqual(removed.map((t) => t.date), ["2026-01-01"]);
});

function round(n) {
  return Math.round(n * 100) / 100;
}
