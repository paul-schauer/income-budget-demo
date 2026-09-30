/*
 * State tax data: Northeast and Mid-Atlantic graduated-rate states.
 * Schema: see STATE_SCHEMA in js/state-tax.js. Sources for each figure are in docs/state-tax-sources.md.
 */
(function (root) {
  "use strict";

  const STATES = {};

  if (typeof module !== "undefined" && module.exports) module.exports = STATES;
  else root.StateTax.register(STATES);
})(typeof window !== "undefined" ? window : globalThis);
