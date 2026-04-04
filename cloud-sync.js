(() => {
  const DEFAULT_POSTS_TABLE = "blog_posts";
  const DEFAULT_PROFILE_TABLE = "blog_profiles";
  const REMOTE_POST_SELECT = "post_id,title,content,blocks,tags,favorite,created_at,updated_at";
  const REMOTE_PROFILE_SELECT = "title,quote,items,updated_at";

  const state = {
    ready: false,
    enabled: false,
    configured: false,
    errorMessage: "",
    client: null,
    user: null,
    postsTable: DEFAULT_POSTS_TABLE,
    profileTable: DEFAULT_PROFILE_TABLE,
    listeners: new Set(),
    queue: Promise.resolve(),
    initPromise: null
  };

  function getState() {
    return {
      ready: state.ready,
      enabled: state.enabled,
      configured: state.configured,
      loggedIn: !!(state.user && state.user.id),
      email: state.user && state.user.email ? state.user.email : "",
      userId: state.user && state.user.id ? state.user.id : "",
      message: deriveStateMessage()
    };
  }

  function onAuthChanged(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    state.listeners.add(listener);
    try {
      listener(getState());
    } catch {
      // no-op
    }
    return () => {
      state.listeners.delete(listener);
    };
  }

  async function init() {
    if (state.initPromise) {
      return state.initPromise;
    }

    state.initPromise = (async () => {
      const config = normalizeConfig(window.SUPABASE_CONFIG);
      state.enabled = config.enabled;
      state.configured = !!(config.url && config.anonKey);
      state.postsTable = config.postsTable || DEFAULT_POSTS_TABLE;
      state.profileTable = config.profileTable || DEFAULT_PROFILE_TABLE;

      if (!state.enabled) {
        state.ready = true;
        notify();
        return getState();
      }

      if (!state.configured) {
        state.errorMessage = "Supabase config is missing.";
        state.ready = true;
        notify();
        return getState();
      }

      if (!window.supabase || typeof window.supabase.createClient !== "function") {
        state.errorMessage = "Supabase client SDK failed to load.";
        state.ready = true;
        notify();
        return getState();
      }

      try {
        state.client = window.supabase.createClient(config.url, config.anonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        });
      } catch (error) {
        state.errorMessage = formatError(error, "Failed to initialize Supabase client.");
        state.ready = true;
        notify();
        return getState();
      }

      try {
        const result = await state.client.auth.getSession();
        if (result && result.error) {
          state.errorMessage = formatError(result.error, "Failed to restore login session.");
        }
        state.user = result && result.data && result.data.session ? result.data.session.user : null;
      } catch (error) {
        state.errorMessage = formatError(error, "Failed to restore login session.");
      }

      state.client.auth.onAuthStateChange((_event, session) => {
        state.user = session && session.user ? session.user : null;
        notify();
      });

      state.ready = true;
      notify();
      return getState();
    })();

    return state.initPromise;
  }

  async function sendMagicLink(email) {
    await init();
    if (!state.client) {
      return { ok: false, reason: deriveStateMessage() };
    }

    const normalized = String(email || "").trim().toLowerCase();
    if (!normalized) {
      return { ok: false, reason: "Email is required." };
    }

    const redirectTo = new URL("./index.html", window.location.href).href;
    const result = await state.client.auth.signInWithOtp({
      email: normalized,
      options: {
        emailRedirectTo: redirectTo
      }
    });

    if (result && result.error) {
      return { ok: false, reason: formatError(result.error, "Failed to send magic link.") };
    }
    return { ok: true, reason: "" };
  }

  async function signOut() {
    await init();
    if (!state.client) {
      return { ok: false, reason: deriveStateMessage() };
    }
    const result = await state.client.auth.signOut();
    if (result && result.error) {
      return { ok: false, reason: formatError(result.error, "Sign-out failed.") };
    }
    state.user = null;
    notify();
    return { ok: true, reason: "" };
  }

  async function pullFromCloud() {
    return enqueue(async () => {
      const auth = await ensureSignedIn();
      if (!auth.ok) return auth;

      const remote = await fetchRemoteSnapshot(auth.userId);
      if (!remote.ok) return remote;

      if (!hasRemoteSnapshotData(remote.snapshot)) {
        const local = readLocalSnapshot();
        return {
          ok: true,
          reason: "",
          pulledPosts: 0,
          mergedPosts: local.posts.length,
          mode: "local"
        };
      }

      const nextProfile = remote.snapshot.profile || readLocalProfile();
      const nextSnapshot = {
        posts: remote.snapshot.posts,
        profile: nextProfile
      };
      writeLocalSnapshot(nextSnapshot);

      return {
        ok: true,
        reason: "",
        pulledPosts: remote.snapshot.posts.length,
        mergedPosts: nextSnapshot.posts.length,
        mode: "remote"
      };
    });
  }

  async function syncNow() {
    return enqueue(async () => {
      const auth = await ensureSignedIn();
      if (!auth.ok) return auth;

      const remote = await fetchRemoteSnapshot(auth.userId);
      if (!remote.ok) return remote;

      if (!hasRemoteSnapshotData(remote.snapshot)) {
        const local = readLocalSnapshot();
        const pushedLocal = await pushSnapshot(auth.userId, local);
        if (!pushedLocal.ok) return pushedLocal;

        return {
          ok: true,
          reason: "",
          pulledPosts: 0,
          mergedPosts: local.posts.length,
          pushedPosts: pushedLocal.pushedPosts,
          mode: "bootstrap"
        };
      }

      const nextProfile = remote.snapshot.profile || readLocalProfile();
      const nextSnapshot = {
        posts: remote.snapshot.posts,
        profile: nextProfile
      };
      writeLocalSnapshot(nextSnapshot);

      return {
        ok: true,
        reason: "",
        pulledPosts: remote.snapshot.posts.length,
        mergedPosts: nextSnapshot.posts.length,
        pushedPosts: 0,
        mode: "remote"
      };
    });
  }

  async function pushLocalSnapshot() {
    return enqueue(async () => {
      const auth = await ensureSignedIn();
      if (!auth.ok) return auth;
      return pushSnapshot(auth.userId, readLocalSnapshot());
    });
  }

  async function pushPost(post) {
    return enqueue(async () => {
      const auth = await ensureSignedIn();
      if (!auth.ok) return auth;
      if (!post || typeof post !== "object") {
        return { ok: false, reason: "Invalid post payload." };
      }

      const row = toRemotePost(post, auth.userId);
      const result = await state.client
        .from(state.postsTable)
        .upsert([row], { onConflict: "user_id,post_id" });

      if (result && result.error) {
        return { ok: false, reason: formatError(result.error, "Cloud save failed.") };
      }
      return { ok: true, reason: "", pushedPosts: 1 };
    });
  }

  async function deletePost(postId) {
    return enqueue(async () => {
      const auth = await ensureSignedIn();
      if (!auth.ok) return auth;

      const id = String(postId || "").trim();
      if (!id) {
        return { ok: false, reason: "Invalid post id." };
      }

      const result = await state.client
        .from(state.postsTable)
        .delete()
        .eq("user_id", auth.userId)
        .eq("post_id", id);

      if (result && result.error) {
        return { ok: false, reason: formatError(result.error, "Cloud delete failed.") };
      }
      return { ok: true, reason: "" };
    });
  }

  async function pushProfile(profile) {
    return enqueue(async () => {
      const auth = await ensureSignedIn();
      if (!auth.ok) return auth;

      const row = toRemoteProfile(profile, auth.userId);
      const result = await state.client
        .from(state.profileTable)
        .upsert([row], { onConflict: "user_id" });

      if (result && result.error) {
        return { ok: false, reason: formatError(result.error, "Cloud profile save failed.") };
      }
      return { ok: true, reason: "" };
    });
  }

  async function ensureSignedIn() {
    await init();
    if (!state.client) {
      return { ok: false, reason: deriveStateMessage() };
    }
    if (!state.user || !state.user.id) {
      return { ok: false, reason: "Please sign in first." };
    }
    return { ok: true, reason: "", userId: state.user.id };
  }

  async function fetchRemoteSnapshot(userId) {
    const postsResult = await state.client
      .from(state.postsTable)
      .select(REMOTE_POST_SELECT)
      .eq("user_id", userId);

    if (postsResult && postsResult.error) {
      return { ok: false, reason: formatError(postsResult.error, "Failed to fetch remote posts.") };
    }

    const profileResult = await state.client
      .from(state.profileTable)
      .select(REMOTE_PROFILE_SELECT)
      .eq("user_id", userId)
      .maybeSingle();

    if (profileResult && profileResult.error) {
      return { ok: false, reason: formatError(profileResult.error, "Failed to fetch remote profile.") };
    }

    const posts = Array.isArray(postsResult && postsResult.data)
      ? postsResult.data.map((row) => fromRemotePost(row)).filter((item) => item.id && item.title)
      : [];
    const profile = profileResult && profileResult.data ? fromRemoteProfile(profileResult.data) : null;

    return {
      ok: true,
      reason: "",
      snapshot: {
        posts: posts,
        profile: profile
      }
    };
  }

  async function pushSnapshot(userId, snapshot) {
    if (!snapshot || typeof snapshot !== "object") {
      return { ok: false, reason: "Invalid sync snapshot." };
    }

    const posts = Array.isArray(snapshot.posts) ? snapshot.posts : [];
    const rows = posts.map((post) => toRemotePost(post, userId));
    if (rows.length) {
      const chunks = splitArray(rows, 100);
      for (let i = 0; i < chunks.length; i += 1) {
        const result = await state.client
          .from(state.postsTable)
          .upsert(chunks[i], { onConflict: "user_id,post_id" });

        if (result && result.error) {
          return { ok: false, reason: formatError(result.error, "Cloud sync failed for posts.") };
        }
      }
    }

    const profile = snapshot.profile || readLocalProfile();
    const profileRow = toRemoteProfile(profile, userId);
    const profileResult = await state.client
      .from(state.profileTable)
      .upsert([profileRow], { onConflict: "user_id" });

    if (profileResult && profileResult.error) {
      return { ok: false, reason: formatError(profileResult.error, "Cloud sync failed for profile.") };
    }

    return {
      ok: true,
      reason: "",
      pushedPosts: rows.length
    };
  }

  function readLocalSnapshot() {
    const store = window.postStore;
    if (!store) {
      return { posts: [], profile: defaultProfile() };
    }

    return {
      posts: Array.isArray(store.readPosts()) ? store.readPosts() : [],
      profile: readLocalProfile()
    };
  }

  function readLocalProfile() {
    const store = window.postStore;
    if (!store || typeof store.readProfile !== "function") {
      return defaultProfile();
    }
    return store.readProfile();
  }

  function writeLocalSnapshot(snapshot) {
    const store = window.postStore;
    if (!store) return;

    if (Array.isArray(snapshot.posts) && typeof store.writePosts === "function") {
      store.writePosts(snapshot.posts);
    }

    if (snapshot.profile && typeof store.writeProfile === "function") {
      store.writeProfile(snapshot.profile);
    }
  }

  function mergeSnapshots(local, remote) {
    const localPosts = Array.isArray(local && local.posts) ? local.posts : [];
    const remotePosts = Array.isArray(remote && remote.posts) ? remote.posts : [];

    const mergedPostsMap = new Map();
    localPosts.forEach((post) => {
      if (!post || !post.id) return;
      mergedPostsMap.set(post.id, post);
    });
    remotePosts.forEach((post) => {
      if (!post || !post.id) return;
      const current = mergedPostsMap.get(post.id);
      if (!current) {
        mergedPostsMap.set(post.id, post);
        return;
      }
      mergedPostsMap.set(post.id, pickNewestByUpdatedAt(current, post));
    });

    const mergedProfile = mergeProfiles(
      local && local.profile ? local.profile : defaultProfile(),
      remote && remote.profile ? remote.profile : null
    );

    return {
      posts: Array.from(mergedPostsMap.values()),
      profile: mergedProfile
    };
  }

  function hasRemoteSnapshotData(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return false;
    if (Array.isArray(snapshot.posts) && snapshot.posts.length > 0) return true;
    return !!snapshot.profile;
  }

  function mergeProfiles(localProfile, remoteProfile) {
    if (!remoteProfile) return localProfile || defaultProfile();
    if (!localProfile) return remoteProfile;
    return pickNewestByUpdatedAt(localProfile, remoteProfile);
  }

  function pickNewestByUpdatedAt(left, right) {
    const leftAt = toEpoch(left && left.updatedAt);
    const rightAt = toEpoch(right && right.updatedAt);
    if (rightAt > leftAt) return right;
    if (leftAt > rightAt) return left;
    return right;
  }

  function toRemotePost(post, userId) {
    const now = new Date().toISOString();
    return {
      user_id: userId,
      post_id: String(post && post.id ? post.id : ""),
      title: String(post && post.title ? post.title : ""),
      content: String(post && post.content ? post.content : ""),
      blocks: Array.isArray(post && post.blocks) ? post.blocks : [],
      tags: Array.isArray(post && post.tags) ? post.tags : [],
      favorite: post && post.favorite === true,
      created_at: String(post && post.createdAt ? post.createdAt : now),
      updated_at: String(post && post.updatedAt ? post.updatedAt : now)
    };
  }

  function fromRemotePost(row) {
    return {
      id: String(row && row.post_id ? row.post_id : ""),
      title: String(row && row.title ? row.title : ""),
      content: String(row && row.content ? row.content : ""),
      blocks: Array.isArray(row && row.blocks) ? row.blocks : [],
      tags: Array.isArray(row && row.tags) ? row.tags : [],
      favorite: row && row.favorite === true,
      createdAt: String(row && row.created_at ? row.created_at : ""),
      updatedAt: String(row && row.updated_at ? row.updated_at : "")
    };
  }

  function toRemoteProfile(profile, userId) {
    const source = profile && typeof profile === "object" ? profile : {};
    return {
      user_id: userId,
      title: String(source.title || "About Me"),
      quote: String(source.quote || "Live like summer flowers."),
      items: Array.isArray(source.items) ? source.items : [],
      updated_at: String(source.updatedAt || new Date().toISOString())
    };
  }

  function fromRemoteProfile(row) {
    return {
      title: String(row && row.title ? row.title : "About Me"),
      quote: String(row && row.quote ? row.quote : "Live like summer flowers."),
      items: Array.isArray(row && row.items) ? row.items : [],
      updatedAt: String(row && row.updated_at ? row.updated_at : "")
    };
  }

  function defaultProfile() {
    return {
      title: "About Me",
      quote: "Live like summer flowers.",
      items: [
        { label: "Focus", value: "mobile / frontend / dev tools" },
        { label: "Current goal", value: "publish notes every week" },
        { label: "Format", value: "markdown + practical code snippets" }
      ],
      updatedAt: ""
    };
  }

  function normalizeConfig(input) {
    const source = input && typeof input === "object" ? input : {};
    return {
      enabled: source.enabled === true,
      url: String(source.url || source.supabaseUrl || "").trim(),
      anonKey: String(source.anonKey || source.supabaseAnonKey || "").trim(),
      postsTable: String(source.postsTable || DEFAULT_POSTS_TABLE).trim(),
      profileTable: String(source.profileTable || DEFAULT_PROFILE_TABLE).trim()
    };
  }

  function deriveStateMessage() {
    if (!state.ready) return "Preparing cloud sync...";
    if (!state.enabled) return "Cloud sync is disabled in supabase-config.js.";
    if (!state.configured) return "Set Supabase URL and anon key in supabase-config.js.";
    if (state.errorMessage) return state.errorMessage;
    if (!state.user) return "Not signed in.";
    return "Signed in as " + (state.user.email || "current user") + ".";
  }

  function notify() {
    const snapshot = getState();
    state.listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch {
        // no-op
      }
    });
  }

  function enqueue(task) {
    const next = state.queue.then(() => task());
    state.queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  function splitArray(items, size) {
    const chunks = [];
    if (!Array.isArray(items) || !items.length) return chunks;
    const step = Math.max(1, Number(size) || 1);
    for (let i = 0; i < items.length; i += step) {
      chunks.push(items.slice(i, i + step));
    }
    return chunks;
  }

  function toEpoch(value) {
    const time = Number(new Date(value));
    if (!Number.isFinite(time)) return 0;
    return time;
  }

  function formatError(error, fallback) {
    if (!error) return String(fallback || "Unknown error.");
    if (typeof error === "string") return error;
    if (typeof error.message === "string" && error.message.trim()) return error.message.trim();
    return String(fallback || "Unknown error.");
  }

  window.cloudSync = {
    init,
    getState,
    onAuthChanged,
    sendMagicLink,
    signOut,
    pullFromCloud,
    syncNow,
    pushLocalSnapshot,
    pushPost,
    deletePost,
    pushProfile
  };
})();
