import { useState, useEffect } from 'react';
import { fetchStoryWithComments } from '../api/hn';

export function useStoryWithComments(storyId) {
  const [story, setStory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStory(null); // Clear previous story immediately
      setLoading(true);
      setError(null);

      try {
        const data = await fetchStoryWithComments(storyId);
        if (!cancelled) {
          setStory(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [storyId]);

  return { story, loading, error };
}
