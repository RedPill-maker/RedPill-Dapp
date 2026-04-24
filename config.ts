import packageJson from './package.json'

// Per-network contract configuration (used by dbSync and frontend network switching)
export interface NetworkContracts {
  creator_hub: `0x${string}`
  ads: `0x${string}`
  deploy_block: number
}

export const NETWORK_CONTRACTS: Record<string, NetworkContracts> = {
  // Filecoin Calibration Testnet
  calibration: {
    creator_hub: '0x0000000000000000000000000000000000000000',
    ads: '0x0000000000000000000000000000000000000000',
    deploy_block: 0,
  },
  // Filecoin Mainnet (update addresses when deployed)
  mainnet: {
    creator_hub: '0x5714C78f7A4A8c45292fc13ca1be29d9144964Ff',
    ads: '0x5dd2aF0550D51Cd1Eae915321d3D48AC66257141',
    deploy_block: 5951264,
  },
  // Local Testnet
  localnet: {
    creator_hub: '0x0000000000000000000000000000000000000000',
    ads: '0x0000000000000000000000000000000000000000',
    deploy_block: 0,
  },
}

// Developer account name, default subscription
export const DEVELOPER_ACCOUNT = 'RedPill'

// USDFC Trove system parameters (based on Secured Finance protocol standard)
// Note: The contract address is automatically managed by @secured-finance/stablecoin-lib-ethers SDK
export const TROVE_PARAMS = {
  MIN_COLLATERAL_RATIO: 110, // Minimum mortgage rate 110% (normal mode)
  RECOMMENDED_COLLATERAL_RATIO: 150, // Recommended mortgage rate 150% (avoid recovery mode)
  LIQUIDATION_RESERVE: '20', // Liquidation reserve 20 USDFC (temporarily deducted when opened and returned when closed)
  /**
   * ⚠️ Note: The bottom layer of the USDFC contract usually requires MIN_NET_DEBT (debt after deducting reserves) 
   * The 200 here is the recommended value for the front end. If an error is reported, try increasing it to 500 or higher.
   */
  MIN_DEBT: '200', 
  BORROWING_FEE_RATE: 0.005, // Borrowing rate 0.5% (fluctuates according to system activity, usually 0.5% is the starting value)
} as const

// Per-network token list (USDFC address differs between mainnet and calibration)
// USDFC addresses from: https://docs.secured.finance/stablecoin-protocol/deployed-contracts
export const NETWORK_TOKENS: Record<string, { address: string; symbol: string; name: string }[]> = {
  calibration: [
    { address: '0x0000000000000000000000000000000000000000', symbol: 'FIL', name: 'Filecoin' },
    { address: '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0', symbol: 'USDFC', name: 'USDFC Stablecoin' },
  ],
  mainnet: [
    { address: '0x0000000000000000000000000000000000000000', symbol: 'FIL', name: 'Filecoin' },
    { address: '0x80B98d3aa09ffff255c3ba4A241111Ff1262F045', symbol: 'USDFC', name: 'USDFC Stablecoin' },
  ],
  localnet: [
    { address: '0x0000000000000000000000000000000000000000', symbol: 'FIL', name: 'Filecoin' },
  ],
}

// Returns the token list for the currently active network.
// Reads the persisted network setting so it works without importing rpcConnector (avoids circular deps).
export function getKnownTokens(): { address: string; symbol: string; name: string }[] {
  try {
    const raw = localStorage.getItem('redpill_settings')
    if (raw) {
      const settings = JSON.parse(raw)
      const network = settings.currentNetwork
      if (network) {
        const networkId = network.chainId === 'f' ? 'mainnet' : network.chainId === 't' ? 'calibration' : 'localnet'
        if (NETWORK_TOKENS[networkId]) {
          return NETWORK_TOKENS[networkId]
        }
      }
    }
  } catch {
    // Fall through to default
  }
  // Default to calibration when no network is set
  return NETWORK_TOKENS['calibration']
}

// Backward-compatible static alias — prefer getKnownTokens() for network-aware usage
export const KNOWN_TOKENS = getKnownTokens()

// Home page sidebar advertising address, welcome to make a better client :)
export const HOME_PAGE_AD_ADDRESS = '0xaDCb24Da1ae9c63c737C9F4a46d31fFD9881d113'

// Block update time ms once every 30 seconds
export const BLOCK_RENEW_TIME = 30000

// ==================== Ports settings ====================

