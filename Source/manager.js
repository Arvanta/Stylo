'use strict';

const $ = id => document.getElementById(id);

let data = { ...Store.DEFAULTS };
let selectedDomain = '';
let view = 'global'; // 'cards' | 'global'
let myTabId = null;
const drafts = Object.create(null); // style id -> unsaved fields, including variables

/* ---------- helpers ---------- */

const esc = x => String(x).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const styleById = id => data.styles.find(s => s && String(s.id) === String(id));
const fieldsOf = s => ({
  name: typeof s.name === 'string' ? s.name : '',
  css: typeof s.css === 'string' ? s.css : '',
  target: typeof s.target === 'string' ? s.target : '',
  matchType: ['domain', 'prefix', 'regex'].includes(s.matchType) ? s.matchType : 'domain',
  variables: Array.isArray(s.variables)
    ? s.variables.filter(v => v && typeof v === 'object').map(v => ({ token: String(v.token ?? ''), value: String(v.value ?? '') }))
    : []
});
const cardEl = id => document.querySelector(`.card[data-id="${CSS.escape(String(id))}"]`);
const newStyleId = styles => {
  const used = new Set(styles.filter(Boolean).map(s => String(s.id)));
  let id = Date.now();
  while (used.has(String(id))) id += 1;
  return id;
};

const BACKUP_LIMITS = Object.freeze({
  fileBytes: 4 * 1024 * 1024,
  jsonChars: 4 * 1024 * 1024,
  styles: 1000,
  styleText: 3 * 1024 * 1024,
  styleName: 200,
  styleCss: 500000,
  globalCss: 1500000,
  variables: 100,
  variableToken: 500,
  variableValue: 5000
});

function normalizeBackup(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
    throw new Error('The backup must be a JSON object.');
  }
  const json = JSON.stringify(backup);
  if (!Array.isArray(backup.styles)) throw new Error('The backup does not contain a styles array.');
  if (backup.styles.length > BACKUP_LIMITS.styles || json.length > BACKUP_LIMITS.jsonChars) {
    throw new Error('The backup is too large.');
  }

  const ids = new Set();
  let textSize = 0;
  const styles = backup.styles.map((style, index) => {
    if (!style || typeof style !== 'object' || Array.isArray(style)) {
      throw new Error(`Style ${index + 1} is not a valid object.`);
    }

    let id = style.id;
    if (typeof id === 'number') {
      if (!Number.isSafeInteger(id) || id < 1) throw new Error(`Style ${index + 1} has an invalid ID.`);
    } else if (typeof id === 'string') {
      id = id.trim();
      if (!id || id.length > 128 || /[\u0000-\u001f\u007f]/.test(id)) {
        throw new Error(`Style ${index + 1} has an invalid ID.`);
      }
    } else {
      throw new Error(`Style ${index + 1} has an invalid ID.`);
    }
    const idKey = String(id);
    if (ids.has(idKey)) throw new Error(`Duplicate style ID: ${idKey}`);
    ids.add(idKey);

    const name = style.name === undefined ? '' : style.name;
    const enabled = style.enabled === undefined ? true : style.enabled;
    const matchType = style.matchType === undefined ? 'domain' : style.matchType;
    const rawTarget = style.target;
    const css = style.css === undefined ? '' : style.css;
    if (typeof name !== 'string' || name.length > BACKUP_LIMITS.styleName) throw new Error(`Style ${index + 1} has an invalid name.`);
    if (typeof enabled !== 'boolean') throw new Error(`Style ${index + 1} has an invalid enabled value.`);
    if (!['domain', 'prefix', 'regex'].includes(matchType)) throw new Error(`Style ${index + 1} has an invalid match type.`);
    if (typeof rawTarget !== 'string') throw new Error(`Style ${index + 1} is missing its target.`);
    if (typeof css !== 'string' || css.length > BACKUP_LIMITS.styleCss) throw new Error(`Style ${index + 1} has invalid or oversized CSS.`);

    let target;
    try { target = StyloMatch.validateTarget(matchType, rawTarget); }
    catch (error) { throw new Error(`Style ${index + 1}: ${error.message}`); }

    const rawVariables = style.variables === undefined ? [] : style.variables;
    if (!Array.isArray(rawVariables) || rawVariables.length > BACKUP_LIMITS.variables) {
      throw new Error(`Style ${index + 1} has an invalid variables list.`);
    }
    const tokens = new Set();
    const variables = rawVariables.map((variable, variableIndex) => {
      if (!variable || typeof variable !== 'object' || Array.isArray(variable) ||
          typeof variable.token !== 'string' || typeof variable.value !== 'string') {
        throw new Error(`Style ${index + 1}, variable ${variableIndex + 1} is invalid.`);
      }
      const token = variable.token.trim();
      if (!token || token.length > BACKUP_LIMITS.variableToken || variable.value.length > BACKUP_LIMITS.variableValue) {
        throw new Error(`Style ${index + 1}, variable ${variableIndex + 1} is too long or empty.`);
      }
      if (tokens.has(token)) throw new Error(`Style ${index + 1} contains a duplicate variable token.`);
      tokens.add(token);
      textSize += token.length + variable.value.length;
      return { token, value: variable.value };
    });

    const normalizedName = name.trim() || target.slice(0, BACKUP_LIMITS.styleName);
    textSize += normalizedName.length + target.length + css.length;
    if (textSize > BACKUP_LIMITS.styleText) throw new Error('The backup contains too much style text.');
    return {
      id,
      name: normalizedName,
      enabled,
      matchType,
      target,
      css,
      variables
    };
  });

  const values = { styles };
  if (backup.globalCss !== undefined) {
    if (typeof backup.globalCss !== 'string' || backup.globalCss.length > BACKUP_LIMITS.globalCss) {
      throw new Error('The backup has invalid or oversized global CSS.');
    }
    values.globalCss = backup.globalCss;
  }
  if (backup.enabled !== undefined) {
    if (typeof backup.enabled !== 'boolean') throw new Error('The backup has an invalid global enabled value.');
    values.enabled = backup.enabled;
  }
  if (backup.theme !== undefined) {
    if (!['auto', 'dark', 'light'].includes(backup.theme)) throw new Error('The backup has an invalid theme.');
    values.theme = backup.theme;
  }
  return values;
}


