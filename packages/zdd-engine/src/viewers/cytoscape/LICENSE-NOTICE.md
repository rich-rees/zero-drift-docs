# Third-party notices

`viz.html` (template), `viz.css`, and `viz.js` are derived from the OKF
proof-of-concept viewer in
[GoogleCloudPlatform/knowledge-catalog](https://github.com/GoogleCloudPlatform/knowledge-catalog)
(Apache License 2.0). Local modifications:

- CVD-validated categorical palette replacing the BigQuery demo palette
- Bundle-absolute markdown link resolution (OKF spec §5.1 form)
- `log.md` excluded from the concept walk (reserved filename, spec §3.1)
- Obsidian-style zoom: screen-constant labels with overview fade + hover
  reveal, zoom clamping, spacing slider re-running the force layout, label
  halos, zoom-compensated edge widths
- CDN `<script src>` tags replaced with inline markers filled by
  `render.mjs` so the output is fully self-contained

`vendor/cytoscape.min.js` is [Cytoscape.js](https://js.cytoscape.org) 3.28.1 (MIT).
`vendor/marked.min.js` is [marked](https://marked.js.org) 12.0.0 (MIT).
