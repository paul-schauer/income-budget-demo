const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Pinned (sticky) cards slide over the sections below them as you scroll.
// Keep every section in normal flow; the phone tab bar is fixed but the page reserves room for it.
test("no stylesheet pins a section with position: sticky", () => {
  const root = path.join(__dirname, "..");
  const files = ["styles.css", ...fs.readdirSync(path.join(root, "css")).map((f) => `css/${f}`), ...fs.readdirSync(path.join(root, "js")).map((f) => `js/${f}`)];
  const offenders = files.filter((f) => /position\s*:\s*sticky/.test(fs.readFileSync(path.join(root, f), "utf8")));
  assert.deepEqual(offenders, []);
});

// iPhone Safari's toolbar owns the bottom edge of the screen and takes taps there,
// so the tab bar must never be pinned to the bottom (or anywhere) with position: fixed.
test("the tab bar stays in normal flow", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  const tabRules = [...css.matchAll(/([^{}]*\.tabs[^{}]*)\{([^}]*)\}/g)].filter((m) => !/\.tabs\s+button/.test(m[1]));
  assert.ok(tabRules.length > 0);
  for (const [, selector, body] of tabRules) {
    assert.doesNotMatch(body, /position\s*:\s*(fixed|absolute|sticky)/, selector.trim());
  }
});
