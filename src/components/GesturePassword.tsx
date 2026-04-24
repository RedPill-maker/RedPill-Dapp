import React, { useRef, useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

// 9-grid node indices 0-8 / 9マスのノードインデックス 0-8
const GRID_SIZE = 3
const NODE_COUNT = GRID_SIZE * GRID_SIZE

interface Point {
  x: number
  y: number
}

interface GesturePasswordProps {
  mode: 'set' | 'verify' // set=record, verify=verify
  onComplete: (pattern: string) => void // pattern is node index sequence e.g. "01345"
  error?: string | null
  disabled?: boolean
}

const GesturePassword: React.FC<GesturePasswordProps> = ({
  mode,
  onComplete,
  error,
  disabled = false,
}) => {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<number[]>([])
  const selectedRef = useRef<number[]>([])
  const [currentPos, setCurrentPos] = useState<Point | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasError, setHasError] = useState(false)
  const nodePositions = useRef<Point[]>([])

  const CANVAS_SIZE = 240
  const NODE_RADIUS = 18
  const INNER_RADIUS = 8
  const PADDING = 40

  const getNodePos = useCallback((index: number): Point => {
    const col = index % GRID_SIZE
    const row = Math.floor(index / GRID_SIZE)
    const step = (CANVAS_SIZE - PADDING * 2) / (GRID_SIZE - 1)
    return {
      x: PADDING + col * step,
      y: PADDING + row * step,
    }
  }, [])

  useEffect(() => {
    nodePositions.current = Array.from({ length: NODE_COUNT }, (_, i) =>
      getNodePos(i),
    )
  }, [getNodePos])

  useEffect(() => {
    setHasError(!!error)
  }, [error])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)

    const activeColor = hasError ? '#ef4444' : '#3b82f6'
    const lineColor = hasError ? 'rgba(239,68,68,0.5)' : 'rgba(59,130,246,0.5)'

    // Draw connection lines / 接続線を描画
    if (selected.length > 0) {
      ctx.beginPath()
      ctx.strokeStyle = lineColor
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      const first = nodePositions.current[selected[0]]
      ctx.moveTo(first.x, first.y)
      for (let i = 1; i < selected.length; i++) {
        const pos = nodePositions.current[selected[i]]
        ctx.lineTo(pos.x, pos.y)
      }
      if (currentPos && isDrawing) {
        ctx.lineTo(currentPos.x, currentPos.y)
      }
      ctx.stroke()
    }

    // Draw nodes / ノードを描画
    for (let i = 0; i < NODE_COUNT; i++) {
      const pos = nodePositions.current[i]
      const isActive = selected.includes(i)

      // Outer circle / 外側の円
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, NODE_RADIUS, 0, Math.PI * 2)
      ctx.strokeStyle = isActive ? activeColor : 'rgba(156,163,175,0.6)'
      ctx.lineWidth = 2
      ctx.stroke()
      if (isActive) {
        ctx.fillStyle = 'rgba(59,130,246,0.1)'
        if (hasError) ctx.fillStyle = 'rgba(239,68,68,0.1)'
        ctx.fill()
      }

      // Inner circle / 内側の円
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, INNER_RADIUS, 0, Math.PI * 2)
      ctx.fillStyle = isActive ? activeColor : 'rgba(156,163,175,0.5)'
      ctx.fill()
    }
  }, [selected, currentPos, isDrawing, hasError])

  useEffect(() => {
    draw()
  }, [draw])

  const getCanvasPoint = (e: React.TouchEvent | React.MouseEvent): Point => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const scaleX = CANVAS_SIZE / rect.width
    const scaleY = CANVAS_SIZE / rect.height
    if ('touches' in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      }
    }
    return {
      x: ((e as React.MouseEvent).clientX - rect.left) * scaleX,
      y: ((e as React.MouseEvent).clientY - rect.top) * scaleY,
    }
  }

  const getNearestNode = (point: Point): number | null => {
    for (let i = 0; i < NODE_COUNT; i++) {
      const pos = nodePositions.current[i]
      const dist = Math.sqrt((pos.x - point.x) ** 2 + (pos.y - point.y) ** 2)
      if (dist <= NODE_RADIUS) return i
    }
    return null
  }

  const handleStart = (e: React.TouchEvent | React.MouseEvent) => {
    if (disabled) return
    e.preventDefault()
    setHasError(false)
    selectedRef.current = []
    setSelected([])
    setIsDrawing(true)
    const point = getCanvasPoint(e)
    setCurrentPos(point)
    const node = getNearestNode(point)
    if (node !== null) {
      selectedRef.current = [node]
      setSelected([node])
    }
  }

  const handleMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDrawing || disabled) return
    e.preventDefault()
    const point = getCanvasPoint(e)
    setCurrentPos(point)
    const node = getNearestNode(point)
    if (node !== null && !selectedRef.current.includes(node)) {
      selectedRef.current = [...selectedRef.current, node]
      setSelected((prev) => [...prev, node])
    }
  }

  const handleEnd = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDrawing || disabled) return
    e.preventDefault()
    setIsDrawing(false)
    setCurrentPos(null)
    const current = selectedRef.current
    if (current.length >= 4) {
      onComplete(current.join(''))
    } else if (current.length > 0) {
      setHasError(true)
      setTimeout(() => {
        selectedRef.current = []
        setSelected([])
        setHasError(false)
      }, 800)
    }
  }

  // Parent controls reset via key prop / 親がkeyプロップでリセットを制御

  return (
    <div ref={containerRef} className="flex flex-col items-center select-none">
      <canvas
        ref={canvasRef}
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        style={{ width: 240, height: 240, touchAction: 'none', cursor: disabled ? 'not-allowed' : 'pointer' }}
        onMouseDown={handleStart}
        onMouseMove={handleMove}
        onMouseUp={handleEnd}
        onMouseLeave={handleEnd}
        onTouchStart={handleStart}
        onTouchMove={handleMove}
        onTouchEnd={handleEnd}
      />
      <div className="h-5 mt-1 text-sm text-center">
        {hasError || error ? (
          <span className="text-red-500">{error || t('gesturePassword.tooFewPoints')}</span>
        ) : selected.length > 0 && !isDrawing ? (
          <span className="text-green-500">{t('gesturePassword.recordedNodes', { count: selected.length })}</span>
        ) : (
          <span className="text-gray-400 dark:text-gray-500">
            {mode === 'set' ? t('gesturePassword.hintSet') : t('gesturePassword.hintVerify')}
          </span>
        )}
      </div>
    </div>
  )
}

export default GesturePassword
