(() => {
  const STORAGE_KEY = "astro_blog_posts_v1";

  function readPosts() {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((item) => sanitizePost(item))
        .filter((item) => item.id && item.title);
    } catch {
      return [];
    }
  }

  function writePosts(posts) {
    const normalized = Array.isArray(posts) ? posts.map((item) => sanitizePost(item)) : [];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  }

  function getPostById(id) {
    return readPosts().find((item) => item.id === id) || null;
  }

  function upsertPost(payload) {
    const now = new Date().toISOString();
    const posts = readPosts();
    const incoming = sanitizePost({
      id: payload && payload.id ? String(payload.id) : createId(),
      title: payload && payload.title ? payload.title : "",
      content: payload && payload.content ? payload.content : "",
      createdAt: payload && payload.createdAt ? payload.createdAt : now,
      updatedAt: now
    });

    const targetIndex = posts.findIndex((item) => item.id === incoming.id);
    if (targetIndex >= 0) {
      posts[targetIndex] = {
        ...posts[targetIndex],
        ...incoming,
        createdAt: posts[targetIndex].createdAt || incoming.createdAt,
        updatedAt: now
      };
    } else {
      posts.push(incoming);
    }

    writePosts(posts);
    return incoming;
  }

  function deletePost(id) {
    const posts = readPosts().filter((item) => item.id !== id);
    writePosts(posts);
  }

  function sanitizePost(item) {
    return {
      id: typeof item.id === "string" ? item.id : "",
      title: typeof item.title === "string" ? item.title.trim().slice(0, 200) : "",
      content: typeof item.content === "string" ? item.content : "",
      createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : ""
    };
  }

  function createId() {
    return "p_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  window.postStore = {
    readPosts,
    writePosts,
    getPostById,
    upsertPost,
    deletePost
  };
})();
