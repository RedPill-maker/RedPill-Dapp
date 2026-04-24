/**
 * Private Data Manager - Secure Storage for Sensitive User Data
 *
 * ==================== Data Classification (5 localStorage keys) ====================
 *
 * 1. settings - Settings data
 *    - language: Language
 *    - theme: Theme
 *    - currentNetwork: Current network config
 *
 * 2. user_data - User data (independent of creator identity)
 *    - subscriptions: Subscription list
 *    - favorites: Favorites list
 *    - history: Browse history
 *
 * 3. creator_data - Creator data
 *    - currentId: Current on-chain creator username
 *    - creators: On-chain creator list (each contains pendingPublish, tipsLastSeen)
 *    - ipns: IPNS site info (at most one)
 *
 * 4. wallets - Wallet data
 *    - Encrypted wallet private key list
 *
 * 5. encrypted_password - Security password
 *    - Master password for encrypting wallets
 *
 * ==================== Storage Strategy ====================
 *
 * Web version: localStorage + AES-256 encryption
 * Desktop version: Future migration to Electron safeStorage API
 */

import { SITE_WORK_TEMPLATE, DEFAULT_LANGUAGE } from '../../config'
import CryptoJS from 'crypto-js'
import type { FilecoinNetworkConfig, SupportedLanguage } from '../../config'

// ==================== Storage key name constants ====================
const STORAGE_KEYS = {
  SETTINGS: 'redpill_settings',
  USER_DATA: 'redpill_user_data',
  CREATOR_DATA: 'redpill_creator_data',
  WALLETS: 'redpill_wallets',
  ENCRYPTED_PASSWORD: 'redpill_encrypted_password',
} as const

// ==================== Type definitions ====================

// Settings data
export interface SettingsData {
  language: SupportedLanguage
  theme: 'dark' | 'light'
  currentNetwork: FilecoinNetworkConfig | null
  autoUpdate: boolean
  saveSearchHistory: boolean
}

// Subscription item
export interface SubscriptionItem {
  ipns: string
  subscribedAt: string
  title?: string
  desc?: string
  username?: string
}

// Favorite item
export interface FavoriteItem {
  id: string
  title: string
  desc: string
  type: number
  img_cid: string
  cid: string
  favoriteAt: string
  source_ipns?: string
  creator_name?: string
}

// History item
export interface HistoryItem {
  id: string
  title: string
  desc: string
  type: number
  img_cid: string
  cid: string
  viewedAt: string
  source_ipns?: string
  creator_name?: string
}

// User data
export interface DownloadedItem {
  cid: string
  addedAt: string
}

export interface BlacklistedWork {
  cid: string
  title: string
  blockedAt: string
}

export interface BlacklistedCreator {
  username: string
  blockedAt: string
}

export interface UserData {
  subscriptions: SubscriptionItem[]
  favorites: FavoriteItem[]
  history: HistoryItem[]
  downloaded: DownloadedItem[]
  searchHistory: string[]
  blacklistedWorks: BlacklistedWork[]
  blacklistedCreators: BlacklistedCreator[]
}

// Pending publish item
export interface PendingPublishItem {
  id: string
  title: string
  desc: string
  type: number
  img_cid: string
  cid: string
  published_at: string
  pendingAt: string
}

// On-chain creator info
export interface OnchainCreatorInfo {
  username: string // primary key
  walletAddress: string
  avatarCid?: string
  backgroundCid?: string
  title?: string
  description?: string
  createdAt: string
  pendingPublish: PendingPublishItem[]
  tipsLastSeen: number
  filecoinPayEnabled?: boolean // whether FilecoinPay is enabled (at least one deposit completed)
  storedCids?: Record<string, string | { pieceCid: string; retrievalUrl?: string; dataSetId?: string }> // ipfsCid → pieceCid or {pieceCid, retrievalUrl, dataSetId}
}

// IPNS site info
export interface IPNSPendingWork {
  id: string
  title: string
  desc: string
  type: number
  img_cid: string
  cid: string
  published_at: string
  pendingAt: string
}

export interface IPNSInfo {
  ipnsId: string
  keyName?: string // for key export functionality
  title?: string
  desc?: string
  backgroundCid?: string
  createdAt: string
  pendingWorks?: IPNSPendingWork[]
}

// Creator mode type
export type CreatorMode = 'ipns' | 'fvm' | null

// IPNS site info cache — authoritative local state for IPNS mode creators
export interface IPNSSiteInfoCache {
  data: any // site_info.json content (works + profile)
  cachedAt: number // timestamp ms when last modified locally
  syncStatus: 'pending' | 'synced' // whether IPNS network reflects this cache
  lastSyncAttempt?: number // timestamp ms of last sync attempt
}

// CreatorData
export interface CreatorData {
  mode: CreatorMode // current creator mode: ipns/fvm/null
  currentId: string | null // current creator username in fvm mode
  creators: OnchainCreatorInfo[] // creator list in fvm mode
  ipns: IPNSInfo | null // site info in ipns mode
  ipnsSiteInfoCache?: IPNSSiteInfoCache | null
}

// Encrypted password info
export interface EncryptedPassword {
  salt: string
  hash: string
  iterations: number
  createdAt: string
}

// Encrypted wallet info
export interface EncryptedWallet {
  ethAddress: string
  filAddress: string
  encryptedPrivateKey: string
  encryptedMnemonic?: string
  createdAt: string
  name: string
  salt: string
  address: string
}

// Decrypted wallet info (only used in memory)
export interface DecryptedWallet {
  ethAddress: string
  filAddress: string
  privateKey: string
  mnemonic?: string
  createdAt: string
  name: string
  address: string
}

