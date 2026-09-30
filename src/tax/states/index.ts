/*
 * Registers every state's data with the state engine. src/tax/tax.ts imports this for its side
 * effect, so anything that uses the household engine has all the states loaded.
 */
import { register } from "../state-tax";
import { STATES as NO_TAX_FLAT } from "./no-tax-flat";
import { STATES as WEST_PLAINS } from "./west-plains";
import { STATES as NORTHEAST } from "./northeast";
import { STATES as SOUTH_CENTRAL } from "./south-central";

for (const states of [NO_TAX_FLAT, WEST_PLAINS, NORTHEAST, SOUTH_CENTRAL]) register(states);
