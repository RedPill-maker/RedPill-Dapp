# <p align="center"><img width="64" alt="RedPill_logo" src="https://github.com/user-attachments/assets/e49f1210-6956-4c47-9b06-2c33032f6d07" /><p align="center">RedPill</p>
</p>

> **Decentralized Content Publishing. Truly Data Sovereign. Currently in beta version.**

Decentralized content platform built on IPFS and Filecoin Onchain Cloud. Creators publish, monetize, and manage content through a video-platform-inspired interface.

## Features

- Content publishing via IPFS/IPNS with CID addressing
- Blockchain tipping, rewards, jackpot system
- Filecoin wallet supporting both 0x and f410/t410 address formats
- USDFC stablecoin integration (Secured Finance protocol)
- Embedded IPFS Kubo node (desktop app)
- Multi-language support (en-US, zh-CN, zh-TW, ja-JP, ko-KR, es-ES)

## Architecture

![RedPill Architecture](https://github.com/user-attachments/assets/5e11ad83-1c78-4d1c-8cc1-22d258ddb2b2)

## Quick Start

### 1. Configure GitHub Token

This project depends on `@secured-finance` packages hosted on GitHub Packages. Before running `npm install`, you need to configure a GitHub Personal Access Token:

1. Go to https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Select scope: `read:packages`
4. Copy the generated token
5. Open `.npmrc` in the project root, find the `_authToken` line and replace it with your token:

```
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
```

### 2. Install & Run

```bash
npm install          # Install dependencies
### Build Desktop App
### You can choose to build the system version you need
npm run build:app-mac-arm64   # macOS ARM64
npm run build:app-mac-x64     # macOS Intel
npm run build:app-win-x64     # Windows x64
npm run build:app-linux-x64   # Linux x64
### Optional action
npm run verify:app            # Verify packaged app
```

### 3. Run development environment

``` bash
## You need to start the following three processes
## 1. React WebUI process
npm run dev          # Start dev server (port 3000)

## 2. Synchronize database server
npm run db:server    # Start Sync blockchain events & database API server

## 3. IPFS Node
## Choose to run the corresponding system version of Kubo (IPFS Node)
cd ./kubo/<System version dir>/
daemon ./ipfs
## Or you can also run Kubo independently on your local computer, 
## see the link: https://github.com/ipfs/kubo
```

## Project Structure

```
src/
├── components/              # React components (PascalCase)
│   ├── ads/                # Ad space components
│   ├── creator/            # Creator management
│   ├── filecoin/           # Wallet, transactions, rewards
│   ├── home_page/          # Landing page
│   ├── header_search/      # Search functionality
│   ├── local_download/     # Local download management
│   └── work_item/          # Work display components
├── global_modal/            # Global modal components
│   └── WalletSelectorModal.tsx
├── store/slices/            # Redux Toolkit slices
├── utils/                   # Business logic
│   ├── rpcConnector.ts     # Filecoin RPC interface
│   ├── ipfsConnector.ts    # IPFS node communication
│   ├── dbConnector.ts      # Database API calls
│   ├── walletMgr.ts        # Wallet operations & signing
│   ├── creatorHubMgr.ts    # CreatorHub contract calls
│   ├── adsMgr.ts           # Ad contract calls
│   ├── stakingMgr.ts       # Staking operations
│   ├── fileStoreMgr.ts     # Filecoin storage (Synapse SDK)
│   ├── privateDataMgr.ts   # Local encrypted user data
│   ├── updateMgr.ts        # App update management
│   ├── portManager.ts      # Dynamic port allocation
│   └── ipnsSigner.ts       # IPNS key signing
├── hooks/                   # Custom React hooks
├── i18n/locales/            # Translation files (6 languages)
├── types/                   # TypeScript type definitions
└── config.ts                # Project configuration constants

dbSync/                      # Database sync & API server
electron/                    # Desktop app (Electron)
contract_info/               # Smart contract ABIs
data/                        # SQLite databases
kubo/                        # IPFS Kubo binaries (multi-platform)
docs/                        # Documentation
```

## Technology Stack

| Category | Technology |
|----------|-----------|
| Node.js | v22+ |
| Frontend | React 19 + TypeScript |
| State | Redux Toolkit |
| Styling | Tailwind CSS 3.4 |
| Build | Vite 7.3 |
| Blockchain | ethers.js v6.16, @filoz/synapse-sdk |
| Stablecoin | @secured-finance/stablecoin-lib-ethers (USDFC) |
| Storage | IPFS Kubo, SQLite |
| Desktop | Electron |
| i18n | react-i18next |

## Utils Architecture

**Layer 1 — Base Connectors** (no business logic)
- `rpcConnector.ts` — Filecoin RPC provider
- `ipfsConnector.ts` — IPFS node API
- `dbConnector.ts` — Database API

**Layer 2 — Business Logic** (uses Layer 1)
- `walletMgr.ts` — Wallet operations, address conversion, signing service
- `creatorHubMgr.ts` — CreatorHub contract interactions
- `adsMgr.ts` — Ad contract interactions
- `stakingMgr.ts` — Staking operations
- `fileStoreMgr.ts` — Filecoin storage via Synapse SDK
- `privateDataMgr.ts` — Secure local storage (never touches network)

**Security Flow**:
```
User (address + password) → Contract Manager → walletMgr.getSigner()
→ privateDataMgr.decryptWallet() → Temporary Signer → Clear memory
```

## Data Storage

### Sensitive Data (privateDataMgr.ts)
- Web: `localStorage` with AES encryption
- Desktop: Electron `safeStorage` (macOS Keychain / Windows DPAPI / Linux libsecret)

### SQLite Databases (`data/`)
| Database | Content |
|----------|---------|
| core.db | Creators, works, sync state |
| peripheral.db | Tips, withdrawals, account transfers |
| txhistory2.db | Transaction history, wallet addresses |

All databases contain only public blockchain data — no private keys.

## IPFS Configuration (Web Version Only)

> Desktop app auto-configures IPFS. Manual setup only needed for web version.

```bash
ipfs init
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["*"]'
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods '["PUT", "POST", "GET"]'
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Headers '["Authorization"]'
ipfs config --json API.HTTPHeaders.Access-Control-Expose-Headers '["Ipfs-Hash"]'
ipfs daemon
```

## License

[MIT](LICENSE.md)
