/**
 * IPNS Signing Tool
 * 
 * Core functionality:
 * 1. signWithIPNSKey - Sign message with local IPNS private key
 * 2. verifyIPNSSignature - Verify if IPNS signature matches address
 */

import { keys as libp2pKeys } from '@libp2p/crypto'
import { peerIdFromString } from '@libp2p/peer-id'
import { IpfsConnector } from './ipfsConnector'

/**
 * Sign creator username with local IPNS private key
 * 
 * @param ipnsAddress IPNS address (must be a key on the local Kubo node)
 * @param username Creator username (used for signing)
 * @returns Signature as hex string (without 0x prefix)
 */
export async function signWithIPNSKey(
  ipnsAddress: string,
  username: string,
): Promise<string> {
  // 1. Get the key name corresponding to the IPNS address
  const keys = await IpfsConnector.listIPNSKeys()
  const keyInfo = keys.find((k) => k.id === ipnsAddress)
  
  if (!keyInfo) {
    throw new Error(`IPNS address not found on local node: ${ipnsAddress}`)
  }

  // 2. Export private key (only in memory)
  const keyDataBase64 = await IpfsConnector.exportIPNSKey(keyInfo.name)
  const keyBytes = base64ToUint8Array(keyDataBase64)

  // 3. Parse private key and sign creator username
  const privateKey = libp2pKeys.privateKeyFromProtobuf(keyBytes)
  const messageBytes = new TextEncoder().encode(username)
  const signatureBytes = await privateKey.sign(messageBytes)

  // 4. Return signature in hex format
  return uint8ArrayToHex(signatureBytes)
}

/**
 * Verify IPNS signature
 * 
 * @param ipnsAddress IPNS address
 * @param username Creator username (used for verification)
 * @param signature Signature (hex format, with or without 0x prefix)
 * @returns Whether the signature is valid
 */
export async function verifyIPNSSignature(
  ipnsAddress: string,
  username: string,
  signature: string,
): Promise<boolean> {
  try {
    // 1. Parse IPNS address to get PeerID
    const peerId = peerIdFromString(ipnsAddress)

    // 2. Get public key
    let publicKey = peerId.publicKey

    // If public key is not in PeerID (RSA type), try to get it via IPFS network
    if (!publicKey) {
      try {
        // Trigger DHT query via resolve, may cache public key
        await IpfsConnector.resolveIPNS(ipnsAddress)
        const peerIdRetry = peerIdFromString(ipnsAddress)
        publicKey = peerIdRetry.publicKey
      } catch {
        // Ignore error, continue trying
      }
    }

    if (!publicKey) {
      throw new Error('Cannot get public key, please ensure IPFS node is running')
    }

    // 3. Verify signature (using creator username)
    const messageBytes = new TextEncoder().encode(username)
    const signatureBytes = hexToUint8Array(
      signature.startsWith('0x') ? signature.slice(2) : signature,
    )

    return await publicKey.verify(messageBytes, signatureBytes)
  } catch (error: any) {
    console.error('Signature verification failed:', error.message)
    return false
  }
}

// ==================== Auxiliary Functions ====================

function base64ToUint8Array(base64: string): Uint8Array {
  const standardBase64 = base64.replace(/-/g, '+').replace(/_/g, '/')
  const binaryString = atob(standardBase64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}
