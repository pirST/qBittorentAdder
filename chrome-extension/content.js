(() => {
  'use strict';

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
        return decodeURIComponent(file.replace('.torrent', ''));
      }
    } catch (_) { /* ignore */ }
    return url.substring(0, 60) + '...';
  }

  // ============================================
  // INLINE STYLES (injected into page)
  // ============================================

  const STYLE_ID = 'qbit-adder-styles';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .qbit-overlay {
        position: fixed;
        top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.4);
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: Arial, sans-serif;
      }
      .qbit-dialog {
        background: #fff;
        color: #333;
        border-radius: 8px;
        padding: 20px;
        max-width: 460px;
        width: 90%;
        box-shadow: 0 10px 40px rgba(0,0,0,0.25);
        border: 1px solid #ddd;
      }
      .qbit-dialog h3 {
        margin: 0 0 12px;
        font-size: 16px;
        color: #333;
      }
      .qbit-dialog-name {
        background: #f0f0f0;
        padding: 8px 10px;
        border-radius: 5px;
        font-size: 12px;
        word-break: break-all;
        margin-bottom: 12px;
        border: 1px solid #ddd;
        color: #555;
      }
      .qbit-dialog label {
        display: block;
        font-size: 12px;
        font-weight: bold;
        color: #555;
        margin-bottom: 4px;
      }
      .qbit-dialog select {
        width: 100%;
        padding: 6px 8px;
        background: #fff;
        border: 1px solid #ccc;
        border-radius: 3px;
        color: #333;
        font-size: 13px;
        margin-bottom: 14px;
        outline: none;
      }
      .qbit-dialog select:focus {
        border-color: #007bff;
        box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
      }
      .qbit-dialog-btns {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
      .qbit-dialog-btns button {
        padding: 6px 14px;
        border: none;
        border-radius: 3px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.2s;
      }
      .qbit-btn-cancel {
        background: #f0f0f0;
        color: #555;
        border: 1px solid #ddd;
      }
      .qbit-btn-cancel:hover { background: #e0e0e0; color: #333; }
      .qbit-btn-add {
        background: #007bff;
        color: #fff;
      }
      .qbit-btn-add:hover { background: #0056b3; }

      .qbit-toast {
        position: fixed;
        bottom: 20px;
        right: 20px;
        padding: 10px 16px;
        border-radius: 5px;
        color: #fff;
        font-size: 13px;
        z-index: 2147483647;
        font-family: Arial, sans-serif;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        animation: qbit-slide 0.3s ease;
        max-width: 350px;
      }
      .qbit-toast-success { background: #28a745; }
      .qbit-toast-error { background: #dc3545; }
      .qbit-toast-info { background: #007bff; }
      @keyframes qbit-slide {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // ============================================
  // TOAST
  // ============================================

  function showToast(message, type = 'info') {
    injectStyles();
    const toast = document.createElement('div');
    toast.className = `qbit-toast qbit-toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'qbit-slide 0.3s ease reverse';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // ============================================
  // CONFIRM DIALOG WITH CATEGORY SELECTION
  // ============================================

  async function showConfirmDialog(url, name) {
    injectStyles();

    let categories = {};
    try {
      categories = await chrome.runtime.sendMessage({ action: 'getCategories' });
    } catch (_) { /* ignore */ }

    const { config } = await chrome.storage.local.get('config');
    const defaultCat = (config && config.category) || '';
    let preselected = '';
    if (defaultCat === '__last__') {
      preselected = (await chrome.storage.local.get('lastCategory')).lastCategory || '';
    } else {
      preselected = defaultCat;
    }

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'qbit-overlay';

      const catOptions = ['<option value="">— None —</option>'];
      if (categories && typeof categories === 'object') {
        for (const c of Object.keys(categories).sort()) {
          const sel = c === preselected ? ' selected' : '';
          catOptions.push(`<option value="${c}"${sel}>${c}</option>`);
        }
      }

      overlay.innerHTML = `
        <div class="qbit-dialog">
          <h3>Add to qBittorrent</h3>
          <div class="qbit-dialog-name">${name}</div>
          <label>Category</label>
          <select class="qbit-cat-select">${catOptions.join('')}</select>
          <div class="qbit-dialog-btns">
            <button class="qbit-btn-cancel">Cancel</button>
            <button class="qbit-btn-add">Add</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const cleanup = (result) => {
        overlay.remove();
        resolve(result);
      };

      overlay.querySelector('.qbit-btn-cancel').onclick = () => cleanup(null);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cleanup(null);
      });
      overlay.querySelector('.qbit-btn-add').onclick = () => {
        const cat = overlay.querySelector('.qbit-cat-select').value;
        chrome.storage.local.set({ lastCategory: cat });
        cleanup(cat);
      };
    });
  }

  // ============================================
  // LINK CLICK INTERCEPTION
  // ============================================

  document.addEventListener('click', (e) => {
    let target = e.target;
    while (target && target.tagName !== 'A') {
      target = target.parentElement;
    }
    if (!target || !target.href) return;

    const url = target.href;
    if (!isMagnetUrl(url) && !isTorrentUrl(url)) return;

    e.preventDefault();
    e.stopPropagation();

    handleInterceptedLink(url);
  }, true);

  async function handleInterceptedLink(url) {
    try {
      await chrome.runtime.sendMessage({ action: 'interceptedLink', url });
    } catch (e) {
      showToast('Extension error: ' + e.message, 'error');
    }
  }

  // ============================================
  // MESSAGE HANDLER (from background)
  // ============================================

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'showConfirmDialog') {
      (async () => {
        const category = await showConfirmDialog(msg.url, msg.name);
        if (category === null) {
          sendResponse({ cancelled: true });
        } else {
          sendResponse({ category });
        }
      })();
      return true;
    }

    if (msg.action === 'showToast') {
      showToast(msg.text, msg.type || 'info');
    }
  });
})();
