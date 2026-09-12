import { useState } from "react";
import { truncateHex } from "../format";
import { CopyIcon } from "./Icon";

interface HashMonoProps {
  /** Hex largo (orderRef, tx hash) — nunca se renderiza completo en el layout. */
  value: string;
  /** Link opcional (p. ej. al explorer) que se muestra al lado. */
  href?: string;
  hrefLabel?: string;
  /** Caracteres visibles a cada lado de la elipsis (ver `truncateHex`). */
  chars?: number;
  className?: string;
}

/**
 * Hex largo (orderRef de 66 caracteres, tx hash) truncado en el medio con
 * `title` con el valor completo y botón de copiar — mirando `AddressMono`.
 * A diferencia de mostrar el hex entero (`{value}` en un `<p>`), esto nunca
 * desborda su contenedor sin importar el ancho de pantalla (bug visto en
 * mobile a 390px: el orderRef/tx hash empujaba la página a 536px de ancho).
 * No asume que `value` es una dirección (por eso no usa `AddressMono`, que
 * linkea siempre al explorer de direcciones): acá el link es opcional y lo
 * decide quien la usa (explorer de tx, o ninguno para un orderRef que no es
 * una entidad on-chain en sí misma).
 */
export function HashMono({ value, href, hrefLabel = "Ver en el explorer", chars = 6, className = "" }: HashMonoProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard no disponible: no-op, el valor completo sigue en el `title` y visible al copiar a mano
    }
  }

  return (
    <span className={`inline-flex min-w-0 max-w-full items-center gap-1.5 font-mono text-xs tabular-nums ${className}`}>
      <span className="truncate" title={value}>
        {truncateHex(value, chars)}
      </span>
      <button
        type="button"
        onClick={copy}
        className="tap-target inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-current opacity-70 hover:opacity-100"
        aria-label={copied ? "Copiado" : "Copiar"}
      >
        <CopyIcon size={14} />
      </button>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="shrink-0 underline">
          {hrefLabel}
        </a>
      ) : null}
    </span>
  );
}
