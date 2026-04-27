import deepObjEq from 'fast-deep-equal';

/**
 * Converts a Date object to a string in 'YYYY-MM-DD' format.
 * @param date The date to convert.
 * @returns The formatted date string, or an empty string if the date is null or invalid.
 */
export function dateToString(date: Date | null | undefined): string {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return '';
  }
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Converts a string in 'YYYY-MM-DD' format to a Date object.
 * @param dateString The string to convert.
 * @returns The Date object, or null if the string is empty or invalid.
 */
export function stringToDate(dateString: string | null | undefined): Date {
  if (!dateString || typeof dateString !== 'string') {
    return new Date();
  }
  const parts = dateString.split('-');
  if (parts.length !== 3) {
    return new Date();
  }
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const date = new Date(year, month, day);
  if (isNaN(date.getTime())) {
    return new Date();
  }
  return date;
}

/**
 * Converts a restricted subset of HTML to Markdown.
 * Specifically handles tags found in Google Calendar events.
 */
export function htmlToMarkdown(html: string): string {
  if (!html) return '';

  let md = html;

  // Normalize characters and entities first
  md = md.replace(/’/g, "'");
  md = md.replace(/–/g, "-");
  md = md.replace(/\u00a0/g, ' ');
  md = md.replace(/&amp;/gi, '&');

  // Strip <span> tags (with or without attributes), keeping inner content.
  md = md.replace(/<span[^>]*>/gi, '');
  md = md.replace(/<\/span>/gi, '');

  // Remove empty styling tags (handles nested tags like <b><u></u></b>)
  let oldMd;
  do {
    oldMd = md;
    md = md.replace(/<(b|strong|i|em|u|p)>\s*<\/\1>/gi, '');
  } while (md !== oldMd);



  // Merge consecutive tags of the same type
  do {
    oldMd = md;
    md = md.replace(/<\/b><b>/gi, '');
    md = md.replace(/<\/strong><strong>/gi, '');
    md = md.replace(/<\/i><i>/gi, '');
    md = md.replace(/<\/em><em>/gi, '');
  } while (md !== oldMd);

  // Handle specific pattern <strong>Title<br></strong> -> **Title** 
  md = md.replace(/<strong>(.*?)<br\s*\/?>\s*<\/strong>/gi, '**$1** ');

  // Replace headings
  md = md.replace(/<h4>/gi, '#### ');
  md = md.replace(/<\/h4>/gi, '\n\n');

  // Replace paragraphs
  md = md.replace(/<p>/gi, '');
  md = md.replace(/<\/p>/gi, '\n\n');

  // Replace strong
  md = md.replace(/<strong>/gi, '**');
  md = md.replace(/<\/strong>/gi, '**');

  // Replace br
  md = md.replace(/<br\s*\/?>/gi, '\n');

  // Replace links
  md = md.replace(/<a\s+[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');

  // Replace underline (remove)
  md = md.replace(/<u>/gi, '');
  md = md.replace(/<\/u>/gi, '');

  // Replace emphasis/italic
  md = md.replace(/<em>/gi, '_');
  md = md.replace(/<\/em>/gi, '_');
  md = md.replace(/<i>/gi, '_');
  md = md.replace(/<\/i>/gi, '_');

  // Replace bold
  md = md.replace(/<b>/gi, '**');
  md = md.replace(/<\/b>/gi, '**');

  // Clean up multiple newlines
  md = md.replace(/\n{3,}/g, '\n\n');

  return md.trim();
}

/**
 * Checks if a string looks like HTML.
 */
export function looksLikeHtml(text: string): boolean {
  return /<[a-z][\s\S]*>/i.test(text);
}

export { deepObjEq };

// export function deepObjEq(obj1: Object, obj2: Object) {
//   const sortedKeys1 = Object.keys(obj1).sort();
//   const jsonString1 = JSON.stringify(obj1, sortedKeys1);
//   const sortedKeys2 = Object.keys(obj2).sort();
//   const jsonString2 = JSON.stringify(obj2, sortedKeys2);
//   return jsonString1 === jsonString2;
// }
