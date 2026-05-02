import type * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Trimmed down to only the variants/sizes actually consumed in this app
// (StateView uses `default` + `link` + `sm`; ThemeToggle uses `ghost` +
// `icon`). The full shadcn matrix (destructive / outline / secondary +
// xs / lg / icon-xs / icon-sm / icon-lg + size "default") was carrying
// dead CSS tokens (--destructive-foreground, --secondary*, --ring,
// --input) that nothing else referenced. Add a variant or size back
// when a real call site needs it; otherwise the API surface stays the
// minimum necessary to render the buttons we actually have.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-accent-hover",
        ghost:
          "hover:bg-muted hover:text-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "sm",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "sm",
  asChild = false,
  type,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  // Default `type="button"` so a Button placed inside a <form> never
  // accidentally submits it. The HTML default for <button> with no
  // explicit type is "submit", which is a real foot-gun even though
  // this app currently has no forms — the default keeps shadcn Button
  // safe for any future form context. asChild defers to the user's
  // wrapped element (Slot.Root has no native type), so we only inject
  // the default when rendering an actual <button>.
  const typeProps = asChild ? {} : { type: type ?? "button" }

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...typeProps}
      {...props}
    />
  )
}

export { Button }
