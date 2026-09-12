import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  busy?: boolean;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-verde text-hueso hover:bg-verde-2 disabled:bg-verde-mut",
  secondary: "bg-transparent text-verde border border-verde hover:bg-verde/5 disabled:border-verde-mut disabled:text-verde-mut",
  ghost: "bg-transparent text-verde-mut hover:text-verde disabled:text-verde-mut/60",
  danger: "bg-terracota text-hueso hover:brightness-110 disabled:bg-verde-mut",
};

/** Botón de marca: pill, >=44px de alto (área táctil), foco visible. */
export function Button({ variant = "primary", busy, className = "", children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[16px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${VARIANT_CLASSES[variant]} ${className}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span
      className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden="true"
    />
  );
}
