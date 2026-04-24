/**
 * useIpnsSync — background sync hook for IPNS mode creators.
 *
 * The ipnsSiteInfoCache is the authoritative local state. This hook watches it
 * and, whenever syncStatus is 'pending', attempts to push the cached data to
 * the IPNS network every SYNC_INTERVAL ms until the network confirms the update.
 * Once synced, polling stops until the next local change (new 'pending' write).
 */
import { useEffect, useRef, useState } from 'react'
import { APP_CONFIG } from '../../config'
import { privateDataMgr } from '../utils/privateDataMgr'
import { ipfsConnector } from '../utils/ipfsConnector'

const SYNC_INTERVAL = 30 * 1000 // 30 seconds

export function useIpnsSync() {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [syncStatus, setSyncStatus] = useState<'pending' | 'synced' | null>(() => {
    const cache = privateDataMgr.getIPNSSiteInfoCache()
    return cache ? cache.syncStatus : null
  })

  const stopPolling = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const startPolling = () => {
    if (timerRef.current) return // already running
    timerRef.current = setInterval(attemptSync, SYNC_INTERVAL)
  }

  const attemptSync = async () => {
    const creatorInfo = privateDataMgr.getCreatorInfo()
    if (!creatorInfo?.ipnsId) return

    const cache = privateDataMgr.getIPNSSiteInfoCache()
    if (!cache || cache.syncStatus === 'synced') {
      stopPolling()
      return
    }

    console.log('[useIpnsSync] Attempting to sync cache to IPNS...')
    privateDataMgr.updateIPNSSyncAttempt()

    try {
      const jsonBlob = new Blob([JSON.stringify(cache.data)], { type: 'application/json' })
      const jsonFile = new File([jsonBlob], APP_CONFIG.SITE_FILE_NAME, { type: 'application/json' })
      const uploadResult = await ipfsConnector.uploadFilesToExistingIPNS([jsonFile], creatorInfo.ipnsId)
      await ipfsConnector.publishToIPNS(creatorInfo.ipnsId, uploadResult.hash)

      // Verify: resolve IPNS and check the works list matches cache
      const resolvedCid = await ipfsConnector.resolveIPNS(creatorInfo.ipnsId)
      const files = await ipfsConnector.listFiles(resolvedCid)
      const siteFile = files.find((f) => f.name === APP_CONFIG.SITE_FILE_NAME)
      if (siteFile) {
        const networkData = await ipfsConnector.downloadFileAsJSON<any>(siteFile.hash)
        const networkWorks = (networkData.works || []).map((w: any) => w.cid).sort().join(',')
        const cacheWorks = (cache.data.works || []).map((w: any) => w.cid).sort().join(',')
        if (networkWorks === cacheWorks) {
          console.log('[useIpnsSync] Sync confirmed — stopping polling')
          privateDataMgr.markIPNSSiteInfoCacheSynced()
          setSyncStatus('synced')
          stopPolling()
        } else {
          console.log('[useIpnsSync] Network not yet consistent, will retry in 30s')
        }
      }
    } catch (err) {
      console.error('[useIpnsSync] Sync attempt failed:', err)
    }
  }

  useEffect(() => {
    const cache = privateDataMgr.getIPNSSiteInfoCache()
    if (cache?.syncStatus === 'pending') {
      setSyncStatus('pending')
      attemptSync()
      startPolling()
    }
    // Watch for new pending writes every 30s
    const watchTimer = setInterval(() => {
      const c = privateDataMgr.getIPNSSiteInfoCache()
      if (c?.syncStatus === 'pending' && !timerRef.current) {
        console.log('[useIpnsSync] Detected new pending change, starting sync')
        setSyncStatus('pending')
        attemptSync()
        startPolling()
      }
    }, SYNC_INTERVAL)

    return () => {
      stopPolling()
      clearInterval(watchTimer)
    }
  }, [])

  return { syncStatus, setSyncStatus }
}
