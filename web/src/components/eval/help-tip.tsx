"use client";

import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Small info icon with an explanatory tooltip. */
export function HelpTip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="More info"
            className={cn(
              "inline-grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
              className,
            )}
          />
        }
      >
        <Info className="size-3.5" strokeWidth={1.75} />
      </TooltipTrigger>
      <TooltipContent className="block max-w-72 leading-relaxed">{children}</TooltipContent>
    </Tooltip>
  );
}
