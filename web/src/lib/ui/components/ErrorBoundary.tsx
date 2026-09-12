import { Component, type ErrorInfo, type ReactNode } from "react";
// Import puntual al módulo sin dependencias, NO a `config/deployment.ts`
// (que importa `zod` + `viem/chains` a nivel de módulo) — ver el comentario
// en `deploymentConfigError.ts`. Este boundary es estático (no perezoso), así
// que cualquier import acá entra al chunk inicial de la app.
import { DeploymentConfigError } from "../../../config/deploymentConfigError";
import { AlertTriangleIcon } from "./Icon";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Error boundary de raíz. Sin esto, cualquier `throw` durante el render (p.
 * ej. `getDeploymentConfig()` con env inválido) tira todo el árbol de React y
 * deja la pantalla completamente en blanco, sin ningún mensaje — el peor
 * escenario posible frente al jurado el día de la demo.
 *
 * `/` (Landing) no importa `getDeploymentConfig`, así que sigue funcionando
 * normalmente incluso con env inválido: este boundary solo se activa cuando
 * la ruta que sí depende de la config (comprar, pedido, entregar, vendedor,
 * demo) tira al renderizar.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // El detalle completo (incluye nombres de env vars en el caso de
    // DeploymentConfigError) solo va a la consola, nunca a la UI en prod.
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isConfigError = error instanceof DeploymentConfigError;

    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-hueso px-6 text-center">
        <span className="text-terracota">
          <AlertTriangleIcon size={40} />
        </span>
        <div>
          <h1 className="font-display text-xl font-medium text-verde">
            {isConfigError ? "La app no está configurada correctamente" : "Algo salió mal"}
          </h1>
          <p className="mt-2 max-w-sm text-sm text-verde-mut">
            {isConfigError
              ? "Faltan o son inválidas las variables de entorno de este deploy. Avisá al equipo técnico."
              : "Ocurrió un error inesperado. Podés intentar de nuevo o volver al inicio."}
          </p>
        </div>

        {import.meta.env.DEV ? (
          <pre className="mt-2 max-w-md overflow-auto rounded-card bg-blanco p-3 text-left text-xs text-terracota">
            {error.message}
          </pre>
        ) : null}

        <div className="mt-2 flex gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-11 rounded-full bg-verde px-4 text-sm font-medium text-hueso"
          >
            Reintentar
          </button>
          <a
            href="/"
            className="flex min-h-11 items-center rounded-full border border-verde-mut/40 px-4 text-sm font-medium text-verde"
          >
            Volver al inicio
          </a>
        </div>
      </div>
    );
  }
}
