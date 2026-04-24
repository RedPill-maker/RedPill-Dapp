/**
 * Top jackpot banner component
 * Displays dual-token jackpot info with floating particle animation background
 */

import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { XMarkIcon, TrophyIcon, HeartIcon, DocumentTextIcon } from '@heroicons/react/24/outline'
import { TrophyIcon as TrophySolid } from '@heroicons/react/24/solid'
import { useAppDispatch } from '../../hooks/redux'
import { setCreatorPage, setCreatorPageByUsername, setItemPage, setCurrentPage } from '../../store/slices/pageSlice'
import { fetchWithdrawBalances } from '../../store/slices/withdrawSlice'
import { getJackpotDetails, getRecentTips, JackpotDetail, TipRecord } from '../../utils/dbConnector'
import { getKnownTokens, IPFS_CONFIG } from '../../../config'
import { privateDataMgr } from '../../utils/privateDataMgr'
import { creatorHubMgr } from '../../utils/creatorHubMgr'
import BoringAvatar from '../BoringAvatar'
import WalletSelectorModal, { PaymentConfig, TransactionResult } from '../../global_modal/WalletSelectorModal'

// ============ Utility functions ============

// Format amount already in ether units (pool, jackpot, etc. — server has converted)
function formatAmount(amount: string): string {
  const num = parseFloat(amount)
  if (isNaN(num)) return '--'
  if (num >= 1000) return `${(num / 1000).toFixed(2)}K`
  if (num >= 100) return num.toFixed(2)
  return num.toFixed(4)
}

// Format wei-unit amount (tip_records.amount_sent, raw database value)
function formatWeiAmount(amount: string): string {
  try {
    const wei = BigInt(amount)
    const whole = wei / BigInt(1e18)
    const remainder = wei % BigInt(1e18)
    const num = Number(whole) + Number(remainder) / 1e18
    if (isNaN(num)) return '--'
    if (num >= 1000) return `${(num / 1000).toFixed(2)}K`
    if (num >= 100) return num.toFixed(2)
    return num.toFixed(4)
  } catch {
    return '--'
  }
}

function shortAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function getTokenSymbol(tokenAddress: string): string {
  const found = getKnownTokens().find(
    (t) => t.address.toLowerCase() === tokenAddress.toLowerCase(),
  )
  return found?.symbol ?? 'FIL'
}

interface CountdownState {
  text: string
  urgent: boolean
  ended: boolean
}

function calcCountdown(endTime: number | null, t: (key: string, opts?: any) => string): CountdownState {
  if (!endTime) return { text: '--', urgent: false, ended: false }
  const remaining = endTime - Math.floor(Date.now() / 1000)
  if (remaining <= 0) return { text: t('topAdBanner.ended'), urgent: false, ended: true }
  const days = Math.floor(remaining / 86400)
  const hours = Math.floor((remaining % 86400) / 3600)
  const minutes = Math.floor((remaining % 3600) / 60)
  const seconds = remaining % 60
  let text: string
  if (days > 0) {
    text = t('topAdBanner.time.daysHoursMinsSecs', { days, hours, minutes, seconds })
  } else if (hours > 0) {
    text = t('topAdBanner.time.hoursMinsSecs', { hours, minutes, seconds })
  } else {
    text = t('topAdBanner.time.minsSecs', { minutes, seconds })
  }
  return { text, urgent: remaining < 3600, ended: false }
}

// ============ Particle background (Canvas) ============

interface Particle {
  x: number; y: number; vx: number; vy: number
  alpha: number; size: number; label: string
  labelAlpha: number; labelFade: number
}

interface Signal {
  fromIdx: number; toIdx: number; progress: number; speed: number; alpha: number
}

