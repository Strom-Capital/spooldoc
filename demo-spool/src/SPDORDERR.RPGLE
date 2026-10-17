**FREE
// SPDORDERR: demo operational report "Open order lines by customer".
// 198 columns, 15 cpi, 51 lines per page. Page 1 lists the selection
// criteria. From page 2 each order line takes three printed lines under a
// repeated page header. All data is invented and generated here, so every
// run prints the same lines; only the run date and time change.
// Prints to QSYSPRT. SPDPRINTC overrides it (OUTQ, HOLD, PAGESIZE, CPI).

ctl-opt dftactgrp(*no) actgrp(*caller) option(*srcstmt) decedit('0.');

dcl-f QSYSPRT printer(198) prtctl(prtCtl);

// Printer control: space before, space after, skip before, skip after,
// current line number (filled in by RPG after each write).
dcl-ds prtCtl len(15) inz;
  spaceBefore char(3);
  spaceAfter char(3);
  skipBefore char(3);
  skipAfter char(3);
  curLine zoned(3:0);
end-ds;

dcl-ds outRec;
  outText char(198);
end-ds;

dcl-c PAGE_LEN 51;
dcl-c REC_COUNT 40;
dcl-c PGM_NAME 'SPDORDERR';
dcl-c TITLE 'OPEN ORDER LINES BY CUSTOMER';

// Page state
dcl-s work char(300);
dcl-s lineNo int(10) inz(0);
dcl-s pageNo int(10) inz(0);
dcl-s started ind inz(*off);
dcl-s newPageDue ind inz(*off);
dcl-s skipTarget int(10) inz(0);
dcl-s skipZ zoned(3:0);
dcl-s dashes char(300) inz(*all'-');

// Run stamp for the page header
dcl-s runStamp char(19);

// Invented master data
dcl-ds cust qualified dim(8);
  no char(5);
  name char(30);
end-ds;

dcl-ds item qualified dim(10);
  no char(10);
  desc char(30);
  unit char(4);
  price packed(9:2);
end-ds;

dcl-s typeCode char(2) dim(4);
dcl-s typeText char(30) dim(4);
dcl-s msgText char(60) dim(6);

dcl-s baseDate date(*iso) inz(d'2026-10-20');
dcl-s i int(10);

// ---------------------------------------------------------------- main
runStamp = %char(%date(): *iso) + ' ' + %char(%time(): *hms);
loadData();
printParameterPage();

for i = 1 to REC_COUNT;
  // A record is three lines; start a new page when they do not fit.
  if pageNo < 2 or lineNo + 3 > PAGE_LEN - 2;
    newPageDue = *on;
    printPageHeader();
    printColumnHeader();
  endif;
  printRecord(i);
endfor;

printText(' ');
at(90: '*** End ***');
printWork();

*inlr = *on;
return;

