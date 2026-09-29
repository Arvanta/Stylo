'use strict';

(() => {
  let styleNode = null;
  let storedData = { enabled: true, styles: [], globalCss: '' };

  function load() {
    return browser.storage.local
      .get({ enabled: true, styles: [], globalCss: '' })
      .then(data => {
        storedData = data;
        render(data, location.href);
      })
      .catch(() => {});
  }

  function render(data, url) {
    if (styleNode) {
      styleNode.remove();
      styleNode = null;
    }
    if (!data || !data.enabled) return;

    let css = typeof data.globalCss === 'string' ? data.globalCss : '';
    const styles = Array.isArray(data.styles) ? data.styles : [];

    for (const style of styles) {
      if (!style || !style.enabled || !StyloMatch.matches(style, url)) continue;
      let rules = typeof style.css === 'string' ? style.css : '';
      const variables = Array.isArray(style.variables) ? style.variables : [];
      for (const variable of variables) {
        if (!variable || typeof variable.token !== 'string' || !variable.token) continue;
        rules = rules.split(variable.token).join(String(variable.value ?? ''));
      }
      const label = String(style.name || '').replace(/\*\//g, '* /').replace(/[\r\n]/g, ' ');
      css += `\n/* ${label} */\n${rules}`;
    }

    if (!css) return;
    styleNode = document.createElement('style');
    styleNode.id = 'stylo-live';
    styleNode.textContent = css;
    (document.head || document.documentElement).appendChild(styleNode);
  }

  browser.runtime.onMessage.addListener(message => {
    if (!message) return;
    if (message.type === 'refresh') {
      storedData = message.data || storedData;
      render(storedData, location.href);
    } else if (message.type === 'url-change') {
      render(storedData, message.url || location.href);
    }
  });

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') load();
  });

  // webNavigation handles pushState/replaceState; these cover history traversal
  // and fragments even in cases where the browser emits only a DOM event.
  window.addEventListener('popstate', () => render(storedData, location.href));
  window.addEventListener('hashchange', () => render(storedData, location.href));

  load();
})();
