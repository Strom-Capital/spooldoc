// Renames the data tags inside saved Word template files, as migrations 0016 and 0018 do for
// HTML templates and definitions: {d.pageGroup.x} is {d.pg.x}, d.pageGroups is d.pgs, and
// the older names go straight to the new ones: {d.doc.x} is {d.pg.x}, d.documents is d.pgs
// and d.sample.splf is d.splf. SQL cannot open a .docx, so this runs once by hand after
// `pnpm --filter @spooldoc/web db:migrate`, against the database in DATABASE_URL:
//   pnpm --filter @spooldoc/core build && node apps/web/scripts/rename-word-tags.mjs
// Files that have none of the old tags are left as they are; running it again changes nothing.
import { pathToFileURL } from "node:url";
import { rewriteDocx } from "@spooldoc/core";
import postgres from "postgres";

/** The old tags written the new way. */
export function renameTags(text) {
  return text
    .replace(/\bd\.pageGroups\b/g, "d.pgs")
    .replace(/\bd\.pageGroup\b/g, "d.pg")
    .replace(/\bd\.documents\b/g, "d.pgs")
    .replace(/\bd\.doc\b(?![\w-])/g, "d.pg")
    .replace(/\bd\.sample\.splf\b/g, "d.splf");
}

/** Renames the tags in every saved Word template file of the database in DATABASE_URL. */
async function main() {
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
}

// Run by hand; a test imports `renameTags` only.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