// Default port (first option)
export const DEFAULT_PORTS = {
  DB_SERVER: 3001,
  IPFS_API: 5001,
  IPFS_GATEWAY: 8080,
  IPFS_SWARM: 4001,
} as const

// Port range (when the default port is occupied, try in sequence)
export const PORT_RANGES = {
  DB_SERVER: [3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010],
  IPFS_API: [5001, 5002, 5003, 5004, 5005, 5006, 5007, 5008, 5009, 5010],
  IPFS_GATEWAY: [8080, 8081, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089],
  IPFS_SWARM: [4001, 4002, 4003, 4004, 4005, 4006, 4007, 4008, 4009, 4010],
} as const

// Compatibility: keep old constant names (use default values)
export const DB_SERVER_PORT = DEFAULT_PORTS.DB_SERVER

// ==================== IPFS Settings ====================

export const IPFS_CONFIG = {
  API_BASE_URL: `http://127.0.0.1:${DEFAULT_PORTS.IPFS_API}/api/v0`,
  GATEWAY_URL: `http://127.0.0.1:${DEFAULT_PORTS.IPFS_GATEWAY}`,
  DEFAULT_TIMEOUT: 10000,
  UPLOAD_TIMEOUT: 0,
  MAX_RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
  // Public IPFS gateways used as fallback when local Kubo fails (format: fetch via GET /ipfs/<cid>)
  // Ordered by reliability/speed based on testing; Promise.any picks the fastest responding
  PUBLIC_GATEWAYS: [
    'https://eu.orbitor.dev',
    'https://ipfs.orbitor.dev',
    'https://apac.orbitor.dev',
    'https://latam.orbitor.dev',
    'https://gateway.pinata.cloud',
    'https://ipfs.io',
    'https://cloudflare-ipfs.com',
    'https://dweb.link',
  ],
  // Max outer retry rounds: re-fetch contract CIDs and retry IPFS download
  MAX_OUTER_RETRY_ROUNDS: 5,
} as const

// API route settings
export const API_ENDPOINTS = {
  IPFS: {
    ID: '/id',
    VERSION: '/version',
    PEERS: '/swarm/peers',
    ADD: '/add',
    CAT: '/cat',
    LS: '/ls',
    PIN_ADD: '/pin/add',
    PIN_LS: '/pin/ls',
    PIN_RM: '/pin/rm',
    REPO_STAT: '/repo/stat',
    REPO_GC: '/repo/gc',
    DAG_EXPORT: '/dag/export',
  },
} as const

// ==================== Filecoin Network Configuration ====================

/**
 * Fallback RPC endpoints for each network, tried in order during health check.
 * The first healthy endpoint wins. Keep the SDK default first.
 */
export const FILECOIN_RPC_ENDPOINTS: Record<string, string[]> = {
  mainnet: [
    'https://api.node.glif.io/rpc/v1',       // Glif (SDK default)
    'https://rpc.ankr.com/filecoin',           // Ankr
    'https://filecoin.chainup.net/rpc/v1',     // ChainUp
    'https://filecoin.lava.build',             // Lava
  ],
  calibration: [
    'https://api.calibration.node.glif.io/rpc/v1',  // Glif (SDK default)
    'https://rpc.ankr.com/filecoin_testnet',          // Ankr
    'https://filecoin-calibration.chainup.net/rpc/v1', // ChainUp
  ],
  localnet: [
    'http://127.0.0.1:1234/rpc/v1',
  ],
}

/** Timeout in ms for each RPC health-check probe. */
export const RPC_HEALTH_CHECK_TIMEOUT = 3000

export interface FilecoinNetworkConfig {
  name: string
  isTestnet: boolean
  chainId: 't' | 'f' | 'localnet'
}

export const FILECOIN_NETWORKS: FilecoinNetworkConfig[] = [
  {
    name: 'Filecoin Mainnet',
    chainId: 'f',
    isTestnet: false
  },
  {
    name: 'Filecoin Calibration Testnet',
    chainId: 't',
    isTestnet: true
  },
  {
    name: 'Local Testnet',
    chainId: 'localnet',
    isTestnet: true
  }
]

export const FILECOIN_STORAGE_KEYS = {
  WALLETS: 'filecoin_wallets',
  CURRENT_NETWORK: 'filecoin_current_network',
  PASSWORD_SET_SESSION: 'filecoin_password_set_session'
} as const

// ==================== Filecoin Storage Reference Price ====================

