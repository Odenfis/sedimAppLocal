# SedimApp — puesta en producción y operación

Para las actualizaciones normales de la instalación que ya está funcionando, utilice [ACTUALIZACION_CLIENTE.md](ACTUALIZACION_CLIENTE.md).

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
  PRINTER_ENABLED=true
  PRINTER_HOST=IP_FIJA_DE_LA_IMPRESORA
  BAR_PRINTER_ENABLED=true
  BAR_PRINTER_HOST=192.168.1.180
  BAR_PRINTER_PROTOCOL=escpos_tcp
  BAR_PRINTER_PORT=9100
  BAR_PRINTER_TIMEOUT_MS=5000
  BAR_PRINTER_CODEPAGE=cp850
  BAR_PRINTER_CUT=true
  MAINTENANCE_PIN_HASH=
  ```

- Genere un secreto propio de 32 caracteres o más desde PowerShell y copie solamente el resultado en `SESSION_SECRET`:

  ```powershell
  $b=New-Object byte[] 48; $r=[Security.Cryptography.RandomNumberGenerator]::Create(); $r.GetBytes($b); [Convert]::ToBase64String($b)
  ```

No copie `.env.example` encima de un `.env` existente y nunca suba `.env` a Git.

## Actualización

1. Ejecute `actualizar.bat`.
2. El archivo descarga la última versión, reconstruye el contenedor y comprueba automáticamente que SedimApp responda.
3. Al terminar correctamente abre la aplicación en el navegador. No requiere escribir confirmaciones ni muestra el catálogo de SQL Server.
4. Si falla, copie el mensaje mostrado. El diagnóstico ampliado se obtiene con `docker compose logs --tail 50 app`.

El respaldo y una ventana sin atención siguen siendo recomendaciones operativas antes de publicar cambios importantes, pero ya no forman parte del actualizador cotidiano. El preflight completo queda disponible para soporte mediante `npm run preflight:phase22` y no se ejecuta automáticamente.

## Prueba rápida obligatoria

- Para Barra, ejecute primero `diagnosticar-impresora-barra.bat`. Este archivo comprueba TCP 9100 desde Windows y Docker, configuración, migración y cola, y pide confirmación antes de imprimir una hoja técnica.
- Iniciar y cerrar sesión.
- Seleccionar cada empresa y turno; abrir una mesa libre.
- Agregar un producto y confirmar autoguardado desde otro dispositivo.
- En un pedido de prueba, agregar dos unidades de un producto afecto con precio base S/20.00 y confirmar en SQL que `Ticket_d` registra `Cantidad=2`, `Precio=44.20` e `Importe=44.20` con IGV de 10.5%. No ejecutar actualizaciones sobre tickets históricos.
- Enviar a Cocina y comprobar que aparece en KDS y que la impresora emite una sola comanda.
- Cambiar el plato a preparación, listo y entregado.
- Generar y reabrir una preventa.
- Borrar un pedido de prueba y confirmar que la mesa vuelve a libre.
- Reiniciar el contenedor y verificar que la sesión continúa vigente.
- Confirmar que la reimpresión funciona y que Cierre de Turno no aparece mientras `MAINTENANCE_PIN_HASH` esté vacío.

## Celulares y tablets

Abra `http://IP_DEL_SERVIDOR:PUERTO` desde la Wi-Fi interna.

- iPhone/iPad: menú Compartir → **Agregar a pantalla de inicio** → activar **Abrir como app** cuando esté disponible.
- Android: menú del navegador → **Agregar a pantalla principal** o **Instalar app**, según lo que ofrezca el navegador.
- Por usar una IP HTTP, Android puede crear un acceso directo en vez de una PWA completa. La operación POS sigue requiriendo conexión a la LAN; no existe guardado offline.

## Estado operativo y activaciones posteriores

- La impresión RPT004 está habilitada en el cliente. Conserve su IP fija, puerto 9100, CP850 y corte configurados; repita una prueba física después de cualquier cambio de red o impresora.
- No configure `MAINTENANCE_PIN_HASH` hasta completar la capacitación y validación de cierres.
- HTTPS local será el paso necesario para instalación PWA completa, cookies seguras y futuras capacidades de service worker.
