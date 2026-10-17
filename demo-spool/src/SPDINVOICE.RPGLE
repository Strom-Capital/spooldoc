**FREE
// SPDINVOICE: demo invoice run. 132 columns, 10 cpi, 66 lines per page.
// Six invoices back to back in one spooled file, each starting on a new
// page. Invoices 2 and 6 have too many lines for one page and continue on
// a second page under a "continued" header. The invoice number is the
// split key. Some names and descriptions contain national characters
// (ä, ö, Ä, Ö) so CCSID handling is exercised. All data is invented.
// Prints to QSYSPRT. SPDPRINTC overrides it (OUTQ, HOLD, PAGESIZE, CPI).

ctl-opt dftactgrp(*no) actgrp(*caller) option(*srcstmt) decedit('0.');

dcl-f QSYSPRT printer(132) prtctl(prtCtl);

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
  outText char(132);
end-ds;

dcl-c PAGE_LEN 66;
dcl-c DETAIL_LAST 46;   // last line a detail row may use
dcl-c TOTALS_LAST 56;   // last line the totals block may use
dcl-c FOOTER_LINE 60;   // footer starts here on every page
dcl-c INV_COUNT 6;

// Page state
dcl-s work char(300);
dcl-s lineNo int(10) inz(0);
dcl-s started ind inz(*off);
dcl-s newPageDue ind inz(*off);
dcl-s skipTarget int(10) inz(0);
dcl-s skipZ zoned(3:0);
dcl-s dashes char(300) inz(*all'-');
dcl-s equals char(300) inz(*all'=');

// Invented master data
dcl-ds cust qualified dim(8);
  no char(5);
  name char(30);
  addr1 char(30);
  addr2 char(30);
  addr3 char(30);
end-ds;

dcl-ds item qualified dim(10);
  no char(10);
  desc char(30);
  unit char(4);
  price packed(9:2);
end-ds;

// Per invoice: customer index, number of lines, customer reference
dcl-s invCust int(10) dim(6);
dcl-s invLines int(10) dim(6);
dcl-s invRef char(20) dim(6);

// Current invoice
dcl-s invNo int(10);
dcl-s invPage int(10);
dcl-s c int(10);
dcl-s invDate date(*iso) inz(d'2026-10-15');
dcl-s n int(10);

// ---------------------------------------------------------------- main
loadData();
for n = 1 to INV_COUNT;
  printInvoice(n);
endfor;

*inlr = *on;
return;

// ---------------------------------------------------------------- data
dcl-proc loadData;
  setCust(1: '10001': 'NORTHERN SUPPLY CO': 'Harbour Road 4': 'Building C'
         : 'FI-90100 OULU');
  setCust(2: '10002': 'BAKER & SONS LTD': 'Mill Lane 12': ' '
         : 'FI-33100 TAMPERE');
  setCust(3: '10003': 'MÄKELÄ RAKENNUS OY': 'Teollisuustie 7': 'PL 45'
         : 'FI-40100 JYVÄSKYLÄ');
  setCust(4: '10004': 'SÖDERBERG MASKIN AB': 'Östra Hamngatan 9': ' '
         : 'SE-411 10 GÖTEBORG');
  setCust(5: '10005': 'EASTERN TOOLS OY': 'Satamakatu 2 B': ' '
         : 'FI-53100 LAPPEENRANTA');
  setCust(6: '10006': 'COASTAL MARINE LTD': 'Pier 3': 'Dock Road'
         : 'FI-20100 TURKU');
  setCust(7: '10007': 'HIGHLAND FARMS CO': 'Rural Route 8': ' '
         : 'FI-60100 SEINÄJOKI');
  setCust(8: '10008': 'METRO BUILDERS INC': 'Ring Road 101': 'Unit 5'
         : 'FI-00100 HELSINKI');

  setItem(1: 'A-1001': 'BRACKET 40MM': 'PCS': 4.20);
  setItem(2: 'A-1002': 'BRACKET 60MM': 'PCS': 5.10);
  setItem(3: 'B-2001': 'HEX BOLT M8X40': 'PCS': 0.35);
  setItem(4: 'B-2002': 'HEX NUT M8': 'PCS': 0.08);
  setItem(5: 'C-3001': 'STEEL PLATE 2MM 1X2M': 'PCS': 86.00);
  setItem(6: 'C-3002': 'ANGLE BAR 40X40X4': 'M': 7.90);
  setItem(7: 'D-4001': 'HYDRAULIC HOSE DN12': 'M': 12.40);
  setItem(8: 'E-5001': 'SAFETY GLOVES SIZE 10': 'PR': 3.60);
  setItem(9: 'F-6001': 'SÄÄTÖJALKA M10': 'PCS': 2.75);
  setItem(10: 'G-7001': 'KÖYSI 10 MM POLYESTER': 'M': 1.15);

  // Line counts 3 to 25; invoices 2 and 6 overflow to a second page.
  setInv(1: 1: 3: 'J. SMITH');
  setInv(2: 3: 25: 'A. VIRTANEN');
  setInv(3: 2: 9: 'ORDER 4471');
  setInv(4: 4: 22: 'B. LÖNNQVIST');
  setInv(5: 8: 14: 'SITE 12 PROJECT');
  setInv(6: 6: 24: 'P. JÄRVINEN');
