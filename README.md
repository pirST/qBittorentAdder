# qBittorrent Adder

A Chrome extension that intercepts magnet links and `.torrent` files and sends them directly to your qBittorrent instance via its Web UI API.

## Features

- Intercept magnet and torrent link clicks on any page
- Automatically catch `.torrent` file downloads
- Right-click context menu: "Add to qBittorrent"
- Category selection dialog with "remember last" option
- Popup for manually adding magnet links or `.torrent` files
- Desktop and in-page toast notifications
- CSRF-safe requests via `declarativeNetRequest` header rewriting

## Installation

1. Clone or download this repository
2. Open `chrome://extensions/` and enable **Developer mode**
3. Click **Load unpacked** and select the `chrome-extension` folder
4. Open the extension options and set your qBittorrent Web UI URL, username, and password

## Configuration

| Option | Description |
|---|---|
| **Web UI URL** | qBittorrent Web UI address (default `http://localhost:8080`) |
| **Username / Password** | Credentials for the Web UI |
| **Default category** | Auto-assign category, or use "Last used" |
| **Save path** | Override download path (leave empty for default) |
| **Auto start** | Start torrents immediately after adding |
| **Auto TMM** | Use Automatic Torrent Management |
| **Notifications** | Show desktop notifications on add/error |
| **Confirmation dialog** | Show category picker before adding |

## Permissions

- `storage` — save extension settings
- `contextMenus` — right-click menu entries
- `notifications` — desktop notifications
- `downloads` — intercept `.torrent` downloads
- `cookies` — read qBittorrent session cookie
- `declarativeNetRequest` — rewrite Origin/Referer headers for CSRF
- `host_permissions: *://*/*` — communicate with your qBittorrent instance and download torrent files

## License

[Apache 2.0](LICENSE)
