// Builds the app with esbuild:
//   src/app/main.ts  -> public/app.js   (browser bundle, one classic script)
//   src/sw.ts        -> public/sw.js    (service worker)
//   server/index.ts  -> dist/server.js  (Node server; npm packages stay external)
//
// node scripts/build.mjs            one build
// node scripts/build.mjs --watch    rebuild on change
// node scripts/build.mjs --watch --serve   also run the server and restart it when it rebuilds
import * as esbuild from "esbuild";
import { spawn } from "node:child_process";

const watch = process.argv.includes("--watch");
const serve = process.argv.includes("--serve");

/** @type {import("esbuild").BuildOptions} */
const common = { bundle: true, logLevel: "info", legalComments: "none" };

let server = null;
const restartServer = {
  name: "restart-server",
  setup(build) {
    build.onEnd((result) => {
      if (!serve || result.errors.length) return;
      if (server) server.kill();
      server = spawn(process.execPath, ["dist/server.js"], { stdio: "inherit", env: { NODE_ENV: "development", ...process.env } });
    });
  },
};

const builds = [
  { ...common, entryPoints: ["src/app/main.ts"], outfile: "public/app.js", format: "iife", platform: "browser", target: "es2020", sourcemap: true },
  // The server stamps `const VERSION = "...";` in sw.js with a hash of the app's files, so keep it readable.
  { ...common, entryPoints: ["src/sw.ts"], outfile: "public/sw.js", format: "iife", platform: "browser", target: "es2020" },
  { ...common, entryPoints: ["server/index.ts"], outfile: "dist/server.js", format: "esm", platform: "node", target: "node20", packages: "external", sourcemap: true, plugins: [restartServer] },
];

if (watch) {
  for (const options of builds) await (await esbuild.context(options)).watch();
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