end-proc;

dcl-proc setCust;
  dcl-pi *n;
    x int(10) const;
    no char(5) const;
    name varchar(30) const;
    addr1 varchar(30) const;
    addr2 varchar(30) const;
    addr3 varchar(30) const;
  end-pi;
  cust(x).no = no;
  cust(x).name = name;
  cust(x).addr1 = addr1;
  cust(x).addr2 = addr2;
  cust(x).addr3 = addr3;
end-proc;

dcl-proc setItem;
  dcl-pi *n;
    x int(10) const;
    no varchar(10) const;
    desc varchar(30) const;
    unit varchar(4) const;
    price packed(9:2) const;
  end-pi;
  item(x).no = no;
  item(x).desc = desc;
  item(x).unit = unit;
  item(x).price = price;
end-proc;

dcl-proc setInv;
  dcl-pi *n;
    x int(10) const;
    custIx int(10) const;
    lines int(10) const;
    ref varchar(20) const;
  end-pi;
  invCust(x) = custIx;
  invLines(x) = lines;
  invRef(x) = ref;
end-proc;

// ---------------------------------------------------------------- invoice
dcl-proc printInvoice;
  dcl-pi *n;
    x int(10) const;
  end-pi;
  dcl-s k int(10);
  dcl-s it int(10);
  dcl-s rows int(10);
  dcl-s qty packed(7:0);
  dcl-s amount packed(13:2);
  dcl-s net packed(13:2);
  dcl-s vat packed(13:2);
  dcl-s total packed(13:2);

  invNo = 260100 + x;
  c = invCust(x);
  invPage = 1;
  net = 0;
  printFirstHeader(x);
  printTableHeader();

  for k = 1 to invLines(x);
    it = %rem(x * 7 + k * 3: 10) + 1;
    qty = %rem(x + k * 5: 20) + 1;
    amount = qty * item(it).price;
    net += amount;

    // Every fourth line carries a delivery note on a second row.
    rows = 1;
    if %rem(k: 4) = 0;
      rows = 2;
    endif;
    if lineNo + rows > DETAIL_LAST;
      continuePage();
    endif;

    at(1: rj(%char(k * 10): 4));
    at(7: %trim(item(it).no));
    at(19: %trim(item(it).desc));
    at(55: rj(%char(qty): 8));
    at(65: %trim(item(it).unit));
    at(71: rj(%trim(%editc(item(it).price: '1')): 12));
    at(95: rj(%trim(%editc(amount: '1')): 16));
    printWork();
    if rows = 2;
      at(19: 'Delivery note ' + %char(880000 + x * 100 + k)
           + ', delivered ' + %char(invDate - %days(3): *iso));
      printWork();
    endif;
  endfor;

  vat = %dech(net * 0.255: 13: 2);
  total = net + vat;

  // The totals block takes five lines.
  if lineNo + 5 > TOTALS_LAST;
    continuePage();
  endif;
  printText(' ');
  at(71: %subst(dashes: 1: 40));
  printWork();
  at(71: 'Net amount');
  at(95: rj(%trim(%editc(net: '1')): 16));
  printWork();
  at(71: 'VAT 25.5 %');
  at(95: rj(%trim(%editc(vat: '1')): 16));
  printWork();
  at(71: 'Total EUR');
  at(95: rj(%trim(%editc(total: '1')): 16));
  printWork();

  printFooter();
