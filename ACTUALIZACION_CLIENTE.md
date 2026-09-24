# SedimApp — actualización rutinaria del cliente

Esta es la guía estable para instalar las próximas mejoras en el servidor Windows del restaurante. La carpeta del proyecto, el archivo `.env`, SQL Server y Docker ya están configurados; no se debe volver a clonar el repositorio para una actualización normal.

## Antes de actualizar

- Avise al personal que SedimApp se reiniciará brevemente y procure hacerlo sin pedidos en edición o envíos pendientes.
- Confirme que SQL Server y Docker Desktop estén iniciados.
- No elimine ni reemplace `.env`. Ese archivo contiene la configuración privada del cliente y Git no lo descarga; modifíquelo únicamente cuando una fase indique variables nuevas, como `BAR_PRINTER_*` en la Fase 37.
- No elimine manualmente contenedores o imágenes: el actualizador se encarga de reconstruir lo necesario.

## Procedimiento normal

1. Abra la carpeta de SedimApp en el servidor.
2. Ejecute `actualizar.bat` con doble clic.
3. Espere los tres mensajes: descargar, instalar y comprobar.
4. Cuando aparezca `[OK] SedimApp se actualizo correctamente`, el sistema abrirá `http://localhost:PUERTO`.

No se necesita ejecutar `git pull`, `git clone`, `npm install` ni comandos de Docker manualmente. `actualizar.bat` conserva `.env`, descarga el código, reconstruye la imagen, recrea el contenedor cuando corresponde y espera el healthcheck de aplicación y SQL Server.

## Comprobación posterior

- Inicie sesión y abra una mesa.
- Agregue un producto y confirme que el pedido se guarda.
- Envíe una comanda a Cocina y confirme que aparece en KDS y sale por la impresora.
- Compruebe desde un celular que la dirección `http://IP_FIJA_DEL_SERVIDOR:PUERTO` continúa disponible.

## Configuración que debe permanecer en `.env`

No escriba aquí los valores reales. El archivo privado del cliente debe conservar:

```dotenv
PORT=3000
BIND_ADDRESS=0.0.0.0
SESSION_SECRET=valor_privado_de_32_caracteres_o_mas

DB_USER=valor_privado
DB_PASS=valor_privado
DB_SERVER=host.docker.internal
DB_NAME=valor_privado
DB_POOL_MAX=20
DB_POOL_MIN=2
DB_POOL_IDLE_TIMEOUT_MS=30000
DB_CONNECTION_TIMEOUT_MS=5000
DB_REQUEST_TIMEOUT_MS=10000
SLOW_REQUEST_MS=750

COOKIE_SECURE=false
TRUST_PROXY=false

PRINTER_ENABLED=true
PRINTER_HOST=IP_FIJA_DE_LA_IMPRESORA
PRINTER_PROTOCOL=escpos_tcp
PRINTER_PORT=9100
PRINTER_TIMEOUT_MS=5000
PRINTER_CODEPAGE=cp850
PRINTER_CUT=true

BAR_PRINTER_ENABLED=true
BAR_PRINTER_HOST=192.168.1.180
BAR_PRINTER_PROTOCOL=escpos_tcp
BAR_PRINTER_PORT=9100
BAR_PRINTER_TIMEOUT_MS=5000
BAR_PRINTER_CODEPAGE=cp850
BAR_PRINTER_CUT=true
```

Si `MAINTENANCE_PIN_HASH` permanece vacío, Cierre de Turno seguirá oculto. No cambie esa variable hasta implementar y validar dicha función.

## Si la actualización falla

1. No borre la carpeta, `.env`, imágenes ni contenedores.
2. Tome una foto o copie el mensaje de la ventana.
3. Envíe también el archivo `%TEMP%\sedimapp-actualizacion.log` a soporte si existe.
4. Para diagnóstico, soporte puede ejecutar:

   ```bat
   docker compose ps
   docker compose logs --tail 50 app
   ```

   Si la interfaz muestra una **Referencia**, búsquela sin copiar datos del pedido:

   ```bat
   docker compose logs --since 30m app | findstr REFERENCIA_MOSTRADA
   ```

   Los registros JSON muestran duración total, tiempo SQL y cantidad de consultas. Las entradas `slow_request` superaron el umbral configurado por `SLOW_REQUEST_MS`.

Si solamente se eliminaron las imágenes o el contenedor, vuelva a ejecutar `actualizar.bat`: Compose los reconstruirá. Solo se utiliza `git clone` cuando se ha eliminado por completo la carpeta del proyecto; en ese caso se debe recuperar el `.env` privado antes de iniciar SedimApp.

## Mantenimiento mínimo

- Mantenga una copia segura y fuera del repositorio del `.env` del cliente.
- Mantenga respaldo periódico de SQL Server y verifique que pueda restaurarse.
- Configure Docker Desktop para iniciar con Windows; el contenedor usa `restart: always` una vez que Docker está disponible.
- Mantenga IP fija o reserva DHCP tanto para el servidor como para la impresora.
- No publique el puerto de SedimApp hacia Internet; debe permanecer accesible solamente desde la LAN del restaurante.
## Fase 36 — verificación previa al despliegue

- Buscar `6912435a-d4e2-482d-ba7a-9bbede71995b` en la salida del servicio y capturar los registros `api_error`, `slow_request` y `slow_sql` relacionados.
- Repetir la verificación con el `diagnosticId` mostrado por Mesas en el mismo intervalo y comparar ruta, clasificación, duración SQL y estado del pool.
- Confirmar para el ticket afectado que `Pedido_control`, `Pedido_lineas`, `Cocina_envios`, `Cocina_envio_detalles` y `Cocina_estados` representan el mismo envío antes de aplicar cualquier cambio de datos.
- Ejecutar `npm run check`, `npm test`, `npm run test:ui` y `npm run test:sql` contra la base de validación.
- Validar en Chrome Android físico que tocar el buscador no cambia la cantidad del carrito y que tocar deliberadamente una tarjeta agrega exactamente una unidad.
- Esta fase no contiene migraciones ni cambios de esquema. Cualquier índice adicional deberá aprobarse como una migración nueva y limitada a tablas auxiliares.

## Fase 37 — verificación de Cocina y Barra

- La actualización aplica `008_bar_printing.sql`, que crea solamente `Impresion_linea_rutas` e `Impresion_barra_trabajos`. No altera `Productos`, `Mesas`, `Ticket_c`, `Ticket_d`, `Tablas` ni la cola de Cocina existente.
- Antes de reiniciar, agregue las variables `BAR_PRINTER_*` anteriores al `.env` privado y confirme desde el contenedor acceso TCP a `192.168.1.180:9100`.
- Envíe un pedido solo Cocina, uno solo Barra (`Clinea=7` y `Tipo=3`) y uno mixto. En el mixto deben salir dos papeles con el mismo ticket: cada producto únicamente en su destino.
- Confirme caracteres españoles, papel de 80 mm, corte y reimpresión independiente desde el historial.
- Simule una impresora desconectada y confirme que la otra continúa imprimiendo y que el envío sigue visible en el Kanban.
- No ejecute la purga de un cierre con una imagen anterior de la aplicación. Para rollback conserve los datos auxiliares y restaure primero la versión nueva antes de purgar.
