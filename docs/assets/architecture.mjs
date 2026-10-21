// Writes architecture-light.svg and architecture-dark.svg: one layout, two sets of colors.
// Run it from anywhere with `node docs/assets/architecture.mjs` after changing the picture.
import { writeFileSync } from 'node:fs';

const W = 1200;
const H = 740;

const THEMES = {
  light: { line: '#3a3a38', group: '#bdbdb9', label: '#60615e', card: '#fafafa', border: '#d6d6d3', text: '#0f0f0f', accent: '#3159e8', onAccent: '#ffffff' },
  dark: { line: '#c8c8c4', group: '#454543', label: '#a0a09c', card: '#161616', border: '#2f2f2e', text: '#ededec', accent: '#6f8cff', onAccent: '#0b1233' },
};

const TITLE = 'Spooldoc architecture';
const DESC =
  'On the IBM i, programs print spooled files to an output queue. When real-time watching is on, the output queue also sends an entry per ready file to a data queue that Spooldoc creates. ' +
  'Spooldoc reaches the IBM i only through jt400, on host server ports 449 and 8470 to 8476. ' +
  'The job builder, used from a browser on port 3000, lists queues, captures a sample spooled file and sets up real-time watching through jt400; it saves jobs, samples and assets in Postgres and renders previews with Carbone. ' +
  'The agent works in the job builder and sends page text, masked if masking is on, to a model provider: Anthropic, Google, OpenAI, OpenRouter, Vercel AI Gateway or a local model. The agent has no connection to the IBM i. ' +
  'The queue watcher learns of new spooled files from the data queue or by polling, records the files it has seen in Postgres and starts a run. ' +
  'A run captures, extracts, renders, delivers and finishes: it reads the spooled file through jt400, sends each template with its JSON to Carbone, its own container, which makes PDF, HTML, DOCX or XLSX files, stores runs, samples and files in Postgres, writes files to an IFS folder on the IBM i for an IFS destination, and then holds, moves or deletes the spooled file.';

