/**
 * Fallback de `<Suspense>` para las rutas cargadas con `React.lazy` (todas,
 * ver `App.tsx`). Sobre la wifi de un evento el chunk de una ruta puede tardar
 * en llegar: esto evita un flash en blanco mientras se descarga, con la marca
 * aplicada (fondo hueso, spinner en verde) en vez de nada.
 */
export function RouteFallback() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-hueso" role="status" aria-label="Cargando">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-verde-mut/30 border-t-verde" />
    </div>
  );
}
