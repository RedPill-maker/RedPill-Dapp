/**
 * Fetch contract event data from IPFS with multi-source cross-verification.
 *
 * Data integrity rules:
 * - 2+ sources with CIDs: cross-verify before writing (history CID match → trust; mismatch → compare events)
 * - Exactly 1 source with CID: single-source fallback with warning (timeout/failure ≠ missing)
 * - 0 sources: abort
 *
 * Block height rule: only sync to min(sourceA.end, sourceB.end) so all written data
 * is confirmed by at least two sources. RPC real-time sync fills the gap afterwards.
 */
import { createPublicClient, http, type Abi } from 'viem'
import { filecoinCalibration } from 'viem/chains'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { IPFS_CONFIG, API_ENDPOINTS } from '../config.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const abiPath = path.resolve(__dirname, '../contract_info/CreatorHub_abi.json')
const contractAbi: Abi = JSON.parse(fs.readFileSync(abiPath, 'utf-8'))

// Network config - injected via setIpfsFetcherConfig()
let contractAddress = '0x0000000000000000000000000000000000000000'
let ipfsClient = createPublicClient({
  chain: filecoinCalibration,
  transport: http(),
})

/**
 * Configure the IPFS fetcher with the active network's RPC and contract address.
 * Must be called before fetchEventsFromIPFS.
 */
export function setIpfsFetcherConfig(rpcUrl: string, chainId: number, contract: string): void {
  contractAddress = contract
  ipfsClient = createPublicClient({
    chain: { ...filecoinCalibration, id: chainId as any },
    transport: http(rpcUrl),
  })
}

// ============ Type Definitions ============

interface EventFileMetadata {
  start: number
  end: number
  history: Record<string, string>[]
}

export interface RawEventLine {
  topics: string[]
  data: string
  blockNumber: number
  transactionHash: string
  logIndex: number
  address: string
}

interface HistoryEntry {
  start: number
  end: number
  cid: string
}

interface FileChunk {
  entry: HistoryEntry
  events: RawEventLine[]
}

/** Parsed metadata + events from a single maintainer's latest JSONL file */
interface SourceData {
  maintainer: string
  cid: string
  metadata: EventFileMetadata
  events: RawEventLine[]
  historyEntries: HistoryEntry[]
}

export type ChunkProcessor = (
  events: RawEventLine[],
  coveredRange: { fromBlock: number; toBlock: number },
) => boolean

export type IpfsProgressCallback = (downloaded: number, total: number) => void

export interface IpfsEventResult {
  success: boolean
  coveredEndBlock: number
  processedChunks: number
  totalEvents: number
  error?: string
}

// ============ IPFS Access ============

async function ipfsCatLocal(cid: string, timeoutMs = 30000): Promise<string> {
  const url = `${IPFS_CONFIG.API_BASE_URL}${API_ENDPOINTS.IPFS.CAT}?arg=${cid}`
  const response = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`Local Kubo HTTP ${response.status} ${response.statusText}`)
  return response.text()
}

async function ipfsCatGateway(cid: string, gatewayBase: string, timeoutMs = 30000): Promise<string> {
  const url = `${gatewayBase}/ipfs/${cid}`
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`Gateway ${gatewayBase} HTTP ${response.status} ${response.statusText}`)
  return response.text()
}

async function ipfsCat(cid: string, retries = IPFS_CONFIG.MAX_RETRY_ATTEMPTS): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (attempt === 1) {
        // First attempt: local Kubo only
        return await ipfsCatLocal(cid)
      } else {
        // Subsequent attempts: race local Kubo + all public gateways, first wins
        console.log(`  IPFS cat retry (${attempt}/${retries}): ${cid} — racing local + public gateways`)
        const candidates: Promise<string>[] = [
          ipfsCatLocal(cid, 60000),
          ...IPFS_CONFIG.PUBLIC_GATEWAYS.map((gw) => ipfsCatGateway(cid, gw)),
        ]
        return await Promise.any(candidates)
      }
    } catch (err) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, IPFS_CONFIG.RETRY_DELAY))
      } else {
        throw new Error(`IPFS cat failed (${cid}) after ${retries} attempts: ${err}`)
      }
    }
  }
  throw new Error('unreachable')
}

