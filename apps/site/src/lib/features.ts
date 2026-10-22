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
  /**
   * The screenshots in docs/assets, without `-light.png`, each with its alt text in SHOTS.
   * One shows on its own; two or more show in a carousel, the first one first.
   */
  shots: [ShotName, ...ShotName[]];
  /** The guides this feature is described in, the first one linked from the section. */
  docs: { slug: string; title: string }[];
  /**
   * A code sample. `beside` puts it next to the text, with the screenshot full width
   * below; `below` puts it full width under the text and the screenshot, for long lines.
   */
  code?: { code: string; lang: 'yaml' | 'sh'; title: string; place: 'beside' | 'below'; track?: 'install_command_copied' };
}

/**
 * The alt text of each screenshot the site shows, a full sentence that says what it shows.
 * The files are docs/assets/<name>-light.png and -dark.png, the ones the guides use.
 */
export const SHOTS = {
  servers:
    'The Servers page lists two servers: one connected, with its OS version and CCSID, and one that cannot be reached, with the reason and the ports to check.',
  queues:
    'The Queues page of a server with one library lists the output queue INVOICES with its ready, held and total files, the jobs that read it and its text, with New job and Hide on the row.',
  'queue-files':
    'The spooled files of one output queue, under the path Queues, the server and the queue, with the four filters above the list and one held spooled file with its number, job, user data, pages, width and length, and when it was created.',
  'job-builder':
    'The job builder with the extract step open shows the six pipeline steps across the top, the sample invoice page with field hits highlighted on the left, and the definition editor on the right.',
  'xml-definition':
    'The extract step of a job whose spooled file holds XML: the page with its elements highlighted on the left, and the definition with source: xml, the page group element FORM, its fields and its repeating lines on the right.',
  'template-preview':
    "The render step of a job with two templates shows the Document template's HTML in an editor on the left and the rendered invoice preview on the right.",
  'word-template':
    'The render step of a job with a Word template shows the uploaded .docx and the tips for tags in Word on the left, and the PDF preview of the open order lines on the right.',
  'excel-template':
    'The render step of a job with an Excel template of the whole spooled file shows the uploaded .xlsx and the tips for tags in Excel on the left, and the PDF preview with a row per order line on the right.',
  'ai-assistant':
    'The agent panel beside the workbench shows the suggested prompts, one per kind of template, and the message box.',
  jobs: 'The Jobs page lists five jobs with their server, queue, mode, version and last run: three watching and two run on demand, three of them deleting their spooled files after delivery, and one whose last run failed.',
  trigger:
    'The trigger step of a job set to Watching: the watcher runs ready files and the files already on the queue too, and the queue is watched by polling every 30 seconds, with Set up real-time below.',
  finish:
    'The finish step of a job set to Delete, with a warning that spooled files are deleted from the IBM i after their documents are delivered.',
  'job-log':
    'A run opened from the job log shows its status, the spooled file, the five steps with their timings, and the five pick list PDFs it delivered.',
  'job-log-failed':
    'A failed run opened from the job log says which authority the user profile needs on the folder and the CHGAUT command that grants it, keeps the IBM i message under Details, and shows that the Deliver step failed.',
  destinations:
    'The Destinations page lists an email destination, two IFS folders with their folders and settings, and the built-in Spooldoc download, each with the number of jobs that use it.',
  'email-step':
    'The destination step of an invoice job sends to {d.pg.customerEmail} with a Bcc to an archive mailbox, a Reply-To and the subject Invoice {d.pg.invoiceNo} from MyCo Ltd. Beside the fields, the preview of page group 1 of 6 shows the email to invoices@northernsupply.example with invoice-260101.pdf attached and the message filled in, its total formatted as 302,66 € and its due date as 29.10.2026.',
  'webhook-step':
    'The destination step of an invoice job sends its PDF and HTML files to a webhook. Beside the fields, a preview of the call of page group 1 of 6 with line numbers: POST /spooldoc, the headers with the Authorization value masked and the signature, and the JSON body with the document, the job, the spooled file and the invoice fields. Below it, the receiver answered HTTP/1.1 200 OK in 142 ms.',
  'sftp-step':
    'The destination step of an invoice job uploads to SFTP. Beside the page group stepper, the test folder MYUSER@sftp.example.com:/test/in is listed with earlier invoices around invoice-260101.pdf, which Upload test has just uploaded, with its size and time. Below the listing, Upload test and the line Test: files go to /test/in.',
  'destination-ifs':
    'The New IFS destination dialog is filled in with a name, the folder /home/docs/delivery-notes, Add a number when a file with the same name exists, and Keep a copy in Spooldoc on.',
  home: 'The Home page shows counts of servers, output queues, jobs and runs, a chart of runs per day by status, and two items under Needs attention: a server that cannot be reached and a failed run.',
} as const;

