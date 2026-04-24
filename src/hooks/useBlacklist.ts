import { useState, useCallback } from 'react'
import { privateDataMgr, BlacklistedWork, BlacklistedCreator } from '../utils/privateDataMgr'

export function useBlacklist() {
  const [blacklistedWorks, setBlacklistedWorks] = useState<BlacklistedWork[]>(
    () => privateDataMgr.getAllBlacklistedWorks()
  )
  const [blacklistedCreators, setBlacklistedCreators] = useState<BlacklistedCreator[]>(
    () => privateDataMgr.getAllBlacklistedCreators()
  )

  const refresh = useCallback(() => {
    setBlacklistedWorks(privateDataMgr.getAllBlacklistedWorks())
    setBlacklistedCreators(privateDataMgr.getAllBlacklistedCreators())
  }, [])

  const blockWork = useCallback((cid: string, title: string) => {
    privateDataMgr.addBlacklistedWork(cid, title)
    refresh()
  }, [refresh])

  const unblockWork = useCallback((cid: string) => {
    privateDataMgr.removeBlacklistedWork(cid)
    refresh()
  }, [refresh])

  const blockCreator = useCallback((username: string) => {
    privateDataMgr.addBlacklistedCreator(username)
    refresh()
  }, [refresh])

  const unblockCreator = useCallback((username: string) => {
    privateDataMgr.removeBlacklistedCreator(username)
    refresh()
  }, [refresh])

  const isWorkBlacklisted = useCallback((cid: string) => {
    return blacklistedWorks.some((w) => w.cid === cid)
  }, [blacklistedWorks])

  const isCreatorBlacklisted = useCallback((username: string) => {
    return blacklistedCreators.some((c) => c.username === username)
  }, [blacklistedCreators])

  const filterItems = useCallback(<T extends { cid?: string; creator_name?: string }>(items: T[]): T[] => {
    return items.filter((item) => {
      if (item.cid && isWorkBlacklisted(item.cid)) return false
      if (item.creator_name && isCreatorBlacklisted(item.creator_name)) return false
      return true
    })
  }, [isWorkBlacklisted, isCreatorBlacklisted])

  return {
    blacklistedWorks,
    blacklistedCreators,
    blockWork,
    unblockWork,
    blockCreator,
    unblockCreator,
    isWorkBlacklisted,
    isCreatorBlacklisted,
    filterItems,
    refresh,
  }
}
