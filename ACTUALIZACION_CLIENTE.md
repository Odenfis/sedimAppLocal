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
- Antes de reiniciar, agregue las variables `BAR_PRINTER_*` anteriores al `.env` privado. Obtenga primero la IP real mediante el autotest de la RPT004: apáguela, mantenga `FEED`, enciéndala y suelte el botón cuando parpadeen `ERROR` y `PAPER`. No lo mantenga durante 20 segundos porque restauraría la configuración de fábrica.
- Ejecute `diagnosticar-impresora-barra.bat` con doble clic. El asistente prueba por separado Windows, el contenedor, la migración y la cola; después solicita confirmación antes de enviar una prueba física ESC/POS. No instala Node/npm en Windows, no modifica SQL y no muestra el contenido de pedidos.
- `ping` se ejecuta únicamente contra la IP, sin `:9100`. La disponibilidad del puerto se valida con `Test-NetConnection` y desde Docker. Un ping fallido no invalida la impresora si ambas pruebas TCP son exitosas.
- Para diagnóstico manual dentro del contenedor use `docker compose exec app npm run diagnose:bar`. Para emitir el papel técnico use `docker compose exec app npm run diagnose:bar -- --print`.
- `npm run test:sql` no prueba la impresora física. El comando correcto es `docker compose exec app npm run test:sql` y debe ejecutarse fuera de atención contra `tempdb` o una base de validación con permisos para crear un esquema temporal.
- Envíe un pedido solo Cocina, uno solo Barra (`Clinea=7` y `Tipo=3`) y uno mixto. En el mixto deben salir dos papeles con el mismo ticket: cada producto únicamente en su destino.
- Confirme caracteres españoles, papel de 80 mm, corte y reimpresión independiente desde el historial.
- Simule una impresora desconectada y confirme que la otra continúa imprimiendo y que el envío sigue visible en el Kanban.
- No ejecute la purga de un cierre con una imagen anterior de la aplicación. Para rollback conserve los datos auxiliares y restaure primero la versión nueva antes de purgar.

## Fase 48 — pedidos bloqueados y conciliación

- Busque primero cualquier referencia mostrada por la interfaz con `docker compose logs --since 30m app | findstr REFERENCIA`. No copie ni modifique filas manualmente desde SSMS.
- Para diagnosticar una mesa sin escribir datos use `docker compose exec app npm run diagnose:order -- --empresa 2 --mesa NUMERO`. El comando crea un respaldo local excluido de Git y muestra únicamente estado, versión, conteos y hashes.
- Cocina puede completar Preparación, Listo y Entregado después de Preventa aunque el POS local haya procesado `Ticket_c`/`Ticket_d`. Una corrección pendiente o un plato aún no listo continúa bloqueando Entregado por diseño.
- Limpiar o Borrar Comanda conserva el carrito si SQL rechaza la operación. Cuando confirma el borrado, el ticket comercial se elimina atómicamente, la auditoría de Cocina permanece y la mesa vuelve a Libre.
- Si un pedido anterior a Preventa debe seguir editándose y el diagnóstico indica `COMMERCIAL_CONFLICT`, soporte puede restaurar la versión web únicamente después de revisar el respaldo: `docker compose exec app npm run diagnose:order -- --empresa 2 --ticket T001-NNNNNN --apply`. `--apply` no acepta una mesa ni actúa sobre varios pedidos.
- Después de actualizar, valide en este orden: guardar un pedido, enviar a Cocina, generar Preventa, simular el procesamiento del POS local, marcar Todo listo y Entregado, y finalmente limpiar otro pedido confirmando que regresa al mapa con la mesa Libre.

## Fase 50 — correlativo bloqueado por residuo auxiliar

