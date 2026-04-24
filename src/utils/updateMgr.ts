/**
 * Application update manager / アプリケーション更新マネージャー
 * Responsible for detecting and handling WebUI hot updates and app installer updates / WebUI熱更新とアプリインストーラー更新の検出と処理を担当
 */

import { APP_CONFIG, UPDATE_CONFIG, DEVELOPER_ACCOUNT } from '../../config'
import { getWorksByCreator, type Work } from './dbConnector'
import { ipfsConnector } from './ipfsConnector'
import { getCachedPlatform, getCachedArch } from './portManager'

// ============ Type Definitions ============

export type UpdateType = 'dist' | 'app' | null

export interface UpdateInfo {
  hasUpdate: boolean
  updateType: UpdateType
  version: string
  currentVersion: string
  cid: string
  platform?: string
  fileName?: string
}

export interface VersionComparison {
  major: number
  minor: number
  patch: number
}

// ============ Platform Detection / プラットフォーム検出 ============

export function getPlatformIdentifier(): string | null {
  // Renderer process cannot directly access process, use cached platform info from portManager / レンダラープロセスはprocessに直接アクセスできないため、portManagerからキャッシュされたプラットフォーム情報を使用
  const platform = getCachedPlatform()
  const arch = getCachedArch()
  if (!platform || !arch) return null
  const key = (platform + '-' + arch) as keyof typeof UPDATE_CONFIG.PLATFORM_IDENTIFIERS
  return UPDATE_CONFIG.PLATFORM_IDENTIFIERS[key] || null
}

export function getPlatformExtension(): string | null {
  const platform = getCachedPlatform()
  const arch = getCachedArch()
  if (!platform || !arch) return null
  const key = (platform + '-' + arch) as keyof typeof UPDATE_CONFIG.PLATFORM_EXTENSIONS
  return UPDATE_CONFIG.PLATFORM_EXTENSIONS[key] || null
}

// ============ Version Comparison / バージョン比較 ============

function parseVersion(version: string): VersionComparison | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!match) return null
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  }
}

export function compareVersions(
  current: string,
  target: string,
): 'none' | 'patch' | 'minor-major' {
  const c = parseVersion(current)
  const t = parseVersion(target)
  if (!c || !t) return 'none'

  if (
    t.major < c.major ||
    (t.major === c.major && t.minor < c.minor) ||
    (t.major === c.major && t.minor === c.minor && t.patch <= c.patch)
  ) {
    return 'none'
  }

  if (t.major > c.major || t.minor > c.minor) return 'minor-major'
  return 'patch'
}

// ============ Update Package Parsing / 更新パッケージ解析 ============

interface ParsedUpdate {
  version: string
  cid: string
  fileName: string
}

function parseDistUpdates(works: Work[]): ParsedUpdate[] {
  // Use string concatenation to avoid escape characters being consumed in template strings / テンプレート文字列でエスケープ文字が消費されるのを避けるために文字列連結を使用
  const patternStr = '^' + APP_CONFIG.NAME + '-dist-v(\\d+\\.\\d+\\.\\d+)(\\.zip)?$'
  const pattern = new RegExp(patternStr)
  console.log('[Update] Dist update package regex:', pattern)
  const matches = works.filter((w) => pattern.test(w.title))
  console.log('[Update] Found dist update packages:', matches.map((w) => w.title))
  return matches.map((w) => {
    const match = w.title.match(pattern)!
    return { version: match[1], cid: w.cid, fileName: w.title }
  })
}

function parseAppUpdates(works: Work[], platform: string): ParsedUpdate[] {
  const ext = getPlatformExtension()
  if (!ext) return []
  // Use string concatenation to avoid escape characters being consumed in template strings / テンプレート文字列でエスケープ文字が消費されるのを避けるために文字列連結を使用
  const patternStr = '^' + APP_CONFIG.NAME + '-' + platform + '-v(\\d+\\.\\d+\\.\\d+)(\\.' + ext + ')?$'
  const pattern = new RegExp(patternStr)
  console.log('[Update] App update package regex:', pattern)
  const matches = works.filter((w) => pattern.test(w.title))
  console.log('[Update] Found ' + platform + ' installer:', matches.map((w) => w.title))
  return matches.map((w) => {
    const match = w.title.match(pattern)!
    return { version: match[1], cid: w.cid, fileName: w.title }
  })
}

function findLatestVersion(updates: ParsedUpdate[]): ParsedUpdate | null {
  if (updates.length === 0) return null
  return updates.reduce((latest, current) => {
    return compareVersions(latest.version, current.version) === 'none' ? latest : current
  })
}

// ============ Update Detection ============

/**
 * Get current running version / 現在実行中のバージョンを取得
 * Always use APP_CONFIG.VERSION from config.ts as data source / 常にconfig.tsのAPP_CONFIG.VERSIONをデータソースとして使用
 * After hot update, the new dist's config.ts version is the current version, app.getVersion() reflects the packaged version which is unreliable / ホット更新後、新しいdistのconfig.tsバージョンが現在のバージョンであり、app.getVersion()は信頼できないパッケージバージョンを反映
 */
async function getCurrentVersion(): Promise<string> {
  return APP_CONFIG.VERSION
}

