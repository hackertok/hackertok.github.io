export const STORY_INTERACTION_EVENT = 'hackertok:story-interaction';

export function announceStoryInteraction(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(STORY_INTERACTION_EVENT));
}
