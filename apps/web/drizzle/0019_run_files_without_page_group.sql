-- A file of a whole spooled file, from an Excel template, has no page group.
ALTER TABLE "run_files" ALTER COLUMN "page_group_index" DROP NOT NULL;
