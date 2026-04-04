(() => {
  /*
    Fill these values from Supabase project settings:
    Project URL -> url
    Project API Keys (anon/public) -> anonKey

    Keep enabled=false until you finish setup.
  */
  window.SUPABASE_CONFIG = {
    enabled: false,
    url: "",
    anonKey: "",
    postsTable: "blog_posts",
    profileTable: "blog_profiles"
  };
})();