function backupInput(values) {
  return {
    styles: Array.isArray(values.styles) ? values.styles : [],
    globalCss: typeof values.globalCss === 'string' ? values.globalCss : '',
    enabled: typeof values.enabled === 'boolean' ? values.enabled : true,
    theme: ['auto', 'dark', 'light'].includes(values.theme) ? values.theme : 'auto'
  };
}

function backupExportContent(values) {
  const backup = normalizeBackup(backupInput(values));
  const content = JSON.stringify(backup, null, 2);
  if (new Blob([content]).size > BACKUP_LIMITS.fileBytes) {
    throw new Error('This backup would exceed the maximum import file size. Reduce the saved CSS and try again.');
  }
  return content;
}

function backupMetrics(styles, globalCss, enabled, theme) {
  const raw = { styles, globalCss, enabled, theme };
  let backup = raw;
  try { backup = normalizeBackup(raw); } catch {}

  let styleText = 0;
  const list = Array.isArray(backup.styles) ? backup.styles : (Array.isArray(styles) ? styles : []);
  for (const style of list) {
    if (!style || typeof style !== 'object') continue;
    const name = typeof style.name === 'string' ? style.name : '';
    const target = typeof style.target === 'string' ? style.target : '';
    const css = typeof style.css === 'string' ? style.css : '';
    styleText += name.length + target.length + css.length;
    if (Array.isArray(style.variables)) {
      for (const variable of style.variables) {
        if (!variable || typeof variable !== 'object') continue;
        styleText += String(variable.token ?? '').trim().length + String(variable.value ?? '').length;
      }
    }
  }

  const compact = JSON.stringify(backup);
  const pretty = JSON.stringify(backup, null, 2);
  return {
    styles: Array.isArray(styles) ? styles.length : 0,
    styleText,
    globalCss: typeof globalCss === 'string' ? globalCss.length : 0,
    jsonChars: compact.length,
    exportBytes: new Blob([pretty]).size
  };
}

