// Simple HTML sanitizer to prevent XSS attacks
// Removes script tags, event handlers, and dangerous attributes

const ALLOWED_TAGS = new Set([
  'p', 'br', 'a', 'b', 'i', 'u', 'strong', 'em', 'code', 'pre',
  'blockquote', 'ul', 'ol', 'li', 'span', 'div'
]);

const ALLOWED_ATTRIBUTES = new Set([
  'href', 'target', 'rel', 'class', 'id'
]);

// URL schemes that are safe for links
const SAFE_URL_SCHEMES = ['http:', 'https:', 'mailto:'];

export function sanitizeHtml(html: string | null | undefined): string {
  if (!html || typeof html !== 'string') {
    return '';
  }

  // Create a template element to parse the HTML
  const template = document.createElement('template');
  template.innerHTML = html;

  // Recursively sanitize nodes
  sanitizeNode(template.content);

  return template.innerHTML;
}

function sanitizeNode(node: DocumentFragment | Element): void {
  const nodesToRemove: ChildNode[] = [];
  // Create stable snapshot to avoid issues when modifying DOM during iteration
  const children = Array.from(node.childNodes);

  for (const child of children) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      const tagName = el.tagName.toLowerCase();

      // Remove disallowed tags entirely (like script, style, iframe)
      if (!ALLOWED_TAGS.has(tagName)) {
        // For unknown tags, keep their text content but remove the tag
        if (['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'button'].includes(tagName)) {
          nodesToRemove.push(child);
          continue;
        }
        // For other tags, unwrap them (keep children)
        const fragment = document.createDocumentFragment();
        while (el.firstChild) {
          fragment.appendChild(el.firstChild);
        }
        el.parentNode!.replaceChild(fragment, el);
        continue;
      }

      // Remove disallowed attributes
      const attributesToRemove: string[] = [];
      for (const attr of el.attributes) {
        const attrName = attr.name.toLowerCase();
        
        // Remove event handlers (onclick, onerror, etc.)
        if (attrName.startsWith('on')) {
          attributesToRemove.push(attr.name);
          continue;
        }

        // Remove disallowed attributes
        if (!ALLOWED_ATTRIBUTES.has(attrName)) {
          attributesToRemove.push(attr.name);
          continue;
        }

        // Sanitize href to prevent javascript: URLs
        if (attrName === 'href') {
          const href = attr.value.trim().toLowerCase();
          const isSafe = SAFE_URL_SCHEMES.some(scheme => href.startsWith(scheme)) || 
                         href.startsWith('/') || 
                         href.startsWith('#') ||
                         !href.includes(':');
          if (!isSafe) {
            attributesToRemove.push(attr.name);
          }
        }
      }

      attributesToRemove.forEach(attr => el.removeAttribute(attr));

      // Add security attributes to links
      if (tagName === 'a') {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }

      // Recursively sanitize children
      sanitizeNode(el);
    }
  }

  // Remove nodes marked for removal
  nodesToRemove.forEach(n => n.parentNode?.removeChild(n));
}