// Compatible with old CreatorInfo interface
export interface CreatorInfo {
  username?: string
  walletAddress?: string
  ipnsId?: string
  keyName?: string // for key export functionality
  avatarCid?: string // FVM mode only
  backgroundCid?: string
  title?: string
  description?: string
  desc?: string
  mode: 'ipns' | 'fvm'
  createdAt: string
  filecoinPayEnabled?: boolean // whether FilecoinPay is enabled (at least one deposit completed)
}

// ==================== Electron API type declaration ====================

interface ElectronSafeStorageAPI {
  isSafeStorageAvailable: () => Promise<boolean>
  safeStorageSet: (key: string, value: any) => Promise<boolean>
  safeStorageGet: (key: string) => Promise<any>
  safeStorageDelete: (key: string) => Promise<boolean>
}

declare global {
  interface Window {
    electronAPI?: ElectronSafeStorageAPI & Record<string, any>
  }
}

// Detect if running in Electron with safeStorage support
const isElectron = (): boolean => {
  return !!(window.electronAPI?.safeStorageSet && window.electronAPI?.safeStorageGet)
}

// ==================== Base storage operation class ====================

class StorageManager {
  // In-memory cache for non-sensitive data (loaded at init in Electron mode) / 非機密データのメモリ内キャッシュ（Electron モードで初期化時に読み込まれる）
  private _cache: Record<string, any> = {}
  private _cacheReady = false

  /**
   * Initialize non-sensitive data cache from Electron file storage.
   * Must be called once at app startup in Electron mode.
   * In web mode this is a no-op.
   */
  async init(): Promise<void> {
    if (!isElectron()) {
      this._cacheReady = true
      return
    }
    // Load non-sensitive keys into memory cache
    const nonSensitiveKeys = [STORAGE_KEYS.SETTINGS, STORAGE_KEYS.USER_DATA, STORAGE_KEYS.CREATOR_DATA]
    for (const key of nonSensitiveKeys) {
      const data = await window.electronAPI!.safeStorageGet(key)
      if (data !== null && data !== undefined) {
        this._cache[key] = data
      }
    }
    this._cacheReady = true
    console.log('StorageManager: Electron cache initialized')
  }

  // ---- Synchronous access for non-sensitive data ----

  protected getItem<T>(key: string, defaultValue: T): T {
    if (isElectron() && this._cacheReady) {
      const cached = this._cache[key]
      return cached !== undefined ? cached : defaultValue
    }
    try {
      const item = localStorage.getItem(key)
      return item ? JSON.parse(item) : defaultValue
    } catch (error) {
      console.error(`Error reading ${key} from localStorage:`, error)
      return defaultValue
    }
  }

  protected setItem<T>(key: string, value: T): boolean {
    if (isElectron()) {
      // Update in-memory cache immediately
      this._cache[key] = value
      // Async write-back to file (fire-and-forget for non-sensitive data)
      window.electronAPI!.safeStorageSet(key, value).catch((err: any) => {
        console.error(`Error writing ${key} to Electron storage:`, err)
      })
      return true
    }
    try {
      localStorage.setItem(key, JSON.stringify(value))
      return true
    } catch (error) {
      console.error(`Error writing ${key} to localStorage:`, error)
      return false
    }
  }

  // ---- Async access for sensitive data (wallets, password) ----

  protected async getItemAsync<T>(key: string, defaultValue: T): Promise<T> {
    if (isElectron()) {
      try {
        const data = await window.electronAPI!.safeStorageGet(key)
        return data !== null && data !== undefined ? data : defaultValue
      } catch (error) {
        console.error(`Error reading ${key} from Electron safe storage:`, error)
        return defaultValue
      }
    }
    // Web fallback
    try {
      const item = localStorage.getItem(key)
      return item ? JSON.parse(item) : defaultValue
    } catch (error) {
      console.error(`Error reading ${key} from localStorage:`, error)
      return defaultValue
    }
  }

  protected async setItemAsync<T>(key: string, value: T): Promise<boolean> {
    if (isElectron()) {
      try {
        return await window.electronAPI!.safeStorageSet(key, value)
      } catch (error) {
        console.error(`Error writing ${key} to Electron safe storage:`, error)
        return false
      }
    }
    // Web fallback
    try {
      localStorage.setItem(key, JSON.stringify(value))
      return true
    } catch (error) {
      console.error(`Error writing ${key} to localStorage:`, error)
      return false
    }
  }

  // Settings data
  protected getSettings(): SettingsData {
    return this.getItem(STORAGE_KEYS.SETTINGS, {
      language: DEFAULT_LANGUAGE,
      theme: 'dark' as const,
      currentNetwork: null,
      autoUpdate: true,
      saveSearchHistory: true,
    })
  }

  protected setSettings(settings: SettingsData): boolean {
    return this.setItem(STORAGE_KEYS.SETTINGS, settings)
  }

  // User data
  protected getUserData(): UserData {
    const data = this.getItem(STORAGE_KEYS.USER_DATA, {
      subscriptions: [],
      favorites: [],
      history: [],
      downloaded: [],
      searchHistory: [],
      blacklistedWorks: [],
      blacklistedCreators: [],
    })
    // Compatibility: handle missing fields from older data
    if (!data.downloaded) data.downloaded = []
    if (!data.searchHistory) data.searchHistory = []
    if (!data.blacklistedWorks) data.blacklistedWorks = []
    if (!data.blacklistedCreators) data.blacklistedCreators = []
    return data
  }

  protected setUserData(userData: UserData): boolean {
    return this.setItem(STORAGE_KEYS.USER_DATA, userData)
  }

