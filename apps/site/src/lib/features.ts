/**
 * The features on /features, and the grid on / that links to them. Only what works in
 * the latest release: the README's Status section lists it. Change this file with the
 * features, and keep the words close to the README and the guides they link to.
 *
 * Paragraphs may hold `<code>` and links: they are written here, never user input.
 */
export interface Feature {
  /** The section's anchor on /features. */
  id: string;
  title: string;
  /** One sentence for the grid on the home page. */
  summary: string;
  /** A few short paragraphs for /features. */
  body: string[];
  /** The light and dark screenshot in docs/assets, without `-light.png`. */
  shot: string;
  alt: string;
  /** The guides this feature is described in, the first one linked from the section. */
  docs: { slug: string; title: string }[];
}

export const QUICK_START = [
  'git clone https://github.com/Strom-Capital/spooldoc.git && cd spooldoc',
  `printf 'BETTER_AUTH_SECRET=%s\\nSPOOLDOC_SECRET_KEY=%s\\n' "$(openssl rand -base64 32)" "$(openssl rand -base64 32)" > .env`,
  'docker compose up -d',
].join('\n');

export const DEFINITION_EXAMPLE = `type: invoice
version: 1
match:
  splf: SPDINVOICE
  userData: INVOICE
  page1: "^\\\\S.*\\\\bINVOICE$"
source: text
text:
  page: { width: 132, length: 66 }
  header: { lines: 5 }
  footer: { fromLine: 60 }
  split: { field: invoiceNo }
  fields:
    - { name: invoiceNo, anchor: { after: "Invoice no.......:" } }
    - { name: invoiceDate, anchor: { after: "Invoice date.....:" }, type: date }
    - { name: customerName, anchor: { line: 9, column: 5, length: 40 } }
    - { name: netAmount, anchor: { after: "Net amount" }, page: last, type: number }`;


/**
 * In the order of the five messaging pillars: your programs print as they always have,
 * reading and layout stay apart, templates in tools you already know, the agent drafts
 * and you decide, every run is on the record. Then where the files go and how it runs.
 */
