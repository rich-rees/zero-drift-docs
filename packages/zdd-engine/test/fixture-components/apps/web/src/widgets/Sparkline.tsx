import { forwardRef } from "react";

export interface SparklineProps {
  points: number[];
  width?: number;
}

// One page uses it and it is not in a shared folder: page-private.
export const Sparkline = forwardRef<SVGSVGElement, SparklineProps>(({ points, width = 80 }, ref) => (
  <svg ref={ref} width={width}>
    {points.map((p, i) => <circle key={i} cx={i} cy={p} r={1} />)}
  </svg>
));
