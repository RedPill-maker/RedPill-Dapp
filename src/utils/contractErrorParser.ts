/**
 * CreatorHub contract error parser / CreatorHub コントラクトエラーパーサー
 * Convert contract errors to user-friendly error messages / コントラクトエラーをユーザーフレンドリーなエラーメッセージに変換
 */

import { ethers } from 'ethers'
import CreatorHubABI from '../../contract_info/CreatorHub_abi.json'

// Contract error type mapping / コントラクトエラータイプマッピング
const CONTRACT_ERROR_MAP: Record<string, string> = {
  // Address related / アドレス関連
  ZeroAddress: 'contractErrors.zeroAddress',
  
  // Registration related / 登録関連
  NotRegistered: 'contractErrors.notRegistered',
  AlreadyRegistered: 'contractErrors.alreadyRegistered',
  InvalidUsername: 'contractErrors.invalidUsername',
  UsernameTaken: 'contractErrors.usernameTaken',
  
  // Work related / 作品関連
  InvalidWorkCid: 'contractErrors.invalidWorkCid',
  WorkAlreadyClaimed: 'contractErrors.workAlreadyClaimed',
  NotWorkOwner: 'contractErrors.notWorkOwner',
  
  // Token related / トークン関連
  InvalidToken: 'contractErrors.invalidToken',
  InsufficientAmount: 'contractErrors.insufficientAmount',
  
  // Account market related / アカウント市場関連
  InvalidOffer: 'contractErrors.invalidOffer',
  NoActiveOffer: 'contractErrors.noActiveOffer',
  
  // Jackpot related / ジャックポット関連
  JackpotNotEnded: 'contractErrors.jackpotNotEnded',
  JackpotAlreadySettled: 'contractErrors.jackpotAlreadySettled',
  
  // Permission related / 権限関連
  NotMaintainer: 'contractErrors.notMaintainer',
  
  // Input validation / 入力検証
  EmptyCid: 'contractErrors.emptyCid',
  InvalidInput: 'contractErrors.invalidInput',
}

// Create contract interface for decoding errors / エラーをデコードするためのコントラクトインターフェースを作成
let contractInterface: ethers.Interface | null = null
try {
  contractInterface = new ethers.Interface(CreatorHubABI)
} catch (err) {
  console.error('Failed to create contract interface:', err)
}

/**
 * Try to decode Solidity custom errors / Solidity カスタムエラーをデコードしてみます
 */
function decodeCustomError(error: any): string | null {
  if (!contractInterface) return null
  
  try {
    // Try to get error data from multiple possible locations / 複数の可能な場所からエラーデータを取得してみます
    let errorData = error.data
    
    // If error.data is null, try to get from transaction.data / error.data が null の場合、transaction.data から取得してみます
    if (!errorData && error.transaction && error.transaction.data) {
      errorData = error.transaction.data
    }
    
    // If error.data is object, try to get its data field / error.data がオブジェクトの場合、その data フィールドを取得してみます
    if (errorData && typeof errorData === 'object' && errorData.data) {
      errorData = errorData.data
    }
    
    if (errorData && typeof errorData === 'string' && errorData.startsWith('0x')) {
      // Check if it's just error selector (4 bytes = 10 chars including 0x) / エラーセレクターだけかどうかを確認（4 バイト = 0x を含む 10 文字）
      if (errorData.length === 10) {
        // This is an error selector, need to find matching error from ABI / これはエラーセレクターです。ABI から一致するエラーを見つける必要があります
        const errorSelector = errorData.toLowerCase()
        
        // Iterate through all error definitions in ABI / ABI 内のすべてのエラー定義を反復処理
        const abi = CreatorHubABI as any[]
        for (const item of abi) {
          if (item.type === 'error') {
            try {
              // Build error signature / エラー署名を構築
              const inputs = item.inputs || []
              const inputTypes = inputs.map((input: any) => input.type).join(',')
              const errorSignature = `${item.name}(${inputTypes})`
              
              // Calculate selector / セレクターを計算
              const calculatedSelector = ethers.id(errorSignature).substring(0, 10).toLowerCase()
              
              if (calculatedSelector === errorSelector) {
                return item.name
              }
            } catch (e) {
              // Continue to next / 次に進む
            }
          }
        }
      } else {
        // Try to parse complete error data / 完全なエラーデータを解析してみます
        const decodedError = contractInterface.parseError(errorData)
        if (decodedError) {
          return decodedError.name
        }
      }
    }
  } catch (err) {
    // Decoding failed, continue with other methods / デコード失敗、他の方法で続行
  }
  
  return null
}

