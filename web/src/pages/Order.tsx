import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { Hex } from "viem";
import { Layout } from "../lib/ui/components/Layout";
import { Banner } from "../lib/ui/components/Banner";
import { Button } from "../lib/ui/components/Button";
import { StatusChip } from "../lib/ui/components/StatusChip";
import { AmountMono } from "../lib/ui/components/AmountMono";
import { AddressMono } from "../lib/ui/components/AddressMono";
import { HashMono } from "../lib/ui/components/HashMono";
import { Countdown } from "../lib/ui/components/Countdown";
import { LockOpenIcon, UndoIcon } from "../lib/ui/components/Icon";
import { useDeal } from "../lib/ui/useDeal";
import { DEFAULT_DISPUTE_WINDOW_SECONDS, useDisputeWindow } from "../lib/ui/escrowConfig";
import { DealState } from "../lib/escrow/read";
import { getAccount } from "../lib/burner";
import {
  confirmRelease,
  openDispute,
  refundExpired,
  releaseAfterWindow,
} from "../lib/ui/dealActions";
import type { RelayOutcome } from "../lib/ui/relayer";
import { useNow } from "../lib/ui/useNow";
import { canOpenDisputeWindow, canReleaseAfterWindow, canRequestRefund } from "../lib/ui/dealTiming";
import { txExplorerUrl } from "../lib/ui/explorer";
import { endSentence, formatDeadline } from "../lib/ui/format";
import { findTrackedOrder, trackOrder } from "../lib/ui/orderRegistry";

const HEX32_RE = /^0x[0-9a-fA-F]{64}$/;

interface ActionState {
  pending: string | null;
  error: string | null;
  lastTxHash: string | null;
}

