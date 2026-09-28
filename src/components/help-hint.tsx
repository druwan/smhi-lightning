import type { ReactNode } from 'react'
import { CircleHelp } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export function HelpHint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <Popover>
        <PopoverTrigger
          openOnHover
          delay={100}
          aria-label={`What does "${label}" mean?`}
          className="text-muted-foreground hover:text-foreground inline-flex cursor-help"
        >
          <CircleHelp className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent className="w-72 space-y-2 text-left text-sm font-normal">
          {children}
        </PopoverContent>
      </Popover>
    </span>
  )
}

export const HELP = {
  cloudToGround: (
    <>
      <p>Discharges that reach the ground. Everything else is In-Cloud or Cloud-to-Cloud.</p>
      <p className="text-muted-foreground">
        The type is SMHI's estimate. Weak positive ground strikes (below about +15 kA) are often really
        In-Cloud discharges.
      </p>
    </>
  ),
  peakCurrent: (
    <>
      <p>Peak current of the discharge in kiloamperes (kA).</p>
      <p>
        The sign is the polarity. <strong>Negative</strong> means negative charge was lowered to the
        ground, which is about 90% of ground strikes (typically −10 to −40 kA). <strong>Positive</strong>{' '}
        ground strikes are rarer but often stronger.
      </p>
    </>
  ),
  type: (
    <>
      <p>
        <strong>Ground</strong>: Cloud-to-Ground. <strong>Cloud</strong>: In-Cloud or Cloud-to-Cloud.
      </p>
      <p className="text-muted-foreground">
        One lightning flash often shows up as several rows within a second: small In-Cloud pulses
        followed by one or more ground strokes.
      </p>
    </>
  ),
}
