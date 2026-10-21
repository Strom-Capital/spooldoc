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

/** The text of each cue in a WebVTT file, in order. */
export function vttCues(vtt: string): string[] {
  return vtt
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.split('\n'))
    .filter((lines) => lines.some((line) => line.includes('-->')))
    .map((lines) => lines.slice(lines.findIndex((line) => line.includes('-->')) + 1).join(' ').trim());
}
