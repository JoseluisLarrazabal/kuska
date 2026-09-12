import { useMemo, useState } from "react";
import type { Hex } from "viem";
import { Layout } from "../lib/ui/components/Layout";
import { Field } from "../lib/ui/components/Field";
import { Button } from "../lib/ui/components/Button";
import { Banner } from "../lib/ui/components/Banner";
import { StatusChip } from "../lib/ui/components/StatusChip";
import { AmountMono } from "../lib/ui/components/AmountMono";
import { AddressMono } from "../lib/ui/components/AddressMono";
import { Countdown } from "../lib/ui/components/Countdown";
import { QrCode } from "../lib/ui/components/QrCode";
import { LockOpenIcon } from "../lib/ui/components/Icon";
import { getOrCreateAccount } from "../lib/burner";
import { useDeal } from "../lib/ui/useDeal";
import { DEFAULT_DISPUTE_WINDOW_SECONDS, useDisputeWindow } from "../lib/ui/escrowConfig";
import { DealState } from "../lib/escrow/read";
import { claimDelivery } from "../lib/ui/dealActions";
import { buildConfirmUrl, parseOrderRefFromText } from "../lib/ui/orderLink";
import { listTrackedOrders, trackOrder, untrackOrder, type TrackedOrder } from "../lib/ui/orderRegistry";

export default function Seller() {
  const seller = useMemo(() => getOrCreateAccount(), []);
  const [orders, setOrders] = useState<TrackedOrder[]>(() => listTrackedOrders());
  const [addValue, setAddValue] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  function refreshList() {
    setOrders(listTrackedOrders());
  }

  function addOrder() {
    const ref = parseOrderRefFromText(addValue);
    if (!ref) {
      setAddError("No encontramos un código válido en eso que pegaste.");
      return;
    }
    trackOrder(ref, { role: "seller" });
    setAddValue("");
    setAddError(null);
    refreshList();
  }

  function removeOrder(ref: Hex) {
    untrackOrder(ref);
    refreshList();
  }

  return (
    <Layout>
      <h1 className="mt-6 font-display text-[26px] font-medium text-verde">Tus pedidos</h1>
      <p className="mt-1 text-sm text-verde-mut">
        Cuenta de vendedor: <AddressMono address={seller.address} />
      </p>

      <div className="mt-5 flex flex-col gap-2 rounded-card bg-blanco p-4">
        <Field
          label="Agregar un pedido"
          monospace
          value={addValue}
          onChange={(e) => setAddValue(e.target.value)}
          placeholder="0x… (o pegá el link que te pasó el comprador)"
          error={addError ?? undefined}
        />
        <Button variant="secondary" onClick={addOrder} disabled={addValue.trim().length === 0}>
          Agregar
        </Button>
      </div>

      {orders.length === 0 ? (
        <p className="mt-6 text-center text-sm text-verde-mut">
          Todavía no tenés pedidos. Pedile al comprador el link de su pedido y agregalo
          arriba.
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {orders.map((order) => (
            <SellerOrderCard
              key={order.ref}
              order={order}
              seller={seller}
              onRemove={() => removeOrder(order.ref)}
            />
          ))}
        </div>
      )}
    </Layout>
  );
}

