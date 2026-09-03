(() => {
  const bundle = window.BUNDLE;
  const nodeIndex = {};
  for (const n of bundle.nodes) nodeIndex[n.data.id] = n.data;

  // Friendly display names, derived from the concept-id slug (endpoints carry
  // methods+path as their title — precise, but noise on a map). The full
  // technical title stays in the tooltip and detail header. Acronym = initials,
  // shown inside the circle in the lanes view.
  const isLightHex = (hex) => {
    const v = parseInt(hex.slice(1), 16);
    const r = v >> 16, g = (v >> 8) & 255, b = v & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b > 150;
  };
  // Module titles are full repo paths — captions show the basename (or the
  // last two segments where basenames collide, e.g. bank/BankTable.tsx); the
  // full path stays in the tooltip, detail header and resource link.
  const baseCounts = {};
  for (const n of bundle.nodes) {
    if (n.data.type !== "Module") continue;
    const b = n.data.label.split("/").pop();
    baseCounts[b] = (baseCounts[b] || 0) + 1;
  }
  // Endpoint labels are URL paths ("/api/journeys/[id]") — humanize them for
  // the map, dropping whatever leading segments EVERY endpoint shares (a
  // Next.js "/api", a FastAPI "/v1", nothing at all) rather than keying on any
  // one framework's convention; the exact path stays in the tooltip.
  const routeSegs = bundle.nodes.filter((n) => n.data.type === "API Endpoint")
    .map((n) => n.data.label.split("/").filter(Boolean));
  let commonRoute = routeSegs.length ? [...routeSegs[0]] : [];
  for (const segs of routeSegs) {
    let i = 0;
    while (i < commonRoute.length && i < segs.length && commonRoute[i] === segs[i]) i++;
    commonRoute = commonRoute.slice(0, i);
  }
  for (const n of bundle.nodes) {
    const d = n.data;
    if (d.type === "API Endpoint") {
      const segs = d.label.split("/").filter(Boolean);
      const own = segs.length > commonRoute.length ? segs.slice(commonRoute.length) : segs.slice(-1);
      d.display = own
        .map((w) => (/^[\[{].*[\]}]$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
    } else if (d.type === "Module") {
      const segs = d.label.split("/");
      d.display = segs.slice(baseCounts[segs[segs.length - 1]] > 1 ? -2 : -1).join("/");
    } else {
      d.display = d.label;
    }
    // Acronym = initials of words AND path segments — "/" splits too, so
    // "/settings/environment" -> SE rather than falling into the raw-slice
    // fallback ("/SE") that path-shaped titles used to hit. The single-word
    // fallback slices the word, not the raw display, so "/bank" -> BAN.
    const words = d.display.replace(/[^A-Za-z0-9 _\-\[\]{}/]/g, "").split(/[\s_\-/]+/)
      .filter((w) => w && !/^[\[{]/.test(w)); // all dynamic segments ([id], {id}), not just [id]
    d.acr = (words.length >= 2 ? words.map((w) => w[0]).join("") : (words[0] || d.display).slice(0, 3))
      .toUpperCase().slice(0, 4);
  }

  // Backlinks reflect the full bundle truth (including edges the graph
  // suppresses as cross-cutting) — the detail panel never hides a relationship.
  const backlinks = {};
  for (const e of bundle.edges) {
    const { source, target } = e.data;
    (backlinks[target] ||= []).push(source);
  }

  // ---------- derived facts ----------
  // Lanes dispatch on display TYPE (node ids are bundle paths and carry no
  // architecture meaning of their own).
  // Functions sit in their own band beneath Tables (DIO-149): sharing a lane
  // put a trigger function *next to* its tables, collapsing the join edges
  // into invisible sub-node-width stubs. Storage buckets stay with Tables.
  const LANE_BY_TYPE = {
    "UI Surface": 0, "Feature": 1, "API Endpoint": 2,
    "Table": 3, "Storage Bucket": 3, "Database Function": 4,
  };
  const layerOf = (id) => LANE_BY_TYPE[nodeIndex[id]?.type] ?? "rail";

  // Auth mode is the deriver's facts.auth, carried on node data — mechanical
  // truth from the middleware matcher, never a hand-maintained list or a
  // prose parse.
  const authMode = {};
  for (const n of bundle.nodes) {
    if (n.data.type === "API Endpoint") authMode[n.data.id] = n.data.auth || "session";
  }
  const AUTH_LABELS = {
    hmac: "HMAC-signed callback", "cron-secret": "CRON secret bearer",
    "session-in-handler": "in-handler session check",
    public: "NO auth guard",
  };

  // Cross-cutting concerns are attributes, not edges: an edge to the auth
  // feature/service from a plain session-auth endpoint is the norm (the
  // overwhelming majority) and carries no information as an arrow — it is
  // stated in the detail panel instead. Exceptions keep their edges.
  // Hubs come from zdd.config.json via the renderer.
  const AUTH_HUBS = new Set((bundle.viewer && bundle.viewer.authHubs) || []);
  const isSuppressed = (e) => {
    const { source, target } = e.data;
    const hub = AUTH_HUBS.has(source) ? source : AUTH_HUBS.has(target) ? target : null;
    if (!hub) return false;
    const other = hub === source ? target : source;
    return authMode[other] === "session";
  };
  const visEdges = bundle.edges.filter((e) => !isSuppressed(e));

  const degree = {};
  for (const e of visEdges) {
    degree[e.data.source] = (degree[e.data.source] || 0) + 1;
    degree[e.data.target] = (degree[e.data.target] || 0) + 1;
  }
  const HUB_DEG = 20;
  const isHub = (id) => (degree[id] || 0) >= HUB_DEG;

  // Product areas, derived from concept tags (never a hand-maintained list).
  // Tags that describe properties rather than areas are excluded; areas with
  // fewer than 4 concepts fold into "Other".
  // Exclusions come from zdd.config.json (viewer.nonAreaTags) — property and
  // tech tags (react-flow, nextjs, …) must not surface as product areas.
  const NON_AREA_TAGS = new Set(
    (bundle.viewer && bundle.viewer.nonAreaTags) || ["rls-disabled", "media-project"],
  );
  const rawArea = (d) => {
    for (const t of d.tags || []) if (!NON_AREA_TAGS.has(t)) return t;
    return null;
  };
  const areaCounts = {};
  for (const n of bundle.nodes) {
    const a = rawArea(n.data);
    if (a) areaCounts[a] = (areaCounts[a] || 0) + 1;
  }
  const MIN_AREA = 4;
  const titleCase = (s) => s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const areaOf = (d) => {
    const a = rawArea(d);
    return a && areaCounts[a] >= MIN_AREA ? titleCase(a) : "Other";
  };
  const AREAS = [...new Set(bundle.nodes.map((n) => areaOf(n.data)))]
    .sort((a, b) => (a === "Other") - (b === "Other") || a.localeCompare(b));

  // ---------- theming ----------
  // Dark mode uses the dark-surface steps of the same hues, validated
  // all-pairs against #0f172a. Dark caps at 4 categorical slots, so Feature
  // folds to neutral there — its own lane/stack position carries identity.
  const theme = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  const DARK_NODE = {
    "#2a78d6": "#3987e5", "#e87ba4": "#d55181", "#eda100": "#c98500",
    "#4a3aa7": "#94a3b8", "#008300": "#008300",
    "#0d9488": "#14b8a6", "#b45309": "#d97706",
  };
  const themedColor = (d) => (theme() === "dark" ? (DARK_NODE[d.color] || d.color) : d.color);
  const THEMES = {
    light: { ink: "#0f172a", halo: "#f8fafc", border: "#0f172a", authx: "#c98500",
             sel: "#f59e0b", edge: "#94a3b8", cross: "#475569", lit: "#1c5cab" },
    // Dark canvas is neutral black (#141414 panel) — halo must match it so
    // label backgrounds blend instead of leaving blue-slate boxes.
    dark:  { ink: "#e7e7e7", halo: "#141414", border: "#4a4a4a", authx: "#fab219",
             sel: "#f8fafc", edge: "#414141", cross: "#8f8f8f", lit: "#86b6ef" },
  };
  function makeStyle() {
    const T = THEMES[theme()];
    return [
      { selector: "node", style: {
          // Features are curated vertical slices, not components — the diamond
          // marks them as labels-of-slices in every view (DIO-149).
          shape: (ele) => (ele.data("type") === "Feature" ? "diamond" : "ellipse"),
          "background-color": (ele) => themedColor(ele.data()), label: "data(display)", color: T.ink,
          "font-size": 11, "text-valign": "bottom", "text-margin-y": 4, "text-wrap": "wrap",
          "text-max-width": 120, "text-background-color": T.halo,
          "text-background-opacity": 0.85, "text-background-padding": 2,
          width: "data(size)", height: "data(size)", "border-width": 1, "border-color": T.border } },
      { selector: "node.authx", style: { "border-width": 4, "border-color": T.authx } },
      { selector: "node.lbl", style: { "text-opacity": 1 } },
      { selector: "node.dim", style: { opacity: 0.15 } },
      { selector: "node:selected", style: { "border-width": 3, "border-color": T.sel } },
      { selector: "edge", style: {
          width: 1.2, "line-color": T.edge, "curve-style": "straight",
          "target-arrow-shape": "none", opacity: 0.12 } },
      { selector: "edge.crossarea", style: { opacity: 0.3, "line-color": T.cross } },
      { selector: "edge.hubedge", style: { opacity: 0 } },
      { selector: "edge.lit", style: { opacity: 0.95, width: 1.6, "line-color": T.lit, "z-index": 9 } },
      { selector: "edge.offdim", style: { opacity: 0.02 } },
      { selector: "edge.dim", style: { opacity: 0.02 } },
    ];
  }

  let cy = null;
  const graphEl = document.getElementById("graph");
  const overlay = document.getElementById("overlay");
  const legendEl = document.getElementById("legend");
  const crumbsEl = document.getElementById("crumbs");
  const indexEl = document.getElementById("index-panel");
  let laneLabels = [];

  function addLaneLabel(text, x, y, pin) {
    const el = document.createElement("div");
    el.className = "lane-label";
    el.textContent = text;
    overlay.appendChild(el);
    laneLabels.push({ el, x, y, pin });
  }
  // In-circle acronyms are HTML overlay divs (cytoscape has one label slot,
  // which the short title uses). Each tracks its cytoscape node live, so they
  // survive drags and layout runs in every view.
  function addAcrs(fontBase = 15) {
    for (const n of cy.nodes()) {
      const d = n.data();
      const el = document.createElement("div");
      el.className = "node-acr";
      el.textContent = d.acr;
      el.style.color = isLightHex(themedColor(d)) ? "#0f172a" : "#ffffff";
      overlay.appendChild(el);
      laneLabels.push({ el, cynode: n, base: fontBase, acr: true });
    }
    cy.on("position", "node", () => positionLaneLabels());
    positionLaneLabels();
  }
  function positionLaneLabels() {
    if (!cy) return;
    const z = cy.zoom(), p = cy.pan();
    for (const item of laneLabels) {
      const { el, pin, acr } = item;
      let x = item.x, y = item.y;
      if (acr) {
        const mp = item.cynode.position();
        x = mp.x; y = mp.y;
        const px = item.base * z;
        el.style.visibility = px < 6 ? "hidden" : "visible";
        el.style.fontSize = Math.min(px, 26) + "px";
      }
      el.style.left = pin ? "12px" : (x * z + p.x) + "px";
      el.style.top = (y * z + p.y) + "px";
    }
  }

  const BASE_FONT = 11;
  const LABEL_ZOOM_MIN = 0.55;
  function makeCy(elements, opts = {}) {
    if (cy) cy.destroy();
    overlay.innerHTML = "";
    laneLabels = [];
    cy = cytoscape({
      container: graphEl, elements, style: makeStyle(),
      layout: { name: "preset" }, wheelSensitivity: 0.2,
      autoungrabify: opts.locked ?? true,
    });
    cy.minZoom(0.05);
    cy.maxZoom(5);
    for (const n of cy.nodes()) {
      const am = authMode[n.id()];
      if (am && am !== "session" && am !== "is-auth") n.addClass("authx");
    }
    // Labels hold constant screen size so zooming in separates them; below
    // LABEL_ZOOM_MIN they hide (hover/select reveals via .lbl).
    const refreshLabels = () => {
      const z = cy.zoom();
      cy.batch(() => {
        cy.nodes().style({
          "font-size": Math.max(0.5, Math.min(48, BASE_FONT / z)),
          "text-max-width": Math.max(70, 120 / z),
          "text-opacity": opts.alwaysLabel || z >= LABEL_ZOOM_MIN ? 1 : 0,
        });
        cy.edges().style({ width: Math.max(0.4, Math.min(1.6, 1.6 / z)) });
      });
    };
    let raf = null;
    cy.on("zoom", () => { if (!raf) raf = requestAnimationFrame(() => { raf = null; refreshLabels(); positionLaneLabels(); }); });
    cy.on("pan", positionLaneLabels);

    const light = (n) => cy.batch(() => {
      cy.edges().removeClass("lit").addClass("offdim");
      cy.nodes().addClass("dim").removeClass("lbl");
      n.removeClass("dim").addClass("lbl");
      n.connectedEdges().removeClass("offdim").addClass("lit");
      n.neighborhood("node").removeClass("dim").addClass("lbl");
    });
    const unlight = () => cy.batch(() => {
      cy.edges().removeClass("lit offdim");
      cy.nodes().removeClass("dim lbl");
    });
    const tip = document.getElementById("tooltip");
    cy.on("mouseover", "node", (e) => {
      light(e.target);
      const d = e.target.data();
      tip.innerHTML = `<b></b><span></span>`;
      tip.querySelector("b").textContent = d.label;
      tip.querySelector("span").textContent = d.description ? " — " + d.description : "";
      tip.hidden = false;
    });
    cy.on("mousemove", (e) => {
      if (tip.hidden || !e.renderedPosition) return;
      tip.style.left = Math.min(e.renderedPosition.x + 16, graphEl.clientWidth - 340) + "px";
      tip.style.top = (e.renderedPosition.y + 18) + "px";
    });
    cy.on("mouseout", "node", () => {
      tip.hidden = true;
      const sel = cy.$("node:selected");
      sel.length ? light(sel) : unlight();
    });
    cy.on("select", "node", (e) => light(e.target));
    // Deselect closes the detail slide-out; a select in the same tap (node →
    // node) reopens it before paint, so only true deselects visibly close.
    cy.on("unselect", "node", () => { unlight(); detailEl.classList.remove("open"); });
    cy.on("tap", (e) => { if (e.target === cy) { unlight(); closePanels(); } });
    cy.on("tap", "node", (e) => { if (currentView !== "explorer") renderDetail(e.target.id()); });
    refreshLabels();
    return cy;
  }

  // Fit the graph, but never below a zoom where acronyms are legible — on
  // small screens you land readable at the top of the map and pan, rather
  // than seeing 123 unreadably small circles.
  function fitWithFloor(pad, floor) {
    cy.fit(undefined, pad);
    if (cy.zoom() < floor) {
      cy.zoom(floor);
      const bb = cy.elements().boundingBox();
      cy.pan({
        x: graphEl.clientWidth / 2 - (floor * (bb.x1 + bb.x2)) / 2,
        y: 30 - floor * bb.y1,
      });
    }
    positionLaneLabels();
  }

  const markHubEdges = () => {
    for (const e of cy.edges()) if (isHub(e.source().id()) || isHub(e.target().id())) e.addClass("hubedge");
  };
  const presetNodes = (pos) => bundle.nodes
    .filter((n) => pos[n.data.id])
    .map((n) => ({ data: n.data, position: pos[n.data.id] }));

  // ---------- views ----------
  const LANE_NAMES = ["UI Surfaces", "Features — curated slices", "API", "Tables", "DB Functions"];

  function viewLanes() {
    const lanes = [[], [], [], [], []];
    const rail = [];
    for (const n of bundle.nodes) {
      // Modules (lib/component files) would swamp the orientation view — the
      // lanes view hides them as a display choice; explorer/columns/force and
      // the detail panel's backlinks still show them in full.
      if (n.data.type === "Module") continue;
      const l = layerOf(n.data.id);
      (l === "rail" ? rail : lanes[l]).push(n.data.id);
    }
    // Order within a lane: 3 barycenter sweeps against neighbour positions,
    // seeded by area so related nodes start adjacent; then wrap into rows.
    const adj = {};
    for (const e of visEdges) {
      (adj[e.data.source] ||= []).push(e.data.target);
      (adj[e.data.target] ||= []).push(e.data.source);
    }
    const xIndex = new Map();
    lanes.forEach((ids) => {
      ids.sort((a, b) => (areaOf(nodeIndex[a]) + a).localeCompare(areaOf(nodeIndex[b]) + b));
      ids.forEach((id, i) => xIndex.set(id, i));
    });
    for (let sweep = 0; sweep < 3; sweep++) {
      lanes.forEach((ids) => {
        const score = {};
        for (const id of ids) {
          const ns = (adj[id] || []).map((o) => xIndex.get(o)).filter((v) => v !== undefined);
          score[id] = ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : xIndex.get(id);
        }
        ids.sort((a, b) => score[a] - score[b]);
        ids.forEach((id, i) => xIndex.set(id, i));
      });
    }
    const PER_ROW = 12, GAPX = 150, ROW_H = 96, LANE_PAD = 190;
    const laneW = (n) => Math.min(n, PER_ROW) * GAPX;
    const maxW = Math.max(...lanes.map((l) => laneW(l.length)));
    // Lane baselines are cumulative — a lane that wraps to many rows pushes
    // the next lane down instead of overlapping it.
    const laneY = [];
    let yCursor = 0;
    lanes.forEach((ids) => {
      laneY.push(yCursor);
      yCursor += Math.ceil(ids.length / PER_ROW) * ROW_H + LANE_PAD;
    });
    const pos = {};
    lanes.forEach((ids, li) => {
      const order = [...ids].sort((a, b) => xIndex.get(a) - xIndex.get(b));
      const off = (maxW - laneW(order.length)) / 2;
      order.forEach((id, i) => {
        pos[id] = { x: off + (i % PER_ROW) * GAPX, y: laneY[li] + Math.floor(i / PER_ROW) * ROW_H };
      });
    });
    // Rail starts below its label's screen-space box: lane labels hold
    // constant pixel size while the layout scales, so at fit zoom a y:-22
    // label overlapped the first rail node (DIO-149).
    // 110px pitch: each rail node's below-node caption needs clearance before
    // the next circle — 78 left captions touching the following node.
    rail.sort().forEach((id, i) => { pos[id] = { x: maxW + 260, y: 40 + i * 110 }; });
    // Hidden Module nodes take their edges with them (cytoscape rejects edges
    // with absent endpoints).
    const laneEdges = visEdges.filter((e) => pos[e.data.source] && pos[e.data.target]);
    makeCy([...presetNodes(pos), ...laneEdges]);
    cy.nodes().style({ width: 46, height: 46 });
    markHubEdges();
    addAcrs();
    LANE_NAMES.forEach((nm, i) => addLaneLabel(nm, 0, laneY[i] - 44, true));
    addLaneLabel("Apps & Services", maxW + 190, -70);
    fitWithFloor(40, 0.65);
    legendEl.innerHTML = "<b>Architecture view.</b> UI → features → API → tables → functions, top to bottom; apps &amp; external services on the rail. Features (◆) are curated vertical slices, not an architectural tier — the Area coupling view shows the feature-first projection. Hover or tap a node to light its connections; high-traffic nodes show edges only then. <span class=\"authdot\"></span>&nbsp;= auth exception — ordinary session auth is stated per endpoint, not drawn.";
    legendEl.hidden = false;
  }

  function viewColumns() {
    const cols = Object.fromEntries(AREAS.map((a) => [a, []]));
    for (const n of bundle.nodes) cols[areaOf(n.data)].push(n.data.id);
    const GAPX = 340, GAPY = 46;
    const pos = {}, colOf = {};
    AREAS.forEach((area, ci) => {
      const ids = cols[area];
      ids.sort((a, b) => {
        const la = layerOf(a) === "rail" ? 4 : layerOf(a);
        const lb = layerOf(b) === "rail" ? 4 : layerOf(b);
        return la - lb || a.localeCompare(b);
      });
      ids.forEach((id, i) => {
        pos[id] = { x: ci * GAPX + (i % 2) * 110, y: Math.floor(i / 2) * GAPY * 2 + (i % 2) * GAPY };
        colOf[id] = ci;
      });
    });
    makeCy([...presetNodes(pos), ...visEdges]);
    cy.nodes().style({ width: 40, height: 40 });
    for (const e of cy.edges()) if (colOf[e.source().id()] !== colOf[e.target().id()]) e.addClass("crossarea");
    markHubEdges();
    addAcrs(13);
    AREAS.forEach((a, ci) => addLaneLabel(a, ci * GAPX - 20, -56));
    fitWithFloor(40, 0.65);
    legendEl.innerHTML = "<b>Area coupling view.</b> One column per product area, each stacked UI → API → tables. Wiring inside an area is assumed (very faint); the darker edges crossing columns are the coupling between areas. <span class=\"authdot\"></span>&nbsp;= auth exception.";
    legendEl.hidden = false;
  }

  // Explorer: no overview at all — one node and its direct connections,
  // click a neighbour to walk. The only view where every edge is traceable
  // by construction.
  let crumbs = [];
  function egoElements(id) {
    const els = [{ data: { ...nodeIndex[id] } }];
    const seen = new Set([id]);
    const edges = [];
    for (const e of visEdges) {
      const { source, target } = e.data;
      if (source !== id && target !== id) continue;
      const other = source === id ? target : source;
      if (!seen.has(other)) { seen.add(other); els.push({ data: { ...nodeIndex[other] } }); }
      edges.push({ data: { ...e.data } });
    }
    return [...els, ...edges];
  }
  function focusNode(id, fromCrumb) {
    if (!fromCrumb) {
      crumbs = crumbs.slice(-7);
      if (crumbs[crumbs.length - 1] !== id) crumbs.push(id);
    }
    makeCy(egoElements(id), { alwaysLabel: true });
    cy.layout({ name: "concentric", concentric: (n) => (n.id() === id ? 2 : 1), levelWidth: () => 1, animate: false, padding: 70, minNodeSpacing: 34 }).run();
    cy.nodes().style({ width: 44, height: 44 });
    cy.$id(id).style({ width: 58, height: 58 });
    addAcrs();
    cy.$id(id).select();
    renderDetail(id);
    indexEl.querySelectorAll(".item").forEach((el) => el.classList.toggle("on", el.dataset.id === id));
    crumbsEl.hidden = false;
    crumbsEl.innerHTML = "Path: " + crumbs.map((c, i) => `<button data-i="${i}">${nodeIndex[c].display}</button>`).join(" › ");
    crumbsEl.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      crumbs = crumbs.slice(0, +b.dataset.i + 1);
      focusNode(crumbs[crumbs.length - 1], true);
    }));
    cy.on("tap", "node", (e) => { if (e.target.id() !== id) focusNode(e.target.id()); });
  }
  function viewExplorer() {
    indexEl.hidden = false;
    const byType = {};
    for (const n of bundle.nodes) (byType[n.data.type] ||= []).push(n.data);
    const listEl = document.getElementById("index-list");
    listEl.innerHTML = Object.keys(byType).sort().map((t) =>
      `<details open><summary>${t} (${byType[t].length})</summary>` +
      byType[t].sort((a, b) => a.display.localeCompare(b.display))
        .map((d) => `<button class="item" data-id="${d.id}">${d.display}</button>`).join("") +
      "</details>").join("");
    listEl.querySelectorAll(".item").forEach((el) => el.addEventListener("click", () => focusNode(el.dataset.id)));
    legendEl.hidden = true;
    crumbs = [];
    // Default focus comes from zdd.config.json via the renderer.
    const focus = bundle.viewer && bundle.viewer.defaultFocus;
    focusNode(focus && nodeIndex[focus] ? focus : bundle.nodes[0].data.id);
  }

  function viewForce() {
    makeCy([...bundle.nodes.map((n) => ({ data: n.data })), ...visEdges], { locked: false });
    markHubEdges();
    const s = 1.6;
    cy.layout({
      name: "cose", animate: false, padding: 30,
      nodeRepulsion: () => 400000 * s * s, idealEdgeLength: () => 45 * s,
      componentSpacing: 40 * s, nodeOverlap: 10, gravity: 1 / s, numIter: 1500,
    }).run();
    cy.nodes().style({ width: 40, height: 40 });
    addAcrs(13);
    fitWithFloor(30, 0.6);
    legendEl.innerHTML = "<b>Force view.</b> Emergent layout — kept as a fallback; the lanes/columns/explorer views are usually more readable.";
    legendEl.hidden = false;
  }

  // GitHub's /tree/ form is for directories; files need /blob/. And GitHub's
  // web UI 404s raw [ ] in blob URLs (Next.js dynamic-route dirs like [id])
  // while accepting the percent-encoded form — parens like (app) are fine
  // raw, so encode only the brackets (DIO-182; verified logged-in: raw → 404,
  // %5Bid%5D → renders). Extension on the last segment = file.
  function githubHref(resource) {
    const base = bundle.repoBase || "";
    const isFile = /\.[A-Za-z0-9]+$/.test(resource.split("/").pop());
    const path = resource.replace(/\[/g, "%5B").replace(/\]/g, "%5D");
    return (isFile ? base.replace("/tree/", "/blob/") : base) + path;
  }

  // ---------- slide-out panels ----------
  // One panel open at a time: node detail or the docs panel (glossary / ADRs).
  const detailEl = document.getElementById("detail");
  const docsEl = document.getElementById("docs");
  const openPanel = (el) => {
    for (const p of [detailEl, docsEl]) p.classList.toggle("open", p === el);
  };
  const closePanels = () => {
    detailEl.classList.remove("open");
    docsEl.classList.remove("open");
  };
  document.getElementById("detail-close").addEventListener("click", () => {
    closePanels();
    if (cy) cy.$("node:selected").unselect();
  });
  document.getElementById("docs-close").addEventListener("click", closePanels);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePanels(); });

  // ---------- docs panel (glossary + ADR corpus, ADR-0021) ----------
  // bundle.docs is a read-only render projection of the glossary (zdd/glossary.md) + zdd/adr/ —
  // single-sourced by render.mjs, proven in sync by `render --check`.
  const ADR_BY_NUM = {};
  for (const a of (bundle.docs && bundle.docs.adrs) || []) ADR_BY_NUM[a.num] = a;
  // Latest store change (DIO-164, ADR-0034): which entries the most recent
  // store-touching push changed — highlighted so a reader sees "what just
  // changed"; the moment someone else merges store-touching commits, the
  // highlight moves to theirs.
  const CHANGED = (bundle.docs && bundle.docs.changed) || { adrs: [], glossaryTerms: [] };
  const CHANGED_ADR = {};
  for (const c of CHANGED.adrs) CHANGED_ADR[c.file] = c.status;
  const CHANGED_TERMS = new Set(CHANGED.glossaryTerms);
  function changedBadge(status) {
    const b = document.createElement("span");
    b.className = "changed-badge";
    b.textContent = status; // "new" | "updated"
    b.title = "Changed in the latest push that touched the glossary or ADRs";
    return b;
  }
  const docsTitle = document.getElementById("docs-title");
  const docsSource = document.getElementById("docs-source");
  const docsBody = document.getElementById("docs-body");
  const docsBack = document.getElementById("docs-back");

  function renderDocMarkdown(md, baseDir, opts = {}) {
    // safeMarked, never marked.parse: store text is source-derived (CR-007).
    docsBody.innerHTML = safeMarked.parse(md || "");
    // Glossary entries are `**Term**: description` paragraphs — promote the
    // defined term to a block title (underlined via .term) so it reads apart
    // from bold cross-references inside descriptions.
    if (opts.terms) {
      docsBody.querySelectorAll("p").forEach((p) => {
        const first = p.firstChild;
        if (!first || first.nodeType !== 1 || first.tagName !== "STRONG") return;
        const next = first.nextSibling;
        if (!next || next.nodeType !== 3 || !next.nodeValue.startsWith(":")) return;
        first.classList.add("term");
        next.nodeValue = next.nodeValue.replace(/^:\s*/, "");
        if (CHANGED_TERMS.has(first.textContent)) {
          p.classList.add("changed-entry");
          first.after(changedBadge("updated"));
        }
      });
    }
    // Relative links inside store bodies: sibling NNNN-*.md ADRs resolve
    // in-page; everything else repo-relative goes to GitHub.
    docsBody.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (!href || /^[a-z]+:/i.test(href) || href.startsWith("#")) {
        if (/^https?:/i.test(href || "")) { a.target = "_blank"; a.rel = "noopener"; }
        return;
      }
      const adrFile = /^(\d{4})-[\w.-]+\.md$/.exec(href);
      if (adrFile && ADR_BY_NUM[adrFile[1]]) {
        a.setAttribute("href", "javascript:void(0)");
        a.addEventListener("click", (e) => { e.preventDefault(); openAdr(adrFile[1]); });
        return;
      }
      // Normalize ../ against the doc's own directory, then link to GitHub.
      const parts = (baseDir + "/" + href).split("/").filter((s) => s !== ".");
      const stack = [];
      for (const p of parts) p === ".." ? stack.pop() : stack.push(p);
      a.setAttribute("href", githubHref(stack.join("/")));
      a.target = "_blank";
      a.rel = "noopener";
    });
    linkifyAdrMentions(docsBody);
    docsEl.scrollTop = 0;
  }

  function openGlossary() {
    docsBack.hidden = true;
    docsTitle.textContent = "Glossary";
    docsSource.textContent = "zdd/glossary.md — the ubiquitous language; rendered from the repo, never edited here";
    renderDocMarkdown(bundle.docs && bundle.docs.glossary, "", { terms: true });
    openPanel(docsEl);
  }
  function openAdrIndex() {
    docsBack.hidden = true;
    docsTitle.textContent = "Architecture Decision Records";
    docsSource.textContent = "zdd/adr/ — full decision record; rendered from the repo, never edited here";
    docsBody.innerHTML = "";
    for (const a of (bundle.docs && bundle.docs.adrs) || []) {
      const btn = document.createElement("button");
      btn.className = "adr-item";
      const strong = document.createElement("b");
      strong.textContent = `ADR-${a.num}`;
      btn.appendChild(strong);
      if (CHANGED_ADR[a.file]) {
        btn.classList.add("changed-entry");
        btn.appendChild(changedBadge(CHANGED_ADR[a.file]));
      }
      const span = document.createElement("span");
      span.className = "muted";
      span.textContent = a.title;
      btn.appendChild(span);
      btn.addEventListener("click", () => openAdr(a.num));
      docsBody.appendChild(btn);
    }
    docsEl.scrollTop = 0;
    openPanel(docsEl);
  }
  function openAdr(num) {
    const a = ADR_BY_NUM[num];
    if (!a) return;
    docsBack.hidden = false;
    docsTitle.textContent = `ADR-${a.num}`;
    docsSource.textContent = `zdd/adr/${a.file}`;
    renderDocMarkdown(a.body, "zdd/adr");
    openPanel(docsEl);
  }
  docsBack.addEventListener("click", openAdrIndex);
  document.getElementById("btn-glossary").addEventListener("click", openGlossary);
  document.getElementById("btn-adrs").addEventListener("click", openAdrIndex);

  // Bare ADR-NNNN citations in any rendered markdown become in-page links —
  // the 15 formerly-dead references this panel exists to resurrect. Text-node
  // walk; code/pre and existing anchors are left alone.
  function linkifyAdrMentions(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement.closest("code, pre, a")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    const targets = [];
    while (walker.nextNode()) {
      if (/ADR-\d{4}/.test(walker.currentNode.nodeValue)) targets.push(walker.currentNode);
    }
    for (const node of targets) {
      const frag = document.createDocumentFragment();
      let rest = node.nodeValue;
      let m;
      while ((m = /ADR-(\d{4})/.exec(rest))) {
        frag.appendChild(document.createTextNode(rest.slice(0, m.index)));
        if (ADR_BY_NUM[m[1]]) {
          const a = document.createElement("a");
          a.className = "internal";
          a.textContent = m[0];
          a.href = "javascript:void(0)";
          const num = m[1];
          a.addEventListener("click", (e) => { e.preventDefault(); openAdr(num); });
          frag.appendChild(a);
        } else {
          frag.appendChild(document.createTextNode(m[0]));
        }
        rest = rest.slice(m.index + m[0].length);
      }
      frag.appendChild(document.createTextNode(rest));
      node.parentNode.replaceChild(frag, node);
    }
  }

  // ---------- detail panel ----------
  function renderDetail(conceptId) {
    const data = nodeIndex[conceptId];
    if (!data) return;
    document.getElementById("detail-content").hidden = false;
    openPanel(detailEl);
    detailEl.scrollTop = 0;

    const chip = document.getElementById("detail-type");
    chip.textContent = data.type;
    chip.style.background = themedColor(data);
    document.getElementById("detail-title").textContent = data.label;
    document.getElementById("detail-id").textContent = conceptId;
    document.getElementById("detail-description").textContent = data.description || "—";

    const authEl = document.getElementById("detail-auth");
    const am = authMode[conceptId];
    if (!am) { authEl.hidden = true; }
    else {
      authEl.hidden = false;
      authEl.className = "auth-note" + (AUTH_LABELS[am] ? " auth-exception" : "");
      authEl.innerHTML =
        am === "session" ? "🔒 Session auth (middleware) — the norm; stated here rather than drawn as an edge." :
        am === "is-auth" ? "This <em>is</em> the auth endpoint." :
        `<span class="authdot"></span> <b>Auth exception:</b> ${AUTH_LABELS[am]} — not behind the session middleware.`;
    }

    const resourceEl = document.getElementById("detail-resource");
    resourceEl.innerHTML = "";
    if (data.resource) {
      const a = document.createElement("a");
      a.href = githubHref(data.resource);
      a.textContent = data.resource;
      a.title = "Open the source on GitHub";
      a.target = "_blank";
      a.rel = "noopener";
      a.className = "external";
      resourceEl.appendChild(a);
    } else resourceEl.textContent = "—";

    const tagsEl = document.getElementById("detail-tags");
    tagsEl.innerHTML = "";
    if (data.tags && data.tags.length) {
      for (const t of data.tags) {
        const span = document.createElement("span");
        span.className = "tag";
        span.textContent = t;
        tagsEl.appendChild(span);
      }
    } else tagsEl.textContent = "—";

    const bodyEl = document.getElementById("detail-body");
    bodyEl.innerHTML = safeMarked.parse(bundle.bodies[conceptId] || "");
    rewriteInternalLinks(bodyEl);
    linkifyAdrMentions(bodyEl);

    const bl = backlinks[conceptId] || [];
    const blSection = document.getElementById("detail-backlinks");
    const blList = document.getElementById("backlinks-list");
    blList.innerHTML = "";
    blSection.hidden = !bl.length;
    for (const src of bl) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.textContent = nodeIndex[src]?.display || src;
      a.addEventListener("click", () => reveal(src));
      li.appendChild(a);
      const muted = document.createElement("span");
      muted.className = "muted";
      muted.textContent = ` (${src})`;
      li.appendChild(muted);
      blList.appendChild(li);
    }
  }

  function rewriteInternalLinks(root) {
    root.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (!href) return;
      const ext = /\.(md|json)$/.exec(href);
      if (href.startsWith("/") && ext) {
        const target = href.slice(1, -ext[0].length);
        if (nodeIndex[target]) {
          a.className = "internal";
          a.setAttribute("href", "javascript:void(0)");
          a.addEventListener("click", (e) => { e.preventDefault(); reveal(target); });
          return;
        }
      }
      a.className = "external";
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener");
    });
  }

  // Bring a concept into view in whatever the current view is.
  function reveal(id) {
    if (currentView === "explorer") { focusNode(id); return; }
    renderDetail(id);
    const n = cy.$id(id);
    if (n.length) {
      cy.$("node:selected").unselect();
      n.select();
      cy.animate({ center: { eles: n }, zoom: Math.max(cy.zoom(), 0.8) }, { duration: 200 });
    }
  }

  // ---------- header controls & view routing ----------
  const VIEWS = { lanes: viewLanes, columns: viewColumns, explorer: viewExplorer, force: viewForce };
  let currentView = null;

  const zoomSlider = document.getElementById("zoom");
  const sliderToZoom = (v) => 0.05 * Math.pow(100, v);
  const zoomToSlider = (z) => Math.log(z / 0.05) / Math.log(100);
  function syncZoomSlider() { if (cy) zoomSlider.value = Math.max(0, Math.min(1, zoomToSlider(cy.zoom()))); }
  zoomSlider.addEventListener("input", () => {
    if (!cy) return;
    cy.zoom({ level: sliderToZoom(parseFloat(zoomSlider.value)),
      renderedPosition: { x: graphEl.clientWidth / 2, y: graphEl.clientHeight / 2 } });
  });

  function showView(v) {
    if (!VIEWS[v]) v = "lanes";
    currentView = v;
    indexEl.hidden = true;
    crumbsEl.hidden = true;
    document.getElementById("view").value = v;
    closePanels();
    VIEWS[v]();
    cy.on("zoom", syncZoomSlider);
    syncZoomSlider();
    try { history.replaceState(null, "", "?view=" + v); } catch { /* file:// */ }
  }

  document.getElementById("view").addEventListener("change", (e) => showView(e.target.value));
  document.getElementById("reset").addEventListener("click", () => showView(currentView));
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const next = theme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("wiki-theme", next); } catch {}
    showView(currentView);
  });

  const typeSelect = document.getElementById("filter-type");
  for (const t of bundle.types) {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    typeSelect.appendChild(opt);
  }
  const applyDim = (pred) => {
    cy.nodes().forEach((n) => n.toggleClass("dim", !pred(n)));
    cy.edges().forEach((e) => e.toggleClass("dim", e.source().hasClass("dim") || e.target().hasClass("dim")));
  };
  typeSelect.addEventListener("change", (e) => {
    const t = e.target.value;
    if (currentView === "explorer") return;
    t ? applyDim((n) => n.data("type") === t) : cy.elements().removeClass("dim");
  });
  document.getElementById("search").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (currentView === "explorer") {
      document.querySelectorAll("#index-list .item").forEach((el) => {
        el.style.display = !q || el.textContent.toLowerCase().includes(q) || el.dataset.id.includes(q) ? "block" : "none";
      });
      return;
    }
    q ? applyDim((n) => {
      const d = n.data();
      return ((d.label || "") + " " + d.id + " " + (d.tags || []).join(" ")).toLowerCase().includes(q);
    }) : cy.elements().removeClass("dim");
  });

  showView(new URLSearchParams(location.search).get("view") || "lanes");
})();