export type ShotName = keyof typeof SHOTS;

export const QUICK_START = [
  'git clone https://github.com/Strom-Capital/spooldoc.git',
  'cd spooldoc',
  `printf 'BETTER_AUTH_SECRET=%s\\nSPOOLDOC_SECRET_KEY=%s\\n' \\`,
  `  "$(openssl rand -base64 32)" \\`,
  `  "$(openssl rand -base64 32)" > .env`,
  'docker compose up -d',
].join('\n');

/**
 * The start of the definition in the job builder screenshot (job-builder-*.png), in block
 * style so no line runs past the column. The site's tests parse it with the real parser.
 */
export const DEFINITION_EXAMPLE = `type: sales-invoice
version: 1
source: text
match:
  splf: SPDINVOICE
  page1: MYCO LTD
text:
  page:
    width: 132
    length: 66
  footer:
    fromLine: 60
  split:
    field: invoiceNo
  fields:
    - name: invoiceNo
      anchor:
        regex: 'Invoice no\\.+: (\\S+)'
      page: all
    - name: invoiceDate
      anchor:
        regex: 'Invoice date\\.+: (\\S+)'
      type: date`;


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
    shots: ['servers', 'queues', 'queue-files'],
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
    shots: ['job-builder', 'xml-definition'],
    docs: [{ slug: 'definitions', title: 'Definitions' }],
    code: { code: DEFINITION_EXAMPLE, lang: 'yaml', title: 'YAML, the start of the definition shown below', place: 'beside' },
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
    shots: ['template-preview', 'word-template', 'excel-template'],
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
    shots: ['ai-assistant'],
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
    shots: ['jobs', 'trigger', 'finish'],
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
    shots: ['job-log', 'job-log-failed'],
    docs: [{ slug: 'job-log', title: 'Job log' }],
  },
  {
    id: 'destinations',
    title: 'Download, IFS, email, webhooks and SFTP',
    summary: 'Files go to a download in Spooldoc, a folder in the IFS, by email to the address printed in each document, to your URL as signed JSON, or to a folder on an SFTP server.',
    body: [
      'The built-in destination keeps every file in Spooldoc, ready to download from the run in the job log.',
      'An IFS destination writes each file to a folder on the job\'s IBM i, where programs can pick it up. Each file is tagged with the right CCSID and is never half written. When a file with the same name exists, the destination replaces it, adds a number or fails the run, as you choose.',
      'An email destination sends one email per document through your SMTP server or Microsoft 365. To, Subject and the message take fields such as <code>{d.pg.email}</code>, so each invoice goes to the customer on it, with its PDF attached. The message can be the document itself, from an HTML template. The job builder shows the email of each page group before anything is sent, and a test address sends every email to you first.',
      'A webhook destination posts one call per document to your URL: JSON with the fields the definition read and the files in the formats you pick, signed the Standard Webhooks way so the receiver can check it came from Spooldoc. The job builder shows the call of each page group with the real values, and Send test posts it and shows the answer. A test URL takes every call while you try it.',
      'An SFTP destination uploads each file to a folder on a server, such as a bank or an EDI partner. Spooldoc makes the key and shows the public key line to add to the server. Check connection prints each step with its real values and stops at a new host key until you compare its fingerprint and trust it. In the job builder, the folder on the server is listed live with the page group\'s files placed in it, each tagged with what a run will do, and Upload test puts them in a test folder. Each file is written under a temporary name and renamed when it is whole.',
      'The spooled file is held, moved or deleted only after every file was delivered. When an email, a call or an upload fails, the job log lists each one with its status, and Retry sends only the ones not sent yet.',
    ],
    shots: ['email-step', 'webhook-step', 'sftp-step', 'destinations', 'destination-ifs'],
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
    shots: ['home'],
    docs: [
      { slug: 'deployment', title: 'Deployment' },
      { slug: 'getting-started', title: 'Getting started' },
    ],
    code: { code: QUICK_START, lang: 'sh', title: 'Shell', place: 'below', track: 'install_command_copied' },
  },
];
