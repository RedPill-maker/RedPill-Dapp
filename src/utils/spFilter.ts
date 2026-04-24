/**
 * SP Filter — IPNI-capable Storage Provider selection for Filecoin Onchain Cloud
 *
 * Standalone utility that filters Filecoin storage providers (SPs) to find those
 * that support IPNI IPFS indexing, ensuring uploaded files are discoverable and
 * accessible via the IPFS network (e.g. ipfs.io/ipfs/<cid>).
 *
 * Dependencies: @filoz/synapse-core (^0.3.3), viem (^2.x)
 * No project-specific imports — can be used as an independent library.
 *
 * Filtering pipeline:
 *   1. Approved — SP is whitelisted by the FWSS (Warm Storage) contract
 *   2. Endorsed — SP is in the FilOz ProviderIdSet endorsement contract
 *   3. ipniIpfs — SP declares IPFS-level IPNI indexing capability
 *   4. Ping    — SP's PDP service endpoint is healthy
 */

import { getApprovedPDPProviders } from '@filoz/synapse-core/sp-registry'
import { getProviderIds as getEndorsedProviderIds } from '@filoz/synapse-core/endorsements'
import { ping } from '@filoz/synapse-core/sp'
import type { PDPProvider } from '@filoz/synapse-core/sp-registry'
import { createPublicClient, http } from 'viem'
import type { Chain, Client, Transport } from 'viem'

// Re-export for consumers
export type { PDPProvider }

// ==================== Network Configuration ====================

/**
 * Chain configurations for Synapse SDK.
 * Import from @filoz/synapse-core/chains in your project:
 *   import { calibration, mainnet } from '@filoz/synapse-core/chains'
 *
 * Or use the helper `createFilterClient()` which accepts these chain objects directly.
 */

// ==================== Types ====================

export interface SPFilterOptions {
  /** Require endorsed SPs (default: true) */
  requireEndorsed?: boolean
  /** Require ipniIpfs capability (default: true) */
  requireIpniIpfs?: boolean
  /** Run ping health check (default: true) */
  pingCheck?: boolean
  /** Ping timeout in ms (default: 5000) */
  pingTimeout?: number
  /** Max number of providers to return (default: all matching) */
  maxResults?: number
}

export interface SPFilterResult {
  /** Filtered providers that passed all checks */
  providers: PDPProvider[]
  /** Total approved providers before filtering */
  totalApproved: number
  /** Count of endorsed providers */
  totalEndorsed: number
  /** Providers that passed endorsement + capability filter but failed ping */
  pingFailed: PDPProvider[]
}

// ==================== Core API ====================

/**
 * Create a read-only viem public client for SP filtering.
 * This client is used only for on-chain queries (no signing needed).
 *
 * @param chain - Chain object from @filoz/synapse-core/chains (calibration or mainnet)
 * @param rpcUrl - Optional custom RPC URL. Defaults to chain's built-in RPC.
 */
export function createFilterClient(
  chain: Chain,
  rpcUrl?: string,
): Client<Transport, Chain> {
  return createPublicClient({
    chain,
    transport: http(rpcUrl ?? (chain.rpcUrls.default.http[0] as string)),
  }) as Client<Transport, Chain>
}

/**
 * Filter storage providers to find IPNI-capable ones.
 *
 * @param client - viem Client with chain configured (use createFilterClient or your own)
 * @param options - Filtering options
 * @returns Filtered providers and statistics
 *
 * @example
 * ```ts
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createFilterClient, filterProviders } from './spFilter'
 *
 * const client = createFilterClient(calibration)
 * const result = await filterProviders(client)
 * console.log(result.providers[0]?.id) // bigint provider ID
 * ```
 */
export async function filterProviders(
  client: Client<Transport, Chain>,
  options: SPFilterOptions = {},
): Promise<SPFilterResult> {
  const {
    requireEndorsed = true,
    requireIpniIpfs = true,
    pingCheck = true,
    pingTimeout = 5000,
    maxResults,
  } = options

  // Step 1: Fetch approved PDP providers and endorsed IDs in parallel
  const [approvedProviders, endorsedIds] = await Promise.all([
    getApprovedPDPProviders(client),
    requireEndorsed ? getEndorsedProviderIds(client) : Promise.resolve(new Set<bigint>()),
  ])

  const totalApproved = approvedProviders.length
  const totalEndorsed = endorsedIds.size

  // Step 2: Filter by endorsement + IPNI capability
  let candidates = approvedProviders.filter((provider) => {
    if (requireEndorsed && !endorsedIds.has(provider.id)) return false
    if (requireIpniIpfs && !provider.pdp.ipniIpfs) return false
    return true
  })

  // Step 3: Ping health check
  const pingFailed: PDPProvider[] = []
  if (pingCheck && candidates.length > 0) {
    const pingResults = await Promise.allSettled(
      candidates.map(async (provider) => {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), pingTimeout)
        try {
          await ping(provider.pdp.serviceURL)
          return { provider, ok: true }
        } catch {
          return { provider, ok: false }
        } finally {
          clearTimeout(timer)
        }
      }),
    )

    const healthy: PDPProvider[] = []
    for (const result of pingResults) {
      if (result.status === 'fulfilled') {
        if (result.value.ok) {
          healthy.push(result.value.provider)
        } else {
          pingFailed.push(result.value.provider)
        }
      }
    }
    candidates = healthy
  }

  // Step 4: Limit results
  if (maxResults && candidates.length > maxResults) {
    candidates = candidates.slice(0, maxResults)
  }

  return {
    providers: candidates,
    totalApproved,
    totalEndorsed,
    pingFailed,
  }
}

/**
 * Convenience: get the best single provider ID for IPNI-capable storage.
 * Returns null if no qualifying provider is found.
 *
 * @param client - viem Client with chain configured
 * @param options - Filtering options
 * @returns Provider ID (bigint) or null
 */
export async function selectProvider(
  client: Client<Transport, Chain>,
  options: SPFilterOptions = {},
): Promise<{ providerId: bigint; provider: PDPProvider } | null> {
  const result = await filterProviders(client, { ...options, maxResults: 1 })
  if (result.providers.length === 0) return null
  const provider = result.providers[0]
  return { providerId: provider.id, provider }
}