export default function Order() {
  const { ref } = useParams<{ ref: string }>();
  const [params] = useSearchParams();
  const highlightRelease = params.get("accion") === "liberar";
  const itemParam = params.get("item");

  const validRef = ref && HEX32_RE.test(ref) ? (ref as Hex) : undefined;
  // Si el link no trae `?item=` (p. ej. un link viejo, o un ref pegado a
  // mano), buscamos el label guardado por `trackOrder` la última vez que
  // este dispositivo vio este pedido con un item — sin esto, revisitar
  // `/pedido/:ref` sin el query param mostraba el pedido sin referencia
  // aunque este mismo dispositivo la hubiera visto antes.
  const item = useMemo(
    () => itemParam ?? (validRef ? findTrackedOrder(validRef)?.item : undefined),
    [itemParam, validRef],
  );
  const { data: deal, isLoading, isError, refetch } = useDeal(validRef);
  const { data: disputeWindow, isPlaceholderData: disputeWindowIsGuess } = useDisputeWindow();
  const now = useNow();
  const [action, setAction] = useState<ActionState>({ pending: null, error: null, lastTxHash: null });

  // se registra el link visitado: sirve para volver a encontrarlo desde /vendedor
  useEffect(() => {
    if (validRef) trackOrder(validRef, item ? { item } : {});
  }, [validRef, item]);

  if (!validRef) {
    return (
      <Layout>
        <Banner kind="error" title="Link inválido" className="mt-6">
          Este link de pedido no tiene un código válido.
        </Banner>
      </Layout>
    );
  }

  const burner = getAccount();
  const role =
    burner && deal
      ? burner.address.toLowerCase() === deal.buyer.toLowerCase()
        ? "buyer"
        : burner.address.toLowerCase() === deal.seller.toLowerCase()
          ? "seller"
          : undefined
      : undefined;

  const disputeDeadline = deal ? deal.claimedAt + (disputeWindow ?? DEFAULT_DISPUTE_WINDOW_SECONDS) : undefined;
  const canReleaseNow = canReleaseAfterWindow(disputeDeadline, disputeWindowIsGuess, now);

  async function runAction(name: string, run: () => Promise<RelayOutcome>) {
    setAction({ pending: name, error: null, lastTxHash: null });
    const outcome = await run();
    if (outcome.ok) {
      setAction({ pending: null, error: null, lastTxHash: outcome.data.hash });
      refetch();
    } else {
      setAction({ pending: null, error: outcome.error.message, lastTxHash: null });
    }
  }

  return (
    <Layout>
      <h1 className="mt-6 font-display text-[26px] font-medium text-verde">Estado del pedido</h1>
      {item ? <p className="mt-1 text-sm text-verde-mut">{item}</p> : null}
      <div className="mt-1 text-xs text-verde-mut">
        <HashMono value={validRef} />
      </div>

      {isLoading ? (
        <div className="mt-8 rounded-card bg-blanco p-6 text-center text-sm text-verde-mut">
          Leyendo el estado en la cadena…
        </div>
      ) : null}

      {/*
        Con react-query v5, `isError` también queda en `true` cuando un
        refetch de fondo falla (este hook pollea cada 4s con `retry: 2`, ver
        `useDeal.ts`) mientras ya había un `deal` cargado. Mostrar el banner
        de error completo en ese caso es engañoso: la tarjeta del pedido de
        abajo sigue mostrando el último estado válido al mismo tiempo. Solo se
        bloquea con el error grande cuando no hay ningún dato todavía.
      */}
      {isError && !deal ? (
        <Banner kind="error" title="No se pudo leer el pedido" className="mt-6">
          <p>No pudimos hablar con la red ahora mismo.</p>
          <button type="button" onClick={() => refetch()} className="tap-target mt-2 font-medium underline">
            Reintentar
          </button>
        </Banner>
      ) : null}

      {deal ? (
        <>
          {isError ? (
            <Banner kind="warning" title="No pudimos actualizar el pedido" className="mt-6">
              Mostrando el último estado conocido. Puede haber cambiado desde entonces.
            </Banner>
          ) : null}
          <div className="mt-6 flex items-center justify-between rounded-card bg-blanco p-4">
            <StatusChip state={deal.state} />
            <AmountMono amount={deal.amount} size="md" />
          </div>

          {deal.state === DealState.None ? (
            <Banner kind="info" className="mt-4">
              Este pedido todavía no fue fondeado (o el código no corresponde a ninguno
              existente).
            </Banner>
          ) : null}

          <div className="mt-4 flex flex-col gap-2 rounded-card bg-blanco p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-verde-mut">Comprador</span>
              <AddressMono address={deal.buyer} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-verde-mut">Vendedor</span>
              <AddressMono address={deal.seller} />
            </div>
            {deal.state === DealState.Funded ? (
              <div className="flex items-center justify-between">
                <span className="text-verde-mut">Plazo de entrega</span>
                <Countdown deadline={deal.deliveryDeadline} />
              </div>
            ) : null}
            {deal.state === DealState.DeliveryClaimed && disputeDeadline !== undefined ? (
              <div className="flex items-center justify-between">
                <span className="text-verde-mut">Ventana de disputa</span>
                <Countdown deadline={disputeDeadline} />
              </div>
            ) : null}
          </div>

          {highlightRelease && deal.state === DealState.DeliveryClaimed && role === "buyer" ? (
            <Banner kind="info" title="Escaneaste el QR del vendedor" className="mt-4">
              Confirmá la recepción para liberar el pago.
            </Banner>
          ) : null}

          {action.error ? (
            <Banner kind="error" title="La acción no se pudo completar" className="mt-4">
              {action.error}
            </Banner>
          ) : null}

          {action.lastTxHash ? (
            <Banner kind="success" title="Listo" className="mt-4">
              <HashMono value={action.lastTxHash} href={txExplorerUrl(action.lastTxHash)} />
            </Banner>
          ) : null}

          {deal.state === DealState.Released ? (
            <TerminalReceipt
              icon={<LockOpenIcon size={32} className="text-terracota" />}
              title="Fondos liberados"
              amount={deal.amount}
              caption="Entregado y pagado."
            />
          ) : null}

          {deal.state === DealState.Refunded ? (
            <TerminalReceipt
              icon={<UndoIcon size={32} className="text-terracota" />}
              title="Reembolso completado"
              amount={deal.amount}
              caption="Devuelto al comprador."
            />
          ) : null}

          <div className="mt-6 flex flex-col gap-3">
            {canRequestRefund(deal, role, now) ? (
              <Button
                variant="danger"
                busy={action.pending === "refund"}
                onClick={() => runAction("refund", () => refundExpired(validRef))}
              >
                Pedir reembolso (venció el plazo de entrega)
              </Button>
            ) : null}

            {deal.state === DealState.Funded && role === "seller" ? (
              <Link
                to="/vendedor"
                className="flex min-h-11 items-center justify-center rounded-full border border-verde px-5 text-[16px] font-medium text-verde hover:bg-verde/5"
              >
                Ir a registrar la entrega
              </Link>
            ) : null}

            {deal.state === DealState.Funded && role === "buyer" ? (
              canRequestRefund(deal, role, now) ? (
                <p className="text-center text-sm text-verde-mut">
                  Venció el plazo de entrega sin que el vendedor la registrara: ya podés
                  pedir el reembolso.
                </p>
              ) : (
                <p className="text-center text-sm text-verde-mut">
                  {endSentence(
                    `Esperando que el vendedor registre la entrega, antes de las ${formatDeadline(deal.deliveryDeadline, now)}`,
                  )}{" "}
                  Si vence el plazo sin que la registre, vas a poder pedir el reembolso.
                </p>
              )
            ) : null}

            {deal.state === DealState.Funded && role !== "buyer" && role !== "seller" ? (
              <p className="text-center text-sm text-verde-mut">
                Esperando que el vendedor registre la entrega.
              </p>
            ) : null}

            {deal.state === DealState.DeliveryClaimed && role === "buyer" && burner ? (
              <>
                <Button
                  busy={action.pending === "release"}
                  onClick={() => runAction("release", () => confirmRelease(burner, validRef))}
                >
                  Confirmar recepción y liberar el pago
                </Button>
                {canOpenDisputeWindow(disputeDeadline, disputeWindowIsGuess, now) ? (
                  <Button
                    variant="secondary"
                    busy={action.pending === "dispute"}
                    onClick={() => runAction("dispute", () => openDispute(burner, validRef))}
                  >
                    Abrir una disputa
                  </Button>
                ) : null}
              </>
            ) : null}

            {deal.state === DealState.DeliveryClaimed && role !== "buyer" ? (
              <p className="text-center text-sm text-verde-mut">
                {role === "seller" ? (
                  "Ya registraste la entrega. Pedile al comprador que escanee el QR (o abra este link) para confirmar la recepción y liberar el pago. Si no confirma antes de que venza la ventana de disputa, vas a poder liberar el pago igual."
                ) : (
                  // Ni comprador ni vendedor de este pedido, con o sin cuenta local.
                  // Escenario típico de la demo en vivo: el comprador escaneó el QR
                  // del vendedor con la CÁMARA NATIVA del teléfono (no el lector de
                  // Kuska), que abre esto en un navegador sin la cuenta del
                  // comprador — o con la cuenta de OTRO rol ya usada antes en ese
                  // mismo dispositivo. En ningún caso se crea una cuenta ni se
                  // ofrece firmar acá; nunca se dice "no hay nada para hacer" porque
                  // el botón de liberar por ventana vencida (abajo) puede seguir
                  // disponible para cualquier cuenta.
                  <>
                    {burner
                      ? "Esta cuenta de este dispositivo no es la que compró este pedido."
                      : "Este navegador no tiene la cuenta con la que se compró este pedido."}{" "}
                    Abrí este link en el navegador/dispositivo donde compraste, o escaneá el
                    QR con el lector de Kuska (no con la cámara del teléfono).
                    {canReleaseNow
                      ? " Venció la ventana de disputa: cualquiera puede liberar el pago con el botón de abajo."
                      : ""}
                  </>
                )}
              </p>
            ) : null}

            {deal.state === DealState.DeliveryClaimed && canReleaseNow ? (
              <Button
                variant="secondary"
                busy={action.pending === "auto-release"}
                onClick={() => runAction("auto-release", () => releaseAfterWindow(validRef))}
              >
                Liberar pago (venció la ventana de disputa)
              </Button>
            ) : null}

            {deal.state === DealState.Disputed ? (
              <Banner kind="warning">
                Este pedido está en disputa. Un árbitro (centralizado, declarado) va a
                resolverlo.
              </Banner>
            ) : null}
          </div>
        </>
      ) : null}
    </Layout>
  );
}

/**
 * Panel de estado terminal (docs/brand.md "Fondos liberados"): mismo look
 * para `Released` y `Refunded` — solo cambia el ícono, el título y el
 * caption — para que los dos desenlaces lean consistentes entre sí.
 */
function TerminalReceipt({
  icon,
  title,
  amount,
  caption,
}: {
  icon: ReactNode;
  title: string;
  amount: bigint;
  caption: string;
}) {
  return (
    <div className="mt-4 flex flex-col items-center gap-2 rounded-panel bg-verde-3 p-8 text-center text-hueso">
      {icon}
      <p className="font-display text-[26px] font-medium">{title}</p>
      <AmountMono amount={amount} size="lg" className="text-hueso" />
      <p className="text-sm text-hueso/80">{caption}</p>
    </div>
  );
}
