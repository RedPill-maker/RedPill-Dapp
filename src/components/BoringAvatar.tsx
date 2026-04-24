import React, { useMemo } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Avatar from 'boring-avatars'

export type AvatarVariant = 'marble' | 'bauhaus' | 'beam' | 'ring' | 'sunset'

interface BoringAvatarProps {
  hash: string
  size?: number
  variant?: AvatarVariant
  className?: string
}

const COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#F8B500']

const BoringAvatar: React.FC<BoringAvatarProps> = ({
  hash,
  size,
  variant = 'beam',
  className = '',
}) => {
  const name = hash.toLowerCase().replace(/^0x/, '')

  // Render SVG as background-image so it can be stretched with background-size: cover
  const bgStyle = useMemo(() => {
    const markup = renderToStaticMarkup(
      <Avatar size={200} name={name} variant={variant} colors={COLORS} square={true} />
    )
    // Add preserveAspectRatio="xMidYMid slice" so it covers the container
    const patched = markup.replace('<svg ', '<svg preserveAspectRatio="xMidYMid slice" ')
    const encoded = encodeURIComponent(patched)
    return {
      backgroundImage: `url("data:image/svg+xml,${encoded}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    }
  }, [name, variant])

  const containerStyle = size
    ? { width: size, height: size, ...bgStyle }
    : { width: '100%', height: '100%', ...bgStyle }

  return (
    <div
      className={`flex-shrink-0 ${className}`}
      style={containerStyle}
    />
  )
}

export default BoringAvatar
