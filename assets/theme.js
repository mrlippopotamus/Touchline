(() => {
  const preference = "mfl-results-theme";
  const root = document.documentElement;
  let toggle;

  function applyTheme(value) {
    const light = value === "light";
    root.dataset.theme = light ? "light" : "dark";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? "#f2f6ef" : "#0d110e");
    if (toggle) {
      const label = light ? "Use dark theme" : "Use light theme";
      toggle.setAttribute("aria-label", label);
      toggle.title = label;
      toggle.firstElementChild.textContent = light ? "☾" : "☀︎";
    }
    document.dispatchEvent(new Event("touchline-themechange"));
  }

  let theme;
  try {
    theme = localStorage.getItem(preference);
  } catch {
    // The theme can still be changed for this visit.
  }
  applyTheme(theme);

  document.addEventListener("DOMContentLoaded", () => {
    toggle = document.querySelector("[data-theme-toggle]");
    applyTheme(root.dataset.theme);
    toggle?.addEventListener("click", () => {
      applyTheme(root.dataset.theme === "light" ? "dark" : "light");
      try {
        localStorage.setItem(preference, root.dataset.theme);
      } catch {
        // The current view already reflects the choice.
      }
    });
  }, { once: true });
  window.addEventListener("storage", event => {
    if (event.key === preference) applyTheme(event.newValue);
  });
})();
