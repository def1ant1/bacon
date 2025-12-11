const fs = require("node:fs")
const path = require("node:path")

// Lightweight performance budget that alerts when bundles bloat beyond the
// guardrails we publish to consumers. This runs after `npm run build` in CI so
// we catch regressions before they reach pre-prod mirrors.
const budgets = [
  { file: "dist/index.mjs", maxKb: 180 },
  { file: "dist/index.css", maxKb: 48 },
]

let failures = 0

for (const { file, maxKb } of budgets) {
  const absolute = path.resolve(process.cwd(), file)
  const stat = fs.statSync(absolute)
  const sizeKb = stat.size / 1024

  if (sizeKb > maxKb) {
    console.error(`${file} is ${sizeKb.toFixed(2)}kb; budget is ${maxKb}kb`)
    failures++
  } else {
    console.log(`${file} OK at ${sizeKb.toFixed(2)}kb (budget ${maxKb}kb)`) // eslint-disable-line no-console
  }
}

if (failures > 0) {
  console.error(`Performance budget failed for ${failures} asset(s).`) // eslint-disable-line no-console
  process.exit(1)
}
