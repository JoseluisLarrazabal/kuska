import type { SVGProps } from "react";

/**
 * Set mínimo de íconos (trazo, `currentColor`), tomados del catálogo Iconify
 * (set `lucide`, licencia ISC) vía el MCP de iconify — no se inventan SVGs a
 * mano (regla 12 del flujo de trabajo).
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...props }: IconProps) {
  return {
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    "aria-hidden": true,
    focusable: false,
    ...props,
  };
}

/** Candado cerrado — estado "En custodia" (fondos bloqueados). */
export function LockClosedIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
        <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </g>
    </svg>
  );
}

/** Candado abierto — estado "Liberado" (fondos pagados al vendedor). */
export function LockOpenIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
        <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 9.9-1" />
      </g>
    </svg>
  );
}

/** Alerta — estado "En disputa". */
export function AlertTriangleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="m21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4m0 4h.01"
      />
    </svg>
  );
}

/** Flecha de retorno — estado "Reembolsado". */
export function UndoIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
        <path d="M9 14L4 9l5-5" />
        <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />
      </g>
    </svg>
  );
}

export function CircleCheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
        <path d="M21.801 10A10 10 0 1 1 17 3.335" />
        <path d="m9 11l3 3L22 4" />
      </g>
    </svg>
  );
}

export function CircleXIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
        <circle cx="12" cy="12" r="10" />
        <path d="m15 9l-6 6m0-6l6 6" />
      </g>
    </svg>
  );
}

export function ExternalLinkIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 3h6v6m-11 5L21 3m-3 10v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
      />
    </svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
      </g>
    </svg>
  );
}

export function CameraOffIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
        <path d="M14.564 14.558a3 3 0 1 1-4.122-4.121M2 2l20 20" />
        <path d="M20 20H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 .819-.175m2.879-2.801A2 2 0 0 1 10.004 4h3.993a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v7.344" />
      </g>
    </svg>
  );
}

export function ScanLineIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 7V5a2 2 0 0 1 2-2h2m10 0h2a2 2 0 0 1 2 2v2m0 10v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2m4-5h10"
      />
    </svg>
  );
}

export function KeyboardIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
        <path d="M10 8h.01M12 12h.01M14 8h.01M16 12h.01M18 8h.01M6 8h.01M7 16h10m-9-4h.01" />
        <rect width="20" height="16" x="2" y="4" rx="2" />
      </g>
    </svg>
  );
}

export function DropletIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5S5 13 5 15a7 7 0 0 0 7 7"
      />
    </svg>
  );
}
