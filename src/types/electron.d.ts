/**
 * Electron API type definitions
 */

export interface ElectronAPI {
  /**
   * Apply WebUI hot update for the application
   * @param data Update package data
   * @returns Whether successful
   */
  applyDistUpdate?: (files: Array<{ relativePath: string; data: number[] }>) => Promise<boolean>

  /**
   * Save app installer to user's download directory
   * @param data Installer package data
   * @param fileName File name
   * @returns Path of the saved file
   */
  saveAppUpdate?: (data: Uint8Array, fileName: string) => Promise<string>

  /**
   * Show file in file manager
   * @param filePath File path
   */
  showItemInFolder?: (filePath: string) => void

  /**
   * Open a URL in the system's default external browser
   * @param url URL to open
   */
  openExternal?: (url: string) => Promise<void>

  /**
   * Get application version (from Electron app.getVersion())
   * @returns Version string, e.g. "1.0.1"
   */
  getAppVersion?: () => Promise<string>

  /**
   * Get service port configuration
   * @returns Port configuration object
   */
  getServicePorts?: () => Promise<{
    dbServer: number
    ipfsApi: number
    ipfsGateway: number
    ipfsSwarm: number
    platform?: string
    arch?: string
  }>

  /**
   * Export IPNS key (with file selection dialog)
   * @param keyName Key name
   * @returns Export result
   */
  exportIPNSKeyWithDialog?: (keyName: string) => Promise<{
    success: boolean
    filePath?: string
    error?: string
  }>

  /**
   * Export IPNS key
   * @param keyName Key name
   * @returns Key data
   */
  exportIPNSKey?: (keyName: string) => Promise<string>

  /**
   * Import IPNS key
   * @param keyName Key name
   * @param keyData Key data
   * @returns Imported key information
   */
  importIPNSKey?: (keyName: string, keyData: string) => Promise<{
    name: string
    id: string
  }>
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
    electron?: ElectronAPI
    process?: {
      type?: string
      versions?: {
        electron?: string
      }
    }
  }
}

export {}
