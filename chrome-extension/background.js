const DEFAULT_CONFIG = {
  url: 'http://localhost:8080',
  username: 'admin',
  password: '',
  savePath: '',
  category: '',
  autoStart: true,
  autoTMM: true,
  showNotifications: true,
  showConfirmation: true,
  siteFilterMode: 'disabled',
  siteList: ''
};

let sidValue = null;

const DNR_RULE_ID = 1;

// ============================================
// CONFIG
// ============================================

async function getConfig() {
  const result = await chrome.storage.local.get('config');
  return { ...DEFAULT_CONFIG, ...result.config };
}

async function resolveCategory(explicit) {
  const config = await getConfig();
  let cat = explicit || config.category;
  if (cat === '__last__') {
    const stored = await chrome.storage.local.get('lastCategory');
    cat = stored.lastCategory || '';
  }
  return cat;
}

// ============================================
// SITE FILTER
// ============================================

function matchesSiteList(hostname, siteList) {
  const domains = siteList.split('\n')
    .map(d => d.trim().toLowerCase())
    .filter(d => d && !d.startsWith('#'));
  hostname = hostname.toLowerCase();
  for (const domain of domains) {
    if (hostname === domain || hostname.endsWith('.' + domain)) {
      return true;
    }
  }
  return false;
}

async function isSiteAllowed(pageUrl) {
  if (!pageUrl) return true;
  const config = await getConfig();
  if (!config.siteFilterMode || config.siteFilterMode === 'disabled') return true;
  if (!config.siteList || !config.siteList.trim()) return true;

  let hostname;
  try { hostname = new URL(pageUrl).hostname; } catch (_) { return true; }

  const matches = matchesSiteList(hostname, config.siteList);
  if (config.siteFilterMode === 'allowlist') return matches;
  if (config.siteFilterMode === 'blocklist') return !matches;
  return true;
}

// ============================================
// DECLARATIVENETREQUEST — fix Origin/Referer
// so qBittorrent's CSRF check passes
// ============================================

async function updateHeaderRules() {
  const config = await getConfig();
  if (!config.url) return;

  let parsed;
  try { parsed = new URL(config.url); } catch (_) { return; }

  const origin = parsed.origin;
  const urlFilter = `||${parsed.hostname}`;

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [DNR_RULE_ID],
    addRules: [{
      id: DNR_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Origin', operation: 'set', value: origin },
          { header: 'Referer', operation: 'set', value: origin + '/' }
        ]
      },
      condition: {
        urlFilter,
        resourceTypes: ['xmlhttprequest', 'other']
      }
    }]
  });
}

// Update rules when config changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.config) {
    sidValue = null;
    updateHeaderRules();
  }
});

// Set rules on startup
updateHeaderRules();

// ============================================
// COOKIE-BASED SID RETRIEVAL
// ============================================

async function getSidFromCookies() {
  const config = await getConfig();
  if (!config.url) return null;
  try {
    const cookie = await chrome.cookies.get({ url: config.url, name: 'SID' });
    return cookie ? cookie.value : null;
  } catch (_) {
    return null;
  }
}

// ============================================
// QBITTORRENT API
// ============================================

async function qbitFetch(endpoint, options = {}) {
  const config = await getConfig();
  const url = `${config.url}${endpoint}`;

  const headers = { ...(options.headers || {}) };

  if (sidValue) {
    headers['Cookie'] = `SID=${sidValue}`;
  }

  const fetchOpts = { ...options, headers };
  // Don't spread 'headers' from options again — we already merged above
  delete fetchOpts.credentials;

  const resp = await fetch(url, fetchOpts);
  return resp;
}