const AURORA_BANDS = [
  { hue: 0,   speed: 0.38, amp: 0.18, phase: 0.0,  base: 0.10, fadeTop: 0.10, fadeBot: 0.85 },
  { hue: 20,  speed: 0.29, amp: 0.16, phase: 1.1,  base: 0.28, fadeTop: 0.18, fadeBot: 1.05 },
  { hue: 160, speed: 0.33, amp: 0.17, phase: 2.3,  base: 0.45, fadeTop: 0.08, fadeBot: 0.75 },
  { hue: 200, speed: 0.25, amp: 0.15, phase: 3.5,  base: 0.62, fadeTop: 0.22, fadeBot: 1.10 },
  { hue: 270, speed: 0.31, amp: 0.16, phase: 0.7,  base: 0.78, fadeTop: 0.12, fadeBot: 0.90 },
  { hue: 45,  speed: 0.27, amp: 0.14, phase: 4.2,  base: 0.20, fadeTop: 0.20, fadeBot: 1.00 },
  { hue: 180, speed: 0.35, amp: 0.15, phase: 1.8,  base: 0.55, fadeTop: 0.06, fadeBot: 0.70 },
  { hue: 300, speed: 0.22, amp: 0.14, phase: 2.9,  base: 0.88, fadeTop: 0.15, fadeBot: 0.95 },
]

function useParticleCanvas(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  tipLabels: string[],
  active: boolean,
) {
  const labelsRef = useRef<string[]>(tipLabels)
  const animRef = useRef<number>(0)
  const startTimeRef = useRef<number>(Date.now())
  const particlesRef = useRef<Particle[]>([])
  const signalsRef = useRef<Signal[]>([])

  useEffect(() => { labelsRef.current = tipLabels }, [tipLabels])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !active) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    particlesRef.current = Array.from({ length: 34 }, () => ({
      x: Math.random() * canvas.width, y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.35,
      alpha: Math.random() * 0.5 + 0.3, size: Math.random() * 1.8 + 0.8,
      label: '', labelAlpha: 0, labelFade: 0,
    }))

    const MAX_DIST = 120
    const spawnSignal = () => {
      const ps = particlesRef.current
      const i = Math.floor(Math.random() * ps.length)
      const j = Math.floor(Math.random() * ps.length)
      if (i === j) return
      const dx = ps[i].x - ps[j].x, dy = ps[i].y - ps[j].y
      if (Math.sqrt(dx * dx + dy * dy) > MAX_DIST) return
      signalsRef.current.push({ fromIdx: i, toIdx: j, progress: 0, speed: Math.random() * 0.014 + 0.007, alpha: Math.random() * 0.7 + 0.5 })
    }
    const signalInterval = setInterval(spawnSignal, 100)

    const labelInterval = setInterval(() => {
      const labels = labelsRef.current
      if (!labels.length) return
      const candidates = particlesRef.current.filter((p) => !p.label && p.labelFade === 0)
      if (!candidates.length) return
      const p = candidates[Math.floor(Math.random() * candidates.length)]
      p.label = labels[Math.floor(Math.random() * labels.length)]
      p.labelFade = 1; p.labelAlpha = 0
    }, 1800)

    const draw = () => {
      const t = (Date.now() - startTimeRef.current) * 0.001
      const W = canvas.width, H = canvas.height
      ctx.fillStyle = 'rgba(4,8,20,0.82)'
      ctx.fillRect(0, 0, W, H)

      for (const band of AURORA_BANDS) {
        const cx = W * (band.base + band.amp * Math.sin(t * band.speed + band.phase))
        const cy = H * (band.fadeTop * 0.6 + 0.02 * Math.sin(t * band.speed * 1.3 + band.phase))
        const rx = W * 0.22
        const ry = H * (band.fadeBot + 0.05 * Math.sin(t * band.speed * 0.9 + band.phase + 1))
        ctx.save(); ctx.translate(cx, cy); ctx.scale(1, ry / rx)
        const grd = ctx.createRadialGradient(0, 0, 0, 0, 0, rx)
        grd.addColorStop(0, `hsla(${band.hue},90%,65%,0.22)`)
        grd.addColorStop(0.4, `hsla(${band.hue},90%,60%,0.14)`)
        grd.addColorStop(0.75, `hsla(${band.hue},85%,55%,0.06)`)
        grd.addColorStop(1, `hsla(${band.hue},80%,50%,0)`)
        ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2)
        ctx.fillStyle = grd; ctx.fill(); ctx.restore()
      }

      const particles = particlesRef.current
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x, dy = particles[i].y - particles[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < MAX_DIST) {
            const ratio = 1 - dist / MAX_DIST
            ctx.beginPath()
            ctx.strokeStyle = `hsla(0,80%,${45 + ratio * 20}%,${0.4 * ratio})`
            ctx.lineWidth = 0.7 + ratio * 0.8
            ctx.moveTo(particles[i].x, particles[i].y)
            ctx.lineTo(particles[j].x, particles[j].y)
            ctx.stroke()
          }
        }
      }

      signalsRef.current = signalsRef.current.filter((sig) => {
        sig.progress += sig.speed
        if (sig.progress >= 1) return false
        const from = particles[sig.fromIdx], to = particles[sig.toIdx]
        const x = from.x + (to.x - from.x) * sig.progress
        const y = from.y + (to.y - from.y) * sig.progress
        const grd = ctx.createRadialGradient(x, y, 0, x, y, 5)
        grd.addColorStop(0, `hsla(0,100%,75%,${sig.alpha})`)
        grd.addColorStop(1, `hsla(0,100%,50%,0)`)
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2)
        ctx.fillStyle = grd; ctx.fill()
        return true
      })

      for (const p of particles) {
        p.x += p.vx; p.y += p.vy
        if (p.x < 0 || p.x > W) p.vx *= -1
        if (p.y < 0 || p.y > H) p.vy *= -1
        const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3)
        grd.addColorStop(0, `rgba(255,80,80,${p.alpha})`)
        grd.addColorStop(0.4, `rgba(220,38,38,${p.alpha * 0.7})`)
        grd.addColorStop(1, 'rgba(180,20,20,0)')
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2)
        ctx.fillStyle = grd; ctx.fill()
        if (p.label && p.labelFade !== 0) {
          p.labelAlpha += p.labelFade * 0.012
          if (p.labelAlpha >= 0.4) { p.labelAlpha = 0.4; p.labelFade = 0; setTimeout(() => { p.labelFade = -1 }, 3500) }
          else if (p.labelAlpha <= 0) { p.labelAlpha = 0; p.labelFade = 0; p.label = '' }
        }
        if (p.label && p.labelAlpha > 0) {
          ctx.font = '10px system-ui,sans-serif'
          ctx.fillStyle = `rgba(160,200,220,${p.labelAlpha})`
          ctx.fillText(p.label, p.x + p.size + 4, p.y + 3)
        }
      }
      animRef.current = requestAnimationFrame(draw)
    }

    ctx.fillStyle = 'rgb(4,8,20)'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    animRef.current = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(animRef.current); clearInterval(signalInterval); clearInterval(labelInterval); ro.disconnect() }
  }, [canvasRef, active])
}