- `Tablas` (`n_codtabla=23`) sigue definiendo el último ticket utilizado. No adelante el correlativo ni elimine filas manualmente desde SSMS.
- Si el siguiente número solo existe como borrador auxiliar nunca enviado, el primer guardado después de actualizar lo archivará con hash y reutilizará exactamente ese número dentro de una sola transacción.
- El log `orphaned_draft_archived` confirma la recuperación e incluye ticket, identificador de archivo, cantidad de líneas y hash, pero no el contenido del pedido.
- Si existe `Ticket_c`, `Ticket_d`, un envío o un estado de Cocina, la aplicación responderá `409 TICKET_SEQUENCE_CONFLICT` y no modificará el residuo ni `Tablas`; entregue la referencia a soporte para revisión individual.
- Para el caso confirmado del cliente, el resultado esperado es crear `T001-251595`, conservar el residuo anterior en `Pedido_residuos_archivo` y dejar `Tablas.c_describe` en `T001-251595`.

## Fase 60 — alerta de Cocina más duradera

- Actualice mediante `actualizar.bat`, recargue el navegador de Cocina y toque **Activar sonido**. No se requieren variables nuevas, dependencias ni migraciones.
- Use **Probar sonido** y ajuste el volumen con los parlantes habituales. El nuevo MP3 se reproduce completo durante aproximadamente 8,33 segundos. La activación sigue siendo manual tras recargar.
- Envíe una comanda y después varias mientras suena: deben aparecer normalmente y generar como máximo una reproducción pendiente. Los envíos durante esa segunda reproducción pueden agruparse en otro aviso. No deben superponerse audios.
- Desactive a mitad de reproducción: debe detenerse y cancelar el aviso pendiente. Reactive y confirme que no reproduce avisos antiguos. Compruebe también impresión y acceso desde los dispositivos habituales.
- Valide con el ruido real de Cocina y registre la aceptación del personal antes de declarar la fase validada físicamente.
- Ante un fallo del MP3 se mantiene la alarma breve de respaldo y se muestra un aviso. Para revertir el cambio, soporte debe restaurar la ruta y el comportamiento anterior, incrementar la versión del script e instalar otra actualización; el MP3 anterior permanece incluido.

## Comprobación de la Fase 61 — Precios Feriado

La actualización aplica automáticamente `013_holiday_prices.sql`. La migración crea configuración e historial auxiliares; no cambia `Productos` ni `Precios`. Las empresas comienzan con Precios Feriado desactivado y Tarifa 1. No se necesitan variables nuevas en `.env`.

1. Abra **Configuraciones**, debajo de **Pedido Cocina**, y seleccione una empresa. Active **Precios Feriado** y confirme el estado guardado y el usuario/fecha del cambio.
2. Compruebe la cobertura: los productos sin importe positivo en la tarifa elegida usan `PventaMa`. Revise la lista desplegable antes de operar. Si falta `Precios` o alguna columna, la activación queda bloqueada y el modo normal sigue disponible.
3. Abra el POS en dos dispositivos. Compruebe el indicador y el precio final de un producto con `PreTema1` positivo, incluyendo el IGV cuando corresponde. Revise también un producto exento y uno sin tarifa.
4. Con un pedido guardado, cambie de tarifa desde el otro dispositivo: las filas anteriores conservan el precio. Agregar desde el catálogo usa la tarifa vigente; **+** y separar unidades conservan el precio de su fila. Compruebe también un ajuste manual en Delivery/Para llevar/plataformas.
5. Pruebe **Otras tarifas**, desactivación, cambio de empresa, recarga y cambio de turno. Si un cambio remoto ocurre antes del guardado, revise el diálogo **Revisar precios actualizados**: cancelar conserva el borrador y aceptar permite guardar las nuevas líneas con los importes revisados.
6. Envíe una comanda, genere Preventa y reabra el pedido. Compruebe que un cambio de configuración no crea envíos de Cocina ni altera una reimpresión. Verifique el unitario, importe y total en el POS contable.

Valide celular/tablet con teclado y los datos reales de las tres empresas. Mantenga la Fase 61 pendiente de validación física y contable hasta registrar la aceptación del cliente.


## Fase 63 — apertura de platos y medición

El cliente confirmó que opera con la versión previa a Precios Feriado (Fase 60). Antes de instalar registre el commit/imagen actual y conserve esa imagen, una copia del código y el respaldo habitual de SQL y `.env`. Esta fase no agrega migraciones; instalar el código actual desde Fase 60 también incorpora la migración y funciones de Fase 61. Compruebe las fases 61–62 por separado y mantenga pendientes sus validaciones físicas/contables.

