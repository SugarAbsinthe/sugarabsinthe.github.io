(() => {
  function render(markdown) {
    const source = typeof markdown === "string" ? markdown : "";
    const codeBlocks = [];

    const tokenized = source.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const index = codeBlocks.push({
        lang: String(lang || "").trim(),
        code: String(code || "").replace(/\n$/, "")
      }) - 1;
      return "\n@@CODE_" + index + "@@\n";
    });

    let html = escapeHtml(tokenized);
    html = html.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");

    const blocks = html
      .split(/\n{2,}/)
      .map((block) => renderBlock(block.trim()))
      .join("\n");

    return blocks.replace(/@@CODE_(\d+)@@/g, (_, rawIndex) => {
      const index = Number(rawIndex);
      const target = codeBlocks[index] || { lang: "", code: "" };
      const langLabel = target.lang
        ? '<span class="code-lang">' + escapeHtml(target.lang) + "</span>"
        : "";
      return '<pre class="code-block">' + langLabel + "<code>" + escapeHtml(target.code) + "</code></pre>";
    });
  }

  function excerpt(markdown, maxLength) {
    const length = Number(maxLength) > 0 ? Number(maxLength) : 180;
    const plain = String(markdown || "")
      .replace(/```[\s\S]*?```/g, " [code block] ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/[*_#>-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!plain) return "No content yet.";
    return plain.length > length ? plain.slice(0, length) + "..." : plain;
  }

  function renderBlock(block) {
    if (!block) return "";
    if (block.startsWith("@@CODE_")) return block;
    if (block.startsWith("<h1>") || block.startsWith("<h2>") || block.startsWith("<h3>")) return block;

    if (/^(- .+(\n|$))+/.test(block)) {
      const items = block
        .split("\n")
        .map((line) => line.replace(/^- /, "").trim())
        .filter(Boolean)
        .map((line) => "<li>" + line + "</li>")
        .join("");
      return "<ul>" + items + "</ul>";
    }

    return "<p>" + block.replace(/\n/g, "<br>") + "</p>";
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  window.markdownRenderer = {
    render,
    excerpt,
    escapeHtml
  };
})();