// ============ Fireworks background (Canvas) ============

interface Shell {
  // Ascending phase
  x: number; y: number
  vx: number; vy: number
  targetY: number
  color: string
  trail: Array<{x: number; y: number; alpha: number}>
  exploded: boolean
}

interface Spark {
  x: number; y: number; vx: number; vy: number
  alpha: number; color: string; size: number
  trail: Array<{x: number; y: number}>
}

function useFireworksCanvas(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  active: boolean,
) {
  const animRef = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !active) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const shells: Shell[] = []
    const sparks: Spark[] = []
    const COLORS = ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#ff922b','#cc5de8','#f06595','#74c0fc','#ffffff']

    const burst = (cx: number, cy: number, color: string) => {
      const count = 55 + Math.floor(Math.random() * 20)
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.2
        const speed = Math.random() * 2.5 + 0.8
        sparks.push({
          x: cx, y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          alpha: 1,
          color,
          size: Math.random() * 2 + 0.8,
          trail: [],
        })
      }
    }

    const launchShell = () => {
      const W = canvas.width, H = canvas.height
      const x = Math.random() * W * 0.7 + W * 0.15
      const targetY = Math.random() * H * 0.45 + H * 0.05
      const color = COLORS[Math.floor(Math.random() * COLORS.length)]
      // Launch from bottom, velocity calculated based on target height
      const dist = H - targetY
      const vy = -(dist / 55) // ~55 frames to reach target
      shells.push({ x, y: H + 5, vx: (Math.random() - 0.5) * 0.4, vy, targetY, color, trail: [], exploded: false })
    }

    // Launch 2 shells initially, then one every 1.8 seconds
    setTimeout(launchShell, 100)
    setTimeout(launchShell, 600)
    const launchInterval = setInterval(launchShell, 1800)

    const draw = () => {
      const W = canvas.width, H = canvas.height
      // Semi-transparent overlay to preserve trails
      ctx.fillStyle = 'rgba(4,8,20,0.18)'
      ctx.fillRect(0, 0, W, H)

      // Draw rising shells
      for (let i = shells.length - 1; i >= 0; i--) {
        const s = shells[i]
        if (s.exploded) { shells.splice(i, 1); continue }

        s.trail.push({ x: s.x, y: s.y, alpha: 1 })
        if (s.trail.length > 12) s.trail.shift()

        s.x += s.vx
        s.y += s.vy
        s.vy += 0.04 // slight deceleration (gravity)

        // Explode when reaching target height or starting to fall
        if (s.y <= s.targetY || s.vy >= 0) {
          burst(s.x, s.y, s.color)
          s.exploded = true
          continue
        }

        // Draw trail
        for (let t = 0; t < s.trail.length; t++) {
          const ratio = t / s.trail.length
          ctx.globalAlpha = ratio * 0.8
          ctx.beginPath()
          ctx.arc(s.trail[t].x, s.trail[t].y, 1.5 * ratio + 0.3, 0, Math.PI * 2)
          ctx.fillStyle = s.color
          ctx.fill()
        }
        // Shell tip highlight
        ctx.globalAlpha = 1
        ctx.beginPath()
        ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.fill()
        ctx.globalAlpha = 1
      }

      // Draw explosion sparks
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i]
        p.trail.push({ x: p.x, y: p.y })
        if (p.trail.length > 5) p.trail.shift()

        p.x += p.vx; p.y += p.vy
        p.vy += 0.04 // gravity
        p.vx *= 0.97
        p.vy *= 0.97
        p.alpha -= 0.012 // slower fade

        if (p.alpha <= 0) { sparks.splice(i, 1); continue }

        // trail
        for (let t = 0; t < p.trail.length; t++) {
          ctx.globalAlpha = (t / p.trail.length) * p.alpha * 0.4
          ctx.beginPath()
          ctx.arc(p.trail[t].x, p.trail[t].y, p.size * 0.4, 0, Math.PI * 2)
          ctx.fillStyle = p.color
          ctx.fill()
        }
        ctx.globalAlpha = p.alpha
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fillStyle = p.color
        ctx.fill()
        ctx.globalAlpha = 1
      }

      animRef.current = requestAnimationFrame(draw)
    }

    ctx.fillStyle = 'rgb(4,8,20)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    animRef.current = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(animRef.current)
      clearInterval(launchInterval)
      ro.disconnect()
    }
  }, [canvasRef, active])
}

