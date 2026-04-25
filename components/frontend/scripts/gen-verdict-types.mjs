// Generates TypeScript types from Pydantic models via datamodel-code-generator.
// Requires: pip install datamodel-code-generator pydantic-to-typescript (or just one).
// Run: npm run gen-types

import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const SHARED_PKG = resolve("../shared/aimusic_shared/verdicts/models.py");
const OUT = resolve("./src/types/verdicts.ts");
const PY = process.env.PYTHON || "python";

if (!existsSync(SHARED_PKG)) {
  console.error("Cannot find Pydantic models at", SHARED_PKG);
  process.exit(1);
}

// Use pydantic-to-typescript (PYTHON wrapper that imports the pydantic models
// and emits TS interfaces). Falls back to datamodel-code-generator + JSON Schema
// if the former isn't available.
try {
  execSync(
    `${PY} -c "from pydantic2ts.cli.script import main; main()" ` +
    `--module ${SHARED_PKG} --output ${OUT}`,
    { stdio: "inherit" },
  );
} catch (e) {
  console.error("pydantic2ts failed; falling back to datamodel-code-generator");
  execSync(
    `${PY} -m datamodel_code_generator --input ${SHARED_PKG} ` +
    `--input-file-type python --output ${OUT} --output-model-type TypedDict`,
    { stdio: "inherit" },
  );
}

console.log("Wrote", OUT);