// ============ Contract Calls ============

export async function getAllEventData(): Promise<{ maintainers: string[]; cids: string[] }> {
  const result = await ipfsClient.readContract({
    address: contractAddress as `0x${string}`,
    abi: contractAbi,
    functionName: 'getAllEventData',
  }) as [string[], string[]]
  return { maintainers: result[0], cids: result[1] }
}

// ============ JSONL Parsing ============

function parseJsonlFile(content: string): {
  metadata: EventFileMetadata
  events: RawEventLine[]
} {
  const lines = content.split('\n').filter((line) => line.trim())
  if (lines.length === 0) throw new Error('JSONL file is empty')

  const metadata: EventFileMetadata = JSON.parse(lines[0])
  const events: RawEventLine[] = []
  for (let i = 1; i < lines.length; i++) {
    try {
      events.push(JSON.parse(lines[i]) as RawEventLine)
    } catch { /* skip unparseable lines */ }
  }
  return { metadata, events }
}

function parseHistoryEntry(entry: Record<string, string>): HistoryEntry | null {
  const key = Object.keys(entry)[0]
  if (!key) return null
  const parts = key.split('-')
  if (parts.length !== 2) return null
  return { start: parseInt(parts[0]), end: parseInt(parts[1]), cid: entry[key] }
}

function validateShardContinuity(metadata: EventFileMetadata): {
  valid: boolean
  error?: string
} {
  if (!metadata.history || metadata.history.length === 0) {
    return { valid: true }
  }

  const historyEntries = metadata.history
    .map(parseHistoryEntry)
    .filter((e): e is HistoryEntry => e !== null)
    .sort((a, b) => a.start - b.start)

  for (let i = 0; i < historyEntries.length - 1; i++) {
    const current = historyEntries[i]
    const next = historyEntries[i + 1]
    if (current.end + 1 !== next.start) {
      return {
        valid: false,
        error: `Shard discontinuous: gap between ${current.start}-${current.end} and ${next.start}-${next.end}`,
      }
    }
  }

  const lastHistory = historyEntries[historyEntries.length - 1]
  if (lastHistory.end + 1 !== metadata.start) {
    return {
      valid: false,
      error: `Shard discontinuous: gap between history ${lastHistory.start}-${lastHistory.end} and current ${metadata.start}-${metadata.end}`,
    }
  }

  return { valid: true }
}

async function isIPFSDataStale(latestBlock: number, currentBlock: number): Promise<boolean> {
  const BLOCK_TIME = 30
  const SIXTEEN_HOURS = 16 * 60 * 60
  return (currentBlock - latestBlock) * BLOCK_TIME > SIXTEEN_HOURS
}

// ============ Non-business event topics to exclude from cross-verification ============
// These are contract maintenance events that maintainers may or may not archive,
// so differences between sources are expected and should not trigger verification failure.
const NON_BUSINESS_TOPICS = new Set([
  '0xb6a4cf5a5cd19ae451354662e3235b86c78f8a76ad18c8b53b8b74d83dbf6a11', // EventDataCidUpdated
  '0x4e6ea1ae44b2628f2ed4c22921a490f0c2a98563e95910d3a08fc1872c0eb47d', // EventDataMaintainerAdded
  '0x1ff4255de4bba90849a9d41411aafcad9f99f377d0b6f095df04e7be71c940c6', // EventDataMaintainerRemoved
])

function isBusinessEvent(event: RawEventLine): boolean {
  return !NON_BUSINESS_TOPICS.has(event.topics[0])
}

// ============ Multi-Source Verification ============

/**
 * Compare events from two sources for a given block range.
 * Returns true if events are identical (same topics, data, blockNumber, txHash, logIndex).
 */
