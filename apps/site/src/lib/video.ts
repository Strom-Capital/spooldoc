/**
 * The overview video on the home page (SiteVideo.astro). Its files are in public/video:
 * overview-light.mp4, overview-dark.mp4, the matching .jpg posters and overview.vtt.
 * The transcript is the captions joined into paragraphs, word for word.
 */
export const OVERVIEW_VIDEO = {
  name: 'overview',
  label: 'Spooldoc overview video',
  transcript: [
    'Your IBM i programs print invoices, pick lists and reports. Spooldoc turns those spooled files into documents. Your programs don\'t change, and nothing is installed on the IBM i. Spooldoc connects over the host servers and watches your output queues.',
    'A definition, written in YAML, reads each page into data. Fields by label or position, tables of lines, and one document per invoice. It reads plain text spooled files in any code page, and XML printed into a spooled file.',
    'A template lays out that data. It never sees lines and columns. Write it in HTML, or make it in Word or Excel. Each one makes its own file, a PDF, or both, and you see the document as you edit.',
    'From a sample spooled file, the agent proposes the definition and the template. You check every value next to the page.',
    'Each new spooled file becomes a run. Spooldoc reads it, makes the documents, and delivers the files to a download or a folder in the IFS. Every run is in the job log.',
    'Spooldoc. Spooled files into documents, for IBM i. Open source, MIT licensed. spooldoc.com.',
  ],
} as const;

/**
 * The walkthrough on YouTube, on the features page (VideoLink.astro). The site does not
 * embed YouTube: a poster links out. Its posters are in public/video: walkthrough-light.jpg
 * and walkthrough-dark.jpg. Each chapter starts at `seconds` and links to the video there.
 */
export const WALKTHROUGH_VIDEO = {
  name: 'walkthrough',
  url: 'https://youtu.be/TK0a1nvhn1Q',
  /** The length in seconds, and as YouTube shows it. */
  seconds: 322,
  length: '5:22',
  label: 'Watch the Spooldoc walkthrough on YouTube (5 minutes)',
  chapters: [
    { seconds: 0, title: 'What it does' },
    { seconds: 18, title: 'How it connects' },
    { seconds: 34, title: 'Watching output queues' },
    { seconds: 48, title: 'Servers and queues' },
    { seconds: 70, title: 'Source and trigger' },
    { seconds: 87, title: 'The definition' },
    { seconds: 126, title: 'XML spooled files' },
    { seconds: 151, title: 'The agent' },
    { seconds: 185, title: 'Templates: HTML, Word and Excel' },
    { seconds: 239, title: 'The job' },
    { seconds: 267, title: 'Runs and the job log' },
    { seconds: 296, title: 'Install' },
  ],
} as const;

/** 87 seconds as `1:27`. */
export function videoTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** A YouTube link that starts the video at a second. */
export function videoAt(videoUrl: string, seconds: number): string {
  return `${videoUrl}?t=${seconds}`;
}

/** The text of each cue in a WebVTT file, in order. */
export function vttCues(vtt: string): string[] {
  return vtt
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.split('\n'))
    .filter((lines) => lines.some((line) => line.includes('-->')))
    .map((lines) => lines.slice(lines.findIndex((line) => line.includes('-->')) + 1).join(' ').trim());
}