// ---------------------------------------------------------------- data
dcl-proc loadData;
  cust(1).no = '10001';
  cust(1).name = 'NORTHERN SUPPLY CO';
  cust(2).no = '10002';
  cust(2).name = 'BAKER & SONS LTD';
  cust(3).no = '10003';
  cust(3).name = 'MÄKELÄ RAKENNUS OY';
  cust(4).no = '10004';
  cust(4).name = 'SÖDERBERG MASKIN AB';
  cust(5).no = '10005';
  cust(5).name = 'EASTERN TOOLS OY';
  cust(6).no = '10006';
  cust(6).name = 'COASTAL MARINE LTD';
  cust(7).no = '10007';
  cust(7).name = 'HIGHLAND FARMS CO';
  cust(8).no = '10008';
  cust(8).name = 'METRO BUILDERS INC';

  item(1).no = 'A-1001';
  item(1).desc = 'BRACKET 40MM';
  item(1).unit = 'PCS';
  item(1).price = 4.20;
  item(2).no = 'A-1002';
  item(2).desc = 'BRACKET 60MM';
  item(2).unit = 'PCS';
  item(2).price = 5.10;
  item(3).no = 'B-2001';
  item(3).desc = 'HEX BOLT M8X40';
  item(3).unit = 'PCS';
  item(3).price = 0.35;
  item(4).no = 'B-2002';
  item(4).desc = 'HEX NUT M8';
  item(4).unit = 'PCS';
  item(4).price = 0.08;
  item(5).no = 'C-3001';
  item(5).desc = 'STEEL PLATE 2MM 1X2M';
  item(5).unit = 'PCS';
  item(5).price = 86.00;
  item(6).no = 'C-3002';
  item(6).desc = 'ANGLE BAR 40X40X4';
  item(6).unit = 'M';
  item(6).price = 7.90;
  item(7).no = 'D-4001';
  item(7).desc = 'HYDRAULIC HOSE DN12';
  item(7).unit = 'M';
  item(7).price = 12.40;
  item(8).no = 'E-5001';
  item(8).desc = 'SAFETY GLOVES SIZE 10';
  item(8).unit = 'PR';
  item(8).price = 3.60;
  item(9).no = 'F-6001';
  item(9).desc = 'SÄÄTÖJALKA M10';
  item(9).unit = 'PCS';
  item(9).price = 2.75;
  item(10).no = 'G-7001';
  item(10).desc = 'KÖYSI 10 MM POLYESTER';
  item(10).unit = 'M';
  item(10).price = 1.15;

  typeCode(1) = 'SO';
  typeText(1) = 'STANDARD ORDER';
  typeCode(2) = 'BO';
  typeText(2) = 'BACKORDER';
  typeCode(3) = 'DS';
  typeText(3) = 'DIRECT SHIPMENT';
  typeCode(4) = 'RO';
  typeText(4) = 'RUSH ORDER';

  msgText(1) = 'CREDIT LIMIT CHECK PASSED';
  msgText(2) = 'AWAITING STOCK, EXPECTED IN WAREHOUSE NEXT WEEK';
  msgText(3) = 'CUSTOMER REQUESTS PARTIAL DELIVERY';
  msgText(4) = 'PRICE OVERRIDE APPROVED BY SALES DESK';
  msgText(5) = 'SHIP WITH NEXT ROUTE, NO PALLET EXCHANGE';
  msgText(6) = 'READY FOR PICKING';
end-proc;

// ---------------------------------------------------------------- pages
dcl-proc printParameterPage;
  printPageHeader();
  printText(' ');
  at(10: 'SELECTION CRITERIA');
  printWork();
  printText(' ');
  printLabel('Company': 'MYCO');
  printLabel('Warehouse': '01 MAIN WAREHOUSE');
  printLabel('Customer from': '10001');
  printLabel('Customer to': '10099');
  printLabel('Ship date from': '2026-10-20');
  printLabel('Ship date to': '2026-11-30');
  printLabel('Order type': '*ALL');
  printLabel('Include backorders': 'Y');
  printLabel('Sort sequence': 'CUSTOMER, ORDER, LINE');
  printLabel('Output queue': 'REPORTS');
end-proc;

// "Label..........: value" with the dots filled to a fixed width.
dcl-proc printLabel;
  dcl-pi *n;
    label varchar(30) const;
    value varchar(60) const;
  end-pi;
  dcl-s dots char(22) inz(*all'.');

  at(10: dots);
  at(10: label);
  at(32: ': ' + value);
  printWork();
end-proc;

dcl-proc printPageHeader;
  pageNo += 1;
  newPageDue = *on;
  at(1: 'MYCO');
  at(85: TITLE);
  at(160: runStamp);
  at(189: PGM_NAME);
  printWork();
  at(1: 'User: DEMOUSER');
  at(85: 'WAREHOUSE 01 MAIN WAREHOUSE');
  at(189: 'Page ' + %char(pageNo));
  printWork();
  printText(%subst(dashes: 1: 198));
end-proc;

