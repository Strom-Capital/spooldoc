**FREE
// SPDXML: the structured case. One XML document per pick list, printed
// line by line into a 300 column spooled file, the way a forms product
// expects its input. Same five pick lists as SPDPICK, each document on a
// new page. Generic tag names only. Every printed line is under 300
// characters; SHIP_TO carries embedded line breaks (one printed line per
// address line). Special characters are escaped (&amp; &lt; &gt;).
// Prints to QSYSPRT. SPDPRINTC overrides it (OUTQ FORMS, HOLD, PAGESIZE).

ctl-opt dftactgrp(*no) actgrp(*caller) option(*srcstmt);

dcl-f QSYSPRT printer(300) prtctl(prtCtl);

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
  outText char(300);
end-ds;

dcl-c PAGE_LEN 66;
dcl-c PICK_COUNT 5;

// Page state
dcl-s lineNo int(10) inz(0);
dcl-s started ind inz(*off);
dcl-s newPageDue ind inz(*off);

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

// Per pick list: customer index, number of lines
dcl-s pickCust int(10) dim(5);
dcl-s pickLines int(10) dim(5);

dcl-s shipBase date(*iso) inz(d'2026-10-20');
dcl-s n int(10);

// ---------------------------------------------------------------- main
loadData();
for n = 1 to PICK_COUNT;
  printDocument(n);
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

  // Same pick lists as SPDPICK.
  pickCust(1) = 1;
  pickLines(1) = 4;
  pickCust(2) = 2;
  pickLines(2) = 9;
  pickCust(3) = 3;
  pickLines(3) = 2;
  pickCust(4) = 5;
  pickLines(4) = 12;
  pickCust(5) = 7;
  pickLines(5) = 6;
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

// ---------------------------------------------------------------- document
dcl-proc printDocument;
  dcl-pi *n;
    x int(10) const;
  end-pi;
  dcl-s c int(10);
  dcl-s k int(10);
  dcl-s it int(10);
  dcl-s qty int(10);
  dcl-s pickNo varchar(10);

  c = pickCust(x);
  pickNo = %char(700000 + x);

  newPageDue = *on;
  printText('<?xml version="1.0"?>');
  printText('<FORM>');
  printText('  <DOCUMENT>');
  printText('    ' + xmlTag('TITLE': 'PICK LIST'));
  printText('    ' + xmlTag('PICKLIST_NO': pickNo));
  printText('    ' + xmlTag('ORDER_NO': %char(51000 + c * 10 + 1)));
  printText('    ' + xmlTag('CUSTOMER_NO': cust(c).no));

  // Ship-to address: the line breaks are part of the element text.
  printText('    <SHIP_TO>' + esc(%trim(cust(c).name)));
  printText(esc(%trim(cust(c).addr1)));
  if cust(c).addr2 <> *blanks;
    printText(esc(%trim(cust(c).addr2)));
  endif;
  printText(esc(%trim(cust(c).addr3)) + '</SHIP_TO>');

  printText('    ' + xmlTag('SHIP_DATE': %char(shipBase + %days(x): *iso)));
  printText('    <LINES>');
  for k = 1 to pickLines(x);
    // Same line generation as SPDPICK, so both outputs match.
    it = %rem(x * 3 + k * 7: 10) + 1;
    qty = %rem(x * 2 + k * 3: 24) + 1;
    printText('      <LINE>'
            + xmlTag('NO': %char(k * 10))
            + xmlTag('ITEM': %trim(item(it).no))
            + xmlTag('DESCRIPTION': %trim(item(it).desc))
            + xmlTag('WAREHOUSE': '01')
            + xmlTag('BIN': %trim(item(it).bin))
            + xmlTag('QTY': %char(qty))
            + xmlTag('UNIT': %trim(item(it).unit))
            + '</LINE>');
  endfor;
  printText('    </LINES>');
  printText('    ' + xmlTag('OUTPUT_NAME': 'PICKLIST_' + pickNo));
  printText('  </DOCUMENT>');
  printText('</FORM>');
end-proc;

// <NAME>escaped value</NAME>
dcl-proc xmlTag;
  dcl-pi *n varchar(270);
    name varchar(30) const;
    value varchar(100) const;
  end-pi;
  return '<' + name + '>' + esc(value) + '</' + name + '>';
end-proc;

// Escape the XML special characters. & goes first.
dcl-proc esc;
  dcl-pi *n varchar(200);
    value varchar(100) const;
  end-pi;
  dcl-s s varchar(200);

  s = value;
  s = %scanrpl('&': '&amp;': s);
  s = %scanrpl('<': '&lt;': s);
  s = %scanrpl('>': '&gt;': s);
  return s;
end-proc;

// ---------------------------------------------------------------- output
// Write one line. A pending new page skips to line 1 (except for the very
// first line of the file). Lines stop two short of the page length, so a
// long document continues on the next page and the overflow line is never
// reached.
dcl-proc printText;
  dcl-pi *n;
    text varchar(2000) const;
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
  endif;
  outText = text;
  write QSYSPRT outRec;
  started = *on;
  lineNo += 1;
end-proc;
