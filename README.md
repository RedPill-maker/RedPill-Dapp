# <p align="center"><img width="64" alt="RedPill_logo" src="https://github.com/user-attachments/assets/e49f1210-6956-4c47-9b06-2c33032f6d07" /><p align="center">RedPill</p>
</p>


> **Decentralized Content Publishing. Truly Data Sovereign.**

Decentralized content platform built on IPFS and Filecoin. Creators publish, monetize, and manage content through a video-platform-inspired interface.

## Features

- Content publishing via IPFS/IPNS with CID addressing
- Blockchain tipping, rewards, jackpot system
- Filecoin wallet supporting both 0x and f410/t410 address formats
- USDFC stablecoin integration (Secured Finance protocol)
- Embedded IPFS Kubo node (desktop app)
- Multi-network support: Mainnet, Calibration Testnet, Local Testnet
- CreatorHub & AdSpace smart contract integration
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
npm run dev          # Start dev server (port 3000)
npm run db:sync      # Sync blockchain events to database
npm run db:server    # Start database API server
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

## npm Commands

### Development
```bash
npm run dev              # Vite dev server (port 3000)
npm run db:sync          # Sync blockchain events
npm run db:server        # Database API server
```

### Build
```bash
npm run build            # Build web app
npm run preview          # Preview build
npm run clean            # Clean dist
npm run clean:all        # Clean all build artifacts
```

### Code Quality
```bash
npm run lint             # ESLint
npm run lint:fix         # Auto-fix
npm run format           # Prettier
npm run type-check       # TypeScript check
```

### Desktop App
```bash
npm run build:app-mac-arm64   # macOS ARM64
npm run build:app-mac-x64     # macOS Intel
npm run build:app-win-x64     # Windows x64
npm run build:app-linux-x64   # Linux x64
npm run verify:app            # Verify packaged app
```

## Technology Stack

| Category | Technology |
|----------|-----------|
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