function eventsMatch(eventsA: RawEventLine[], eventsB: RawEventLine[]): boolean {
  if (eventsA.length !== eventsB.length) return false
  for (let i = 0; i < eventsA.length; i++) {
    const a = eventsA[i]
    const b = eventsB[i]
    if (
      a.blockNumber !== b.blockNumber ||
      a.logIndex !== b.logIndex ||
      a.transactionHash !== b.transactionHash ||
      a.data !== b.data ||
      a.topics.length !== b.topics.length ||
      a.topics.some((t, idx) => t !== b.topics[idx])
    ) {
      return false
    }
  }
  return true
}

/**
 * Fetch and parse a maintainer's latest JSONL file.
 * Returns null on failure (timeout, network error, parse error).
 */
async function fetchSourceData(maintainer: string, cid: string): Promise<SourceData | null> {
  try {
    const content = await ipfsCat(cid)
    const { metadata, events } = parseJsonlFile(content)
    const continuity = validateShardContinuity(metadata)
    if (!continuity.valid) {
      console.warn(`Source ${maintainer}: shard continuity failed: ${continuity.error}`)
      return null
    }
    const historyEntries = (metadata.history || [])
      .map(parseHistoryEntry)
      .filter((e): e is HistoryEntry => e !== null)
      .sort((a, b) => a.start - b.start)
    return { maintainer, cid, metadata, events, historyEntries }
  } catch (err) {
    console.warn(`Source ${maintainer}: failed to fetch CID ${cid}: ${err}`)
    return null
  }
}

/**
 * Cross-verify history entries from two sources.
 * Returns the list of verified HistoryEntry objects (CID-matched or event-content-matched).
 * Entries that fail verification are excluded.
 * If a third source is available, it's used as tiebreaker for mismatches.
 */
async function verifyHistoryEntries(
  primary: SourceData,
  secondary: SourceData,
  tertiary: SourceData | null,
  fromBlock: number,
): Promise<{ verified: HistoryEntry[]; error?: string }> {
  // History structure must match (same shard count and block ranges)
  if (primary.historyEntries.length !== secondary.historyEntries.length) {
    return { verified: [], error: 'History structure mismatch: different shard count between sources' }
  }

  for (let i = 0; i < primary.historyEntries.length; i++) {
    const a = primary.historyEntries[i]
    const b = secondary.historyEntries[i]
    if (a.start !== b.start || a.end !== b.end) {
      return { verified: [], error: `History structure mismatch at shard ${i}: ${a.start}-${a.end} vs ${b.start}-${b.end}` }
    }
  }

  // Filter to entries we actually need
  const needed = primary.historyEntries.filter((e) => e.end >= fromBlock)
  const verified: HistoryEntry[] = []

  for (const entry of needed) {
    const matchIdx = secondary.historyEntries.findIndex(
      (e) => e.start === entry.start && e.end === entry.end,
    )
    if (matchIdx === -1) continue

    const secondaryEntry = secondary.historyEntries[matchIdx]

    // Fast path: CID match → cryptographically guaranteed identical content
    if (entry.cid === secondaryEntry.cid) {
      verified.push(entry)
      continue
    }

    // Slow path: CID mismatch → download both and compare events
    console.log(`  CID mismatch for blocks ${entry.start}-${entry.end}, downloading both for comparison...`)
    let eventsA: RawEventLine[]
    let eventsB: RawEventLine[]
    try {
      const [contentA, contentB] = await Promise.all([
        ipfsCat(entry.cid),
        ipfsCat(secondaryEntry.cid),
      ])
      eventsA = parseJsonlFile(contentA).events
        .filter(isBusinessEvent)
        .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex)
      eventsB = parseJsonlFile(contentB).events
        .filter(isBusinessEvent)
        .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex)
    } catch (err) {
      console.warn(`  Failed to download shard for comparison (blocks ${entry.start}-${entry.end}): ${err}`)
      continue // Skip this shard, don't include unverified data
    }

    if (eventsMatch(eventsA, eventsB)) {
      verified.push(entry) // Content identical despite different CIDs
      continue
    }

    // Events differ - try third source as tiebreaker
    if (tertiary) {
      const tertiaryEntry = tertiary.historyEntries.find(
        (e) => e.start === entry.start && e.end === entry.end,
      )
      if (tertiaryEntry) {
        // Check if tertiary CID matches either source
        if (tertiaryEntry.cid === entry.cid) {
          console.log(`  Third source confirms primary for blocks ${entry.start}-${entry.end}`)
          verified.push(entry)
          continue
        }
        if (tertiaryEntry.cid === secondaryEntry.cid) {
          console.log(`  Third source confirms secondary for blocks ${entry.start}-${entry.end}`)
          verified.push(secondaryEntry)
          continue
        }
        // All three CIDs differ - download third and compare
        try {
          const contentC = await ipfsCat(tertiaryEntry.cid)
          const eventsC = parseJsonlFile(contentC).events
            .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex)
          if (eventsMatch(eventsA, eventsC)) {
            verified.push(entry)
            continue
          }
          if (eventsMatch(eventsB, eventsC)) {
            verified.push(secondaryEntry)
            continue
          }
        } catch {
          // Third source also failed, skip
        }
      }
    }

    console.error(`  UNVERIFIED shard blocks ${entry.start}-${entry.end}: all sources disagree, skipping`)
    // Do not include this shard - data integrity cannot be confirmed
  }

  return { verified }
}