export const FEATURES: Feature[] = [
  {
    id: 'servers-and-queues',
    title: 'Servers and queues',
    summary: 'Your programs print as they always have. You add the IBM i and pick its output queues.',
    body: [
      'Spooldoc reads what your programs already print. It connects through jt400 over the host server ports, so nothing is installed on the IBM i and no program changes.',
      'Add an IBM i with a host, a user profile and its password. Spooldoc signs on when you save, so a wrong host or password shows up at once. The password is stored encrypted.',
      'The Queues page lists the output queues of a server with their ready, held and total files. Search, sort and hide the queues you never need. Open a queue to list its spooled files, and look at any of them page by page.',
      'When a server cannot be reached, its status says why and what to check, and it shows under Needs attention on the Home page.',
    ],
    shot: 'servers',
    alt: 'The Servers page with two servers: one connected, with its OS version and CCSID, and one that cannot be reached, with the reason and what to check',
    docs: [
      { slug: 'servers', title: 'Servers' },
      { slug: 'queues', title: 'Queues' },
    ],
  },
  {
    id: 'definitions',
    title: 'Definitions in YAML',
    summary: 'A definition reads each page into JSON: fields, tables, records and page groups.',
    body: [
      'A definition is a short YAML document that reads the pages of a spooled file into JSON. Fields are found by label, pattern or position. Tables, multi-line records and split keys cover page groups printed back to back, such as one invoice each. XML in a spooled file is read too.',
      'Reading and layout stay apart. A template lays out the JSON and never sees lines and columns. A new look is a new template, and a moved column is one fix in the definition.',
      'The workbench checks the YAML as you type and highlights every field it finds on the page. You check each value next to the line it came from, before anything is rendered.',
    ],
    shot: 'job-builder',
    alt: 'The job builder with the extract step open: six pipeline steps across the top, the sample page with field hits highlighted on the left and the definition editor on the right',
    docs: [{ slug: 'definitions', title: 'Definitions' }],
  },
  {
    id: 'templates',
    title: 'Templates you already know',
    summary: 'HTML, Word or Excel with Carbone tags, rendered to PDF, HTML, DOCX or XLSX.',
    body: [
      'A template is an HTML page, a Word document made in Word or an Excel workbook made in Excel, with <a href="https://carbone.io">Carbone</a> tags such as <code>{d.pg.invoiceNo}</code>. Each page group becomes a document through every template of the job, in that template\'s formats.',
      'Upload a Word or Excel template, or let the agent design one. An Excel template can make one sheet of the whole spooled file, a row per line, to sort, filter and sum.',
      'Spooldoc checks every tag against the definition before it renders. A Carbone server of your own or Carbone Cloud renders the documents. Logos, images and fonts are uploaded once, as assets.',
    ],
    shot: 'word-template',
    alt: 'The render step of a job with a Word template: the uploaded .docx and the tips for tags in Word on the left, and the PDF preview on the right',
    docs: [
      { slug: 'templates', title: 'Templates' },
      { slug: 'carbone', title: 'Carbone' },
    ],
  },
  {
    id: 'agent',
    title: 'The agent',
    summary: 'The agent drafts the definition and the template from a sample. You decide.',
    body: [
      'The agent sits beside the job builder. From a sample spooled file it writes the definition, reads the extraction report and fixes what is missing. Then it writes a template and renders it: HTML, or a Word or Excel template it designs or edits, looking at every page it renders.',
      'It uses an AI model you choose: Anthropic, Google, OpenAI, OpenRouter, Vercel AI Gateway or a local model behind an OpenAI-compatible endpoint. Spooldoc works without a model.',
      'Nothing it writes goes live until you save and activate a version, and none of its tools reaches the IBM i. With masking on, the model sees the layout and not the values. A local model keeps the values on your network.',
    ],
    shot: 'ai-assistant',
    alt: 'The agent panel beside the workbench, with the suggested prompts and the message box',
    docs: [{ slug: 'agent', title: 'Agent' }],
  },
  {
    id: 'jobs',
    title: 'Jobs as pipelines',
    summary: 'Source, trigger, extract, render, destination, finish. Saved as versions.',
    body: [
      'A job takes the spooled files of one output queue to a destination. The job builder shows it as six steps: source, trigger, extract, render, destination and finish. The draft saves as you type.',
      'Saving a version takes a fixed copy of the draft, with a note of what changed. Runs use the active version, and every run is logged against the version it used. Restore an older version to go back.',
      'Run a job on demand on the files you pick, or let it watch the queue. Watching works by polling, or in real time through a data queue that Spooldoc creates only when you turn real-time watching on. When the documents are delivered, the finish step holds, moves, deletes or leaves the spooled file. Delete asks first.',
    ],
    shot: 'jobs',
    alt: 'The Jobs page with five jobs: two watching, one of them with a watch error, one paused, and two run on demand, each with its server, queue, version and last run',
    docs: [{ slug: 'jobs', title: 'Jobs' }],
  },
  {
    id: 'job-log',
    title: 'Job log',
    summary: 'Every run is on the record, with its steps, errors and files.',
    body: [
      'Every run of every job is in the job log: the version it used, the spooled file, what started it, its status and the files it delivered. Open a run to see its steps: capture, extract, render, deliver and finish.',
      'A failed run says which step failed and why, in IBM i terms: the object, the authority and the command that fixes it. The IBM i\'s own message is kept under Details. Failed runs show under Needs attention on the Home page.',
      'Retry runs the same spooled file again with the active version. Runs are kept for 90 days by default, and you set how long.',
    ],
    shot: 'job-log-failed',
    alt: 'A failed run opened from the job log: the error says which authority the user profile needs on the folder and the command that grants it, Details holds the IBM i message, and the steps show that Deliver failed',
    docs: [{ slug: 'job-log', title: 'Job log' }],
  },
  {
    id: 'destinations',
    title: 'Download and IFS destinations',
    summary: 'Files go to a download in Spooldoc or to a folder in the IFS.',
    body: [
      'The built-in destination keeps every file in Spooldoc, ready to download from the run in the job log.',
      'An IFS destination writes each file to a folder on the job\'s IBM i, where programs can pick it up. Each file is tagged with the right CCSID and is never half written. When a file with the same name exists, the destination replaces it, adds a number or fails the run, as you choose.',
      'The spooled file is held, moved or deleted only after every file was delivered.',
    ],
    shot: 'destinations',
    alt: 'The Destinations page with two IFS folders, each with its folder and settings and the number of jobs that use it, and the built-in Spooldoc download',
    docs: [{ slug: 'destinations', title: 'Destinations' }],
  },
  {
    id: 'compose',
    title: 'One Compose file',
    summary: 'The web app, Postgres and Carbone, on amd64 and arm64.',
    body: [
      'The Compose file starts the published image with a Postgres database and a Carbone server. The image holds the web app and the Java runtime for jt400, and runs on amd64 and arm64.',
      'Every release publishes the image to <code>ghcr.io/strom-capital/spooldoc</code>, tagged with its version. Pin a version in production, so an upgrade happens when you choose. The server applies its database migrations when it starts.',
      'Spooldoc runs next to the IBM i, not on it. It needs a route to the host server ports, and nothing else on the IBM i.',
    ],
    shot: 'home',
    alt: 'The Home page: counts of servers, output queues, jobs and runs, and a chart of runs per day by status',
    docs: [
      { slug: 'deployment', title: 'Deployment' },
      { slug: 'getting-started', title: 'Getting started' },
    ],
  },
];
