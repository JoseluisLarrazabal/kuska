import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { ErrorBoundary } from "./lib/ui/components/ErrorBoundary";
import { RouteFallback } from "./lib/ui/components/RouteFallback";

// Import perezoso de TODAS las páginas: cada una queda en su propio chunk y
// solo se descarga cuando se visita esa ruta (bundle inicial más chico —
// ver vite.config.ts para el split de vendors). `Landing` (`/`) también es
// lazy, pero al no importar `getDeploymentConfig` sigue funcionando aunque
// el env esté mal configurado.
const Landing = lazy(() => import("./pages/Landing"));
const Buy = lazy(() => import("./pages/Buy"));
const Order = lazy(() => import("./pages/Order"));
const Deliver = lazy(() => import("./pages/Deliver"));
const Seller = lazy(() => import("./pages/Seller"));
const Demo = lazy(() => import("./pages/Demo"));
const Preview = lazy(() => import("./pages/Preview"));

export default function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/comprar" element={<Buy />} />
          <Route path="/pedido/:ref" element={<Order />} />
          <Route path="/entregar" element={<Deliver />} />
          <Route path="/vendedor" element={<Seller />} />
          <Route path="/demo" element={<Demo />} />
          {import.meta.env.DEV ? <Route path="/_preview" element={<Preview />} /> : null}
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