// Permit an existing over-limit profile to be reduced incrementally, but do
// not let any edit make a breached backup-size limit worse.
function backupSizeError(styles, globalCss, enabled, theme, previousStyles, previousGlobalCss, previousEnabled, previousTheme) {
  const after = backupMetrics(styles, globalCss, enabled, theme);
  const before = Array.isArray(previousStyles)
    ? backupMetrics(previousStyles, previousGlobalCss, previousEnabled, previousTheme)
    : null;
  const checks = [
    ['styles', BACKUP_LIMITS.styles, 'A backup can contain at most 1,000 styles.'],
    ['styleText', BACKUP_LIMITS.styleText, 'The combined style text exceeds the backup limit. Reduce CSS or variables.'],
    ['globalCss', BACKUP_LIMITS.globalCss, 'Global CSS exceeds the backup limit. Reduce it before saving.'],
    ['jsonChars', BACKUP_LIMITS.jsonChars, 'The backup data exceeds the import limit. Reduce the saved content.'],
    ['exportBytes', BACKUP_LIMITS.fileBytes, 'The exported backup would exceed the import file-size limit. Reduce the saved content.']
  ];
  for (const [key, limit, message] of checks) {
    if (after[key] > limit && (!before || after[key] > before[key])) return message;
  }
  return '';
}

function applyTheme(t) {
  document.body.classList.toggle('light', t === 'light' || (t === 'auto' && matchMedia('(prefers-color-scheme: light)').matches));
}

function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Content scripts react to storage.onChanged; the manager must not send an
// active-tab refresh because the active tab is usually this manager page.

/* ---------- dialogs (always resolve, even when closed with Esc) ---------- */

function openDialog(d) {
  return new Promise(resolve => {
    d.returnValue = '';
    d.addEventListener('close', () => resolve(d.returnValue), { once: true });
    d.showModal();
  });
}

async function askInput(title, message, value) {
  const d = $('input-dialog');
  $('input-title').textContent = title;
  $('input-message').textContent = message;
  $('domain-input').style.display = 'block';
  $('domain-input').value = value;
  $('cancel-input').style.display = 'inline-block';
  $('confirm-input').textContent = 'Continue';
  const r = openDialog(d);
  $('domain-input').focus();
  $('domain-input').select();
  const result = await r;
  return result.startsWith('ok:') ? result.slice(3) : '';
}

async function askNotice(title, message) {
  const d = $('input-dialog');
  $('input-title').textContent = title;
  $('input-message').textContent = message;
  $('domain-input').style.display = 'none';
  $('cancel-input').style.display = 'none';
  $('confirm-input').textContent = 'OK';
  await openDialog(d);
}

async function askConfirm() {
  return (await openDialog($('confirm-dialog'))) === 'yes';
}

// Resolves to 'save' | 'discard' | '' (cancel)
function askUnsaved(message) {
  $('unsaved-message').textContent = message;
  return openDialog($('unsaved-dialog'));
}

/* ---------- unsaved-changes tracking ---------- */

function draftDiffers(id) {
  const d = drafts[id], s = styleById(id);
  if (!d || !s) return false;
  const base = fieldsOf(s);
  return Object.keys(base).some(k => Array.isArray(base[k])
    ? JSON.stringify(base[k]) !== JSON.stringify(d[k])
    : base[k] !== d[k]);
}

function dirtyIds() {
  return Object.keys(drafts).filter(id => {
    if (draftDiffers(id)) return true;
    delete drafts[id];
    return false;
  });
}

const globalDirty = () => $('global-css').value !== (data.globalCss || '');

function readDraft(id) {
  const card = cardEl(id);
  if (!card) return;
  drafts[id] = {
    name: card.querySelector('[data-name]').value,
    css: card.querySelector('[data-css]').value,
    target: card.querySelector('[data-target]').value,
    matchType: card.querySelector('[data-match]').value,
    variables: Array.from(card.querySelectorAll('.variable-row')).map(row => ({
      token: row.querySelector('[data-var-token]').value,
      value: row.querySelector('[data-var-value]').value
    }))
  };
  if (!draftDiffers(id)) delete drafts[id];
  card.classList.toggle('dirty', !!drafts[id]);
  card.querySelector('[data-error]').textContent = '';
}

