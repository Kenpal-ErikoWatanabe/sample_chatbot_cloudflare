/**
 * Extracts clean readable text from an HTML string.
 * Removes nav, footer, header, script, and style tags and their content,
 * then trims and normalises whitespace.
 */
export function extractText(html: string): string {
  // Remove tags and their inner content that we don't want
  const tagsToStrip = ['script', 'style', 'nav', 'footer', 'header'];
  let result = html;

  for (const tag of tagsToStrip) {
    // Remove opening tag, all content, and closing tag (case-insensitive, dotAll)
    const pattern = new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}>`, 'gi');
    result = result.replace(pattern, '');
  }

  // Strip remaining HTML tags
  result = result.replace(/<[^>]+>/g, ' ');

  // Decode common HTML entities
  result = result
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&hellip;/g, '...')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–');

  // Normalise whitespace: collapse multiple spaces/newlines into a single space
  result = result.replace(/\s+/g, ' ').trim();

  return result;
}