  // Creator data
  protected getCreatorData(): CreatorData {
    return this.getItem<CreatorData>(STORAGE_KEYS.CREATOR_DATA, {
      mode: null,
      currentId: null,
      creators: [],
      ipns: null,
    })
  }

  protected setCreatorData(creatorData: CreatorData): boolean {
    return this.setItem(STORAGE_KEYS.CREATOR_DATA, creatorData)
  }

  // Wallet data (async — sensitive, uses safeStorage in Electron)
  protected async getWalletsData(): Promise<EncryptedWallet[]> {
    return this.getItemAsync(STORAGE_KEYS.WALLETS, [])
  }

  protected async setWalletsData(wallets: EncryptedWallet[]): Promise<boolean> {
    return this.setItemAsync(STORAGE_KEYS.WALLETS, wallets)
  }

  // Encrypted password (async — sensitive, uses safeStorage in Electron)
  protected async getEncryptedPassword(): Promise<EncryptedPassword | null> {
    return this.getItemAsync(STORAGE_KEYS.ENCRYPTED_PASSWORD, null)
  }

  protected async setEncryptedPassword(passwordInfo: EncryptedPassword | null): Promise<boolean> {
    return this.setItemAsync(STORAGE_KEYS.ENCRYPTED_PASSWORD, passwordInfo)
  }
}

// ==================== Private Data Manager ====================

class PrivateDataManager extends StorageManager {
  // ========== Settings Management ==========

  getLanguage(): SupportedLanguage {
    return this.getSettings().language
  }

  setLanguage(language: SupportedLanguage): boolean {
    const settings = this.getSettings()
    settings.language = language
    return this.setSettings(settings)
  }

  getTheme(): 'dark' | 'light' {
    return this.getSettings().theme
  }

  setTheme(theme: 'dark' | 'light'): boolean {
    const settings = this.getSettings()
    settings.theme = theme
    return this.setSettings(settings)
  }

  getCurrentNetwork(): FilecoinNetworkConfig | null {
    return this.getSettings().currentNetwork
  }

  setCurrentNetwork(network: FilecoinNetworkConfig): boolean {
    const settings = this.getSettings()
    settings.currentNetwork = network
    return this.setSettings(settings)
  }

  getAutoUpdate(): boolean {
    return this.getSettings().autoUpdate
  }

  setAutoUpdate(enabled: boolean): boolean {
    const settings = this.getSettings()
    settings.autoUpdate = enabled
    return this.setSettings(settings)
  }

  getSaveSearchHistory(): boolean {
    const val = this.getSettings().saveSearchHistory
    return val === undefined ? true : val
  }

  setSaveSearchHistory(enabled: boolean): boolean {
    const settings = this.getSettings()
    settings.saveSearchHistory = enabled
    return this.setSettings(settings)
  }

  // ========== Search History ==========

  addSearchHistory(query: string): boolean {
    if (!this.getSaveSearchHistory()) return false
    const trimmed = query.trim()
    if (!trimmed) return false
    const userData = this.getUserData()
    const history = userData.searchHistory || []
    // Remove duplicate, then prepend
    const filtered = history.filter((q) => q !== trimmed)
    userData.searchHistory = [trimmed, ...filtered].slice(0, 10)
    return this.setUserData(userData)
  }

  getSearchHistory(): string[] {
    return this.getUserData().searchHistory || []
  }

  clearSearchHistory(): boolean {
    const userData = this.getUserData()
    userData.searchHistory = []
    return this.setUserData(userData)
  }

  // ========== Subscription Management ==========

  addSubscription(ipns: string, title?: string, desc?: string): boolean {
    if (!ipns) return false
    const userData = this.getUserData()
    if (userData.subscriptions.some((sub) => sub.ipns === ipns)) return false

    userData.subscriptions.unshift({
      ipns,
      subscribedAt: new Date().toISOString(),
      title,
      desc,
    })
    return this.setUserData(userData)
  }

  removeSubscription(ipns: string): boolean {
    if (!ipns) return false
    const userData = this.getUserData()
    const len = userData.subscriptions.length
    userData.subscriptions = userData.subscriptions.filter((sub) => sub.ipns !== ipns)
    if (userData.subscriptions.length === len) return false
    return this.setUserData(userData)
  }

  getAllSubscriptions(): SubscriptionItem[] {
    return this.getUserData().subscriptions
  }

  isSubscribed(ipns: string): boolean {
    return this.getUserData().subscriptions.some((sub) => sub.ipns === ipns)
  }

  isSubscribedByUsernameOrIpns(username?: string, ipns?: string): boolean {
    return this.getUserData().subscriptions.some(
      (sub) => (username && sub.username === username) || (ipns && sub.ipns === ipns)
    )
  }

  addSubscriptionEx(params: { ipns?: string; username?: string; title?: string; desc?: string }): boolean {
    if (!params.ipns && !params.username) return false
    const userData = this.getUserData()
    const exists = userData.subscriptions.some(
      (sub) => (params.username && sub.username === params.username) || (params.ipns && sub.ipns === params.ipns)
    )
    if (exists) return false

    userData.subscriptions.unshift({
      ipns: params.ipns || '',
      subscribedAt: new Date().toISOString(),
      title: params.title,
      desc: params.desc,
      username: params.username,
    })
    return this.setUserData(userData)
  }

  removeSubscriptionByUsernameOrIpns(username?: string, ipns?: string): boolean {
    if (!username && !ipns) return false
    const userData = this.getUserData()
    const len = userData.subscriptions.length
    userData.subscriptions = userData.subscriptions.filter(
      (sub) => !((username && sub.username === username) || (ipns && sub.ipns === ipns))
    )
    if (userData.subscriptions.length === len) return false
    return this.setUserData(userData)
  }

  // ========== Favorite Management ==========

