/**
 * Browser globals the scripts share (each file is a classic <script>, not a module).
 * js/tax.js, js/state-tax.js and js/schedule.js also run in Node, where they use module.exports.
 */
import type { StateTable, StateTaxApi, TaxApi, ScheduleApi } from "./tax";
import type { AppApi } from "./app";

declare global {
  interface Window {
    Tax: TaxApi;
    StateTax: StateTaxApi;
    Schedule: ScheduleApi;
    App: AppApi;
  }
  var Tax: TaxApi;
  var StateTax: StateTaxApi;
  var Schedule: ScheduleApi;
  var App: AppApi;
}

export type { StateTable };
