import { useState, type ReactNode } from "react";
import { Layout } from "../lib/ui/components/Layout";
import { Button } from "../lib/ui/components/Button";
import { Field } from "../lib/ui/components/Field";
import { Banner } from "../lib/ui/components/Banner";
import { StatusChip } from "../lib/ui/components/StatusChip";
import { AmountMono } from "../lib/ui/components/AmountMono";
import { AddressMono } from "../lib/ui/components/AddressMono";
import { Countdown } from "../lib/ui/components/Countdown";
import { QrCode } from "../lib/ui/components/QrCode";
import { LockOpenIcon } from "../lib/ui/components/Icon";
import { DealState } from "../lib/escrow/read";
import { nowSeconds } from "../lib/ui/format";

const MOCK_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const MOCK_AMOUNT = 25_500_000n; // 25.50 mUSD

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-lg font-medium text-verde">{title}</h2>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

/** Galería de estados y componentes con datos mockeados (solo dev, sin llamadas a la cadena). */
export default function Preview() {
  const [busy, setBusy] = useState(false);

  return (
    <Layout>
      <h1 className="mt-6 font-display text-[26px] font-medium text-verde">
        Galería de diseño (solo dev)
      </h1>
      <p className="mt-1 text-sm text-verde-mut">
        Todos los estados con datos mockeados. No hace ninguna llamada a la cadena.
      </p>

      <Section title="Chips de estado">
        <div className="flex flex-wrap gap-2 rounded-card bg-blanco p-4">
          <StatusChip state={DealState.None} />
          <StatusChip state={DealState.Funded} />
          <StatusChip state={DealState.DeliveryClaimed} />
          <StatusChip state={DealState.Released} />
          <StatusChip state={DealState.Refunded} />
          <StatusChip state={DealState.Disputed} />
        </div>
      </Section>

      <Section title="Botones">
        <div className="flex flex-col gap-2 rounded-card bg-blanco p-4">
          <Button variant="primary">Primario</Button>
          <Button variant="secondary">Secundario</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button busy={busy} onClick={() => setBusy((b) => !b)}>
            {busy ? "Cargando…" : "Tocar para alternar \"busy\""}
          </Button>
        </div>
      </Section>

      <Section title="Montos y direcciones">
        <div className="flex flex-col gap-3 rounded-card bg-blanco p-4">
          <AmountMono amount={MOCK_AMOUNT} size="lg" />
          <AmountMono amount={MOCK_AMOUNT} size="md" />
          <AmountMono amount={MOCK_AMOUNT} size="sm" />
          <AddressMono address={MOCK_ADDRESS} label="Vendedor" />
        </div>
      </Section>

      <Section title="Cuenta regresiva">
        <div className="rounded-card bg-blanco p-4">
          <Countdown label="Ventana de disputa:" deadline={BigInt(nowSeconds() + 95)} />
        </div>
      </Section>

      <Section title="Alertas">
        <Banner kind="info" title="Info">
          Mensaje informativo neutro.
        </Banner>
        <Banner kind="success" title="Listo">
          La operación se completó.
        </Banner>
        <Banner kind="warning" title="Atención">
          Algo requiere tu atención antes de seguir.
        </Banner>
        <Banner kind="error" title="Error">
          Algo no funcionó. Mostrás el motivo, nunca un spinner infinito.
        </Banner>
      </Section>

      <Section title="Campo con error">
        <div className="rounded-card bg-blanco p-4">
          <Field label="Monto (demo)" value="abc" onChange={() => undefined} error="Ingresá un monto mayor a 0." />
        </div>
      </Section>

      <Section title="Código QR del vendedor">
        <div className="flex justify-center rounded-card bg-blanco p-4">
          <QrCode value="https://kuska.demo/pedido/0x00...?accion=liberar" />
        </div>
      </Section>

      <Section title="Fondos liberados">
        <div className="flex flex-col items-center gap-2 rounded-panel bg-verde-3 p-8 text-center text-hueso">
          <LockOpenIcon size={32} className="text-terracota" />
          <p className="font-display text-[26px] font-medium">Fondos liberados</p>
          <AmountMono amount={MOCK_AMOUNT} size="lg" className="text-hueso" />
          <p className="text-sm text-hueso/80">Entregado y pagado.</p>
        </div>
      </Section>
    </Layout>
  );
}
