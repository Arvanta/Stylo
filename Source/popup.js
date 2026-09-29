'use strict';

const $ = id => document.getElementById(id);

let host = '';
let pageUrl = '';
let state = { enabled: true, styles: [], theme: 'auto' };

// Share the exact domain, URL-prefix, and guarded-regex rules with content.js.
function matches(style, url) {
  return StyloMatch.matches(style, url);
}

const esc = x => String(x).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const notifyApply = () => browser.runtime.sendMessage({ type: 'apply' }).catch(() => {});

function applyTheme(t) {
  const light = matchMedia('(prefers-color-scheme: light)').matches;
  document.body.classList.toggle('light', t === 'light' || (t === 'auto' && light));
  document.body.classList.toggle('dark', t === 'dark' || (t === 'auto' && !light));
}

function render() {
  const list = pageUrl ? state.styles.filter(s => matches(s, pageUrl)) : [];
  const active = list.filter(s => s.enabled).length;

  $('master').checked = state.enabled;
  $('power').title = state.enabled ? 'Turn Stylo off' : 'Turn Stylo on';
  $('content').classList.toggle('off', !state.enabled);

  $('site-host').textContent = host || 'This page';
  $('site-mark').textContent = (host || '?').replace(/^www\./, '').charAt(0).toUpperCase();
  const status = $('site-status');
  status.className = '';
  if (!state.enabled) status.textContent = 'Stylo is off';
  else if (!host) status.textContent = 'Can’t be styled';
  else if (!list.length) status.textContent = 'No styles yet';
  else {
    status.textContent = `${active} of ${list.length} ${list.length === 1 ? 'style' : 'styles'} active`;
    if (active) status.className = 'live';
  }

  if (list.length) {
    $('styles').innerHTML = list
      .map(s => `<div class="style-row"><div class="style-info"><b>${esc(s.name)}</b><small>${esc((s.matchType || 'domain'))}: ${esc(s.target)}</small></div><button class="edit-style" type="button" data-edit-id="${esc(s.id)}" data-target="${esc(s.target)}" title="Edit in manager" aria-label="Edit ${esc(s.name || s.target)}"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/><path d="m15 5 4 4"/></svg></button><label class="mini"><input type="checkbox" ${s.enabled ? 'checked' : ''} data-id="${esc(s.id)}" aria-label="Enable ${esc(s.name)}"><span></span></label></div>`)
      .join('');
  } else {
    $('styles').innerHTML = host
      ? `<button class="add-site" id="add"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>Add CSS for ${esc(host)}</button>`
      : '';
  }
}

async function init() {
  state = await Store.get();
  applyTheme(state.theme);

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  pageUrl = tab?.url || '';
  try {
    const u = new URL(pageUrl);
    if (u.protocol === 'http:' || u.protocol === 'https:') host = u.hostname;
  } catch {}
  if (!host) pageUrl = '';

  render();
  requestAnimationFrame(() => document.body.classList.add('ready'));

  $('master').onchange = async () => {
    state.enabled = $('master').checked;
    render();
    await Store.update('enabled', () => state.enabled);
    notifyApply();
  };

  $('open-panel').onclick = async () => {
    await browser.runtime.sendMessage({ type: 'open-manager' });
    window.close();
  };

  $('styles').addEventListener('change', async e => {
    const id = e.target.dataset.id;
    if (id == null) return;
    const on = e.target.checked;
    state.styles = await Store.update('styles', cur => cur.map(s => (String(s.id) === id ? { ...s, enabled: on } : s)));
    render();
    notifyApply();
  });

  $('styles').addEventListener('click', async e => {
    const edit = e.target.closest('[data-edit-id]');
    if (edit) {
      const style = state.styles.find(s => String(s.id) === edit.dataset.editId);
      if (!style) return;
      await browser.runtime.sendMessage({
        type: 'open-manager',
        domain: style.target,
        styleId: String(style.id)
      });
      window.close();
      return;
    }
    if (!e.target.closest('#add')) return;
    // The manager creates the style itself, so it can first ask about unsaved edits.
    await browser.runtime.sendMessage({ type: 'open-manager', add: host });
    window.close();
  });
}

init();
