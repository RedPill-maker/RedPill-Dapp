/**
 * IPFS Connection Manager
 *
 * This file contains all functions for interacting with IPFS nodes, including:
 * - Node status check
 * - File upload/download
 * - IPNS management
 * - Node info retrieval
 * - Error handling and retry mechanism
 *
 * Usage:
 * import { ipfsConnector } from '@/utils/ipfsConnector'
 *
 * // Get node status
 * const stats = await ipfsConnector.getNodeStats()
 *
 * // Upload file
 * const result = await ipfsConnector.uploadFile(file)
 *
 * // Download file
 * const content = await ipfsConnector.downloadFile(cid)
 */

import { IPFS_CONFIG, API_ENDPOINTS } from '../../config'
import { getIpfsApiBaseUrl, getIpfsGatewayUrl } from './portManager'

// ==================== Type definitions ====================

/**
 * IPFS node info
 */
export interface IPFSNodeInfo {
  id: string
  publicKey: string
  addresses: string[]
  agentVersion: string
  protocolVersion: string
}

/**
 * IPFS version info
 */
export interface IPFSVersionInfo {
  version: string
  commit: string
  repo: string
  system: string
  golang: string
}

/**
 * IPFS peer info
 */
export interface IPFSPeer {
  id: string
  addr: string
  direction?: number
  muxer?: string
  latency?: string
}

/**
 * IPFS node statistics
 */
export interface IPFSStats {
  peers: IPFSPeer[]
  peerCount: number
  isConnected: boolean
  nodeId: string | null
  version: string | null
  lastUpdated: number
}

/**
 * File upload result
 */
export interface UploadResult {
  name: string
  hash: string
  size: string
}

/**
 * IPNS record info
 */
export interface IPNSRecord {
  name: string
  value: string
}

/**
 * API request options
 */
interface RequestOptions {
  timeout?: number
  retries?: number
  retryDelay?: number
}

// ==================== Utility functions ====================

/**
 * Create fetch request with timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {},
): Promise<Response> {
  const { timeout = IPFS_CONFIG.DEFAULT_TIMEOUT, ...fetchOptions } = options

  // If timeout is 0, do not set timeout
  if (timeout === 0) {
    return fetch(url, fetchOptions)
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    return response
  } catch (error) {
    clearTimeout(timeoutId)
    throw error
  }
}

/**
 * Request function with retry mechanism
 */
async function requestWithRetry<T>(
  requestFn: () => Promise<T>,
  options: RequestOptions = {},
): Promise<T> {
  const {
    retries = IPFS_CONFIG.MAX_RETRY_ATTEMPTS,
    retryDelay = IPFS_CONFIG.RETRY_DELAY,
  } = options

  let lastError: Error

  for (let i = 0; i <= retries; i++) {
    try {
      return await requestFn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (i < retries) {
        console.warn(
          `IPFS request failed, retrying in ${retryDelay}ms (${i + 1}/${retries}):`,
          lastError.message,
        )
        await new Promise((resolve) => setTimeout(resolve, retryDelay))
      }
    }
  }

  throw lastError!
}

// ==================== IPFS Connector class ====================

export class IpfsConnector {
  private static baseUrl: string = IPFS_CONFIG.API_BASE_URL
  private static gatewayUrl: string = IPFS_CONFIG.GATEWAY_URL
  private static baseUrlInitialized = false
  private static gatewayUrlInitialized = false

  /**
   * Get API base URL (dynamic port)
   */
  private static async getBaseUrl(): Promise<string> {
    if (!this.baseUrlInitialized) {
      try {
        this.baseUrl = await getIpfsApiBaseUrl()
        this.baseUrlInitialized = true
        console.log('IPFS API Base URL:', this.baseUrl)
      } catch (err) {
        console.warn('Failed to get dynamic IPFS API URL, using default:', err)
      }
    }
    return this.baseUrl
  }

  /**
   * Get Gateway URL (dynamic port)
   */
  private static async getGatewayBaseUrl(): Promise<string> {
    if (!this.gatewayUrlInitialized) {
      try {
        this.gatewayUrl = await getIpfsGatewayUrl()
        this.gatewayUrlInitialized = true
        console.log('IPFS Gateway URL:', this.gatewayUrl)
      } catch (err) {
        console.warn('Failed to get dynamic IPFS Gateway URL, using default:', err)
      }
    }
    return this.gatewayUrl
  }

  // ==================== Node status management ====================

