const ALGOLIA_API = 'https://hn.algolia.com/api/v1';
const FIREBASE_API = 'https://hacker-news.firebaseio.com/v0';

// Cache for best story IDs to avoid refetching on every pagination
let bestStoriesCache = { ids: null, timestamp: 0 };
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Get start and end timestamps for a specific day (UTC)
function getDayRange(daysAgo = 0) {
  const now = new Date();
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  
  const targetDay = new Date(startOfToday);
  targetDay.setUTCDate(targetDay.getUTCDate() - daysAgo);
  
  const nextDay = new Date(targetDay);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  
  return {
    start: Math.floor(targetDay.getTime() / 1000),
    end: Math.floor(nextDay.getTime() / 1000),
  };
}

// Normalize Algolia hit to our story format
function normalizeAlgoliaHit(hit) {
  return {
    id: parseInt(hit.objectID, 10),
    title: hit.title,
    url: hit.url,
    points: hit.points,
    author: hit.author,
    createdAt: hit.created_at_i * 1000,
    commentCount: hit.num_comments || 0,
    type: hit._tags?.includes('ask_hn') ? 'ask' : hit._tags?.includes('show_hn') ? 'show' : 'story',
  };
}

// Normalize Firebase story to our format
function normalizeFirebaseStory(story) {
  return {
    id: story.id,
    title: story.title,
    url: story.url,
    points: story.score,
    author: story.by,
    createdAt: story.time * 1000,
    commentCount: story.descendants || 0,
    type: story.type,
  };
}

// Fetch current front page stories from Firebase (matches live HN homepage)
export async function fetchCurrentTopStories(limit = 30) {
  const response = await fetch(`${FIREBASE_API}/topstories.json`);
  if (!response.ok) {
    throw new Error(`Failed to fetch top stories: ${response.status}`);
  }
  
  const allIds = await response.json();
  const pageIds = allIds.slice(0, limit);
  
  // Fetch story details in parallel
  const stories = await Promise.all(
    pageIds.map(id => fetchItem(id).catch(() => null))
  );
  
  // Filter out failed fetches, deleted, dead, and job posts
  return stories
    .filter(story => story && !story.deleted && !story.dead && story.type !== 'job')
    .map(normalizeFirebaseStory);
}

