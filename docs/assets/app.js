// Progressive enhancement only: the page reads correctly with this file
// blocked. Three jobs, in order of usefulness: remember a theme choice,
// mark the section being read, and copy an address without selecting it.

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
    const stamped = root.getAttribute("data-theme");
    if (stamped) return stamped;
    return systemPrefersDark() ? "dark" : "light";
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
  const sections = links
    .map((link) => document.querySelector(link.getAttribute("href")))
    .filter(Boolean);

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
      const value = target.getAttribute("data-copy") ?? "";
      try {
        await navigator.clipboard.writeText(value);
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
})();