/**
 * Cross-verify the "current" (latest) shard events between two sources.
 * Compares events block-by-block from commonStart up to commonEnd.
 * Returns all verified events up to (but not including) the first diverging block,
 * and the last verified block number.
 */
function verifyCurrentEvents(
  primary: SourceData,
  secondary: SourceData,
): { events: RawEventLine[]; verifiedEnd: number } | null {
  const commonEnd = Math.min(primary.metadata.end, secondary.metadata.end)
  const commonStart = Math.max(primary.metadata.start, secondary.metadata.start)

  if (commonEnd < commonStart) {
    return null
  }

  // Group events by block number for both sources (business events only)
  const groupByBlock = (evts: RawEventLine[], start: number, end: number) => {
    const map = new Map<number, RawEventLine[]>()
    for (const e of evts) {
      if (e.blockNumber < start || e.blockNumber > end) continue
      if (!isBusinessEvent(e)) continue
      const arr = map.get(e.blockNumber) ?? []
      arr.push(e)
      map.set(e.blockNumber, arr)
    }
    // Sort each block's events by logIndex
    for (const [, arr] of map) arr.sort((a, b) => a.logIndex - b.logIndex)
    return map
  }

  const mapA = groupByBlock(primary.events, commonStart, commonEnd)
  const mapB = groupByBlock(secondary.events, commonStart, commonEnd)

  // Collect all block numbers in range (union of both sources)
  const allBlocks = Array.from(
    new Set([...mapA.keys(), ...mapB.keys()])
  ).sort((a, b) => a - b)

  const verifiedEvents: RawEventLine[] = []
  let verifiedEnd = commonStart - 1

  for (const blockNum of allBlocks) {
    const evtsA = mapA.get(blockNum) ?? []
    const evtsB = mapB.get(blockNum) ?? []

    if (!eventsMatch(evtsA, evtsB)) {
      console.warn(`Current shard divergence at block ${blockNum}: source A has ${evtsA.length} events, source B has ${evtsB.length} events — stopping verification here`)
      break
    }

    verifiedEvents.push(...evtsA)
    verifiedEnd = blockNum
  }

  // Also include blocks in range that both sources agree have 0 events
  // (blocks with no events in either source are implicitly agreed upon)
  // verifiedEnd should advance to commonEnd if no divergence found in any block with events
  if (allBlocks.length === 0 || verifiedEnd === allBlocks[allBlocks.length - 1]) {
    // No divergence found — verified through commonEnd
    verifiedEnd = commonEnd
  }

  if (verifiedEnd < commonStart) {
    return null
  }

  return { events: verifiedEvents, verifiedEnd }
}

// ============ Core Logic ============

