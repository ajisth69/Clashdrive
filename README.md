# Clash Drive (v2.0.0)

A serverless, client-side web application that transforms Telegram supergroup forum topics into a personal cloud storage workspace. Run entirely in your browser with direct Telegram Datacenter connections via MTProto.

---

## 🚀 Key Features

### 📦 Storage & File Management
- **Serverless Architecture:** Runs fully in the browser with direct MTProto TCP/WebSocket connections to Telegram production DCs. No server-side storage or API keys are proxied.
- **Folder-to-Topic Mapping:** Organizes your storage by mapping root folders directly to Telegram supergroup forum topic threads.
- **Batch Operations:** Perform batch upload, download, move, copy, and deletion across folders with real-time progress indicators.
- **Move & Copy Modals:** Easily organize and transfer files between topic folders.
- **Favourites & Starred Items:** Star important files for quick access with automatic topic synchronization.
- **File Renaming & Properties:** Rename files and view detailed metadata (chunks, MIME types, upload dates, file IDs) using the File Info Inspector.
- **Background Folder Indexing:** Automatic recursive indexing of all folders and files with live status tracking.

### 🎥 Media Streaming & Advanced Previews
- **In-Browser Media Streaming:** Uses a local Service Worker (`sw.js`) to intercept media range requests, fetch chunk segments from Telegram, and stream them progressively to in-browser video/audio players.
- **Instant Playback Pre-caching:** Pre-caches initial chunks and pre-fetches message references for immediate video/audio playback without waiting for full file downloads.
- **Rich File Previews:** Built-in viewer for images (with thumbnail grid caching), PDFs, code/text files, Office documents (XLSX, CSV, DOCX), and EPUB eBooks.

### 🔗 Public Link File Sharing & Cloudflare Worker Integration
- **Direct File Sharing:** Generate secure share links for files using direct worker links or share hashes.
- **Telegram Bot Support:** Optional integration with `@clashdrivebot` for serving public download links directly to non-account holders.
- **Worker Proxy Support:** Compatible with custom Cloudflare Worker endpoints (`worker.js`) for streaming public downloads.
- **Receive Shared Links:** Import shared files seamlessly into your drive workspace.

### 🔐 Security & Identity Management
- **Multi-Account Swapping:** Connect and seamlessly switch between up to 3 Telegram identities stored locally.
- **SRP & 2FA Support:** Fully compatible with 2-Factor Authentication (2FA) and Secure Remote Password (SRP) authentication in sandboxed browser environments.
- **Cache & Session Management:** Built-in tools to clear local cache, manage storage quotas, and safely log out.

### 🎨 Modern UI & Power Tools
- **Tailwind CSS v4 & React 19:** Fast, responsive UI with sleek Dark and Light mode themes.
- **Quick Navigation & Search:** Search files and folders instantly using keyboard shortcuts (`Ctrl + K` or `/`).
- **Toast & Confirm System:** Real-time visual feedback for file actions and operations.

---

## 🛠️ Tech Stack

- **Frontend:** React 19, TypeScript, Vite 8, Tailwind CSS v4
- **Telegram Protocol:** GramJS (`telegram` package) with MTProto WebSockets
- **Service Worker:** Custom range-request interceptor (`sw.js`)
- **Public Edge Worker:** Cloudflare Worker (`worker.js`)

---

## 💻 Local Development

Get a developer instance running locally in seconds:

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the local development server:**
   ```bash
   npm run dev
   ```
   *The application will run on `http://localhost:5173/` by default.*

3. **Build production bundle:**
   ```bash
   npm run build
   ```

4. **Lint codebase:**
   ```bash
   npm run lint
   ```

---

## 📄 Metadata & Policies

- **[MIT License](./LICENSE)** — Terms of use and redistribution.
- **[Security Policy](./SECURITY.md)** — Vulnerability reporting guidelines.
- **[Code of Conduct](./CODE_OF_CONDUCT.md)** — Standard community covenant.
