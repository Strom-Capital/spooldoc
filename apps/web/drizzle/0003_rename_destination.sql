-- The built-in destination keeps PDF and HTML files now, not only PDFs.
UPDATE destinations SET name = 'Spooldoc download' WHERE builtin = true AND name = 'Spooldoc PDF download';