function validate(f, original = null) {
  try {
    f.target = StyloMatch.validateTarget(f.matchType, f.target);
  } catch (error) {
    return error.message || 'Enter a valid matching target.';
  }

  f.name = String(f.name ?? '').trim() || f.target.slice(0, BACKUP_LIMITS.styleName);
  f.css = String(f.css ?? '');
  const oldName = typeof original?.name === 'string' ? original.name : '';
  const oldCss = typeof original?.css === 'string' ? original.css : '';
  if (f.name.length > BACKUP_LIMITS.styleName && f.name.length >= oldName.length) {
    return `Style names can be at most ${BACKUP_LIMITS.styleName} characters.`;
  }
  if (f.css.length > BACKUP_LIMITS.styleCss && f.css.length >= oldCss.length) {
    return `CSS can be at most ${BACKUP_LIMITS.styleCss.toLocaleString()} characters per style.`;
  }

  const variables = Array.isArray(f.variables) ? f.variables : [];
  const seen = new Set();
  for (const variable of variables) {
    const token = String(variable.token || '').trim();
    const value = String(variable.value ?? '');
    if (!token) return 'Each variable needs a non-empty token.';
    if (token.length > BACKUP_LIMITS.variableToken || value.length > BACKUP_LIMITS.variableValue) {
      return 'A variable is too long.';
    }
    if (seen.has(token)) return `The variable token “${token}” is repeated.`;
    seen.add(token);
    variable.token = token;
    variable.value = value;
  }
  if (variables.length > BACKUP_LIMITS.variables) return `A style can have at most ${BACKUP_LIMITS.variables} variables.`;
  f.variables = variables;
  return '';
}

/* ---------- writing (always re-read fresh data, touch one key) ---------- */

async function commitStyles(fn) {
  data.styles = await Store.update('styles', fn);
}

async function saveDrafts(ids) {
  const patch = Object.create(null);
  let bad = false;
  let hasChanges = false;
  for (const id of ids) {
    const style = styleById(id);
    if (!style) continue;
    const source = drafts[id] || fieldsOf(style);
    const f = {
      ...source,
      target: String(source.target ?? '').trim(),
      variables: Array.isArray(source.variables) ? source.variables.map(v => ({ ...v })) : []
    };
    f.name = String(f.name || '').trim() || f.target.slice(0, BACKUP_LIMITS.styleName);
    const err = validate(f, fieldsOf(style));
    if (err) {
      const box = cardEl(id)?.querySelector('[data-error]');
      if (box) box.textContent = err;
      bad = true;
    }
    if (draftDiffers(id)) hasChanges = true;
    patch[id] = f;
  }
  if (bad) return false;
  // A click on Save also validates unchanged/legacy values, but should not
  // create a storage write if the style is already valid and clean.
  if (!hasChanges) return true;

  // Remember where the selected domain's style went if its target changed.
  let movedTo = '';
  for (const id of ids) {
    const s = styleById(id);
    if (s && s.target === selectedDomain && patch[id].target !== s.target) movedTo = patch[id].target;
  }

  try {
    await commitStyles(styles => {
      const next = styles.map(s => (s && patch[String(s.id)] ? { ...s, ...patch[String(s.id)] } : s));
      const sizeError = backupSizeError(
        next, data.globalCss || '', data.enabled, data.theme,
        styles, data.globalCss || '', data.enabled, data.theme
      );
      if (sizeError) throw new Error(sizeError);
      return next;
    });
  } catch (error) {
    const box = cardEl(ids[0])?.querySelector('[data-error]');
    if (box) box.textContent = error.message || 'Could not save this style.';
    return false;
  }
  ids.forEach(id => delete drafts[id]);
  if (movedTo && !data.styles.some(s => s && s.target === selectedDomain)) selectedDomain = movedTo;
  drawDomains();
  draw();
  return true;
}

async function saveGlobal() {
  const value = $('global-css').value;
  try {
    await Store.update('globalCss', current => {
      const previous = typeof current === 'string' ? current : '';
      if (value.length > BACKUP_LIMITS.globalCss && value.length >= previous.length) {
        throw new Error(`Global CSS can be at most ${BACKUP_LIMITS.globalCss.toLocaleString()} characters.`);
      }
      const sizeError = backupSizeError(
        data.styles, value, data.enabled, data.theme,
        data.styles, previous, data.enabled, data.theme
      );
      if (sizeError) throw new Error(sizeError);
      return value;
    });
    data.globalCss = value;
    $('global-error').textContent = '';
    return true;
  } catch (error) {
    $('global-error').textContent = error.message || 'Could not save Global CSS.';
    return false;
  }
}

