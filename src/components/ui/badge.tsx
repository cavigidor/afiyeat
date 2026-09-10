import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {
  // Marks this badge as a tappable chip (filter/tag toggle, etc.) - adds
  // cursor-pointer plus the shared pressed-state feedback, instead of every
  // filter-chip call site re-declaring cursor-pointer and its own active
  // color by hand. Leave unset for purely informational badges (status
  // labels, counts) so they don't visually "press" when incidentally tapped.
  interactive?: boolean;
}

function Badge({ className, variant, interactive, ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        badgeVariants({ variant }),
        interactive && "active-press cursor-pointer active:opacity-70",
        className,
      )}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
