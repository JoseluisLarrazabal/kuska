import { formatDemoUsd } from "../format";

interface AmountMonoProps {
  amount: bigint;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<AmountMonoProps["size"]>, string> = {
  sm: "text-base",
  md: "text-2xl",
  lg: "text-[44px] leading-none",
};

/** Monto en JetBrains Mono, tabular-nums, siempre rotulado "(demo)". */
export function AmountMono({ amount, size = "md", className = "" }: AmountMonoProps) {
  return (
    <span className={`font-mono font-semibold tabular-nums ${SIZE_CLASSES[size]} ${className}`}>
      {formatDemoUsd(amount)}
      <span className="ml-1 whitespace-nowrap font-sans text-[0.55em] font-normal text-verde-mut align-middle">
        mUSD (demo)
      </span>
    </span>
  );
}
