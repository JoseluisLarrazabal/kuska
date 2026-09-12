import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing";
import Buy from "./pages/Buy";
import Order from "./pages/Order";
import Deliver from "./pages/Deliver";
import Seller from "./pages/Seller";
import Demo from "./pages/Demo";

// Import perezoso: en build de producción (`import.meta.env.DEV` falso) el
// bundle de `Preview.tsx` queda en su propio chunk y nunca se referencia
// desde la ruta real, así que Vite lo separa del bundle principal.
const Preview = lazy(() => import("./pages/Preview"));

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/comprar" element={<Buy />} />
      <Route path="/pedido/:ref" element={<Order />} />
      <Route path="/entregar" element={<Deliver />} />
      <Route path="/vendedor" element={<Seller />} />
      <Route path="/demo" element={<Demo />} />
      {import.meta.env.DEV ? (
        <Route
          path="/_preview"
          element={
            <Suspense fallback={null}>
              <Preview />
            </Suspense>
          }
        />
      ) : null}
    </Routes>
  );
}
