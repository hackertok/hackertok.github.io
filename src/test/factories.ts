import { faker } from '@faker-js/faker';
import type { StoryItem, Comment } from '../types';

export function createStoryItem(overrides: Partial<StoryItem> = {}): StoryItem {
  return {
    id: faker.number.int({ min: 10000, max: 99999 }),
    type: 'story',
    title: faker.lorem.sentence(),
    url: faker.internet.url(),
    points: faker.number.int({ min: 1, max: 500 }),
    author: faker.internet.username(),
    createdAt: faker.date.recent().getTime(),
    commentCount: faker.number.int({ min: 0, max: 300 }),
    ...overrides,
  };
}

export function createComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: faker.number.int({ min: 1000, max: 9999 }),
    author: faker.internet.username(),
    text: `<p>${faker.lorem.sentence()}</p>`,
    createdAt: faker.date.recent().getTime(),
    parentId: faker.number.int({ min: 1, max: 99999 }),
    children: [],
    depth: 0,
    ...overrides,
  };
}