// ============ Leader avatar ============

interface LeaderAvatarProps {
  avatarCid: string | null
  username: string | null
  size?: number
}

const LeaderAvatar: React.FC<LeaderAvatarProps> = ({ avatarCid, username, size = 32 }) => {
  const [error, setError] = useState(false)
  const hash = username || 'unknown'

  if (avatarCid && !error) {
    return (
      <img
        src={`${IPFS_CONFIG.GATEWAY_URL}/ipfs/${avatarCid}`}
        alt={username || ''}
        className="w-full h-full object-cover"
        onError={() => setError(true)}
      />
    )
  }
  return <BoringAvatar hash={hash} variant="beam" size={size} />
}

// ============ Jackpot card ============

interface JackpotCardProps {
  jackpot: JackpotDetail | null
  tokenSymbol: string
  onCreatorClick: (jackpot: JackpotDetail) => void
  onWorkClick: (workCid: string, workTitle: string) => void
  isWinner: boolean
  onClaim: (jackpot: JackpotDetail) => void
}

const JackpotCard: React.FC<JackpotCardProps> = ({ jackpot, tokenSymbol, onCreatorClick, onWorkClick, isWinner, onClaim }) => {
  const { t } = useTranslation()
  const [countdown, setCountdown] = useState<CountdownState>({ text: '--', urgent: false, ended: false })

  useEffect(() => {
    const update = () => setCountdown(calcCountdown(jackpot?.end_time ?? null, t))
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [jackpot?.end_time])

  const epoch = jackpot?.current_epoch ?? '--'
  const poolAmount = jackpot ? formatAmount(jackpot.pool_amount) : '--'
  const hasLeader = jackpot?.leader_address &&
    jackpot.leader_address !== '0x0000000000000000000000000000000000000000'

  // Display "winner" when jackpot has ended and has a leader
  const leaderLabel = countdown.ended && hasLeader
    ? t('topAdBanner.winner')
    : t('topAdBanner.leader')

  return (
    <div className="flex-1 min-w-0 flex flex-col gap-1.5">
      {/* Epoch + trophy icon */}
      <div className="flex items-center justify-center gap-1.5 text-xs text-gray-400">
        <TrophySolid className="w-3.5 h-3.5 text-yellow-500" />
        <span>{t('topAdBanner.epoch', { epoch })}</span>
      </div>

      {/* Jackpot amount */}
      <div className="text-center">
        <span className="text-3xl font-bold text-gray-100 tracking-tight">{poolAmount}</span>
        <span className="ml-1.5 text-base font-semibold text-red-400">{tokenSymbol}</span>
      </div>

      {/* Countdown */}
      <div className={`text-xs text-center ${countdown.urgent ? 'text-red-400 animate-pulse' : countdown.ended ? 'text-gray-500' : 'text-gray-400'}`}>
        {countdown.ended ? t('topAdBanner.ended') : `${t('topAdBanner.deadlineLabel')}：${countdown.text}`}
      </div>

      {/* Leader/Winner info */}
      <div className="mt-1 rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-2 relative">
        {hasLeader ? (
          <div className="flex items-center gap-3">
            {/* Avatar */}
            <button
              className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 hover:ring-2 hover:ring-red-500 transition-all self-center"
              onClick={() => jackpot && onCreatorClick(jackpot)}
              title={jackpot!.leader_username || ''}
            >
              <LeaderAvatar avatarCid={jackpot!.leader_avatar_cid} username={jackpot!.leader_username} size={40} />
            </button>
            {/* Three lines of info */}
            <div className="min-w-0 flex-1 flex flex-col justify-between gap-1">
              {/* First line: label + username */}
              <div className="flex items-center gap-1">
                <span className={`text-xs font-medium flex-shrink-0 ${countdown.ended && hasLeader ? 'text-yellow-400' : 'text-red-400'}`}>
                  {leaderLabel}
                </span>
                <button
                  className="text-xs text-gray-200 truncate hover:text-red-300 transition-colors font-medium"
                  onClick={() => jackpot && onCreatorClick(jackpot)}
                >
                  {jackpot!.leader_username || shortAddress(jackpot!.leader_address!)}
                </button>
              </div>
              {/* Second line: total tips */}
              <div className="flex items-center gap-1 text-xs text-gray-400">
                <HeartIcon className="w-3 h-3 text-pink-500 flex-shrink-0" />
                <span>{jackpot!.leader_work_tips ? `${formatAmount(jackpot!.leader_work_tips)} ${tokenSymbol}` : '--'}</span>
              </div>
              {/* Third line: work title */}
              {jackpot!.leader_work_title && jackpot!.leader_work_cid ? (
                <button
                  className="text-xs text-left text-gray-500 hover:text-gray-200 truncate transition-colors flex items-center gap-1"
                  onClick={() => onWorkClick(jackpot!.leader_work_cid!, jackpot!.leader_work_title!)}
                  title={jackpot!.leader_work_title}
                >
                  <DocumentTextIcon className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{jackpot!.leader_work_title}</span>
                </button>
              ) : (
                <div className="text-xs text-gray-600">--</div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0">
              <TrophyIcon className="w-5 h-5 text-gray-600" />
            </div>
            <div className="text-xs text-gray-500">{t('topAdBanner.noLeader')}</div>
          </div>
        )}
        {/* Claim button: absolute positioned center-right, does not affect left layout */}
        {isWinner && jackpot && (
          <button
            onClick={() => onClaim(jackpot)}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 text-sm font-semibold rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors shadow-lg"
          >
            {t('topAdBanner.claimPrize')}
          </button>
        )}
      </div>
    </div>
  )
}

// ============ Main component ============

const TopAdBanner: React.FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fireworksCanvasRef = useRef<HTMLCanvasElement>(null)
  const [jackpots, setJackpots] = useState<JackpotDetail[]>([])
  const [recentTips, setRecentTips] = useState<TipRecord[]>([])
  const [showRules, setShowRules] = useState(false)

  // Claim modal state
  const [claimJackpot, setClaimJackpot] = useState<JackpotDetail | null>(null)
  const [showClaimModal, setShowClaimModal] = useState(false)

  // Detect if current user wallet is the winner of any ended jackpot
  const [myAddresses, setMyAddresses] = React.useState<string[]>([])
  React.useEffect(() => {
    privateDataMgr.getWalletList().then((list) =>
      setMyAddresses(list.map((w) => w.ethAddress.toLowerCase()))
    )
    // Re-fetch wallet list when jackpots change to detect newly imported wallets
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jackpots])

  const winnerInfo = React.useMemo(() => {
    for (const jackpot of jackpots) {
      if (!jackpot.leader_address) continue
      const leaderAddr = jackpot.leader_address.toLowerCase()
      if (leaderAddr === '0x0000000000000000000000000000000000000000') continue
      // end_time must be a positive integer and already expired to count as ended
      const endTime = jackpot.end_time
      if (!endTime || endTime <= 0) continue
      const now = Math.floor(Date.now() / 1000)
      if (now < endTime) continue  // jackpot not yet ended
      if (myAddresses.includes(leaderAddr)) {
        return { jackpot, winnerAddress: jackpot.leader_address }
      }
    }
    return null
  }, [jackpots, myAddresses])

  // Fireworks condition: any jackpot has a non-zero leader and has ended (regardless of local wallet)
  const isFireworks = React.useMemo(() => {
    const now = Math.floor(Date.now() / 1000)
    return jackpots.some((j) => {
      if (!j.leader_address) return false
      if (j.leader_address === '0x0000000000000000000000000000000000000000') return false
      if (!j.end_time || j.end_time <= 0) return false
      return now >= j.end_time
    })
  }, [jackpots])

  const tipLabels = recentTips.slice(0, 15).map((tip) => {
    const sym = getTokenSymbol(tip.token_address)
    return `${shortAddress(tip.tipper_address)} +${formatWeiAmount(tip.amount_sent)} ${sym}`
  })

  // Aurora + particles always shown; fireworks overlay when winner (separate canvas to avoid clear conflicts)
  useParticleCanvas(canvasRef, tipLabels, true)
  useFireworksCanvas(fireworksCanvasRef, isFireworks)

  const loadData = useCallback(async () => {
    const [details, tips] = await Promise.all([
      getJackpotDetails(),
      getRecentTips(20),
    ])
    setJackpots(details)
    setRecentTips(tips)
  }, [])

  useEffect(() => {
    loadData()
    const id = setInterval(loadData, 30000)
    return () => clearInterval(id)
  }, [loadData])

  const handleCreatorClick = useCallback((jackpot: JackpotDetail) => {
    if (jackpot.leader_ipns_address) {
      dispatch(setCreatorPage(jackpot.leader_ipns_address))
    } else if (jackpot.leader_username) {
      dispatch(setCreatorPageByUsername(jackpot.leader_username))
    }
  }, [dispatch])

  const handleWorkClick = useCallback((workCid: string, workTitle: string) => {
    dispatch(setItemPage({ cid: workCid, title: workTitle }))
  }, [dispatch])

  const handleClaim = useCallback((jackpot: JackpotDetail) => {
    setClaimJackpot(jackpot)
    setShowClaimModal(true)
  }, [])

  // Find corresponding token info
  const claimToken = claimJackpot
    ? getKnownTokens().find((t) => t.address.toLowerCase() === claimJackpot.token_address.toLowerCase()) ?? getKnownTokens()[0]
    : getKnownTokens()[0]

  const claimPaymentConfig: PaymentConfig = {
    type: 'gas-only',
    token: claimToken.address,
    tokenSymbol: claimToken.symbol,
    description: t('topAdBanner.claimPrizeDesc'),
  }

  const handleClaimConfirm = async (address: string, password: string): Promise<TransactionResult> => {
    const result = await creatorHubMgr.settleJackpot(address, password, claimToken.address)
    return { success: result.success, txHash: result.txHash, error: result.error, rawError: (result as any).rawError }
  }

  // JackpotAlreadySettled / JackpotNotEnded also treated as claim success
  const handleClaimResultOverride = (result: TransactionResult) => {
    if (!result.success) {
      const errStr = (result.error || '') + JSON.stringify(result.rawError || '')
      if (errStr.includes('JackpotAlreadySettled') || errStr.includes('JackpotNotEnded')) {
        return { success: true, message: t('topAdBanner.alreadySettled') }
      }
    }
    return null
  }

  // User closed modal without completing transaction — do not navigate
  const handleClaimClose = () => {
    setShowClaimModal(false)
    setClaimJackpot(null)
  }

  // On success (including JackpotAlreadySettled treated as success), navigate to withdraw page and force-refresh
  const handleClaimSuccess = useCallback(() => {
    setShowClaimModal(false)
    setClaimJackpot(null)
    dispatch(setCurrentPage('withdraw'))
  // Delay 2s for on-chain state to update, then force-refresh withdrawal balances
    setTimeout(() => dispatch(fetchWithdrawBalances(true)), 2000)
  }, [dispatch])

  const cards = getKnownTokens().slice(0, 2).map((token) => {
    const jackpot = jackpots.find(
      (j) => j.token_address.toLowerCase() === token.address.toLowerCase(),
    ) ?? null
    // Check if this card's jackpot has the current user as winner:
    // jackpot ended + leader_address is one of the local wallets
    const jackpotEnded = jackpot?.end_time
      ? Math.floor(Date.now() / 1000) >= jackpot.end_time
      : false
    const cardIsWinner = !!(
      jackpot &&
      jackpotEnded &&
      jackpot.leader_address &&
      jackpot.leader_address !== '0x0000000000000000000000000000000000000000' &&
      myAddresses.includes(jackpot.leader_address.toLowerCase())
    )
    return { token, jackpot, cardIsWinner }
  })

  return (
    <>
      <div className="relative rounded-xl overflow-hidden" style={{ height: '260px', background: 'rgb(4,8,20)' }}>
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
        {isFireworks && <canvas ref={fireworksCanvasRef} className="absolute inset-0 w-full h-full" style={{ mixBlendMode: 'screen' }} />}
        <div className="relative z-10 h-full flex flex-col px-5 py-3">
          {/* Title row */}
          <div className="flex flex-col items-center mb-3 gap-1.5">
            <h2 className="text-base font-semibold text-gray-100 tracking-wide">
              {t('topAdBanner.title')}
            </h2>
            <button
              onClick={() => setShowRules(true)}
              className="text-xs text-gray-400 border border-gray-600 rounded-full px-2.5 py-0.5 hover:border-gray-400 hover:text-gray-200 transition-colors"
            >
              {t('topAdBanner.learnMore')}
            </button>
          </div>

          {/* Dual-column jackpot */}
          <div className="flex flex-row gap-6 flex-1">
            {cards.map(({ token, jackpot, cardIsWinner }, idx) => (
              <React.Fragment key={token.address}>
                <JackpotCard
                  jackpot={jackpot}
                  tokenSymbol={token.symbol}
                  onCreatorClick={handleCreatorClick}
                  onWorkClick={handleWorkClick}
                  isWinner={cardIsWinner}
                  onClaim={handleClaim}
                />
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* Claim modal */}
      {showClaimModal && claimJackpot && winnerInfo && (
        <WalletSelectorModal
          isOpen={showClaimModal}
          onClose={handleClaimClose}
          onSuccess={handleClaimSuccess}
          paymentConfig={claimPaymentConfig}
          onConfirm={handleClaimConfirm}
          highlightAddress={winnerInfo.winnerAddress}
          allowedAddresses={[winnerInfo.winnerAddress]}
          onResultOverride={handleClaimResultOverride}
        />
      )}

      {/* Rules modal */}
      {showRules && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setShowRules(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg flex flex-col"
            style={{ maxHeight: '60vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <TrophySolid className="w-4 h-4 text-yellow-400" />
                {t('topAdBanner.jackpotRules')}
              </h2>
              <button
                onClick={() => setShowRules(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto px-6 py-4 space-y-4">
              {['1','2','3','4','5','6','7'].map((n) => (
                <div key={n}>
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">
                    {t(`topAdBanner.rulesQ${n}`)}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                    {t(`topAdBanner.rulesA${n}`)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default TopAdBanner