async function qbitLogin() {
  const config = await getConfig();
  if (!config.url || !config.username) return false;

  const body = `username=${encodeURIComponent(config.username)}&password=${encodeURIComponent(config.password)}`;

  const resp = await fetch(`${config.url}/api/v2/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  const text = await resp.text();
  if (resp.status === 200 && text === 'Ok.') {
    // Set-Cookie header is not readable via fetch API.
    // Use chrome.cookies API to retrieve the SID the server just set.
    const sid = await getSidFromCookies();
    if (sid) {
      sidValue = sid;
    }
    return true;
  }
  return false;
}

async function ensureAuth() {
  if (!sidValue) {
    sidValue = await getSidFromCookies();
  }

  if (sidValue) {
    try {
      const resp = await qbitFetch('/api/v2/app/version');
      if (resp.status === 200) return true;
    } catch (_) { /* need login */ }
  }

  sidValue = null;
  return await qbitLogin();
}

async function getCategories() {
  if (!await ensureAuth()) return {};
  try {
    const resp = await qbitFetch('/api/v2/torrents/categories');
    if (resp.status === 200) return await resp.json();
  } catch (_) { /* ignore */ }
  return {};
}

async function addTorrentByUrl(magnetUrl, category = '') {
  if (!await ensureAuth()) {
    return { success: false, error: 'Authentication failed' };
  }

  const config = await getConfig();
  const formData = new FormData();
  formData.append('urls', magnetUrl);

  const cat = await resolveCategory(category);
  if (cat) formData.append('category', cat);
  if (config.savePath) formData.append('savepath', config.savePath);
  if (!config.autoStart) formData.append('stopped', 'true');

  const useAutoTMM = config.autoTMM && !config.savePath;
  formData.append('autoTMM', useAutoTMM ? 'true' : 'false');

  try {
    let resp = await qbitFetch('/api/v2/torrents/add', {
      method: 'POST',
      body: formData
    });
    let text = await resp.text();

    if (resp.status === 200 && text === 'Ok.') {
      return { success: true };
    }

    // Session expired — re-login and retry once
    if (resp.status === 403) {
      sidValue = null;
      if (await qbitLogin()) {
        resp = await qbitFetch('/api/v2/torrents/add', {
          method: 'POST',
          body: formData
        });
        text = await resp.text();
        if (resp.status === 200 && text === 'Ok.') {
          return { success: true };
        }
      }
    }
    return { success: false, error: humanizeAddError(resp.status, text) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function addTorrentByFile(fileBytes, fileName, category = '') {
  if (!await ensureAuth()) {
    return { success: false, error: 'Authentication failed' };
  }

  const config = await getConfig();
  const formData = new FormData();
  const blob = new Blob([fileBytes], { type: 'application/x-bittorrent' });
  formData.append('torrents', blob, fileName);

  const cat = await resolveCategory(category);
  if (cat) formData.append('category', cat);
  if (config.savePath) formData.append('savepath', config.savePath);
  if (!config.autoStart) formData.append('stopped', 'true');

  const useAutoTMM = config.autoTMM && !config.savePath;
  formData.append('autoTMM', useAutoTMM ? 'true' : 'false');

  try {
    const resp = await qbitFetch('/api/v2/torrents/add', {
      method: 'POST',
      body: formData
    });
    const text = await resp.text();
    if (resp.status === 200 && text === 'Ok.') {
      return { success: true };
    }
    return { success: false, error: humanizeAddError(resp.status, text) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function downloadAndAddTorrent(url, fallbackName, category = '') {
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const cdHeader = resp.headers.get('Content-Disposition');
    const cdName = parseContentDisposition(cdHeader);
    const resolvedFileName = cdName || fallbackName;

    const buffer = await resp.arrayBuffer();
    const result = await addTorrentByFile(new Uint8Array(buffer), resolvedFileName, category);
    result.name = stripTorrentExt(resolvedFileName);
    return result;
  } catch (_) {
    const result = await addTorrentByUrl(url, category);
    result.name = stripTorrentExt(fallbackName);
    return result;
  }
}

async function testConnection() {
  try {
    const ok = await ensureAuth();
    if (!ok) return { success: false, error: 'Authentication failed' };
    const resp = await qbitFetch('/api/v2/app/version');
    if (resp.status === 200) {
      const version = await resp.text();
      return { success: true, version };
    }
    return { success: false, error: `HTTP ${resp.status}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================
// HELPERS
// ============================================

function isMagnetUrl(url) {
  return url && url.toLowerCase().startsWith('magnet:');
}

function isTorrentUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower.endsWith('.torrent') ||
    lower.includes('.torrent?') ||
    lower.includes('/download/torrent') ||
    lower.includes('/get_torrent') ||
    lower.includes('action=download') ||
    /\/torrent\/\d+\/download/.test(lower) ||
    /\/torrents\/download\/\d+/.test(lower) ||
    /download\.php\?.*torrent/i.test(lower);
}

function extractTorrentName(url) {
  if (url.startsWith('magnet:')) {
    const match = url.match(/dn=([^&]+)/);
    if (match) return decodeURIComponent(match[1].replace(/\+/g, ' '));
    return 'Magnet link';
  }
  try {
    const pathParts = new URL(url).pathname.split('/');
    const file = pathParts[pathParts.length - 1];
    if (file && file.includes('.torrent')) {
      return decodeURIComponent(file.replace(/\.torrent$/i, ''));
    }
  } catch (_) { /* ignore */ }
  return url.substring(0, 60) + (url.length > 60 ? '...' : '');
}

function parseContentDisposition(header) {
  if (!header) return null;

  // Priority: filename*=UTF-8''<url-encoded-value>
  const starMatch = header.match(/filename\*\s*=\s*UTF-8''\s*(.+?)(?:\s*;|$)/i);
  if (starMatch) {
    try {
      return decodeURIComponent(starMatch[1].trim());
    } catch (_) { /* fall through */ }
  }

  // Fallback: filename="..." (but not filename*=)
  const quotedMatch = header.match(/(?<!\*)filename\s*=\s*"([^"]+)"/i);
  if (quotedMatch) return quotedMatch[1];

  // Fallback: filename=<token> (but not filename*=)
  const plainMatch = header.match(/(?<!\*)filename\s*=\s*([^\s;]+)/i);
  if (plainMatch) return plainMatch[1];

  return null;
}

