/**
 * Port Manager / ポートマネージャー
 * Get dynamic allocated ports from main process in Electron environment / Electron 環境でメインプロセスから動的に割り当てられたポートを取得
 * Use default ports in Web environment / Web 環境ではデフォルトポートを使用
 */

import { DEFAULT_PORTS } from '../../config'

// Port cache / ポートキャッシュ
let cachedPorts: {
  dbServer: number
  ipfsApi: number
  ipfsGateway: number
  ipfsSwarm: number
} | null = null

// Platform info cache (obtained from main process, renderer cannot directly access process) / プラットフォーム情報キャッシュ（メインプロセスから取得、レンダラーはプロセスに直接アクセスできない）
let cachedPlatform: string | null = null
let cachedArch: string | null = null

/**
 * Get cached platform identifier (synchronous) / キャッシュされたプラットフォーム識別子を取得（同期）
 * Has value only after getServicePorts() is called / getServicePorts() 呼び出し後にのみ値を持つ
 */
export function getCachedPlatform(): string | null {
  return cachedPlatform
}

export function getCachedArch(): string | null {
  return cachedArch
}

/**
 * Detect if in Electron environment / Electron 環境かどうかを検出
 */
function isElectron(): boolean {
  return !!(
    typeof window !== 'undefined' &&
    window.electronAPI &&
    typeof window.electronAPI.getServicePorts === 'function'
  )
}

/**
 * Get service port configuration / サービスポート設定を取得
 * Get dynamic ports from main process in Electron environment / Electron 環境でメインプロセスから動的ポートを取得
 * Return default ports in Web environment / Web 環境ではデフォルトポートを返す
 */
export async function getServicePorts(): Promise<{
  dbServer: number
  ipfsApi: number
  ipfsGateway: number
  ipfsSwarm: number
}> {
  // If already cached, return directly / キャッシュ済みの場合は直接返す
  if (cachedPorts) {
    return cachedPorts
  }

  // Electron environment: get from main process / Electron環境：メインプロセスから取得
  if (isElectron()) {
    try {
      const ports = await window.electronAPI!.getServicePorts!()
      console.log('Got ports from Electron main process:', ports)
      cachedPorts = ports
      // Also cache platform info / プラットフォーム情報もキャッシュ
      if (ports.platform) cachedPlatform = ports.platform
      if (ports.arch) cachedArch = ports.arch
      return ports
    } catch (err) {
      console.warn('Failed to get Electron ports, using defaults:', err)
    }
  }

  // Web environment or fetch failed: use default ports / Web環境またはフェッチ失敗：デフォルトポートを使用
  const defaultPorts = {
    dbServer: DEFAULT_PORTS.DB_SERVER,
    ipfsApi: DEFAULT_PORTS.IPFS_API,
    ipfsGateway: DEFAULT_PORTS.IPFS_GATEWAY,
    ipfsSwarm: DEFAULT_PORTS.IPFS_SWARM,
  }

  cachedPorts = defaultPorts
  return defaultPorts
}

/**
 * Clear port cache (for testing or reinitialization) / ポートキャッシュをクリア（テストまたは再初期化用）
 */
export function clearPortCache(): void {
  cachedPorts = null
}

/**
 * Get dbSync API base URL / dbSync API ベース URL を取得
 */
export async function getDbApiBaseUrl(): Promise<string> {
  const ports = await getServicePorts()
  return `http://localhost:${ports.dbServer}/api`
}

/**
 * Get IPFS API base URL / IPFS API ベース URL を取得
 */
export async function getIpfsApiBaseUrl(): Promise<string> {
  const ports = await getServicePorts()
  return `http://127.0.0.1:${ports.ipfsApi}/api/v0`
}

/**
 * Get IPFS Gateway URL / IPFS Gateway URL を取得
 */
export async function getIpfsGatewayUrl(): Promise<string> {
  const ports = await getServicePorts()
  return `http://127.0.0.1:${ports.ipfsGateway}`
}
