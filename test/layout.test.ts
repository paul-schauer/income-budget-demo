import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");

// Pinned (sticky) cards slide over the sections below them as you scroll.
// Keep every section in normal flow; the phone tab bar is fixed but the page reserves room for it.
// Scans the stylesheets and the TypeScript sources (pwa.ts injects CSS).
test("no stylesheet pins a section with position: sticky", () => {
  const list = (dir: string, ext: RegExp) => fs.readdirSync(path.join(root, dir), { recursive: true, encoding: "utf8" })
    .filter((f) => ext.test(f)).map((f) => `${dir}/${f}`);
  const files = ["public/styles.css", ...list("public/css", /\.css$/), ...list("src", /\.ts$/)];
  const offenders = files.filter((f) => /position\s*:\s*sticky/.test(fs.readFileSync(path.join(root, f), "utf8")));
  assert.deepEqual(offenders, []);
});

// iPhone Safari's toolbar owns the bottom edge of the screen and takes taps there,
// so the tab bar must never be pinned to the bottom (or anywhere) with position: fixed.
test("the tab bar stays in normal flow", () => {
  const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
  const tabRules = [...css.matchAll(/([^{}]*\.tabs[^{}]*)\{([^}]*)\}/g)].filter((m) => !/\.tabs\s+button/.test(m[1]));
  assert.ok(tabRules.length > 0);
  for (const [, selector, body] of tabRules) {
    assert.doesNotMatch(body, /position\s*:\s*(fixed|absolute|sticky)/, selector.trim());
  }
});