  addFavorite(item: Omit<FavoriteItem, 'favoriteAt'>): boolean {
    if (!item.id || !item.cid) return false
    const userData = this.getUserData()
    if (userData.favorites.some((fav) => fav.id === item.id || fav.cid === item.cid)) return false

    userData.favorites.unshift({ ...item, favoriteAt: new Date().toISOString() })
    return this.setUserData(userData)
  }

  removeFavorite(id: string): boolean {
    if (!id) return false
    const userData = this.getUserData()
    const len = userData.favorites.length
    userData.favorites = userData.favorites.filter((fav) => fav.id !== id && fav.cid !== id)
    if (userData.favorites.length === len) return false
    return this.setUserData(userData)
  }

  getAllFavorites(): FavoriteItem[] {
    return this.getUserData().favorites
  }

  isFavorited(id: string): boolean {
    return this.getUserData().favorites.some((fav) => fav.id === id || fav.cid === id)
  }

  // ========== History Management ==========

  addHistory(item: Omit<HistoryItem, 'viewedAt'>): boolean {
    if (!item.id || !item.cid) return false
    const userData = this.getUserData()
    userData.history = userData.history.filter((h) => h.id !== item.id && h.cid !== item.cid)
    userData.history.unshift({ ...item, viewedAt: new Date().toISOString() })
    userData.history = userData.history.slice(0, 1000)
    return this.setUserData(userData)
  }

  removeHistory(id: string): boolean {
    if (!id) return false
    const userData = this.getUserData()
    const len = userData.history.length
    userData.history = userData.history.filter((h) => h.id !== id && h.cid !== id)
    if (userData.history.length === len) return false
    return this.setUserData(userData)
  }

  getAllHistory(): HistoryItem[] {
    return this.getUserData().history
  }

  clearHistory(): boolean {
    const userData = this.getUserData()
    userData.history = []
    return this.setUserData(userData)
  }

  // ========== Local Download Management ==========

  addDownloaded(cid: string): boolean {
    if (!cid) return false
    const userData = this.getUserData()
    if (userData.downloaded.some((d) => d.cid === cid)) return false
    userData.downloaded.unshift({ cid, addedAt: new Date().toISOString() })
    return this.setUserData(userData)
  }

  removeDownloaded(cid: string): boolean {
    if (!cid) return false
    const userData = this.getUserData()
    const len = userData.downloaded.length
    userData.downloaded = userData.downloaded.filter((d) => d.cid !== cid)
    if (userData.downloaded.length === len) return false
    return this.setUserData(userData)
  }

  getAllDownloaded(): DownloadedItem[] {
    return this.getUserData().downloaded
  }

  isDownloaded(cid: string): boolean {
    return this.getUserData().downloaded.some((d) => d.cid === cid)
  }

  // ========== Data Statistics and Import/Export ==========

  getStats() {
    const userData = this.getUserData()
    return {
      subscriptions: userData.subscriptions.length,
      favorites: userData.favorites.length,
      history: userData.history.length,
      favoritesByType: {
        file: userData.favorites.filter((f) => f.type === 0).length,
        video: userData.favorites.filter((f) => f.type === 1).length,
        audio: userData.favorites.filter((f) => f.type === 2).length,
        markdown: userData.favorites.filter((f) => f.type === 3).length,
      },
      historyByType: {
        file: userData.history.filter((h) => h.type === 0).length,
        video: userData.history.filter((h) => h.type === 1).length,
        audio: userData.history.filter((h) => h.type === 2).length,
        markdown: userData.history.filter((h) => h.type === 3).length,
      },
    }
  }

  exportAllData() {
    const userData = this.getUserData()
    return {
      subscriptions: userData.subscriptions,
      favorites: userData.favorites,
      history: userData.history,
      exportedAt: new Date().toISOString(),
    }
  }

  importData(data: any, merge: boolean = false): boolean {
    try {
      const userData = this.getUserData()
      if (merge) {
        if (data.subscriptions) {
          const newSubs = data.subscriptions.filter(
            (sub: SubscriptionItem) => !userData.subscriptions.some((s) => s.ipns === sub.ipns)
          )
          userData.subscriptions = [...userData.subscriptions, ...newSubs]
        }
        if (data.favorites) {
          const newFavs = data.favorites.filter(
            (fav: FavoriteItem) => !userData.favorites.some((f) => f.id === fav.id || f.cid === fav.cid)
          )
          userData.favorites = [...userData.favorites, ...newFavs]
        }
        if (data.history) {
          const newHist = data.history.filter(
            (h: HistoryItem) => !userData.history.some((hist) => hist.id === h.id || hist.cid === h.cid)
          )
          userData.history = [...userData.history, ...newHist]
        }
      } else {
        if (data.subscriptions) userData.subscriptions = data.subscriptions
        if (data.favorites) userData.favorites = data.favorites
        if (data.history) userData.history = data.history
      }
      return this.setUserData(userData)
    } catch (error) {
      console.error('Error importing data:', error)
      return false
    }
  }

  // ========== On-chain Creator Management ==========

  getCurrentCreator(): OnchainCreatorInfo | null {
    const data = this.getCreatorData()
    if (!data.currentId) return null
    return data.creators.find((c) => c.username === data.currentId) || null
  }

  setCurrentCreator(username: string | null): boolean {
    const data = this.getCreatorData()
    if (username && !data.creators.some((c) => c.username === username)) return false
    data.currentId = username
    return this.setCreatorData(data)
  }

  addCreator(creator: Omit<OnchainCreatorInfo, 'pendingPublish' | 'tipsLastSeen'>): boolean {
    const data = this.getCreatorData()
    if (data.creators.some((c) => c.username === creator.username)) return false

    data.creators.push({
      ...creator,
      pendingPublish: [],
      tipsLastSeen: 0,
    })
    return this.setCreatorData(data)
  }

