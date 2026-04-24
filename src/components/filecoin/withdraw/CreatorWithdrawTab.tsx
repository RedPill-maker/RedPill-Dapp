/**
* Creator Withdrawal Tab
* Displays all wallets registered as creators and their withdrawable balance in the CreatorHub contract
 */

import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ethers } from 'ethers'
import { IPFS_CONFIG, getKnownTokens } from '../../../../config'
import CreatorHubABI from '../../../../contract_info/CreatorHub_abi.json'
import BoringAvatar from '../../BoringAvatar'
import { creatorHubMgr } from '../../../utils/creatorHubMgr'
import { rpcConnectorInstance, getCreatorHubAddress } from '../../../utils/rpcConnector'
import WalletSelectorModal, {
  PaymentConfig,
  TransactionResult,
  GasEstimateCallback,
} from '../../../global_modal/WalletSelectorModal'

export interface CreatorWalletBalance {
  ethAddress: string
  filAddress: string
  name: string
  username: string
  avatarCid: string
  // key: token address, value: balance string
  balances: Record<string, string>
}

interface Props {
  walletBalances: CreatorWalletBalance[]
  onWithdrawSuccess: () => void
}

const AvatarWithFallback: React.FC<{ avatarCid: string; username: string }> = ({
  avatarCid,
  username,
}) => {
  const [error, setError] = useState(false)
  if (error) return <BoringAvatar hash={username} variant="beam" />
  return (
    <img
      src={`${IPFS_CONFIG.GATEWAY_URL}/ipfs/${avatarCid}`}
      alt={username}
      className="w-full h-full object-cover"
      onError={() => setError(true)}
    />
  )
}

const CreatorWithdrawTab: React.FC<Props> = ({ walletBalances, onWithdrawSuccess }) => {
  const { t } = useTranslation()
  const [showModal, setShowModal] = useState(false)
  const [selectedAddress, setSelectedAddress] = useState('')
  const [selectedToken, setSelectedToken] = useState(getKnownTokens()[0])

  const handleWithdraw = (address: string, token: typeof selectedToken) => {
    setSelectedAddress(address)
    setSelectedToken(token)
    setShowModal(true)
  }

  const paymentConfig: PaymentConfig = {
    type: 'gas-only',
    token: selectedToken.address,
    tokenSymbol: selectedToken.symbol,
    description: t('withdraw.withdraw'),
  }

  const handleConfirm = async (
    address: string,
    password: string,
  ): Promise<TransactionResult> => {
    try {
      const result = await creatorHubMgr.withdraw(address, password, selectedToken.address)
      if (result.success) {
        onWithdrawSuccess()
      }
      return { success: result.success, txHash: result.txHash, error: result.error }
    } catch (err: any) {
      return { success: false, error: err.message || t('withdraw.withdraw') + ' failed' }
    }
  }

  const handleGasEstimate: GasEstimateCallback = async (address: string) => {
    try {
      const contract = new ethers.Contract(getCreatorHubAddress(), CreatorHubABI, rpcConnectorInstance.getProvider())
      const data = contract.interface.encodeFunctionData('withdraw', [selectedToken.address])
      return await rpcConnectorInstance.estimateContractGas(address, getCreatorHubAddress(), data, 0n)
    } catch (err: any) {
      console.error('Failed to estimate gas for withdraw:', err)
      return { success: false, error: err.message }
    }
  }

  if (walletBalances.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        {t('withdraw.notCreator')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {walletBalances.map((wallet) => {
        const withdrawableTokens = getKnownTokens().filter(
          (tk) => parseFloat(wallet.balances[tk.address] || '0') > 0,
        )

        return (
          <div
            key={wallet.ethAddress}
            className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4"
          >
            {/* Wallet header: avatar + name + username */}
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 flex-shrink-0">
                {wallet.avatarCid ? (
                  <AvatarWithFallback
                    avatarCid={wallet.avatarCid}
                    username={wallet.username}
                  />
                ) : (
                  <BoringAvatar hash={wallet.username} variant="beam" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-900 dark:text-white truncate">
                  {wallet.username}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {wallet.name} · {wallet.ethAddress.slice(0, 8)}...{wallet.ethAddress.slice(-6)}
                </div>
              </div>
            </div>

            {/* Token balance list */}
            <div className="space-y-2">
              {getKnownTokens().map((token) => {
                const balance = wallet.balances[token.address] || '0'
                const hasBalance = parseFloat(balance) > 0
                return (
                  <div
                    key={token.address}
                    className="flex items-center justify-between py-1"
                  >
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      <span className="font-medium text-gray-800 dark:text-gray-200">
                        {parseFloat(balance).toFixed(6)}
                      </span>{' '}
                      {token.symbol}
                    </div>
                    <button
                      onClick={() => handleWithdraw(wallet.ethAddress, token)}
                      disabled={!hasBalance}
                      className={`px-3 py-1 text-sm rounded-lg transition-colors ${
                        hasBalance
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
                      }`}
                    >
                      {t('withdraw.withdraw')}
                    </button>
                  </div>
                )
              })}
            </div>

            {withdrawableTokens.length === 0 && (
              <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                {t('withdraw.noWithdrawable')}
              </div>
            )}
          </div>
        )
      })}

      <WalletSelectorModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        paymentConfig={paymentConfig}
        onConfirm={handleConfirm}
        onGasEstimate={handleGasEstimate}
        highlightAddress={selectedAddress}
        allowedAddresses={selectedAddress ? [selectedAddress] : undefined}
      />
    </div>
  )
}

export default CreatorWithdrawTab