/* Ask before leaving the current editing context. true = safe to continue. */
async function guardLeave() {
  const ids = dirtyIds();
  const gd = globalDirty();
  if (!ids.length && !gd) return true;

  const parts = [];
  if (ids.length === 1) {
    const s = styleById(ids[0]) || {};
    parts.push(`the style “${(drafts[ids[0]].name || s.name || s.target || ids[0])}”`);
  } else if (ids.length > 1) {
    parts.push(`${ids.length} styles`);
  }
  if (gd) parts.push('Global CSS');
  const answer = await askUnsaved(`You have unsaved changes in ${parts.join(' and ')}. Do you want to save them?`);

  if (answer === 'save') {
    if (ids.length && !(await saveDrafts(ids))) return false;
    if (gd && !(await saveGlobal())) return false;
    return true;
  }
  if (answer === 'discard') {
    ids.forEach(id => delete drafts[id]);
    $('global-css').value = data.globalCss || '';
    if (view === 'cards') draw();
    return true;
  }
  return false;
}

/* ---------- views ---------- */

function setView(v) {
  view = v;
  $('cards').classList.toggle('hidden', v !== 'cards');
  $('global-panel').classList.toggle('hidden', v !== 'global');
  $('nav-global').classList.toggle('active', v === 'global');
  $('nav-global').setAttribute('aria-current', v === 'global' ? 'page' : 'false');
}

function focusStyle(id) {
  if (id == null || id === '') return;
  const card = cardEl(id);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.querySelector('[data-css]')?.focus({ preventScroll: true });
}

async function selectDomain(domain, focusId = '') {
  let requested = String(domain ?? '').trim();
  if (!requested) return;
  const savedTarget = data.styles.some(s => s && typeof s.target === 'string' && s.target === requested);
  if (!savedTarget) {
    try { requested = StyloMatch.validateTarget('domain', requested); }
    catch (error) { await askNotice('Invalid domain', error.message); return; }
  }
  if (view === 'cards' && requested === selectedDomain) {
    focusStyle(focusId);
    return;
  }
  if (!(await guardLeave())) return;
  selectedDomain = requested;
  $('search').value = '';
  setView('cards');
  drawDomains();
  draw();
  focusStyle(focusId);
}

async function selectStyleById(id, fallbackTarget = '') {
  const style = styleById(id);
  const target = typeof style?.target === 'string' ? style.target : fallbackTarget;
  if (target) await selectDomain(target, id);
}

async function showGlobal() {
  if (view === 'global') return;
  if (!(await guardLeave())) return;
  setView('global');
  drawDomains();
}

function clearSearch() {
  $('search').value = '';
  drawDomains();
}

/* Create a style for `target` (or select the existing one) and show it. */
async function addStyleFor(target) {
  try { target = StyloMatch.validateTarget('domain', target); }
  catch (error) { await askNotice('Invalid domain', error.message); return null; }
  let created = false;
  try {
    data.styles = await Store.update('styles', cur => {
      if (cur.some(s => s && s.target === target)) return cur;
      const next = [{ id: newStyleId(cur), name: 'New style', enabled: true, matchType: 'domain', target, css: '/* Start writing CSS */\n', variables: [] }, ...cur];
      const sizeError = backupSizeError(
        next, data.globalCss || '', data.enabled, data.theme,
        cur, data.globalCss || '', data.enabled, data.theme
      );
      if (sizeError) throw new Error(sizeError);
      created = true;
      return next;
    });
  } catch (error) {
    await askNotice('Could not add style', error.message || 'The backup size limit would be exceeded.');
    return null;
  }
  selectedDomain = target;
  $('search').value = '';
  setView('cards');
  drawDomains();
  draw();
  if (created) {
    const ta = document.querySelector('[data-css]');
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }
  return created;
}

/* ---------- rendering ---------- */

