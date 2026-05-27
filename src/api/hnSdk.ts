import { getApps, initializeApp } from 'firebase/app';
import { get, getDatabase, ref } from 'firebase/database';
import type { FirebaseItem, UserProfile } from '../types';

const APP_NAME = 'hn-sdk';

function getDb() {
  const existing = getApps().find(app => app.name === APP_NAME);
  const app = existing
    ?? initializeApp(
      { databaseURL: 'https://hacker-news.firebaseio.com' },
      APP_NAME,
    );
  return getDatabase(app);
}

const db = getDb();

// Object seam — tests can vi.spyOn(hnSdk, 'readItem') without module-mock hoisting issues
export const hnSdk = {
  async readRankedIds(list: string): Promise<number[]> {
    const snapshot = await get(ref(db, `v0/${list}`));
    return (snapshot.val() as number[] | null) ?? [];
  },

  async readItem(id: number | string): Promise<FirebaseItem | null> {
    const snapshot = await get(ref(db, `v0/item/${id}`));
    return snapshot.val() as FirebaseItem | null;
  },

  async readUser(username: string): Promise<UserProfile | null> {
    if (!/^[a-zA-Z0-9_-]{2,15}$/.test(username)) return null;
    const snapshot = await get(ref(db, `v0/user/${username}`));
    return snapshot.val() as UserProfile | null;
  },
};
