const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

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
      return decodeURIComponent(file.replace('.torrent', ''));
    }
  } catch (_) { /* ignore */ }
  return url.substring(0, 60) + (url.length > 60 ? '...' : '');
}

// ============================================
// MAIN TAB ELEMENTS
// ============================================
const magnetInput = $('#magnet-input');
const torrentFile = $('#torrent-file');
const fileDrop = $('#file-drop');
const fileDropText = $('#file-drop-text');
const categorySelect = $('#category-select');
const btnAdd = $('#btn-add');
const messageEl = $('#message');
const statusDot = $('#status-dot');
const statusText = $('#status-text');

// ============================================
// SETTINGS TAB ELEMENTS
// ============================================
const settingsFields = {
  url: $('#url'),
  username: $('#username'),
  password: $('#password'),
  savePath: $('#savePath'),
  category: $('#defaultCategory'),
  autoStart: $('#autoStart'),
  autoTMM: $('#autoTMM'),
  showNotifications: $('#showNotifications'),
  showConfirmation: $('#showConfirmation')
};

const btnTest = $('#btn-test');
const testResult = $('#test-result');
const saveStatus = $('#save-status');

let selectedFile = null;
let saveTimer = null;

// ============================================
// TABS
// ============================================

$$('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.tab-btn').forEach(b => b.classList.remove('active'));
    $$('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    $(`#${btn.dataset.tab}`).classList.add('active');
  });
});

// ============================================
// INIT
// ============================================

async function init() {
  await checkConnection();
  await loadCategories();
  await loadLastCategory();
  await loadSettings();
}

async function checkConnection() {
  try {
    const result = await chrome.runtime.sendMessage({ action: 'testConnection' });
    if (result.success) {
      statusDot.className = 'dot dot-ok';
      statusText.textContent = `${result.version}`;
    } else {
      statusDot.className = 'dot dot-err';
      statusText.textContent = 'Disconnected';
    }
  } catch {
    statusDot.className = 'dot dot-err';
    statusText.textContent = 'Error';
  }
}

async function loadCategories() {
  try {
    const categories = await chrome.runtime.sendMessage({ action: 'getCategories' });
    categorySelect.innerHTML = '<option value="">— None —</option>';
    settingsFields.category.innerHTML = '<option value="">— None —</option><option value="__last__">Last selected category</option>';
    if (categories && typeof categories === 'object') {
      const sorted = Object.keys(categories).sort((a, b) => a.localeCompare(b));
      for (const name of sorted) {
        for (const sel of [categorySelect, settingsFields.category]) {
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          sel.appendChild(opt);
        }
      }
    }
  } catch { /* ignore */ }
}

async function loadLastCategory() {
  const { config } = await chrome.storage.local.get('config');
  const defaultCat = (config && config.category) || '';

  if (defaultCat === '__last__') {
    const { lastCategory } = await chrome.storage.local.get('lastCategory');
    if (lastCategory) categorySelect.value = lastCategory;
  } else if (defaultCat) {
    categorySelect.value = defaultCat;
  }
}

// ============================================
// SETTINGS
// ============================================

async function loadSettings() {
  const result = await chrome.storage.local.get('config');
  const config = result.config || {};

  settingsFields.url.value = config.url || 'http://localhost:8080';
  settingsFields.username.value = config.username || '';
  settingsFields.password.value = config.password || '';
  settingsFields.savePath.value = config.savePath || '';
  settingsFields.category.value = config.category || '';
  settingsFields.autoStart.checked = config.autoStart !== false;
  settingsFields.autoTMM.checked = config.autoTMM !== false;
  settingsFields.showNotifications.checked = config.showNotifications !== false;
  settingsFields.showConfirmation.checked = config.showConfirmation !== false;
  toggleSavePathVisibility();
}

async function saveSettings() {
  const config = {
    url: settingsFields.url.value.replace(/\/+$/, ''),
    username: settingsFields.username.value,
    password: settingsFields.password.value,
    savePath: settingsFields.savePath.value,
    category: settingsFields.category.value,
    autoStart: settingsFields.autoStart.checked,
    autoTMM: settingsFields.autoTMM.checked,
    showNotifications: settingsFields.showNotifications.checked,
    showConfirmation: settingsFields.showConfirmation.checked
  };

  await chrome.storage.local.set({ config });
  showSaveStatus('Saved!', 'success');
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, 400);
}

function saveNow() {
  clearTimeout(saveTimer);
  saveSettings();
}

