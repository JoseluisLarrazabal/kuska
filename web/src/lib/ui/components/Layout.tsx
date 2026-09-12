import type { ReactNode } from "react";
import { Link } from "react-router-dom";

interface LayoutProps {
  children: ReactNode;
  /** Ensancha el contenido a `max-w-2xl` (pantalla de vendedor en laptop). Mobile no cambia. */
  wide?: boolean;
}

/** Shell de página: header de marca + contenido angosto, mobile-first (~390px). */
export function Layout({ children, wide }: LayoutProps) {
  return (
    <div className="min-h-dvh bg-hueso">
      <header className="flex items-center justify-between px-4 py-2 sm:px-6">
        <Link
          to="/"
          className="flex min-h-11 items-center gap-2"
          aria-label="Kuska, ir al inicio"
        >
          <img src="/brand/kuska-mark.svg" alt="" width={28} height={28} />
          <span className="font-display text-lg font-medium text-verde">Kuska</span>
        </Link>
        <Link
          to="/demo"
          className="flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-verde-mut hover:text-verde"
        >
          Panel demo
        </Link>
      </header>
      <main className={`mx-auto px-4 pb-16 sm:px-6 ${wide ? "max-w-2xl" : "max-w-md"}`}>{children}</main>
    </div>
  );
}
