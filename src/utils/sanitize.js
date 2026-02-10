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

export function sanitizeHtml(html) {
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

function sanitizeNode(node) {
  const nodesToRemove = [];
  // Create stable snapshot to avoid issues when modifying DOM during iteration
  const children = Array.from(node.childNodes);

  for (const child of children) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const tagName = child.tagName.toLowerCase();

      // Remove disallowed tags entirely (like script, style, iframe)
      if (!ALLOWED_TAGS.has(tagName)) {
        // For unknown tags, keep their text content but remove the tag
        if (['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'button'].includes(tagName)) {
          nodesToRemove.push(child);
          continue;
        }
        // For other tags, unwrap them (keep children)
        const fragment = document.createDocumentFragment();
        while (child.firstChild) {
          fragment.appendChild(child.firstChild);
        }
        child.parentNode.replaceChild(fragment, child);
        continue;
      }

      // Remove disallowed attributes
      const attributesToRemove = [];
      for (const attr of child.attributes) {
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

      attributesToRemove.forEach(attr => child.removeAttribute(attr));

      // Add security attributes to links
      if (tagName === 'a') {
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer');
      }

      // Recursively sanitize children
      sanitizeNode(child);
    }
  }

  // Remove nodes marked for removal
  nodesToRemove.forEach(node => node.parentNode?.removeChild(node));
}
