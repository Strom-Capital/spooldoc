/**
 * An invoice designed as a Word template, as the AI assistant writes one: a letterhead
 * with a logo on the first page and a running header after it, the address, the details
 * in a borderless table, the lines with a repeating header row, totals aligned with the
 * amounts, and page numbers in the footer.
 */

const GREY = "5A5F66";
const RULE = { style: "single", size: 4, color: "C9CDD2" } as const;
const NONE = { style: "none" } as const;
const noBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };

const label = (text: string) => ({ type: "Paragraph", children: [{ type: "TextRun", text, color: GREY, size: 16 }] });
const value = (text: string, alignment = "left") => ({ type: "Paragraph", alignment, children: [{ type: "TextRun", text }] });
const cell = (children: unknown[], width: number, extra: Record<string, unknown> = {}) => ({ type: "TableCell", width: { size: width, type: "dxa" }, children, ...extra });

const COLUMNS: [string, string, number, string][] = [
  ["Item", "item", 1500, "left"],
  ["Description", "description", 3700, "left"],
  ["Qty", "quantity", 900, "right"],
  ["Unit", "unit", 700, "left"],
  ["Unit price", "unitPrice", 1300, "right"],
  ["Amount", "amount", 1538, "right"],
];
const number = (field: string) => (["quantity", "unitPrice", "amount"].includes(field) ? `:formatN(2)` : "");

export const invoiceDesign = {
  title: "Invoice",
  styles: {
    default: { document: { run: { font: "Arial", size: 19, color: "1A1A1A" }, paragraph: { spacing: { after: 0, line: 264 } } } },
    paragraphStyles: [
      { id: "DocTitle", name: "Document title", run: { size: "20pt", bold: true, color: "1F3A5F" }, paragraph: { spacing: { after: "4mm" } } },
      { id: "Small", name: "Small", run: { size: 15, color: GREY } },
    ],
  },
  sections: [
    {
      properties: { page: { margin: { top: "18mm", bottom: "18mm", left: "20mm", right: "20mm", header: "8mm", footer: "8mm" } }, titlePage: true },
      headers: {
        first: { children: [{ type: "Paragraph", alignment: "right", children: [{ type: "ImageRun", asset: "logo", width: 140 }] }] },
        default: {
          children: [
            {
              type: "Paragraph",
              border: { bottom: RULE },
              tabStops: [{ type: "right", position: "170mm" }],
              children: [
                { type: "TextRun", text: "Invoice {d.doc.invoiceNo}", bold: true, size: 16 },
                { type: "Tab" },
                { type: "TextRun", text: "{d.doc.customerName}", size: 16, color: GREY },
              ],
            },
          ],
        },
      },
      footers: {
        default: {
          children: [
            {
              type: "Paragraph",
              style: "Small",
              alignment: "right",
              children: [{ type: "TextRun", text: "Page " }, { type: "PageNumber", field: "PAGE" }, { type: "TextRun", text: " of " }, { type: "PageNumber", field: "NUMPAGES" }],
            },
          ],
        },
      },
      children: [
        { type: "Paragraph", style: "DocTitle", text: "Invoice" },
        {
          type: "Table",
          width: { size: 9638, type: "dxa" },
          columnWidths: [5200, 4438],
          layout: "fixed",
          borders: noBorders,
          rows: [
            {
              type: "TableRow",
              children: [
                cell(
                  [
                    label("Bill to"),
                    {
                      type: "Paragraph",
                      children: [
                        { type: "TextRun", text: "{d.doc.customerName}", bold: true },
                        { type: "TextRun", break: 1, text: "{d.doc.address1}{d.doc.address2:ifEM:hideBegin}" },
                        { type: "TextRun", break: 1, text: "{d.doc.address2}{d.doc.address2:hideEnd}" },
                        { type: "TextRun", break: 1, text: "{d.doc.address3}" },
                      ],
                    },
                  ],
                  5200,
                ),
                cell(
                  [
                    {
                      type: "Table",
                      width: { size: 4438, type: "dxa" },
                      columnWidths: [1800, 2638],
                      borders: noBorders,
                      rows: [
                        ["Invoice no", "{d.doc.invoiceNo}"],
                        ["Date", "{d.doc.invoiceDate:formatD('DD.MM.YYYY')}"],
                        ["Due date", "{d.doc.dueDate:formatD('DD.MM.YYYY')}"],
                        ["Terms", "{d.doc.paymentTerms}"],
                        ["Customer no", "{d.doc.customerNo}"],
                      ].map(([name, tag]) => ({ type: "TableRow", children: [cell([label(name!)], 1800), cell([value(tag!, "right")], 2638)] })),
                    },
                  ],
                  4438,
                ),
              ],
            },
          ],
        },
        { type: "Paragraph", spacing: { before: "8mm" }, text: "" },
        {
          type: "Table",
          width: { size: 9638, type: "dxa" },
          columnWidths: COLUMNS.map((c) => c[2]),
          layout: "fixed",
          borders: { ...noBorders, insideHorizontal: RULE, bottom: RULE },
          margins: { top: 60, bottom: 60, left: 80, right: 80 },
          rows: [
            {
              type: "TableRow",
              tableHeader: true,
              children: COLUMNS.map(([title, , width, alignment]) =>
                cell([{ type: "Paragraph", alignment, children: [{ type: "TextRun", text: title, bold: true, size: 16, color: "FFFFFF" }] }], width, {
                  shading: { fill: "1F3A5F" },
                }),
              ),
            },
            {
              type: "TableRow",
              cantSplit: true,
              children: COLUMNS.map(([, field, width, alignment]) => cell([value(`{d.doc.lines[i].${field}${number(field)}}`, alignment)], width)),
            },
            {
              type: "TableRow",
              children: COLUMNS.map(([, , width], n) => cell(n === 0 ? [value("{d.doc.lines[i+1]}")] : [], width)),
            },
          ],
        },
        {
          type: "Table",
          width: { size: 9638, type: "dxa" },
          columnWidths: [6800, 1300, 1538],
          layout: "fixed",
          borders: noBorders,
          margins: { top: 40, bottom: 40, left: 80, right: 80 },
          rows: [
            ["Net amount", "{d.doc.netAmount:formatN(2)}", false],
            ["VAT {d.doc.vatRate:formatN(2)} %", "{d.doc.vatAmount:formatN(2)}", false],
            ["Total {d.doc.currency}", "{d.doc.totalAmount:formatN(2)}", true],
          ].map(([name, tag, total]) => ({
            type: "TableRow",
            children: [
              cell([], 6800),
              cell([{ type: "Paragraph", children: [{ type: "TextRun", text: name, bold: total, color: total ? "1A1A1A" : GREY }] }], 1300, total ? { borders: { top: { style: "single", size: 8, color: "1A1A1A" } } } : {}),
              cell([{ type: "Paragraph", alignment: "right", children: [{ type: "TextRun", text: tag, bold: total }] }], 1538, total ? { borders: { top: { style: "single", size: 8, color: "1A1A1A" } } } : {}),
            ],
          })),
        },
        { type: "Paragraph", spacing: { before: "10mm" }, style: "Small", text: "Please quote the invoice number with your payment." },
        { type: "Paragraph", bullet: { level: 0 }, children: [{ type: "TextRun", text: "Our reference: {d.doc.orderNo}", size: 15, color: GREY }] },
      ],
    },
  ],
};