  /**
   * Get complete IPFS node statistics
   * Includes node ID, version info, peer list, etc.
   */
  static async getNodeStats(options?: RequestOptions): Promise<IPFSStats> {
    const baseUrl = await this.getBaseUrl()
    return requestWithRetry(async () => {
      try {
        // Parallel request for node info, version info, and peer list
        const [idResponse, versionResponse, peersResponse] = await Promise.all([
          fetchWithTimeout(`${baseUrl}${API_ENDPOINTS.IPFS.ID}`, {
            method: 'POST',
            timeout: options?.timeout,
          }),
          fetchWithTimeout(`${baseUrl}${API_ENDPOINTS.IPFS.VERSION}`, {
            method: 'POST',
            timeout: options?.timeout,
          }),
          fetchWithTimeout(`${baseUrl}${API_ENDPOINTS.IPFS.PEERS}`, {
            method: 'POST',
            timeout: options?.timeout,
          }),
        ])

        // Check response status
        if (!idResponse.ok || !versionResponse.ok || !peersResponse.ok) {
          throw new Error(
            `IPFS API request failed: ${idResponse.status} ${versionResponse.status} ${peersResponse.status}`,
          )
        }

        // Parse response data
        const [idData, versionData, peersData] = await Promise.all([
          idResponse.json(),
          versionResponse.json(),
          peersResponse.json(),
        ])

        return {
          nodeId: idData.ID,
          version: versionData.Version,
          peers: peersData.Peers || [],
          peerCount: (peersData.Peers || []).length,
          isConnected: true,
          lastUpdated: Date.now(),
        }
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : 'IPFS connection failed')
      }
    }, options)
  }

  /**
   * Get node basic information
   */
  static async getNodeInfo(options?: RequestOptions): Promise<IPFSNodeInfo> {
    const baseUrl = await this.getBaseUrl()
    return requestWithRetry(async () => {
      const baseUrl = await this.getBaseUrl()
      const response = await fetchWithTimeout(
        `${baseUrl}${API_ENDPOINTS.IPFS.ID}`,
        {
          method: 'POST',
          timeout: options?.timeout,
        },
      )

      if (!response.ok) {
        throw new Error(`Failed to get node info: ${response.status}`)
      }

      return response.json()
    }, options)
  }

  /**
   * Get node version information
   */
  static async getVersionInfo(
    options?: RequestOptions,
  ): Promise<IPFSVersionInfo> {
    const baseUrl = await this.getBaseUrl()
    return requestWithRetry(async () => {
      const baseUrl = await this.getBaseUrl()
      const response = await fetchWithTimeout(
        `${baseUrl}${API_ENDPOINTS.IPFS.VERSION}`,
        {
          method: 'POST',
          timeout: options?.timeout,
        },
      )

      if (!response.ok) {
        throw new Error(`Failed to get version info: ${response.status}`)
      }

      return response.json()
    }, options)
  }

  /**
   * Get peer node list
   */
  static async getPeers(options?: RequestOptions): Promise<IPFSPeer[]> {
    const baseUrl = await this.getBaseUrl()
    return requestWithRetry(async () => {
      const baseUrl = await this.getBaseUrl()
      const response = await fetchWithTimeout(
        `${baseUrl}${API_ENDPOINTS.IPFS.PEERS}`,
        {
          method: 'POST',
          timeout: options?.timeout,
        },
      )

      if (!response.ok) {
        throw new Error(`Failed to get peers: ${response.status}`)
      }

      const data = await response.json()
      return data.Peers || []
    }, options)
  }

  /**
   * Check if node is online
   */
  static async isNodeOnline(options?: RequestOptions): Promise<boolean> {
    try {
      await this.getNodeInfo(options)
      return true
    } catch {
      return false
    }
  }

  // ==================== File management ====================

  /**
   * Upload file to IPFS (wrapped in directory)
   * Suitable for scenarios that need to maintain file name structure, such as uploading content files to IPNS
   * @param file File to upload (File object or Blob)
   * @param options Request options
   * @returns Upload result, including directory hash (file can be accessed via /ipfs/hash/filename)
   */
  static async uploadFile(
    file: File | Blob,
    options?: RequestOptions,
  ): Promise<UploadResult> {
    const baseUrl = await this.getBaseUrl()
    // File upload does not use retry mechanism, execute directly
    const formData = new FormData()

    // If it's a File object, keep the original filename; if it's a Blob, use the default name
    const fileName = file instanceof File ? file.name : 'file'
    formData.append('file', file, fileName)

    // Add wrap-with-directory parameter to create directory structure containing filename
    const response = await fetchWithTimeout(
      `${baseUrl}${API_ENDPOINTS.IPFS.ADD}?wrap-with-directory=true`,
      {
        method: 'POST',
        body: formData,
        timeout: 0, // no timeout
      },
    )

    if (!response.ok) {
      throw new Error(`File upload failed: ${response.status}`)
    }

    const responseText = await response.text()
    console.log('IPFS upload raw response:', responseText)

    // IPFS add API returns multiple lines of JSON, one object per line
    const lines = responseText.trim().split('\n')
    let directoryHash = ''
    let fileHash = ''

    for (const line of lines) {
      try {
        const data = JSON.parse(line)
        console.log('Parsed response line:', data)

        if (data.Name === '') {
          // Empty name is the directory hash
          directoryHash = data.Hash || data.hash || ''
        } else {
          // Named one is the file hash
          fileHash = data.Hash || data.hash || ''
        }
      } catch (e) {
        console.warn('Failed to parse response line:', line, e)
      }
    }

    // Return the directory hash so IPNS points to the directory containing the filename
    const resultHash = directoryHash || fileHash

    if (!resultHash) {
      throw new Error('Upload failed: no file hash received')
    }

    console.log('Final hash used:', resultHash)

    // Convert IPFS API return format to our required format
    return {
      name: fileName,
      hash: resultHash,
      size: file.size.toString(),
    }
  }

  /**
   * Upload single file and return direct file CID (not wrapped in directory)
   * Suitable for scenarios that need to access file content directly, such as thumbnails
   * @param file File to upload (File object or Blob)
   * @param options Request options
   * @returns Upload result, including direct file hash
   */
  static async uploadFileDirectly(
    file: File | Blob,
    options?: RequestOptions,
  ): Promise<UploadResult> {
    const baseUrl = await this.getBaseUrl()
    // File upload does not use retry mechanism, execute directly
    const formData = new FormData()

    // If it's a File object, keep the original filename; if it's a Blob, use the default name
    const fileName = file instanceof File ? file.name : 'file'
    formData.append('file', file, fileName)

    // Do not use wrap-with-directory parameter, upload file directly
    const response = await fetchWithTimeout(
      `${baseUrl}${API_ENDPOINTS.IPFS.ADD}`,
      {
        method: 'POST',
        body: formData,
        timeout: 0, // no timeout
      },
    )

    if (!response.ok) {
      throw new Error(`Direct file upload failed: ${response.status}`)
    }

    const responseText = await response.text()
    console.log('IPFS direct upload raw response:', responseText)

    // Parse response to get file hash
    try {
      const data = JSON.parse(responseText.trim())
      const fileHash = data.Hash || data.hash || ''

      if (!fileHash) {
        throw new Error('Direct upload failed: no file hash received')
      }

      console.log('Direct upload file hash:', fileHash)

      return {
        name: fileName,
        hash: fileHash,
        size: file.size.toString(),
      }
    } catch (e) {
      throw new Error(`Failed to parse upload response: ${e}`)
    }
  }

  /**
   * Incremental file upload to existing IPNS directory
   * @param files Array of new files to upload
   * @param ipnsId IPNS ID
   * @param options Request options
   * @returns Upload result, including new directory hash
   */
  static async uploadFilesToExistingIPNS(
    files: (File | Blob)[],
    ipnsId: string,
    options?: RequestOptions,
  ): Promise<UploadResult> {
    const baseUrl = await this.getBaseUrl()
    if (files.length === 0) {
      throw new Error('No files to upload')
    }

    try {
      // 1. First resolve the CID that the current IPNS points to
      let currentCID = ''
      let existingFiles: Array<{ name: string; hash: string }> = []

      try {
        currentCID = await this.resolveIPNS(ipnsId)
        console.log('Current IPNS CID:', currentCID)

        // Get existing file list
        const fileList = await this.listFiles(currentCID)
        existingFiles = fileList.map((file) => ({
          name: file.name,
          hash: file.hash,
        }))
        console.log('Existing file list:', existingFiles)
      } catch (err) {
        console.log('IPNS not pointing to any content or resolve failed, creating new directory:', err)
      }

      // 2. Check for filename conflicts
      const newFileNames = files.map((file) =>
        file instanceof File ? file.name : `file_${Date.now()}`,
      )
      const conflictingFiles = newFileNames.filter((name) =>
        existingFiles.some((existing) => existing.name === name),
      )

      if (conflictingFiles.length > 0) {
        console.warn('Found duplicate files, will overwrite:', conflictingFiles)
      }

      // 3. Create new directory containing all files
      const formData = new FormData()

      // Add existing files (excluding duplicates)
      for (const existingFile of existingFiles) {
        if (!newFileNames.includes(existingFile.name)) {
          try {
            // Download existing file and re-add to FormData
            const fileContent = await this.downloadFile(existingFile.hash)
            const blob = new Blob([fileContent])
            formData.append('file', blob, existingFile.name)
            console.log('Re-adding existing file:', existingFile.name)
          } catch (err) {
            console.warn('Failed to re-add file:', existingFile.name, err)
          }
        }
      }

      // Add new files
      files.forEach((file, index) => {
        const fileName =
          file instanceof File ? file.name : `file_${Date.now()}_${index}`
        formData.append('file', file, fileName)
        console.log('Adding new file:', fileName)
      })

      // 4. Upload merged directory
      const response = await fetchWithTimeout(
        `${baseUrl}${API_ENDPOINTS.IPFS.ADD}?wrap-with-directory=true`,
        {
          method: 'POST',
          body: formData,
          timeout: 0, // no timeout
        },
      )

      if (!response.ok) {
        throw new Error(`Incremental file upload failed: ${response.status}`)
      }

      const responseText = await response.text()
      console.log('IPFS incremental upload response:', responseText)

      // 5. Parse response to get new directory hash
      const lines = responseText.trim().split('\n')
      let directoryHash = ''

      for (const line of lines) {
        try {
          const data = JSON.parse(line)
          if (data.Name === '') {
            directoryHash = data.Hash || data.hash || ''
            break
          }
        } catch (e) {
          console.warn('Failed to parse response line:', line, e)
        }
      }

      if (!directoryHash) {
        throw new Error('Incremental upload failed: no directory hash received')
      }

      console.log('New directory hash:', directoryHash)

      const totalFiles =
        existingFiles.length - conflictingFiles.length + files.length
      const totalSize = files.reduce((sum, file) => sum + file.size, 0)

      return {
        name: `${totalFiles} files (${files.length} new)`,
        hash: directoryHash,
        size: totalSize.toString(),
      }
    } catch (err) {
      console.error('Error during incremental upload:', err)
      throw err
    }
  }

  /**
   * Batch upload multiple files to IPFS, create directory containing all files
   * @param files Array of files to upload
   * @param options Request options
   * @returns Upload result, including directory hash
   */
  static async uploadMultipleFiles(
    files: (File | Blob)[],
    options?: RequestOptions,
  ): Promise<UploadResult> {
    const baseUrl = await this.getBaseUrl()
    if (files.length === 0) {
      throw new Error('No files to upload')
    }

    // If only one file, use single file upload
    if (files.length === 1) {
      return this.uploadFile(files[0], options)
    }

    // Multiple file upload
    const formData = new FormData()

    files.forEach((file, index) => {
      const fileName = file instanceof File ? file.name : `file_${index}`
      formData.append('file', file, fileName)
    })

    // Add wrap-with-directory parameter to create directory structure containing all files
    const response = await fetchWithTimeout(
      `${baseUrl}${API_ENDPOINTS.IPFS.ADD}?wrap-with-directory=true`,
      {
        method: 'POST',
        body: formData,
        timeout: 0, // no timeout
      },
    )

    if (!response.ok) {
      throw new Error(`Batch file upload failed: ${response.status}`)
    }

    const responseText = await response.text()
    console.log('IPFS batch upload raw response:', responseText)

    // IPFS add API returns multiple lines of JSON, one object per line
    const lines = responseText.trim().split('\n')
    let directoryHash = ''

    for (const line of lines) {
      try {
        const data = JSON.parse(line)
        console.log('Parsed response line:', data)

        if (data.Name === '') {
          // Empty name is the directory hash
          directoryHash = data.Hash || data.hash || ''
          break
        }
      } catch (e) {
        console.warn('Failed to parse response line:', line, e)
      }
    }

    if (!directoryHash) {
      throw new Error('Batch upload failed: no directory hash received')
    }

    console.log('Batch upload directory hash:', directoryHash)

    const totalSize = files.reduce((sum, file) => sum + file.size, 0)

    return {
      name: `${files.length} files`,
      hash: directoryHash,
      size: totalSize.toString(),
    }
  }

  /**
   * Download file content from IPFS
   * @param cid CID of the file (content identifier)
   * @param options Request options
   * @returns File content (ArrayBuffer)
   */
  static async downloadFile(
    cid: string,
    options?: RequestOptions,
  ): Promise<ArrayBuffer> {
    const baseUrl = await this.getBaseUrl()
    return requestWithRetry(async () => {
      const baseUrl = await this.getBaseUrl()
      const response = await fetchWithTimeout(
        `${baseUrl}${API_ENDPOINTS.IPFS.CAT}?arg=${cid}`,
        {
          method: 'POST',
          timeout: options?.timeout,
        },
      )

      if (!response.ok) {
        throw new Error(`File download failed: ${response.status}`)
      }

      return response.arrayBuffer()
    }, options)
  }

  /**
   * Export CAR file corresponding to CID (preserve complete IPFS block structure for IPFS reachability when storing on Filecoin)
   * Use Kubo dag/export API, return CAR format bytes containing all blocks
   */
  static async exportCar(
    cid: string,
    options?: RequestOptions,
  ): Promise<Uint8Array> {
    return requestWithRetry(async () => {
      const baseUrl = await this.getBaseUrl()
      const response = await fetchWithTimeout(
        `${baseUrl}${API_ENDPOINTS.IPFS.DAG_EXPORT}?arg=${cid}`,
        {
          method: 'POST',
          timeout: options?.timeout ?? 60000,
        },
      )

      if (!response.ok) {
        throw new Error(`CAR export failed: ${response.status}`)
      }

      const buffer = await response.arrayBuffer()
      return new Uint8Array(buffer)
    }, options)
  }

  /**
   * Download file content as text
   * @param cid CID of the file
   * @param encoding Text encoding, default is 'utf-8'
   * @param options Request options
   * @returns File text content
   */
  static async downloadFileAsText(
    cid: string,
    encoding: string = 'utf-8',
    options?: RequestOptions,
  ): Promise<string> {
    const buffer = await this.downloadFile(cid, options)
    const decoder = new TextDecoder(encoding)
    return decoder.decode(buffer)
  }

  /**
   * Download file content as JSON
   * @param cid CID of the file
   * @param options Request options
   * @returns Parsed JSON object
   */
  static async downloadFileAsJSON<T = any>(
    cid: string,
    options?: RequestOptions,
  ): Promise<T> {
    const text = await this.downloadFileAsText(cid, 'utf-8', options)
    return JSON.parse(text)
  }

  /**
   * List files in IPFS directory
   * @param cid CID of the directory
   * @param options Request options
   * @returns List of file information
   */
  static async listFiles(
    cid: string,
    options?: RequestOptions,
  ): Promise<
    Array<{
      name: string
      hash: string
      size: number
      type: 'file' | 'directory'
    }>
  > {
    return requestWithRetry(async () => {
      const baseUrl = await this.getBaseUrl()
      const response = await fetchWithTimeout(
        `${baseUrl}${API_ENDPOINTS.IPFS.LS}?arg=${cid}`,
        {
          method: 'POST',
          timeout: options?.timeout,
        },
      )

      if (!response.ok) {
        throw new Error(`Failed to get file list: ${response.status}`)
      }

      const data = await response.json()
      const objects = data.Objects || []

      if (objects.length === 0) {
        return []
      }

      const links = objects[0].Links || []
      return links.map((link: any) => ({
        name: link.Name,
        hash: link.Hash,
        size: link.Size || 0,
        type: link.Type === 1 ? 'directory' : 'file',
      }))
    }, options)
  }

  // ==================== Pin management ====================

  /**
   * Pin file to local node
   * @param cid CID of file to pin
   * @param options Request options
   */
  static async pinFile(cid: string, options?: RequestOptions): Promise<void> {
    const baseUrl = await this.getBaseUrl()
    return requestWithRetry(async () => {
      const baseUrl = await this.getBaseUrl()
      const response = await fetchWithTimeout(
        `${baseUrl}${API_ENDPOINTS.IPFS.PIN_ADD}?arg=${cid}`,
        {
          method: 'POST',
          timeout: options?.timeout,
        },
      )

      if (!response.ok) {
        throw new Error(`File pin failed: ${response.status}`)
      }
    }, options)
  }

  /**
   * Get list of pinned files
   * @param type Filter type: 'recursive' | 'direct' | 'indirect' | 'all' (default all)
   * @returns List of CIDs of pinned files
   */
  static async listPinnedFiles(
    type: 'recursive' | 'direct' | 'indirect' | 'all' = 'all',
    options?: RequestOptions,
  ): Promise<string[]> {
    return requestWithRetry(async () => {
      const baseUrl = await this.getBaseUrl()
      const url =
        type === 'all'
          ? `${baseUrl}${API_ENDPOINTS.IPFS.PIN_LS}`
          : `${baseUrl}${API_ENDPOINTS.IPFS.PIN_LS}?type=${type}`
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        timeout: options?.timeout,
      })

      if (!response.ok) {
        throw new Error(`Failed to get pinned file list: ${response.status}`)
      }

      const data = await response.json()
      return Object.keys(data.Keys || {})
    }, options)
  }

  /**
   * Unpin file (unpin)
   * @param cid CID to unpin
   */
  static async unpinFile(cid: string, options?: RequestOptions): Promise<void> {
    return requestWithRetry(async () => {
      const baseUrl = await this.getBaseUrl()
      const response = await fetchWithTimeout(
        `${baseUrl}${API_ENDPOINTS.IPFS.PIN_RM}?arg=${cid}`,
        {
          method: 'POST',
          timeout: options?.timeout,
        },
      )
      if (!response.ok) {
        throw new Error(`Unpin failed: ${response.status}`)
      }
    }, options)
  }

  // ==================== IPNS management ====================

  /**
   * Publish IPNS record
   * @param cid Content CID to publish
   * @param key IPNS key name (optional, default uses node default key)
   * @param options Request options
   * @returns IPNS name
   */
  static async publishIPNS(
    cid: string,
    key?: string,
    options?: RequestOptions,
  ): Promise<string> {
    // IPNS publish does not use retry mechanism, execute directly
    const baseUrl = await this.getBaseUrl()
      let url = `${baseUrl}/name/publish?arg=${cid}`
    if (key) {
      url += `&key=${key}`
    }

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      timeout: 0, // no timeout
    })

    if (!response.ok) {
      throw new Error(`IPNS publish failed: ${response.status}`)
    }

    const data = await response.json()
    return data.Name
  }

  /**
   * Update existing IPNS record to new CID
   * @param ipnsId IPNS ID
   * @param cid New content CID
   * @param options Request options
   * @returns Update result
   */
  static async publishToIPNS(
    ipnsId: string,
    cid: string,
    options?: RequestOptions,
  ): Promise<{ name: string; value: string }> {
    // First get all keys, find the corresponding key name
    const keys = await this.listIPNSKeys(options)
    const targetKey = keys.find((key) => key.id === ipnsId)

    if (!targetKey) {
      throw new Error(`IPNS key not found: ${ipnsId}`)
    }

    const baseUrl = await this.getBaseUrl()
    // Use the found key name to publish
    let url = `${baseUrl}/name/publish?arg=${cid}&key=${targetKey.name}`

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      timeout: 0, // no timeout
    })

    if (!response.ok) {
      throw new Error(`IPNS update failed: ${response.status}`)
    }

    const data = await response.json()
    return {
      name: data.Name,
      value: data.Value || cid,
    }
  }

  /**
   * Resolve IPNS name
   * @param name IPNS name
   * @param options Request options
   * @returns Resolved CID
   */
  static async resolveIPNS(
    name: string,
    options?: RequestOptions,
  ): Promise<string> {
    return requestWithRetry(async () => {
      const baseUrl = await this.getBaseUrl()
      const response = await fetchWithTimeout(
        `${baseUrl}/name/resolve?arg=${name}`,
        {
          method: 'POST',
          timeout: options?.timeout,
        },
      )

      if (!response.ok) {
        throw new Error(`IPNS resolve failed: ${response.status}`)
      }

      const data = await response.json()
      return data.Path.replace('/ipfs/', '')
    }, options)
  }

  /**
   * List local IPNS keys
   * @param options Request options
   * @returns Key list
   */
  static async listIPNSKeys(
    options?: RequestOptions,
  ): Promise<Array<{ name: string; id: string }>> {
    return requestWithRetry(async () => {
      const baseUrl = await this.getBaseUrl()
      const response = await fetchWithTimeout(`${baseUrl}/key/list`, {
        method: 'POST',
        timeout: options?.timeout,
      })

      if (!response.ok) {
        throw new Error(`Failed to get IPNS key list: ${response.status}`)
      }

      const data = await response.json()
      const keys = data.Keys || []

      // Convert IPFS API return format to our required format
      return keys.map((key: any) => ({
        name: key.Name || key.name || 'Unknown',
        id: key.Id || key.id || '',
      }))
    }, options)
  }

  /**
   * Create new IPNS key
   * @param keyName Key name
   * @param options Request options
   * @returns Newly created key information
   */
  static async createIPNSKey(
    keyName: string,
    options?: RequestOptions,
  ): Promise<{ name: string; id: string }> {
    return requestWithRetry(async () => {
      const baseUrl = await this.getBaseUrl()
      const response = await fetchWithTimeout(
        `${baseUrl}/key/gen?arg=${keyName}&type=rsa&size=2048`,
        {
          method: 'POST',
          timeout: options?.timeout,
        },
      )

      if (!response.ok) {
        throw new Error(`Failed to create IPNS key: ${response.status}`)
      }

      const data = await response.json()
      return {
        name: data.Name || keyName,
        id: data.Id || '',
      }
    }, options)
  }

  /**
   * Export IPNS key
   * Not available in web environment, implemented via CLI in Electron environment
   * @param keyName Key name
   * @param options Request options
   * @returns Exported key data
   */
  static async exportIPNSKey(
    keyName: string,
    options?: RequestOptions,
  ): Promise<string> {
    const baseUrl = await this.getBaseUrl()
    // Detect if in Electron environment (using multiple verification)
    const isElectron = !!(
      typeof window !== 'undefined' &&
      (window.process?.type === 'renderer' ||
        window.process?.versions?.electron ||
        window.navigator?.userAgent?.includes('Electron') ||
        window.electronAPI)
    )

    const hasElectronAPI = !!(
      typeof window !== 'undefined' && window.electronAPI
    )

    console.log('IpfsConnector.exportIPNSKey environment check:', {
      isElectron,
      hasElectronAPI,
      processType:
        typeof window !== 'undefined' ? window.process?.type : 'undefined',
      electronVersion:
        typeof window !== 'undefined'
          ? window.process?.versions?.electron
          : 'undefined',
      userAgent:
        typeof window !== 'undefined'
          ? window.navigator?.userAgent
          : 'undefined',
      userAgentIncludesElectron:
        typeof window !== 'undefined'
          ? window.navigator?.userAgent?.includes('Electron')
          : false,
    })

    if (isElectron && hasElectronAPI && window.electronAPI) {
      // Electron environment: call CLI via IPC
      try {
        console.log('Exporting key via Electron API:', keyName)
        return await window.electronAPI.exportIPNSKey(keyName)
      } catch (err) {
        console.error('Electron API call failed:', err)
        throw new Error(
          `Key export failed in Electron environment: ${err instanceof Error ? err.message : 'unknown error'}`,
        )
      }
    } else if (isElectron && !hasElectronAPI) {
      // Electron environment but no API
      console.error('electronAPI not found in Electron environment')
      throw new Error(
        'electronAPI not found in Electron environment, please check preload script configuration.\n\nPlease ensure:\n1. preload script is loaded correctly\n2. contextBridge.exposeInMainWorld is called correctly\n3. Main process has registered the corresponding IPC handlers',
      )
    } else {
      // Web environment: not supported
      console.warn('Key export not supported in web environment')
      throw new Error(
        'Key export is not supported in web environment.\n\nPlease use the Electron desktop version or export via CLI:\nipfs key export ' +
          keyName,
      )
    }

    // The following code is for reference only, HTTP API is actually not available
    /*
    return requestWithRetry(async () => {
      const response = await fetchWithTimeout(`${baseUrl}/key/export?arg=${keyName}`, {
        method: 'POST',
        timeout: options?.timeout
      })
      
      if (!response.ok) {
        throw new Error(`Failed to export IPNS key: ${response.status}`)
      }
      
      return response.text()
    }, options)
    */
  }

  /**
   * Import IPNS key
   * @param keyName Key name
   * @param keyData Key data
   * @param options Request options
   * @returns Imported key information
   */
  static async importIPNSKey(
    keyName: string,
    keyData: string,
    options?: RequestOptions,
  ): Promise<{ name: string; id: string }> {
    return requestWithRetry(async () => {
      const baseUrl = await this.getBaseUrl()
      try {
        // Method 1: Try uploading key file using FormData
        const formData = new FormData()
        const keyBlob = new Blob([keyData], {
          type: 'application/octet-stream',
        })
        formData.append('key', keyBlob, `${keyName}.key`)

        const response = await fetchWithTimeout(
          `${baseUrl}/key/import?arg=${keyName}`,
          {
            method: 'POST',
            body: formData,
            timeout: options?.timeout || 30000, // increased timeout
          },
        )

        if (!response.ok) {
          // If FormData method fails, try other methods
          if (response.status === 500 || response.status === 400) {
            console.warn('FormData import failed, trying alternative')
            throw new Error(`HTTP API import failed: ${response.status}`)
          }
          throw new Error(`Failed to import IPNS key: ${response.status}`)
        }

        const data = await response.json()
        return {
          name: data.Name || keyName,
          id: data.Id || data.id || '',
        }
      } catch (error) {
        // If HTTP API is completely unavailable, provide user-friendly error message
        if (
          error instanceof Error &&
          error.message.includes('HTTP API import failed')
        ) {
          throw new Error(
            `Key import is temporarily unavailable in web environment.\n\nSuggested solutions:\n1. Use the Electron desktop version for key import\n2. Or import via CLI: ipfs key import ${keyName} /path/to/keyfile\n3. Check if IPFS node is running correctly`,
          )
        }
        throw error
      }
    }, options)
  }

  // ==================== Storage management ====================

  /**
   * Get repository statistics
   * @param options Request options
   * @returns Repository statistics
   */
  static async getRepoStats(options?: RequestOptions): Promise<{
    repoSize: number // current used size (bytes)
    storageMax: number // maximum storage limit (bytes)
    numObjects: number // number of objects
  }> {
    return requestWithRetry(async () => {
      const baseUrl = await this.getBaseUrl()
      const response = await fetchWithTimeout(
        `${baseUrl}/repo/stat?size-only=false`,
        {
          method: 'POST',
          timeout: options?.timeout,
        },
      )

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Repo stat API error:', response.status, errorText)
        throw new Error(`Failed to get repo stats: ${response.status}`)
      }

      const data = await response.json()
      console.log('Repo stat data:', data)
      return {
        repoSize: data.RepoSize || 0,
        storageMax: data.StorageMax || 0,
        numObjects: data.NumObjects || 0,
      }
    }, options)
  }

  /**
   * Get storage configuration
   * @param options Request options
   * @returns Storage configuration information
   */
  static async getStorageConfig(options?: RequestOptions): Promise<{
    storageMax: string // e.g. "10GB"
    storageGCWatermark: number // e.g. 90 (percentage)
  }> {
    return requestWithRetry(async () => {
      const baseUrl = await this.getBaseUrl()
      const response = await fetchWithTimeout(`${baseUrl}/config/show`, {
        method: 'POST',
        timeout: options?.timeout,
      })

      if (!response.ok) {
        throw new Error(`Failed to get storage config: ${response.status}`)
      }

      const config = await response.json()
      // Kubo's StorageGCWatermark is actually int64 type, storing integer percentage (0-100)
      const watermark = config.Datastore?.StorageGCWatermark || 90
      
      return {
        storageMax: config.Datastore?.StorageMax || '10GB',
        storageGCWatermark: watermark, // use directly, already a percentage
      }
    }, options)
  }

  /**
   * Set maximum storage space
   * @param value Storage space size, such as "10GB" or "10"
   * @param options Request options
   */
  static async setStorageMax(
    value: string,
    options?: RequestOptions,
  ): Promise<void> {
    return requestWithRetry(async () => {
      const baseUrl = await this.getBaseUrl()
      // Ensure value format is correct, avoid duplicate unit addition
      let cleanValue = value.trim()
      
      // Remove all unit suffixes (support GB, MB, TB, KB, etc., case-insensitive)
      cleanValue = cleanValue.replace(/[A-Za-z]+$/g, '')
      
      // Verify if valid number
      const numValue = parseFloat(cleanValue)
      if (isNaN(numValue) || numValue <= 0) {
        throw new Error(`Invalid storage size: ${value}`)
      }
      
      // Add GB unit (must be uppercase)
      const finalValue = `${cleanValue}GB`
      
      console.log('Setting StorageMax:', finalValue)
      
      const response = await fetchWithTimeout(
        `${baseUrl}/config?arg=Datastore.StorageMax&arg=${finalValue}`,
        {
          method: 'POST',
          timeout: options?.timeout,
        },
      )

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Set StorageMax error:', errorText)
        throw new Error(`Failed to set storage limit: ${response.status}`)
      }
    }, options)
  }

  /**
   * Set GC trigger percentage
   * @param percent GC trigger percentage (0-100)
   * @param options Request options
   */
  static async setStorageGCWatermark(
    percent: number,
    options?: RequestOptions,
  ): Promise<void> {
    return requestWithRetry(async () => {
      const baseUrl = await this.getBaseUrl()
      // Verify input range
      if (percent < 0 || percent > 100) {
        throw new Error(`GC trigger point must be between 0-100: ${percent}`)
      }
      
      // Kubo's Datastore.StorageGCWatermark is int64 type
      // Must use json=true parameter, and send JSON format integer
      console.log('Setting StorageGCWatermark:', percent, '%')
      
      // Use json=true parameter, let Kubo correctly parse integer type
      const response = await fetchWithTimeout(
        `${baseUrl}/config?arg=Datastore.StorageGCWatermark&arg=${percent}&json=true`,
        {
          method: 'POST',
          timeout: options?.timeout,
        },
      )

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Set StorageGCWatermark error:', errorText)
        throw new Error(`Failed to set GC trigger point: ${response.status}`)
      }
      
      console.log('StorageGCWatermark set successfully')
    }, options)
  }

  /**
   * Manually trigger garbage collection
   * @param options Request options
   * @returns Cleanup result
   */
  static async runGarbageCollection(options?: RequestOptions): Promise<{
    removedObjects: number
  }> {
    const baseUrl = await this.getBaseUrl()
    // GC operation does not use retry mechanism
    const response = await fetchWithTimeout(
      `${baseUrl}/repo/gc`,
      {
        method: 'POST',
        timeout: 0, // GC may take a long time
      },
    )

    if (!response.ok) {
      throw new Error(`Garbage collection failed: ${response.status}`)
    }

    // Parse GC result
    const text = await response.text()
    const lines = text.trim().split('\n')
    let removedCount = 0

    lines.forEach((line) => {
      try {
        const data = JSON.parse(line)
        if (data.Key) removedCount++
      } catch (e) {
        // Ignore parse errors
      }
    })

    return {
      removedObjects: removedCount,
    }
  }

  // ==================== DHT mode management ====================

  /**
   * Get current DHT mode
   * @param options Request options
   * @returns DHT mode ('dhtserver' | 'dhtclient')
   */
  static async getDHTMode(options?: RequestOptions): Promise<string> {
    return requestWithRetry(async () => {
      const baseUrl = await this.getBaseUrl()
      const response = await fetchWithTimeout(`${baseUrl}/config/show`, {
        method: 'POST',
        timeout: options?.timeout,
      })

      if (!response.ok) {
        throw new Error(`Failed to get config: ${response.status}`)
      }

      const config = await response.json()
      return config.Routing?.Type || 'dhtclient'
    }, options)
  }

  /**
   * Set DHT mode
   * @param mode DHT mode ('dhtserver' | 'dhtclient')
   * @param options Request options
   * @returns Set result
   */
  static async setDHTMode(
    mode: 'dhtserver' | 'dhtclient',
    options?: RequestOptions,
  ): Promise<void> {
    return requestWithRetry(async () => {
      const baseUrl = await this.getBaseUrl()
      // Use simple URL parameter method, without json=true parameter
      const url = `${baseUrl}/config?arg=Routing.Type&arg=${mode}`

      const response = await fetchWithTimeout(url, {
        method: 'POST',
        timeout: options?.timeout,
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('DHT mode set failed response:', errorText)
        throw new Error(`Failed to set DHT mode: ${response.status} - ${errorText}`)
      }

      // Try to parse response, ignore if not JSON
      try {
        const result = await response.json()
        console.log('DHT mode set successfully:', result)
      } catch (e) {
        // If response is not JSON, it may be plain text success response
        const text = await response.text()
        console.log('DHT mode set successfully (text response):', text)
      }
    }, options)
  }

  /**
   * Restart IPFS daemon
   * Note: Kubo 0.39 does not support automatic restart via API, can only shutdown daemon
   * In Electron environment, main process monitors and automatically restarts kubo process
   * @param options Request options
   */
  static async restartDaemon(options?: RequestOptions): Promise<void> {
    try {
      const baseUrl = await this.getBaseUrl()
      // Send shutdown signal
      await fetchWithTimeout(`${baseUrl}/shutdown`, {
        method: 'POST',
        timeout: options?.timeout || 5000,
      })
    } catch (err) {
      // shutdown API may throw error due to connection disconnect, this is normal
      console.log('IPFS daemon shutdown signal sent')
    }
  }

  // ==================== Utility methods ====================

  /**
   * Get IPFS Gateway URL (synchronous, use cached gateway URL)
   * First call uses default port, after dynamic port initialization automatically updates cache
   * @param cid File CID
   * @returns Gateway URL
   */
  static getGatewayUrl(cid: string): string {
    return `${this.gatewayUrl}/ipfs/${cid}`
  }

  /**
   * Get IPFS Gateway URL (asynchronous, ensure using dynamic port)
   * @param cid File CID
   * @returns Gateway URL
   */
  static async getGatewayUrlAsync(cid: string): Promise<string> {
    const gatewayUrl = await this.getGatewayBaseUrl()
    return `${gatewayUrl}/ipfs/${cid}`
  }

  /**
   * Get IPNS Gateway URL (synchronous, use cached gateway URL)
   * @param name IPNS name
   * @returns Gateway URL
   */
  static getIPNSGatewayUrl(name: string): string {
    return `${this.gatewayUrl}/ipns/${name}`
  }

  /**
   * Get IPNS Gateway URL (asynchronous, ensure using dynamic port)
   * @param name IPNS name
   * @returns Gateway URL
   */
  static async getIPNSGatewayUrlAsync(name: string): Promise<string> {
    const gatewayUrl = await this.getGatewayBaseUrl()
    return `${gatewayUrl}/ipns/${name}`
  }

  /**
   * Pre-initialize Gateway URL cache (call at application startup, ensure dynamic port takes effect)
   */
  static async initGatewayUrl(): Promise<void> {
    await this.getGatewayBaseUrl()
  }

  /**
   * Verify CID format is correct
   * @param cid CID to verify
   * @returns Whether it is a valid CID
   */
  static isValidCID(cid: string): boolean {
    // Simple CID format verification
    const cidRegex =
      /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[A-Za-z2-7]{58}|z[1-9A-HJ-NP-Za-km-z]+)$/
    return cidRegex.test(cid)
  }

  /**
   * Format file size
   * @param bytes Number of bytes
   * @returns Formatted file size string
   */
  static formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let size = bytes
    let unitIndex = 0

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024
      unitIndex++
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`
  }
}

// ==================== Export ====================

// Export class and instance
export const ipfsConnector = IpfsConnector
export default ipfsConnector