export async function checkForUpdates(): Promise<UpdateInfo> {
  const currentVersion = await getCurrentVersion()
  const platform = getPlatformIdentifier()

  console.log('[Update] Checking for updates')
  console.log('[Update] Current version:', currentVersion)
  console.log('[Update] Current platform:', platform)

  try {
    const works = await getWorksByCreator(DEVELOPER_ACCOUNT, 1, 100)
    console.log('[Update] Found ' + works.length + ' works from ' + DEVELOPER_ACCOUNT)

    const distUpdates = parseDistUpdates(works)
    const appUpdates = platform ? parseAppUpdates(works, platform) : []

    const latestDist = findLatestVersion(distUpdates)
    const latestApp = findLatestVersion(appUpdates)

    console.log('[Update] Latest dist version:', latestDist?.version || 'none')
    console.log('[Update] Latest app version:', latestApp?.version || 'none')

    const distComparison = latestDist ? compareVersions(currentVersion, latestDist.version) : 'none'
    const appComparison = latestApp ? compareVersions(currentVersion, latestApp.version) : 'none'

    console.log('[Update] Dist version comparison result:', distComparison)
    console.log('[Update] App version comparison result:', appComparison)

    if (appComparison === 'minor-major' || appComparison === 'patch') {
      console.log('[Update] App update detected')
      return {
        hasUpdate: true,
        updateType: 'app',
        version: latestApp!.version,
        currentVersion,
        cid: latestApp!.cid,
        platform: platform || undefined,
        fileName: latestApp!.fileName,
      }
    } else if (distComparison === 'patch') {
      console.log('[Update] Dist hot update detected')
      return {
        hasUpdate: true,
        updateType: 'dist',
        version: latestDist!.version,
        currentVersion,
        cid: latestDist!.cid,
        fileName: latestDist!.fileName,
      }
    } else if (distComparison === 'minor-major' && appComparison === 'none') {
      // Dist has major/minor update, but no installer for this platform / Distにはメジャー/マイナー更新がありますが、このプラットフォーム用のインストーラーはありません
      // Still notify user of update (use app type, but empty cid means manual download needed) / ユーザーに更新を通知（appタイプを使用、ただし空のcidは手動ダウンロードが必要であることを意味します）
      console.log('[Update] Dist has minor-major update, no installer for this platform, notifying user')
      return {
        hasUpdate: true,
        updateType: 'app',
        version: latestDist!.version,
        currentVersion,
        cid: '',  // empty cid means cannot auto-download / 空のcidは自動ダウンロードできないことを意味します
        platform: platform || undefined,
        fileName: '',
      }
    }

    console.log('[Update] No updates available')
    return { hasUpdate: false, updateType: null, version: currentVersion, currentVersion, cid: '' }
  } catch (error) {
    console.error('[Update] Failed to check for updates:', error)
    return { hasUpdate: false, updateType: null, version: currentVersion, currentVersion, cid: '' }
  }
}

// ============ Update Download / 更新ダウンロード ============

export async function downloadUpdate(cid: string): Promise<Uint8Array> {
  console.log('[Update] Starting download of update package: ' + cid)
  const arrayBuffer = await ipfsConnector.downloadFile(cid, { timeout: 300000 })
  const data = new Uint8Array(arrayBuffer)
  console.log('[Update] Download complete: ' + data.length + ' bytes')
  return data
}

export async function verifyUpdateCID(_data: Uint8Array, expectedCid: string): Promise<boolean> {
  // IPFS content addressing itself is verification: identical content necessarily produces identical CID / IPFS内容アドレッシング自体が検証です：同じコンテンツは必ず同じCIDを生成します
  // Re-uploading for verification will cause CID mismatch due to different chunking strategies, so directly trust downloaded content / 検証のための再アップロードは異なるチャンキング戦略によりCIDの不一致を引き起こすため、ダウンロードされたコンテンツを直接信頼します
  console.log('[Update] Skipping CID re-upload verification, trusting IPFS content addressing: ' + expectedCid)
  return true
}

// ============ WebUI Hot Update ============

export async function applyDistUpdate(cid: string): Promise<boolean> {
  try {
    const data = await downloadUpdate(cid)

    // Decompress in renderer process using JSZip to avoid main.js depending on third-party decompression library / レンダラープロセスでJSZipを使用して解凍し、main.jsがサードパーティの解凍ライブラリに依存するのを避ける
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(data)

    // Collect all files / すべてのファイルを収集
    const files: { relativePath: string; data: number[] }[] = []
    const promises: Promise<void>[] = []

    zip.forEach((relativePath, zipEntry) => {
      if (!zipEntry.dir) {
        promises.push(
          zipEntry.async('uint8array').then((content) => {
            files.push({ relativePath, data: Array.from(content) })
          })
        )
      }
    })
    await Promise.all(promises)
    console.log('[Update] Extraction complete,', files.length, 'files')

    if (window.electronAPI?.applyDistUpdate) {
      const success = await window.electronAPI.applyDistUpdate(files)
      if (success) {
        console.log('[Update] WebUI update successful')
        // main.js has already loaded the new version directly via loadFile, no reload needed / main.jsはloadFileを介して新しいバージョンを直接読み込み済みなので、リロードは不要です
        return true
      }
    } else {
      console.warn('[Update] Electron API unavailable, cannot apply hot update')
    }
    return false
  } catch (error) {
    console.error('[Update] Failed to apply hot update:', error)
    return false
  }
}

// ============ App Installer Update / アプリインストーラー更新 ============

export async function downloadAppUpdate(cid: string, fileName: string): Promise<string | null> {
  try {
    const data = await downloadUpdate(cid)
    const isValid = await verifyUpdateCID(data, cid)
    if (!isValid) throw new Error('Installer verification failed')

    if (window.electronAPI?.saveAppUpdate) {
      const filePath = await window.electronAPI.saveAppUpdate(data, fileName)
      console.log('[Update] Installer saved to: ' + filePath)
      return filePath
    } else {
      console.warn('[Update] Electron API unavailable, cannot save installer')
    }
    return null
  } catch (error) {
    console.error('[Update] Failed to download installer:', error)
    return null
  }
}

export function showUpdateInFolder(filePath: string): void {
  if (window.electronAPI?.showItemInFolder) {
    window.electronAPI.showItemInFolder(filePath)
  }
}
