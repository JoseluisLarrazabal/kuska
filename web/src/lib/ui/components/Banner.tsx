import type { ReactNode } from "react";
import { AlertTriangleIcon, CircleCheckIcon, CircleXIcon } from "./Icon";

type Kind = "info" | "warning" | "error" | "success";

interface BannerProps {
  kind: Kind;
  title?: string;
  children: ReactNode;
  className?: string;
}

const KIND_CLASSES: Record<Kind, string> = {
  info: "bg-verde/5 border-verde-mut/30 text-verde",
  warning: "bg-terracota-tint border-terracota/40 text-verde",
  error: "bg-terracota-tint border-terracota text-verde",
  success: "bg-verde-3 border-verde-3 text-hueso",
};

function KindIcon({ kind }: { kind: Kind }) {
  if (kind === "success") return <CircleCheckIcon size={18} />;
  if (kind === "error") return <CircleXIcon size={18} className="text-terracota" />;
  if (kind === "warning") return <AlertTriangleIcon size={18} className="text-terracota" />;
  return null;
}

/**
 * Alerta con rol accesible (los estados nunca dependen solo del color): rol
 * `alert` para error/warning (interrumpe al lector de pantalla), `status`
 * para info/success.
 */
export function Banner({ kind, title, children, className = "" }: BannerProps) {
  const role = kind === "error" || kind === "warning" ? "alert" : "status";
  return (
    <div
      role={role}
      className={`flex items-start gap-2.5 rounded-card border px-4 py-3 text-sm ${KIND_CLASSES[kind]} ${className}`}
    >
      <span className="mt-0.5 shrink-0">
        <KindIcon kind={kind} />
      </span>
      <div>
        {title ? <p className="font-medium">{title}</p> : null}
        <div className={title ? "mt-0.5" : undefined}>{children}</div>
      </div>
    </div>
  );
}
