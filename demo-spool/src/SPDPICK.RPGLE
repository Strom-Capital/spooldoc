**FREE
// SPDPICK: demo picking list run. 132 columns, 10 cpi, 66 lines per page.
// Five pick lists back to back, each starting on a new page: a header
// with pick list and order numbers, customer and delivery address,
// warehouse and route; a line table; a "Picked by / Checked" footer.
// The pick list number is the split key. All data is invented.
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
dcl-c FOOTER_LINE 60;
dcl-c PICK_COUNT 5;

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
  bin char(10);
end-ds;

// Per pick list: customer index, number of lines, route
dcl-s pickCust int(10) dim(5);
dcl-s pickLines int(10) dim(5);
dcl-s pickRoute char(20) dim(5);

dcl-s shipBase date(*iso) inz(d'2026-10-20');
dcl-s n int(10);

// ---------------------------------------------------------------- main
loadData();
for n = 1 to PICK_COUNT;
  printPickList(n);
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

  setItem(1: 'A-1001': 'BRACKET 40MM': 'PCS': 'A-01-03');
  setItem(2: 'A-1002': 'BRACKET 60MM': 'PCS': 'A-01-04');
  setItem(3: 'B-2001': 'HEX BOLT M8X40': 'PCS': 'B-02-11');
  setItem(4: 'B-2002': 'HEX NUT M8': 'PCS': 'B-02-12');
  setItem(5: 'C-3001': 'STEEL PLATE 2MM 1X2M': 'PCS': 'Y-10-01');
  setItem(6: 'C-3002': 'ANGLE BAR 40X40X4': 'M': 'Y-11-02');
  setItem(7: 'D-4001': 'HYDRAULIC HOSE DN12': 'M': 'C-05-07');
  setItem(8: 'E-5001': 'SAFETY GLOVES SIZE 10': 'PR': 'D-01-01');
  setItem(9: 'F-6001': 'SÄÄTÖJALKA M10': 'PCS': 'B-03-05');
  setItem(10: 'G-7001': 'KÖYSI 10 MM POLYESTER': 'M': 'C-06-02');

  setPick(1: 1: 4: 'R12 NORTH');
  setPick(2: 2: 9: 'R03 CITY');
  setPick(3: 3: 2: 'R07 CENTRAL');
  setPick(4: 5: 12: 'R15 EAST');
  setPick(5: 7: 6: 'R09 WEST');
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
    bin varchar(10) const;
  end-pi;
  item(x).no = no;
  item(x).desc = desc;
  item(x).unit = unit;
  item(x).bin = bin;
end-proc;

dcl-proc setPick;
  dcl-pi *n;
    x int(10) const;
    custIx int(10) const;
    lines int(10) const;
    route varchar(20) const;
  end-pi;
  pickCust(x) = custIx;
  pickLines(x) = lines;
  pickRoute(x) = route;
end-proc;

// ---------------------------------------------------------------- pick list
dcl-proc printPickList;
  dcl-pi *n;
    x int(10) const;
  end-pi;
  dcl-s c int(10);
  dcl-s k int(10);
  dcl-s it int(10);
  dcl-s qty int(10);

  c = pickCust(x);

  newPageDue = *on;
  at(1: 'MYCO LTD');
  at(55: 'PICK LIST');
  at(120: 'Page 1');
  printWork();
  printText('Warehouse 01 MAIN WAREHOUSE');
  printText(' ');
  at(1: 'Pick list no....: ' + %char(700000 + x));
  at(60: 'Deliver to');
  printWork();
  at(1: 'Order no........: ' + %char(51000 + c * 10 + 1));
  at(60: %trim(cust(c).name));
  printWork();
  at(1: 'Customer no.....: ' + cust(c).no);
  at(60: %trim(cust(c).addr1));
  printWork();
  at(1: 'Route...........: ' + %trim(pickRoute(x)));
  at(60: %trim(cust(c).addr2));
  printWork();
  at(1: 'Ship date.......: ' + %char(shipBase + %days(x): *iso));
  at(60: %trim(cust(c).addr3));
  printWork();
  printText('Warehouse.......: 01');
  printText(' ');

  printText(%subst(equals: 1: 120));
  at(1: 'Line');
  at(7: 'Item');
  at(19: 'Description');
  at(52: 'Bin');
  at(64: 'Lot');
  at(78: rj('Quantity': 8));
  at(88: 'Unit');
  at(95: 'Picked');
  printWork();
  printText(%subst(dashes: 1: 120));

  for k = 1 to pickLines(x);
    it = %rem(x * 3 + k * 7: 10) + 1;
    qty = %rem(x * 2 + k * 3: 24) + 1;
    at(1: rj(%char(k * 10): 4));
    at(7: %trim(item(it).no));
    at(19: %trim(item(it).desc));
    at(52: %trim(item(it).bin));
    at(64: 'L2610' + %char(10 + it));
    at(78: rj(%char(qty): 8));
    at(88: %trim(item(it).unit));
    at(95: '________');
    printWork();
  endfor;

  printText(%subst(dashes: 1: 120));
  printText('Lines: ' + %char(pickLines(x)));

  // Footer at a fixed position near the bottom of the page.
  skipTarget = FOOTER_LINE;
  printText('Picked by ____________________   Date __________   '
          + 'Checked ____________________');
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
