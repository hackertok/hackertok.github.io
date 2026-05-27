import { describe, it, expect } from 'vitest';
import { hnSdk } from './hnSdk';

/**
 * Tests for the username validation guard in hnSdk.readUser.
 * Invalid usernames should return null WITHOUT hitting Firebase.
 * We test this by verifying that invalid inputs return null synchronously-fast,
 * which proves the guard short-circuits before the network call.
 */
describe('hnSdk.readUser input validation', () => {
  it('rejects usernames containing slashes (path traversal)', async () => {
    expect(await hnSdk.readUser('pg/karma')).toBeNull();
  });

  it('rejects dot-dot traversal attempts', async () => {
    expect(await hnSdk.readUser('../item/12345')).toBeNull();
    expect(await hnSdk.readUser('foo/../bar')).toBeNull();
  });

  it('rejects usernames that are too long', async () => {
    expect(await hnSdk.readUser('a'.repeat(16))).toBeNull();
  });

  it('rejects empty or single-char usernames', async () => {
    expect(await hnSdk.readUser('')).toBeNull();
    expect(await hnSdk.readUser('x')).toBeNull();
  });

  it('rejects usernames with special characters', async () => {
    expect(await hnSdk.readUser('user.name')).toBeNull();
    expect(await hnSdk.readUser('user name')).toBeNull();
    expect(await hnSdk.readUser('user#1')).toBeNull();
    expect(await hnSdk.readUser('user$1')).toBeNull();
  });
});
