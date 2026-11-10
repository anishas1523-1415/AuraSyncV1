// Needs the test tools once: npm i --no-save esbuild jsdom   (then: node scripts/library-e2e/run.mjs)
// Builds the scenarios with esbuild (the project's real useLibrary and cloud logic; only Firestore is faked)
// and runs them in a simulated browser (jsdom).
import { JSDOM } from "jsdom";
import * as esbuild from "esbuild";
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(here, "../..");

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://localhost/", pretendToBeVisual: true });
const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
define("window", dom.window);
define("document", dom.window.document);
define("localStorage", dom.window.localStorage);
define("navigator", dom.window.navigator);
define("Event", dom.window.Event);
define("HTMLElement", dom.window.HTMLElement);

const aliasPlugin = {
  name: "alias",
  setup(build) {
    build.onResolve({ filter: /^@harness\// }, (args) => ({ path: path.join(here, args.path.slice("@harness/".length)) }));
    build.onResolve({ filter: /^@project\// }, (args) => ({ path: path.join(PROJECT, "src", args.path.slice("@project/".length)) }));
    build.onResolve({ filter: /^@\/lib\/dbSync$/ }, () => ({ path: path.join(here, "fakeDb.js") }));
    build.onResolve({ filter: /^@\// }, (args) => {
      const base = path.join(PROJECT, "src", args.path.slice(2));
      for (const ext of ["", ".js", ".jsx", "/index.js"]) {
        try { if (fs.statSync(base + ext).isFile()) return { path: base + ext }; } catch (e) {}
      }
      return { path: base + ".js" };
    });
  },
};

const outfile = path.join(here, ".bundle.cjs");
await esbuild.build({
  entryPoints: [path.join(here, "scenarios.jsx")],
  bundle: true, platform: "node", format: "cjs", outfile,
  plugins: [aliasPlugin],
  nodePaths: [path.join(PROJECT, "node_modules")],
  loader: { ".js": "jsx", ".jsx": "jsx" },
  jsx: "transform",
  define: { "process.env.NODE_ENV": '"test"' },
  logLevel: "error",
});

const mod = await import(pathToFileURL(outfile).href);
await (mod.run || mod.default?.run)();
process.exit(process.exitCode || 0);
