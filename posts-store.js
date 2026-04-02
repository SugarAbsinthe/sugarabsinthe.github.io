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
      blocks: payload && Array.isArray(payload.blocks) ? payload.blocks : [],
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
      blocks: sanitizeBlocks(Array.isArray(item.blocks) ? item.blocks : []),
      createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : ""
    };
  }

  function sanitizeBlocks(blocks) {
    return blocks
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const type = normalizeType(item.type);
        if (!type) return null;

        if (type === "paragraph") return { type, text: String(item.text || "") };
        if (type === "heading") return { type, text: String(item.text || ""), level: normalizeHeadingLevel(item.level) };
        if (type === "quote") return { type, text: String(item.text || "") };
        if (type === "code") return { type, lang: String(item.lang || ""), code: String(item.code || "") };
        if (type === "table") return { type, rows: String(item.rows || "") };
        return null;
      })
      .filter(Boolean);
  }

  function normalizeType(type) {
    const allowed = ["paragraph", "heading", "quote", "code", "table"];
    return allowed.includes(type) ? type : "";
  }

  function normalizeHeadingLevel(value) {
    const level = Number(value);
    if (level === 1 || level === 2 || level === 3) return level;
    return 2;
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