function drawDomains() {
  const q = ($('search').value || '').toLowerCase();
  const domains = [...new Set(data.styles
    .map(s => s && typeof s.target === 'string' ? s.target : '')
    .filter(Boolean))]
    .filter(d => d.toLowerCase().includes(q));
  $('domain-list').innerHTML = domains
    .map(d => {
      const active = view === 'cards' && selectedDomain === d;
      return `<div role="listitem"><button class="domain-link ${active ? 'active' : ''}" type="button" aria-pressed="${active}" data-domain="${esc(d)}">${esc(d)}</button></div>`;
    })
    .join('');
  $('clear-search').disabled = !q;
}

function draw() {
  const list = data.styles.filter(s => s && typeof s === 'object' && (!selectedDomain || s.target === selectedDomain));
  $('cards').innerHTML = list.map(s => {
    const id = String(s.id);
    const name = typeof s.name === 'string' ? s.name : '';
    const target = typeof s.target === 'string' ? s.target : '';
    const matchType = ['domain', 'prefix', 'regex'].includes(s.matchType) ? s.matchType : 'domain';
    return `<article class="card" data-id="${esc(id)}">
<div class="card-top"><div><h3>${esc(name || target || 'Untitled style')}</h3><span class="pill">${esc(matchType.toUpperCase())}</span><span class="dirty-badge">Unsaved changes</span></div>
<div class="actions"><button data-del="${esc(id)}" type="button" title="Delete style" aria-label="Delete style ${esc(name || target)}">🗑️</button><label class="toggle"><input data-toggle="${esc(id)}" type="checkbox" aria-label="Enable style ${esc(name || target)}" ${s.enabled ? 'checked' : ''}><span aria-hidden="true"></span></label></div></div>
<div class="meta">⌁ ${esc(target)}</div>
<div class="editor">
  <div class="fields">
    <label>Name<input data-name type="text" aria-label="Style name"></label>
    <label>Match<select data-match aria-label="Match type"><option value="domain">Domain</option><option value="prefix">URL Prefix</option><option value="regex">Regex</option></select></label>
    <label>Target<input data-target type="text" aria-label="Match target"></label>
    <div class="save-area"><button class="save" data-save="${esc(id)}" type="button">Save changes</button><div class="error" data-error aria-live="polite"></div></div>
  </div>
  <div class="css-editor"><textarea data-css aria-label="Style CSS"></textarea></div>
  <section class="variables-editor" aria-label="CSS variables">
    <div class="variables-heading"><span>Variables</span><button class="add-variable" data-add-variable type="button">Add variable</button></div>
    <div data-variables></div>
  </section>
</div></article>`;
  }).join('');

  // Fill values through DOM properties so imported/user text is never parsed
  // as HTML. Drafts survive re-rendering and external storage updates.
  for (const s of list) {
    const card = cardEl(s.id);
    if (!card) continue;
    const f = drafts[s.id] || fieldsOf(s);
    card.querySelector('[data-css]').value = f.css;
    card.querySelector('[data-name]').value = f.name;
    card.querySelector('[data-target]').value = f.target;
    card.querySelector('[data-match]').value = f.matchType;
    const variablesBox = card.querySelector('[data-variables]');
    if (!f.variables.length) {
      const empty = document.createElement('p');
      empty.className = 'variables-empty';
      empty.textContent = 'No variables. Add a token and replacement value to use custom substitutions.';
      variablesBox.appendChild(empty);
    }
    f.variables.forEach((variable, index) => {
      const row = document.createElement('div');
      row.className = 'variable-row';
      row.innerHTML = `<label>Token<input data-var-token type="text" aria-label="Variable token ${index + 1}"></label><label>Replacement value<input data-var-value type="text" aria-label="Variable replacement ${index + 1}"></label><button data-remove-variable="${index}" type="button" aria-label="Remove variable ${index + 1}">Remove</button>`;
      row.querySelector('[data-var-token]').value = variable.token;
      row.querySelector('[data-var-value]').value = variable.value;
      variablesBox.appendChild(row);
    });
    card.classList.toggle('dirty', !!drafts[s.id]);
  }
}

/* ---------- init ---------- */