export async function fetchEventsFromIPFS(
  fromBlock: number,
  onChunk?: ChunkProcessor,
  onIpfsProgress?: IpfsProgressCallback,
): Promise<IpfsEventResult> {
  try {
    // 1. Get all maintainer CIDs from contract
    console.log('Fetching event data sources from contract...')
    const { maintainers, cids } = await getAllEventData()

    // Filter to maintainers that have a non-empty CID
    const validSources: { maintainer: string; cid: string }[] = []
    for (let i = 0; i < maintainers.length; i++) {
      if (cids[i] && cids[i].trim()) {
        validSources.push({ maintainer: maintainers[i], cid: cids[i] })
      }
    }

    console.log(`Found ${validSources.length} source(s) with CIDs out of ${maintainers.length} maintainer(s)`)

    if (validSources.length === 0) {
      return { success: false, coveredEndBlock: fromBlock - 1, processedChunks: 0, totalEvents: 0, error: 'No event data sources available in contract' }
    }

    const isSingleSource = validSources.length === 1

    if (isSingleSource) {
      console.warn('WARNING: Only 1 data source available, running in single-source mode (no cross-verification)')
    }

    // 2. Download latest JSONL from all sources in parallel
    console.log('Downloading latest event data from all sources...')
    const sourcePromises = validSources.map((s) => fetchSourceData(s.maintainer, s.cid))
    const sourceResults = await Promise.all(sourcePromises)
    const sources = sourceResults.filter((s): s is SourceData => s !== null)

    if (sources.length === 0) {
      return { success: false, coveredEndBlock: fromBlock - 1, processedChunks: 0, totalEvents: 0, error: 'All event data sources failed to download or validate' }
    }

    // Re-check: if contract had 2+ CIDs but only 1 downloaded successfully, that's NOT single-source mode
    // (timeout/failure ≠ missing). We cannot verify, so abort.
    if (!isSingleSource && sources.length < 2) {
      return {
        success: false, coveredEndBlock: fromBlock - 1, processedChunks: 0, totalEvents: 0,
        error: 'Cross-verification requires at least 2 sources but only 1 responded. Aborting (use RPC fallback).',
      }
    }

    // 3. Determine primary, secondary, tertiary
    const primary = sources[0]
    const secondary = isSingleSource ? null : sources[1]
    const tertiary = sources.length >= 3 ? sources[2] : null

    // Log source info
    for (const s of sources) {
      console.log(`  Source ${s.maintainer}: blocks ${s.historyEntries.length > 0 ? s.historyEntries[0].start : s.metadata.start}-${s.metadata.end}, history shards: ${s.historyEntries.length}`)
    }

    // 4. Check coverage
    const earliestBlock = primary.historyEntries.length > 0 ? primary.historyEntries[0].start : primary.metadata.start
    if (earliestBlock > fromBlock) {
      const currentBlockNumber = await ipfsClient.getBlockNumber()
      const currentBlock = Number(currentBlockNumber)
      const isStale = await isIPFSDataStale(primary.metadata.end, currentBlock)
      if (isStale) {
        return { success: false, coveredEndBlock: fromBlock - 1, processedChunks: 0, totalEvents: 0, error: `Server data stale: IPFS latest block ${primary.metadata.end} is more than 16 hours behind current block ${currentBlock}` }
      }
      return { success: false, coveredEndBlock: fromBlock - 1, processedChunks: 0, totalEvents: 0, error: `IPFS data start block ${earliestBlock} > requested block ${fromBlock}, possible database state anomaly` }
    }

    // 5. Verify and build chunk list
    let verifiedHistory: HistoryEntry[]
    let currentShardEvents: RawEventLine[] | null = null
    let currentShardEnd: number

    if (isSingleSource) {
      // Single-source mode: trust all data (with warning already logged)
      verifiedHistory = primary.historyEntries.filter((e) => e.end >= fromBlock)
      currentShardEvents = primary.events
      currentShardEnd = primary.metadata.end
    } else {
      // Multi-source: cross-verify history
      const historyResult = await verifyHistoryEntries(primary, secondary!, tertiary, fromBlock)
      if (historyResult.error) {
        console.error(`History verification failed: ${historyResult.error}`)
        return { success: false, coveredEndBlock: fromBlock - 1, processedChunks: 0, totalEvents: 0, error: `Data verification failed: ${historyResult.error}` }
      }
      verifiedHistory = historyResult.verified

      // Cross-verify current shard events
      const currentResult = verifyCurrentEvents(primary, secondary!)
      if (currentResult) {
        currentShardEvents = currentResult.events
        currentShardEnd = currentResult.verifiedEnd
      } else {
        // Current shard failed verification - try with tertiary
        if (tertiary) {
          const altResult = verifyCurrentEvents(primary, tertiary) || verifyCurrentEvents(secondary!, tertiary)
          if (altResult) {
            currentShardEvents = altResult.events
            currentShardEnd = altResult.verifiedEnd
          } else {
            console.warn('Current shard failed verification with all source pairs, skipping (RPC will fill gap)')
            currentShardEnd = verifiedHistory.length > 0 ? verifiedHistory[verifiedHistory.length - 1].end : fromBlock - 1
          }
        } else {
          console.warn('Current shard failed verification, skipping (RPC will fill gap)')
          currentShardEnd = verifiedHistory.length > 0 ? verifiedHistory[verifiedHistory.length - 1].end : fromBlock - 1
        }
      }
    }

    // 6. Build download queue and process in block order
    const allChunks: { entry: HistoryEntry; promise: Promise<FileChunk> }[] = []

    for (const entry of verifiedHistory) {
      console.log(`  Queuing download: blocks ${entry.start}-${entry.end} (${entry.cid})`)
      const promise = ipfsCat(entry.cid).then((content) => {
        const { events } = parseJsonlFile(content)
        console.log(`  Download complete: blocks ${entry.start}-${entry.end}, ${events.length} events`)
        return { entry, events }
      })
      allChunks.push({ entry, promise })
    }

    // Add current shard as last chunk (if verified)
    if (currentShardEvents) {
      const currentEntry: HistoryEntry = { start: primary.metadata.start, end: currentShardEnd!, cid: primary.cid }
      allChunks.push({
        entry: currentEntry,
        promise: Promise.resolve({ entry: currentEntry, events: currentShardEvents }),
      })
    }

    // 7. Process chunks in block order
    let processedChunks = 0
    let totalEvents = 0
    let lastCoveredBlock = fromBlock - 1
    const totalChunks = allChunks.length

    onIpfsProgress?.(0, totalChunks)

    for (const { entry, promise } of allChunks) {
      let chunk: FileChunk
      try {
        chunk = await promise
      } catch (err) {
        console.error(`  Download failed: blocks ${entry.start}-${entry.end}: ${err}`)
        return {
          success: processedChunks > 0,
          coveredEndBlock: lastCoveredBlock,
          processedChunks,
          totalEvents,
          error: `Network error: Failed to download history file (blocks ${entry.start}-${entry.end}): ${err}`,
        }
      }

      const filtered = chunk.events
        .filter((e) => e.blockNumber >= fromBlock && e.blockNumber <= entry.end)
        .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex)

      if (onChunk) {
        const shouldContinue = onChunk(filtered, { fromBlock: Math.max(entry.start, fromBlock), toBlock: entry.end })
        if (!shouldContinue) {
          return { success: false, coveredEndBlock: lastCoveredBlock, processedChunks, totalEvents, error: 'Database write failed' }
        }
      }

      processedChunks++
      totalEvents += filtered.length
      lastCoveredBlock = entry.end

      onIpfsProgress?.(processedChunks, totalChunks)
    }

    const mode = isSingleSource ? ' (single-source, unverified)' : ' (cross-verified)'
    console.log(`IPFS event data processing complete${mode}: ${processedChunks} files, ${totalEvents} events, covered to block ${lastCoveredBlock}`)

    return { success: true, coveredEndBlock: lastCoveredBlock, processedChunks, totalEvents }
  } catch (err: any) {
    return {
      success: false, coveredEndBlock: fromBlock - 1, processedChunks: 0, totalEvents: 0,
      error: `Network error: ${err.message || String(err)}`,
    }
  }
}
