# SedimApp v1 — Puesta en producción

## Antes del corte

1. En SSMS, genere y verifique un respaldo completo de la base de datos.
2. Cierre la atención y confirme que no queden pedidos activos ni cambios pendientes en Cocina.
3. Confirme que el servidor tenga IP fija o reserva DHCP y que el puerto publicado esté permitido únicamente en la red privada.
4. En esta primera actualización, abra una consola en la carpeta del proyecto y ejecute:

   ```bat
   git pull --ff-only
   ```

   Esto instala primero la versión segura de `actualizar.bat`; las siguientes actualizaciones se hacen directamente con el archivo.

## Configuración `.env` para v1

- Conserve los valores reales `DB_USER`, `DB_PASS`, `DB_SERVER` y `DB_NAME`.
- Dentro del contenedor, SQL Server instalado en la misma máquina normalmente se configura como `DB_SERVER=host.docker.internal`.
- Mantenga obligatoriamente:

  ```dotenv
  BIND_ADDRESS=0.0.0.0
  COOKIE_SECURE=false
  TRUST_PROXY=false
  PRINTER_ENABLED=false
  MAINTENANCE_PIN_HASH=
  ```

- Genere un secreto propio de 32 caracteres o más desde PowerShell y copie solamente el resultado en `SESSION_SECRET`:

  ```powershell
  $b=New-Object byte[] 48; $r=[Security.Cryptography.RandomNumberGenerator]::Create(); $r.GetBytes($b); [Convert]::ToBase64String($b)
  ```

No copie `.env.example` encima de un `.env` existente y nunca suba `.env` a Git.

## Actualización

1. Ejecute `actualizar.bat`.
2. Escriba `RESPALDO` únicamente después de confirmar respaldo y ventana sin pedidos.
3. El proceso construye la imagen nueva sin detener la actual. El preflight de BD es de solo lectura y aborta si detecta pedidos Guardados/Preventa; después levanta la versión y espera el healthcheck.
4. Si la versión nueva no queda saludable, el script restaura la imagen anterior. Las migraciones aplicadas se conservan porque son aditivas.
5. La imagen aprobada también queda etiquetada como `sedim-app:COMMIT`, permitiendo identificar exactamente el código instalado.
6. Guarde la salida de `docker compose ps` y, ante un fallo, de `docker compose logs app`.

## Prueba rápida obligatoria

- Iniciar y cerrar sesión.
- Seleccionar cada empresa y turno; abrir una mesa libre.
- Agregar un producto y confirmar autoguardado desde otro dispositivo.
- Enviar a Cocina y comprobar que aparece en KDS sin crear ni transmitir impresión.
- Cambiar el plato a preparación, listo y entregado.
- Generar y reabrir una preventa.
- Borrar un pedido de prueba y confirmar que la mesa vuelve a libre.
- Reiniciar el contenedor y verificar que la sesión continúa vigente.
- Confirmar que Cierre de Turno y los botones de impresión no aparecen.

## Celulares y tablets

Abra `http://IP_DEL_SERVIDOR:PUERTO` desde la Wi-Fi interna.

- iPhone/iPad: menú Compartir → **Agregar a pantalla de inicio** → activar **Abrir como app** cuando esté disponible.
- Android: menú del navegador → **Agregar a pantalla principal** o **Instalar app**, según lo que ofrezca el navegador.
- Por usar una IP HTTP, Android puede crear un acceso directo en vez de una PWA completa. La operación POS sigue requiriendo conexión a la LAN; no existe guardado offline.

## Activaciones posteriores

- No habilite `PRINTER_ENABLED=true` hasta validar físicamente IP, puerto 9100, CP850, ancho, corte y condiciones sin papel de la RPT004.
- No configure `MAINTENANCE_PIN_HASH` hasta completar la capacitación y validación de cierres.
- HTTPS local será el paso necesario para instalación PWA completa, cookies seguras y futuras capacidades de service worker.
