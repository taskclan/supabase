import { Clock } from 'lucide-react'

interface ComingSoonProps {
  description?: string
}

/**
 * A friendly placeholder for pages whose backend isn't built on Taskclan Cloud
 * yet. Rendered in place of the Supabase-platform feature (and its failing
 * platform API call), so the nav item can stay while the page shows intent
 * rather than an error.
 */
export const ComingSoon = ({ description }: ComingSoonProps) => {
  return (
    <div className="flex items-center justify-center px-6 py-16">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-default bg-surface-200 text-foreground-light">
          <Clock size={20} strokeWidth={1.5} />
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="text-base text-foreground">Coming soon</h3>
          <p className="text-sm text-foreground-light">
            {description ?? "This isn't available on Taskclan Cloud yet — we're working on it."}
          </p>
        </div>
      </div>
    </div>
  )
}
