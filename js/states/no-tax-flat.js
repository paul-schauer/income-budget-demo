/*
 * State tax data: states with no wage income tax, and flat-rate states.
 * Schema: see STATE_SCHEMA in js/state-tax.js. Sources for each figure are in docs/state-tax-sources.md.
 */
(function (root) {
  "use strict";

  const STATES = {
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
  };

  if (typeof module !== "undefined" && module.exports) module.exports = STATES;
  else root.StateTax.register(STATES);
})(typeof window !== "undefined" ? window : globalThis);
