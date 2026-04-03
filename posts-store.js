(() => {
  const STORAGE_KEY = "astro_blog_posts_v1";
  const EXPORT_VERSION = 1;
  const STORAGE_SOFT_LIMIT_BYTES = 4.5 * 1024 * 1024;

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
    const normalized = Array.isArray(posts)
      ? posts.map((item) => sanitizePost(item)).filter((item) => hasEssentialFields(item))
      : [];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  }

  function getPostById(id) {
    return readPosts().find((item) => item.id === id) || null;
  }

  function upsertPost(payload) {
    const now = new Date().toISOString();
    const posts = readPosts();
    const hasTags = !!(payload && Object.prototype.hasOwnProperty.call(payload, "tags"));
    const hasFavorite = !!(payload && Object.prototype.hasOwnProperty.call(payload, "favorite"));
    const incoming = sanitizePost({
      id: payload && payload.id ? String(payload.id) : createId(),
      title: payload && payload.title ? payload.title : "",
      content: payload && payload.content ? payload.content : "",
      blocks: payload && Array.isArray(payload.blocks) ? payload.blocks : [],
      tags: payload && Array.isArray(payload.tags) ? payload.tags : [],
      favorite: payload && payload.favorite === true,
      createdAt: payload && payload.createdAt ? payload.createdAt : now,
      updatedAt: now
    });

    const targetIndex = posts.findIndex((item) => item.id === incoming.id);
    if (targetIndex >= 0) {
      posts[targetIndex] = {
        ...posts[targetIndex],
        ...incoming,
        tags: hasTags ? incoming.tags : posts[targetIndex].tags,
        favorite: hasFavorite ? incoming.favorite : posts[targetIndex].favorite,
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

  function exportBundle() {
    return {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      source: "SugarAbsinthe Notes",
      posts: readPosts()
    };
  }

  function importBundle(input, options) {
    const mode = options && options.mode === "replace" ? "replace" : "merge";
    const current = readPosts();
    const parsed = typeof input === "string" ? safeParseJson(input) : input;
    if (!parsed) {
      return {
        ok: false,
        mode,
        reason: "Invalid JSON format.",
        imported: 0,
        inserted: 0,
        updated: 0,
        skipped: 0,
        total: current.length
      };
    }

    const importedRaw = extractImportedPosts(parsed);
    if (!importedRaw.length) {
      return {
        ok: false,
        mode,
        reason: "No post records found.",
        imported: 0,
        inserted: 0,
        updated: 0,
        skipped: 0,
        total: current.length
      };
    }

    const now = new Date().toISOString();
    const imported = importedRaw
      .map((item) => sanitizePost({
        ...item,
        id: item && item.id ? String(item.id) : createId(),
        createdAt: item && item.createdAt ? String(item.createdAt) : now,
        updatedAt: item && item.updatedAt ? String(item.updatedAt) : now
      }))
      .filter((item) => hasEssentialFields(item));

    if (!imported.length) {
      return {
        ok: false,
        mode,
        reason: "No valid posts after validation.",
        imported: importedRaw.length,
        inserted: 0,
        updated: 0,
        skipped: importedRaw.length,
        total: current.length
      };
    }

    const base = mode === "replace" ? [] : current;
    const map = new Map(base.map((item) => [item.id, item]));
    let inserted = 0;
    let updated = 0;

    imported.forEach((item) => {
      if (map.has(item.id)) {
        const previous = map.get(item.id);
        map.set(item.id, {
          ...previous,
          ...item,
          createdAt: previous && previous.createdAt ? previous.createdAt : item.createdAt
        });
        updated += 1;
      } else {
        map.set(item.id, item);
        inserted += 1;
      }
    });

    const nextPosts = Array.from(map.values());
    writePosts(nextPosts);

    return {
      ok: true,
      mode,
      reason: "",
      imported: importedRaw.length,
      inserted,
      updated,
      skipped: Math.max(0, importedRaw.length - imported.length),
      total: nextPosts.length
    };
  }

  function getStorageStats() {
    const raw = window.localStorage.getItem(STORAGE_KEY) || "[]";
    const usedBytes = byteLength(raw);
    const softLimitBytes = STORAGE_SOFT_LIMIT_BYTES;
    const percent = Math.min(999, Math.round((usedBytes / softLimitBytes) * 100));
    return {
      usedBytes,
      usedKB: Number((usedBytes / 1024).toFixed(1)),
      softLimitBytes,
      softLimitKB: Number((softLimitBytes / 1024).toFixed(1)),
      percent,
      warning: usedBytes >= softLimitBytes * 0.8,
      critical: usedBytes >= softLimitBytes
    };
  }

  function sanitizePost(item) {
    return {
      id: typeof item.id === "string" ? item.id : "",
      title: typeof item.title === "string" ? item.title.trim().slice(0, 200) : "",
      content: typeof item.content === "string" ? item.content : "",
      blocks: sanitizeBlocks(Array.isArray(item.blocks) ? item.blocks : []),
      tags: normalizeTags(item.tags),
      favorite: item.favorite === true,
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

  function normalizeTags(tags) {
    if (!Array.isArray(tags)) return [];
    const seen = new Set();
    const normalized = [];
    tags.forEach((tag) => {
      const next = String(tag || "").trim().slice(0, 24);
      if (!next) return;
      const key = next.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      normalized.push(next);
    });
    return normalized.slice(0, 12);
  }

  function hasEssentialFields(item) {
    return !!(item && item.id && item.title);
  }

  function extractImportedPosts(parsed) {
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.posts)) return parsed.posts;
    return [];
  }

  function safeParseJson(raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function byteLength(text) {
    const value = String(text || "");
    if (typeof TextEncoder === "function") {
      return new TextEncoder().encode(value).length;
    }
    return value.length;
  }

  function createId() {
    return "p_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  window.postStore = {
    readPosts,
    writePosts,
    getPostById,
    upsertPost,
    deletePost,
    exportBundle,
    importBundle,
    getStorageStats
  };
})();
