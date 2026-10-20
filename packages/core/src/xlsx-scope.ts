/**
 * What one file of an Excel template holds: the whole spooled file (`splf`, the default),
 * with `d` = `{ pgs, splf }`, or one page group (`pageGroup`), with `d` = `{ pg, pgs?, splf }`
 * as for HTML and Word templates. Its own module with no imports, so the browser can
 * import it as `@spooldoc/core/xlsx-scope`.
 */
export const XLSX_SCOPES = ["splf", "pageGroup"] as const;
export type XlsxScope = (typeof XLSX_SCOPES)[number];