  updateCreator(username: string, updates: Partial<OnchainCreatorInfo>): boolean {
    const data = this.getCreatorData()
    const idx = data.creators.findIndex((c) => c.username === username)
    if (idx === -1) return false

    data.creators[idx] = { ...data.creators[idx], ...updates, username }
    return this.setCreatorData(data)
  }

  removeCreator(username: string): boolean {
    const data = this.getCreatorData()
    const len = data.creators.length
    data.creators = data.creators.filter((c) => c.username !== username)
    if (data.creators.length === len) return false
    if (data.currentId === username) data.currentId = null
    return this.setCreatorData(data)
  }

  getAllCreators(): OnchainCreatorInfo[] {
    return this.getCreatorData().creators
  }

  getCreatorByUsername(username: string): OnchainCreatorInfo | null {
    return this.getCreatorData().creators.find((c) => c.username === username) || null
  }

  // ========== On-chain storage CID mapping management ==========

  /** Record ipfsCid → { pieceCid, retrievalUrl?, dataSetId?, providerName?, providerServiceURL? } mapping for a creator */
  addStoredCid(username: string, ipfsCid: string, pieceCid: string, retrievalUrl?: string, dataSetId?: string, providerName?: string, providerServiceURL?: string): boolean {
    const data = this.getCreatorData()
    const idx = data.creators.findIndex((c) => c.username === username)
    if (idx === -1) return false
    if (!data.creators[idx].storedCids) data.creators[idx].storedCids = {}
    const entry: { pieceCid: string; retrievalUrl?: string; dataSetId?: string; providerName?: string; providerServiceURL?: string } = { pieceCid }
    if (retrievalUrl) entry.retrievalUrl = retrievalUrl
    if (dataSetId) entry.dataSetId = dataSetId
    if (providerName) entry.providerName = providerName
    if (providerServiceURL) entry.providerServiceURL = providerServiceURL
    data.creators[idx].storedCids![ipfsCid] = Object.keys(entry).length === 1 ? pieceCid : entry
    return this.setCreatorData(data)
  }

  /** Update retrievalUrl for an existing stored CID */
  updateStoredCidRetrievalUrl(username: string, ipfsCid: string, retrievalUrl: string): boolean {
    const data = this.getCreatorData()
    const idx = data.creators.findIndex((c) => c.username === username)
    if (idx === -1) return false
    const entry = data.creators[idx].storedCids?.[ipfsCid]
    if (!entry) return false
    const existing = typeof entry === 'string' ? { pieceCid: entry } : entry
    data.creators[idx].storedCids![ipfsCid] = { ...existing, retrievalUrl }
    return this.setCreatorData(data)
  }

  /** Get storedCids mapping for a creator, normalized to { pieceCid, retrievalUrl?, dataSetId?, providerName?, providerServiceURL? } */
  getStoredCids(username: string): Record<string, { pieceCid: string; retrievalUrl?: string; dataSetId?: string; providerName?: string; providerServiceURL?: string }> {
    const raw = this.getCreatorByUsername(username)?.storedCids ?? {}
    const result: Record<string, { pieceCid: string; retrievalUrl?: string; dataSetId?: string; providerName?: string; providerServiceURL?: string }> = {}
    for (const [cid, val] of Object.entries(raw)) {
      result[cid] = typeof val === 'string' ? { pieceCid: val } : val
    }
    return result
  }

  // ========== Pending Publish Management (creator level) / 保留中の公開管理（クリエイターレベル） ==========

  addPendingPublish(item: Omit<PendingPublishItem, 'pendingAt'>): boolean {
    const creator = this.getCurrentCreator()
    if (!creator || !item.id || !item.cid) return false

    if (creator.pendingPublish.some((p) => p.id === item.id || p.cid === item.cid)) return false

    creator.pendingPublish.unshift({ ...item, pendingAt: new Date().toISOString() })
    return this.updateCreator(creator.username, { pendingPublish: creator.pendingPublish })
  }

  removePendingPublish(id: string): boolean {
    const creator = this.getCurrentCreator()
    if (!creator || !id) return false

    const len = creator.pendingPublish.length
    creator.pendingPublish = creator.pendingPublish.filter((p) => p.id !== id && p.cid !== id)
    if (creator.pendingPublish.length === len) return false
    return this.updateCreator(creator.username, { pendingPublish: creator.pendingPublish })
  }

  getAllPendingPublish(): PendingPublishItem[] {
    return this.getCurrentCreator()?.pendingPublish || []
  }

  isPendingPublish(id: string): boolean {
    return this.getCurrentCreator()?.pendingPublish.some((p) => p.id === id || p.cid === id) || false
  }

  clearPendingPublish(): boolean {
    const creator = this.getCurrentCreator()
    if (!creator) return false
    return this.updateCreator(creator.username, { pendingPublish: [] })
  }

  removeConfirmedPendingItems(confirmedCids: string[]): number {
    const creator = this.getCurrentCreator()
    if (!creator) return 0

    const initialCount = creator.pendingPublish.length
    creator.pendingPublish = creator.pendingPublish.filter((p) => !confirmedCids.includes(p.cid))
    this.updateCreator(creator.username, { pendingPublish: creator.pendingPublish })
    return initialCount - creator.pendingPublish.length
  }

  // ========== Tip View Time Management (creator level) ==========

  setTipsLastSeen(creatorAddress: string, blockNumber: number): void {
    const data = this.getCreatorData()
    const creator = data.creators.find((c) => c.walletAddress?.toLowerCase() === creatorAddress.toLowerCase())
    if (creator) {
      creator.tipsLastSeen = blockNumber
      this.setCreatorData(data)
    }
  }

