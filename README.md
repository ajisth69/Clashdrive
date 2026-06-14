# 🌌 TG Cloud Drive (v1.0) — The Decentralized Browser Cloud

[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](./LICENSE)
[![React](https://img.shields.io/badge/React-19-blue.svg?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue.svg?logo=typescript)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-8.0-6C63FF.svg?logo=vite)](https://vite.dev)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-4.0-38BDF8.svg?logo=tailwindcss)](https://tailwindcss.com)

Welcome to **TG Cloud Drive** — a state-of-the-art, fully decentralized cloud storage workspace that turns your Telegram account's message threads (topics) into secure, encrypted block-storage slots. With zero server-side overhead, it is completely free, infinite, and executes fully in your browser.

---

## ⚡ Quick Deploy

Deploy your own private instance of TG Cloud Drive in just one click. Both platforms serve the app as static assets directly from edge CDNs, meaning you will **never** pay for bandwidth or server compute, and it is 100% immune to server timeouts.

### Deploy to Vercel
Click the button below to fork and deploy directly to Vercel:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fajisth%2Ftg-cloud-drive)

### Deploy to Cloudflare Pages
Deploy globally to Cloudflare's ultra-fast edge network with zero configuration:

[![Deploy to Cloudflare Pages](https://deploy.workers.cloudflare.com/button)](https://deploy.dev/?url=https://github.com/ajisth/tg-cloud-drive)

---

## ✨ Features Checklist

*   **🌐 100% Serverless SPA:** Hosted entirely on static CDNs (Vercel/Cloudflare Pages). No heavy active backend means no CPU timeout issues or hosting costs.
*   **🔒 Zero-Knowledge Local AES-GCM Encryption:** All files are encrypted *locally in your browser tab* before being sent across the network. Telegram only ever sees scrambled binary bits.
*   **⚡ 100x Speed Upload & Download Streams:** Leverages direct multithreaded MTProto pipeline concurrency to max out your internet bandwidth.
*   **📂 Infinite Nested Folders:** Organize files into folders structured dynamically via local metadata.
*   **🎬 In-Browser Media Streaming (Service Worker Proxy):** Stream high-definition movies and audio files progressively with instant scrubbing, buffering indicators, and zero memory crashes.
*   **👥 Multi-Account Swapping:** Connect and switch between up to 3 Telegram accounts seamlessly with a premium dropdown selector.
*   **🔍 Power Shortcuts & Clear Triggers:** Focus search instantly via `Ctrl + K` or `/` keys, with dynamic one-tap search field clearing.
*   **🎨 Stunning Glassmorphic Design:** Premium dark-themed UI featuring glowing vector illustrations, visualizer cards, and CSS backdrop blurs.

---

## 📖 Deep Architectural Insight

TG Cloud Drive is built from the ground up to follow **Zero-Knowledge** serverless design patterns. Unlike classic systems that route files through intermediate file servers (e.g. AWS S3, Node backends), this app exists solely in the client’s browser runtime.

```
                  ┌───────────────────────────────┐
                  │      User's Browser Tab       │
                  │  (React 19, MTProto Client)   │
                  └───────────────┬───────────────┘
                                  │
              [1MB AES-GCM Chunks]│
                                  ▼
                    ┌───────────────────┐
                    │ Telegram MTProto  │
                    │  (Storage Core)   │
                    └───────────────────┘
```

### 1. In-Browser MTProto Protocol
Under the hood, we run a custom web-compiled Telegram Client using **MTProto**. The web app establishes direct TCP/WebSocket handshake connections with Telegram’s official production Datacenters (DCs). 
* When you log in, your session keys and authentication secrets are saved locally in the browser’s **IndexedDB** database via encryption.
* **No intermediate servers** ever touch or see your session token or phone inputs.

### 2. Zero-Knowledge Encryption & Chunking
To bypass Telegram’s file upload limitations and ensure absolute, military-grade privacy, the drive utilizes an autonomous **Client-Side Slicing Engine**:
* **Chunking:** Files are sliced into exactly **1MB binary chunks** (`ArrayBuffer`) in-memory.
* **Encryption:** Each chunk is encrypted inside the browser using **AES-256-GCM** (authenticated symmetric encryption) with a unique, cryptographically secure random key.
* **Storage:** These encrypted chunks are sent to a private, hidden Telegram group/channel via separate media message packets.
* **Zero Leakage:** Since files are fully encrypted in the browser *before* hitting the network, Telegram sees only scrambled, unreadable binary blocks. Even if Telegram workers inspect their storage servers, they see zero readable files.

### 3. Service Worker Video & Audio Streaming
Classic browser downloads require downloading the entire file into memory before saving, which crashes the tab for files larger than 1GB. TG Cloud Drive bypasses this with a **local streaming proxy**:
* We register a custom **Service Worker** (`sw.js`).
* When you play a video or scrub through a movie, the HTML5 video element requests specific byte-ranges.
* Our Service Worker intercepts these byte requests locally, calculates which encrypted 1MB parts contain those bytes, downloads only those specific chunks from Telegram, decrypts them in-browser, and feeds the raw stream directly to your media player on the fly.
* This allows **instant, buffer-free playback** of multi-gigabyte video or audio files directly within your browser.

---

## 🔒 Security & Privacy Model

TG Cloud Drive enforces strict privacy practices:

| Component | Security Configuration | Storage Location |
| :--- | :--- | :--- |
| **Authentication Keys** | Encrypted Session Strings | Browser IndexedDB (Local only) |
| **File Index Metadata** | AES-GCM Encrypted JSON | Browser localStorage (Local only) |
| **Raw Storage Chunks** | Encrypted Binary Blocks | Telegram Datacenters (Cloud) |
| **Intermediate Servers** | **None** | App is 100% serverless static HTML/JS |

### Key Disclosures:
* **No Server Footprint:** Because there is no active backend server, all data stays local in your browser. No secrets can ever be leaked or exposed.
* **Symmetric Sealing:** The decryption key for every uploaded file is generated inside the browser and embedded directly in the index manifest stored locally, so only you have access to the keys.

---

## 🛠️ Local Development & Setup

Get your developer instance running locally in less than 2 minutes:

### 1. Clone the Repository
```bash
git clone https://github.com/ajisth/tg-cloud-drive.git
cd tg-cloud-drive
```

### 2. Install Dependencies
Make sure you have Node.js (v18+) installed:
```bash
npm install
```

### 3. Start the Dev Server
Run Vite in development mode:
```bash
npm run dev
```
Open `http://localhost:5173/` in your web browser to start using your drive.

---

## 📜 Metadata & Policies

TG Cloud Drive is committed to open, safe, and professional standards. Read our dedicated files for deep disclosures:

*   **[MIT License](./LICENSE)** — Full licensing text and utilization guidelines.
*   **[Code of Conduct](./CODE_OF_CONDUCT.md)** — Core community covenant and standard policies.
*   **[Security Policy](./SECURITY.md)** — Detailed vulnerability disclosures and updates tables.
