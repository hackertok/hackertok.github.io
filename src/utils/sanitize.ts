import DOMPurify, { type Config } from 'dompurify';

const PURIFY_CONFIG: Config = {
  ALLOWED_TAGS: [
    'p', 'br', 'a', 'b', 'i', 'u', 'strong', 'em', 'code', 'pre',
    'blockquote', 'ul', 'ol', 'li', 'span', 'div',
  ],
  ALLOWED_ATTR: ['href', 'class', 'id'],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
};

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('rel', 'noreferrer');
  }
});

export function sanitizeHtml(html: string | null | undefined): string {
  if (!html || typeof html !== 'string') {
    return '';
  }
  return DOMPurify.sanitize(html, PURIFY_CONFIG);
}
