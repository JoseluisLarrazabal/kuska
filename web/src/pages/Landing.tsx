import { Link } from "react-router-dom";
import { Layout } from "../lib/ui/components/Layout";
import { LockClosedIcon, ScanLineIcon, LockOpenIcon } from "../lib/ui/components/Icon";

const STEPS = [
  {
    icon: LockClosedIcon,
    title: "1. El comprador fondea",
    body:
      "Confirma el pedido y el monto (demo). Los fondos quedan en custodia en el contrato: ni el comprador ni el vendedor los tocan todavía.",
  },
  {
    icon: ScanLineIcon,
    title: "2. El vendedor entrega",
    body:
      "Registra la entrega y muestra un código QR. Es la prueba de que el pedido salió.",
  },
  {
    icon: LockOpenIcon,
    title: "3. Se libera el pago",
    body:
      "El comprador escanea y confirma, y el pago se libera al instante. Si se queda callado, se libera solo pasada la ventana.",
  },
] as const;

export default function Landing() {
  return (
    <Layout>
      <section className="pt-8 text-center sm:pt-14">
        <img src="/brand/kuska-mark.svg" alt="" width={52} height={52} className="mx-auto" />
        <h1 className="mt-4 font-display text-[30px] font-medium text-verde sm:text-[36px]">
          Kuska · custodia contra entrega
        </h1>
        <p className="mt-3 text-verde-mut">
          Kuska, en quechua: juntos, a la par. Nadie adelanta plata.
        </p>
      </section>

      <section className="mt-8 rounded-panel bg-verde-2/10 p-5">
        <p className="text-[16px] leading-relaxed text-verde">
          Kuska es un escrow on-chain para comercio B2B: el comprador fondea en dólares
          digitales de demo, el dinero queda bloqueado en un contrato, y solo se libera
          contra entrega confirmada. Sin efectivo adelantado y sin que nadie tenga que
          confiar a ciegas en la otra parte.
        </p>
      </section>

      <section className="mt-8 flex flex-col gap-4">
        {STEPS.map(({ icon: Icon, title, body }) => (
          <div key={title} className="flex gap-3 rounded-card bg-blanco p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-verde-2 text-hueso">
              <Icon size={18} />
            </span>
            <div>
              <h2 className="text-[16px] font-semibold text-verde">{title}</h2>
              <p className="mt-1 text-sm text-verde-mut">{body}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="mt-8 rounded-card border border-terracota/40 bg-terracota-tint p-4 text-sm text-verde">
        <p className="font-medium">Honestidad ante todo, no es magia descentralizada:</p>
        <p className="mt-1">
          la liberación es <strong>aceptación optimista</strong>: si el comprador nunca
          responde, el pago se libera solo cuando vence la ventana de disputa. Si algo
          sale mal, un <strong>árbitro centralizado</strong> (declarado, no oculto) puede
          resolver el conflicto. No prometemos descentralización total.
        </p>
      </section>

      <section className="mt-10 flex flex-col items-center gap-3 pb-6 text-center">
        <Link
          to="/demo"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-verde px-5 py-2.5 text-[16px] font-medium text-hueso hover:bg-verde-2"
        >
          Ver la demo
        </Link>
        <Link to="/comprar" className="text-sm font-medium text-verde-mut hover:text-verde">
          Armar un pedido de prueba →
        </Link>
      </section>
    </Layout>
  );
}