dcl-proc printColumnHeader;
  at(1: 'Customer');
  at(10: 'Customer name');
  at(42: 'Order');
  at(50: 'Line');
  at(56: 'Item');
  at(68: 'Description');
  at(100: 'Unit');
  at(108: rj('Quantity': 10));
  at(120: rj('Unit price': 12));
  at(134: rj('Amount': 14));
  at(152: 'Ship date');
  printWork();
  printText(' ');
end-proc;

// One order line: values, then a type line, then a message line.
dcl-proc printRecord;
  dcl-pi *n;
    n int(10) const;
  end-pi;
  dcl-s c int(10);
  dcl-s k int(10);
  dcl-s it int(10);
  dcl-s t int(10);
  dcl-s orderNo int(10);
  dcl-s orderLine int(10);
  dcl-s qty packed(9:2);
  dcl-s amount packed(13:2);
  dcl-s shipDate date(*iso);

  // Five lines per customer: three on one order, two on a second order.
  c = %div(n - 1: 5) + 1;
  k = %rem(n - 1: 5) + 1;
  if k <= 3;
    orderNo = 51000 + c * 10 + 1;
    orderLine = k * 10;
  else;
    orderNo = 51000 + c * 10 + 2;
    orderLine = (k - 3) * 10;
  endif;
  it = %rem(n * 3: 10) + 1;
  t = %rem(n: 4) + 1;
  qty = %rem(n * 7: 50) + 1;
  amount = qty * item(it).price;
  shipDate = baseDate + %days(%rem(n * 5: 30));

  at(1: cust(c).no);
  at(10: %trim(cust(c).name));
  at(42: %char(orderNo));
  at(50: rj(%char(orderLine): 4));
  at(56: %trim(item(it).no));
  at(68: %trim(item(it).desc));
  at(100: %trim(item(it).unit));
  at(108: rj(%trim(%editc(qty: '1')): 10));
  at(120: rj(%trim(%editc(item(it).price: '1')): 12));
  at(134: rj(%trim(%editc(amount: '1')): 14));
  at(152: %char(shipDate: *iso));
  printWork();

  at(10: 'Type: ' + typeCode(t) + '  ' + %trim(typeText(t)));
  printWork();

  at(10: 'Message: ' + %trim(msgText(%rem(n * 5: 6) + 1)));
  printWork();
end-proc;

// ---------------------------------------------------------------- output
// Put text into the work line at a column, without touching the rest.
dcl-proc at;
  dcl-pi *n;
    col int(10) const;
    text varchar(300) const;
  end-pi;
  dcl-s n int(10);

  n = %len(text);
  if col + n - 1 > %len(work);
    n = %len(work) - col + 1;
  endif;
  if n > 0;
    %subst(work: col: n) = %subst(text: 1: n);
  endif;
end-proc;

// Right-justify text in a field of the given width.
dcl-proc rj;
  dcl-pi *n varchar(40);
    text varchar(40) const;
    width int(10) const;
  end-pi;
  dcl-s pad char(40) inz(*blanks);

  if %len(text) >= width;
    return text;
  endif;
  return %subst(pad: 1: width - %len(text)) + text;
end-proc;

dcl-proc printWork;
  printText(work);
  work = *blanks;
end-proc;

// Write one line. A pending new page skips to line 1 (except for the very
// first line of the file); a pending skip target moves down the page.
// Lines stop two short of the page length, so the overflow line is never
// reached and the system never ejects a page on its own.
dcl-proc printText;
  dcl-pi *n;
    text varchar(300) const;
  end-pi;

  if lineNo >= PAGE_LEN - 2;
    newPageDue = *on;
  endif;
  spaceBefore = '000';
  spaceAfter = '001';
  skipBefore = *blanks;
  skipAfter = *blanks;
  if newPageDue;
    if started;
      skipBefore = '001';
    endif;
    newPageDue = *off;
    lineNo = 0;
  elseif skipTarget > lineNo + 1;
    skipZ = skipTarget;
    skipBefore = %editc(skipZ: 'X');
    lineNo = skipTarget - 1;
  endif;
  skipTarget = 0;
  outText = text;
  write QSYSPRT outRec;
  started = *on;
  lineNo += 1;
end-proc;