  getTipsLastSeen(creatorAddress: string): number {
    const data = this.getCreatorData()
    const creator = data.creators.find((c) => c.walletAddress?.toLowerCase() === creatorAddress.toLowerCase())
    return creator?.tipsLastSeen || 0
  }

  // ========== IPNS Site Management ==========

  getIPNSInfo(): IPNSInfo | null {
    return this.getCreatorData().ipns
  }

  setIPNSInfo(ipns: IPNSInfo | null): boolean {
    const data = this.getCreatorData()
    data.ipns = ipns
    return this.setCreatorData(data)
  }

  hasIPNS(): boolean {
    return this.getCreatorData().ipns !== null
  }

  clearIPNS(): boolean {
    return this.setIPNSInfo(null)
  }

  // ========== IPNS pending works management ==========

  addIPNSPendingWork(item: Omit<IPNSPendingWork, 'pendingAt'>): boolean {
    const ipns = this.getIPNSInfo()
    if (!ipns || !item.cid) return false
    const pending = ipns.pendingWorks || []
    if (pending.some((p) => p.cid === item.cid)) return false
    ipns.pendingWorks = [{ ...item, pendingAt: new Date().toISOString() }, ...pending]
    return this.setIPNSInfo(ipns)
  }

  getIPNSPendingWorks(): IPNSPendingWork[] {
    return this.getIPNSInfo()?.pendingWorks || []
  }

  removeConfirmedIPNSPendingWorks(confirmedCids: string[]): void {
    const ipns = this.getIPNSInfo()
    if (!ipns?.pendingWorks) return
    ipns.pendingWorks = ipns.pendingWorks.filter((p) => !confirmedCids.includes(p.cid))
    this.setIPNSInfo(ipns)
  }

  // ========== IPNS Site Info Cache (authoritative local state for IPNS mode) ==========

  private static IPNS_CACHE_TTL = 30 * 24 * 60 * 60 * 1000 // 30 days (effectively permanent until cleared)

  /** Write or update the cache. Marks syncStatus as 'pending'. */
  setIPNSSiteInfoCache(siteData: any): boolean {
    const data = this.getCreatorData()
    data.ipnsSiteInfoCache = {
      data: siteData,
      cachedAt: Date.now(),
      syncStatus: 'pending',
    }
    return this.setCreatorData(data)
  }

  /** Get cached site_info data, or null if no cache. */
  getIPNSSiteInfoCache(): IPNSSiteInfoCache | null {
    const cache = this.getCreatorData().ipnsSiteInfoCache
    if (!cache) return null
    return cache
  }

  /** Mark cache as synced with IPNS network. */
  markIPNSSiteInfoCacheSynced(): boolean {
    const data = this.getCreatorData()
    if (!data.ipnsSiteInfoCache) return false
    data.ipnsSiteInfoCache.syncStatus = 'synced'
    data.ipnsSiteInfoCache.lastSyncAttempt = Date.now()
    return this.setCreatorData(data)
  }

  /** Update lastSyncAttempt without changing syncStatus. */
  updateIPNSSyncAttempt(): boolean {
    const data = this.getCreatorData()
    if (!data.ipnsSiteInfoCache) return false
    data.ipnsSiteInfoCache.lastSyncAttempt = Date.now()
    return this.setCreatorData(data)
  }

  clearIPNSSiteInfoCache(): boolean {
    const data = this.getCreatorData()
    data.ipnsSiteInfoCache = null
    return this.setCreatorData(data)
  }

  // ========== Compatible with old CreatorInfo interface / 古い CreatorInfo インターフェースと互換性 ==========

  /**
   * Get current creator info
   * Determines which type of creator data to return based on mode field
   */
  getCreatorInfo(): CreatorInfo | null {
    const data = this.getCreatorData()

    // Determine what to return based on mode
    switch (data.mode) {
      case 'fvm':
        // FVM mode: return current on-chain creator
        if (data.currentId) {
          const creator = data.creators.find((c) => c.username === data.currentId)
          if (creator) {
            return {
              username: creator.username,
              walletAddress: creator.walletAddress,
              avatarCid: creator.avatarCid,
              backgroundCid: creator.backgroundCid,
              title: creator.title,
              description: creator.description,
              mode: 'fvm',
              createdAt: creator.createdAt,
              filecoinPayEnabled: creator.filecoinPayEnabled,
              // Include IPNS id if the creator previously had an IPNS site
              ipnsId: data.ipns?.ipnsId,
            }
          }
        }
        return null

      case 'ipns':
        // IPNS mode: return IPNS info
        if (data.ipns) {
          return {
            ipnsId: data.ipns.ipnsId,
            keyName: data.ipns.keyName,
            title: data.ipns.title,
            desc: data.ipns.desc,
            backgroundCid: data.ipns.backgroundCid,
            mode: 'ipns',
            createdAt: data.ipns.createdAt,
          }
        }
        return null

      default:
        // mode is null, not a creator
        return null
    }
  }

  // ========== FilecoinPay status management ==========

  setFilecoinPayEnabled(enabled: boolean): boolean {
    const creator = this.getCurrentCreator()
    if (!creator) return false
    return this.updateCreator(creator.username, { filecoinPayEnabled: enabled })
  }

  isFilecoinPayEnabled(): boolean {
    return this.getCurrentCreator()?.filecoinPayEnabled || false
  }