// Fetch historical top stories for a specific day using Algolia
// Note: Algolia's front_page tag only shows CURRENT front page, not historical.
// So we fetch stories created on that day, sorted by points (best approximation).
export async function fetchFrontPageForDay(daysAgo = 1) {
  const { start, end } = getDayRange(daysAgo);
  
  // Use story tag (excludes jobs, comments, polls) and filter by creation date
  // Sort by relevance (which factors in points) to get the day's top stories
  const url = `${ALGOLIA_API}/search?tags=story&numericFilters=created_at_i>=${start},created_at_i<${end}&hitsPerPage=30`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch front page stories: ${response.status}`);
  }
  
  const data = await response.json();
  
  // Filter out job-related posts and sort by points descending
  const filtered = data.hits.filter(hit => {
    // Skip if type is job
    if (hit.type === 'job' || hit._tags?.includes('job')) {
      return false;
    }
    // Skip hiring/job-related posts by title
    const title = (hit.title || '').toLowerCase();
    if (title.includes('who is hiring') || 
        title.includes('who wants to be hired') ||
        title.includes('freelancer?') ||
        title.includes('seeking freelancer')) {
      return false;
    }
    return true;
  });
  
  // Sort by points descending (most popular first)
  const sorted = filtered.sort((a, b) => (b.points || 0) - (a.points || 0));
  
  return sorted.map(normalizeAlgoliaHit);
}

// Fetch best stories using Firebase API (matches HN's /best page)
// Returns a batch of stories for pagination
export async function fetchBestStories(offset = 0, limit = 30) {
  const now = Date.now();
  
  // Check cache
  if (!bestStoriesCache.ids || (now - bestStoriesCache.timestamp) >= CACHE_TTL) {
    const response = await fetch(`${FIREBASE_API}/beststories.json`);
    if (!response.ok) {
      throw new Error(`Failed to fetch best stories: ${response.status}`);
    }
    bestStoriesCache = { ids: await response.json(), timestamp: now };
  }
  
  const allIds = bestStoriesCache.ids;
  const pageIds = allIds.slice(offset, offset + limit);
  
  if (pageIds.length === 0) {
    return { stories: [], hasMore: false, nextOffset: offset };
  }
  
  // Fetch story details in parallel
  const stories = await Promise.all(
    pageIds.map(id => fetchItem(id).catch(() => null))
  );
  
  // Filter out failed fetches, deleted, dead, and job posts
  const validStories = stories
    .filter(story => story && !story.deleted && !story.dead && story.type !== 'job')
    .map(normalizeFirebaseStory);
  
  return {
    stories: validStories,
    hasMore: offset + limit < allIds.length,
    nextOffset: offset + limit,
  };
}

// Fetch a single item from Firebase API (for story details)
export async function fetchItem(id) {
  const response = await fetch(`${FIREBASE_API}/item/${id}.json`);
  if (!response.ok) {
    throw new Error(`Failed to fetch item ${id}: ${response.status}`);
  }
  return response.json();
}

// Fetch all comments for a story using Algolia (much faster - 1-2 requests instead of hundreds)
async function fetchAllCommentsAlgolia(storyId) {
  const allComments = [];
  let page = 0;
  const hitsPerPage = 200; // Algolia max
  
  // Fetch all pages of comments
  while (true) {
    const url = `${ALGOLIA_API}/search?tags=comment,story_${storyId}&hitsPerPage=${hitsPerPage}&page=${page}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch comments: ${response.status}`);
    }
    
    const data = await response.json();
    allComments.push(...data.hits);
    
    // Check if we have more pages
    if (data.hits.length < hitsPerPage || allComments.length >= data.nbHits) {
      break;
    }
    page++;
    
    // Safety limit to prevent infinite loops
    if (page > 10) break;
  }
  
  return allComments;
}

// Build comment tree from flat list of comments
function buildCommentTree(comments, storyId) {
  // Create a map of all comments by ID
  const commentMap = new Map();
  
  comments.forEach(comment => {
    if (comment.author) { // Skip deleted comments (no author)
      commentMap.set(parseInt(comment.objectID, 10), {
        id: parseInt(comment.objectID, 10),
        author: comment.author,
        text: comment.comment_text,
        createdAt: comment.created_at_i * 1000,
        parentId: comment.parent_id,
        children: [],
      });
    }
  });
  
  // Build the tree structure
  const rootComments = [];
  
  commentMap.forEach(comment => {
    if (comment.parentId === storyId) {
      // This is a top-level comment
      rootComments.push(comment);
    } else {
      // This is a reply - add it to its parent's children
      const parent = commentMap.get(comment.parentId);
      if (parent) {
        parent.children.push(comment);
      } else {
        // Parent not found (might be deleted), treat as root
        rootComments.push(comment);
      }
    }
  });
  
  // Sort comments by creation time (oldest first, like HN)
  const sortByTime = (a, b) => a.createdAt - b.createdAt;
  
  const sortTree = (commentList) => {
    commentList.sort(sortByTime);
    commentList.forEach(comment => {
      if (comment.children.length > 0) {
        sortTree(comment.children);
      }
    });
  };
  
  sortTree(rootComments);
  
  return rootComments;
}

// Fetch story with its comments tree (fast version using Algolia)
export async function fetchStoryWithComments(id) {
  const storyId = parseInt(id, 10);
  
  // Fetch story and comments in parallel
  const [story, comments] = await Promise.all([
    fetchItem(storyId),
    fetchAllCommentsAlgolia(storyId),
  ]);
  
  if (!story) {
    throw new Error(`Story ${id} not found`);
  }
  
  // Build comment tree from flat list
  const commentTree = buildCommentTree(comments, storyId);
  
  return {
    id: story.id,
    title: story.title,
    url: story.url,
    points: story.score,
    author: story.by,
    createdAt: story.time * 1000,
    commentCount: story.descendants || 0,
    text: story.text, // For Ask HN posts
    comments: commentTree,
  };
}

// Format relative time
export function formatTimeAgo(timestamp) {
  if (!timestamp || isNaN(timestamp)) {
    return '';
  }
  
  const now = Date.now();
  const diff = now - timestamp;
  
  // Handle future dates
  if (diff < 0) {
    return 'just now';
  }
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);
  
  if (years > 0) return `${years} year${years > 1 ? 's' : ''} ago`;
  if (months > 0) return `${months} month${months > 1 ? 's' : ''} ago`;
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'just now';
}

// Get hostname from URL (includes first path segment for GitHub-like domains)
export function getHostname(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    let hostname = parsed.hostname.replace(/^www\./, '');
    
    // For GitHub and similar sites, include the username/org in the display
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const domainsWithPath = ['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org'];
    
    if (domainsWithPath.includes(hostname) && pathParts.length > 0) {
      hostname = `${hostname}/${pathParts[0]}`;
    }
    
    return hostname;
  } catch {
    return null;
  }
}