function humanizeAddError(status, body) {
  if (status === 200 && body === 'Fails.') {
    return 'Torrent already exists or is invalid';
  }
  if (status === 415) {
    return 'Torrent file is not valid';
  }
  return `HTTP ${status}: ${body}`;
}

function stripTorrentExt(name) {
  return name.replace(/\.torrent$/i, '');
}

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message
  });
}

// ============================================
// SHARED: ask content script for category, then add
// ============================================

async function askCategoryAndAdd(tabId, url, initialName) {
  const config = await getConfig();
  let category = config.category || '';
  let displayName = initialName;
  let downloadedData = null;
  let resolvedFileName = null;

  // For torrent URLs, download first to resolve the real name from Content-Disposition
  if (!isMagnetUrl(url)) {
    try {
      const resp = await fetch(url);
      if (resp.ok) {
        const cd = resp.headers.get('Content-Disposition');
        const cdName = parseContentDisposition(cd);
        resolvedFileName = cdName || (initialName.endsWith('.torrent') ? initialName : initialName + '.torrent');
        displayName = stripTorrentExt(resolvedFileName);
        downloadedData = new Uint8Array(await resp.arrayBuffer());
      }
    } catch (_) { /* will try again during add */ }
  }

  if (config.showConfirmation && tabId > 0) {
    try {
      const resp = await chrome.tabs.sendMessage(tabId, {
        action: 'showConfirmDialog',
        url,
        name: displayName
      });
      if (resp && resp.cancelled) return;
      category = (resp && resp.category) || '';
    } catch (_) {
      // content script unreachable — proceed silently
    }
  }

  let result;
  if (isMagnetUrl(url)) {
    result = await addTorrentByUrl(url, category);
    result.name = displayName;
  } else if (downloadedData) {
    result = await addTorrentByFile(downloadedData, resolvedFileName, category);
    result.name = displayName;
  } else {
    const fallback = initialName.endsWith('.torrent') ? initialName : initialName + '.torrent';
    result = await downloadAndAddTorrent(url, fallback, category);
  }

  const finalName = result.name || displayName;

  if (config.showNotifications) {
    notify(
      result.success ? 'Torrent Added' : 'Error',
      result.success ? `Added: ${finalName}` : result.error
    );
  }

  if (tabId > 0) {
    try {
      await chrome.tabs.sendMessage(tabId, {
        action: 'showToast',
        text: result.success ? `Added: ${finalName}` : (result.error || 'Failed'),
        type: result.success ? 'success' : 'error'
      });
    } catch (_) { /* ignore */ }
  }
}

