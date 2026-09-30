// Browser entry point: bundled by scripts/build.mjs into public/app.js.
// Registers every feature module in order, sets up the installable-app support,
// then starts the app once the page is ready.
import { App, start } from "./core";
import { bonusModule } from "./bonus";
import { calendarModule } from "./calendar";
import { goalsModule } from "./goals";
import { spendingModule } from "./spending";
import { syncModule } from "./sync";
import { setupPwa } from "./pwa";

App.register(bonusModule);
App.register(calendarModule);
App.register(goalsModule);
App.register(spendingModule);
App.register(syncModule);
setupPwa();
start();
