/*
 * Spending: planned vs. actual by month, quick-add transactions, and bank CSV import.
 *
 * The pure logic below works in Node (module.exports) for tests and in the
 * browser (window.Spending). The UI at the bottom registers with window.App
 * only when the app is present.
 *
 * State owned by this module (state.spending):
 *   transactions: [{ id, date "YYYY-MM-DD", amount (+ spent, − refund),
 *                    description, itemId (budget item id | null), category (id | null) }]
 *   rules:        [{ match (normalized lowercase merchant text), itemId }]
 */
(/** @param {typeof globalThis & { Spending?: unknown }} root */ function (root) {
  "use strict";

  /**
   * @typedef {import("../types/app").AppApi} AppApi
   * @typedef {import("../types/app").AppContext} AppContext
   * @typedef {import("../types/app").AppModule<SpendingState>} SpendingModule
   * @typedef {import("../types/app").BudgetItem} BudgetItem
   * @typedef {import("../types/app").CategoryId} CategoryId
   * @typedef {import("../types/tax").Period} Period
   * @typedef {import("../types/spending").Transaction} Transaction
   * @typedef {import("../types/spending").Rule} Rule
   * @typedef {import("../types/spending").SpendingState} SpendingState
   * @typedef {import("../types/spending").CsvRow} CsvRow
   * @typedef {import("../types/spending").ColumnRole} ColumnRole
   * @typedef {import("../types/spending").ColumnMapping} ColumnMapping
   * @typedef {import("../types/spending").SignMode} SignMode
   * @typedef {import("../types/spending").DateOrder} DateOrder
   * @typedef {import("../types/spending").HeaderMatch} HeaderMatch
   * @typedef {import("../types/spending").Assignment} Assignment
   * @typedef {import("../types/spending").InflowKind} InflowKind
   * @typedef {import("../types/spending").ImportOptions} ImportOptions
   * @typedef {import("../types/spending").ImportRow} ImportRow
   * @typedef {import("../types/spending").ParsedImportRow} ParsedImportRow
   * @typedef {import("../types/spending").ImportResult} ImportResult
   * @typedef {import("../types/spending").ImportDraft} ImportDraft
   * @typedef {import("../types/spending").DateRange} DateRange
   * @typedef {import("../types/spending").SummaryCategory} SummaryCategory
   * @typedef {import("../types/spending").MonthSummaryInput} MonthSummaryInput
   * @typedef {import("../types/spending").MonthSummary} MonthSummary
   * @typedef {import("../types/spending").SummaryGroup} SummaryGroup
   * @typedef {import("../types/spending").MonthPace} MonthPace
   * @typedef {import("../types/spending").RulePrompt} RulePrompt
   * @typedef {import("../types/spending").SpendingElements} SpendingElements
   */

  const MAX_TRANSACTIONS = 5000;
  const MAX_RULES = 500;
  const MAX_DESC = 200;
  const MAX_AMOUNT = 1e8;
  const PREVIEW_ROWS = 10;
  /** @type {CategoryId[]} */
  const CATEGORY_IDS = ["housing", "transport", "food", "utilities", "debt", "savings", "subscriptions", "personal", "other"];
  /** @type {Record<Period, number>} */
  const PER_YEAR = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12, quarterly: 4, annual: 1 };
  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));

  const uid = () => Math.random().toString(36).slice(2, 10);
  /** @param {number} n */
  const round2 = (n) => (Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-7)) / 100 || 0;
  /** @returns {SpendingState} */
  const defaults = () => ({ transactions: [], rules: [] });
  /** @param {{ amount: number, recurrence: Period }} item */
  const defaultAnnualOf = (item) => (Number(item.amount) || 0) * (PER_YEAR[item.recurrence] || 12);

  // ---------- Dates ----------

  /** @param {number} n */
  const pad = (n) => String(n).padStart(2, "0");
  /** @param {number} y @param {number} m1 */
  const daysInMonth = (y, m1) => new Date(Date.UTC(y, m1, 0)).getUTCDate();

  /**
   * @param {number} y
   * @param {number} m
   * @param {number} d
   * @returns {string | null}
   */
  function makeISO(y, m, d) {
    if (!(y >= 1970 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m))) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  /** @param {unknown} s */
  function isISODate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === "string" ? s : "");
    return !!m && makeISO(+m[1], +m[2], +m[3]) === s;
  }

  function todayISO(now = new Date()) {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  /** @param {string} iso */
  const monthOf = (iso) => String(iso).slice(0, 7);

  /** @param {string} ym @param {number} delta */
  function shiftMonth(ym, delta) {
    let y = +ym.slice(0, 4);
    let m = +ym.slice(5, 7) - 1 + delta;
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return `${y}-${pad(m + 1)}`;
  }

  /** @param {string} ym */
  const monthLabel = (ym) => `${MONTH_NAMES[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;

  /** @type {Record<string, number | undefined>} */
  const MONTH_INDEX = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  /** @param {string} y */
  const fullYear = (y) => (y.length <= 2 ? (Number(y) < 70 ? 2000 : 1900) + Number(y) : Number(y));

  /**
   * Bank date → "YYYY-MM-DD" or null. Handles MM/DD/YYYY, M/D/YY, YYYY-MM-DD,
   * YYYYMMDD, "Sep 1, 2026", "1 Sep 2026", and trailing times.
   * order: "mdy" (US, default) or "dmy" for slash dates.
   * @param {unknown} value
   * @param {DateOrder} [order]
   * @returns {string | null}
   */
  function parseDate(value, order = "mdy") {
    const s = String(value ?? "").trim();
    if (!s) return null;
    /** @type {RegExpExecArray | null} */
    let m;
    if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[T\s])/.exec(s))) return makeISO(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:$|[T\s])/.exec(s))) {
      const y = fullYear(m[3]);
      return order === "dmy" ? makeISO(y, +m[2], +m[1]) : makeISO(y, +m[1], +m[2]);
    }
    if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return makeISO(+m[1], +m[2], +m[3]);
    if ((m = /^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(s))) {
      const mo = MONTH_INDEX[m[1].slice(0, 3).toLowerCase()];
      return mo ? makeISO(+m[3], mo, +m[2]) : null;
    }
    if ((m = /^(\d{1,2})[\s-]([a-z]{3,9})\.?[\s,-]+(\d{4}|\d{2})$/i.exec(s))) {
      const mo = MONTH_INDEX[m[2].slice(0, 3).toLowerCase()];
      return mo ? makeISO(fullYear(m[3]), mo, +m[1]) : null;
    }
    return null;
  }

  /**
   * "dmy" if the slash dates only make sense day-first (e.g. 28/09/2026), else "mdy".
   * @param {unknown[]} values
   * @returns {DateOrder}
   */
  function detectDateOrder(values) {
    let mdy = 0;
    let dmy = 0;
    for (const v of values) {
      const m = /^\s*(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.exec(String(v ?? ""));
      if (!m) continue;
      if (+m[1] > 12 && +m[2] <= 12) dmy++;
      else if (+m[2] > 12 && +m[1] <= 12) mdy++;
    }
    return dmy > mdy ? "dmy" : "mdy";
  }

  // ---------- Amounts ----------

  /**
   * "$1,234.56", "(12.00)", "12.00-", "-54.2300", "1.234,56" → number, or NaN.
   * @param {unknown} value
   * @returns {number}
   */
  function parseAmount(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
    let s = String(value ?? "").trim().replace(/−/g, "-");
    if (!s) return NaN;
    let neg = false;
    s = s.replace(/usd|cad|[$€£\s ']/gi, "");
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (s.endsWith("-")) { neg = !neg; s = s.slice(0, -1); }
    if (s.startsWith("+")) s = s.slice(1);
    else if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
    else if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
    if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
    const n = Number(s);
    return neg ? -n : n;
  }

  // ---------- CSV ----------

  /** @param {string} line @param {string} d */
  function countOutside(line, d) {
    let n = 0;
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === d && !q) n++;
    }
    return n;
  }

  /**
   * Pick ",", ";", tab or "|" by which gives the most consistent field count.
   * @param {string} text
   */
  function detectDelimiter(text) {
    /** @type {string[]} */
    const lines = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < text.length && lines.length < 25; i++) {
      const ch = text[i];
      if (ch === '"') q = !q;
      if (!q && (ch === "\n" || ch === "\r")) {
        if (cur.trim()) lines.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
    if (cur.trim() && lines.length < 25) lines.push(cur);
    let best = ",";
    let bestScore = 0;
    for (const d of [",", ";", "\t", "|"]) {
      /** @type {Map<number, number>} fields per line → number of lines */
      const freq = new Map();
      for (const l of lines) {
        const c = countOutside(l, d);
        if (c > 0) freq.set(c, (freq.get(c) || 0) + 1);
      }
      let score = 0;
      for (const [count, lineCount] of freq) score = Math.max(score, lineCount * 100 + Math.min(count, 99));
      if (score > bestScore) { best = d; bestScore = score; }
    }
    return best;
  }

  /**
   * RFC 4180-ish parser: quoted fields, "" escapes, newlines inside quotes,
   * CRLF/LF/CR, BOM, an Excel "sep=;" line, and , ; tab | delimiters.
   * Returns rows of raw strings, skipping blank lines.
   * @param {unknown} text
   * @param {string} [delimiter]
   * @returns {CsvRow[]}
   */
  function parseCSV(text, delimiter) {
    let s = String(text ?? "");
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    const sep = /^sep=(.)\r?\n/i.exec(s);
    if (sep) { delimiter = delimiter || sep[1]; s = s.slice(sep[0].length); }
    const d = delimiter || detectDelimiter(s);
    /** @type {CsvRow[]} */
    const rows = [];
    /** @type {CsvRow} */
    let row = [];
    let field = "";
    let inQ = false;
    const n = s.length;
    for (let i = 0; i < n; i++) {
      const ch = s[i];
      if (inQ) {
        if (ch === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false;
        } else field += ch;
        continue;
      }
      if (ch === '"') {
        if (field.trim() === "") { field = ""; inQ = true; } else field += ch;
      } else if (ch === d) {
        row.push(field);
        field = "";
      } else if (ch === "\r" || ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        if (ch === "\r" && s[i + 1] === "\n") i++;
      } else field += ch;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ""));
  }

  // ---------- Column detection ----------

  /** @type {ColumnRole[]} */
  const ROLES = ["date", "description", "amount", "debit", "credit", "type"];
  /** @returns {ColumnMapping} */
  const emptyMapping = () => ({ date: -1, description: -1, amount: -1, debit: -1, credit: -1, type: -1 });
  /** @param {unknown} h */
  const normHeader = (h) => String(h ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  /** Exact header names by role, most preferred first. @type {Record<ColumnRole, string[]>} */
  const HEADERS = {
    date: ["transaction date", "trans date", "date", "effective date", "posted date", "post date", "posting date", "posted", "date posted", "value date", "booking date"],
    description: ["description", "transaction description", "original description", "payee", "payee name", "merchant", "merchant name", "name", "memo", "extended description", "narrative", "transaction details", "details"],
    amount: ["amount", "transaction amount", "amount usd", "net amount", "trans amount"],
    debit: ["debit", "debits", "debit amount", "amount debit", "withdrawal", "withdrawals", "withdrawal amount", "withdrawal amt", "debit amt", "money out", "paid out", "outflow", "charges", "charge"],
    credit: ["credit", "credits", "credit amount", "amount credit", "deposit", "deposits", "deposit amount", "deposit amt", "credit amt", "money in", "paid in", "inflow", "payments"],
    type: ["transaction type", "type", "debit credit", "credit debit", "dr cr", "cr dr", "credit debit indicator"],
  };
  /** @type {Record<ColumnRole, RegExp>} */
  const FUZZY = {
    date: /\bdate\b/,
    description: /\b(desc|description|payee|merchant|memo|narrative)\b/,
    amount: /\b(amount|amt)\b/,
    debit: /\b(debit|debits|withdrawal|withdrawals)\b/,
    credit: /\b(credit|credits|deposit|deposits)\b/,
    type: /\btype\b/,
  };
  const FUZZY_EXCLUDE = /\b(balance|bal|card|account|acct|number|no|check|ref|reference|id|category|status|fee|fees)\b/;

  /**
   * Map header cells to column indexes by name. Missing roles are -1.
   * @param {CsvRow | null | undefined} cells
   * @returns {ColumnMapping}
   */
  function detectColumns(cells) {
    const names = (cells || []).map(normHeader);
    /** @type {{ role: ColumnRole, col: number, score: number }[]} */
    const cands = [];
    names.forEach((h, col) => {
      if (!h) return;
      for (const role of ROLES) {
        const idx = HEADERS[role].indexOf(h);
        if (idx >= 0) cands.push({ role, col, score: 100 - idx });
        else if (FUZZY[role].test(h) && !FUZZY_EXCLUDE.test(h)) cands.push({ role, col, score: 40 });
      }
    });
    cands.sort((a, b) => b.score - a.score || a.col - b.col);
    const m = emptyMapping();
    /** @type {Set<number>} */
    const used = new Set();
    for (const c of cands) {
      if (m[c.role] >= 0 || used.has(c.col)) continue;
      m[c.role] = c.col;
      used.add(c.col);
    }
    if (m.debit >= 0 && m.credit >= 0) m.amount = -1;
    else if (m.amount >= 0) { m.debit = -1; m.credit = -1; }
    return m;
  }

  /** @param {ColumnMapping} m */
  const hasAmountColumn = (m) => m.amount >= 0 || m.debit >= 0 || m.credit >= 0;
  /** @param {ColumnMapping | null | undefined} m */
  const isValidMapping = (m) => !!m && m.date >= 0 && m.description >= 0 && hasAmountColumn(m);

  /**
   * First row (in the first 25) that looks like a header; banks often add a preamble.
   * @param {CsvRow[]} rows
   * @returns {HeaderMatch | null}
   */
  function findHeader(rows) {
    for (let i = 0; i < Math.min(rows.length, 25); i++) {
      const cells = rows[i];
      if (cells.filter((c) => c.trim()).length < 2) continue;
      const mapping = detectColumns(cells);
      if (isValidMapping(mapping) && !parseDate(cells[mapping.date])) return { index: i, mapping };
    }
    return null;
  }

  /**
   * For header-less exports (e.g. Wells Fargo): guess columns from the values.
   * @param {CsvRow[]} rows
   * @returns {ColumnMapping}
   */
  function guessColumnsFromData(rows) {
    const sample = rows.slice(0, 60);
    const m = emptyMapping();
    if (!sample.length) return m;
    const ncols = sample.reduce((n, r) => Math.max(n, r.length), 0);
    /** @typedef {{ c: number, date: number, num: number, letters: number }} ColumnStat share of rows per kind */
    /** @type {ColumnStat[]} */
    const stats = [];
    for (let c = 0; c < ncols; c++) {
      let dates = 0;
      let nums = 0;
      let letters = 0;
      for (const r of sample) {
        const v = String(r[c] ?? "").trim();
        if (!v) continue;
        if (parseDate(v) || parseDate(v, "dmy")) dates++;
        else if (Number.isFinite(parseAmount(v))) nums++;
        letters += (v.match(/[a-z]/gi) || []).length;
      }
      stats.push({ c, date: dates / sample.length, num: nums / sample.length, letters: letters / sample.length });
    }
    /**
     * @param {ColumnStat[]} list
     * @param {"date" | "num" | "letters"} key
     * @param {number} min
     */
    const best = (list, key, min) => {
      /** @type {ColumnStat | null} */
      let pick = null;
      for (const s of list) if (s[key] >= min && (!pick || s[key] > pick[key])) pick = s;
      return pick;
    };
    const date = best(stats, "date", 0.6);
    if (date) m.date = date.c;
    const amount = stats.find((s) => s.c !== m.date && s.num >= 0.6);
    if (amount) m.amount = amount.c;
    const desc = best(stats.filter((s) => s.c !== m.date && s.c !== m.amount), "letters", 3);
    if (desc) m.description = desc.c;
    return m;
  }

  const DEBIT_TYPES = new Set(["debit", "dr", "db", "d", "withdrawal", "withdraw", "sale", "purchase", "charge"]);
  const CREDIT_TYPES = new Set(["credit", "cr", "c", "deposit", "refund", "return", "payment"]);

  /**
   * How to read the sign of each row:
   *   "debitcredit" separate columns; debits are spending
   *   "negative"    one Amount column, negatives are spending (most bank accounts)
   *   "positive"    one Amount column, positives are spending (many card exports)
   *   "type"        unsigned amounts + a Debit/Credit type column
   * @param {CsvRow[]} data
   * @param {ColumnMapping} mapping
   * @returns {SignMode}
   */
  function detectSignMode(data, mapping) {
    if (mapping.debit >= 0 || mapping.credit >= 0) return "debitcredit";
    let neg = 0;
    let pos = 0;
    for (const r of data) {
      const a = parseAmount(r[mapping.amount]);
      if (a < 0) neg++;
      else if (a > 0) pos++;
    }
    if (neg > pos) return "negative";
    if (neg === 0 && mapping.type >= 0) {
      let typed = 0;
      let total = 0;
      for (const r of data) {
        const t = normText(r[mapping.type]);
        if (!t) continue;
        total++;
        if (DEBIT_TYPES.has(t) || CREDIT_TYPES.has(t)) typed++;
      }
      if (total && typed / total >= 0.8) return "type";
    }
    return "positive";
  }

  /** @param {ColumnMapping} m @returns {SignMode[]} */
  const signModesFor = (m) => (m.debit >= 0 || m.credit >= 0 ? ["debitcredit"] : m.type >= 0 ? ["negative", "positive", "type"] : ["negative", "positive"]);

  // ---------- Merchants, rules, matching ----------

  /** Lowercase words only: "NETFLIX.COM #12" → "netflix com 12". @param {unknown} s */
  const normText = (s) => String(s ?? "").toLowerCase().replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  /** @param {unknown} s */
  const cleanDesc = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_DESC);

  const BANK_PREFIXES = [
    "purchase authorized on", "recurring payment authorized on", "recurring payment", "debit card purchase",
    "debit card recurring payment", "debit card payment", "debit card debit", "debit card", "checkcard", "check card purchase",
    "check card", "card purchase with pin", "card purchase", "pos purchase", "pos debit", "pos withdrawal", "pos",
    "point of sale debit", "point of sale", "visa purchase", "visa debit", "dbt purchase", "dbt crd", "purchase",
    "recurring", "ach debit", "ach withdrawal", "ach", "preauthorized debit", "pre authorized debit",
    "electronic withdrawal", "withdrawal", "debit", "pos return", "return", "refund", "to", "from",
  ];
  const BANK_PREFIX_RE = new RegExp(
    "^(?:" + BANK_PREFIXES.map((p) => p.replace(/ /g, "[\\s_-]+")).join("|") + ")(?:[\\s:#*_-]+|$)" +
    "(?:\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?|\\d{4}(?!\\d))?[\\s:_-]*",
    "i"
  );
  // Payment processors: Square, Toast, PayPal, Shopify, DoorDash...
  const PROCESSOR_RE = /^(?:sq|tst|pp|paypal|sp|py|in|ec|bt|dd|clv|gsq|ckc|fs|lr|ic|toast|wpy|sumup|pos)\s*\*\s*/i;
  const STORE_WORDS = new Set(["store", "str", "sto", "stor", "no", "num", "unit", "loc", "ste", "location"]);
  const US_STATES = new Set("al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy dc".split(" "));
  const CITY_FIRST = new Set("ann grand royal east west north south new san los las santa st saint fort ft battle bay traverse sterling rochester farmington auburn madison grosse mount mt port lake palo el la des twin bloomfield shelby clinton harper white walled big oak sault highland commerce".split(" "));
  const TRAILING_WORDS = new Set(["bill", "pay", "payment", "pmt", "pymt", "autopay", "online", "web", "ach", "ppd", "debit", "purchase", "recurring", "inc", "llc"]);
  const P2P = new Set(["zelle", "venmo", "cash"]);
  const GENERIC_KEYS = new Set(["check", "share draft", "atm", "atm withdrawal", "withdrawal", "transfer", "online transfer", "deposit", "payment", "fee", "service charge", "cash", "debit", "credit", "purchase", "pos", "no description"]);

  /**
   * Short merchant key for rules: strips bank prefixes ("POS", "DEBIT CARD PURCHASE"),
   * processors ("SQ *", "TST*"), dates, store numbers, codes and a trailing city/state.
   * Always a word-start substring of normText(description), so rules built from it match.
   * @param {unknown} desc
   * @returns {string}
   */
  function merchantKey(desc) {
    let s = String(desc ?? "").toLowerCase().trim();
    for (let i = 0; i < 6; i++) {
      const next = s.replace(BANK_PREFIX_RE, "").replace(PROCESSOR_RE, "").replace(/^[\s\-:#*.]+/, "");
      if (next === s) break;
      s = next;
    }
    // Fixed-width exports pad the merchant name with spaces; ACH lines add "DES:", "PPD ID:" etc.
    const chunk = (s.split(/\s{2,}|\t/).find((c) => /[a-z]/.test(c)) || "").split(/\s(?:des|id|indn|co id|ppd id|web id|conf|confirmation)\s*[:#]/)[0];
    const tokens = normText(chunk).split(" ").filter(Boolean);
    /** @type {string[]} */
    let out = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (/\d/.test(t)) { if (out.length) break; continue; }
      if (out.length && STORE_WORDS.has(t) && (!tokens[i + 1] || /\d/.test(tokens[i + 1]))) break;
      out.push(t);
    }
    if (out.length >= 2 && US_STATES.has(out[out.length - 1])) {
      out.pop();
      if (out.length >= 2) out.pop();
      if (out.length >= 2 && CITY_FIRST.has(out[out.length - 1])) out.pop();
    }
    while (out.length > 1 && TRAILING_WORDS.has(out[out.length - 1])) out.pop();
    out = out.slice(0, P2P.has(out[0]) ? 5 : 3);
    while (out.length > 1 && TRAILING_WORDS.has(out[out.length - 1])) out.pop();
    let key = out.join(" ");
    const full = " " + normText(desc) + " ";
    if (!key || !full.includes(" " + key + " ")) {
      const words = normText(desc).split(" ").filter(Boolean);
      const start = words.findIndex((w) => !/\d/.test(w));
      key = start < 0 ? "" : words.slice(start, start + 3).join(" ");
    }
    return key;
  }

  /** @param {string} key */
  const isGenericKey = (key) => !key || key.length < 3 || GENERIC_KEYS.has(key);

  /**
   * Rule text matches at a word start in the description (after normalizing both).
   * @param {string} match
   * @param {string} desc
   */
  function ruleMatches(match, desc) {
    const m = normText(match);
    return !!m && (" " + normText(desc) + " ").includes(" " + m);
  }

  /**
   * Most specific (longest) rule that matches; rules for missing items are ignored.
   * @param {Rule[] | null | undefined} rules
   * @param {string} desc
   * @param {Set<string> | null} [validIds] item ids that exist; omit to accept any
   * @returns {Rule | null}
   */
  function findRule(rules, desc, validIds) {
    /** @type {Rule | null} */
    let best = null;
    let bestLen = 0;
    const n = " " + normText(desc) + " ";
    for (const r of rules || []) {
      if (!r || (validIds && !validIds.has(r.itemId))) continue;
      const m = normText(r.match);
      if (m && m.length > bestLen && n.includes(" " + m)) { best = r; bestLen = m.length; }
    }
    return best;
  }

  /**
   * Budget item whose whole name appears as words in the description (longest wins).
   * @param {string} desc
   * @param {BudgetItem[] | null | undefined} items
   * @returns {BudgetItem | null}
   */
  function matchItemByName(desc, items) {
    const n = " " + normText(desc) + " ";
    /** @type {BudgetItem | null} */
    let best = null;
    let bestLen = 0;
    for (const it of items || []) {
      const name = normText(it && it.name);
      const compact = name.replace(/ /g, "");
      if (compact.length < 3) continue;
      for (const v of name === compact ? [name] : [name, compact]) {
        if (v.length > bestLen && n.includes(" " + v + " ")) { best = it; bestLen = v.length; }
      }
    }
    return best;
  }

  /**
   * Saved rules first, then an item name in the description, else unassigned.
   * @param {string} desc
   * @param {BudgetItem[] | null | undefined} items
   * @param {Rule[] | null | undefined} rules
   * @returns {Assignment}
   */
  function autoAssign(desc, items, rules) {
    const ids = new Set((items || []).map((i) => i.id));
    const rule = findRule(rules, desc, ids);
    if (rule) return { itemId: rule.itemId, source: "rule" };
    const item = matchItemByName(desc, items);
    if (item) return { itemId: item.id, source: "name" };
    return { itemId: null, source: null };
  }

  const TAX_RE = /\b(tax ref|tax refund|irs|treas|us treasury|state of michigan|mi treasury)\b/;
  const REFUND_RE = /\b(refund|refunded|return|returned|reversal|reversed|credit voucher|merchandise credit|merchant credit|chargeback)\b/;
  const INCOME_RE = /\b(payroll|direct dep|direct deposit|dir dep|salary|paycheck|deposit|deposits|mobile dep|transfer|xfer|trnsfr|tfr|zelle|venmo|cash app|cashout|cash out|interest|dividend|dividends|thank you|autopay|auto pay|pymt|payment received|payment from|online payment|mobile payment|epayment|ach credit|unemployment|ssa|soc sec|pension)\b/;
  const TYPE_INCOME_RE = /\b(payment|deposit|dep|xfer|transfer|payroll|ach credit|quickpay credit|partnerfi|dslip|interest|dividend|wire in|incoming)\b/;
  const TYPE_REFUND_RE = /\b(return|refund|reversal)\b/;

  /**
   * Money coming in: "refund" (kept as negative spending) or "income"
   * (paychecks, transfers, card payments: skipped).
   * @param {string} desc
   * @param {string} type value of the type column, or ""
   * @param {Set<string> | null} [merchants] merchant keys already spent at
   * @param {Rule[] | null} [rules]
   * @param {Set<string> | null} [validIds]
   * @returns {InflowKind}
   */
  function classifyInflow(desc, type, merchants, rules, validIds) {
    const d = normText(desc);
    const t = normText(type);
    if (TAX_RE.test(d)) return "income";
    if (TYPE_REFUND_RE.test(t) || REFUND_RE.test(d)) return "refund";
    if (TYPE_INCOME_RE.test(t) || INCOME_RE.test(d)) return "income";
    if (findRule(rules, desc, validIds)) return "refund";
    if (merchants && merchants.has(merchantKey(desc))) return "refund";
    return "income";
  }

  /** @param {{ date: string, amount: number, description: string }} t */
  const dedupeKey = (t) => `${t.date}|${Math.round(Number(t.amount) * 100)}|${normText(t.description)}`;

  // ---------- Import ----------

  /**
   * Parse a bank CSV into a preview + transactions ready to add.
   * opts: { items, rules, existing (transactions), mapping (overrides), signMode, uid }
   * @param {string} text
   * @param {ImportOptions} [opts]
   * @returns {ImportResult}
   */
  function prepareImport(text, opts = {}) {
    const items = opts.items || [];
    const rules = opts.rules || [];
    const existing = opts.existing || [];
    const makeId = opts.uid || uid;
    const validIds = new Set(items.map((i) => i.id));
    const itemMap = new Map(items.map((i) => [i.id, i]));
    const counts = { rows: 0, new: 0, duplicate: 0, income: 0, invalid: 0, refunds: 0 };
    /** @type {ImportResult} */
    const out = {
      ok: false, error: "", columns: [], hasHeader: false, mapping: emptyMapping(), detected: emptyMapping(),
      signMode: "negative", detectedSign: "negative", signModes: [], dateOrder: "mdy",
      rows: [], transactions: [], counts, dateRange: null,
    };

    const rows = parseCSV(text);
    if (!rows.length) { out.error = "That file is empty."; return out; }
    const found = findHeader(rows);
    let headerIndex = found ? found.index : -1;
    const detected = found ? found.mapping : guessColumnsFromData(rows);
    if (!found && detected.date >= 0 && !parseDate(rows[0][detected.date]) &&
        !(detected.amount >= 0 && Number.isFinite(parseAmount(rows[0][detected.amount])))) {
      headerIndex = 0; // unrecognized header names, but it is a header row
    }
    const header = headerIndex >= 0 ? rows[headerIndex] : null;
    const data = rows.slice(headerIndex + 1);
    let ncols = header ? header.length : 0;
    for (const r of data.slice(0, 500)) ncols = Math.max(ncols, r.length);
    out.hasHeader = !!header;
    out.detected = detected;
    out.columns = Array.from({ length: ncols }, (_, i) => {
      const name = header && String(header[i] ?? "").trim();
      const sampleRow = data.find((r) => String(r[i] ?? "").trim());
      return { index: i, name: name || `Column ${i + 1}`, sample: sampleRow ? String(sampleRow[i]).trim().slice(0, 40) : "" };
    });

    const mapping = { ...detected };
    if (opts.mapping) {
      for (const role of ROLES) {
        const v = Number(opts.mapping[role]);
        if (Number.isInteger(v) && v >= -1 && v < ncols) mapping[role] = v;
      }
    }
    out.mapping = mapping;
    if (!isValidMapping(mapping)) {
      out.error = "Couldn't find the date, description and amount columns. Pick them below.";
      return out;
    }

    const dateOrder = detectDateOrder(data.map((r) => r[mapping.date]));
    const detectedSign = detectSignMode(data, mapping);
    out.signModes = signModesFor(mapping);
    const signMode = opts.signMode && out.signModes.includes(opts.signMode) ? opts.signMode : detectedSign;
    Object.assign(out, { dateOrder, detectedSign, signMode });

    /** @type {ImportRow[]} */
    const parsed = [];
    for (const r of data) {
      /** @param {number} c */
      const cell = (c) => (c >= 0 && c < r.length ? String(r[c] ?? "").trim() : "");
      const rawDate = cell(mapping.date);
      const description = cleanDesc(cell(mapping.description));
      const type = cell(mapping.type);
      let spend = NaN;
      /** @type {string} */
      let rawAmount;
      if (signMode === "debitcredit") {
        const dRaw = cell(mapping.debit);
        const cRaw = cell(mapping.credit);
        rawAmount = dRaw || cRaw;
        const d = parseAmount(dRaw);
        const c = parseAmount(cRaw);
        if (Number.isFinite(d) && d !== 0) spend = Math.abs(d);
        else if (Number.isFinite(c) && c !== 0) spend = -Math.abs(c);
        else if (Number.isFinite(d) || Number.isFinite(c)) spend = 0;
      } else {
        rawAmount = cell(mapping.amount);
        const a = parseAmount(rawAmount);
        if (Number.isFinite(a)) {
          if (signMode === "negative") spend = -a;
          else if (signMode === "positive") spend = a;
          else spend = CREDIT_TYPES.has(normText(type)) ? -Math.abs(a) : Math.abs(a);
        }
      }
      // Rows with no amount at all (e.g. "Beginning balance" lines) are silently ignored.
      if (!rawAmount) continue;
      counts.rows++;
      const date = parseDate(rawDate, dateOrder);
      if (!date || !Number.isFinite(spend) || Math.abs(spend) > MAX_AMOUNT) {
        counts.invalid++;
        parsed.push({ status: "invalid", date, rawDate, rawAmount, description, amount: NaN });
        continue;
      }
      if (Math.abs(spend) < 0.005) { counts.rows--; continue; }
      parsed.push({ status: "", date, description: description || "(no description)", amount: round2(spend), type });
    }

    /** @type {Set<string>} */
    const merchants = new Set();
    for (const t of existing) if (t && t.amount > 0) merchants.add(merchantKey(t.description));
    for (const p of parsed) if (p.amount > 0) merchants.add(merchantKey(p.description));

    /** @type {Map<string, number>} dedupe key → saved transactions left to match */
    const have = new Map();
    for (const t of existing) {
      if (!t) continue;
      const k = dedupeKey(t);
      have.set(k, (have.get(k) || 0) + 1);
    }

    /** @type {string | null} */
    let from = null;
    /** @type {string | null} */
    let to = null;
    for (const p of parsed) {
      if (p.status === "invalid") continue;
      if (!from || p.date < from) from = p.date;
      if (!to || p.date > to) to = p.date;
      if (p.amount < 0) {
        if (classifyInflow(p.description, p.type, merchants, rules, validIds) === "income") {
          p.status = "income";
          counts.income++;
          continue;
        }
        p.refund = true;
      }
      const key = dedupeKey(p);
      if (Number(have.get(key)) > 0) {
        have.set(key, Number(have.get(key)) - 1);
        p.status = "duplicate";
        counts.duplicate++;
        continue;
      }
      const { itemId, source } = autoAssign(p.description, items, rules);
      p.status = "new";
      p.itemId = itemId;
      p.source = source;
      counts.new++;
      if (p.refund) counts.refunds++;
      const item = itemId ? itemMap.get(itemId) : null;
      out.transactions.push({
        id: makeId(), date: p.date, amount: p.amount, description: p.description,
        itemId: itemId || null, category: item ? item.category : null,
      });
    }
    out.rows = parsed;
    out.dateRange = from && to ? { from, to } : null; // set together, so both or neither
    out.ok = true;
    return out;
  }

  // ---------- Month math ----------

  /**
   * Planned vs. actual for one month ("YYYY-MM").
   * Planned = annualOf(item) / 12. Transactions for unknown items count as unassigned.
   * @param {MonthSummaryInput} [input]
   * @returns {MonthSummary}
   */
  function monthSummary({ items = [], transactions = [], month, today, annualOf = defaultAnnualOf, categories } = {}) {
    const itemIds = new Set(items.map((i) => i.id));
    /** @type {Map<string, number>} */
    const actualBy = new Map();
    let unassigned = 0;
    let unassignedCount = 0;
    let count = 0;
    for (const t of transactions) {
      if (!t || typeof t.date !== "string" || t.date.slice(0, 7) !== month) continue;
      count++;
      if (t.itemId && itemIds.has(t.itemId)) actualBy.set(t.itemId, (actualBy.get(t.itemId) || 0) + t.amount);
      else { unassigned += t.amount; unassignedCount++; }
    }
    /** @type {SummaryCategory[]} */
    const cats = (categories && categories.length ? categories : []).slice();
    for (const i of items) {
      if (!cats.some((c) => c.id === i.category)) cats.push({ id: i.category, name: String(i.category || "Other") });
    }
    /** @type {SummaryGroup[]} */
    const groups = [];
    for (const c of cats) {
      const rows = items.filter((i) => i.category === c.id).map((item) => {
        const planned = round2(annualOf(item) / 12);
        const actual = round2(actualBy.get(item.id) || 0);
        return {
          item, planned, actual, diff: round2(planned - actual),
          ratio: planned > 0 ? actual / planned : actual > 0 ? Infinity : 0,
          over: actual > planned + 0.005,
        };
      });
      if (!rows.length) continue;
      const planned = round2(rows.reduce((s, r) => s + r.planned, 0));
      const actual = round2(rows.reduce((s, r) => s + r.actual, 0));
      groups.push({ category: c, rows, planned, actual, diff: round2(planned - actual), over: actual > planned + 0.005 });
    }
    const planned = round2(groups.reduce((s, g) => s + g.planned, 0));
    const actual = round2(groups.reduce((s, g) => s + g.actual, 0) + unassigned);
    /** @type {MonthSummary} */
    const summary = {
      month, groups, count,
      unassigned: { actual: round2(unassigned), count: unassignedCount },
      totals: { planned, actual, diff: round2(planned - actual), over: actual > planned + 0.005 },
      pace: null,
    };
    if (today && monthOf(today) === month) {
      const day = +today.slice(8, 10);
      const dim = daysInMonth(+month.slice(0, 4), +month.slice(5, 7));
      const expected = round2((planned * day) / dim);
      summary.pace = { day, daysInMonth: dim, fraction: day / dim, expected, actual, diff: round2(expected - actual) };
    }
    return summary;
  }

  // ---------- Sanitize ----------

  /**
   * Keep the newest `max` transactions (by date), preserving order.
   * @param {Transaction[]} list
   * @param {number} [max]
   * @returns {{ kept: Transaction[], removed: Transaction[] }}
   */
  function capTransactions(list, max = MAX_TRANSACTIONS) {
    if (list.length <= max) return { kept: list, removed: [] };
    const order = list.map((t, i) => i).sort((a, b) => (list[a].date < list[b].date ? 1 : list[a].date > list[b].date ? -1 : b - a));
    const keep = new Set(order.slice(0, max));
    return { kept: list.filter((t, i) => keep.has(i)), removed: list.filter((t, i) => !keep.has(i)) };
  }

  /** @param {unknown} v */
  const idLike = (v) => ((typeof v === "string" || (typeof v === "number" && Number.isFinite(v))) && String(v).trim() ? String(v).trim().slice(0, 40) : "");
  /** @param {unknown} v @returns {v is Record<string, unknown>} */
  const isObject = (v) => !!v && typeof v === "object";

  /**
   * Defensive clean-up of state.spending from storage, import files or the server.
   * @param {unknown} raw
   * @param {{ categoryIds?: readonly CategoryId[] }} [opts]
   * @returns {SpendingState}
   */
  function sanitize(raw, opts = {}) {
    /** @type {Set<unknown>} */
    const cats = new Set(opts.categoryIds || CATEGORY_IDS);
    const out = defaults();
    if (!isObject(raw) || Array.isArray(raw)) return out;
    if (Array.isArray(raw.transactions)) {
      /** @type {Set<string>} */
      const ids = new Set();
      /** @type {Transaction[]} */
      const list = [];
      for (const t of /** @type {unknown[]} */ (raw.transactions)) {
        if (!isObject(t) || Array.isArray(t)) continue;
        const date = typeof t.date === "string" ? t.date.slice(0, 10) : "";
        if (!isISODate(date)) continue;
        const amount = typeof t.amount === "number" ? t.amount : typeof t.amount === "string" ? parseAmount(t.amount) : NaN;
        if (!Number.isFinite(amount) || Math.abs(amount) > MAX_AMOUNT) continue;
        let id = idLike(t.id);
        while (!id || ids.has(id)) id = uid();
        ids.add(id);
        list.push({
          id, date, amount: round2(amount),
          description: typeof t.description === "string" ? cleanDesc(t.description) : "",
          itemId: idLike(t.itemId) || null,
          category: cats.has(t.category) ? /** @type {CategoryId} */ (t.category) : null,
        });
      }
      out.transactions = capTransactions(list).kept;
    }
    if (Array.isArray(raw.rules)) {
      /** @type {Map<string, Rule>} */
      const byMatch = new Map();
      for (const r of /** @type {unknown[]} */ (raw.rules)) {
        if (!isObject(r)) continue;
        const match = typeof r.match === "string" ? normText(r.match).slice(0, 60).trim() : "";
        const itemId = idLike(r.itemId);
        if (match.length < 2 || !itemId) continue;
        byMatch.delete(match);
        byMatch.set(match, { match, itemId });
      }
      out.rules = [...byMatch.values()].slice(-MAX_RULES);
    }
    return out;
  }

  const api = {
    MAX_TRANSACTIONS, MAX_RULES, PREVIEW_ROWS,
    defaults, sanitize, capTransactions,
    parseCSV, detectDelimiter, parseDate, detectDateOrder, parseAmount,
    normHeader, detectColumns, findHeader, guessColumnsFromData, detectSignMode, isValidMapping, prepareImport,
    normText, merchantKey, isGenericKey, ruleMatches, findRule, matchItemByName, autoAssign, classifyInflow, dedupeKey,
    monthSummary, monthOf, shiftMonth, monthLabel, daysInMonth, todayISO, isISODate, round2,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Spending = api;

  if (typeof window !== "undefined" && window.App && typeof document !== "undefined") mountUI(window.App);

  // =====================================================================
  // Browser UI
  // =====================================================================

  /** @param {AppApi} App */
  function mountUI(App) {
    const U = App.util;
    const { esc, money } = U;
    const NONE = "__none";
    const LIST_LIMIT = 200;
    const ICON_PREV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';
    const ICON_NEXT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

    /** @type {HTMLElement | null} */
    let rootEl = null;
    /** Filled by init() right after it writes the markup. */
    const el = /** @type {SpendingElements} */ ({});
    let viewMonth = monthOf(todayISO());
    let search = "";
    let filter = "";
    let showAll = false;
    /** @type {RulePrompt | null} */
    let ask = null;
    /** @type {ImportDraft | null} */
    let draft = null;
    /** @type {string | null} */
    let optsSig = null;
    let optsHTML = "";

    const categoryIds = () => U.CATEGORIES.map((c) => c.id);
    const items = () => App.state().items || [];
    const itemMap = () => new Map(items().map((i) => [i.id, i]));

    /** state.spending, repaired first if it isn't the right shape. */
    function data() {
      const st = App.state();
      const sp = /** @type {{ transactions?: unknown, rules?: unknown } | null | undefined} */ (st.spending);
      if (!sp || typeof sp !== "object" || !Array.isArray(sp.transactions) || !Array.isArray(sp.rules)) {
        st.spending = sanitize(sp, { categoryIds: categoryIds() });
      }
      return /** @type {SpendingState} */ (st.spending);
    }

    function renderSelf() {
      try { render(App.context()); } catch (err) { console.error("[spending render]", err); }
    }

    /** @param {number} n @param {string} word @param {string} [many] */
    const plural = (n, word, many) => `${n} ${n === 1 ? word : many || word + "s"}`;
    /** @param {string} s */
    const short = (s, n = 40) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

    /** @param {string} iso @param {boolean} [withYear] */
    function fmtDate(iso, withYear) {
      const y = iso.slice(0, 4);
      const base = `${MONTH_SHORT[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`;
      return withYear || y !== todayISO().slice(0, 4) ? `${base}, ${y}` : base;
    }

    /** @param {DateRange | null} r */
    function fmtRange(r) {
      if (!r) return "no dates";
      if (r.from === r.to) return fmtDate(r.from, true);
      const sameYear = r.from.slice(0, 4) === r.to.slice(0, 4);
      return `${sameYear ? fmtDate(r.from).replace(/, \d{4}$/, "") : fmtDate(r.from, true)} – ${fmtDate(r.to, true)}`;
    }

    /** @param {BudgetItem[]} list */
    function itemOptions(list, noneLabel = "Unassigned") {
      let html = `<option value="">${esc(noneLabel)}</option>`;
      for (const c of U.CATEGORIES) {
        const inCat = list.filter((i) => i.category === c.id);
        if (!inCat.length) continue;
        html += `<optgroup label="${esc(c.name)}">${inCat.map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join("")}</optgroup>`;
      }
      return html;
    }

    /** @param {HTMLSelectElement} sel @param {string} html @param {string} value */
    function setSelect(sel, html, value) {
      sel.innerHTML = html;
      sel.value = value;
      if (sel.value !== value) sel.value = "";
    }

    // ---------- Skeleton ----------

    function init() {
      rootEl = document.getElementById("spendingRoot");
      if (!rootEl) return;
      rootEl.classList.add("sp");
      rootEl.innerHTML = `
        <section class="card sp-import" id="spImport" aria-labelledby="spImportTitle" hidden></section>

        <section class="card sp-intro" id="spIntro" aria-labelledby="spIntroTitle" hidden>
          <h2 class="card-title" id="spIntroTitle">Track what you actually spend</h2>
          <p>Log what you actually spend, or import a CSV from your bank, and compare it to your budget.</p>
          <div class="sp-actions">
            <button type="button" class="btn primary" data-sp="focus-add">Add a transaction</button>
            <button type="button" class="btn" data-sp="import">Import a bank CSV</button>
          </div>
          <p class="hint sp-introhint">Most banks and credit unions have a “Download” or “Export” button on the transactions page. The file is read in your browser.</p>
          <p class="hint sp-introhint" id="spIntroItems" hidden>You don't have any budget items yet. <a href="#budget" data-goto="budget">Add some on the Budget tab</a> to compare against.</p>
        </section>

        <section class="card sp-month" id="spMonth" aria-labelledby="spMonthTitle" hidden>
          <div class="sp-head">
            <div>
              <h2 class="card-title" id="spMonthTitle">Planned vs. actual</h2>
              <div class="sp-monthpick">
                <button type="button" class="icon-btn" data-sp="prev" aria-label="Previous month" title="Previous month">${ICON_PREV}</button>
                <span class="sp-monthlabel" id="spMonthLabel" aria-live="polite"></span>
                <button type="button" class="icon-btn" data-sp="next" aria-label="Next month" title="Next month">${ICON_NEXT}</button>
                <button type="button" class="btn ghost sp-small" data-sp="this-month" id="spThisMonth" hidden>This month</button>
              </div>
            </div>
            <div class="sp-summary" id="spSummary"></div>
          </div>
          <p class="sp-pace" id="spPace" hidden></p>
          <div class="table-wrap">
            <table class="items sp-plan" id="spPlan">
              <thead><tr>
                <th scope="col">Budget item</th>
                <th scope="col" class="num hide-sm">Planned</th>
                <th scope="col" class="num">Spent</th>
                <th scope="col" class="num">Left</th>
              </tr></thead>
              <tbody></tbody>
              <tfoot></tfoot>
            </table>
          </div>
          <p class="hint sp-noitems" id="spNoItems" hidden>No budget items yet. <a href="#budget" data-goto="budget">Add some on the Budget tab</a> to see planned vs. actual.</p>
        </section>

        <section class="card sp-txcard" id="spTx" aria-labelledby="spTxTitle">
          <div class="sp-head">
            <h2 class="card-title" id="spTxTitle">Transactions</h2>
            <div class="sp-actions">
              <button type="button" class="btn" data-sp="import">Import CSV</button>
              <input type="file" id="spFile" accept=".csv,text/csv,.txt,text/plain" hidden>
            </div>
          </div>
          <form class="add sp-add" id="spAddForm" autocomplete="off" novalidate>
            <div class="field grow">
              <label for="spDesc">Description</label>
              <input id="spDesc" maxlength="${MAX_DESC}" placeholder="e.g. Kroger">
            </div>
            <div class="field">
              <label for="spDate">Date</label>
              <input id="spDate" type="date">
            </div>
            <div class="field">
              <label for="spAmount">Amount</label>
              <div class="money"><span>$</span><input id="spAmount" placeholder="0.00" aria-describedby="spAddHint"></div>
            </div>
            <div class="field sp-itemfield">
              <label for="spItem">Budget item</label>
              <select id="spItem"></select>
            </div>
            <button class="btn primary" type="submit">Add</button>
          </form>
          <p class="hint sp-addhint" id="spAddHint">Amounts are what you spent. Use a minus sign for a refund.</p>
          <div id="spListWrap">
            <div class="sp-filters">
              <input type="search" id="spSearch" placeholder="Search" aria-label="Search this month's transactions" autocomplete="off">
              <select id="spFilter" aria-label="Show transactions for"></select>
            </div>
            <p class="sp-count" id="spCount" aria-live="polite"></p>
            <ul class="sp-list" id="spList"></ul>
            <p class="empty" id="spListEmpty" hidden></p>
            <div class="sp-more" id="spMore" hidden><button type="button" class="btn ghost" data-sp="show-all"></button></div>
            <details class="more sp-rules" id="spRules" hidden>
              <summary id="spRulesSummary">Auto-assign rules</summary>
              <ul class="sp-rulelist" id="spRuleList"></ul>
              <p class="hint sp-ruleshint">Rules are saved when you reassign a transaction and choose “Always”. They're used for new transactions and imports.</p>
            </details>
          </div>
        </section>`;

      for (const id of ["spImport", "spIntro", "spIntroItems", "spMonth", "spMonthLabel", "spThisMonth", "spSummary", "spPace", "spPlan", "spNoItems",
        "spTx", "spTxTitle", "spFile", "spAddForm", "spDesc", "spDate", "spAmount", "spItem", "spListWrap", "spSearch", "spFilter",
        "spCount", "spList", "spListEmpty", "spMore", "spRules", "spRulesSummary", "spRuleList"]) {
        /** @type {Record<string, HTMLElement | null>} */ (el)[id] = document.getElementById(id);
      }
      el.spDate.value = todayISO();

      rootEl.addEventListener("click", onClick);
      rootEl.addEventListener("change", onChange);
      el.spAddForm.addEventListener("submit", onAdd);
      el.spDesc.addEventListener("input", () => { el.spDesc.classList.remove("invalid"); suggestItem(); });
      el.spAmount.addEventListener("input", () => el.spAmount.classList.remove("invalid"));
      el.spDate.addEventListener("input", () => el.spDate.classList.remove("invalid"));
      el.spItem.addEventListener("change", () => { el.spItem.dataset.touched = "1"; });
      el.spSearch.addEventListener("input", () => { search = el.spSearch.value; showAll = false; renderSelf(); });
      el.spFile.addEventListener("change", async (e) => {
        if (!(e.target instanceof HTMLInputElement)) return;
        const file = e.target.files && e.target.files[0];
        e.target.value = "";
        if (file) await readFile(file);
      });
      rootEl.addEventListener("dragover", (e) => {
        if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) e.preventDefault();
      });
      rootEl.addEventListener("drop", (e) => {
        const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!file) return;
        e.preventDefault();
        readFile(file);
      });
    }

    // ---------- Render ----------

    /** @param {AppContext} ctx */
    function render(ctx) {
      if (!rootEl) return;
      const cur = /** @type {SpendingState | null | undefined} */ (ctx.state.spending);
      const sp = cur && Array.isArray(cur.transactions) ? cur : data();
      const list = ctx.state.items || [];
      const today = todayISO();
      const hasTx = sp.transactions.length > 0;

      const sig = JSON.stringify(list.map((i) => [i.id, i.name, i.category]));
      if (sig !== optsSig) {
        optsSig = sig;
        optsHTML = itemOptions(list);
        setSelect(el.spItem, optsHTML, el.spItem.value);
      }

      renderImport();
      el.spIntro.hidden = hasTx || !!draft;
      el.spIntroItems.hidden = list.length > 0;
      el.spMonth.hidden = !hasTx;
      el.spListWrap.hidden = !hasTx;
      el.spTxTitle.textContent = hasTx ? `Transactions · ${monthLabel(viewMonth)}` : "Add a transaction";
      if (hasTx) {
        renderMonth(ctx, sp, list, today);
        renderList(sp, list);
      }
      renderRules(sp, list);
    }

    /** @param {number} actual @param {number} planned @param {MonthPace | null} pace */
    function barHTML(actual, planned, pace) {
      const over = actual > planned + 0.005;
      const width = planned > 0 ? Math.min(100, Math.max(0, (actual / planned) * 100)) : actual > 0 ? 100 : 0;
      const tick = pace && planned > 0 ? `<b style="left:${(pace.fraction * 100).toFixed(1)}%" title="Where a steady pace would be today"></b>` : "";
      return `<div class="sp-bar${over ? " over" : ""}" aria-hidden="true"><i style="width:${width.toFixed(1)}%"></i>${tick}</div>`;
    }

    /** @param {number} diff @param {number} planned @param {number} actual */
    function leftHTML(diff, planned, actual) {
      if (planned <= 0 && actual <= 0) return `<span class="muted">—</span>`;
      if (diff < -0.005) return `<span class="bad">${money(-diff)}<small class="sp-overtag"> over</small></span>`;
      return money(diff);
    }

    /**
     * @param {AppContext} ctx
     * @param {SpendingState} sp
     * @param {BudgetItem[]} list
     * @param {string} today
     */
    function renderMonth(ctx, sp, list, today) {
      const s = monthSummary({ items: list, transactions: sp.transactions, month: viewMonth, today, annualOf: U.annualOf, categories: U.CATEGORIES });
      const isCurrent = viewMonth === monthOf(today);
      el.spMonthLabel.textContent = monthLabel(viewMonth);
      el.spThisMonth.hidden = isCurrent;

      const t = s.totals;
      const mShort = MONTH_SHORT[+viewMonth.slice(5, 7) - 1];
      el.spSummary.innerHTML = `
        <div class="stat"><div class="k">Spent in ${mShort}</div><div class="v">${money(t.actual)}</div></div>
        <div class="stat"><div class="k">Planned</div><div class="v">${money(t.planned)}</div></div>
        <div class="stat"><div class="k">${t.diff >= 0 ? "Left" : "Over"}</div><div class="v ${t.diff >= 0 ? "good" : "bad"}">${money(Math.abs(t.diff))}</div></div>`;

      const p = s.pace;
      if (p && t.planned > 0) {
        const verdict = p.diff >= 0
          ? `<b class="good">${money(p.diff)} under pace</b>`
          : `<b class="bad">${money(-p.diff)} over pace</b>`;
        el.spPace.innerHTML = `Day ${p.day} of ${p.daysInMonth}. A steady pace would be about <b>${money(p.expected)}</b> by today; you've spent <b>${money(p.actual)}</b>, ${verdict}.`;
        el.spPace.hidden = false;
      } else {
        el.spPace.hidden = true;
      }

      const pace = isCurrent ? p : null;
      const rows = [];
      for (const g of s.groups) {
        const color = g.category.color || "var(--muted)";
        rows.push(`<tr class="sp-cat">
          <td><span class="sp-catname"><span class="dot" style="background:${esc(color)}"></span>${esc(g.category.name)}</span></td>
          <td class="num hide-sm">${money(g.planned)}</td>
          <td class="num">${money(g.actual)}</td>
          <td class="num">${leftHTML(g.diff, g.planned, g.actual)}</td></tr>`);
        for (const r of g.rows) {
          const pct = r.planned > 0 ? `${Math.round(r.ratio * 100)}% used` : r.actual > 0 ? "not planned" : "";
          rows.push(`<tr class="sp-row${r.over ? " over" : ""}">
            <td><div class="sp-name">
              <button type="button" class="sp-link" data-sp="filter" data-item="${esc(r.item.id)}" title="Show ${esc(r.item.name)} transactions">${esc(r.item.name)}</button>
              <span class="tag"><span class="sp-sm">of ${money(r.planned)}${pct ? " · " : ""}</span>${pct}</span>
              ${barHTML(r.actual, r.planned, pace)}
            </div></td>
            <td class="num hide-sm">${money(r.planned)}</td>
            <td class="num">${money(r.actual)}</td>
            <td class="num">${leftHTML(r.diff, r.planned, r.actual)}</td></tr>`);
        }
      }
      if (s.unassigned.count) {
        rows.push(`<tr class="sp-row sp-unassigned">
          <td><div class="sp-name">
            <button type="button" class="sp-link" data-sp="filter" data-item="${NONE}">Unassigned</button>
            <span class="tag">${plural(s.unassigned.count, "transaction")} · pick an item to count them</span>
          </div></td>
          <td class="num hide-sm"><span class="muted">—</span></td>
          <td class="num">${money(s.unassigned.actual)}</td>
          <td class="num"><span class="muted">—</span></td></tr>`);
      }
      el.spPlan.tBodies[0].innerHTML = rows.join("");
      /** @type {HTMLTableSectionElement} the markup has a tfoot */ (el.spPlan.tFoot).innerHTML =`<tr><td>Total</td><td class="num hide-sm">${money(t.planned)}</td><td class="num">${money(t.actual)}</td><td class="num">${leftHTML(t.diff, t.planned, t.actual)}</td></tr>`;
      el.spNoItems.hidden = list.length > 0;
    }

    /** @param {SpendingState} sp @param {BudgetItem[]} list */
    function renderList(sp, list) {
      const map = new Map(list.map((i) => [i.id, i]));
      /** @param {Transaction} t */
      const unknown = (t) => !t.itemId || !map.has(t.itemId);
      const inMonth = sp.transactions.filter((t) => t.date.slice(0, 7) === viewMonth);

      if (filter && filter !== NONE && !map.has(filter)) filter = "";
      const unassignedN = inMonth.filter(unknown).length;
      const filterHTML = `<option value="">All items</option><option value="${NONE}">Unassigned (${unassignedN})</option>` +
        itemOptions(list).replace(/^<option value="">[^<]*<\/option>/, "");
      setSelect(el.spFilter, filterHTML, filter);

      let shown = inMonth;
      if (filter === NONE) shown = shown.filter(unknown);
      else if (filter) shown = shown.filter((t) => t.itemId === filter);
      const q = search.trim().toLowerCase();
      if (q) shown = shown.filter((t) => t.description.toLowerCase().includes(q) || money(t.amount).includes(q) || String(t.amount).includes(q));
      shown = shown.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

      const total = round2(shown.reduce((s, t) => s + t.amount, 0));
      el.spCount.textContent = shown.length ? `${plural(shown.length, "transaction")} · ${money(total)}` : "";
      const visible = showAll ? shown : shown.slice(0, LIST_LIMIT);

      const prompt = ask;
      el.spList.innerHTML = visible.map((t) => {
        const refund = t.amount < 0;
        const askHere = prompt && prompt.txId === t.id && map.get(prompt.itemId);
        return `<li class="sp-tx" data-id="${esc(t.id)}">
          <div class="sp-txmain">
            <span class="sp-txdesc" title="${esc(t.description)}">${esc(t.description || "(no description)")}</span>
            <span class="tag">${fmtDate(t.date)}${refund ? " · refund" : ""}</span>
          </div>
          <select class="sp-txitem" data-sp="assign" aria-label="Budget item for ${esc(short(t.description || "transaction"))}">${optsHTML}</select>
          <span class="sp-txamt${refund ? " good" : ""}">${money(t.amount)}</span>
          <button type="button" class="icon-btn danger" data-sp="delete" title="Delete" aria-label="Delete ${esc(short(t.description || "transaction"))}">${U.ICONS.del}</button>
          ${askHere ? `<div class="sp-ask">
            <span>Always assign “${esc(prompt.key)}” to <b>${esc(askHere.name)}</b>?${prompt.others ? ` This also assigns ${plural(prompt.others, "other unassigned transaction")}.` : ""}</span>
            <span class="sp-askbtns">
              <button type="button" class="btn primary sp-small" data-sp="rule-yes">Always</button>
              <button type="button" class="btn ghost sp-small" data-sp="rule-no">Just this one</button>
            </span></div>` : ""}
        </li>`;
      }).join("");
      /** @type {Map<string | undefined, Transaction>} */
      const byId = new Map(visible.map((t) => [t.id, t]));
      for (const sel of /** @type {NodeListOf<HTMLSelectElement>} */ (el.spList.querySelectorAll("select[data-sp=assign]"))) {
        const t = byId.get(/** @type {HTMLLIElement} each select sits in its row */ (sel.closest("li")).dataset.id);
        sel.value = t && t.itemId && map.has(t.itemId) ? t.itemId : "";
      }

      el.spListEmpty.hidden = shown.length > 0;
      el.spListEmpty.textContent = inMonth.length ? "No transactions match." : `No transactions in ${monthLabel(viewMonth)}.`;
      el.spMore.hidden = visible.length >= shown.length;
      /** @type {Element} the show-all button */ (el.spMore.firstElementChild).textContent = `Show all ${shown.length}`;
    }

    /** @param {SpendingState} sp @param {BudgetItem[]} list */
    function renderRules(sp, list) {
      el.spRules.hidden = !sp.rules.length || !sp.transactions.length;
      if (el.spRules.hidden) return;
      const map = new Map(list.map((i) => [i.id, i]));
      el.spRulesSummary.textContent = `Auto-assign rules (${sp.rules.length})`;
      el.spRuleList.innerHTML = sp.rules.slice().reverse().map((r) => {
        const it = map.get(r.itemId);
        return `<li><span class="sp-rule">“${esc(r.match)}” <span class="muted">→</span> ${it ? esc(it.name) : '<span class="muted">deleted item</span>'}</span>
          <button type="button" class="icon-btn danger" data-sp="rule-del" data-match="${esc(r.match)}" title="Remove rule" aria-label="Remove rule for ${esc(r.match)}">${U.ICONS.del}</button></li>`;
      }).join("");
    }

    // ---------- Import preview ----------

    /**
     * Import preview for a file's text against the current items, rules and transactions.
     * @param {string} text
     * @param {ColumnMapping | null} mapping
     * @param {SignMode | null} signMode
     */
    function previewImport(text, mapping, signMode) {
      const sp = data();
      return prepareImport(text, {
        items: items(), rules: sp.rules, existing: sp.transactions,
        mapping, signMode, uid: U.uid,
      });
    }

    function computeDraft() {
      if (!draft) return;
      draft.result = previewImport(draft.text, draft.mapping, draft.signMode);
    }

    /** @param {File} file */
    async function readFile(file) {
      if (file.size > 10 * 1024 * 1024) { App.showToast("That file is too large to import (10 MB max)."); return; }
      /** @type {string} */
      let text;
      try { text = await file.text(); } catch (_) { App.showToast("That file couldn't be read."); return; }
      draft = { fileName: file.name || "file", text, mapping: null, signMode: null, result: previewImport(text, null, null), rendered: null };
      if (!draft.result.columns.length || draft.result.columns.length < 2) {
        draft = null;
        App.showToast("That file doesn't look like a CSV of transactions.");
        return;
      }
      renderSelf();
      el.spImport.scrollIntoView({ behavior: "smooth", block: "start" });
      const title = document.getElementById("spImportTitle");
      if (title) title.focus({ preventScroll: true });
    }

    /** @param {ColumnRole} role @param {string} label @param {ImportResult} r */
    function mapSelect(role, label, r) {
      /** @type {[number, string][]} */
      const opts = [[-1, "—"], ...r.columns.map(/** @returns {[number, string]} */ (c) => [c.index, r.hasHeader ? c.name : `${c.name}${c.sample ? `: ${short(c.sample, 18)}` : ""}`])];
      return `<div class="field"><label for="spMap-${role}">${label}</label><select id="spMap-${role}" data-map="${role}">${U.options(opts, r.mapping[role])}</select></div>`;
    }

    function renderImport() {
      el.spImport.hidden = !draft;
      if (!draft) { el.spImport.innerHTML = ""; return; }
      const r = draft.result;
      if (draft.rendered === r) return; // keep focus on the selects between unrelated renders
      draft.rendered = r;
      const map = itemMap();
      const c = r.counts;

      /** @type {Record<string, string>} labels for the single-amount-column modes */
      const signLabels = {
        negative: "Negative amounts are spending",
        positive: "Positive amounts are spending",
        type: "Use the type column (debit/credit)",
      };
      const signField = r.signMode === "debitcredit" || !r.ok
        ? ""
        : `<div class="field sp-signfield"><label for="spMap-sign">Spending shows as</label><select id="spMap-sign" data-map="sign">${U.options(r.signModes.map((m) => /** @type {[string, string]} */ ([m, signLabels[m]])), r.signMode)}</select></div>`;

      /** @param {ImportRow} p */
      const statusCell = (p) => {
        if (p.status === "new") {
          const it = p.itemId && map.get(p.itemId);
          let s = it ? `${esc(it.name)} <span class="sp-pill">${p.source === "rule" ? "rule" : "name match"}</span>` : '<span class="muted">Unassigned</span>';
          if (p.refund) s += ' <span class="sp-pill refund">refund</span>';
          return s;
        }
        if (p.status === "duplicate") return '<span class="sp-pill">Already added</span>';
        if (p.status === "income") return '<span class="sp-pill">Skipped: deposit or transfer</span>';
        return '<span class="sp-pill warn">Couldn’t read</span>';
      };
      const preview = r.rows.slice(0, PREVIEW_ROWS).map((p) => `<tr class="${p.status === "new" ? "" : "sp-muted"}">
          <td><span class="sp-txdesc" title="${esc(p.description)}">${esc(p.description || "(no description)")}</span>
            <span class="tag">${p.date ? fmtDate(p.date, true) : esc(p.rawDate || "no date")}</span>
            <div class="sp-smblock">${statusCell(p)}</div></td>
          <td class="num">${Number.isFinite(p.amount) ? money(p.amount) : esc(p.rawAmount || "—")}</td>
          <td class="hide-sm">${statusCell(p)}</td></tr>`).join("");
      const skipped = r.rows.filter(/** @returns {p is ParsedImportRow} */ (p) => p.status === "income");

      el.spImport.innerHTML = `
        <div class="sp-head">
          <div class="sp-importhead">
            <h2 class="card-title" id="spImportTitle" tabindex="-1">Import ${esc(short(draft.fileName, 48))}</h2>
            <p class="sp-sub">${r.ok ? `${plural(c.rows, "row")} · ${fmtRange(r.dateRange)}${r.hasHeader ? "" : " · no header row, columns guessed"}` : "Check the columns below."}</p>
          </div>
          <button type="button" class="icon-btn" data-sp="import-cancel" aria-label="Cancel import" title="Cancel import">${U.ICONS.x}</button>
        </div>
        ${r.error ? `<p class="sp-error" role="alert">${esc(r.error)}</p>` : ""}
        <div class="sp-mapgrid">
          ${mapSelect("date", "Date", r)}
          ${mapSelect("description", "Description", r)}
          ${mapSelect("amount", "Amount", r)}
          ${mapSelect("debit", "Money out (debit)", r)}
          ${mapSelect("credit", "Money in (credit)", r)}
          ${mapSelect("type", "Type (optional)", r)}
          ${signField}
        </div>
        ${r.ok ? `
        <div class="stats sp-importstats">
          <div class="stat"><div class="k">To import</div><div class="v">${c.new}</div></div>
          <div class="stat"><div class="k">Duplicates</div><div class="v">${c.duplicate}</div></div>
          <div class="stat"><div class="k">Deposits &amp; transfers</div><div class="v">${c.income}</div></div>
          <div class="stat"><div class="k">Unreadable</div><div class="v">${c.invalid}</div></div>
        </div>
        ${c.refunds ? `<p class="hint sp-importnote">${plural(c.refunds, "refund")} will be subtracted from spending.</p>` : ""}
        <div class="table-wrap">
          <table class="items sp-preview">
            <thead><tr><th scope="col">Description</th><th scope="col" class="num">Amount</th><th scope="col" class="hide-sm">Budget item</th></tr></thead>
            <tbody>${preview}</tbody>
          </table>
        </div>
        ${r.rows.length > PREVIEW_ROWS ? `<p class="hint sp-importnote">Showing the first ${PREVIEW_ROWS} of ${r.rows.length} rows.</p>` : ""}
        ${skipped.length ? `<details class="more sp-skipped"><summary>Skipped deposits and transfers (${skipped.length})</summary>
          <ul class="sp-skiplist">${skipped.slice(0, 100).map((p) => `<li><span class="sp-txdesc">${esc(p.description)}</span><span class="muted">${fmtDate(p.date, true)}</span><span class="sp-txamt">${money(-p.amount)}</span></li>`).join("")}</ul>
          <p class="hint">Money coming in, like paychecks, transfers and card payments, isn't spending. Refunds from stores you've bought from are kept.</p></details>` : ""}` : ""}
        <div class="sp-actions sp-importactions">
          <button type="button" class="btn primary" data-sp="import-confirm"${r.ok && c.new ? "" : " disabled"}>${r.ok && c.new ? `Import ${plural(c.new, "transaction")}` : "Nothing new to import"}</button>
          <button type="button" class="btn ghost" data-sp="import-cancel">Cancel</button>
        </div>`;
    }

    function confirmImport() {
      if (!draft) return;
      computeDraft(); // refresh against the latest items, rules and transactions
      const r = draft.result;
      if (!r.ok || !r.transactions.length) { draft.rendered = null; renderSelf(); return; }
      const sp = data();
      const added = r.transactions;
      sp.transactions.push(...added);
      const capped = capTransactions(sp.transactions);
      sp.transactions = capped.kept;
      const latest = added.reduce((m, t) => (t.date > m ? t.date : m), added[0].date);
      viewMonth = monthOf(latest);
      filter = "";
      search = "";
      el.spSearch.value = "";
      showAll = false;
      ask = null;
      draft = null;
      App.commit();
      const c = r.counts;
      const extra = [
        c.duplicate && `skipped ${plural(c.duplicate, "duplicate")}`,
        c.income && `${plural(c.income, "deposit or transfer", "deposits or transfers")} left out`,
        capped.removed.length && `${plural(capped.removed.length, "old transaction")} dropped to stay under ${MAX_TRANSACTIONS.toLocaleString()}`,
      ].filter(Boolean);
      const ids = new Set(added.map((t) => t.id));
      App.showToast(`Imported ${plural(added.length, "transaction")}${extra.length ? ` (${extra.join(", ")})` : ""}.`, () => {
        const s = data();
        s.transactions = s.transactions.filter((t) => !ids.has(t.id)).concat(capped.removed);
        App.commit();
      });
    }

    // ---------- Actions ----------

    /** @param {string} ym */
    function setMonth(ym) {
      viewMonth = ym;
      ask = null;
      showAll = false;
      renderSelf();
    }

    function suggestItem() {
      if (el.spItem.dataset.touched === "1") return;
      const desc = el.spDesc.value.trim();
      const { itemId } = desc ? autoAssign(desc, items(), data().rules) : { itemId: null };
      el.spItem.value = itemId || "";
    }

    /** @param {Event} e */
    function onAdd(e) {
      e.preventDefault();
      const date = el.spDate.value;
      const description = cleanDesc(el.spDesc.value);
      const amount = parseAmount(el.spAmount.value);
      const badDate = !isISODate(date);
      const badAmt = !Number.isFinite(amount) || amount === 0 || Math.abs(amount) > MAX_AMOUNT;
      el.spDate.classList.toggle("invalid", badDate);
      el.spDesc.classList.toggle("invalid", !description);
      el.spAmount.classList.toggle("invalid", badAmt);
      if (badDate || !description || badAmt) {
        (!description ? el.spDesc : badAmt ? el.spAmount : el.spDate).focus();
        return;
      }
      const item = itemMap().get(el.spItem.value) || null;
      const sp = data();
      sp.transactions.push({
        id: U.uid(), date, amount: round2(amount), description,
        itemId: item ? item.id : null, category: item ? item.category : null,
      });
      const capped = capTransactions(sp.transactions);
      sp.transactions = capped.kept;
      viewMonth = monthOf(date);
      el.spDesc.value = "";
      el.spAmount.value = "";
      el.spItem.value = "";
      delete el.spItem.dataset.touched;
      App.commit();
      el.spDesc.focus();
    }

    /** @param {string} txId @param {string} itemId "" for unassigned */
    function reassign(txId, itemId) {
      const sp = data();
      const t = sp.transactions.find((x) => x.id === txId);
      if (!t) return;
      const map = itemMap();
      const item = map.get(itemId) || null;
      t.itemId = item ? item.id : null;
      t.category = item ? item.category : null;
      ask = null;
      if (item) {
        const key = merchantKey(t.description);
        const ids = new Set(map.keys());
        const existing = findRule(sp.rules, t.description, ids);
        if (!isGenericKey(key) && !(existing && existing.itemId === item.id)) {
          const others = sp.transactions.filter((x) => x.id !== t.id && (!x.itemId || !ids.has(x.itemId)) && ruleMatches(key, x.description)).length;
          ask = { txId, key, itemId: item.id, others };
        }
      }
      App.commit();
      const sel = /** @type {HTMLSelectElement | null} */ (el.spList.querySelector(`li[data-id="${CSS.escape(txId)}"] select`));
      if (sel) sel.focus();
    }

    function saveRule() {
      if (!ask) return;
      const { key, itemId } = ask;
      const map = itemMap();
      const item = map.get(itemId);
      ask = null;
      if (!item) { renderSelf(); return; }
      const sp = data();
      const prevRules = sp.rules.slice();
      sp.rules = sp.rules.filter((r) => r.match !== key).concat({ match: key, itemId });
      if (sp.rules.length > MAX_RULES) sp.rules = sp.rules.slice(-MAX_RULES);
      /** @type {[Transaction, string | null, CategoryId | null][]} transaction, previous itemId, previous category */
      const changed = [];
      for (const t of sp.transactions) {
        if ((!t.itemId || !map.has(t.itemId)) && ruleMatches(key, t.description)) {
          changed.push([t, t.itemId, t.category]);
          t.itemId = itemId;
          t.category = item.category;
        }
      }
      App.commit();
      App.showToast(
        changed.length ? `Saved. ${plural(changed.length, "more transaction")} assigned to ${item.name}.` : `Saved. “${key}” will go to ${item.name}.`,
        () => {
          data().rules = prevRules;
          for (const [t, id, cat] of changed) { t.itemId = id; t.category = cat; }
          App.commit();
        }
      );
    }

    /** @param {string} id */
    function removeTx(id) {
      const sp = data();
      const idx = sp.transactions.findIndex((t) => t.id === id);
      if (idx < 0) return;
      const [t] = sp.transactions.splice(idx, 1);
      if (ask && ask.txId === id) ask = null;
      App.commit();
      App.showToast(`Deleted “${short(t.description || "transaction", 32)}”`, () => {
        const s = data();
        s.transactions.splice(Math.min(idx, s.transactions.length), 0, t);
        App.commit();
      });
    }

    /** @param {string} match */
    function removeRule(match) {
      const sp = data();
      const idx = sp.rules.findIndex((r) => r.match === match);
      if (idx < 0) return;
      const [rule] = sp.rules.splice(idx, 1);
      App.commit();
      App.showToast(`Removed the rule for “${short(match, 28)}”`, () => {
        const s = data();
        s.rules.splice(Math.min(idx, s.rules.length), 0, rule);
        App.commit();
      });
    }

    /** @param {MouseEvent} e */
    function onClick(e) {
      if (!(e.target instanceof Element)) return;
      const btn = /** @type {HTMLElement | null} */ (e.target.closest("[data-sp]"));
      if (!btn || !rootEl || !rootEl.contains(btn) || btn.tagName === "SELECT") return;
      const act = btn.dataset.sp;
      const li = /** @type {HTMLLIElement | null} */ (btn.closest("li[data-id]"));
      switch (act) {
        case "prev": setMonth(shiftMonth(viewMonth, -1)); break;
        case "next": setMonth(shiftMonth(viewMonth, 1)); break;
        case "this-month": setMonth(monthOf(todayISO())); break;
        case "import": el.spFile.click(); break;
        case "focus-add": el.spDesc.focus(); el.spAddForm.scrollIntoView({ behavior: "smooth", block: "center" }); break;
        case "filter":
          filter = btn.dataset.item || "";
          search = "";
          el.spSearch.value = "";
          showAll = false;
          renderSelf();
          el.spListWrap.scrollIntoView({ behavior: "smooth", block: "start" });
          break;
        case "show-all": showAll = true; renderSelf(); break;
        case "delete": if (li) removeTx(/** @type {string} */ (li.dataset.id)); break;
        case "rule-yes": saveRule(); break;
        case "rule-no": {
          const id = ask && ask.txId;
          ask = null;
          renderSelf();
          const sel = id && /** @type {HTMLSelectElement | null} */ (el.spList.querySelector(`li[data-id="${CSS.escape(id)}"] select`));
          if (sel) sel.focus();
          break;
        }
        case "rule-del": removeRule(/** @type {string} */ (btn.dataset.match)); break;
        case "import-confirm": confirmImport(); break;
        case "import-cancel": draft = null; renderSelf(); break;
        default: break;
      }
    }

    /** @param {Event} e */
    function onChange(e) {
      const t = e.target;
      if (!(t instanceof HTMLSelectElement)) return; // every branch below is for a <select>
      if (t.matches("select[data-sp=assign]")) {
        const li = /** @type {HTMLLIElement | null} */ (t.closest("li[data-id]"));
        if (li) reassign(/** @type {string} */ (li.dataset.id), t.value);
      } else if (t === el.spFilter) {
        filter = t.value;
        showAll = false;
        renderSelf();
      } else if (t.matches("select[data-map]") && draft) {
        const role = /** @type {ColumnRole | "sign"} */ (t.dataset.map);
        if (role === "sign") {
          draft.signMode = /** @type {SignMode} options come from result.signModes */ (t.value);
        } else {
          const v = Number(t.value);
          const m = { ...draft.result.mapping, [role]: v };
          if (role === "amount" && v >= 0) { m.debit = -1; m.credit = -1; }
          if ((role === "debit" || role === "credit") && v >= 0) m.amount = -1;
          draft.mapping = m;
        }
        computeDraft();
        renderSelf();
        const again = document.getElementById(`spMap-${role}`);
        if (again) again.focus();
      }
    }

    App.register(/** @satisfies {SpendingModule} */ ({
      id: "spending",
      stateKey: "spending",
      defaults: () => defaults(),
      sanitize: (raw) => sanitize(raw, { categoryIds: categoryIds() }),
      init,
      render,
    }));
  }
})(typeof window !== "undefined" ? window : globalThis);
