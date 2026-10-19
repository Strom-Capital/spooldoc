// Renames the data tags inside saved Word template files, as migration 0016 does for HTML
// templates and definitions: {d.doc.x} is {d.pageGroup.x}, d.documents is d.pageGroups and
// d.sample.splf is d.splf. SQL cannot open a .docx, so this runs once by hand after
// `pnpm --filter @spooldoc/web db:migrate`, against the database in DATABASE_URL:
//   pnpm --filter @spooldoc/core build && node apps/web/scripts/rename-word-tags.mjs
// Files that have none of the old tags are left as they are; running it again changes nothing.
import { rewriteDocx } from "@spooldoc/core";
import postgres from "postgres";

/** The old tags written the new way. */
export function renameTags(text) {
  return text
    .replace(/\bd\.doc\b(?![\w-])/g, "d.pageGroup")
    .replace(/\bd\.documents\b/g, "d.pageGroups")
    .replace(/\bd\.sample\.splf\b/g, "d.splf");
}

try {
  process.loadEnvFile(new URL("../.env.local", import.meta.url));
} catch {
  // No .env.local: DATABASE_URL comes from the environment.
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL, or write it in apps/web/.env.local.");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });
let changed = 0;
try {
  await sql.begin(async (tx) => {
    // Template files never change, except for this one rewrite of their tags.
    await tx`alter table template_files disable trigger template_files_immutable`;
    for (const row of await tx`select id, name, content from template_files`) {
      const before = new Uint8Array(row.content);
      let after;
      try {
        after = rewriteDocx(before, renameTags);
      } catch (error) {
        console.error(`${row.name} (${row.id}): left as it is, ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (Buffer.compare(Buffer.from(after), Buffer.from(before)) === 0) continue;
      await tx`update template_files set content = ${Buffer.from(after)}, size = ${after.length} where id = ${row.id}`;
      changed++;
      console.log(`${row.name} (${row.id}): tags renamed`);
    }
    await tx`alter table template_files enable trigger template_files_immutable`;
  });
} finally {
  await sql.end();
}
console.log(`${changed} ${changed === 1 ? "file" : "files"} changed.`);