  /**
   * Set creator info
   * Automatically sets the corresponding mode
   */
  setCreatorInfo(creatorInfo: CreatorInfo | null): boolean {
    const data = this.getCreatorData()

    if (!creatorInfo) {
      // Clear creator mode
      data.mode = null
      data.currentId = null
      return this.setCreatorData(data)
    }

    if (creatorInfo.mode === 'fvm' && creatorInfo.username) {
      // FVM mode
      const existing = this.getCreatorByUsername(creatorInfo.username)
      if (existing) {
        this.updateCreator(creatorInfo.username, {
          walletAddress: creatorInfo.walletAddress,
          avatarCid: creatorInfo.avatarCid,
          backgroundCid: creatorInfo.backgroundCid,
          title: creatorInfo.title,
          description: creatorInfo.description || creatorInfo.desc,
        })
      } else {
        this.addCreator({
          username: creatorInfo.username,
          walletAddress: creatorInfo.walletAddress || '',
          avatarCid: creatorInfo.avatarCid,
          backgroundCid: creatorInfo.backgroundCid,
          title: creatorInfo.title,
          description: creatorInfo.description || creatorInfo.desc,
          createdAt: creatorInfo.createdAt,
        })
      }
      // Set mode and currentId
      const updatedData = this.getCreatorData()
      updatedData.mode = 'fvm'
      updatedData.currentId = creatorInfo.username
      return this.setCreatorData(updatedData)
    } else if (creatorInfo.mode === 'ipns' && creatorInfo.ipnsId) {
      // IPNS mode
      data.mode = 'ipns'
      data.ipns = {
        ipnsId: creatorInfo.ipnsId,
        keyName: creatorInfo.keyName,
        title: creatorInfo.title,
        desc: creatorInfo.desc || creatorInfo.description,
        backgroundCid: creatorInfo.backgroundCid,
        createdAt: creatorInfo.createdAt,
      }
      return this.setCreatorData(data)
    }
    return false
  }

  /**
   * Get current creator mode
   */
  getCreatorMode(): CreatorMode {
    return this.getCreatorData().mode
  }

  /**
   * Set creator mode
   */
  setCreatorMode(mode: CreatorMode): boolean {
    const data = this.getCreatorData()
    data.mode = mode
    return this.setCreatorData(data)
  }

  hasCreatorInfo(): boolean {
    return this.getCreatorData().mode !== null
  }

  clearCreatorInfo(): boolean {
    const data = this.getCreatorData()
    data.mode = null
    data.currentId = null
    return this.setCreatorData(data)
  }

  /** @deprecated Use setIPNSInfo instead */
  setCreatorIPNSInfo(ipnsInfo: CreatorInfo): boolean {
    return this.setCreatorInfo(ipnsInfo)
  }

  /** @deprecated Use getIPNSInfo instead */
  getCreatorIPNSInfo(): CreatorInfo | null {
    const ipns = this.getIPNSInfo()
    if (!ipns) return null
    return {
      ipnsId: ipns.ipnsId,
      keyName: ipns.keyName,
      title: ipns.title,
      desc: ipns.desc,
      mode: 'ipns',
      createdAt: ipns.createdAt,
    }
  }

  /** @deprecated */
  hasCreatorIPNS(): boolean {
    return this.hasIPNS()
  }

  /** @deprecated */
  clearCreatorIPNS(): boolean {
    return this.clearIPNS()
  }

  // ========== Blacklist Management ==========

  addBlacklistedWork(cid: string, title: string): boolean {
    if (!cid) return false
    const userData = this.getUserData()
    if (userData.blacklistedWorks.some((w) => w.cid === cid)) return false
    userData.blacklistedWorks.unshift({ cid, title, blockedAt: new Date().toISOString() })
    // Also remove from favorites, history
    userData.favorites = userData.favorites.filter((f) => f.cid !== cid && f.id !== cid)
    userData.history = userData.history.filter((h) => h.cid !== cid && h.id !== cid)
    return this.setUserData(userData)
  }

  removeBlacklistedWork(cid: string): boolean {
    if (!cid) return false
    const userData = this.getUserData()
    const len = userData.blacklistedWorks.length
    userData.blacklistedWorks = userData.blacklistedWorks.filter((w) => w.cid !== cid)
    if (userData.blacklistedWorks.length === len) return false
    return this.setUserData(userData)
  }

  addBlacklistedCreator(username: string): boolean {
    if (!username) return false
    const userData = this.getUserData()
    if (userData.blacklistedCreators.some((c) => c.username === username)) return false
    userData.blacklistedCreators.unshift({ username, blockedAt: new Date().toISOString() })
    // Remove from favorites, history, subscriptions
    userData.favorites = userData.favorites.filter((f) => f.creator_name !== username)
    userData.history = userData.history.filter((h) => h.creator_name !== username)
    userData.subscriptions = userData.subscriptions.filter((s) => s.username !== username)
    return this.setUserData(userData)
  }

  removeBlacklistedCreator(username: string): boolean {
    if (!username) return false
    const userData = this.getUserData()
    const len = userData.blacklistedCreators.length
    userData.blacklistedCreators = userData.blacklistedCreators.filter((c) => c.username !== username)
    if (userData.blacklistedCreators.length === len) return false
    return this.setUserData(userData)
  }

  getAllBlacklistedWorks(): BlacklistedWork[] {
    return this.getUserData().blacklistedWorks
  }

  getAllBlacklistedCreators(): BlacklistedCreator[] {
    return this.getUserData().blacklistedCreators
  }

  isWorkBlacklisted(cid: string): boolean {
    return this.getUserData().blacklistedWorks.some((w) => w.cid === cid)
  }

  isCreatorBlacklisted(username: string): boolean {
    return this.getUserData().blacklistedCreators.some((c) => c.username === username)
  }

  // ========== Password management ==========

  private generateSalt(): string {
    return CryptoJS.lib.WordArray.random(256 / 8).toString()
  }

