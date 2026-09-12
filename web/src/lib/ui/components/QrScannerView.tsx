import { useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";
import { CameraOffIcon } from "./Icon";

interface QrScannerViewProps {
  onDecode: (text: string) => void;
  className?: string;
}

/** Escáner de QR in-app (cámara). Si falla el permiso o no hay cámara, avisa (el fallback de entrada manual lo maneja la pantalla que lo usa). */
export function QrScannerView({ onDecode, className = "" }: QrScannerViewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onDecodeRef = useRef(onDecode);
  onDecodeRef.current = onDecode;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    const scanner = new QrScanner(video, (result) => onDecodeRef.current(result.data), {
      preferredCamera: "environment",
      highlightScanRegion: true,
      highlightCodeOutline: true,
    });

    scanner.start().catch((err: unknown) => {
      if (cancelled) return;
      const message = err instanceof Error ? err.message : String(err);
      setError(
        /(permission|notallowed|denied)/i.test(message)
          ? "No se pudo acceder a la cámara: dale permiso desde el navegador, o ingresá el código a mano."
          : "No se encontró una cámara disponible. Ingresá el código a mano.",
      );
    });

    return () => {
      cancelled = true;
      scanner.stop();
      scanner.destroy();
    };
  }, []);

  if (error) {
    return (
      <div
        role="alert"
        className={`flex flex-col items-center gap-3 rounded-card border border-verde-mut/30 bg-blanco p-6 text-center ${className}`}
      >
        <CameraOffIcon size={32} className="text-verde-mut" />
        <p className="text-sm text-verde-mut">{error}</p>
      </div>
    );
  }

  return (
    <div className={`overflow-hidden rounded-card bg-verde-3 ${className}`}>
      <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
    </div>
  );
}
