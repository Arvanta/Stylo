'use strict';

const MANAGER_URL = browser.runtime.getURL('manager.html');
const readyManagers = new Set();
const pendingManagerRequests = new Map();

// Runs on install, extension update, and browser update. Never overwrite data.
browser.runtime.onInstalled.addListener(() => Store.fillDefaults({ version: 1 }));

// ---- Manager tab: only one may exist -------------------------------------

async function managerTabs() {
  const all = await browser.tabs.query({});
  return all
    .filter(t => t.url && (t.url === MANAGER_URL || t.url.startsWith(MANAGER_URL + '#')))
    .sort((a, b) => a.id - b.id);
}

async function focusTab(tab) {
  await browser.tabs.update(tab.id, { active: true });
  await browser.windows.update(tab.windowId, { focused: true });
}

function sendManagerRequest(tabId, req) {
  browser.runtime.sendMessage({
    type: 'manager-request', tabId,
    add: req.add || '', domain: req.domain || '', styleId: req.styleId || '', view: req.view || ''
  }).catch(() => {});
}

function askManager(tabId, req) {
  if (!req.add && !req.domain && !req.styleId && !req.view) return;
  const request = { add: req.add || '', domain: req.domain || '', styleId: req.styleId || '', view: req.view || '' };
  if (readyManagers.has(tabId)) {
    sendManagerRequest(tabId, request);
    return;
  }
  const queue = pendingManagerRequests.get(tabId) || [];
  queue.push(request);
  pendingManagerRequests.set(tabId, queue);
}

async function openManager(req = {}) {
  const [tab] = await managerTabs();
  if (!tab) {
    let hash = '';
    if (req.add) hash = '#add=' + encodeURIComponent(req.add);
    else if (req.domain) {
      hash = '#domain=' + encodeURIComponent(req.domain);
      if (req.styleId) hash += '&styleId=' + encodeURIComponent(req.styleId);
    } else if (req.styleId) hash = '#styleId=' + encodeURIComponent(req.styleId);
    await browser.tabs.create({ url: MANAGER_URL + hash, active: true });
    return;
  }
  await focusTab(tab);
  const request = (req.add || req.domain || req.styleId)
    ? req
    : { ...req, view: req.view || 'global' };
  askManager(tab.id, request);
}

// A manager page just loaded. If another one already exists, keep one tab and
// hand the request to that tab. Readiness is signaled separately by the page.
async function onManagerOpened(msg, sender) {
  const me = sender.tab;
  if (!me) return { keep: true, tabId: null };
  const [keeper] = await managerTabs();
  if (!keeper || keeper.id === me.id) return { keep: true, tabId: me.id };
  await focusTab(keeper);
  const request = (msg.add || msg.domain || msg.styleId)
    ? { add: msg.add, domain: msg.domain, styleId: msg.styleId }
    : { view: 'global' };
  askManager(keeper.id, request);
  await browser.tabs.remove(me.id);
  return { keep: false, tabId: me.id };
}

async function onManagerReady(sender) {
  const tabId = sender.tab?.id;
  if (tabId == null) return;
  readyManagers.add(tabId);
  const queue = pendingManagerRequests.get(tabId) || [];
  pendingManagerRequests.delete(tabId);
  for (const request of queue) sendManagerRequest(tabId, request);
}

async function applyToActiveTab() {
  const data = await Store.get();
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  // This message is used by the popup, whose active tab is the site. The
  // manager relies on storage.onChanged so it never refreshes its own tab.
  if (tab && /^https?:/i.test(tab.url || '')) {
    browser.tabs.sendMessage(tab.id, { type: 'refresh', data }).catch(() => {});
  }
}

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab.url && tab.url.startsWith(MANAGER_URL)) {
    readyManagers.delete(tabId);
  }
});

browser.tabs.onRemoved.addListener(tabId => {
  readyManagers.delete(tabId);
  pendingManagerRequests.delete(tabId);
});

// URL-prefix and regex rules must be re-evaluated after SPA history changes.
function refreshAfterRouteChange(details) {
  if (details.frameId !== 0 || details.tabId < 0 || !/^https?:/i.test(details.url || '')) return;
  browser.tabs.sendMessage(details.tabId, { type: 'url-change', url: details.url }).catch(() => {});
}

browser.webNavigation.onHistoryStateUpdated.addListener(refreshAfterRouteChange);
browser.webNavigation.onReferenceFragmentUpdated.addListener(refreshAfterRouteChange);

// Not async on purpose: returning undefined leaves messages for other
// extension pages unanswered by this listener.
browser.runtime.onMessage.addListener((msg, sender) => {
  if (!msg) return;
  if (msg.type === 'open-manager') return openManager(msg);
  if (msg.type === 'manager-opened') return onManagerOpened(msg, sender);
  if (msg.type === 'manager-ready') return onManagerReady(sender);
  if (msg.type === 'apply') return applyToActiveTab();
});