function SellerOrderCard({
  order,
  seller,
  onRemove,
}: {
  order: TrackedOrder;
  seller: ReturnType<typeof getOrCreateAccount>;
  onRemove: () => void;
}) {
  const { data: deal, isLoading, isError, refetch } = useDeal(order.ref);
  const { data: disputeWindow } = useDisputeWindow();
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function registerDelivery() {
    setClaiming(true);
    setError(null);
    const outcome = await claimDelivery(seller, order.ref);
    setClaiming(false);
    if (outcome.ok) {
      refetch();
    } else {
      setError(outcome.error.message);
    }
  }

  // Con react-query v5, `isError` también queda en `true` cuando un refetch
  // de fondo (este hook pollea cada 4s con `retry: 2`, ver `useDeal.ts`) falla
  // mientras ya había un `deal` cargado de una vuelta anterior. Reemplazar la
  // tarjeta entera por un error acá — incluyendo el QR que el comprador puede
  // estar escaneando en ese momento — por un blip de RPC de 4 segundos es
  // peor que mostrar el último estado conocido con un aviso chico. Solo se
  // trata como error bloqueante cuando NO hay ningún dato todavía.
  if (isError && !deal) {
    return (
      <div className="rounded-card bg-blanco p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-verde-mut">No pudimos leer este pedido.</span>
          <button type="button" onClick={onRemove} className="tap-target text-xs text-verde-mut underline">
            Quitar de la lista
          </button>
        </div>
        <p className="mt-1 font-mono text-xs text-verde-mut">{order.ref}</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="tap-target mt-2 text-sm font-medium text-verde underline"
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (isLoading || !deal) {
    return <div className="rounded-card bg-blanco p-4 text-sm text-verde-mut">Cargando…</div>;
  }

  const disputeDeadline = deal.claimedAt + (disputeWindow ?? DEFAULT_DISPUTE_WINDOW_SECONDS);
  // El comprador puede haber agregado este mismo pedido a su lista de
  // "Vendedor" (o quedar trackeado ahí por otro motivo): solo mostrar las
  // acciones de vendedor cuando la cuenta local de ESTE dispositivo es
  // realmente `deal.seller` on-chain — nunca ofrecer "Registrar entrega" para
  // un pedido ajeno.
  const isLocalSeller = deal.seller.toLowerCase() === seller.address.toLowerCase();

  return (
    <div className="rounded-card bg-blanco p-4">
      <div className="flex items-center justify-between">
        <StatusChip state={deal.state} />
        <button type="button" onClick={onRemove} className="tap-target text-xs text-verde-mut underline">
          Quitar de la lista
        </button>
      </div>

      {order.item ? <p className="mt-2 text-sm text-verde">{order.item}</p> : null}
      <p className="mt-1 font-mono text-xs text-verde-mut">{order.ref}</p>
      {isError ? (
        <p className="mt-1 text-xs text-terracota">
          No pudimos actualizar este pedido en el último intento — mostrando el último estado
          conocido.
        </p>
      ) : null}

      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="text-verde-mut">Comprador</span>
        <AddressMono address={deal.buyer} />
      </div>
      <div className="mt-2">
        <AmountMono amount={deal.amount} size="sm" />
      </div>

      {!isLocalSeller ? (
        <Banner kind="info" className="mt-3">
          Este dispositivo no es el vendedor de este pedido — no podés registrar la entrega
          desde acá.
        </Banner>
      ) : null}

      {error ? (
        <Banner kind="error" className="mt-3">
          {error}
        </Banner>
      ) : null}

      {deal.state === DealState.Funded && isLocalSeller ? (
        <Button className="mt-3 w-full" busy={claiming} onClick={registerDelivery}>
          Registrar entrega
        </Button>
      ) : null}

      {deal.state === DealState.DeliveryClaimed ? (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-panel bg-blanco p-4 text-center">
          <p className="font-mono text-xs text-verde-mut">Pedido #{order.ref.slice(2, 8)}</p>
          <QrCode value={buildConfirmUrl(order.ref)} />
          <p className="text-sm font-medium text-verde">Pedile al comprador que escanee</p>
          <Countdown label="Ventana de disputa:" deadline={disputeDeadline} />
        </div>
      ) : null}

      {deal.state === DealState.Released ? (
        <div className="mt-3 flex items-center justify-center gap-2 rounded-card bg-verde-3 p-3 text-hueso">
          <LockOpenIcon size={16} className="text-terracota" />
          <span className="text-sm font-medium">Fondos liberados</span>
        </div>
      ) : null}
    </div>
  );
}
