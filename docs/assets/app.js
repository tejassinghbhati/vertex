// Progressive enhancement only: the page reads correctly with this file
// blocked. Four jobs: remember a theme choice, mark the section being read,
// copy an address without selecting it, and draw the workflow diagram from
// whatever the last run actually recorded.

(() => {
  "use strict";

  const root = document.documentElement;
  const STORAGE_KEY = "vertex-theme";

  // Theme -------------------------------------------------------------

  const store = {
    get() {
      try {
        return localStorage.getItem(STORAGE_KEY);
      } catch {
        return null; // Private windows and blocked site data both throw.
      }
    },
    set(value) {
      try {
        localStorage.setItem(STORAGE_KEY, value);
      } catch {
        // A theme that does not persist is better than a page that breaks.
      }
    },
  };

  const systemPrefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
  const toggle = document.getElementById("theme-toggle");

  function activeTheme() {
    return root.getAttribute("data-theme") || (systemPrefersDark() ? "dark" : "light");
  }

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    if (toggle) {
      // The button names what it will do, not what is current.
      toggle.textContent = theme === "dark" ? "Light" : "Dark";
      toggle.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} theme`);
    }
  }

  const stored = store.get();
  if (stored === "dark" || stored === "light") applyTheme(stored);
  else if (toggle) applyTheme(activeTheme());

  if (toggle) {
    toggle.addEventListener("click", () => {
      const next = activeTheme() === "dark" ? "light" : "dark";
      applyTheme(next);
      store.set(next);
    });
  }

  // Current section ---------------------------------------------------

  const links = Array.from(document.querySelectorAll('nav a[href^="#"]'));
  const sections = links.map((link) => document.querySelector(link.getAttribute("href"))).filter(Boolean);

  if (sections.length && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          for (const link of links) {
            link.classList.toggle("current", link.getAttribute("href") === `#${entry.target.id}`);
          }
        }
      },
      // Fire when a section crosses the upper third, which is where a
      // reader's eye sits rather than at the viewport edge.
      { rootMargin: "-20% 0px -70% 0px" },
    );

    for (const section of sections) observer.observe(section);
  }

  // Copy an argument --------------------------------------------------

  for (const target of document.querySelectorAll("[data-copy]")) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy";
    button.textContent = "Copy";
    button.setAttribute("aria-label", `Copy ${target.previousElementSibling?.textContent ?? "value"}`);

    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(target.getAttribute("data-copy") ?? "");
        button.textContent = "Copied";
      } catch {
        button.textContent = "Copy failed";
      }
      setTimeout(() => {
        button.textContent = "Copy";
      }, 1600);
    });

    target.appendChild(button);
  }

  // Workflow diagram ---------------------------------------------------
  //
  // Nodes are real DOM elements; the SVG underneath draws the edges between
  // them. Anchors are measured rather than hardcoded, so the same code works
  // when the grid reflows to one column on a phone.

  const SVG_NS = "http://www.w3.org/2000/svg";
  const grid = document.getElementById("stage-grid");
  const svg = document.getElementById("edges");

  // from, to, and which branch the edge represents.
  const EDGES = [
    { from: "trigger", to: "read", branch: null },
    { from: "read", to: "condition", branch: null },
    { from: "condition", to: "payout", branch: "true" },
    { from: "condition", to: "end", branch: "false" },
  ];

  const WEIGHT = { untravelled: 1.25, travelled: 2.25, moved: 4 };

  let currentState = null;

  function nodeEl(name) {
    return grid ? grid.querySelector(`[data-node="${name}"]`) : null;
  }

  /** Anchor points chosen from the nodes' real positions after layout. */
  function anchors(fromEl, toEl, stageRect) {
    const a = fromEl.getBoundingClientRect();
    const b = toEl.getBoundingClientRect();
    const rel = (rect, x, y) => ({ x: rect.left - stageRect.left + x, y: rect.top - stageRect.top + y });

    // Side by side: leave the right edge, arrive at the left edge.
    if (b.left >= a.right - 4) {
      return [rel(a, a.width, a.height / 2), rel(b, 0, b.height / 2)];
    }
    // Stacked: leave the bottom, arrive at the top.
    if (b.top >= a.bottom - 4) {
      return [rel(a, a.width / 2, a.height), rel(b, b.width / 2, 0)];
    }
    // Anything else (a wrap that puts the target behind the source).
    return [rel(a, a.width / 2, a.height), rel(b, b.width / 2, 0)];
  }

  function edgeLook(edge, state) {
    if (!state || state.branch === "none") {
      return { width: WEIGHT.untravelled, dash: null, opacity: 0.5 };
    }
    // The branch this run did not take stays dashed and faint.
    if (edge.branch && edge.branch !== state.branch) {
      return { width: WEIGHT.untravelled, dash: "5 4", opacity: 0.4 };
    }
    const movedValue = edge.to === "payout" && state.nodes.payout === "fired";
    return {
      width: movedValue ? WEIGHT.moved : WEIGHT.travelled,
      dash: null,
      opacity: movedValue ? 1 : 0.85,
      accent: movedValue,
    };
  }

  function drawEdges() {
    if (!grid || !svg) return;
    const stageRect = grid.parentElement.getBoundingClientRect();
    svg.innerHTML = "";

    for (const edge of EDGES) {
      const fromEl = nodeEl(edge.from);
      const toEl = nodeEl(edge.to);
      if (!fromEl || !toEl) continue;

      const [start, end] = anchors(fromEl, toEl, stageRect);
      const look = edgeLook(edge, currentState);
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", start.x);
      line.setAttribute("y1", start.y);
      line.setAttribute("x2", end.x);
      line.setAttribute("y2", end.y);
      // Custom properties resolve in CSS declarations but not in SVG
      // presentation attributes, so the stroke goes through style.
      line.style.stroke = look.accent ? "var(--accent)" : "var(--muted)";
      line.setAttribute("stroke-width", look.width);
      line.setAttribute("stroke-opacity", look.opacity);
      line.setAttribute("stroke-linecap", "square");
      if (look.dash) line.setAttribute("stroke-dasharray", look.dash);
      svg.appendChild(line);
    }
  }

  function text(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function verdict(id, value, tone) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value;
    el.classList.remove("match", "mismatch");
    if (tone) el.classList.add(tone);
  }

  function shorten(hash) {
    return hash && hash.length > 18 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;
  }

  function applyState(state) {
    currentState = state;

    for (const [name, value] of Object.entries(state.nodes)) {
      const el = nodeEl(name);
      if (el) {
        el.classList.remove("is-ran", "is-fired", "is-skipped", "is-failed");
        if (value !== "idle") el.classList.add(`is-${value}`);
      }
      const label = document.querySelector(`[data-state-for="${name}"]`);
      if (label) label.textContent = value === "fired" ? "moved value" : value;
    }

    const runs = state.runs;
    text(
      "stage-state",
      runs.total === 0
        ? "state: no runs recorded, nothing has executed"
        : `state: ${runs.total} run${runs.total === 1 ? "" : "s"}, ${runs.redemptions} redemption${runs.redemptions === 1 ? "" : "s"}, ${runs.payoutPusd} pUSD moved`,
    );

    text("hash-reviewed", shorten(state.hashes.reviewed) ?? "not authored");
    text("hash-deployed", shorten(state.hashes.deployed) ?? "no deployment");
    if (state.hashes.match === null) verdict("hash-verdict", "unproven", null);
    else verdict("hash-verdict", state.hashes.match ? "match" : "mismatch", state.hashes.match ? "match" : "mismatch");

    const last = state.lastRun;
    text("payout-reported", last?.transactionHash ? "redemption recorded" : "no runs");
    text("payout-onchain", last?.onchainPayoutPusd ? `${last.onchainPayoutPusd} pUSD` : "no runs");
    if (!last || !last.onchainPayoutPusd) verdict("payout-verdict", "unproven", null);
    else verdict("payout-verdict", "read from receipt", "match");

    drawEdges();
  }

  if (grid && svg) {
    drawEdges();

    // state.json sits next to the page. A failure here is normal (opened from
    // disk, or generated before the first run) and leaves the idle diagram up.
    fetch("state.json", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((state) => {
        if (state && state.nodes && state.runs) applyState(state);
      })
      .catch(() => {});

    if ("ResizeObserver" in window) new ResizeObserver(drawEdges).observe(grid);
    window.addEventListener("resize", drawEdges);
    // Web fonts land after first paint and change node heights under the edges.
    if (document.fonts?.ready) document.fonts.ready.then(drawEdges);
  }
})();
