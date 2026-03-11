import type { Story, Comment } from '../types';

export function createStory(overrides: Partial<Story> = {}): Story {
  return {
    id: 1,
    title: 'Test Story',
    url: 'https://example.com',
    points: 100,
    author: 'testuser',
    createdAt: Date.now(),
    commentCount: 0,
    ...overrides,
  };
}

export function createComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 1,
    author: 'testuser',
    text: '<p>Test comment</p>',
    createdAt: Date.now(),
    parentId: 0,
    children: [],
    depth: 0,
    ...overrides,
  };
}
