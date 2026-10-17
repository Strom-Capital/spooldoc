/* SPDPRINT: print the demo documents to the demo output queues.      */
/* Processing program: SPDPRINTC.                                     */
/*   CRTCMD CMD(MYLIB/SPDPRINT) PGM(MYLIB/SPDPRINTC) +                */
/*          SRCFILE(MYLIB/SPDSRC) SRCMBR(SPDPRINT)                    */
             CMD        PROMPT('Print demo spooled files')
             PARM       KWD(QUEUE) TYPE(*CHAR) LEN(10) RSTD(*YES) +
                          DFT(*ALL) SPCVAL((*ALL)) +
                          VALUES(FORMS EMAIL REPORTS) +
                          PROMPT('Output queue')
             PARM       KWD(COUNT) TYPE(*DEC) LEN(3 0) DFT(1) +
                          RANGE(1 20) PROMPT('Number of runs')
             PARM       KWD(LIB) TYPE(*NAME) LEN(10) DFT(*CURLIB) +
                          SPCVAL((*CURLIB)) PROMPT('Library of the demo queues')
