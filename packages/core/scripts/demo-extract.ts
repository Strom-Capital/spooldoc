// M1 demo: extract the six invoices from the invoice fixture and print them as JSON.
//   pnpm --filter @spooldoc/core demo
import { readFileSync } from "node:fs";
import { extract, parseDefinition, sampleSchema } from "../src/index.js";

const base = new URL("../fixtures/invoice/", import.meta.url);
const definition = parseDefinition(readFileSync(new URL("definition.yaml", base), "utf8"));
const sample = sampleSchema.parse(JSON.parse(readFileSync(new URL("sample.json", base), "utf8")));
const { documents, warnings } = extract(definition, sample);

console.log(JSON.stringify(documents, null, 2));
console.error(`${documents.length} documents from ${sample.pages.length} pages, ${warnings.length} warnings`);
for (const w of warnings) console.error(`warning: ${w}`);