// ============================================
// CONTEXT MENU
// ============================================

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'qbit-add-link',
    title: 'Add to qBittorrent',
    contexts: ['link']
  });
  chrome.contextMenus.create({
    id: 'qbit-add-link-with-cat',
    title: 'Add to qBittorrent (choose category)',
    contexts: ['link']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.linkUrl;
  if (!url) return;
  if (tab && tab.url && !await isSiteAllowed(tab.url)) return;
  const name = extractTorrentName(url);

  if (info.menuItemId === 'qbit-add-link') {
    const config = await getConfig();
    let result;
    if (isMagnetUrl(url)) {
      result = await addTorrentByUrl(url);
      result.name = name;
    } else {
      result = await downloadAndAddTorrent(url, name + '.torrent');
    }
    const displayName = result.name || name;
    if (config.showNotifications) {
      notify(
        result.success ? 'Torrent Added' : 'Error',
        result.success ? `Added: ${displayName}` : result.error
      );
    }
  }

  if (info.menuItemId === 'qbit-add-link-with-cat') {
    await askCategoryAndAdd(tab.id, url, name);
  }
});

// ============================================
// DOWNLOAD INTERCEPTION
// ============================================

chrome.downloads.onCreated.addListener(async (item) => {
  const isTorrent =
    (item.mime && item.mime === 'application/x-bittorrent') ||
    (item.filename && item.filename.toLowerCase().endsWith('.torrent')) ||
    isTorrentUrl(item.url);

  if (!isTorrent) return;

  const config = await getConfig();
  if (!config.url) return;

  if (item.referrer && !await isSiteAllowed(item.referrer)) return;
  if (!item.referrer) {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (activeTab && activeTab.url && !await isSiteAllowed(activeTab.url)) return;
    } catch (_) { /* ignore */ }
  }

  try { chrome.downloads.cancel(item.id); } catch (_) { /* may already be done */ }
  try { chrome.downloads.erase({ id: item.id }); } catch (_) { /* ignore */ }

  const displayName = item.filename
    ? item.filename.replace(/^.*[/\\]/, '')
    : extractTorrentName(item.url);

  // item.referrer gives us the tab's page, but we need the tab ID
  // to show the dialog. Use the tab that initiated the download.
  let tabId = -1;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (activeTab) tabId = activeTab.id;
  } catch (_) { /* ignore */ }

  await askCategoryAndAdd(tabId, item.url, displayName);
});

// ============================================
// MESSAGE HANDLER
// ============================================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'addMagnet') {
    (async () => {
      const name = extractTorrentName(msg.url);
      const result = await addTorrentByUrl(msg.url, msg.category || '');
      result.name = name;
      const config = await getConfig();
      if (config.showNotifications) {
        notify(
          result.success ? 'Torrent Added' : 'Error',
          result.success ? `Added: ${name}` : result.error
        );
      }
      sendResponse(result);
    })();
    return true;
  }

  if (msg.action === 'addTorrentUrl') {
    (async () => {
      const fallback = extractTorrentName(msg.url) + '.torrent';
      const result = await downloadAndAddTorrent(msg.url, fallback, msg.category || '');
      const config = await getConfig();
      if (config.showNotifications) {
        notify(
          result.success ? 'Torrent Added' : 'Error',
          result.success ? `Added: ${result.name}` : result.error
        );
      }
      sendResponse(result);
    })();
    return true;
  }

  if (msg.action === 'addTorrentFile') {
    (async () => {
      const bytes = new Uint8Array(msg.fileData);
      const result = await addTorrentByFile(bytes, msg.fileName, msg.category || '');
      result.name = stripTorrentExt(msg.fileName);
      const config = await getConfig();
      if (config.showNotifications) {
        notify(
          result.success ? 'Torrent Added' : 'Error',
          result.success ? `Added: ${result.name}` : result.error
        );
      }
      sendResponse(result);
    })();
    return true;
  }

  if (msg.action === 'getCategories') {
    getCategories().then(sendResponse);
    return true;
  }

  if (msg.action === 'testConnection') {
    testConnection().then(sendResponse);
    return true;
  }

  if (msg.action === 'interceptedLink') {
    (async () => {
      const pageUrl = sender.tab ? sender.tab.url : null;
      if (pageUrl && !await isSiteAllowed(pageUrl)) {
        sendResponse({ ok: false, filtered: true });
        return;
      }
      const tabId = sender.tab ? sender.tab.id : -1;
      await askCategoryAndAdd(tabId, msg.url, extractTorrentName(msg.url));
      sendResponse({ ok: true });
    })();
    return true;
  }
});
