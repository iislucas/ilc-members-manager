/* doc-scripts.js
 *
 * Shared behaviour for every HTML page in docs/: tab panels, sidebar search,
 * smooth anchor scrolling, and scroll-spy highlighting of the current section.
 *
 * Include with <script src="doc-scripts.js"></script> just before </body>.
 * Everything here is defensive about missing elements, so a page can use any
 * subset of the components without extra wiring.
 */

/**
 * Activate one tab panel.
 *
 * Two call styles exist across these documents, so both are accepted:
 *   switchTab('pane-id', buttonEl)   — the canonical form; prefer it in new pages
 *   switchTab(event, 'pane-id')      — used by orders-and-subscriptions.html
 *
 * Likewise two button class names are in use (.tab-button and .tab-btn); both
 * are cleared. Scope is the nearest .tab-container, falling back to the section,
 * so several independent tab groups can share a page.
 */
function switchTab(first, second) {
  const eventFirst = first && typeof first === 'object' && 'target' in first;
  const button = eventFirst ? first.target : second;
  const paneId = eventFirst ? second : first;
  if (!button || !paneId) return;

  const scope =
    button.closest('.tab-container') || button.closest('section') || document;
  scope
    .querySelectorAll('.tab-button, .tab-btn')
    .forEach((el) => el.classList.remove('active'));
  scope.querySelectorAll('.tab-pane').forEach((el) => el.classList.remove('active'));

  button.classList.add('active');
  const pane = document.getElementById(paneId);
  if (pane) pane.classList.add('active');
}

/** Filter the sidebar to links whose text contains the query. */
function filterNav(query) {
  const q = (query || '').toLowerCase().trim();
  document.querySelectorAll('#sidebarNav .nav-link').forEach((link) => {
    link.style.display = link.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const navLinks = () => document.querySelectorAll('#sidebarNav .nav-link');

  // Smooth-scroll in-page anchors. Cross-document links in .doc-switcher are
  // ordinary hrefs and are deliberately left alone.
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
      const targetEl = document.getElementById(anchor.getAttribute('href').slice(1));
      if (!targetEl) return;
      e.preventDefault();
      targetEl.scrollIntoView({ behavior: 'smooth' });
      navLinks().forEach((l) => l.classList.remove('active'));
      anchor.classList.add('active');
    });
  });

  // Scroll-spy: highlight the section currently under the top of the viewport.
  const links = Array.from(navLinks()).filter((l) =>
    (l.getAttribute('href') || '').startsWith('#'),
  );
  const sections = links
    .map((l) => document.getElementById(l.getAttribute('href').slice(1)))
    .filter(Boolean);
  if (!sections.length) return;

  const sync = () => {
    const y = window.scrollY + 120;
    let current = sections[0];
    for (const section of sections) {
      if (section.offsetTop <= y) current = section;
    }
    links.forEach((l) =>
      l.classList.toggle('active', l.getAttribute('href') === '#' + current.id),
    );
  };
  window.addEventListener('scroll', sync, { passive: true });
  sync();
});