1. Ejecute `actualizar.bat` y recargue todos los dispositivos. En las herramientas del navegador confirme que se descargó `script.js?v=63`.
2. Compruebe apertura de mesa libre/ocupada, empleado asignado, plataformas y Descarte/obsequios, búsqueda, autoguardado, cambio de empresa, regreso durante carga, Preventa y reapertura. Desde otro dispositivo cambie Precios Feriado mientras carga el catálogo; las líneas existentes y precios manuales deben conservarse.
3. Para medir, soporte abre la consola del navegador y ejecuta `posPerformance.enable()`. La activación persiste solamente en esa sesión de pestaña. Abra mesas durante uso normal; exporte con `posPerformance.export()` o, en Chrome DevTools, `copy(posPerformance.export())`. No se envía telemetría al servidor. Use `posPerformance.clear()` para comenzar otra muestra y `posPerformance.disable()` para detenerla. Una recarga conserva la activación, pero limpia las mediciones en memoria.
4. La exportación contiene hasta 100 aperturas, versión de recurso, empresa, fecha UTC, generación, cantidad de productos, tiempos y referencias HTTP. No guarda nombres, precios, tickets, contenido del carrito, URLs ni credenciales. `startMs` ubica cada petición dentro de la apertura; `responseMs` termina cuando llegan las cabeceras; `jsonMs` incluye lectura del cuerpo y parseo. `renderMs` suma el trabajo síncrono de renderizado del catálogo. `catalogUsableMs` se registra en el siguiente frame con catálogo vigente y pedido editable, empleados conciliados y sin error de carga/asignación. La selección obligatoria inicial de empleado en una mesa especial no se considera un fallo. No acredita que el hardware haya completado la pintura física.
5. Separe resultados `usable`, `readonly`, `cancelled`, `error`, `employees_error` y `catalog_error`. Un catálogo vacío puede estar correctamente cargado; su cantidad será cero. Una categoría fallida no impide usar productos sin filtro. No mezcle cancelaciones o Preventas con el p95 de aperturas utilizables. Calcule p50/p95 por versión, dispositivo y conexión; indique número de muestras y errores. Para p95 ordene los tiempos y use la posición `ceil(0.95 × n)`.
6. Correlacione cada `requestId` con `docker compose logs --since 30m app`. La consulta de empleados ahora se incluye en `sqlCount/sqlMs`. `sqlMs` mide la operación observada por el controlador, incluyendo posibles esperas; el estado del pool es una instantánea al terminar. No atribuya esos tiempos exclusivamente a ejecución SQL ni use `responseMs - sqlMs` como latencia de red.

Recoja muestras durante 30 minutos de atención normal y en hora punta, con hasta diez dispositivos habituales, sin carga artificial. Como el búfer es de 100 aperturas, exporte por bloques antes de que se reemplacen las más antiguas. Compare servidor, equipo por cable y tablet por Wi-Fi; de ser posible use el mismo portátil por cable y Wi-Fi. En un registro separado anote commit/imagen, cantidad de productos, modelo, navegador, tipo de conexión y franja horaria de Lima. La meta pendiente es p95 ≤ 1,5 s con diez dispositivos y sin errores inesperados ni cambios comerciales.

Para la línea base de Fase 60, que aún no tiene `posPerformance`, use una grabación de Performance/Network del navegador desde el toque en la mesa hasta el catálogo utilizable. Compare también el código previo a Fase 63 con Fase 63, manteniendo el mismo catálogo y estado de Precios Feriado; así se separa el efecto de la nueva tarifa del de la paralelización. Las pruebas automatizadas usan API simulada y no demuestran capacidad del servidor o Wi-Fi reales.

Ante regresión, soporte restaura la imagen/código conservados y recarga los navegadores. No elimine tablas auxiliares ni revierta migraciones comerciales manualmente; documente qué versión vuelve a operar. No declare desplegada/validada la fase hasta registrar los resultados y aceptación del cliente.
