import DOMPurify, { type Config } from 'dompurify';

// Configure DOMPurify to match the previous custom sanitizer's behavior:
// - Only allow safe inline HTML tags (no SVG, MathML, or dangerous elements)
// - Only allow safe attributes (href, target, rel, class, id)
// - Force all links to open in new tabs with noopener noreferrer
const PURIFY_CONFIG: Config = {
  ALLOWED_TAGS: [
    'p', 'br', 'a', 'b', 'i', 'u', 'strong', 'em', 'code', 'pre',
    'blockquote', 'ul', 'ol', 'li', 'span', 'div',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'id'],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
};

// Force target="_blank" and rel="noopener noreferrer" on all links
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function sanitizeHtml(html: string | null | undefined): string {
  if (!html || typeof html !== 'string') {
    return '';
  }
  return DOMPurify.sanitize(html, PURIFY_CONFIG);
}
