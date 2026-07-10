import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        // shadcn base variants — kept for backward-compat; prefer Bridge semantic variants below.
        default:
          "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        // Bridge semantic status variants — use these in platform surfaces.
        // Colors map to globals.css tokens (never raw hex here).
        success:
          "border-transparent text-white [a&]:hover:opacity-90",
        warning:
          "border-transparent text-white [a&]:hover:opacity-90",
        danger:
          "border-transparent text-white [a&]:hover:opacity-90",
        neutral:
          "border-transparent text-white [a&]:hover:opacity-90",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  style: callerStyle,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  // Bridge semantic variants need inline style for CSS-variable backgrounds
  // (Tailwind JIT can't handle arbitrary CSS vars in bg-* safely at build time).
  const bridgeStyle: React.CSSProperties = {};
  if (variant === "success") bridgeStyle.backgroundColor = "var(--color-sage)";
  if (variant === "warning") bridgeStyle.backgroundColor = "var(--color-amber-soft)";
  if (variant === "danger")  bridgeStyle.backgroundColor = "var(--color-danger)";
  if (variant === "neutral") bridgeStyle.backgroundColor = "var(--color-warm-gray)";

  const mergedStyle =
    Object.keys(bridgeStyle).length
      ? { ...bridgeStyle, ...callerStyle }
      : callerStyle;

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      style={mergedStyle}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
