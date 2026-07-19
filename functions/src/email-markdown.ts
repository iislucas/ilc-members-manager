// Single source of truth for the tiny Markdown subset that outbound emails
// support.
//
// Emails are assembled by a very small renderer (markdownToHtml, used by
// sendTemplateEmail) rather than the full editor pipeline, so only a handful of
// constructs turn into HTML. Anything else is passed through as literal text in
// the email. To keep the editing UI honest, the template editor both restricts
// its toolbar to this subset and calls findUnsupportedEmailMarkdown to warn when
// body content strays outside it — and because both the renderer and the warning
// live here, they can't drift apart.

// The supported constructs, for display in the editor UI.
export const SUPPORTED_EMAIL_MARKDOWN = 'bold (**text**), links ([label](url)), and line breaks';

// Renders the supported Markdown subset to the HTML used in outbound emails:
// line breaks, **bold**, and [label](url) links. Every other Markdown construct
// is left as-is (so it appears literally in the email).
export function markdownToHtml(md: string): string {
  return md
    .replace(/\r?\n/g, '<br>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

// Returns human-readable names of any Markdown constructs in `md` that the email
// renderer does NOT support (and would therefore leak into the email as literal
// text). Returns an empty array when the content is fully within the supported
// subset. Conservative by design: it strips the supported constructs first so
// their characters (e.g. the `*` in `**bold**`) don't cause false positives, and
// favours missing an edge case over crying wolf.
export function findUnsupportedEmailMarkdown(md: string): string[] {
  if (!md) return [];
  const issues = new Set<string>();

  // Images look like links but with a leading `!`; check before stripping links.
  if (/!\[[^\]]*\]\([^)]*\)/.test(md)) issues.add('images');

  // Remove supported inline markup (and images) so their characters don't trip
  // the block/inline checks below.
  const stripped = md
    .replace(/\*\*[^*]+\*\*/g, '') // bold
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, ''); // links and images

  for (const line of stripped.split(/\r?\n/)) {
    if (/^\s{0,3}#{1,6}\s/.test(line)) issues.add('headings');
    else if (/^\s*[-*+]\s+\S/.test(line)) issues.add('bullet lists');
    else if (/^\s*\d+\.\s+\S/.test(line)) issues.add('numbered lists');
    else if (/^\s*>\s/.test(line)) issues.add('block quotes');
  }

  if (/`[^`]*`/.test(stripped) || /```/.test(stripped)) issues.add('code');

  // Italic: `_text_`, or a single-asterisk `*text*` that survived bold removal.
  if (/_[^_\s][^_]*_/.test(stripped) || /(^|[^*])\*[^*\s][^*]*\*(?!\*)/.test(stripped)) {
    issues.add('italic');
  }

  return [...issues];
}
