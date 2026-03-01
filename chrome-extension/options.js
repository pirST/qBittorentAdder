const $ = (sel) => document.querySelector(sel);

const fields = {
  url: $('#url'),
  username: $('#username'),
  password: $('#password'),
  savePath: $('#savePath'),
  category: $('#category'),
  autoStart: $('#autoStart'),
  autoTMM: $('#autoTMM'),
  showNotifications: $('#showNotifications'),
  showConfirmation: $('#showConfirmation'),
  siteList: $('#siteList')
};

const siteFilterRadios = document.querySelectorAll('input[name="siteFilterMode"]');
const siteListField = $('#siteList-field');

const btnTest = $('#btn-test');
const testResult = $('#test-result');
const saveStatus = $('#save-status');

let saveTimer = null;

async function loadSettings() {
  const result = await chrome.storage.local.get('config');
  const config = result.config || {};

  fields.url.value = config.url || 'http://localhost:8080';
  fields.username.value = config.username || '';
  fields.password.value = config.password || '';
  fields.savePath.value = config.savePath || '';
  fields.category.value = config.category || '';
  fields.autoStart.checked = config.autoStart !== false;
  fields.autoTMM.checked = config.autoTMM !== false;
  fields.showNotifications.checked = config.showNotifications !== false;
  fields.showConfirmation.checked = config.showConfirmation !== false;

  const filterMode = config.siteFilterMode || 'disabled';
  for (const radio of siteFilterRadios) {
    radio.checked = radio.value === filterMode;
  }
  fields.siteList.value = config.siteList || '';
  toggleSiteListVisibility(filterMode);
}

function getSelectedFilterMode() {
  for (const radio of siteFilterRadios) {
    if (radio.checked) return radio.value;
  }
  return 'disabled';
}

function toggleSiteListVisibility(mode) {
  siteListField.style.display = (mode === 'disabled') ? 'none' : '';
}

async function saveSettings() {
  const config = {
    url: fields.url.value.replace(/\/+$/, ''),
    username: fields.username.value,
    password: fields.password.value,
    savePath: fields.savePath.value,
    category: fields.category.value,
    autoStart: fields.autoStart.checked,
    autoTMM: fields.autoTMM.checked,
    showNotifications: fields.showNotifications.checked,
    showConfirmation: fields.showConfirmation.checked,
    siteFilterMode: getSelectedFilterMode(),
    siteList: fields.siteList.value
  };

  await chrome.storage.local.set({ config });
  saveStatus.textContent = 'Saved!';
  setTimeout(() => { saveStatus.textContent = ''; }, 2000);
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

  const result = await chrome.runtime.sendMessage({ action: 'testConnection' });
  if (result.success) {
    testResult.textContent = `Connected — qBittorrent ${result.version}`;
    testResult.className = 'test-result ok';
  } else {
    testResult.textContent = `Failed: ${result.error}`;
    testResult.className = 'test-result err';
  }
  btnTest.disabled = false;
}

for (const [, el] of Object.entries(fields)) {
  if (el.type === 'checkbox' || el.tagName === 'SELECT') {
    el.addEventListener('change', saveNow);
  } else {
    el.addEventListener('input', scheduleSave);
  }
}

btnTest.addEventListener('click', testConnection);

for (const radio of siteFilterRadios) {
  radio.addEventListener('change', () => {
    toggleSiteListVisibility(radio.value);
    saveNow();
  });
}
fields.siteList.addEventListener('input', scheduleSave);

loadSettings();
