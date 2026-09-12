import { useId, type InputHTMLAttributes, type ReactNode } from "react";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  error?: string;
  monospace?: boolean;
}

/** Input con label real, hint y error accesibles (aria-describedby). */
export function Field({ label, hint, error, monospace, className = "", id, ...rest }: FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-verde">
        {label}
      </label>
      <input
        id={inputId}
        aria-describedby={describedBy}
        aria-invalid={Boolean(error) || undefined}
        className={`min-h-11 rounded-field border px-3.5 py-2.5 text-[16px] text-verde placeholder:text-verde-mut/60 focus-visible:border-terracota ${
          error ? "border-terracota" : "border-verde-mut/40"
        } ${monospace ? "font-mono tabular-nums" : ""} ${className}`}
        {...rest}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-verde-mut">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-terracota">
          {error}
        </p>
      ) : null}
    </div>
  );
}
