import { useState } from "react";
import { truncateHex } from "../format";
import { addressExplorerUrl } from "../explorer";
import { CopyIcon, ExternalLinkIcon } from "./Icon";

interface AddressMonoProps {
  address: string;
  label?: string;
  className?: string;
}

/** Dirección/hash en mono, truncada, con copiar + link al explorer. */
export function AddressMono({ address, label, className = "" }: AddressMonoProps) {
  const [copied, setCopied] = useState(false);
  const explorerUrl = addressExplorerUrl(address);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard no disponible: no-op, la dirección sigue visible para copiar a mano
    }
  }

  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-sm tabular-nums ${className}`}>
      {label ? <span className="text-verde-mut">{label}</span> : null}
      <span title={address}>{truncateHex(address)}</span>
      <button
        type="button"
        onClick={copy}
        className="tap-target inline-flex h-6 w-6 items-center justify-center rounded text-verde-mut hover:text-verde"
        aria-label={copied ? "Dirección copiada" : "Copiar dirección"}
      >
        <CopyIcon size={14} />
      </button>
      {explorerUrl ? (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="tap-target inline-flex h-6 w-6 items-center justify-center rounded text-verde-mut hover:text-verde"
          aria-label="Ver en el explorer de HashKey Chain"
        >
          <ExternalLinkIcon size={14} />
        </a>
      ) : null}
    </span>
  );
}