end-proc;

// Close the current page and start a continuation page.
dcl-proc continuePage;
  printText(' ');
  at(71: 'Continued on next page');
  printWork();
  printFooter();
  invPage += 1;
  newPageDue = *on;
  at(1: 'MYCO LTD');
  at(95: 'INVOICE (CONTINUED)');
  printWork();
  printText(' ');
  at(5: 'Customer no ' + cust(c).no + '  ' + %trim(cust(c).name));
  at(70: 'Invoice no.......: ' + %char(invNo));
  printWork();
  at(70: 'Invoice date.....: ' + %char(invDate: *iso));
  printWork();
  printText(' ');
  printTableHeader();
end-proc;

dcl-proc printFirstHeader;
  dcl-pi *n;
    x int(10) const;
  end-pi;

  newPageDue = *on;
  at(1: 'MYCO LTD');
  at(95: 'INVOICE');
  printWork();
  printText('Industrial Road 12');
  printText('FI-00100 HELSINKI');
  printText('Business ID 1234567-8   VAT FI12345678');
  printText(' ');
  printText(' ');
  at(5: 'Bill to');
  at(70: 'Invoice no.......: ' + %char(invNo));
  printWork();
  at(5: 'Customer no ' + cust(c).no);
  at(70: 'Invoice date.....: ' + %char(invDate: *iso));
  printWork();
  at(5: %trim(cust(c).name));
  at(70: 'Due date.........: ' + %char(invDate + %days(14): *iso));
  printWork();
  at(5: %trim(cust(c).addr1));
  at(70: 'Payment terms....: 14 DAYS NET');
  printWork();
  at(5: %trim(cust(c).addr2));
  at(70: 'Your reference...: ' + %trim(invRef(x)));
  printWork();
  at(5: %trim(cust(c).addr3));
  at(70: 'Our order no.....: ' + %char(51000 + c * 10 + 1));
  printWork();
  at(70: 'Currency.........: EUR');
  printWork();
  printText(' ');
  printText(' ');
end-proc;

dcl-proc printTableHeader;
  printText(%subst(equals: 1: 110));
  at(1: 'Line');
  at(7: 'Item');
  at(19: 'Description');
  at(55: rj('Quantity': 8));
  at(65: 'Unit');
  at(71: rj('Unit price': 12));
  at(95: rj('Amount': 16));
  printWork();
  printText(%subst(dashes: 1: 110));
end-proc;

// Footer at a fixed position near the bottom of every page.
dcl-proc printFooter;
  skipTarget = FOOTER_LINE;
  printText(%subst(dashes: 1: 110));
  printText('MYCO LTD, Industrial Road 12, FI-00100 HELSINKI, '
          + 'Business ID 1234567-8, Phone +358 00 000 0000');
  at(1: 'Bank MYBANK  IBAN FI00 0000 0000 0000 00  BIC MYBKFIXX');
  at(88: 'Invoice ' + %char(invNo) + '  Page ' + %char(invPage));
  printWork();
end-proc;

// ---------------------------------------------------------------- output
// Put text into the work line at a column, without touching the rest.
dcl-proc at;
  dcl-pi *n;
    col int(10) const;
    text varchar(300) const;
  end-pi;
  dcl-s cnt int(10);

  cnt = %len(text);
  if col + cnt - 1 > %len(work);
    cnt = %len(work) - col + 1;
  endif;
  if cnt > 0;
    %subst(work: col: cnt) = %subst(text: 1: cnt);
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
