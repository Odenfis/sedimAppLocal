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

## HTTPS en la red local (Fase 81)

- HTTPS es opcional y convive con HTTP. Se activa con `HTTPS_ENABLED=true` cuando existen `certs/server.crt` y `certs/server.key`, generados con `generar-certificado.bat`. Si faltan o son inválidos, el registro lo indica y la app sigue atendiendo por HTTP.
- `certs/` contiene la clave de la CA local: no se versiona, no entra en la imagen Docker y se respalda junto con `.env`. A los equipos solo se entrega `ca.crt`, desde `/instalar-certificado`.
- La CA dura 10 años y el certificado del servidor 825 días. Para renovarlo o si cambia la IP, ejecute de nuevo `generar-certificado.bat`: reutiliza la CA y no hay que reinstalarla en los equipos.
- El almacenamiento local del navegador (borradores offline) es distinto en `http://IP:PUERTO` y en `https://IP:3443`. Antes de cambiar un equipo de dirección, confirme «Mesas pendientes: 0».

- Con HTTPS, `sw.js` guarda la interfaz en el equipo para que la app abra sin red. Las páginas se piden primero a la red (límite de 4 s) y los recursos versionados se sirven de la caché; las API nunca se guardan. Al publicar una versión, la primera carga con conexión actualiza la copia y borra las versiones anteriores. En HTTP no se registra.

### Prueba en la Mac de desarrollo

1. Consulte la IP de la Mac con `ipconfig getifaddr en0` y genere los certificados con `node scripts/generate-local-certs.js --ip <IP>` (usa el `openssl` de Homebrew). Con Docker, use en su lugar `docker compose run --rm --no-deps -T app node scripts/generate-local-certs.js --ip <IP>`.
2. En `.env` ponga `HTTPS_ENABLED=true` y `HTTPS_PORT=3443`, e inicie la app con `npm start` o `docker compose up -d --build app`. Si macOS pregunta, permita conexiones entrantes a Node o Docker.
3. Con un celular Android en la misma Wi‑Fi, abra `http://<IP>:3000/instalar-certificado` y siga los pasos. La CA de la Mac es solo de prueba: el lunes el servidor del cliente genera la suya.
4. Prueba sin red: con la app abierta por HTTPS y la sesión iniciada, prepare offline, active el modo avión, agregue un producto, fuerce el cierre de Chrome y vuelva a abrir la app. Debe mostrar «sin conexión» y el borrador. Desactive el modo avión y confirme que el pedido se registra una sola vez.
5. Para retirar la prueba del celular: Ajustes → Seguridad → Cifrado y credenciales → Credenciales de usuario → eliminar «SedimApp CA local».

## Estado operativo y activaciones posteriores

- La impresión RPT004 está habilitada en el cliente. Conserve su IP fija, puerto 9100, CP850 y corte configurados; repita una prueba física después de cualquier cambio de red o impresora.
- No configure `MAINTENANCE_PIN_HASH` hasta completar la capacitación y validación de cierres.
- HTTPS local será el paso necesario para instalación PWA completa, cookies seguras y futuras capacidades de service worker.