/**
 * Parse contract error message / コントラクトエラーメッセージを解析
 * @param error Error object or error message / エラーオブジェクトまたはエラーメッセージ
 * @returns i18n key or raw error message / i18n キーまたは生エラーメッセージ
 */
export function parseContractError(error: any): string {
  if (!error) return 'contractErrors.unknown'

  // First try to decode custom errors / まずカスタムエラーをデコードしてみます
  const customErrorName = decodeCustomError(error)
  if (customErrorName && CONTRACT_ERROR_MAP[customErrorName]) {
    return CONTRACT_ERROR_MAP[customErrorName]
  }

  // Get error message / エラーメッセージを取得
  let errorMessage = ''
  if (typeof error === 'string') {
    errorMessage = error
  } else if (error.message) {
    errorMessage = error.message
  } else if (error.reason) {
    errorMessage = error.reason
  } else {
    errorMessage = error.toString()
  }

  // Try to match known contract errors (from error message) / 既知のコントラクトエラーと一致させてみます（エラーメッセージから）
  for (const [errorType, i18nKey] of Object.entries(CONTRACT_ERROR_MAP)) {
    if (errorMessage.includes(errorType)) {
      return i18nKey
    }
  }

  // Check ethers.js CALL_EXCEPTION error / ethers.js CALL_EXCEPTION エラーを確認
  if (errorMessage.includes('CALL_EXCEPTION') || error.code === 'CALL_EXCEPTION') {
    // Try to extract more information from error.reason or error.data / error.reason または error.data からより多くの情報を抽出してみます
    const reason = error.reason || ''
    const dataStr = error.data ? (typeof error.data === 'string' ? error.data : JSON.stringify(error.data)) : ''
    
    // Try again to match known errors / 既知のエラーと再度一致させてみます
    for (const [errorType, i18nKey] of Object.entries(CONTRACT_ERROR_MAP)) {
      if (reason.includes(errorType) || dataStr.includes(errorType)) {
        return i18nKey
      }
    }
    
    // Check if it's missing revert data (usually means contract execution failed but no error info returned) / 欠落している revert データを確認（通常、コントラクト実行が失敗したがエラー情報が返されなかったことを意味します）
    if (errorMessage.includes('missing revert data')) {
      return 'contractErrors.callException'
    }
    
    // If there's a reason, try to extract useful information from it / 理由がある場合は、そこから有用な情報を抽出してみます
    if (reason) {
      // Check again if reason contains known errors / reason に既知のエラーが含まれているかを再度確認
      for (const [errorType, i18nKey] of Object.entries(CONTRACT_ERROR_MAP)) {
        if (reason.includes(errorType)) {
          return i18nKey
        }
      }
    }
    
    return 'contractErrors.callException'
  }

  // Check common Ethereum errors / 一般的なイーサリアムエラーを確認
  if (errorMessage.includes('insufficient funds') || error.code === 'INSUFFICIENT_FUNDS') {
    return 'contractErrors.insufficientFunds'
  }
  if (errorMessage.includes('gas required exceeds allowance')) {
    return 'contractErrors.gasExceeds'
  }
  if (errorMessage.includes('user rejected') || errorMessage.includes('User denied') || error.code === 'ACTION_REJECTED') {
    return 'contractErrors.userRejected'
  }
  if (errorMessage.includes('nonce too low') || error.code === 'NONCE_EXPIRED') {
    return 'contractErrors.nonceTooLow'
  }
  if (errorMessage.includes('replacement transaction underpriced') || error.code === 'REPLACEMENT_UNDERPRICED') {
    return 'contractErrors.replacementUnderpriced'
  }

  // Return generic error / 汎用エラーを返す
  return 'contractErrors.unknown'
}

/**
 * Get user-friendly error message (with raw error info) / ユーザーフレンドリーなエラーメッセージを取得（生エラー情報付き）
 * @param error Error object / エラーオブジェクト
 * @param t i18n translation function / i18n 翻訳関数
 * @returns User-friendly error message / ユーザーフレンドリーなエラーメッセージ
 */
export function getContractErrorMessage(error: any, t: (key: string) => string): string {
  const i18nKey = parseContractError(error)
  const translatedMessage = t(i18nKey)
  
  // If it's an unknown error, attach raw error info / 不明なエラーの場合は、生エラー情報を添付
  if (i18nKey === 'contractErrors.unknown' && error) {
    const rawMessage = typeof error === 'string' ? error : error.message || error.toString()
    return `${translatedMessage}: ${rawMessage}`
  }
  
  return translatedMessage
}
