// safeMarked — `marked` configured so source-derived markdown can never run
// script in the hosted human index (CR-007, DIO-310). Everything the detail
// and docs panels render comes from the repo: leading `//` comments, SQL
// comments, FastAPI docstrings, the glossary and ADR bodies — text anyone
// with commit access authored, and the viewer contract says the page must be
// safe to host regardless. Three rules, applied at the renderer so the
// parsed structure is untouched:
//   - raw HTML (block or inline) is emitted escaped, as literal text;
//   - links keep only http(s)/mailto, relative and in-page targets — any
//     other scheme (javascript:, data:, vbscript:…) renders as plain text;
//   - images are the same test, and a refused image renders as its alt text.
// Plain script (no module syntax) so it inlines into viz.html and can be
// loaded in a Node test with the vendored marked (test/viewers.test.mjs).
const safeMarked = (() => {
  const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  // A target is safe when it has no scheme (relative / in-page) or a known
  // one. Whitespace and control characters are stripped first — browsers
  // ignore them inside a scheme, so "java\tscript:" would otherwise pass.
  const safeHref = (href) => {
    const h = String(href || "").replace(/[\s\x00-\x1f]/g, "");
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(h);
    if (!scheme) return true;
    return ["http", "https", "mailto"].includes(scheme[1].toLowerCase());
  };
  const attr = (title) => (title ? ` title="${escapeHtml(title)}"` : "");
  const parser = new marked.Marked({
    breaks: false,
    gfm: true,
    renderer: {
      html(token) {
        const raw = typeof token === "string" ? token : token.text ?? token.raw ?? "";
        return escapeHtml(raw);
      },
      link(token) {
        const href = typeof token === "string" ? token : token.href;
        const title = typeof token === "string" ? arguments[1] : token.title;
        const text = typeof token === "string" ? arguments[2] : this.parser.parseInline(token.tokens);
        if (!safeHref(href)) return text;
        return `<a href="${escapeHtml(href)}"${attr(title)}>${text}</a>`;
      },
      image(token) {
        const href = typeof token === "string" ? token : token.href;
        const title = typeof token === "string" ? arguments[1] : token.title;
        const text = typeof token === "string" ? arguments[2] : token.text;
        if (!safeHref(href)) return escapeHtml(text || "");
        return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text || "")}"${attr(title)}>`;
      },
    },
  });
  return { parse: (md) => parser.parse(md || "") };
})();
