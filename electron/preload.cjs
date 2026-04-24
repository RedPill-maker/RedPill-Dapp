// Electron Preload Script
// This script runs in the renderer process but can access Node.js APIs

const { contextBridge, ipcRenderer } = require('electron')

try {

  // Expose safe APIs to the renderer process
  contextBridge.exposeInMainWorld('electronAPI', {
    /**
     * Signal to main process that splash listeners are ready
     */
    splashReady: () => {
      ipcRenderer.send('splash-ready')
    },

    /**
     * Pull buffered startup logs from main process
     * @param {number} sinceIndex - index to start from
     * @returns {Promise<{logs: Array, total: number}>}
     */
    getStartupLogs: (sinceIndex) => {
      return ipcRenderer.invoke('get-startup-logs', sinceIndex)
    },

    /**
     * Listen for startup status updates
     * @param {Function} callback Callback function
     */
    onStartupStatus: (callback) => {
      ipcRenderer.on('startup-status', (event, status) => callback(status))
    },

    /**
     * Listen for log messages
     * @param {Function} callback Callback function
     */
    onLog: (callback) => {
      ipcRenderer.on('startup-log', (event, log) => callback(log))
    },

    /**
     * Retry startup
     */
    retryStartup: () => {
      ipcRenderer.send('retry-startup')
    },

    /**
     * Get dynamically allocated service ports
     * @returns {Promise<{dbServer: number, ipfsApi: number, ipfsGateway: number}>}
     */
    getServicePorts: async () => {
      return await ipcRenderer.invoke('get-service-ports')
    },

    /**
     * Export IPNS key
     * @param {string} keyName Key name
     * @returns {Promise<string>} Key data
     */
    exportIPNSKey: async (keyName) => {
      console.log('Preload: exportIPNSKey called with keyName:', keyName)
      return await ipcRenderer.invoke('export-ipns-key', keyName)
    },

    /**
     * Export IPNS key and show file save dialog
     * @param {string} keyName Key name
     * @returns {Promise<{success: boolean, filePath?: string, error?: string}>} Export result
     */
    exportIPNSKeyWithDialog: async (keyName) => {
      console.log(
        'Preload: exportIPNSKeyWithDialog called with keyName:',
        keyName,
      )
      return await ipcRenderer.invoke('export-ipns-key-with-dialog', keyName)
    },

    /**
     * Import IPNS key
     * @param {string} keyName Key name
     * @param {string} keyData Key data
     * @returns {Promise<{name: string, id: string}>} Import result
     */
    importIPNSKey: async (keyName, keyData) => {
      console.log('Preload: importIPNSKey called with keyName:', keyName)
      return await ipcRenderer.invoke('import-ipns-key', keyName, keyData)
    },

    /**
     * Check if IPFS CLI is available
     * @returns {Promise<boolean>} Whether available
     */
    checkIPFSCLI: async () => {
      console.log('Preload: checkIPFSCLI called')
      return await ipcRenderer.invoke('check-ipfs-cli')
    },

    /**
     * Get app version information
     * @returns {Promise<string>} App version
     */
    getAppVersion: async () => {
      return await ipcRenderer.invoke('get-app-version')
    },

    /**
     * Get platform information
     * @returns {Promise<string>} Platform name
     */
    getPlatform: async () => {
      return await ipcRenderer.invoke('get-platform')
    },

    /**
     * Save app installer (show save dialog)
     * @param {Uint8Array} data File data
     * @param {string} fileName Default file name
     * @returns {Promise<string|null>} Save path, null if canceled
     */
    saveAppUpdate: async (data, fileName) => {
      return await ipcRenderer.invoke('save-app-update', data, fileName)
    },

    /**
     * Show file in file manager
     * @param {string} filePath File path
     */
    showItemInFolder: (filePath) => {
      ipcRenderer.invoke('show-item-in-folder', filePath)
    },

    // ==================== Safe Storage API ====================

    /**
     * Check if safe storage encryption is available
     * @returns {Promise<boolean>}
     */
    isSafeStorageAvailable: () => {
      return ipcRenderer.invoke('safe-storage-available')
    },

    /**
     * Store data securely (sensitive data uses OS-level encryption)
     * @param {string} key Storage key
     * @param {any} value Data to store
     * @returns {Promise<boolean>}
     */
    safeStorageSet: (key, value) => {
      return ipcRenderer.invoke('safe-storage-set', key, value)
    },

    /**
     * Retrieve securely stored data
     * @param {string} key Storage key
     * @returns {Promise<any>}
     */
    safeStorageGet: (key) => {
      return ipcRenderer.invoke('safe-storage-get', key)
    },

    /**
     * Delete securely stored data
     * @param {string} key Storage key
     * @returns {Promise<boolean>}
     */
    safeStorageDelete: (key) => {
      return ipcRenderer.invoke('safe-storage-delete', key)
    },

    /**
     * Open a URL in the system's default external browser
     * @param {string} url URL to open
     * @returns {Promise<void>}
     */
    openExternal: (url) => {
      return ipcRenderer.invoke('open-external-url', url)
    },

    /**
     * Apply WebUI hot update (receive decompressed file list, write to dist-override)
     * @param {Array<{relativePath: string, data: number[]}>} files File list
     * @returns {Promise<boolean>} Whether successful
     */
    applyDistUpdate: async (files) => {
      return await ipcRenderer.invoke('write-dist-files', files)
    },
  })
} catch (error) {
  console.error('Error in preload script:', error)
}

console.log('Preload script loaded successfully')
