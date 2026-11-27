/*
 * Appearance: Auto (follows the computer), Light or Dark.
 * A classic script loaded in <head>, so the chosen appearance is set before the first paint (no flash).
 * The page reads window.deaTheme to show and change the setting.
 */
(() => {
  const root = document.documentElement;
  const media = matchMedia('(prefers-color-scheme: dark)');
  const read = () => {
    try { const v = JSON.parse(localStorage.getItem('dea-theme')); return ['auto', 'light', 'dark'].includes(v) ? v : 'auto'; } catch { return 'auto'; }
  };
  const apply = () => {
    const pref = read();
    const dark = pref === 'dark' || (pref === 'auto' && media.matches);
    root.dataset.theme = dark ? 'dark' : 'light';
    root.dataset.themePref = pref;
    root.style.colorScheme = dark ? 'dark' : 'light';
    for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.content = dark ? '#161618' : '#faf8f6';
  };
  apply();
  media.addEventListener('change', apply);
  // The sidebar, if hidden last time, starts hidden: set here, before the first paint, so it never flashes in.
  try { if (JSON.parse(localStorage.getItem('dea-side-hidden')) === true) root.dataset.side = 'hidden'; } catch { /* shown */ }
  window.deaTheme = {
    get: read,
    set(pref) {
      try { localStorage.setItem('dea-theme', JSON.stringify(pref)); } catch { /* private mode: this visit only */ }
      apply();
    },
  };
})();
