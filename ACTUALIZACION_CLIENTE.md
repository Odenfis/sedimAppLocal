# SedimApp — actualización rutinaria del cliente

Esta es la guía estable para instalar las próximas mejoras en el servidor Windows del restaurante. La carpeta del proyecto, el archivo `.env`, SQL Server y Docker ya están configurados; no se debe volver a clonar el repositorio para una actualización normal.

## Antes de actualizar

- Avise al personal que SedimApp se reiniciará brevemente y procure hacerlo sin pedidos en edición o envíos pendientes.
- Confirme que SQL Server y Docker Desktop estén iniciados.
- No modifique, elimine ni reemplace `.env`. Ese archivo contiene la configuración privada del cliente y Git no lo descarga.
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

COOKIE_SECURE=false
TRUST_PROXY=false

PRINTER_ENABLED=true
PRINTER_HOST=IP_FIJA_DE_LA_IMPRESORA
PRINTER_PROTOCOL=escpos_tcp
PRINTER_PORT=9100
PRINTER_TIMEOUT_MS=5000
PRINTER_CODEPAGE=cp850
PRINTER_CUT=true
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

Si solamente se eliminaron las imágenes o el contenedor, vuelva a ejecutar `actualizar.bat`: Compose los reconstruirá. Solo se utiliza `git clone` cuando se ha eliminado por completo la carpeta del proyecto; en ese caso se debe recuperar el `.env` privado antes de iniciar SedimApp.

## Mantenimiento mínimo

- Mantenga una copia segura y fuera del repositorio del `.env` del cliente.
- Mantenga respaldo periódico de SQL Server y verifique que pueda restaurarse.
- Configure Docker Desktop para iniciar con Windows; el contenedor usa `restart: always` una vez que Docker está disponible.
- Mantenga IP fija o reserva DHCP tanto para el servidor como para la impresora.
- No publique el puerto de SedimApp hacia Internet; debe permanecer accesible solamente desde la LAN del restaurante.
