import { Routes, Route } from "react-router-dom";

// Pantallas reales: carril B2. Estas son rutas placeholder mínimas.
function Home() {
  return <h1>Kuska</h1>;
}

function Comprar() {
  return <h1>Comprar</h1>;
}

function Pedido() {
  return <h1>Pedido</h1>;
}

function Entregar() {
  return <h1>Entregar</h1>;
}

function Vendedor() {
  return <h1>Vendedor</h1>;
}

function Demo() {
  return <h1>Demo</h1>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/comprar" element={<Comprar />} />
      <Route path="/pedido/:ref" element={<Pedido />} />
      <Route path="/entregar" element={<Entregar />} />
      <Route path="/vendedor" element={<Vendedor />} />
      <Route path="/demo" element={<Demo />} />
    </Routes>
  );
}
