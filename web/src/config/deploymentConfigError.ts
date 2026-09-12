/**
 * `DeploymentConfigError` vive en su propio módulo, SIN dependencias (ni
 * `zod` ni `viem`), a propósito: el error boundary de raíz
 * (`src/lib/ui/components/ErrorBoundary.tsx`) se importa de forma NO
 * perezosa desde `App.tsx` (tiene que estar listo para atrapar errores de
 * cualquier ruta), así que cualquier import estático que arrastre no puede
 * quedar fuera del chunk inicial. Si este error se definiera en
 * `config/deployment.ts` (que sí importa `zod` y `viem/chains` a nivel de
 * módulo), el boundary arrastraría esas dependencias al bundle inicial de
 * `/` y anularía el lazy-loading por ruta (ver ALTO 2 del brief).
 *
 * `config/deployment.ts` re-exporta esta clase para que el resto del código
 * la siga importando desde ahí sin saber de este detalle.
 */
export class DeploymentConfigError extends Error {
  constructor(public readonly issues: string) {
    super(
      `Configuración de deployment inválida o incompleta (revisá web/.env.local contra .env.example): ${issues}`,
    );
    this.name = "DeploymentConfigError";
  }
}