function svg(t) {
  const out = [];
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const text = (x, y, s, { size = 11, weight, fill = t.label, anchor = 'middle', extra = '' } = {}) =>
    out.push(
      `<text x="${x}" y="${y}"${anchor === 'start' ? '' : ` text-anchor="${anchor}"`} font-size="${size}"${weight ? ` font-weight="${weight}"` : ''} fill="${fill}"${extra}>${esc(s)}</text>`,
    );
  const group = (x, y, w, h, name) => {
    out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="none" stroke="${t.group}" stroke-width="1.2" stroke-dasharray="5 4"/>`);
    text(x + 16, y + 22, name, { size: 12, weight: 600, anchor: 'start', extra: ' letter-spacing="1.2"' });
  };
  const card = (x, y, w, h, title, subs = [], accent = false) => {
    const fill = accent ? t.accent : t.card;
    out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill}" stroke="${accent ? t.accent : t.border}" stroke-width="1.5"/>`);
    const cx = x + w / 2;
    const top = y + h / 2 - subs.length * 7 + 5;
    text(cx, top, title, { size: 14, weight: 600, fill: accent ? t.onAccent : t.text });
    subs.forEach((s, i) => text(cx, top + 17 + i * 14, s, { fill: accent ? t.onAccent : t.label }));
  };
  const cylinder = (x, y, w, h, title, subs) => {
    const rx = w / 2;
    out.push(`<path d="M${x} ${y} a${rx} 9 0 0 1 ${w} 0 v${h} a${rx} 9 0 0 1 -${w} 0 z" fill="${t.card}" stroke="${t.border}" stroke-width="1.5"/>`);
    out.push(`<ellipse cx="${x + rx}" cy="${y}" rx="${rx}" ry="9" fill="none" stroke="${t.border}" stroke-width="1.5"/>`);
    const top = y + 9 + (h - 9) / 2 - subs.length * 7 + 5;
    text(x + rx, top, title, { size: 14, weight: 600, fill: t.text });
    subs.forEach((s, i) => text(x + rx, top + 17 + i * 14, s));
  };
  /** A line through the points; `two` puts a head on both ends. */
  const line = (points, { dashed = false, two = false } = {}) => {
    const d = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
    out.push(
      `<path d="${d}" fill="none" stroke="${t.line}" stroke-width="1.5"${dashed ? ' stroke-dasharray="4 4"' : ''} marker-end="url(#head)"${two ? ' marker-start="url(#head)"' : ''}/>`,
    );
  };

  // Outside both groups.
  card(494, 30, 230, 60, 'Browser', ['whoever sets up the jobs']);
  card(950, 22, 200, 82, 'Model provider', ['Anthropic, Google, OpenAI,', 'OpenRouter, Vercel AI Gateway,', 'or a local model']);

  // IBM i.
  group(20, 150, 230, 560, 'IBM I');
  card(38, 190, 194, 60, 'Programs', ['print as they always have']);
  card(38, 290, 194, 80, 'Output queue', ['spooled files, *SCS text']);
  card(38, 430, 194, 74, 'Data queue', ['optional, for real time;', 'Spooldoc creates it']);
  card(38, 600, 194, 70, 'IFS folder', ['where an IFS destination', 'writes the files']);
  line([[135, 250], [135, 290]]);
  line([[135, 370], [135, 430]], { dashed: true });
  text(145, 396, 'an entry per', { anchor: 'start' });
  text(145, 410, 'ready file', { anchor: 'start' });

  // Spooldoc.
  group(300, 150, 870, 560, 'SPOOLDOC');

  // jt400: the only way to the IBM i.
  out.push(`<rect x="318" y="190" width="54" height="500" rx="8" fill="${t.card}" stroke="${t.border}" stroke-width="1.5"/>`);
  text(345, 214, 'jt400', { size: 14, weight: 600, fill: t.text });
  text(349, 440, 'Java, host server ports 449 and 8470 to 8476', { extra: ' transform="rotate(-90 349 440)"' });

  card(494, 170, 230, 90, 'Job builder', ['page view, definition, JSON,', 'template, preview, versions']);
  card(950, 170, 200, 66, 'Agent', ['proposes the definition and', 'the template; you check them']);
  card(687, 296, 180, 60, 'Carbone', ['its own container, makes', 'PDF, HTML, DOCX or XLSX']);
  card(494, 570, 130, 60, 'Watcher', ['polling, or real time']);
  cylinder(700, 590, 420, 80, 'Postgres', ['its own container: servers, jobs, versions, samples,', 'templates, assets, runs, files, settings']);

  // The run and its steps.
  out.push(`<rect x="494" y="396" width="566" height="126" rx="10" fill="none" stroke="${t.border}" stroke-width="1.5"/>`);
  text(510, 414, 'RUN', { size: 12, weight: 600, anchor: 'start', extra: ' letter-spacing="1.2"' });
  const steps = [
    ['Capture', 'read the', 'spooled file'],
    ['Extract', 'pages', 'to JSON'],
    ['Render', 'templates,', 'with Carbone'],
    ['Deliver', 'files to the', 'destination'],
    ['Finish', 'hold, move', 'or delete'],
  ];
  steps.forEach(([name, ...subs], i) => {
    const x = 503 + i * 112;
    card(x, 424, 100, 84, name, subs, true);
    if (i > 0) line([[x - 12, 466], [x, 466]]);
  });

  // Browser, agent and model provider.
  line([[609, 90], [609, 170]], { two: true });
  text(619, 128, 'port 3000', { anchor: 'start' });
  line([[724, 203], [950, 203]], { two: true });
  text(837, 196, 'chat');
  line([[1050, 104], [1050, 170]], { two: true });
  text(1060, 125, 'page text,', { anchor: 'start' });
  text(1060, 139, 'masked if on', { anchor: 'start' });

  // Job builder to Carbone and Postgres.
  line([[705, 260], [705, 296]]);
  text(697, 283, 'previews', { anchor: 'end' });
  line([[724, 250], [1100, 250], [1100, 586]], { two: true });
  text(837, 244, 'jobs, samples, assets');

  // The run to Carbone and Postgres, the watcher to the run and Postgres.
  line([[777, 356], [777, 424]], { two: true });
  text(787, 380, 'template and JSON', { anchor: 'start' });
  line([[900, 522], [900, 581]]);
  text(910, 556, 'runs, samples, files', { anchor: 'start' });
  line([[553, 570], [553, 508]]);
  line([[624, 610], [700, 610]]);
  text(662, 602, 'seen files');

  // IBM i to jt400.
  line([[232, 330], [318, 330]], { two: true });
  text(275, 322, 'spooled files');
  line([[232, 467], [318, 467]], { dashed: true });
  text(275, 459, 'entries');
  line([[318, 635], [232, 635]]);
  text(275, 627, 'files');

  // jt400 to the job builder, the run and the watcher.
  line([[372, 225], [494, 225]], { two: true });
  text(433, 203, 'queues, samples,');
  text(433, 217, 'real-time setup');
  line([[372, 450], [494, 450]], { two: true });
  text(433, 428, 'read, then hold,');
  text(433, 442, 'move or delete');
  line([[494, 500], [372, 500]]);
  text(433, 478, 'files for');
  text(433, 492, 'the IFS');
  line([[372, 600], [494, 600]]);
  text(433, 592, 'new files');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-sans-serif, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" role="img" aria-label="Spooldoc architecture">`,
    `<title>${TITLE}</title>`,
    `<desc>${DESC}</desc>`,
    '<defs>',
    `  <marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${t.line}"/></marker>`,
    '</defs>',
    ...out,
    '</svg>',
    '',
  ].join('\n');
}

for (const [name, theme] of Object.entries(THEMES)) {
  writeFileSync(new URL(`architecture-${name}.svg`, import.meta.url), svg(theme));
}