async function testConnection() {
  btnTest.disabled = true;
  testResult.textContent = 'Testing...';
  testResult.className = 'test-result';

  await saveSettings();

  try {
    const result = await chrome.runtime.sendMessage({ action: 'testConnection' });
    if (result.success) {
      testResult.textContent = `Connected — ${result.version}`;
      testResult.className = 'test-result ok';
      statusDot.className = 'dot dot-ok';
      statusText.textContent = `${result.version}`;
    } else {
      testResult.textContent = `Failed: ${result.error}`;
      testResult.className = 'test-result err';
    }
  } catch (e) {
    testResult.textContent = `Error: ${e.message}`;
    testResult.className = 'test-result err';
  }
  btnTest.disabled = false;
}

function showSaveStatus(text, type) {
  saveStatus.textContent = text;
  saveStatus.className = `message ${type}`;
  setTimeout(() => {
    saveStatus.textContent = '';
    saveStatus.className = 'message';
  }, 2000);
}

// ============================================
// MAIN TAB LOGIC
// ============================================

function updateAddButton() {
  const hasInput = magnetInput.value.trim() || selectedFile;
  btnAdd.disabled = !hasInput;
}

function showMessage(text, type = 'info') {
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
  if (type !== 'error') {
    setTimeout(() => {
      messageEl.textContent = '';
      messageEl.className = 'message';
    }, 4000);
  }
}

// ============================================
// EVENT HANDLERS — MAIN
// ============================================

magnetInput.addEventListener('input', updateAddButton);

fileDrop.addEventListener('click', () => torrentFile.click());

fileDrop.addEventListener('dragover', (e) => {
  e.preventDefault();
  fileDrop.classList.add('dragover');
});

fileDrop.addEventListener('dragleave', () => {
  fileDrop.classList.remove('dragover');
});

fileDrop.addEventListener('drop', (e) => {
  e.preventDefault();
  fileDrop.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file && file.name.endsWith('.torrent')) {
    selectedFile = file;
    fileDropText.textContent = file.name;
    fileDrop.classList.add('has-file');
    updateAddButton();
  }
});

torrentFile.addEventListener('change', () => {
  const file = torrentFile.files[0];
  if (file) {
    selectedFile = file;
    fileDropText.textContent = file.name;
    fileDrop.classList.add('has-file');
    updateAddButton();
  }
});

categorySelect.addEventListener('change', () => {
  chrome.storage.local.set({ lastCategory: categorySelect.value });
});

btnAdd.addEventListener('click', async () => {
  const url = magnetInput.value.trim();
  const category = categorySelect.value;

  btnAdd.classList.add('loading');
  btnAdd.disabled = true;

  try {
    let result;

    if (selectedFile) {
      const buffer = await selectedFile.arrayBuffer();
      result = await chrome.runtime.sendMessage({
        action: 'addTorrentFile',
        fileData: Array.from(new Uint8Array(buffer)),
        fileName: selectedFile.name,
        category
      });
    } else if (url.startsWith('magnet:')) {
      result = await chrome.runtime.sendMessage({
        action: 'addMagnet',
        url,
        category
      });
    } else if (url) {
      result = await chrome.runtime.sendMessage({
        action: 'addTorrentUrl',
        url,
        category
      });
    }

    if (result && result.success) {
      const displayName = result.name || (selectedFile
        ? selectedFile.name.replace(/\.torrent$/i, '')
        : extractTorrentName(url));
      showMessage(`Added: ${displayName}`, 'success');
      magnetInput.value = '';
      selectedFile = null;
      fileDropText.textContent = 'Click or drag .torrent file here';
      fileDrop.classList.remove('has-file');
    } else {
      showMessage(result?.error || 'Failed to add torrent', 'error');
    }
  } catch (e) {
    showMessage(e.message, 'error');
  } finally {
    btnAdd.classList.remove('loading');
    updateAddButton();
  }
});

// ============================================
// EVENT HANDLERS — SETTINGS
// ============================================

for (const [, el] of Object.entries(settingsFields)) {
  if (el.type === 'checkbox' || el.tagName === 'SELECT') {
    el.addEventListener('change', saveNow);
  } else {
    el.addEventListener('input', scheduleSave);
  }
}

btnTest.addEventListener('click', testConnection);
settingsFields.autoTMM.addEventListener('change', toggleSavePathVisibility);

function toggleSavePathVisibility() {
  const field = $('#savePath-field');
  field.style.display = settingsFields.autoTMM.checked ? 'none' : '';
}

// ============================================
// START
// ============================================

init();
