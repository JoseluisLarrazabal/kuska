import { DealState } from "../../escrow/read";
import { AlertTriangleIcon, LockClosedIcon, LockOpenIcon, UndoIcon } from "./Icon";

/**
 * Chip de estado (docs/brand.md "Estados"): cada uno se distingue por forma +
 * ícono además de por color, no solo por color (accesibilidad).
 */
export function StatusChip({ state }: { state: DealState }) {
  switch (state) {
    case DealState.None:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border-[1.4px] border-verde-mut px-3 py-1 text-sm font-medium text-verde-mut">
          <span className="h-1.5 w-1.5 rounded-full bg-verde-mut" aria-hidden="true" />
          Pendiente
        </span>
      );
    case DealState.Funded:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-verde-2 px-3 py-1 text-sm font-medium text-hueso">
          <LockClosedIcon size={14} />
          En custodia
        </span>
      );
    case DealState.DeliveryClaimed:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-verde px-3 py-1 text-sm font-medium text-hueso">
          <span className="h-1.5 w-1.5 rounded-full bg-terracota" aria-hidden="true" />
          Entrega registrada
        </span>
      );
    case DealState.Released:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-verde-3 px-3 py-1 text-sm font-medium text-hueso">
          <LockOpenIcon size={14} />
          Liberado
        </span>
      );
    case DealState.Refunded:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-verde bg-blanco px-3 py-1 text-sm font-medium text-verde">
          <UndoIcon size={14} />
          Reembolsado
        </span>
      );
    case DealState.Disputed:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-terracota-tint px-3 py-1 text-sm font-medium text-verde">
          <AlertTriangleIcon size={14} />
          En disputa
        </span>
      );
  }
}