async function init() {
  // Only one manager tab may exist. If another one is open, the background
  // hands our request over to it and closes this tab.
  const hash = new URLSearchParams(location.hash.slice(1));
  try {
    const r = await browser.runtime.sendMessage({ type: 'manager-opened', add: hash.get('add') || '', domain: hash.get('domain') || '', styleId: hash.get('styleId') || '' });
    if (r && r.keep === false) return;
    if (r) myTabId = r.tabId;
  } catch {}

  data = { ...Store.DEFAULTS, ...(await Store.get()) };
  applyTheme(data.theme);
  $('theme').value = data.theme;
  $('global-css').value = data.globalCss || '';
  $('global-error').textContent = '';
  setView('global');
  drawDomains();

  // dialogs
  // The typed value travels in returnValue, so it is read at the moment the dialog closes.
  const submitInput = () => $('input-dialog').close('ok:' + $('domain-input').value.trim());
  $('confirm-input').onclick = submitInput;
  $('cancel-input').onclick = () => $('input-dialog').close('');
  $('domain-input').onkeydown = e => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); // otherwise the Enter keypress lands on the button that opened the dialog
    submitInput();
  };
  $('confirm-delete').onclick = () => $('confirm-dialog').close('yes');
  $('cancel-delete').onclick = () => $('confirm-dialog').close('');
  $('unsaved-save').onclick = () => $('unsaved-dialog').close('save');
  $('unsaved-discard').onclick = () => $('unsaved-dialog').close('discard');
  $('unsaved-cancel').onclick = () => $('unsaved-dialog').close('');
  $('cancel-import').onclick = () => $('import-confirm-dialog').close('');
  $('confirm-import').onclick = () => $('import-confirm-dialog').close('yes');
  $('about-button').onclick = () => $('about-dialog').showModal();
  $('close-about').onclick = () => $('about-dialog').close();

  $('theme').onchange = async () => {
    const theme = $('theme').value;
    data.theme = theme;
    applyTheme(theme);
    await Store.update('theme', () => theme);
  };

  // Sidebar
  $('nav-global').onclick = showGlobal;
  $('clear-search').onclick = clearSearch;
  $('search').oninput = drawDomains; // filters the domain list only; never re-renders the editors
  $('domain-list').onclick = e => {
    const a = e.target.closest('[data-domain]');
    if (a) selectDomain(a.dataset.domain);
  };

  $('new').onclick = async () => {
    if (!(await guardLeave())) return;
    const target = await askInput('New style', 'Enter a domain for this style:', 'example.com');
    if (!target) return;
    const created = await addStyleFor(target);
    if (created === false) await askNotice('Duplicate domain', 'A style for this domain already exists. It has been selected for you.');
  };

  $('global-css').addEventListener('input', () => { $('global-error').textContent = ''; });
  $('save-global').onclick = async () => {
    if (await saveGlobal()) alert('Global CSS saved');
  };

  // cards (event delegation, so drafts survive re-rendering)
  const cards = $('cards');
  const idOf = el => el.closest('.card')?.dataset.id;
  cards.addEventListener('input', e => { const id = idOf(e.target); if (id != null && !e.target.matches('[data-toggle]')) readDraft(id); });
  cards.addEventListener('change', async e => {
    const id = idOf(e.target);
    if (id == null) return;
    if (e.target.matches('[data-toggle]')) {
      const on = e.target.checked;
      await commitStyles(styles => styles.map(s => (s && String(s.id) === id ? { ...s, enabled: on } : s)));
    } else {
      readDraft(id);
    }
  });
  cards.addEventListener('click', async e => {
    const addVariable = e.target.closest('[data-add-variable]');
    if (addVariable) {
      const id = idOf(addVariable);
      const style = styleById(id);
      if (!style) return;
      readDraft(id);
      const draft = drafts[id] || fieldsOf(style);
      draft.variables.push({ token: '', value: '' });
      drafts[id] = draft;
      draw();
      cardEl(id)?.querySelector('.variable-row:last-child [data-var-token]')?.focus();
      return;
    }
    const removeVariable = e.target.closest('[data-remove-variable]');
    if (removeVariable) {
      const id = idOf(removeVariable);
      const style = styleById(id);
      if (!style) return;
      readDraft(id);
      const draft = drafts[id] || fieldsOf(style);
      const index = Number(removeVariable.dataset.removeVariable);
      if (Number.isInteger(index)) draft.variables.splice(index, 1);
      drafts[id] = draft;
      if (!draftDiffers(id)) delete drafts[id];
      draw();
      cardEl(id)?.querySelector('[data-add-variable]')?.focus();
      return;
    }
    const save = e.target.closest('[data-save]');
    if (save) {
      const id = save.dataset.save;
      readDraft(id);
      await saveDrafts([id]);
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del && (await askConfirm())) {
      const id = del.dataset.del;
      delete drafts[id];
      await commitStyles(styles => styles.filter(s => !s || String(s.id) !== id));
      if (selectedDomain && !data.styles.some(s => s && s.target === selectedDomain)) {
        selectedDomain = '';
        setView('global');
      }
      drawDomains();
      if (view === 'cards') draw();
    }
  });

  // backup
  $('export').onclick = async () => {
    try {
      const fresh = await Store.get();
      const content = backupExportContent(fresh);
      download(content, 'stylo-backup.json', 'application/json');
    } catch (error) {
      alert('Could not export this backup: ' + (error.message || 'Invalid saved data.'));
    }
  };
  $('import').onclick = async () => {
    if (!(await guardLeave())) return;
    $('file').value = '';
    $('file').click();
  };
  $('file').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (file.size > BACKUP_LIMITS.fileBytes) throw new Error('The backup is too large.');
      const parsed = JSON.parse(await file.text());
      const replacement = normalizeBackup(parsed);
      // Any accepted import must also fit Stylo's standard export format.
      backupExportContent(replacement);
      if ((await openDialog($('import-confirm-dialog'))) !== 'yes') return;

      // Validate everything before this single, serialized storage operation.
      // Never write a partially imported set of keys.
      await Store.setMany(replacement);
      data = { ...data, ...replacement };
      $('global-css').value = data.globalCss || '';
      $('global-error').textContent = '';
      $('theme').value = data.theme || 'auto';
      applyTheme(data.theme || 'auto');
      Object.keys(drafts).forEach(k => delete drafts[k]);
      selectedDomain = '';
      setView('global');
      drawDomains();
    } catch (error) {
      alert('Could not import this backup: ' + (error.message || 'Invalid JSON.'));
    } finally {
      $('file').value = '';
    }
  };

  // Stay in sync with changes made elsewhere (popup, other windows).
  browser.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.theme) {
      data.theme = ch.theme.newValue || 'auto';
      $('theme').value = data.theme;
      applyTheme(data.theme);
    }
    if (ch.globalCss) {
      const keep = globalDirty();
      data.globalCss = ch.globalCss.newValue || '';
      if (!keep) {
        $('global-css').value = data.globalCss;
        $('global-error').textContent = '';
      }
    }
    if (ch.styles) {
      const next = Array.isArray(ch.styles.newValue) ? ch.styles.newValue : [];
      if (JSON.stringify(next) !== JSON.stringify(data.styles)) {
        data.styles = next;
        drawDomains();
        if (view === 'cards') draw();
      }
    }
  });

  // Requests from the popup / background, e.g. "add a style for this site".
  let queue = Promise.resolve();
  browser.runtime.onMessage.addListener(msg => {
    if (!msg || msg.type !== 'manager-request' || msg.tabId !== myTabId) return;
    queue = queue.then(() => handleRequest(msg)).catch(() => {});
  });

  // Signal only after state, controls, and the request listener are ready. The
  // background holds requests until this handshake instead of racing page load.
  try { await browser.runtime.sendMessage({ type: 'manager-ready' }); } catch {}
  if (hash.get('add')) {
    queue = queue.then(() => handleRequest({ add: hash.get('add') })).catch(() => {});
    await queue;
  } else if (hash.get('styleId')) {
    queue = queue.then(() => selectStyleById(hash.get('styleId'), hash.get('domain') || '')).catch(() => {});
    await queue;
  } else if (hash.get('domain')) {
    queue = queue.then(() => selectDomain(hash.get('domain'))).catch(() => {});
    await queue;
  }
}

async function handleRequest(msg) {
  while (document.querySelector('dialog[open]')) await new Promise(r => setTimeout(r, 150));
  if (!(await guardLeave())) return; // user chose Cancel: keep editing the current style
  if (msg.add) await addStyleFor(msg.add);
  else if (msg.styleId) await selectStyleById(msg.styleId, msg.domain || '');
  else if (msg.domain) await selectDomain(msg.domain);
  else if (msg.view === 'global') await showGlobal();
}

init();
