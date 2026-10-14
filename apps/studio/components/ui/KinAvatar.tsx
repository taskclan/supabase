'use client'

import { motion } from 'framer-motion'
import { memo } from 'react'
import { cn } from 'ui'

import { BASE_PATH } from '@/lib/constants'

interface KinAvatarProps {
  /** Rendered width/height in px. */
  size?: number
  /** Gently pulses Kin while a response is streaming. */
  loading?: boolean
  className?: string
  /** Tilt + scale on hover (mirrors AiIconAnimation's prop so this is a drop-in). */
  allowHoverEffect?: boolean
}

/**
 * Kin — the Taskclan Intelligence teammate — is the face of the console's AI
 * assistant. A circular avatar that drops in wherever the Taskclan assistant is
 * represented, replacing the abstract `AiIconAnimation`. Third-party "Ask
 * ChatGPT / Claude" affordances keep their own icons, so this is swapped in
 * selectively rather than inside the shared `ui` component.
 */
const KinAvatarComponent = ({
  size = 24,
  loading = false,
  className,
  allowHoverEffect = false,
}: KinAvatarProps) => {
  return (
    <motion.span
      className={cn(
        'inline-flex shrink-0 overflow-hidden rounded-full bg-surface-200 ring-1 ring-black/[0.06]',
        className
      )}
      style={{ width: size, height: size }}
      animate={loading ? { scale: [1, 1.08, 1] } : { scale: 1 }}
      transition={
        loading
          ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' }
          : { type: 'spring', stiffness: 300, damping: 20 }
      }
      whileHover={allowHoverEffect ? { scale: 1.08, rotate: 3 } : undefined}
    >
      <img
        src={`${BASE_PATH}/img/kin-avatar.png`}
        alt="Kin"
        width={size}
        height={size}
        draggable={false}
        className="h-full w-full select-none object-cover"
      />
    </motion.span>
  )
}

export const KinAvatar = memo(KinAvatarComponent)
