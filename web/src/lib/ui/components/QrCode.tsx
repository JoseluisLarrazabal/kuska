import { QRCodeSVG } from "qrcode.react";

interface QrCodeProps {
  value: string;
  size?: number;
  className?: string;
}

/**
 * QR del pedido (docs/brand.md "Pantalla QR del repartidor"): blanco puro,
 * módulos en `verde-3`, sin logo superpuesto (rompe la lectura).
 */
export function QrCode({ value, size = 240, className = "" }: QrCodeProps) {
  return (
    <div className={`inline-flex rounded-card bg-blanco p-5 ${className}`}>
      <QRCodeSVG
        value={value}
        size={size}
        bgColor="#FFFFFF"
        fgColor="#12241F"
        level="M"
        marginSize={0}
        title="Código QR del pedido"
      />
    </div>
  );
}
