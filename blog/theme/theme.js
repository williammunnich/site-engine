/**
 * @file theme.js
 * Light/dark switch for the blog pages. It follows the system setting until the reader presses the
 * header button, then remembers their pick in this browser. Copied into the blog output folder and
 * loaded by every page that lib/templates.mjs lays out.
 *
 * Project: site-engine
 * @author Claude (Anthropic), written for and prompted by William Munnich
 * @date Last edited 2026-11-12
 */
(function () {
  var root = document.documentElement, KEY = "blog-theme";
  /**
   * Reads the saved theme from this browser's storage.
   * @returns {string|null} "light", "dark", or null when nothing is saved or storage is blocked.
   */
  function get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  /**
   * Saves the reader's theme pick; a blocked storage is ignored.
   * @param {string} v - "light" or "dark".
   */
  function set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  /**
   * Puts the theme class on the root element, or removes both classes so the system setting decides.
   * @param {string|null} v - "light", "dark", or anything else for "follow the system".
   */
  function apply(v) { root.classList.remove("theme-light", "theme-dark"); if (v === "light" || v === "dark") root.classList.add("theme-" + v); }
  var q = /[?&]theme=(light|dark)\b/.exec(location.search);   // ?theme=dark previews a theme without saving it
  apply(q ? q[1] : get());
  document.addEventListener("DOMContentLoaded", function () {
    var b = document.querySelector(".theme-toggle");
    if (!b) return;
    b.addEventListener("click", function () {
      var dark = root.classList.contains("theme-dark") ||
        (!root.classList.contains("theme-light") && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
      var next = dark ? "light" : "dark"; apply(next); set(next);
    });
  });
})();
