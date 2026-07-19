const BASE64URL_TOKEN = /^[A-Za-z0-9_-]+$/;

export function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!value || !BASE64URL_TOKEN.test(value)) {
    throw new Error('invalid base64url');
  }

  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/') + padding;
  const decoded = atob(base64);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return encodeBase64Url(new Uint8Array(digest));
}

export function randomId(byteLength = 18): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

export function validBearerToken(value: string): boolean {
  try {
    return decodeBase64Url(value).byteLength === 32;
  } catch {
    return false;
  }
}

export function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length);
  return validBearerToken(token) ? token : null;
}