export const FILECOIN_STORAGE_PRICING = {
  /** Storage price per TiB per month in USDFC (source: docs.filecoin.cloud) */
  PRICE_PER_TIB_PER_MONTH_USDFC: '2.50',
  /** Minimum monthly storage fee in USDFC (applies to data sets < 24.567 GiB) */
  MIN_MONTHLY_FEE_USDFC: '0.06',
  /** One-time sybil fee per new data set in USDFC */
  SYBIL_FEE_USDFC: '0.1',
  /** CDN egress price per TiB in USDFC */
  CDN_EGRESS_PER_TIB_USDFC: '14',
  /** Pricing note */
  PRICING_NOTE: 'Actual fees are determined dynamically by Synapse SDK and storage providers. The above are for reference only.',
  /** Minimum USDFC deposit amount for FilecoinPay contract to ensure sufficient lockup funds */
  MIN_DEPOSIT_USDFC: '1',
} as const

export const APP_CONFIG = {
  NAME: 'RedPill',
  VERSION: packageJson.version,
  THEME_COLOR: 'dc2626',
  SITE_FILE_NAME: 'site_info.json',
  TOP_TIPPED_WORKS_LIMIT: 12,
} as const

// ==================== Update configuration ====================

export const UPDATE_CONFIG = {
  // Whether to automatically check for updates (only once at startup)
  AUTO_CHECK: true,
  
  // Platform identity mapping
  PLATFORM_IDENTIFIERS: {
    'darwin-arm64': 'MacArm64',
    'darwin-x64': 'MacX64',
    'win32-x64': 'WinX64',
    'linux-x64': 'LinuxX64',
  } as const,
  
  // Platform file extension
  PLATFORM_EXTENSIONS: {
    'darwin-arm64': 'dmg',
    'darwin-x64': 'dmg',
    'win32-x64': 'exe',
    'linux-x64': 'AppImage',
  } as const,
} as const

// ==================== Content Template ====================

export const SITE_WORK_TEMPLATE = {
  title: '',
  desc: '',
  type: 0,
  img_cid: '',
  cid: ''
} as const

export type SiteWork = {
  title: string
  desc: string
  type: number
  img_cid: string
  cid: string
  published_at?: string
}

export const SITE_INFO_TEMPLATE: {
  title: string
  desc: string
  bg_cid: string
  works: SiteWork[]
} = {
  title: '',
  desc: '',
  bg_cid: '',
  works: []
}

export const ITEM_TYPE = [
  {
    name: 'img',
    label: 'Image',
    accept: 'image/png,image/jpeg,image/jpg,image/gif,image/webp',
    extensions: ['.png', '.jpg', '.jpeg', '.gif', '.webp']
  },
  {
    name: 'video',
    label: 'Video',
    accept: 'video/mp4,video/webm,video/ogg',
    extensions: ['.mp4', '.webm', '.ogg']
  },
  {
    name: 'audio',
    label: 'Audio',
    accept: 'audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/webm',
    extensions: ['.mp3', '.wav', '.ogg', '.webm', '.m4a']
  },
  {
    name: 'markdown',
    label: 'Markdown',
    accept: 'text/markdown,.md',
    extensions: ['.md', '.markdown']
  },
  {
    name: 'file',
    label: 'File',
    accept: '*',
    extensions: []
  }
] as const

export type ItemTypeName = typeof ITEM_TYPE[number]['name']

// ==================== Language Settings ====================

export interface LanguageConfig {
  code: string
  name: string
  nativeName: string
}

export const SUPPORTED_LANGUAGES: LanguageConfig[] = [
  {
    code: 'en-US',
    name: 'English (US)',
    nativeName: 'English'
  },
  {
    code: 'es-ES',
    name: 'Spanish',
    nativeName: 'Español'
  },
  {
    code: 'ru-RU',
    name: 'Russian',
    nativeName: 'Русский'
  },
  {
    code: 'fr-FR',
    name: 'French',
    nativeName: 'Français'
  },
  {
    code: 'de-DE',
    name: 'German',
    nativeName: 'Deutsch'
  },
  {
    code: 'ja-JP',
    name: 'Japanese',
    nativeName: '日本語'
  },
  {
    code: 'zh-CN',
    name: 'Simplified Chinese',
    nativeName: '简体中文'
  },
  {
    code: 'zh-TW',
    name: 'Traditional Chinese',
    nativeName: '繁體中文'
  },
  {
    code: 'ko-KR',
    name: 'Korean',
    nativeName: '한국어'
  }
] as const

export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number]['code']

export const DEFAULT_LANGUAGE: SupportedLanguage = 'en-US'