  private hashPassword(password: string, salt: string, iterations: number = 10000): string {
    return CryptoJS.PBKDF2(password, salt, { keySize: 256 / 32, iterations }).toString()
  }

  async setPassword(password: string): Promise<boolean> {
    if (!password || password.length < 4) {
      throw new Error('Password cannot be empty')
    }
    const salt = this.generateSalt()
    const iterations = 10000
    const hash = this.hashPassword(password, salt, iterations)
    return this.setEncryptedPassword({ salt, hash, iterations, createdAt: new Date().toISOString() })
  }

  async verifyPassword(password: string): Promise<boolean> {
    const encryptedPassword = await this.getEncryptedPassword()
    if (!encryptedPassword) return false
    const { salt, hash, iterations } = encryptedPassword
    return this.hashPassword(password, salt, iterations) === hash
  }

  async hasPassword(): Promise<boolean> {
    return (await this.getEncryptedPassword()) !== null
  }

  async clearPassword(): Promise<boolean> {
    return this.setEncryptedPassword(null)
  }

  encryptData(data: string, password: string): string {
    return CryptoJS.AES.encrypt(data, password).toString()
  }

  decryptData(encryptedData: string, password: string): string {
    const bytes = CryptoJS.AES.decrypt(encryptedData, password)
    return bytes.toString(CryptoJS.enc.Utf8)
  }

  // ========== Wallet management ==========

  async saveWallet(ethAddress: string, filAddress: string, privateKey: string, password: string, name: string, mnemonic?: string): Promise<boolean> {
    try {
      const wallets = await this.getWalletsData()
      if (wallets.some((w) => w.ethAddress.toLowerCase() === ethAddress.toLowerCase())) return false

      const salt = CryptoJS.lib.WordArray.random(128 / 8).toString()
      const encryptedPrivateKey = CryptoJS.AES.encrypt(privateKey, password + salt).toString()
      const encryptedMnemonic = mnemonic ? CryptoJS.AES.encrypt(mnemonic, password + salt).toString() : undefined

      wallets.push({
        ethAddress,
        filAddress,
        address: ethAddress,
        encryptedPrivateKey,
        encryptedMnemonic,
        createdAt: new Date().toISOString(),
        name,
        salt,
      })
      return this.setWalletsData(wallets)
    } catch (error) {
      console.error('Error saving wallet:', error)
      return false
    }
  }

  async getWallets(): Promise<EncryptedWallet[]> {
    return this.getWalletsData()
  }

  async getWalletList(): Promise<Array<{ ethAddress: string; filAddress: string; address: string; name: string; createdAt: string }>> {
    return (await this.getWalletsData()).map((w) => ({
      ethAddress: w.ethAddress,
      filAddress: w.filAddress,
      address: w.ethAddress,
      name: w.name,
      createdAt: w.createdAt,
    }))
  }

  async getWalletByAddress(address: string): Promise<EncryptedWallet | undefined> {
    const normalizedAddress = address.toLowerCase()
    return (await this.getWalletsData()).find(
      (w) => w.ethAddress.toLowerCase() === normalizedAddress || w.filAddress.toLowerCase() === normalizedAddress || w.address?.toLowerCase() === normalizedAddress
    )
  }

  async decryptWallet(address: string, password: string): Promise<DecryptedWallet | null> {
    try {
      const encryptedWallet = await this.getWalletByAddress(address)
      if (!encryptedWallet) return null

      const privateKey = CryptoJS.AES.decrypt(encryptedWallet.encryptedPrivateKey, password + encryptedWallet.salt).toString(CryptoJS.enc.Utf8)
      if (!privateKey) return null

      const mnemonic = encryptedWallet.encryptedMnemonic
        ? CryptoJS.AES.decrypt(encryptedWallet.encryptedMnemonic, password + encryptedWallet.salt).toString(CryptoJS.enc.Utf8)
        : undefined

      return {
        ethAddress: encryptedWallet.ethAddress,
        filAddress: encryptedWallet.filAddress,
        address: encryptedWallet.ethAddress,
        privateKey,
        mnemonic,
        createdAt: encryptedWallet.createdAt,
        name: encryptedWallet.name,
      }
    } catch (error) {
      console.error('Error decrypting wallet:', error)
      return null
    }
  }

  async deleteWallet(address: string): Promise<boolean> {
    try {
      const wallets = await this.getWalletsData()
      const normalizedAddress = address.toLowerCase()
      const filtered = wallets.filter(
        (w) => w.ethAddress.toLowerCase() !== normalizedAddress && w.filAddress.toLowerCase() !== normalizedAddress && w.address?.toLowerCase() !== normalizedAddress
      )
      if (filtered.length === wallets.length) return false
      return this.setWalletsData(filtered)
    } catch (error) {
      console.error('Error deleting wallet:', error)
      return false
    }
  }

  async renameWallet(address: string, newName: string): Promise<boolean> {
    try {
      const wallets = await this.getWalletsData()
      const normalizedAddress = address.toLowerCase()
      const wallet = wallets.find(
        (w) => w.ethAddress.toLowerCase() === normalizedAddress || w.filAddress.toLowerCase() === normalizedAddress || w.address?.toLowerCase() === normalizedAddress
      )
      if (!wallet) return false
      wallet.name = newName
      return this.setWalletsData(wallets)
    } catch (error) {
      console.error('Error renaming wallet:', error)
      return false
    }
  }

  async verifyWalletPassword(address: string, password: string): Promise<boolean> {
    return (await this.decryptWallet(address, password)) !== null
  }
}

export const privateDataMgr = new PrivateDataManager()
export { STORAGE_KEYS }
export default privateDataMgr
