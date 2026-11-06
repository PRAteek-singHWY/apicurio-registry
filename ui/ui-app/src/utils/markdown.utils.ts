import DOMPurify from "dompurify";
import { marked } from "marked";

/**
 * Renders Markdown as HTML that is safe to insert into the page: scripts, event handlers and
 * `javascript:` links are removed.
 */
export function markdownToSafeHtml(markdown: string): string {
    const html: string = marked.parse(markdown, { async: false });
    return DOMPurify.sanitize(html);
}
