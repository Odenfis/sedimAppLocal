# SedimApp - Roadmap del Proyecto

## Descripción
Sistema de gestión para restaurantes con módulos de POS (Punto de Venta) y Administración de Usuarios.

---

## Fase 1: Configuración Inicial (Completada)
- Estructura básica Express.js + SQL Server
- Sistema de autenticación con sesiones
- Módulos originales: Equipos, Herramientas, Operaciones, Auditoria, Reportes, POS, Usuarios

---

## Fase 2: Limpieza y Modernización del POS (Completada)

### 2.1 Limpieza de Código
- **server.js**: Eliminados módulos no utilizados (Equipos, Herramientas, Operaciones, Auditoria, Reportes, Usuarios)
- **dashboard.html**: Sidebar reducido a solo "POS Ventas" + nombre de usuario
- **script.js**: Eliminadas funciones obsoletas y código orphaned

### 2.2 Segmentación por Empresa
- Filtro de mesas por empresa: `02` (Cocinería), `04` (Mar Picante 1), `06` (Inversiones Abruzzo SAC)
- Filtro de productos por prefijo de código (`CodPro LIKE '02%'`)
- Selector de empresa en vista de mapas de mesas

### 2.3 Filtro de Pisos (Ambiente)
- Botones dinámicos para cada piso basado en campo `Ambiente` de la tabla `Mesas`
- Renderizado de tarjetas de mesas con estados

### 2.4 Categorías Dinámicas
- Endpoint `/api/pos/categories` que consulta la tabla `Lineas`
- Botón "Todos" para mostrar todos los productos sin filtro

---

## Fase 3: Gestión de Estados de Mesas (Completada Mayo 2026)

### 3.1 Mapeo de Estados de Mesa
| Estado | Descripción |
|--------|-------------|
| 1 | Libre |
| 2 | Ocupada |
| 3 | Reservada |
| 4 | Unida |
| 5 | Preventa |
| 6 | No disponible |

### 3.2 Estados de Ticket (Tabla Tablas n_codtabla = 535)
| Estado | Descripción | Uso |
|--------|-------------|-----|
| 1 | Guardada | Al guardar pedido |
| 2 | Preventa | Al pagar (Pagar Ahora) |
| 3 | En Documento | No usado en este módulo |
| 4 | Cancelado | No usado en este módulo |

### 3.3 Funcionalidades de Estado
- **Botón "Guardar"**: Cambia Ticket_c.Estado = 1 (Guardada), Mesa = Ocupada (2)
- **Botón "Generar Preventa"**: Cambia Ticket_c.Estado = 2 (Preventa), Mesa = Preventa (5)
- **Botón "Borrar Comanda"**: Elimina Ticket_d y Ticket_c, Mesa = Libre (1)
- **Botón "Reservar"**: Mesa = Reservada (3), sin afectar tickets
- **Botón "Liberar"**: Solo libera si mesa está Reservada (3)

---

## Fase 4: Sistema de Tickets (Completada Mayo 2026)

### 4.1 Correlativos por Empresa (Tabla Tablas n_codtabla = 23)
| Empresa | n_numero | Prefijo Ticket | Descripción |
|---------|----------|---------------|-------------|
| 02 | 1 | T001- | Cocinería |
| 04 | 2 | T002- | Mar Picante 1 |
| 06 | 5 | T005- | Inversiones Abruzzo SAC |

### 4.2 Endpoints de Tickets
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/pos/pedido?mesa=X&empresa=Y` | Obtener pedido con filtro dinámico por prefijo |
| POST | `/api/pos/pedido` | Crear/actualizar pedido (Estado=1) |
| PUT | `/api/pos/pedido/:nro/pagar` | Cambiar a Estado=2 (Preventa) |
| DELETE | `/api/pos/comanda/:nro?empresa=Y` | Eliminar ticket sin afectar correlativos |

### 4.3 Filtrado por Empresa
- Endpoint `/api/pos/pedido` obtiene el prefijo dinámico desde Tablas
- Filtra por: `NroMesa = @mesa AND NroTicket LIKE @prefijo + '%' AND Estado IN (1, 2)`
- Incluye tickets en Estado=2 (Preventa) para modo visualización
- Esto evita que se muestren pedidos de otras empresas con misma mesa

---

## Fase 5: Migración a Nueva Tabla Usuarios (Completada Mayo 2026)

### 5.1 Tabla Usuarios (SQL Server)
```sql
CREATE TABLE [dbo].[Usuarios] (
    [Usuario]  NVARCHAR (50) NOT NULL,
    [Password] NVARCHAR (4)  NULL,
    CONSTRAINT [PK_Usuarios] PRIMARY KEY CLUSTERED ([Usuario] ASC)
);
```

### 5.2 Sistema de Encriptación
**Método de encriptación (ASCII - posición):**
```
Ejemplo: Password "1988" → Hash "2;;<"
- Posición 1: '1' (49) + 1 = 50 → '2'
- Posición 2: '9' (57) + 2 = 59 → ';'
- Posición 3: '8' (56) + 3 = 59 → ';'
- Posición 4: '8' (56) + 4 = 60 → '<'
```

**Funciones en server.js:**
```javascript
function desencriptarPassword(hash) {
    // ASCII(carácter) - posición
    // "2;;<" → "1988"
}

function encriptarPassword(password) {
    // ASCII(dígito) + posición
    // "1988" → "2;;<"
}
```

### 5.3 Cambios en Login
- Consulta tabla `Usuarios` (no `usuariosweb`)
- Desencripta password guardado y compara con password ingresado
- Todos los usuarios tienen acceso completo al sistema
- Sesión: `{ usuario: "Administrador" }`

### 5.4 Módulo Usuarios Eliminado
- Eliminados endpoints `/api/users`, `/api/roles`
- Eliminada vista "Usuarios del Sistema" del frontend
- Agregado nombre de usuario en sidebar con formato Title Case

---

## Fase 6: Campos Adicionales en Ticket_c (Completada Mayo 2026)

### 6.1 Columna Usuario
- Al guardar pedido: `Ticket_c.Usuario = req.session.user.usuario`
- Valor exactp de la columna `Usuario` en tabla `Usuarios`

### 6.2 Endpoints Modificados
| Endpoint | Cambio |
|----------|--------|
| POST `/api/pos/pedido` | INSERT/UPDATE incluye columna `Usuario` |
| POST `/api/pos/ticket` | Incluye columna `Usuario` desde sesión |

---

## Fase 7: Preventa y Modo Visualización (Completada Mayo 2026)

### 7.1 Generar Preventa
- Botón "PAGAR AHORA" renombrado a **"GENERAR PREVENTA"**
- Al presionar: Ticket_c.Estado = 2 (Preventa), Mesa.Estado = 5 (Preventa)
- La mesa se marca como Preventa visualmente (color rosado)

### 7.2 Modo Visualización Preventa (Solo Lectura)
- Al hacer clic en una mesa con Estado = 5 (Preventa), se carga el pedido en modo **solo lectura**
- Se muestra un badge **"PREVENTA - Solo Visualización"** en el header
- El botón GENERAR PREVENTA se reemplaza por **"PREVENTA REALIZADA"** (deshabilitado, gris)
- Botón Borrar Comanda → deshabilitado
- Botones Guardar / Reservar / Liberar → deshabilitados
- Input de comensales → readonly
- Selector de mozo → sin interacción
- Se oculta la sección de productos (búsqueda, categorías, grilla)
- Items del carrito se muestran sin botones +/- ni eliminar
- Botones Cortesía y Descuento → deshabilitados
- Botón Limpiar → deshabilitado

### 7.3 Reabrir Pedido
- Desde el modo visualización preventa, botón **"Reabrir Pedido"** (color ámbar)
- Al presionar: Ticket_c.Estado = 1 (Guardada), Mesa.Estado = 2 (Ocupada)
- La vista se recarga automáticamente en modo edición normal
- Validación: solo permite reabrir tickets en Estado = 2 (Preventa)

### 7.4 Endpoints Modificados/Agregados
| Endpoint | Cambio |
|----------|--------|
| PUT `/api/pos/pedido/:nro/pagar` | Mesa.Estado = 1 → Mesa.Estado = 5 (Preventa) |
| GET `/api/pos/pedido?mesa=X&empresa=Y` | Ahora busca Estado IN (1, 2) para cargar pedidos en preventa |
| PUT `/api/pos/pedido/:nro/reabrir` | **Nuevo**: Vuelve Ticket_c a Estado=1 y Mesa a Estado=2 |

---

## Fase 8: UI/UX Enhancements (Completada Mayo 2026)

### 8.1 Header de POS Reorganizado
- Header dividido en **2 filas**: info principal arriba, acciones abajo
- Fila 1: Back + título | Badge PREVENTA (centrado) | Timer
- Fila 2: Mozo + Comensales | Botones de estado (Guardar, Reservar, Borrar, Liberar, Reabrir)
- Divisor visual entre filas para mejor jerarquía

### 8.2 Buscador de Productos Mejorado
- Al abrir una mesa, se **resetea** el texto de búsqueda y la categoría activa
- Icono de lupa (FontAwesome) dentro del input vía `::before`
- Focus con `box-shadow` ring (antes solo `border-color`)
- Padding izquierdo para no montar texto sobre el icono
- Transición suave en focus

### 8.3 Modal de Mozo Pulido
- **Bug corregido**: CSS usaba `.mojo-option` (con j) pero JS creaba `.mozo-option` (con z) — estilos nunca se aplicaban
- Icono circular con fondo azul `#667eea` en cada mozo
- Hover con `translateX(4px)` para feedback visual
- Estado **selected** resaltado con fondo azul claro y font-weight 700
- Cierre del modal al hacer clic fuera del contenido
- `loadMozos()` ahora resetea el mozo activo al cambiar de empresa

### 8.4 Corrección de Bugs

#### Bug: Liberar mesa reservada
**Problema**: El endpoint `PUT /api/pos/tables/:numero/liberar-reservada` tenía nombres de parámetros incorrectos:
```js
// Bug: inputs como 'num'/'emp' pero query esperaba @numero/@empresa
.input('num', sql.Int, numero)
.input('emp', sql.Int, empresa)
```
**Fix**: `server.js:127` — cambiado a `input('numero', ...)` e `input('empresa', ...)` para coincidir con la consulta SQL.

#### Bug: CSS typo en mozo modal
**Problema**: Selectores CSS `.mojo-option`, `.mojo-list-container` (con j) no coincidían con las clases usadas en JS/HTML `.mozo-option`, `.mozo-list-container` (con z).
**Fix**: Renombrados todos los selectores CSS a `.mozo-*`.

#### Bug: Buscador de productos persistente
**Problema**: Al cambiar de mesa, el texto de búsqueda y categoría activa no se limpiaban.
**Fix**: En `openPOSOrder()`, se resetea `posSearchTerm`, `posCurrentCategory`, el input y los botones de categoría.

---

## Estructura de Archivos

```
sedimApp_local/
├── server.js              # Backend Express
├── db.js                  # Configuración SQL Server
├── migrate.js             # Migraciones automáticas de esquema
├── Dockerfile             # Imagen Node 22 slim
├── docker-compose.yml     # Orquestación (extra_hosts → host DB)
├── actualizar.bat         # Actualización automática del cliente
├── ACTUALIZACION_CLIENTE.md # Guía operativa de futuras mejoras
├── .env.example           # Plantilla de configuración
├── ROADMAP.md             # Este archivo
├── migrations/
│   └── *.sql              # Migraciones numeradas
└── public/
    ├── login.html         # Página de login
    ├── dashboard.html     # Panel principal
    ├── script.js          # Lógica frontend
    └── style.css          # Estilos
```

---

## Endpoints API (Actualizado Agosto 2026)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/login` | Autenticación con tabla Usuarios |
| POST | `/api/logout` | Cerrar sesión |
| GET | `/api/session` | Verificar sesión activa |
| GET | `/api/users?q=X` | Listar usuarios (autocomplete login) |
| GET | `/api/events` | Stream SSE para actualizaciones en tiempo real |
| GET | `/api/pos/tables?empresa=X` | Listar mesas por empresa |
| PUT | `/api/pos/tables/:numero/estado` | Actualizar estado de mesa |
| PUT | `/api/pos/tables/:numero/liberar-reservada` | Liberar solo mesas reservadas |
| GET | `/api/pos/pedido?mesa=X&empresa=Y` | Obtener pedido (Estado 1 o 2) |
| POST | `/api/pos/pedido` | Crear/actualizar pedido (body: `turno`) |
| PUT | `/api/pos/pedido/:nro/pagar` | Cambiar a Estado=2 (Preventa) |
| PUT | `/api/pos/pedido/:nro/reabrir` | Reabrir preventa (Estado=1, Mesa=2) |
| DELETE | `/api/pos/comanda/:nro?empresa=Y` | Eliminar ticket completo |
| GET | `/api/pos/mozos?empresa=X` | Listar mozos por empresa |
| GET | `/api/pos/categories?empresa=X` | Listar categorías dinámicas |
| GET | `/api/pos/products?empresa=X` | Listar productos por empresa |
| GET | `/api/pos/config` | Configuración POS (IGV Igvv desde tabla Valores) |
| POST | `/api/pos/ticket` | Crear ticket directo (body: `turno`, `mozo`). Estado=2 (Preventa) |
| GET | `/api/cocina/pedidos?empresa=X` | Tablero cocina: comandas activas con estados por plato |
| PUT | `/api/cocina/linea` | Cambiar estado de un plato (1=Pendiente 2=Preparación 3=Listo) |
| PUT | `/api/cocina/ticket/:nro/todo-listo` | Marcar todos los platos del ticket como listos |
| PUT | `/api/cocina/ticket/:nro/entregado` | Marcar ticket entregado (sale del tablero) |

---

## Funcionalidades Implementadas (Agosto 2026 - v2.3)

### POS de Ventas
- [x] Mapa de mesas por empresa
- [x] Filtro por pisos (Ambiente)
- [x] Estados visuales de mesas (6 estados)
- [x] Categorías y productos dinámicos
- [x] Buscador de productos con lupa y focus ring
- [x] Carrito de compras
- [x] Selección de mozo con modal pulido
- [x] Guardar pedido (Estado=1)
- [x] Generar Preventa (Estado=2) + Mesa Preventa (Estado=5)
- [x] Modo visualización Preventa (solo lectura con badge)
- [x] Reabrir pedido desde preventa
- [x] Borrar comanda
- [x] Reservar mesa
- [x] Liberar mesa (solo reservadas)
- [x] Timer de pedido
- [x] Header de 2 filas (info + acciones)
- [x] **IGV dinámico en detalle de pedido** — cálculo por producto usando `Igvv` de tabla `Valores`, solo para productos con `Afecto=1`
- [x] **Actualización en tiempo real (SSE)** — estados de mesas se sincronizan entre dispositivos
- [x] **Guardado automático de pedidos** — al agregar/quitar productos se guarda en BD con debounce de 700ms, mesa → Ocupada
- [x] **Precios con IGV incluido** — tarjetas muestran el precio final (inc. IGV) y TOTAL = suma directa del detalle a 2 decimales
- [x] **Adaptación Responsive móvil/tablet** — bottom-sheet de carrito en celular, botones solo-icono, breakpoints 480/1024px (Fase 19)
- [x] **Pedido Cocina (KDS)** — tablero Kanban en tiempo real, estados por plato, semáforo de demora, sonido, chips por categoría (Fase 21)

### Autenticación
- [x] Login con tabla Usuarios
- [x] Desencriptación de passwords
- [x] Nombre de usuario en sidebar
- [x] Sesiones con express-session
- [x] Autocomplete de usuarios en login

### Turnos
- [x] Selector Mañana / Tarde-Noche en UI
- [x] Mapping empresa→turno (Cocinera, Mar Picante 1, Abruzzo)
- [x] Validación combinada empresa + turno para cargar mesas
- [x] Envío de turno en guardar pedido y preventa

### Corrección de Bugs
- [x] Liberar mesa: parámetros SQL corregidos
- [x] CSS mozo: typo `.mojo` → `.mozo`
- [x] Buscador: reseteo al cambiar de mesa
- [x] Preventa: variable `@user` faltante en `POST /api/pos/ticket`
- [x] Preventa: `mozo` como string en columna INT
- [x] Preventa: rollback EABORT ocultaba errores reales
- [x] Preventa: parámetros dinámicos con espacios (EINJECT)
- [x] Preventa: Estado=1 en lugar de Estado=2
- [x] Preventa: respuestas de fetch sin verificar

---

## Fase 9: Sistema de Turnos (Completada Junio 2026)

### 9.1 Selector de Turno en UI
- Agregado toggle **Mañana / Tarde-Noche** en el panel de filtros (`pos-area-filters`)
- Ambos selectores (Empresa + Turno) deben estar seleccionados para cargar las mesas
- El turno se persiste en `posCurrentTurnoLabel` durante la sesión del pedido

### 9.2 Mapping Empresa → Turno
| Empresa | Mañana | Tarde-Noche |
|---------|--------|-------------|
| Cocinera (02) | Turno 2 | Turno 1 |
| Mar Picante 1 (04) | Turno 1 | Turno 2 |
| Inversiones Abruzzo SAC (06) | Turno 1 | Turno 1 |

### 9.3 Cambios en Frontend (`script.js`)
- **Nueva variable**: `posCurrentTurnoLabel` (inicia `null`)
- **Nuevas funciones**:
  - `getTurnoValue(empresa, label)` → mapping con `parseInt(empresa)` para soportar número o string
  - `selectTurno(label)` → actualiza UI y dispara carga de mesas
  - `onEmpresaOrTurnoChange()` → valida ambos selectores antes de cargar
- **`loadPOSTables()`**: Validación combinada empresa + turno con mensajes específicos
- **`guardarMesa()`**: Envía `turno: getTurnoValue(...)` en el POST body
- **`processPOSPayment()`**: Envía `turno` y `mozo` en el POST a `/api/pos/ticket`

### 9.4 Cambios en Backend (`server.js`)
- **POST `/api/pos/pedido`**: Acepta `turno` del body, usa `@turno` parametrizado (`sql.Int`)
- **POST `/api/pos/ticket`**: Acepta `turno` del body, usa `@turno` parametrizado (`sql.Int`)

### 9.5 Estilos CSS
- Agregados estilos para `.pos-turno-group`, `.turno-toggle`, `.turno-btn`, `.turno-btn.active`
- Toggle visual consistente con el diseño actual (borde, colores, hover)

---

## Fase 10: Corrección de Bugs en Preventa (Completada Junio 2026)

### 10.1 Bug: Variable `@user` no declarada
**Problema**: El endpoint `POST /api/pos/ticket` usaba `@user` en la query SQL pero no tenía `.input('user', ...)` correspondiente.
**Fix**: Agregado `.input('user', sql.NVarChar, usuarioSesion)` en `server.js:469`.

### 10.2 Bug: `Mozo` como VARCHAR en columna INT
**Problema**: El endpoint `POST /api/pos/ticket` enviaba `usuarioSesion` (string) como `@mozo` con tipo `sql.VarChar`, pero la columna `Mozo` en `Ticket_c` es `INT`. SQL Server lanzaba error de conversión.
**Fix**: Cambiado a `.input('mozo', sql.Int, mozoCod)` con `parseInt(mozo) || 1`, y agregado campo `mozo` en el body desde el frontend.

### 10.3 Bug: Rollback sobre transacción abortada (EABORT)
**Problema**: Cuando un SQL error abortaba la transacción, `transaction.rollback()` lanzaba EABORT, opacando el error original.
**Fix**: Envuelto `rollback()` en try-catch: `try { await transaction.rollback(); } catch (rb) {}`.

### 10.4 Bug: Parámetros dinámicos con espacios (EINJECT)
**Problema**: `codPro` es `CHAR(10)` con espacios al final (ej: `'020807    '`). El nombre de parámetro `@cod_020807    ` activaba la protección anti-SQL injection de `mssql` v12.
**Fix**: Agregado `.trim()` al `codPro` para nombres de parámetros: `const cp = item.codPro.trim()`.

### 10.5 Bug: Preventa directa con Estado=1
**Problema**: `POST /api/pos/ticket` creaba el ticket con `Estado=1` (guardado) en lugar de `Estado=2` (preventa). La mesa cambiaba a preventa (5) pero el ticket no entraba en modo solo lectura.
**Fix**: Cambiado `1` → `2` en la query INSERT de `Ticket_c.Estado`.

### 10.6 Mejora: Verificación de respuestas en `processPOSPayment`
**Problema**: `processPOSPayment()` no verificaba `res.ok` en los fetch. Si el servidor devolvía error, igual mostraba "Preventa generada con éxito" y limpiaba todo.
**Fix**: Agregadas verificaciones `if (!res.ok)` con `return alert()` temprano en ambos caminos (PUT pagar y POST ticket).

---

## Fase 11: Infraestructura y Despliegue Híbrido (Junio 2026)

### 11.1 Dockerización (App)
- Implementación de `Dockerfile` basado en `node:20-slim`
- Configuración de `docker-compose.yml` para despliegue rápido
- Creación de `.dockerignore` para optimizar imágenes
- Externalización de configuración mediante `.env` y `.env.example`

### 11.2 Sistema de Migraciones de Base de Datos
- Implementación de `migrate.js` para automatizar cambios de esquema
- Creación de tabla `Migrations` en SQL Server para control de versiones
- Integración de migraciones en el arranque del servidor (`server.js`)
- Flujo de trabajo basado en archivos `.sql` numerados en `/migrations`

### 11.3 Estrategia de Despliegue Híbrido
- **App**: Ejecutada en contenedores Docker para garantizar paridad de entornos.
- **DB**: Mantenida externamente en el servidor del cliente para compatibilidad con SSMS y datos actualizados.
- **Sincronización**: Actualización automática de esquemas via Docker $\rightarrow$ SQL Server.

---

## Fase 12: Tiempo Real con Server-Sent Events (Completada Agosto 2026)

### 12.1 Problema
En entorno multi-dispositivo, los estados de mesas y tickets solo se actualizaban al recargar la página manualmente. Si el Usuario A ponía una mesa en preventa, el Usuario B no lo veía hasta hacer refresh.

### 12.2 Solución: Server-Sent Events (SSE)
Se implementó un sistema de notificaciones unidireccionales (servidor → cliente) usando la API nativa `EventSource` del navegador. **Cero dependencias nuevas** — solo se agregó código aditivo.

### 12.3 Backend (`server.js`)

#### Endpoint SSE
| Método | Endpoint | Auth | Descripción |
|--------|----------|------|-------------|
| GET | `/api/events` |.isAuthenticated| Stream SSE con heartbeat cada 30s |

- Conexiones almacenadas en `Set` de respuestas activas
- Limpieza automática al cerrar pestaña/desconexión del cliente
- Header `X-Accel-Buffering: no` para compatibilidad con proxies/reverse proxies

#### Función `broadcastSSE(event)`
Envía eventos JSON a todos los clientes conectados. Se invoca en 6 endpoints que modifican estado:

| Endpoint | Evento emitido |
|----------|----------------|
| PUT `/api/pos/tables/:numero/estado` | `mesa_updated` |
| PUT `/api/pos/tables/:numero/liberar-reservada` | `mesa_updated` |
| POST `/api/pos/pedido` (guardar) | `mesa_updated` |
| PUT `/api/pos/pedido/:nro/pagar` | `mesa_updated` |
| PUT `/api/pos/pedido/:nro/reabrir` | `mesa_updated` |
| DELETE `/api/pos/comanda/:nro` | `mesa_updated` |
| POST `/api/pos/ticket` | `mesa_updated` |

### 12.4 Frontend (`script.js`)

#### `connectSSE()`
- Abre `EventSource` a `/api/events` al cargar la página
- Reconexión automática cada 3s si se pierde la conexión
- Heartbeat del servidor mantiene la conexión viva (30s)

#### `handleSSEEvent(data)`
Al recibir un evento `mesa_updated`:
1. **Si estás en el mapa de mesas** de la misma empresa → llama `loadPOSTables()` automáticamente
2. **Si estás en la vista de orden** de la mesa que cambió → recarga el pedido con `openPOSOrder()`

### 12.5 Flujo Resultante
```
Usuario A → PUT mesa/5/estado → servidor actualiza DB → broadcastSSE() →
→ todos los clientes reciben evento → Usuario B ve mesa actualizada sin refresh
```

### 12.6 Archivos Modificados
| Archivo | Cambios |
|---------|---------|
| server.js | EventEmitter import eliminado, + endpoint SSE, + `broadcastSSE()`, + llamadas en 6 endpoints |
| script.js | + `connectSSE()`, + `handleSSEEvent()`, + variable `sseConnection` |

---

## Fase 13: IGV en Detalle de Pedido (Agosto 2026)

### 13.1 Cálculo de IGV por Producto
- Valor `Igvv` (10.50%) obtenido de tabla `Valores` (campo `c_valor = 'Igvv'`)
- Solo se aplica a productos con `Afecto = 1` (TRUE) en tabla `Productos`
- Productos con `Afecto = 0` (FALSE) no generan IGV
- Endpoint `GET /api/pos/config` retorna el porcentaje Igvv desde la DB

### 13.2 Almacén en Base de Datos
- Nueva columna `Igv MONEY DEFAULT 0` en tabla `Ticket_d` (migración `001_add_igv_to_ticket_d.sql`)
- `Ticket_d.Precio` = precio base sin IGV (PventaMa)
- `Ticket_d.Igv` = IGV calculado por línea
- `Ticket_d.Importe` = (Precio × Cantidad) + Igv
- `Ticket_c.Total` = suma de todos los Importe (con IGV)

### 13.3 UI - Detalle del Pedido
- **Subtotal** = Σ(Precio × Cantidad) — precios sin IGV
- **IGV** = Σ(IGV calculado por producto) — usando Igvv de Valores
- **Total** = Subtotal + IGV
- Etiqueta IGV cambiada de "IGV (18%)" a "IGV" (valor dinámico)

### 13.4 Eliminación de Cortesía y Descuento
- Botones removidos del HTML, JS y CSS
- Funciones `applyCourtesy()` y `applyDiscount()` eliminadas
- Referencias en `updatePOSViewMode()` eliminadas
- Pendiente de implementación futura

### 13.5 Archivos Modificados
| Archivo | Cambios |
|---------|---------|
| server.js | + endpoint `GET /api/pos/config`, + cálculo IGV en `POST /api/pos/pedido` y `POST /api/pos/ticket`, + `Igv` en SELECT de `GET /api/pos/pedido` |
| script.js | + `loadPOSConfig()`, + `afecto` en cart items, `updateCartUI()` con Igvv dinámico, eliminadas funciones Cortesía/Descuento |
| dashboard.html | Removidos botones Cortesía/Descuento, etiqueta IGV actualizada |
| style.css | Removidos estilos `.action-buttons-grid`, `.pos-action-btn` |
| migrations/001_add_igv_to_ticket_d.sql | `ALTER TABLE Ticket_d ADD Igv MONEY DEFAULT 0` |

---

## Fase 14: Guardado Automático de Pedidos (Completada Agosto 2026)

### 14.1 Objetivo
Al agregar o quitar productos de un pedido, guardar automáticamente en BD con la misma lógica del botón "Guardar", sin interacción manual.

### 14.2 Decisiones de Diseño
- **Debounce de 700ms** sobre la última modificación del carrito
- La mesa pasa automáticamente a **Ocupada (2)** al guardar (igual que el botón)
- Si el carrito queda **vacío**, no se guarda nada (el ticket anterior queda intacto)
- Solo aplica a **agregar/quitar productos** (cambios de mozo/comensales NO disparan guardado)
- Guardado **silencioso** (sin `alert()`s)

### 14.3 Frontend (`script.js`)
- Nuevas variables: `posAutoSaveTimer`, `posAutoSaveInFlight`, `posAutoSavePending`, `POS_AUTOSAVE_DEBOUNCE_MS = 700`
- **Helpers extraídos** de `guardarMesa()`:
  - `buildPosPedidoPayload()` → construye el body del POST
  - `savePedido(payload)` → POST `/api/pos/pedido` con verificación `res.ok`
  - `markMesaOcupada()` → PUT estado de mesa a 2
  - `onPedidoSaved()` → estado visual del botón + recarga de mesas
- **Auto-guardado**:
  - `scheduleAutoSave()` → debounce de 700ms
  - `runAutoSave()` → guarda con **lock anti-concurrencia**: si hay un guardado en vuelo, agenda uno nuevo al terminar (`posAutoSavePending`) para reflejar cambios recientes
  - Guardas de seguridad: no guarda si es solo lectura (preventa), si el carrito está vacío o si ya se salió de la vista del pedido
- Disparadores al final de: `addToCart()`, `changeQty()` (solo si queda ≥1, else delega en `removeFromCart`), `removeFromCart()` y `clearCurrentOrder()`
- `guardarMesa()` (botón) reutiliza los helpers y limpia el timer pendiente

### 14.4 Backend (`server.js`)
- `POST /api/pos/pedido` ahora corre dentro de una **transacción SQL** (`pool.transaction()`):
  - `DELETE` de `Ticket_d` + `INSERT`s + `UPDATE Ticket_c.Total` son atómicos; ante un error se hace `rollback` (sin datos parciales)
  - La generación del correlativo (`getNextTicketNumber`) también entra en la transacción
  - `Total` se escribe con parámetro `@total` en vez de interpolación
- `getNextTicketNumber()` ahora recibe un `sql.Request` (transacción o pool) en lugar del pool; actualizó su llamada en `/api/pos/ticket`

### 14.5 Archivos Modificados
| Archivo | Cambios |
|---------|---------|
| script.js | + helpers de payload/save, + `scheduleAutoSave()`/`runAutoSave()` con lock y debounce, disparadores en 4 funciones del carrito |
| server.js | `POST /api/pos/pedido` envuelto en transacción, `getNextTicketNumber` refactorizado a `sql.Request` |

---

## Fase 15: Precios con IGV Incluido y Total Directo del Detalle (Completada Agosto 2026)

### 15.1 Problema
- Las tarjetas de producto mostraban el precio **base sin IGV** (`PventaMa`), y el IGV se sumaba recién en el detalle del pedido.
- `Ticket_c.Total` se calculaba como `subtotal + totalIgv` con flotantes acumulados, lo que podía desfasarse en centavos respecto a la suma visible de las líneas.

### 15.2 Solución
- **Tarjetas de producto**: muestran el precio **final (con IGVV incluido)** para productos `Afecto=1`, con etiqueta `(inc. IGV)`. `Afecto=0` muestra su precio base.
- **Detalle del pedido**: cada línea usa el precio final; **TOTAL = Σ importes por línea** (suma directa del detalle, redondeada a 2 decimales). Subtotal e IGV se mantienen visibles como referencia (IGV = Total − Subtotal).
- **Almacenamiento**: `Ticket_d.Precio` = precio unitario **base sin IGV** (`PventaMa` original), `Ticket_d.Igv` = IGV correcto por línea (residual: `Importe − (Precio × Cantidad)`), `Ticket_d.Importe` = valor del detalle **con IGV ya incluido** (`redondear2(Precio final × Cantidad)`). `Ticket_c.Total` = Σ `Importe` = **mismo total del detalle** (no se vuelve a afectar IGV). Conciliación garantizada: `Importe = (Precio × Cantidad) + Igv`.
- **Redondeo consistente**: cliente y servidor usan el mismo redondeo a 2 decimales (`redondear2`) → Total grabado === Total mostrado.

### 15.3 Frontend (`script.js`)
- Helpers: `redondear2(x)`, `factorIgv(afecto)`, `precioFinalUnitario(precioBase, afecto)`
- `renderPOSProducts()`: precio final + etiqueta `(inc. IGV)`
- `addToCart()`: el item guarda `precio` (final con IGV) y `precioBase` (PventaMa)
- `updateCartUI()`: `importe = redondear2(precio × cantidad)`, `subtotal = Σ redondear2(precioBase × cantidad)`, `total = Σ importe`, `igv = total − subtotal`
- `buildPosPedidoPayload()` y `processPOSPayment()`: envían `precio` como base (`precioBase`)
- `openPOSOrder()` (recarga): `Precio` del detalle es base sin IGV → `precioBase = Precio`, `precio (mostrado) = redondear2(precioBase × factorIgv(afecto))` usando `Afecto` devuelto por el servidor

### 15.4 Backend (`server.js`)
- Helper `redondear2(x)`
- `GET /api/pos/pedido`: items con `LEFT JOIN Productos` → devuelve `Afecto` y `PventaMa`
- `POST /api/pos/pedido` y `POST /api/pos/ticket`: `precioUnitario = redondear2(precio × (1 + igvvPct/100))` si afecto, `importe = redondear2(precioUnitario × cantidad)`, `igvLinea = redondear2(importe − subtotalLinea)`. Guardan: `Precio = precio` (base sin IGV), `Igv = igvLinea`, `Importe = importe`, `Total = Σ importe`

### 15.5 Archivos Modificados
| Archivo | Cambios |
|---------|---------|
| script.js | helpers de precio/redondeo, tarjetas con precio final + etiqueta, carrito con total directo del detalle, payload con precioBase |
| style.css | estilo `.pos-product-igv` para la etiqueta |
| server.js | helper redondear2, GET pedido con JOIN a Productos (devuelve Afecto), POST pedido/ticket con Precio base sin IGV + Igv residual + Importe con IGV |

---

## Fase 16: Actualización Automática y Fix de Conexión en Docker (Completada Agosto 2026)

### 16.1 `.env` fuera del control de versiones
**Problema**: `.env` estaba versionado en git (con credenciales reales: DB_USER, DB_PASS, SESSION_SECRET), lo que:
- Exponía credenciales en GitHub.
- Rompía el flujo de actualización del cliente: al configurar su propio `.env` local, `git pull` fallaba o sobrescribía sus datos.

**Fix**:
- `.gitignore` ahora ignora `node_modules`, `.env` y `npm-debug.log`.
- `git rm --cached .env` → el archivo deja de trackearse (se mantiene solo localmente en cada máquina).
- **Recomendación**: rotar `DB_PASS` y `SESSION_SECRET` que quedaron publicados en commits anteriores.

### 16.2 `actualizar.bat` — Actualización automática (máquina del cliente)
Script en la raíz del repo para que el cliente actualice con un doble clic:
1. Verifica que exista `.env` (copiar desde `.env.example` si no).
2. Verifica Git instalado.
3. `git pull` — si falla, muestra aviso y **no modifica nada**.
4. Verifica Docker Desktop corriendo.
5. Reconstruye y arranca: `docker compose up -d --build` (detecta `docker-compose` v1 o `docker compose` v2).
6. Muestra estado contenedores (`docker compose ps`).
7. Lee `PORT` del `.env` y abre `http://localhost:PORT` en el navegador.

Mensajes en ASCII puro para evitar problemas de codificación de la consola Windows.

**Flujo de despliegue resultante**:
```
Dev: git push (código + migraciones /migrations/*.sql)
Cliente: doble clic en actualizar.bat → git pull → rebuild → migraciones automáticas
```

### 16.3 Fix: conexión de Docker a SQL Server del cliente
**Problema**: La app corría en contenedor pero `.env` usaba `DB_SERVER=localhost`. Dentro de Docker, `localhost` es el propio contenedor → `Failed to connect to localhost:1433 - Could not connect (sequence)`.

**Fix**:
- `docker-compose.yml`: agregado `extra_hosts: "host.docker.internal:host-gateway"` para que el contenedor pueda alcanzar la máquina anfitriona.
- En el `.env` del cliente: `DB_SERVER=host.docker.internal` (la DB corre en la misma máquina Windows que el contenedor).

**Requisitos en el Windows del cliente (además del `.env`)**:
- **SQL Server Configuration Manager** → SQL Server Network Configuration → protocolos de la instancia → **TCP/IP = Enabled** → IPAll → `TCP Port = 1433` → reiniciar servicio SQL.
- **Firewall de Windows**: regla de entrada permitiendo **TCP 1433** (necesaria porque el contenedor llega a la máquina por su IP virtual, no por `localhost`).
- Si la DB estuviera en otro servidor del LAN, en `DB_SERVER` va la IP real y solo aplica el punto del firewall en ese servidor.

### 16.4 Fix: crash-loop y mensajes de error oscuros
**Problema**: Al fallar la conexión, el error real era opacado y el contenedor entraba en reinicio infinito:
- `db.js` tragaba el error y devolvía `undefined` → `migrate.js:12` fallaba con `Cannot read properties of undefined (reading 'request')`.
- `migrate.js` ejecutaba `process.exit(1)` → mataba la app → Docker la reiniciaba en bucle.

**Fix**:
- `db.js`: `getConnection()` ya no traga el error; ahora deja que el error de conexión real suba al llamador.
- `migrate.js`: ya no hace `process.exit(1)`; lanza el error hacia arriba.
- `server.js`: el arranque reintenta las migraciones hasta 12 veces (1 intervalo de 5s ≈ 1 minuto) y si no logra conectar muestra un mensaje de diagnóstico claro (`DB_SERVER` → `host.docker.internal`, TCP 1433). La app ya no "muere"; queda en espera con reintentos.

### 16.5 Archivos Modificados
| Archivo | Cambios |
|---------|---------|
| `.gitignore` | Ignora `node_modules`, `.env`, `npm-debug.log` |
| `.env` | Dejado de trackear (`git rm --cached`) |
| `actualizar.bat` | **Nuevo**: actualización automática para el cliente |
| `docker-compose.yml` | + `extra_hosts: host.docker.internal:host-gateway` |
| `db.js` | `getConnection()` devuelve el error real (sin try/catch que lo oculte) |
| `migrate.js` | Quitado `process.exit(1)`; lanza el error |
| `server.js` | Startup con reintentos (12× 5s) y diagnóstico claro |

---

## Fase 17: Adecuación a la Nueva Estructura de Ticket_c / Ticket_d (Completada Agosto 2026)

### 17.1 Contexto
La estructura de las tablas de tickets fue recreada/manual en la BD del cliente. La app se adaptó para que **todos los procesos existentes sigan funcionando** (POS, guardado automático, preventa, reabrir, borrado, correlativos, SSE) manteniendo la nueva estructura.

### 17.2 Estructura objetivo
**Ticket_c** (`NroTicket` CHAR(20) PK, `NroMesa` INT, `Mozo` INT, `Total` MONEY, `Estado` INT DEFAULT 1, `Flete` MONEY DEFAULT 0, `Propina` MONEY DEFAULT 0, `Fecha` SMALLDATETIME DEFAULT -5h, `Turno` INT DEFAULT 1, `Usuario` NVARCHAR(50)) + índice no agrupado `nci_wi_Ticket_c (NroMesa, Estado)`.

**Ticket_d** (`NroTicket` CHAR(20), `Codpro` CHAR(10), `Descripcion` CHAR(70), `Cantidad` DECIMAL(9,2), `Precio` MONEY, `Descuento` MONEY, `Importe` MONEY). **Sin columna `Igv`**.

### 17.3 Decisiones de diseño
- **IGV se mantiene**: el precio sigue mostrándose **afectado por IGV** (los productos `Afecto=1` aplican `Igvv` de la tabla `Valores`). `Importe` y `Ticket_c.Total` almacenan valores con IGV incluido, igual que la UI del POS.
- La columna residual `Igv` de `Ticket_d` se **elimina**: el IGV del detalle se recalcula en cliente (factor `Igvv` + `Afecto`) a partir de `Precio` base y nunca dependió de la columna almacenada.
- `Descripcion CHAR(70)` → se lee con `RTRIM()` para no arrastrar espacios de relleno al frontend (refuerzo con `.trim()` en `openPOSOrder`).
- `data.pedido.Comensales` no existe en la nueva estructura; la pantalla usa `|| 1`. Comportamiento idéntico al anterior (la app nunca persistió comensales).

### 17.4 Cambios en `server.js`
| Punto | Cambio |
|-------|--------|
| `GET /api/pos/pedido` | `SELECT` sin `t.Igv` + `RTRIM(t.Descripcion) AS Descripcion` |
| `POST /api/pos/pedido` | Quitados `subtotalLinea`, `igvLinea` e input `@igv`; `INSERT Ticket_d (..., Precio, Descuento, Importe)` (sin `Igv`) |
| `POST /api/pos/ticket` | Quitado `igvLinea` del mapeo e input `@igv_...`; `INSERT Ticket_d` sin `Igv` |

Se conservan: cálculo de `Importe`/`Total` con IGV, correlativos (`getNextTicketNumber`), transacciones, preventa, SSE y guardado automático.

### 17.5 Migraciones
- **No aplica**: la estructura de `Ticket_c`/`Ticket_d` fue creada/ajustada manualmente en la BD del cliente (sin `Igv`). No se agregan migraciones para esto.
- **Eliminada** `migrations/001_add_igv_to_ticket_d.sql` (agregaba la columna `Igv`). La carpeta `/migrations` queda vacía hasta el próximo cambio de esquema.

### 17.6 Archivos Modificados
| Archivo | Cambios |
|---------|---------|
| server.js | Remove `Igv` en SELECT + 2 INSERT de Ticket_d; `RTRIM` de `Descripcion` |
| public/script.js | `.trim()` en `item.Descripcion` al cargar pedido |
| migrations/001_add_igv_to_ticket_d.sql | **Eliminado** |

---

## Fase 18: Fix de Zona Horaria en Ticket_c.Fecha (Completada Agosto 2026)

### 18.1 Problema
Al registrar un ticket (Estado=1 Guardada o Estado=2 Preventa), la columna `Ticket_c.Fecha` se grababa con **+1 día** respecto a la fecha real. Ejemplo: el 20 de Agosto el ticket salía con fecha 21 de Agosto.

### 18.2 Causa Raíz
- Los INSERT/UPDATE de `Ticket_c` usaban `GETDATE()`, que devuelve la hora del **reloj del servidor SQL**.
- El servidor SQL tiene su zona horaria configurada en **UTC**, adelantado +5h respecto a Perú (UTC-5). Verificado con `SYSDATETIMEOFFSET()` → `+00:00`. Cualquier ticket creado después de las ~7:00 pm hora Perú caía en el día siguiente.
- Evidencia previa: la columna fue creada manualmente con `Fecha SMALLDATETIME DEFAULT -5h` (Fase 17.2), pero el código pisaba ese default insertando `GETDATE()` explícito.

### 18.3 Solución
Se reemplazó `GETDATE()` por una conversión de zona horaria nativa de SQL Server 2016+, independiente de la configuración del servidor:

```sql
CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SA Pacific Standard Time' AS smalldatetime)
```

- `SYSUTCDATETIME()` → hora UTC confiable.
- Primer `AT TIME ZONE 'UTC'` → **etiqueta** la hora como UTC (agrega offset +00:00).
- Segundo `AT TIME ZONE 'SA Pacific Standard Time'` → **convierte** a hora de Lima usando la base de zonas horarias del registro de Windows (presente en cualquier Windows).
- Ventaja: sigue siendo correcta aunque el cliente corrija la zona horaria/reloj de su Windows a futuro (a diferencia de un `DATEADD(HOUR,-5,...)` fijo, que restaría doble).

> ⚠️ **Gotcha importante**: `SYSUTCDATETIME() AT TIME ZONE 'SA Pacific Standard Time'` (un solo paso) es **incorrecto**: al aplicarse sobre un `datetime2` sin offset, SQL Server lo *interpreta* como hora Lima sin convertir nada (devuelve la misma hora marcada -05:00). Se detectó y corrigió durante las pruebas contra la BD real. El doble paso es obligatorio: primero etiquetar como UTC, luego convertir.

### 18.4 Puntos Corregidos (`server.js`)
| Línea | Endpoint | Cambio |
|-------|----------|--------|
| 333 | POST `/api/pos/pedido` (UPDATE auto-guardado) | `SET Fecha = GETDATE()` → expresión con TZ Lima |
| 344 | POST `/api/pos/pedido` (INSERT Estado=1) | ídem |
| 573 | POST `/api/pos/ticket` (INSERT Estado=2) | ídem |

### 18.5 Notas
- Sin migraciones: no cambia el esquema; el `DEFAULT -5h` de la columna queda intacto (el código siempre escribe `Fecha` explícito).
- Requisito: SQL Server 2016+ (cliente confirmado).
- La lectura de `Fecha` en frontend solo se usa en reportes de otras tablas; no requirió cambios.
- Verificado contra BD real: `GETDATE()` = `2026-08-21 01:54` vs expresión nueva = `2026-08-20 20:55` (hora real Perú en ese momento).

### 18.6 Archivos Modificados
| Archivo | Cambios |
|---------|---------|
| server.js | 3 reemplazos de `GETDATE()` por `CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SA Pacific Standard Time' AS smalldatetime)` |

---

## Fase 19: Adaptación Responsive Móvil y Tablet (Completada Agosto 2026)

### 19.1 Objetivo
Adaptar toda la web (login, mapa de mesas, toma de pedido, modales) a **celular** (referencia 440x956) y **tablet** (referencia 1024x1366) sin romper el funcionamiento desktop existente.

### 19.2 Decisiones de Diseño
- **Archivo nuevo `public/responsive.css`** cargado después de `style.css`: cero modificaciones al CSS existente, rollback trivial, todo el responsive en un solo lugar.
- **Breakpoints**: Móvil `≤480px` · Tablet `481–1024px` · Desktop `>1024px` intacto.
- **Carrito en móvil = bottom-sheet**: barra flotante inferior (`#pos-cart-fab`) con contador de ítems y total; al tocarla, el sidebar existente del pedido se desliza como panel sobre los productos (se reutiliza el mismo DOM, sin duplicar).
- **Botones de acción en móvil = solo iconos**: textos envueltos en `<span class="btn-label">`, ocultos por CSS en móvil (los 5 botones caben en una fila).
- El drawer del sidebar `≤1024px` ya existía y se mantiene (coincide con tablet portrait).

### 19.3 Infraestructura Base
| Mejora | Detalle |
|--------|---------|
| `viewport-fit=cover` | Soporte para notch/safe areas |
| Unidades `dvh` | `.main-layout` y `.pos-order-layout` usan `100dvh` con fallback a `100vh` (barra de dirección de móviles) |
| `-webkit-tap-highlight-color: transparent` | Feedback táctil limpio |
| `touch-action: manipulation` | Elimina delay/double-tap-zoom en botones |
| `@media (hover:none)` | Anula efectos `:hover` que se "pegan" en táctil |
| Inputs ≥16px en táctil | Evita el zoom automático de iOS al enfocar (`@media (hover:none) and (pointer:coarse)`) |

### 19.4 Mapa de Mesas (móvil)
- Filtros apilados verticalmente; select empresa `flex:1`; toggle turno full-width
- Leyenda en grilla 3×2 compacta (sin `margin-left:auto`)
- Grilla de mesas `minmax(128px,1fr)` ≈ 3 tarjetas por fila en 440px

### 19.5 Toma de Pedido
**Tablet (481–1024)**: layout 2 columnas se mantiene, carrito 400→320px.

**Móvil (≤480)**:
- Header fila 1: back + título truncado (ellipsis) + timer; badge PREVENTA pasa a fila propia centrada
- Header fila 2: mozo/comensales arriba, 5 botones solo-icono abajo distribuidos
- Categorías con scroll-snap y scrollbar oculta; búsqueda a 16px
- Productos en 2 columnas fijas con padding-bottom para no quedar tras el FAB
- Bottom-sheet: `.pos-order-sidebar` → `position:fixed; translateY(105%)`; clase `.open` lo desliza (max-height 85dvh); backdrop `#cart-sheet-backdrop` cierra al tocar fuera

### 19.6 Cambios en JS (`script.js`)
| Función | Descripción |
|---------|-------------|
| `isMobileView()` | `window.innerWidth <= 480` |
| `toggleCartSheet(force)` | Abre/cierra sheet + backdrop (solo en móvil) |
| `closeCartSheet()` | Limpia clases (usado en resets) |
| `updateCartFab()` | Contador de ítems + total en la barra flotante |

Hooks: `updateCartUI()` → `updateCartFab()` · `openPOSOrder()` → `closeCartSheet()` · `processPOSPayment()` éxito → `closeCartSheet()` · handler `resize` >480px limpia estado del sheet. Sin cambios en APIs ni SSE.

### 19.7 Modales y Táctil
- Modal mozo: inline `max-width:400px` movido a CSS (`min(400px, 92vw)`), lista con scroll propio
- Botones qty ± → 40×40px en pantallas táctiles
- `env(safe-area-inset-bottom)` en FAB y sheet

### 19.8 Archivos Modificados
| Archivo | Cambios |
|---------|---------|
| public/responsive.css | **Nuevo** (~440 líneas): base global + tablet + móvil + bottom-sheet |
| public/dashboard.html | viewport-fit, link responsive.css, btn-label spans, FAB + backdrop, modal mozo sin inline style |
| public/script.js | +4 funciones bottom-sheet, hooks en updateCartUI/openPOSOrder/processPOSPayment/resize |
| public/style.css | **Intacto** |
| server.js | **Intacto** |

### 19.9 QA Realizado
- Sintaxis JS verificada (`node --check`) y CSS balanceado
- Servidor sirviendo dashboard.html / responsive.css / script.js (200 OK)
- Verificación cruzada HTML↔CSS↔JS automatizada (FAB, backdrop, spans, hooks)
- Pendiente en dispositivo real: probar 440x956 y 1024x1366 en DevTools + físicos

---

## Fase 20: Detalle de Pedido Estable (Sin Reordenamientos ni Parpadeo) (Completada Agosto 2026)

### 20.1 Problema
Al modificar la cantidad de un producto (+/-), los ítems del detalle del pedido **se reordenaban y parpadeaban constantemente**, especialmente molesto en móvil/tablet (misclicks, pérdida de scroll).

### 20.2 Causa Raíz (cadena completa)
```
+/- → scheduleAutoSave() (700ms) → runAutoSave() → POST /api/pos/pedido
    → servidor: broadcastSSE('mesa_updated')
      → el MISMO cliente recibe el eco → handleSSEEvent()
        → openPOSOrder() recarga TODO el pedido desde la BD
```
1. **Eco propio (self-echo)**: el guardado propio disparaba la recarga de la propia vista (el SSE fue diseñado para ver cambios de otros dispositivos).
2. **Sin `ORDER BY`**: `GET /api/pos/pedido` devolvía las filas en orden arbitrario de SQL Server → al recargar, los ítems cambiaban de posición.
3. **Rebuild total del DOM**: `updateCartUI()` hacía `innerHTML = ''` en cada toque → parpadeo + scroll perdido.

### 20.3 Soluciones

#### Fix 1 — Supresión de eco propio (`script.js`)
- Nueva variable `lastSelfSaveAt` + constante `SSE_SELF_ECHO_WINDOW_MS = 3000`
- Se marca timestamp tras cada guardado exitoso (`runAutoSave`, `guardarMesa`)
- `handleSSEEvent`: si el evento llega dentro de la ventana de 3s posterior al guardado propio → **no recarga** la vista de pedido (el estado local ya está sincronizado). El mapa de mesas sigue refrescándose.
- Los eventos de **otros dispositivos** siguen recargando en vivo (funcionalidad SSE intacta).

#### Fix 2 — Orden determinista desde BD (`server.js`)
- `ORDER BY t.Codpro` agregado al SELECT del detalle en `GET /api/pos/pedido`.
- Al reabrir tickets, los ítems siempre cargan en orden predecible por código.

#### Fix 3 — Render in-place del carrito (`script.js`)
- `updateCartUI()` reescrito con **conciliación por clave** `data-cod` (Codpro):
  - Solo se actualiza el HTML de filas cuyo contenido cambió (`dataset.sig` como firma); las demás no se tocan.
  - Filas nuevas se agregan / eliminadas se remueven; nunca se reconstruye la lista completa.
  - `scrollTop` del contenedor se preserva entre renders.
- Botones +/-/eliminar ahora usan **delegación de eventos** (`bindCartDelegation`) con `data-action` + `data-cod` en vez de `onclick` con índices → elimina el bug de índices obsoletos al eliminar ítems.
- Al cargar pedido desde BD (`openPOSOrder`): filas duplicadas del mismo `Codpro` se **fusionan sumando cantidades** (garantiza claves únicas; seguro porque el POST reconstruye el detalle completo en cada guardado).

### 20.4 Archivos Modificados
| Archivo | Cambios |
|---------|---------|
| public/script.js | `lastSelfSaveAt` + guardia SSE, `updateCartUI` con conciliación por data-cod + delegación de eventos, fusión de duplicados en `openPOSOrder` |
| server.js | `ORDER BY t.Codpro` en SELECT del detalle |

---

## Fase 21: Pedido Cocina — KDS (Completada Agosto 2026)

### 21.1 Concepto
Nuevo módulo **"Pedido Cocina"** en el sidebar: tablero tipo Kanban en tiempo real para que cocina vea las comandas activas y marque el avance de cada plato desde celular o tablet.

```
PENDIENTE          EN PREPARACIÓN      LISTO
┌──────────┐      ┌──────────┐        ┌──────────┐
│ T001-15  │      │ T001-13  │        │ T002-08  │
│ Mesa 4 ⏱ │      │ Mesa 2 ⏱ │        │ Mesa 7 ✅│
│ 2× Lomo  │      │ 1× Ají   │        │ [ENTREGAR]│
└──────────┘      └──────────┘        └──────────┘
```

### 21.2 Decisiones de Diseño
- **Entrada automática**: el pedido aparece en cocina apenas se guarda con productos (Estado 1 o 2). Sin pasos extra para el mozo.
- **Tabla separada `Cocina_pedidos`**: NO se usan columnas en `Ticket_d` porque el guardado hace DELETE+INSERT total en cada auto-guardado (Fase 14) — los estados se perderían. La tabla se clavea por `(NroTicket, Codpro)` (claves únicas garantizadas por Fase 20).
- **3 estados por plato**: 1=Pendiente → 2=En preparación → 3=Listo; 4=Entregado a nivel ticket.
- **Sincronización transaccional**: `syncCocinaLineas()` corre dentro de las transacciones de guardado: elimina estados de productos removidos e inserta Estado=1 para nuevos. El progreso de cocina sobrevive a cualquier edición del mozo.
- **Filtro por empresa** (prefijo T001/T002/T005), sin turno.

### 21.3 Migración
`migrations/001_create_cocina_pedidos.sql` — tabla + índice `nci_cocina_estado (Estado, NroTicket)` + unique `(NroTicket, Codpro)`. Aplicada automáticamente por `migrate.js` al arrancar.

### 21.4 Endpoints Nuevos (`server.js`)
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/cocina/pedidos?empresa=X` | Comandas activas (tickets Estado IN 1,2, líneas <4) con líneas, categoría y `MinutosEspera` calculado en SQL con TZ Lima |
| PUT | `/api/cocina/linea` | Cambiar estado de un plato `{nroTicket, codpro, estado}` (valida 1–3), registra usuario |
| PUT | `/api/cocina/ticket/:nro/todo-listo` | Todas las líneas <3 → Listo(3) |
| PUT | `/api/cocina/ticket/:nro/entregado` | Todas → Entregado(4); sale del tablero |

Todos emiten `broadcastSSE({type:'cocina_updated'})`. Los guardados de pedido/ticket también lo emiten; `DELETE /comanda` limpia sus filas de cocina.

### 21.5 Frontend
| Pieza | Detalle |
|-------|---------|
| Sidebar | Nuevo ítem "Pedido Cocina" (`fa-fire-burner`) |
| Tablero | 3 columnas Kanban (Pendiente/En Preparación/Listo) con contadores |
| Tarjeta | N° ticket, mesa, timer ⏱ con semáforo (verde <10', amarillo <20', rojo >20' con pulso animado), platos con chip de color por categoría (hash del nombre → paleta) |
| Interacción | Tap en plato cicla 1→2→3 (optimista); botones "TODO LISTO" / "ENTREGAR" por tarjeta |
| Sonido | Beep doble Web Audio API (toggle 🔊) cuando entra una comanda nueva. `AudioContext` persistente desbloqueado por el gesto del toggle (política autoplay de navegadores); el beep NO depende del flag silencioso de recargas SSE |
| Timers | Refresco cada 30s solo actualiza textos/clases (sin recargar datos); base `MinutosEspera` calculada en SQL (TZ-safe) |
| SSE | Evento `cocina_updated` recarga el tablero si está visible |

### 21.6 Responsive
- Móvil ≤480px: chips-filtro (Todas/Pendientes/Preparación/Listas), columnas apiladas, columnas vacías ocultas (clase `sin-tarjetas` puesta por JS), targets táctiles ampliados

### 21.7 Archivos Modificados
| Archivo | Cambios |
|---------|---------|
| migrations/001_create_cocina_pedidos.sql | **Nuevo** |
| server.js | Helper `syncCocinaLineas`, hooks en POST pedido/ticket, limpieza en DELETE comanda, 4 endpoints cocina |
| public/dashboard.html | Ítem sidebar + vista `view-cocina` completa |
| public/script.js | Módulo KDS (~230 líneas): carga, render Kanban, ciclo estados, SSE, beep, timers |
| public/style.css | Sección `.cocina-*` (~250 líneas) |
| public/responsive.css | Ajustes móviles del tablero |

### 21.8 QA Realizado
- Migración aplicada contra BD real: ✅
- Login + `GET /cocina/pedidos` (200, tablero vacío): ✅
- Validación de estado inválido (400): ✅
- Auth sin sesión (401): ✅
- Pendiente en dispositivo real: flujo completo mozo→cocina multi-dispositivo

---

## Próximos Pasos (Pendientes)

### POS
- [ ] Implementar función de Cortesía (botones removidos temporalmente)
- [ ] Implementar función de Descuento (botones removidos temporalmente)
- [ ] Exportar ticket a documento (boleta/factura)

### Reportes
- [ ] Dashboard de ventas por día
- [ ] Reporte de productos más vendidos
- [ ] Reporte de ingresos por empresa

---

## Tecnologías Utilizadas
- **Backend**: Node.js, Express.js, SQL Server (mssql)
- **Frontend**: Vanilla JS, CSS3, FontAwesome
- **Auth**: express-session, encriptación custom (ASCII - posición)
- **Tiempo Real**: Server-Sent Events (EventSource API nativa)

---

*Última actualización: 14 de septiembre de 2026 - primera versión operativa en el cliente, impresión RPT004 activa y actualización rutinaria documentada.*

## Fase 22: Notas, envíos explícitos y cola de impresión (Completada; impresión validada posteriormente en Fase 23)

### Estado actual

- Implementados: notas por línea, separación de cantidades, autoguardado, envío explícito, diferencias incrementales, correcciones, anulaciones, reconocimiento de Cocina, documentos inmutables, reimpresión auditada, cola persistente e historial visual.
- Validado en código: dominio, navegador y SQL Server mediante un esquema aislado de `tempdb`.
- Aplicado en la base local: las tablas auxiliares de Fase 22 existen y el flujo se utilizó para recuperar el pedido afectado de mesa 1.
- Pendiente operativo: reconocer en Cocina las cuatro anulaciones del ticket `T001-248347`; la última liberará la mesa 1.
- La impresora fue identificada posteriormente como 3nStar RPT004 Ethernet/USB compatible con ESC/POS; la integración y validación física corresponden a la Fase 23.

### Revisión de aislamiento de tablas

Las migraciones `002` y `003` fueron rediseñadas para crear y poblar únicamente tablas nuevas. No ejecutan `ALTER`, `DROP`, `DELETE` ni `UPDATE` sobre `Ticket_c`, `Ticket_d`, `Productos`, `Empleados`, `Tablas`, `Valores`, `Mesas` ni `Cocina_pedidos`. `Cocina_pedidos` conserva su estructura y registros; el estado nuevo se guarda en `Cocina_estados`. `Cocina_pedidos_legacy` recibe una copia en una tabla nueva cuando existe.

`migrate.js` valida cada archivo antes de enviarlo a SQL Server y rechaza operaciones prohibidas o escrituras fuera de la lista de tablas nuevas autorizadas. La transacción y el bloqueo de migraciones se mantienen. El preflight aplica la misma política antes de abrir una conexión de producción.

Las operaciones de runtime de POS siguen pudiendo escribir el pedido comercial según el flujo normal de ventas; esa autorización no se aplica a las migraciones. `Cocina_pedidos` permanece sin cambios y el tablero nuevo usa `Cocina_estados`.

### Cambio de flujo respecto de la fase 21

El autoguardado ya no agrega ni modifica platos en cocina. **Enviar a Cocina**, situado encima de Generar Preventa, registra únicamente las novedades. La preventa se bloquea en cliente y servidor si quedan cambios sin enviar. La ruta antigua de preventa directa devuelve 409 para impedir saltarse este paso.

### POS y cocina

- Líneas con GUID estable, doce notas rápidas de la referencia y nota personalizada de hasta 500 caracteres. Un mismo producto admite instrucciones distintas y separación de cantidades.
- Agregar unidades a un producto enviado crea una nueva línea pendiente. Las líneas se renderizan por ID conservando su posición.
- Estados del pedido: Sin enviar, Cambios pendientes y Enviado a cocina. Historial con documento y estado de cada trabajo de impresión.
- Correcciones y anulaciones incluyen antes/después. Cocina conserva su versión operativa hasta el reconocimiento si el plato está en preparación, listo o entregado. El reconocimiento conserva el estado de preparación.
- No se puede editar ni entregar una línea con reconocimiento pendiente. “Todo listo” actúa únicamente sobre líneas sin bloqueo; las demás siguen disponibles.
- El tiempo de espera parte de `Fecha_envio`, almacenada en UTC. El documento muestra fecha/hora de Lima.
- Comportamiento histórico de esta fase: borrar una comanda enviada producía anulaciones y podía usar `Ticket_c.Estado=4`. La Fase 23 reemplaza este flujo por eliminación física inmediata del ticket comercial y liberación de la mesa.
- Quitar una línea enviada la mantiene visible en POS como **Anulación pendiente de enviar**, aunque ya no forme parte del importe comercial.
- La cancelación usa una clave estable guardada en `sessionStorage`; un reintento devuelve el envío original incluso si la primera respuesta se perdió.
- Una anulación conserva el JSON operativo anterior en `Cocina_estados.Operativa` y actualiza `Anulada`; nunca intenta almacenar SQL `NULL` ni el JSON escalar `null`.
- Notas e instrucciones se muestran como texto; no se interpretan como HTML ni comandos de impresora.

### Historial de Cocina

El módulo **Pedido Cocina** conserva el tablero operativo y agrega la vista **Historial**. La consulta es paginada y permite filtrar por empresa, rango de fechas de Lima, mesa, ticket y estado del pedido. Cada registro muestra número de envío, fecha, movimientos, reconocimientos, documento original y trabajos de impresión. Desde la misma vista se puede consultar el ticket o solicitar una reimpresión auditada.

Los pedidos anulados desaparecen del tablero una vez resueltos, pero sus envíos y documentos permanecen disponibles en el historial.

### Persistencia y compatibilidad

`002_pedido_lineas_envios.sql` y `003_cocina_historico.sql` agregan control/versionado, líneas operativas, envíos/detalles y trabajos de impresión. `001_create_cocina_pedidos.sql` permanece intacta. El ejecutor aplica **todas las migraciones pendientes y sus registros en una sola transacción**, con bloqueo entre instancias. El servidor abre el puerto después de completar el arranque/migración.

Las instantáneas de línea y movimiento usan JSON validado con `ISJSON`; los IDs, relaciones, orden, baja, versión, estado, fechas y claves únicas son columnas SQL. La instantánea comercial permanece en `Ticket_d`, agrupada por producto/precio; las instrucciones no alteran su descripción comercial. Al separar cantidades fraccionarias, un reparto determinista de centavos entre variantes conserva el total comercial del producto. Los productos y mozos se validan por empresa. Los precios de nuevas líneas y su afectación provienen del catálogo; las líneas existentes conservan su precio.

La migración inicializa `Pedido_control` y `Pedido_lineas` a partir de los pedidos comerciales activos, sin crear envíos ni trabajos de impresión. Los registros existentes de `Cocina_pedidos` se conservan intactos y se copian a `Cocina_pedidos_legacy` para consulta de compatibilidad; el nuevo flujo operativo comienza en las tablas auxiliares.

El 10/09/2026 se consultó el catálogo real sin modificarlo: compatibilidad SQL Server **150**, estructura base coincidente, ningún trigger en Ticket_c/Ticket_d y **112 referencias de objetos** a esas tablas. Existen procedimientos externos relacionados con tickets. Un índice por ticket y bloqueos de fila/rango protegen la lectura y reconstrucción comercial durante cada transacción. `SnapshotComercial` detecta cambios en Ticket_d ajenos a SedimApp y responde 409 en vez de sobrescribirlos. Se debe coordinar qué aplicación edita cada pedido; no hay conciliación automática de cambios externos.

### Contratos nuevos/actualizados

| Método y ruta | Contrato |
|---|---|
| GET `/api/pos/pedido?mesa=X&empresa=Y` | `items` por `lineaId`, notas, `enviada`, `pendienteId`; `version`, resumen `cocina`, último estado `impresion` |
| POST `/api/pos/pedido` | `version` esperada para actualizar, `operacionId`, líneas con ID/notas; admite detalle vacío para un ticket existente |
| POST `/api/pos/pedido/:nro/enviar-cocina` | `{empresa, version, clave, operacionId}`; `clave` GUID idempotente por ticket; devuelve `envioId` y estado actualizado |
| GET `/api/pos/pedido/:nro/envios?empresa=X` | Historial y trabajos de impresión |
| GET `/api/pos/pedido/:nro/envios/:envio/documento?empresa=X` | Documento textual inmutable |
| POST `/api/pos/pedido/:nro/envios/:envio/reimprimir` | `{empresa, clave}`; copia auditada, sin otro envío de cocina; bloqueada si ya existe trabajo en cola/procesando |
| PUT `/api/pos/pedido/:nro/pagar` y `/reabrir` | `{empresa, version, operacionId}`; actualizaciones de ticket/mesa transaccionales |
| DELETE `/api/pos/comanda/:nro?empresa=X` | Body `{version, clave, operacionId}`; desde Fase 23 elimina el ticket comercial y conserva la auditoría auxiliar |
| PUT `/api/cocina/linea` | `{empresa, nroTicket, lineaId, estado}`; ID estable sustituye Codpro como identidad |
| PUT `/api/cocina/linea/:linea/reconocer` | `{empresa, nroTicket}`; registra usuario/fecha y aplica corrección |
| PUT `/api/cocina/ticket/:nro/todo-listo` y `/entregado` | Body `{empresa}`; entrega bloqueada con correcciones pendientes |
| GET `/api/cocina/historial` | Filtros `empresa`, `desde`, `hasta`, `mesa`, `ticket`, `estado`, `pagina`, `tamano`; devuelve envíos, documentos, reconocimientos y trabajos |

SSE incluye empresa, mesa, ticket, versión e identificador de operación. El cliente conserva el borrador ante 409 y permite compararlo con la versión del servidor antes de descartarlo. Autoguardado, envío y preventa se serializan; los reintentos del envío conservan su clave en sessionStorage.

### Impresora: estado de implementación

La cola y los documentos se implementaron en esta fase. La Fase 23 agrega el transporte físico para la 3nStar RPT004; continúa deshabilitado hasta completar su validación física.

Variables documentadas en `.env.example`: `PRINTER_ENABLED=false`, `PRINTER_HOST`, `PRINTER_PROTOCOL=unverified`, `PRINTER_PORT`, `PRINTER_TIMEOUT_MS=5000`. Papel acordado: 80 mm; ancho imprimible: 72 mm. El documento usa 42 caracteres por línea, pendiente de validar con la fuente física del equipo.

El adaptador futuro debe implementar `send(documento, configuracion)` y devolver `{transmitted:true}` solo tras transmitir; un error solo puede indicar `beforeTransmission=true` si se sabe que **ningún byte** pudo llegar. Debe aplicar timeout, codificación y corte conforme al manual, sin interpretar texto del usuario como comandos. Se inyecta al iniciar `startPrintWorker`.

Estados persistidos: `en_cola`, `procesando`, `enviado`, `error`, `incierto`. `enviado` significa **enviado a impresora**, no impresión física confirmada. El trabajador serializa por bloqueo SQL entre instancias, registra el intento antes de transmitir y recupera trabajos interrumpidos como inciertos. Máximo tres intentos automáticos solo ante errores previos a transmisión; los casos ambiguos requieren revisión y reimpresión explícita.

### Despliegue y validación pendientes

1. Ejecutar `npm run preflight:phase22` para inspeccionar esquema/índices/dependencias y validar sintaxis con PARSEONLY (no ejecuta migraciones).
2. Coordinar escritores externos, obtener respaldo y pausar operación antes de actualizar. No mezclar versiones del servidor durante el cambio del flujo operativo.
3. Ejecutar pruebas de integración en un esquema aislado de tempdb con `npm run test:sql`; este comando crea fixtures y elimina su propio esquema al terminar, sin usar la base del negocio.
4. Reiniciar el servidor con el código actualizado y verificar el registro de migraciones antes de continuar las pruebas reales.
5. Confirmar marca/modelo/manual POS-D; verificar protocolo, puerto, acceso LAN desde Docker, caracteres españoles, corte y consulta de estado. Integrar el adaptador y efectuar impresión de muestra.
6. Probar físicamente desde celular y tablet: dos platos iguales con notas distintas, primer envío, adición, corrección, reconocimiento, desconexión/reconexión y reimpresión auditada.

La fase sigue pendiente de aceptación física. Las pruebas de interfaz usan APIs simuladas y las pruebas SQL usan tablas aisladas en `tempdb`; la recuperación descrita abajo sí se ejecutó de forma controlada contra el pedido local afectado.

### Incidencia y recuperación de mesa 1 (10/09/2026)

**Causa:** al cancelar una línea enviada se intentaba reemplazar `Cocina_estados.Operativa` por SQL `NULL`; al reconocer una anulación iniciada se intentaba guardar el JSON escalar `null`. La columna es obligatoria y su restricción `ISJSON` exige un documento JSON válido, por lo que SQL Server revertía la transacción y Cocina no recibía la anulación.

**Corrección:** las anulaciones conservan la última versión operativa. Para líneas pendientes se actualiza directamente `Anulada`; para líneas en preparación, listas o entregadas se registra `PendienteId` y Cocina debe reconocer el cambio. Movimiento, documento, estado y trabajo de impresión permanecen en una transacción.

**Recuperación:** el comando `npm run recover:table-order -- --empresa 2 --mesa 1` localizó y exportó el ticket `T001-248347` antes de intervenir. Tenía cuatro líneas dadas de baja, dos envíos previos y cuatro estados entregados. La ejecución controlada con `--apply` creó el envío 3 con cuatro movimientos `ANULACIÓN`, elevó la versión de 15 a 16 y dejó cuatro reconocimientos pendientes. No se borraron tablas, documentos, correlativos ni pedidos ajenos.

La exportación se guarda en `backups/`, carpeta excluida de Git por contener datos operativos. El comando funciona en modo diagnóstico por defecto y solo modifica el pedido cuando recibe `--apply`.

### Verificación de esta entrega (10/09/2026)

- `npm run check`: sintaxis JavaScript validada.
- `npm test`: **12 pruebas de dominio aprobadas**, incluidas notas, diferencias, cantidades fraccionarias, documentos, validación de migraciones y clasificación de fallos.
- `npm run test:ui`: **6 pruebas Chrome aprobadas**, incluidas notas/separación, serialización del guardado, conflicto 409, móvil, reconocimiento y visibilidad de una anulación hasta enviarla.
- `npm run test:sql`: **11 escenarios SQL aprobados**, incluida la reproducción de fallo de cola, rollback, concurrencia, corrección/reconocimiento, anulación directa con JSON válido, reintento idempotente, historial y liberación posterior al reconocimiento. El esquema temporal se eliminó al finalizar.
- `git diff --check`: sin errores de espacios o formato del parche.
- La aceptación física de impresión que estaba pendiente en esta fase quedó resuelta posteriormente en la Fase 23.

---

## Fase 23: Borrado comercial definitivo, cantidades e impresión RPT004 (Operativa en el cliente)

### Pedidos y mesas

- Un pedido existente cuyo detalle queda vacío elimina `Ticket_d` y después `Ticket_c` dentro de la misma transacción. La mesa vuelve inmediatamente a `Estado=1` si no tiene otro pedido activo.
- El flujo nuevo no escribe `Ticket_c.Estado=4`. `POST /api/pos/pedido` con detalle vacío y `DELETE /api/pos/comanda/:nro` comparten la misma operación idempotente.
- `Pedido_control`, `Pedido_lineas`, `Cocina_envios`, detalles, estados y trabajos de impresión se conservan como auditoría. Las líneas quedan de baja, los estados inactivos y los envíos históricos.
- El historial usa la cabecera JSON del envío cuando `Ticket_c` ya no existe; estos pedidos se presentan como anulados y desaparecen del tablero operativo.

### Cantidades e interfaz

- Las adiciones posteriores a un envío conservan GUID independientes para Cocina, pero las líneas con producto, precio e instrucciones idénticas se agrupan visualmente.
- El contador muestra la cantidad comercial total y la etiqueta `+N pendiente de enviar`; las instrucciones diferentes nunca se agrupan.
- El sidebar colapsado oculta el nombre del usuario, centra los iconos del pie y conserva el usuario mediante atributos accesibles.
- El ticket de Cocina admite documentos extensos mediante un cuerpo desplazable y acciones fijas. El botón Copiar fue reemplazado por Imprimir y reutiliza la reimpresión auditada e idempotente.

### 3nStar RPT004

- Transporte TCP ESC/POS implementado con `node:net`, codificación CP850, puerto configurable con valor inicial 9100, avance y corte automático.
- Configuración operativa: `PRINTER_PROTOCOL=escpos_tcp`, `PRINTER_HOST`, `PRINTER_PORT=9100`, `PRINTER_CODEPAGE=cp850`, `PRINTER_CUT=true` y `PRINTER_ENABLED=true`. La plantilla `.env.example` conserva `false` como valor seguro para instalaciones nuevas aún no validadas.
- La respuesta de Cocina incluye `envioId` y el último estado de impresión. El diálogo muestra cola, transmisión, error o estado incierto y bloquea duplicados mientras exista un trabajo pendiente.

### Validación

- Pruebas de dominio incluyen la trama ESC/POS y caracteres españoles.
- Pruebas de navegador cubren cantidad agrupada, borrado automático, sidebar colapsado, ticket de 100 líneas y doble clic de impresión.
- Pruebas SQL cubren eliminación de `Ticket_d`/`Ticket_c`, mesa libre, ausencia de estado 4, reintento idempotente y conservación del historial.
- Validación física completada en el cliente y `PRINTER_ENABLED=true` activado el 14/09/2026. Deben conservarse la IP fija o reserva DHCP, el puerto 9100, CP850 y la configuración de corte; cualquier cambio de red o impresora exige repetir la prueba física.

---

## Fase 24: Estados visibles de Cocina y cierre seguro de turnos (Implementada en código)

### Estados del producto y tiempo real

- `Cocina_estados` continúa como única fuente del progreso. Detalle Pedido presenta `Enviado a Cocina`, `En preparación`, `Listo en Cocina` y `Producto Entregado` para estados 1–4.
- Las líneas comerciales agrupadas muestran una etiqueta única cuando coinciden y un desglose por cantidades cuando tienen estados distintos. Las unidades aún no enviadas y las correcciones pendientes permanecen visibles por separado.
- `GET /api/pos/pedido/:nro/estados-cocina` devuelve únicamente metadatos de Cocina por `lineaId`. Los eventos SSE los fusionan sin reemplazar cantidades, precios, notas ni un borrador local.
- “Todo listo” y “Entregar” conservan las validaciones transaccionales existentes. El ticket entregado sale del tablero, mientras el POS puede consultar su estado 4.

### Cierre, archivo y retención

- La migración `005_cierres_turno.sql` crea `Cierres_turno`, `Cierre_turno_archivos` y `Cierre_turno_operaciones` sin modificar las tablas comerciales ni `Cocina_pedidos`.
- Cada cierre se limita a empresa, turno y fecha de negocio. Un bloqueo de aplicación e idempotency key evitan cierres simultáneos o duplicados.
- El cierre falla si encuentra pedidos comerciales activos, platos sin entregar, correcciones sin reconocer o trabajos de impresión en cola/procesando.
- Cada ticket elegible se archiva como JSON completo con hash SHA-256 individual y global. Las cabeceras de nuevos envíos incluyen `turno` y `fechaNegocio`; los históricos que carecen de ambos quedan pendientes de conciliación y fuera de la purga.
- El alcance cerrado rechaza pedidos nuevos y reimpresiones. Puede reabrirse antes de purgarse.
- La retención predeterminada es de 30 días. El trabajador revisa cierres vencidos al arrancar y cada seis horas, verifica los hashes y elimina exclusivamente las tablas auxiliares en orden de dependencias. Un error revierte la transacción, conserva el archivo y deja el cierre en estado `error`.
- `Ticket_c`, `Ticket_d`, `Mesas` y `Cocina_pedidos` nunca forman parte de esta purga.

### Seguridad e interfaz

- Las mutaciones requieren sesión, confirmación explícita y `MAINTENANCE_PIN_HASH`; bcrypt compara el PIN sin almacenarlo ni registrarlo. Cinco fallos bloquean nuevos intentos durante cinco minutos.
- La nueva vista **Cierre de Turno** muestra alcance, bloqueos, registros históricos no conciliables, retención y acciones habilitadas según el estado.
- Variables: `MAINTENANCE_PIN_HASH`, `KITCHEN_RETENTION_DAYS=30` y `KITCHEN_RETENTION_INTERVAL_MS=21600000`.

### Contratos

| Método y ruta | Contrato |
|---|---|
| GET `/api/pos/pedido/:nro/estados-cocina?empresa=X` | Estado, corrección y anulación por `lineaId`, sin sustituir el pedido local |
| GET `/api/admin/cierres/preview` | Alcance, tickets, bloqueos, históricos sin turno y cierre existente |
| POST `/api/admin/cierres` | Cierra y archiva con PIN, confirmación `CERRAR TURNO` y clave GUID |
| GET `/api/admin/cierres/:id` | Estado, conteos, hash global y hashes por ticket |
| POST `/api/admin/cierres/:id/reabrir` | Reabre antes de la purga con PIN y confirmación explícita |
| POST `/api/admin/cierres/:id/purgar` | Purga solo después de vencer la retención y superar la verificación de integridad |

### Validación de esta entrega (11/09/2026)

- `npm run check`: sintaxis validada, incluido el servicio de cierres.
- `npm test`: **14 pruebas aprobadas**, incluida la agregación homogénea/mixta de estados.
- `npm run test:ui`: **12 pruebas Chrome aprobadas**, incluidos Listo/Entregado, estados mixtos y pantalla protegida de cierre.
- `npm run test:sql`: **13 escenarios aprobados** en esquema aislado de `tempdb`, incluido estado 4 visible, reapertura, archivo/hash, bloqueo del turno, purga idempotente y conservación comercial/heredada.
- `git diff --check`: sin errores de formato.

---

## Fase 25: Rediseño responsive del detalle del pedido (Implementada en código; validación física pendiente)

### Experiencia adaptativa

- En celular (`≤480px`), Detalle del Pedido se abre como bottom-sheet casi a pantalla completa, respetando safe areas.
- En tablet (`481–1024px`), el pedido usa un drawer lateral superpuesto de hasta 560 px; al cerrarlo, los productos recuperan todo el ancho.
- En desktop se conserva el layout de dos columnas y el detalle adopta un ancho fluido entre 360 y 460 px.
- La misma instancia del carrito se reutiliza en todos los tamaños; no existen copias del pedido ni cambios en APIs, persistencia o reglas comerciales.

### Jerarquía y uso

- Cabecera fija con Historial, Limpiar y cierre explícito; lista como única región principal desplazable; Total, estado y acciones principales permanecen visibles en el pie.
- Subtotal e IGV se presentan en un desglose expandible en móvil/tablet y continúan visibles en desktop.
- Las líneas se adaptan como tarjetas con nombres y notas extensas, estados de Cocina, controles táctiles mínimos de 44 px y precio alineado sin desbordamiento.
- El pedido vacío tiene un estado visual explícito. La barra flotante conserva cantidad y total y funciona tanto en celular como en tablet.

### Accesibilidad y compatibilidad

- El drawer incorpora `aria-expanded`, `aria-hidden`, semántica de diálogo, foco inicial, trampa de foco, cierre por Escape/backdrop y retorno del foco al disparador.
- Al cerrar, navegar o cruzar el breakpoint de 1024 px se limpian clases, backdrop, scroll bloqueado y desglose expandido.
- Se preservan autoguardado, envío explícito, estados de Cocina, historial/impresión, preventa, modo solo lectura y resolución de conflictos 409.

### Corrección iPad Safari horizontal (12/09/2026)

- El iPad de 10 pulgadas en horizontal expone un viewport CSS cercano a 1194 px y por ello entraba incorrectamente al layout desktop anterior de `>1024px`.
- El modo tablet se amplió hasta 1200 px: tanto el menú principal como el detalle del pedido funcionan como drawers, dejando todo el ancho disponible al catálogo.
- Desktop comienza en 1201 px y conserva las dos columnas. No se usa detección por navegador o dispositivo.
- Los cambios de orientación cierran y normalizan ambos drawers, el backdrop, el bloqueo de scroll y el desglose de totales.

### Validación automatizada

- Playwright cubre 390×844, 440×956, 768×1024, 1024×1366, iPad Safari horizontal 1194×834, su rotación 834×1194 y desktop 1280×800.
- Se verifica altura útil mínima de la lista en móvil, ausencia de desbordamiento horizontal, drawer lateral de tablet, layout desktop, desglose, Escape, backdrop, foco y cambio de breakpoint.
- `npm run check`: aprobado. `npm test`: 14 pruebas aprobadas. `npm run test:ui`: 14 pruebas Chrome aprobadas.
- `npm run test:sql`: ejecutado dos veces; los escenarios previos avanzan hasta que falla la aserción histórica de pedido anulado en `test/sql-phase22.js:137`. Fase 25 no modifica backend, contratos ni SQL.
- Pendiente física: confirmar ergonomía final y comportamiento con barras/teclado reales en celular y tablet antes de marcar la fase como completada.

---

## Fase 26: Primera versión de producción y acceso tipo app (Operativa en el cliente)

### Alcance v1

- La primera salida habilita POS y Cocina en la LAN privada del restaurante.
- La primera salida se instaló inicialmente con impresión deshabilitada. Tras la validación física, el cliente opera con `PRINTER_ENABLED=true`, impresión automática y reimpresión disponibles.
- Cierre de Turno permanece oculto y sus endpoints responden 503 mientras no exista `MAINTENANCE_PIN_HASH`.

### Producción y seguridad

- Sesiones persistentes en la tabla auxiliar `Web_sessions`, con expiración, limpieza y cookie `httpOnly`/`SameSite=Lax`.
- Arranque bloqueado si faltan variables de BD, si `SESSION_SECRET` tiene menos de 32 caracteres o si se intenta habilitar impresión sin host.
- Login limitado a cinco fallos por IP durante una ventana de cinco minutos; errores internos ya no exponen mensajes SQL al navegador.
- Recursos Font Awesome servidos localmente, cabeceras defensivas, endpoint `GET /healthz`, apagado ordenado y healthcheck de Compose.
- Runtime de producción actualizado a Node 22 LTS para cumplir los requisitos de la cadena vigente de SQL Server.
- Dependencias directas sin uso eliminadas y auditoría npm sin vulnerabilidades conocidas al preparar la entrega.

### Acceso móvil

- Manifest web, metadatos Apple/Android e iconos 180/192/512 derivados del emblema Sedimcorp.
- Login con viewport adaptable y apertura `standalone` cuando el sistema operativo lo soporte.
- No se registra service worker en la v1: sobre IP HTTP no ofrece instalación PWA completa y los pedidos nunca deben aparentar guardado offline.

### Despliegue

- `actualizar.bat` ofrece un flujo cotidiano de tres pasos: descarga por `git pull --ff-only`, reconstrucción/reinicio con Compose y comprobación de salud. La salida extensa de catálogo, la confirmación escrita, el etiquetado y el rollback automático se retiraron del flujo del cliente; el preflight completo permanece disponible para soporte.
- `ACTUALIZACION_CLIENTE.md` documenta el ciclo estable de futuras mejoras, la conservación de `.env`, la comprobación de POS/KDS/impresión y la recuperación ante fallos. `PRODUCCION.md` conserva la instalación inicial y aceptación operativa.
- Las migraciones continúan siendo aditivas. Si una actualización falla, el script conserva el diagnóstico de Compose y soporte puede realizar la reversión manual cuando corresponda.
- Estado operativo confirmado: Compose, acceso desde celulares e impresión RPT004 funcionando en el cliente.
- Pendientes posteriores: HTTPS local, instalación PWA completa, autenticación moderna y activación de cierres.

---

## Fase 27: Total con IGV en ambas columnas de Ticket_d (Regla reemplazada por Fase 55)

### Regla comercial

- Para pedidos nuevos o pedidos activos que SedimApp vuelva a guardar, `Ticket_d.Precio` y `Ticket_d.Importe` contienen el mismo total de la línea, con IGV y cantidad incluidos.
- Ejemplo: precio base S/20.00, IGV 10.5% y cantidad 2 se registra como `Cantidad=2`, `Precio=44.20` e `Importe=44.20`.
- `Ticket_c.Total` continúa siendo la suma de `Ticket_d.Importe`; nunca se multiplica nuevamente `Precio` por `Cantidad`.

### Compatibilidad e históricos

- El precio unitario base se conserva en `Pedido_lineas.Datos.precio`, que sigue siendo la fuente para edición, recarga del POS y cálculo de IGV. Esto evita aplicar IGV o cantidad por segunda vez en la interfaz.
- No existe migración ni actualización masiva de `Ticket_d`: los registros históricos permanecen intactos.
- Un pedido activo adopta la regla nueva solamente cuando SedimApp lo guarda y reconstruye su detalle comercial.
- Los reportes y procedimientos externos deben tratar `Precio` como total de línea en las filas nuevas escritas por SedimApp.

### Validación

- La integración SQL conserva una fila histórica con `Precio=20.00` e `Importe=44.20` y exige que una fila nueva de dos unidades quede con `Precio=Importe=44.20`.
- La respuesta del POS continúa obteniendo el precio base desde `Pedido_lineas`, por lo que guardar y reabrir un pedido no duplica el IGV.

---

## Fase 28: Optimización móvil del catálogo y filtros POS (Implementada en código; validación física pendiente)

### Búsqueda con teclado virtual

- En celulares de hasta 480 px, enfocar el buscador activa un modo compacto que oculta temporalmente la cabecera, las categorías y la barra flotante del carrito.
- El catálogo usa `window.visualViewport` para ajustarse al espacio que Android o iOS dejan sobre el teclado, con fallback al viewport CSS y sin detección por dispositivo.
- El buscador permanece visible y la grilla conserva dos columnas con scroll propio. Al agregar un producto se mantienen el foco y la consulta para facilitar cargas repetidas.
- Las acciones **Limpiar búsqueda**, **Listo** y la tecla Enter permiten limpiar o cerrar el modo explícitamente. Navegar, rotar, superar el breakpoint o entrar en preventa restaura la interfaz normal.

### Filtros móviles

- Los grupos Empresa y Turno, el selector y el toggle limitan su ancho al panel disponible mediante `box-sizing`, `min-width` y `max-width`.
- Los nombres largos de empresa se truncan visualmente sin alterar su valor y los botones de turno pueden contraerse sin producir scroll horizontal.

### Validación

- Playwright cubre 320, 390 y 440 px de ancho: modo compacto, viewport reducido, foco y consulta persistentes, acciones de salida, rotación, navegación, preventa y ausencia de desbordamiento en los filtros.
- Pendiente física: confirmar apertura/cierre del teclado y altura útil del catálogo en Android Chrome e iPhone Safari, tanto en navegador como en modo standalone cuando esté disponible.

---

## Fase 29: Confirmación visual y cabecera compacta del POS móvil (Implementada en código; validación física pendiente)

### Confirmación de productos

- Cada toque muestra un check temporal en la tarjeta, un aviso único con producto y cantidad acumulada, y una animación en el contador de **Detalle** cuando está visible.
- El aviso dice **Agregado al pedido**, sin confundir la inserción local con el autoguardado posterior. Los toques rápidos actualizan el mismo mensaje y reinician sus temporizadores.
- La región usa semántica `status` y anuncios accesibles. Con movimientos reducidos conserva check, color y texto sin escalas ni desplazamientos.

### Cabecera y espacio útil

- En celulares de hasta 480 px, la cabecera inicia plegada y conserva visibles mesa, timer, mozo y comensales en dos filas compactas.
- Guardar, Reservar, Borrar y Liberar se muestran mediante un control con estado ARIA. Preventa fuerza la cabecera expandida para mantener disponibles su estado y reapertura.
- Padding, separaciones, categorías y buscador se compactaron sin reducir los controles táctiles por debajo de 44 px. Las tarjetas conservan dos columnas, tamaño y legibilidad.
- Navegar, cambiar de mesa, rotar o cruzar el breakpoint limpia confirmaciones y restablece la cabecera.

### Validación

- Playwright cubre toques repetidos, cantidad, aviso único, foco durante búsqueda, temporizadores, movimientos reducidos, expansión, ARIA, ganancia mínima de 48 px, preventa y desktop sin cambios.
- Pendiente física: validar claridad de la confirmación y cantidad de tarjetas visibles en Android Chrome e iPhone Safari.

---

## Fase 30: Nuevas notas rápidas de temperatura (Implementada en código)

- Se agregaron **Helada** y **Sin Helar** después de **Hielo aparte** en el selector de instrucciones de Cocina.
- Ambas opciones conservan el comportamiento multiselección existente y pasan por la misma validación, persistencia, historial e impresión que las demás notas rápidas.
- Las pruebas de dominio verifican aceptación, orden canónico e impresión; Playwright verifica las doce opciones y el guardado de las dos nuevas.

---

## Fase 31: Catálogo POS limitado a productos Tipo 3 (Implementada en código)

- Al abrir una mesa, el catálogo del POS muestra exclusivamente productos activos con `Productos.Tipo = 3`, conservando el filtro por empresa y línea.
- Las categorías del POS se obtienen del mismo conjunto de productos Tipo 3, por lo que no aparecen categorías que quedarían vacías en el catálogo.
- El cambio no afecta el mantenimiento de productos, las recetas ni las líneas de pedidos existentes o históricos.

---

## Fase 32: Organización visual del mapa de mesas (Implementada en código)

- El mapa deja de navegar por pisos y utiliza las agrupaciones como único filtro visual; todas las mesas de la empresa se presentan juntas sin reinterpretar ni modificar su `Ambiente` en la base de datos.
- En Cocinería, las mesas 81–120 se identifican como **Desayunos** mediante taza y pan. En las demás empresas conservan **Atención normal**, y el filtro Desayunos no se ofrece.
- Las mesas 201–209 se identifican como **Delivery**, 210–219 como **Para llevar**, 220–230 como **PedidosYa | Rappi**, 231–235 como **Descarte y obsequios** y desde la 236 como **Varios**. Los demás números conservan la presentación de atención normal.
- Los filtros de agrupación se adaptan como una grilla de dos columnas en celular y restablecen **Todos** si se cambia a una empresa que no admite la agrupación seleccionada.
- La clasificación es exclusivamente visual, se aplica a las tres empresas y no altera ambientes, estados, pedidos, endpoints ni persistencia.
- Los colores comerciales de Libre, Ocupada, Reservada, Unida, Preventa y No disponible permanecen intactos. La nueva jerarquía añade nombre, símbolo, número y estado con adaptación para móvil, tablet y escritorio.
- Los SVG oficiales de PedidosYa y Rappi se sirven localmente desde `public/icons/order-channels`; la alternativa tipográfica accesible permanece únicamente como tolerancia ante fallos de carga.
- Validación: `npm run check`, 20 pruebas de dominio y 25 pruebas Playwright aprobadas; la cobertura visual incluye límites 80/81/120/121, cambio de empresa y anchos de 320, 390, 440, 768, 1024, 1194 y 1280 px sin desbordamiento horizontal del documento, contenido o filtros.

---

## Fase 33: Agrupación compacta en el mapa de mesas (Implementada en código; validación física pendiente)

- En celular y tablet (`≤1200px`), la agrupación se presenta como una fila compacta con el filtro activo y un control accesible para desplegar sus opciones; en escritorio los botones permanecen visibles como antes.
- El panel inicia cerrado al entrar o regresar al mapa, al cambiar empresa o turno, al rotar y al cruzar desde escritorio al modo responsive. Elegir una agrupación actualiza el mapa y vuelve a cerrarlo para recuperar inmediatamente el espacio vertical.
- La selección activa se conserva al abrir un pedido y regresar. Si la nueva empresa no admite la agrupación seleccionada, se restablece **Todos** y se sincroniza el resumen compacto.
- El contenido cerrado sale del orden de foco mediante `hidden`; el disparador expone `aria-expanded` y `aria-controls`, conserva un objetivo táctil de al menos 44 px y respeta la preferencia de movimiento reducido.
- No cambian la clasificación, el orden, los estados, las tarjetas, las APIs ni la persistencia. La validación automatizada cubre 320, 390, 440, 768, 1024, 1194 y 1280 px; queda pendiente confirmar la ergonomía en celulares y tablets físicos.

---

## Fase 34: Resincronización al reactivar dispositivos (Implementada en código; validación física pendiente)

- Al volver del reposo, recuperar la conexión, restaurar la página desde caché o enfocar nuevamente la aplicación, el cliente valida la sesión, restablece SSE y consulta el estado vigente de la vista activa. SSE continúa dando inmediatez, mientras la API y la base de datos son la fuente de verdad para recuperar eventos perdidos durante la suspensión.
- Los eventos `visibilitychange`, `pageshow`, `online` y `focus` pasan por un coordinador con debounce, cooldown y bloqueo de concurrencia. No se agrega polling periódico, por lo que no aumenta el consumo continuo de batería, red o servidor.
- La conexión SSE mantiene una sola instancia y un solo temporizador de reintento, deja de reintentar cuando la página está oculta o sin red y se reabre inmediatamente después de una reactivación válida. Una sesión expirada redirige una sola vez al login.
- El mapa vuelve a consultar las mesas conservando empresa, turno y agrupación. Un contador de generación descarta respuestas antiguas si coinciden una reactivación, un evento SSE o un cambio rápido de filtros.
- Cocina actualiza silenciosamente el tablero o historial activo. Una orden limpia se vuelve a cargar; una orden con borrador, guardado, operación o diálogo activo nunca se sobrescribe y marca conflicto cuando la versión del servidor cambió.
- No se agregan endpoints, migraciones ni cambios de esquema. Se reutilizan `/api/session`, `/api/events`, `/api/pos/tables`, `/api/pos/pedido` y las consultas existentes de Cocina.
- Validación automatizada: `npm run check`, 20 pruebas de dominio y 30 pruebas Playwright aprobadas, incluidas reactivación deduplicada, conexión SSE única, mapa actualizado, filtros conservados, descarte de respuestas antiguas, Cocina, pedidos limpios, protección de borradores y sesión expirada.
- Pendiente física: bloquear y reactivar Android Chrome e iPhone Safari durante varios minutos, en navegador y modo standalone cuando esté disponible, mientras otra PC modifica mesas y pedidos.

---

## Fase 35: Diagnóstico y rendimiento de Mesas/Cocina (Implementada en código; medición productiva pendiente)

- Cada solicitud API recibe `X-Request-Id`; los errores devuelven `diagnosticId` y el servidor registra duración total, tiempo SQL, cantidad de consultas y errores sanitizados. Las solicitudes por encima de 750 ms se identifican como `slow_request`.
- El mapa y Cocina consolidan recargas concurrentes, cancelan la consulta anterior al cambiar de filtro y agrupan eventos SSE durante 200 ms. Un error conserva la información visible, muestra su referencia y permite reintentar sin `alert` modal.
- El autoguardado ya no recarga el mapa mientras está oculto y la configuración de IGV se obtiene una sola vez por sesión, fuera del camino crítico del mapa.
- Los `GET` de pedidos dejaron de abrir transacciones y de solicitar bloqueos exclusivos. Las escrituras conservan bloqueo por recurso, control de versión, idempotencia y transacción.
- Guardar pedidos valida productos en un lote y actualiza `Pedido_lineas`/`Ticket_d` mediante `OPENJSON`. Enviar a Cocina crea detalles y estados mediante otro lote, evitando consultas repetidas por producto o línea.
- `007_performance_indexes.sql` agrega índices únicamente a `Pedido_control`, `Cocina_estados` e `Impresion_trabajos`; no altera tablas comerciales.
- El pool principal queda preparado para diez dispositivos con máximo 20 conexiones. La impresora usa un pool aislado y transmite fuera de la transacción que reclama el trabajo, evitando bloquear solicitudes del POS.
- La sesión deja de reescribirse en SQL después de cada lectura; conserva el vencimiento no renovable de 24 horas ya utilizado por la cookie.
- Validación automatizada local: `npm run check`, 22 pruebas de dominio/configuración/migraciones y 32 pruebas Playwright aprobadas. La prueba SQL y las metas p95 deben ejecutarse contra SQL Server en la ventana de mantenimiento antes de promover la versión.
- Metas productivas: mesas API p95 <300 ms, Cocina API p95 <500 ms, guardado/envío de hasta 20 líneas p95 <1.5 s y cero HTTP 500 o esperas de pool en 30 minutos con diez dispositivos.

---

## Fase 36: Estabilización de búsqueda móvil y aislamiento de vistas (Implementada en código; validación productiva pendiente)

- La búsqueda de Chrome Android espera a que termine el gesto que enfoca el campo antes de reorganizar la pantalla. Una tarjeta solo agrega un producto si el gesto comenzó en esa misma tarjeta; los clics transferidos durante el cambio de viewport se descartan.
- Las lecturas de Mesas y Cocina reintentan una sola vez errores transitorios indicados por el servidor. Los timeouts SQL responden `504`, la indisponibilidad de conexión/pool y los deadlocks `503`, y los fallos inesperados `500`; todos conservan `diagnosticId` y declaran si son reintentables.
- Los avisos se buscan y crean exclusivamente dentro de su vista. Al navegar se aborta la lectura anterior, se invalida su generación y una respuesta tardía no puede alterar la vista nueva.
- Cocina conserva el último tablero válido. Una fila auxiliar con JSON inválido se registra de forma sanitizada y se presenta con datos seguros de conciliación sin derribar todo el Kanban; un fallo posterior a un evento de envío informa que el envío está registrado y la actualización sigue pendiente.
- El POS confirma cada envío exitoso con el identificador corto de `envioId`, sin reintentar automáticamente escrituras.
- Playwright separa el proyecto Chrome de escritorio de un proyecto Android/Pixel con soporte táctil. La cobertura incluye el toque inicial del buscador, agregado deliberado, avisos aislados y reintento transitorio único.
- Validación automatizada local: `npm run check`, 26 pruebas de dominio/configuración y 36 pruebas Playwright aprobadas.
- No se agregó ni modificó ninguna migración y no se alteró el esquema de tablas comerciales, del sistema ni auxiliares.
- La referencia productiva `6912435a-d4e2-482d-ba7a-9bbede71995b` no está disponible en el entorno local: Docker no tiene servicios activos. Debe correlacionarse en el servidor productivo antes del despliegue junto con la referencia emitida por Mesas.
- Pendiente productiva: revisar los logs correlacionados, ejecutar la integración SQL y la prueba de 30 minutos con diez dispositivos, validar Chrome Android físico y documentar la causa SQL exacta antes de promover la versión.

---

## Fase 37: Comandas independientes de Cocina y Barra (Operativa y validada en el cliente)

- Los productos cuyo catálogo cumple exactamente `Clinea=7 AND Tipo=3` se enrutan exclusivamente a Barra; el resto continúa en Cocina. La decisión se consulta en lote y se congela por `LineaId`, de modo que correcciones y anulaciones conservan el destino original aunque luego cambie el catálogo.
- Un envío mixto conserva un único registro canónico y un único Kanban, pero crea dentro de la misma transacción dos documentos filtrados e inmutables: **COMANDA DE COCINA** y **COMANDA DE BARRA**. Nunca se crean trabajos vacíos.
- `008_bar_printing.sql` crea únicamente las tablas auxiliares `Impresion_linea_rutas` e `Impresion_barra_trabajos`; no altera `Productos`, `Mesas`, `Ticket_c`, `Ticket_d`, `Tablas`, `Impresion_trabajos` ni otras tablas comerciales.
- Cocina y Barra tienen trabajadores, bloqueos, estados, reintentos y recuperación independientes. Las transmisiones TCP ocurren fuera de la transacción SQL y pueden ejecutarse simultáneamente; una impresora desconectada no detiene la otra ni el envío al Kanban.
- La API expone `impresiones[]` con destino, conserva `impresion` para compatibilidad con Cocina, incluye `destino` en SSE y acepta reimpresión por destino. POS, tablero e historial presentan estados y acciones separadas.
- El archivo y la purga de turnos incluyen la cola de Barra y las rutas inmutables. La vista anterior de la aplicación no debe ejecutar purgas durante un rollback porque desconoce esas dos tablas nuevas.
- Configuración operativa confirmada: `BAR_PRINTER_ENABLED=true`, `BAR_PRINTER_HOST=192.168.1.180`, ESC/POS TCP 9100, timeout 5 s, CP850, papel de 80 mm y corte habilitado.
- Validación completada en el cliente el 23/09/2026: impresión independiente de Cocina y Barra, pedido mixto correctamente separado, mismo ticket en ambos destinos y operación sin afectar el Kanban ni el flujo existente.
- Validación automatizada local: sintaxis, pruebas unitarias y Playwright aprobados, incluida la reimpresión independiente por destino. La prueba concurrente extendida con diez dispositivos y desconexiones deliberadas continúa disponible como control de estrés, no como bloqueo operativo.

---

## Fase 38: Diagnóstico guiado de la RPT004 de Barra (Operativo y validado físicamente)

- `diagnosticar-impresora-barra.bat` sustituye los comandos manuales incorrectos: lee únicamente host/puerto de Barra, prueba ICMP como información y exige conectividad TCP 9100 desde Windows y Docker.
- `npm run diagnose:bar` valida dentro del contenedor las variables no secretas, el protocolo ESC/POS, la migración `008`, ambas tablas auxiliares y los diez trabajos recientes sin mostrar documentos ni datos del pedido.
- La opción `--print` transmite una hoja técnica sin datos comerciales con tildes, `ñ`, ancho normal y corte. El archivo de Windows solicita confirmación antes de generar papel.
- El diagnóstico es estrictamente de lectura salvo por la transmisión física voluntaria: no crea ni actualiza tablas, trabajos, rutas o pedidos.
- Validación local: `npm run check`, 32 pruebas unitarias/configuración/migraciones aprobadas y `git diff --check` sin errores.
- Validación física completada el 23/09/2026: Windows y Docker alcanzaron la RPT004, TCP 9100 respondió, la trama ESC/POS imprimió correctamente, CP850 produjo tildes y `ñ`, y el corte funcionó. El diagnóstico queda disponible para futuras incidencias de red o reemplazo de impresora.

---

## Fase 39: Recuperación operativa y configuración privada estable (Operativa en el cliente)

- Tras eliminarse la carpeta del proyecto por una incidencia de hardware, el repositorio se clonó nuevamente y se restauró el `.env` privado, que permanece fuera de Git por diseño.
- La advertencia de Compose por `PORT` vacío y el error por `.env` ausente quedaron resueltos al recuperar el archivo en la raíz del proyecto. `DB_SERVER=host.docker.internal` permite que el contenedor alcance SQL Server en la misma máquina Windows.
- La configuración estable incluye servidor, secreto de sesión, conexión y pool SQL, Cocina, Barra, retención y las opciones HTTP de red local. No se registran valores privados en documentación ni en el repositorio.
- La ausencia temporal de usuarios se diagnosticó mediante `/api/users`: la aplicación y SQL respondían correctamente, pero la base local no tenía datos. El contenido fue recuperado sin requerir cambios de código.
- El flujo cotidiano vuelve a ser exclusivamente doble clic en `actualizar.bat`: conserva `.env`, descarga con `git pull --ff-only`, reconstruye/recrea el contenedor, espera el healthcheck y abre la aplicación.
- Continuidad operativa: mantener una copia segura y externa de `.env`, respaldos verificados de SQL Server y rotar `DB_PASS`/`SESSION_SECRET` si fueran expuestos; nunca documentar sus valores reales.

---

## Fase 40: Jerarquía visual ESC/POS de comandas (Operativa y validada en el cliente)

- El documento persistido en SQL continúa siendo texto plano, inmutable, sin bytes de control y con un máximo de 42 caracteres por línea. Los estilos se agregan exclusivamente al construir la trama ESC/POS.
- **COMANDA DE COCINA/BARRA**, ticket, mozo y productos se imprimen en negrita; las notas usan doble altura sin doble ancho. Los estados `ADICIÓN`, `CORRECCIÓN`, `ANULACIÓN`, `ANTES` y `AHORA` permanecen normales.
- Un analizador de la estructura confiable de la comanda aplica estilos también a continuaciones de productos/notas y a reimpresiones. Un documento histórico no reconocido conserva formato normal en vez de fallar.
- Negrita y tamaño se restablecen después de cada segmento y antes del avance/corte; CP850, caracteres españoles, TCP 9100, corte y enrutamiento por destino permanecen intactos.
- La hoja técnica de Barra incluye título, ticket, mozo, producto y nota ficticios para validar estilos sin imprimir datos comerciales.
- Publicada en `af87e6f`. Validación automatizada: `npm run check`, 34/34 pruebas unitarias y `git diff --check`; la impresión real permitió continuar el ajuste visual sobre ambas RPT004.

---

## Fase 41: Mesa y productos visibles a distancia (Operativa y validada en el cliente)

- La línea textual `Mesa ... / Mozo ...` se conserva sin cambios en SQL, pero durante la impresión se transforma visualmente en dos líneas: **Mesa** en negrita/doble altura y **Mozo** debajo en negrita/tamaño normal.
- Los productos y todas sus continuaciones usan negrita más doble altura, manteniendo ancho normal y 42 columnas para evitar cortes adicionales.
- Las notas conservan doble altura y agregan `ESC SP 1` (un punto de separación lateral por carácter); `ESC SP 0` restaura el espaciado inmediatamente después de cada línea.
- El reconocimiento especial de cabecera se limita al bloque anterior al primer separador, evitando interpretar como Mesa, Mozo o Ticket contenido que pertenezca al detalle.
- La trama restablece negrita, tamaño y espaciado antes del avance y corte. Cocina, Barra, reimpresiones, documentos históricos y fallback normal comparten el mismo renderizador.
- Publicada en `b38867a`. Validación automatizada: `npm run check`, 34/34 pruebas unitarias y `git diff --check`; la prueba física posterior confirmó la legibilidad y reveló únicamente la necesidad de mayor margen inferior.

---

## Fase 42: Margen inferior seguro antes del corte (Implementada y publicada; validación física final pendiente)

- El avance posterior al documento aumenta de tres a cinco líneas antes de enviar el comando de corte, dejando dos líneas adicionales para que el último contenido no quede al ras.
- El margen se aplica en la capa común de transporte y por ello cubre Cocina, Barra, reimpresiones y hoja técnica sin modificar documentos SQL ni colas.
- Las pruebas verifican cinco avances tanto con corte habilitado como deshabilitado y exigen que negrita, tamaño y espaciado se restablezcan antes del margen final.
- Publicada en `429ba49`. Validación automatizada: `npm run check`, 34/34 pruebas unitarias y `git diff --check` sin errores.
- No existen migraciones, variables nuevas, cambios de API, modificaciones comerciales ni cambios de enrutamiento en las Fases 40–42.
- Siguiente verificación: imprimir una comanda controlada en cada RPT004, confirmar margen suficiente sin desperdicio excesivo y conservar el flujo habitual de despliegue mediante `actualizar.bat`.

---

## Fase 43: Ajuste de legibilidad de comandas ESC/POS (Implementada en código; validación física pendiente)

- Las notas pasan de doble altura a altura normal y conservan `ESC SP 1`, incluida cualquier línea de continuación, para reducir su jerarquía sin perder legibilidad.
- Los productos conservan negrita y doble altura y agregan `ESC SP 1` en el nombre completo y sus continuaciones, separando visualmente caracteres que antes quedaban demasiado juntos.
- En la cabecera textual `Ticket ... / Envío N`, que permanece intacta en SQL, únicamente `Envío N` se presenta en negrita y doble altura. El analizador admite también la variante histórica sin tilde `Envio N`.
- Cada segmento restablece negrita, tamaño y espaciado; el restablecimiento final anterior al margen y corte permanece como protección adicional.
- El ajuste se aplica mediante el renderizador común a Cocina, Barra, impresiones automáticas, reimpresiones y hoja técnica. No cambia APIs, base de datos, migraciones, variables, colas, rutas ni documentos persistidos.
- Validación automatizada: pruebas de bytes ESC/POS para notas, productos, continuaciones, encabezado de envío, Barra, históricos y restauración de estilos; `npm test`, `npm run check` y `git diff --check`.
- Validación física pendiente: imprimir una comanda controlada en ambas RPT004, comprobar nombres/notas largos sin recorte y confirmar conjuntamente el margen inferior de la Fase 42.

---

## Fase 44: Comanda independiente de Bebidas (Implementada en código; validación física pendiente)

- Los productos con `Productos.Clinea=2`, independientemente de `Tipo`, se enrutan exclusivamente a **COMANDA DE BEBIDAS**. Cocina conserva los demás productos y Barra mantiene su regla `Clinea=7 AND Tipo=3`.
- El destino se congela por `LineaId` desde el primer envío; correcciones y anulaciones continúan en Cocina, Bebidas o Barra aunque posteriormente cambie el catálogo.
- `009_beverage_printing.sql` crea tablas auxiliares para los tres destinos de línea y para distinguir trabajos de Cocina/Bebidas dentro de `Impresion_trabajos`; migra las rutas y trabajos existentes como Cocina/Barra sin modificar tablas comerciales.
- Cocina y Bebidas comparten una sola cola física, worker y configuración `PRINTER_*`. Los trabajos se transmiten en serie y, dentro de un envío mixto, Cocina se inserta antes que Bebidas. Barra conserva su cola e impresora independientes.
- El envío canónico y el KDS continúan incluyendo todas las líneas. Solo se separan los documentos impresos e inmutables; nunca se crean comandas vacías.
- API, SSE, POS, tablero e historial reconocen el destino `bebidas`, muestran estados separados y permiten reimpresión idempotente de cada documento. `impresion` conserva su significado histórico de Cocina.
- El título **COMANDA DE BEBIDAS** recibe la misma jerarquía ESC/POS de las comandas actuales. CP850, notas, productos, encabezado, cinco líneas de margen y corte permanecen intactos.
- Archivo, conteos, hash y purga de turnos incluyen los nuevos destinos. No se agregan variables de entorno ni un tercer worker.
- Validación automatizada: 36/36 pruebas unitarias/configuración/migraciones, 37/37 pruebas Playwright y 16 escenarios de integración SQL aprobados; `npm run check` y `git diff --check` sin errores.
- Validación física pendiente: confirmar en la RPT004 de Cocina pedidos solo Cocina, solo Bebidas, Cocina+Bebidas y Cocina+Bebidas+Barra, además del orden del papel y las reimpresiones separadas.

---

## Fase 45: Resiliencia y rendimiento del Kanban de Cocina (Implementada en código; validación productiva pendiente)

- `GET /api/cocina/pedidos` materializa las líneas activas una sola vez y obtiene líneas, cabeceras y últimos trabajos de impresión en conjuntos separados. El documento de la comanda y las búsquedas de Cocina/Bebidas/Barra dejan de repetirse por cada producto.
- Una instantánea en memoria por empresa dura dos segundos y consolida todas las lecturas concurrentes. Cada actualización de Cocina incrementa su generación; una consulta iniciada antes de la escritura no puede volver a publicarse como vigente.
- Ante timeouts, deadlocks o indisponibilidad SQL, el servidor devuelve el último tablero válido con hora y referencia de diagnóstico. Los errores inesperados y el primer fallo sin instantánea conservan su respuesta de error normal.
- El cliente mantiene las comandas visibles, informa que los datos están desactualizados y reintenta a los 2, 5, 10 y 15 segundos. Los reintentos se pausan fuera de la vista, sin red o al cambiar de módulo, y se restablecen después de una lectura actual.
- Los logs `kitchen_snapshot` distinguen lecturas SQL, caché vigente, consultas compartidas, invalidaciones y recuperaciones desactualizadas sin registrar comandas ni datos comerciales.
- `npm run diagnose:kitchen -- --empresa=2` revisa de forma estrictamente lectora las migraciones `007`/`009`, índices auxiliares, aislamiento, volúmenes, bloqueos visibles y duración puntual del KDS sin mostrar contenido del pedido.
- No se agregan migraciones, variables, tablas ni cambios de impresión. Tampoco se aumenta el timeout, se usa `NOLOCK` o se modifica el aislamiento global de SQL Server.
- Validación productiva pendiente: correlacionar la referencia `118bed9f-19ef-4453-a09e-ed45edab3f96`, ejecutar el diagnóstico en el servidor del cliente y medir durante 30 minutos con diez dispositivos la meta p95 menor de 500 ms y ausencia de tableros vaciados.

---

## Fase 46: Reparación de esquema y navegación segura del POS (Implementada en código; validación en cliente pendiente)

- El diagnóstico de la base configurada confirmó una instalación sin `009_beverage_printing.sql`, condición que hace fallar con `500` a Cocina y al detalle POS porque ambos requieren las tablas de destinos de Bebidas. La correlación exacta de la referencia del cliente `56bb6954-0997-4801-889d-dda0ad141ecc` queda pendiente de revisar sus logs durante el despliegue.
- `010_repair_beverage_destinations.sql` recrea de forma aditiva e idempotente las tablas e índices de destinos y completa las rutas históricas sin modificar tablas comerciales, comandas ni estados operativos.
- El arranque valida migraciones, tablas e índices críticos después de migrar. `/healthz` solo responde correctamente con el esquema completo; `actualizar.bat` muestra automáticamente los últimos logs cuando el contenedor no alcanza ese estado.
- El diagnóstico de Cocina comprueba ahora `009/010`, Cocina, Bebidas y Barra antes de medir el Kanban, y nunca muestra contenido comercial.
- Los errores al cargar una mesa se separan de los conflictos de edición. Presentan **Reintentar carga**, conservan el pedido bloqueado para edición y permiten regresar al mapa.
- Regresar cancela respuestas pendientes, limpia el contexto y funciona directamente en preventas. Un guardado normal termina antes de salir; un conflicto con borrador solicita confirmación antes de descartar únicamente los cambios locales; una escritura activa muestra una explicación en lugar de ignorar el botón.
- La navegación invalida respuestas tardías para que una consulta iniciada en una mesa no pueda modificar otra vista después de regresar.
- Se mantienen la caché y reintentos de la Fase 45, las comandas separadas de la Fase 44 y todos los contratos comerciales existentes. No se aumentan timeouts, no se usa `NOLOCK` y no cambia el aislamiento SQL.

---

## Fase 47: Compatibilidad de intercalaciones SQL en Cocina (Implementada en código; validación en cliente pendiente)

- El error SQL `468` quedó identificado como una diferencia entre la intercalación `Modern_Spanish_CI_AS` de la base comercial y `SQL_Latin1_General_CP1_CI_AS` de `tempdb`; SQL Server nativo en Windows no es por sí mismo la causa.
- Las claves textuales de `#ActiveLines` y `#ActiveTickets` usan `COLLATE DATABASE_DEFAULT`, evitando conversiones sobre las tablas comerciales y sin fijar una intercalación regional en el código.
- El diagnóstico de Cocina informa versión, compatibilidad e intercalaciones de instancia, base y `tempdb`, además de validar esquema y ejecutar una lectura real del Kanban sin mostrar contenido comercial.
- `actualizar.bat` solo declara la actualización correcta después de que la lectura funcional de Cocina termina satisfactoriamente; ante un fallo muestra el diagnóstico y los logs sin modificar datos ni revertir la instalación automáticamente.
- El error `468` se registra como `sql_collation_conflict`, responde `500` sin reintento automático y conserva el contrato público y la referencia de diagnóstico.
- Se añadió la etiqueta web estándar para eliminar la advertencia de capacidad móvil; no estaba relacionada con el fallo de Cocina.
- No se alteran la base, `tempdb`, tablas comerciales, migraciones, documentos, impresión, caché ni estados operativos.

---

## Fase 48: Conciliación comercial, limpieza atómica y entrega desacoplada (Implementada en código; validación en cliente pendiente)

- SedimApp conserva autoridad sobre `Ticket_c`/`Ticket_d` antes de Preventa. Desde Preventa el POS local puede procesar el detalle comercial, mientras Cocina continúa exclusivamente con `Pedido_lineas`, `Cocina_estados` y `Cocina_envios`.
- Preparar, reconocer, marcar listo y entregar ya no validan `SnapshotComercial`. Reabrir una Preventa sí exige conciliación para no devolver a edición un detalle modificado por el POS local.
- La comparación comercial es canónica: normaliza espacios, decimales y orden de filas, calcula hashes SHA-256 y distingue diferencias reales de cambios de representación. `GET /api/pos/pedido` devuelve `conciliacionComercial` y permite mostrar el pedido divergente en modo seguro.
- Las escrituras comerciales divergentes responden `409` con `errorCode=COMMERCIAL_CONFLICT`. Los errores SQL clasificados incluyen un código estable y la referencia de diagnóstico sin exponer el contenido del pedido.
- Limpiar, borrar la última línea y Borrar Comanda usan la misma eliminación transaccional e idempotente. La interfaz conserva el carrito hasta confirmar el commit; una eliminación explícita puede descartar un detalle divergente, deja registro de hashes, conserva la auditoría de Cocina y libera la mesa solamente si no existe otro pedido activo.
- Las uniones entre tablas comerciales y auxiliares aplican `COLLATE DATABASE_DEFAULT` de forma explícita en pedidos, Kanban, historial, cierres y herramientas de recuperación.
- `npm run diagnose:order -- --empresa 2 --mesa N` exporta un respaldo y compara hashes sin modificar datos. La restauración controlada exige ticket explícito: `npm run diagnose:order -- --empresa 2 --ticket T001-NNNNNN --apply`; solo admite Estado 1 y reconstruye el detalle comercial desde las líneas web.
- Validación automatizada: normalización semántica, códigos de error, conservación del carrito ante fallo, eliminación desde conflicto y entrega posterior al traspaso a Preventa. La integración SQL requiere una instancia de validación disponible y nunca debe ejecutarse contra datos operativos durante atención.
- Corrección de despliegue: el diagnóstico productivo detectó SQL `207` porque la consulta del Kanban utilizaba `e.Cabecera` sin proyectarla en su `OUTER APPLY`. La proyección incluye ahora `ce.Cabecera`; no requiere migración ni modifica datos.

---

## Fase 49: Contexto canónico de empresa en Pedidos (Implementada en código; validación en cliente pendiente)

- Las empresas públicas `2/02`, `4/04` y `6/06` se normalizan en un único catálogo de servidor con sus filas de correlativo `1`, `2` y `5`. Valores ambiguos responden `400 INVALID_COMPANY`; una mesa ajena responde `409 COMPANY_CONTEXT_MISMATCH`.
- El mapa devuelve `Empresa` numérica y el filtro seleccionado es la autoridad al abrir una mesa. El pedido conserva un único valor canónico para carga, guardado, Cocina, Preventa, limpieza, historial y SSE.
- Un contexto inválido pausa autoguardado y recargas, mantiene el carrito y exige reintento o descarte explícito del borrador antes de volver al mapa.
- Los rechazos controlados registran referencia, ruta, método, tipo/valor acotado de empresa y mesa, sin detalle comercial. HTML y JavaScript se revalidan después de cada despliegue.
- `npm run diagnose:pos -- --empresa=2` comprueba, sin escrituras, la normalización, el correlativo y una mesa. `actualizar.bat` exige este diagnóstico antes de comprobar Cocina y declarar éxito.
- No incluye migraciones ni cambios de datos comerciales.

---

## Fase 50: Recuperación auditada de residuos que bloquean el correlativo (Implementada en código; validación en cliente pendiente)

- `Tablas`, con `n_codtabla=23` y la fila correspondiente a cada empresa, continúa siendo la única autoridad del correlativo. La aplicación toma su `c_describe`, incrementa exactamente una unidad y no busca máximos alternativos en tablas comerciales o auxiliares.
- Antes de crear el ticket siguiente, la misma transacción comprueba si ese número está ocupado. Un ticket comercial existente o cualquier evidencia de actividad operativa responde `409 TICKET_SEQUENCE_CONFLICT`, no avanza `Tablas` y no elimina datos.
- La recuperación automática se limita a un residuo auxiliar huérfano: `Pedido_control` de la misma empresa, sin `Ticket_c`, sin `Ticket_d`, con `UltimoEnvio=0`, sin `Cocina_envios` y sin `Cocina_estados`.
- El residuo y sus líneas/rutas se serializan en `Pedido_residuos_archivo`, se protegen con SHA-256 y solo entonces se retiran de las tablas activas. Archivo, limpieza, avance de `Tablas` y creación del nuevo pedido comparten un único commit; cualquier fallo revierte el conjunto completo.
- La migración `011_ticket_residue_archive.sql` crea únicamente la tabla e índice auxiliares de auditoría. No altera `Ticket_c`, `Ticket_d`, `Tablas`, `Mesas`, `Productos` ni pedidos existentes durante el despliegue.
- Los conflictos SQL de clave única `2601/2627` se clasifican como `409 SQL_UNIQUE_CONFLICT`, evitando presentarlos como un fallo interno reintentable.
- El escenario productivo confirmado `T001-251595` cumple el perfil recuperable: empresa 2, versión 5, cuatro líneas auxiliares, sin cabecera/detalle comercial, envíos, estados, impresiones ni archivos de cierre. Su primera creación posterior al despliegue conservará una copia auditable del residuo y utilizará exactamente `T001-251595`.
- No se autorizan borrados SQL manuales ni recuperación masiva. La prueba de integración cubre el residuo recuperable y el bloqueo de un registro con actividad sin modificar el correlativo.

---

## Fase 51: Empleados de plataformas en mesas 220–230 (Implementada en código; validación en cliente pendiente)

- En Empresa 2, las mesas 220–230 ofrecen únicamente los empleados activos 195 (PEDIDOS YA) y 203 (RAPPI), sin selección inicial. Las demás mesas conservan mozos activos `Tipo=3`, excluyendo esos códigos.
- La consulta de empleados y el guardado aplican la misma regla en el servidor. Un empleado fuera de alcance se rechaza antes de crear o modificar el pedido.
- Al cambiar de mesa se limpia la selección anterior. No hay migraciones ni cambios en Cocina, impresión o tablas comerciales.
- Validación automatizada: límites del rango, ambas plataformas, selección obligatoria, mesas vecinas y otra empresa. Falta corroborar los dos empleados y guardar una comanda de prueba en el cliente.

---

## Fase 52: Búsqueda estable y espacio útil en tablets (Implementada en código; validación física pendiente)

- Los cambios exclusivos de altura al abrir/cerrar el teclado ya no reinician el buscador ni interpretan una falsa rotación. La limpieza de búsqueda y drawers se limita a cambios de ancho o del ángulo de orientación reportado por el dispositivo.
- Menú, mapa y detalle comparten el criterio adaptable: hasta 1200 px en todos los dispositivos y hasta 1400 px cuando el puntero principal es táctil. Esto cubre tablets que presentan un viewport ancho como el observado en la Galaxy Tab A11 sin cambiar el escritorio con ratón de 1280 px.
- El catálogo recupera el ancho del menú fijo y del detalle cerrado. En tablet el detalle abre un panel lateral de hasta 680 px o 96% del viewport, con cabecera y pie compactos, desglose plegable y lista desplazable. Se conserva una sola instancia del carrito.
- La cabecera del catálogo reduce padding y separación y el contenedor aprovecha mejor la altura disponible. Los controles principales mantienen al menos 44 px y el diseño de celular conserva sus reglas.
- Los enlaces de las dos hojas de estilo incluyen versión 52 para evitar reutilizar estilos anteriores después de actualizar.
- No se modifican backend, API, migraciones, persistencia, lógica comercial, autoguardado, Cocina ni impresión en esta fase. Se respetan los cambios locales anteriores de la Fase 51.
- Validación: comprobación de sintaxis, 60/60 pruebas unitarias y 55/55 pruebas Playwright aprobadas. Playwright cubre foco/texto durante reducción y recuperación de altura, rotación real, tablet táctil de 1340 px, amplitud/altura útil del detalle y regresiones existentes de celular/escritorio y operaciones del pedido.
- Pendiente física: comprobar en la Tab A11 Chrome y acceso tipo app, vertical/horizontal, teclado Samsung, pedidos largos, notas, envío explícito y Preventa antes de dar por validada la fase en el cliente. La emulación del navegador no reproduce el teclado Android físico.

---

## Fase 53: Confirmación al eliminar productos del pedido (Implementada en código; validación física pendiente)

- La X solicita confirmación con nombre y cantidad antes de eliminar toda la fila agrupada. El botón “−” confirma cuando su reducción eliminaría una línea, incluidas cantidades fraccionarias; las demás reducciones son inmediatas.
- El diálogo nativo muestra Cancelar / Eliminar, enfoca Cancelar, admite Escape y cierre sin cambios y restaura el foco. Tiene ancho máximo de 440 px, texto ajustable y controles de al menos 44 px sobre los paneles de computadora, tablet y celular.
- Si el pedido queda vacío, advierte su eliminación y la liberación de mesa conforme a las reglas existentes. Los productos enviados explican la conservación del flujo de anulaciones e historial de Cocina.
- La selección conserva los identificadores de línea y el contexto de empresa/mesa. Antes de ejecutar comprueba cantidades, notas, estado enviado, restricciones y contexto; una selección desactualizada se cancela y solicita volver a seleccionar.
- Abrir o cancelar no modifica el carrito ni programa guardados de eliminación. El último producto persistido utiliza el borrado transaccional existente, conserva el carrito ante fallo y permite el reintento habitual; las eliminaciones parciales mantienen el autoguardado.
- Se mantienen las confirmaciones de Limpiar y Borrar Comanda. No hay cambios de backend, API, dependencias ni migraciones. Los recursos modificados usan versión 53.
- Validación automatizada: cancelación, Escape, cierre, foco, filas agrupadas enviadas/nuevas, notas diferentes, cantidades fraccionarias, invalidación de contexto/solo lectura, doble ejecución, fallo y reintento del último producto, texto literal y tamaños de computadora/tablet/celular.
- Verificación: 60/60 pruebas unitarias y 63/63 pruebas Playwright aprobadas; `npm run check` y `git diff --check` sin errores.
- Validación física pendiente: Galaxy Tab A11 y celular en vertical/horizontal con el detalle abierto; teclado, lectura del mensaje y alcance cómodo de ambos botones.

---

## Fase 54: Código de referencia en comandas (Implementada en código; validación física pendiente)

- Delivery (201–209), Para llevar (210–219) y PedidosYa | Rappi (220–230) muestran **Código de pedido** en la cabecera del detalle, en las tres empresas. En escritorio se integra con los datos de mesa; en tablet/celular ocupa una fila completa fuera de las acciones plegables, con entrada de al menos 44 px.
- Admite hasta 30 letras ASCII, números, guion y guion bajo; recorta espacios exteriores y conserva mayúsculas, minúsculas y ceros iniciales. Permite guardar sin código, pero lo exige antes de un envío explícito nuevo. Los errores `ORDER_CODE_REQUIRED` / `INVALID_ORDER_CODE` responden 400 sin registrar envíos ni trabajos.
- El código pertenece al pedido y utiliza el autoguardado, transacción, versión y SSE existentes. `POST /api/pos/pedido` acepta `codigoPedido`; omitirlo conserva el valor, null/vacío lo limpia y la respuesta devuelve `pedido.CodigoPedido`. Un código no vacío fuera de esas mesas se rechaza.
- La interfaz conserva el borrador ante fallos/conflictos y evita que un guardado anterior sobrescriba una edición posterior. Ingresarlo sin productos no crea tickets. Preventa lo muestra en solo lectura, reapertura permite corregirlo y el cambio de mesa o eliminación limpia la referencia local.
- Cada envío captura el código en `Cocina_envios.Cabecera` y en sus documentos generales y por destino Cocina/Bebidas/Barra. La línea **Código: …** aparece debajo de mesa/mozo, antes de fecha y detalle, en negrita de tamaño normal. Se mantienen jerarquía, ancho y corte actuales.
- Corregir solamente el código no genera novedades de Cocina. Los siguientes envíos usan el valor actualizado; reimpresiones y reintentos idempotentes conservan el documento original. Los históricos sin código permanecen intactos.
- Borrar Comanda, Limpiar y sus anulaciones automáticas no exigen completar la referencia; utilizan la existente cuando está disponible. No se añade una obligación independiente a Preventa ni se cambian KDS, correlativo, totales o selección especial de empleados.
- `012_order_reference_code.sql` agrega idempotentemente `CodigoPedido VARCHAR(30) NULL` a `Pedido_control`, sin modificar esquemas comerciales. La política de migraciones permite exclusivamente esa instrucción para ese archivo; mantiene el bloqueo de las demás alteraciones. El arranque comprueba migración y columna. Los recursos modificados usan versión 54.
- Validación: `npm run check`, 63/63 pruebas unitarias, 66/66 pruebas Playwright de la suite completa y dos pruebas adicionales aprobadas individualmente (68 escenarios de interfaz en total), 22/22 escenarios SQL y `git diff --check`. SQL utiliza un esquema aislado en tempdb, ejecuta las migraciones dos veces y elimina únicamente sus fixtures al terminar.
- Cobertura nueva: formato/límites, mesas elegibles y vecinas, documentos de tres destinos/empresas, rechazo de envío vacío, persistencia y campo omitido, limpieza explícita, edición durante guardado, conflicto conservando borrador, Preventa/reapertura, variación de altura por teclado y anchos 390/768/1280 px. Se conservan las regresiones de tablet táctil, selección de plataformas y reimpresión por destino.
- Pendiente en cliente: aplicar la actualización habitual y comprobar tablet/celular en vertical/horizontal con teclado físico; imprimir una comanda real de cada destino habilitado, corregir el código y verificar un envío posterior y una reimpresión del original. No se ha desplegado esta fase ni realizado una impresión física desde estas pruebas.


---

## Fase 55: Precio unitario correcto en Ticket_d (Implementada en código; validación contable en cliente pendiente)

- Reemplaza la regla comercial de la Fase 27: `Ticket_d.Precio` conserva el precio **unitario final con IGV**; `Importe` conserva el total de la línea. Ejemplo: cantidad 1/2/3, unitario S/13.06, importes S/13.06 / S/26.12 / S/39.18.
- Backend, cálculo de importes y presentación del unitario comparten `unitPrice` en `public/order-math.js`. Parte del precio base de `Pedido_lineas`, aplica `Valores.Igvv` solamente a productos afectos y redondea el unitario a dos decimales. No divide importe entre cantidad para reconstruirlo.
- La persistencia comercial envía precio e importe separados a SQL y agrupa por producto, precio base y afectación. Mantiene la distribución de centavos entre variantes con notas/cantidades fraccionarias y `Ticket_c.Total` como suma de importes.
- No hay cambios al contrato público: `items.Precio` continúa siendo el precio base auxiliar para edición/recarga, evitando duplicar IGV. No se alteran código de pedido, autoguardado, documentos impresos ni estados de Cocina.
- La comparación comercial previa conserva la instantánea original; un pedido divergente sigue protegido por `COMMERCIAL_CONFLICT`. Tras guardar, detalle y snapshot actualizado comparten el mismo commit y versión. La restauración comercial explícita utiliza también la regla corregida y conserva sus restricciones existentes.
- Los nuevos pedidos y los activos editables adoptan la corrección al guardarse. No hay migración, reparación masiva ni cambios de históricos/preventas durante despliegue. La base unitaria de líneas ya existentes se conserva.
- Los scripts de presentación y cálculo usan versión 55 para evitar caché de JavaScript anterior.
- Validación SQL en tempdb aislado: cantidades 1/2/3 y reducción, recarga con base intacta, conversión al guardar de un borrador íntegro de Fase 27, fracciones con notas, afectos/exentos, precio cero, IGV configurable, rollback del detalle ante fallo y rechazo de discrepancia externa. La prueba previa de dos unidades/base S/20/IGV 10.5% exige ahora `Precio=22.10`, `Importe=44.20`.
- Verificación: `npm run check`, `git diff --check`, 65/65 pruebas unitarias y 23/23 escenarios SQL aprobados. Playwright: 68/68 pruebas de la suite completa y una prueba adicional de estabilidad de unitario/total al aumentar cantidad y recargar (69 escenarios en total).
- Pendiente en cliente: comprobar un pedido con una y dos unidades en `Ticket_d`, total visible y lectura del POS contable. Esta fase no se declara validada contablemente ni desplegada por las pruebas locales.

---

## Fase 56: Estabilidad y fluidez del POS (Implementada en código; validación física pendiente)

- Al abrir una mesa, el selector muestra **Cargando mesero…** y bloquea su interacción hasta resolver empleados y pedido. Aplica una sola selección final: mesero guardado para pedidos existentes, primer empleado para mesas nuevas normales y selección manual para plataformas según la Fase 51.
- Un mesero guardado que ya no está disponible exige seleccionar uno válido; nunca se sustituye automáticamente al guardar. Si falla la consulta de empleados, Reintentar recupera la lista y la asignación sin descartar los productos del borrador. Las respuestas tardías de empleados, categorías y productos verifican la generación y el contexto de apertura.
- Se reprodujo con el código anterior el cierre del detalle después de borrar la búsqueda y cambiar el ancho del viewport. Los cambios de altura, ancho u orientación mantienen el detalle abierto mientras el diseño siga siendo compacto; el escritorio muestra el detalle integrado. Botón, fondo, Escape y navegación mantienen sus cierres habituales.
- SSE y la reactivación de la misma mesa conservan detalle, búsqueda, categoría y desplazamiento, sin reiniciar el catálogo ya cargado. El carrito conserva también un desplazamiento realizado durante una respuesta lenta. Se mantienen las protecciones de borrador, guardado, operaciones y diálogos; una sincronización durante la carga del catálogo solicita la versión vigente y descarta respuestas anteriores.
- Las tarjetas se reutilizan por código dentro del catálogo, se insertan en bloque y comparten eventos delegados. Se conserva la activación por teclado, selección táctil y protección contra gestos cancelados o toques que abren el buscador. Al cambiar de contexto se limpia el catálogo anterior antes de permitir nuevas selecciones.
- Agregar un producto actualiza el carrito una sola vez y muestra feedback sin lecturas forzadas de layout. Las animaciones usan Web Animations y respetan movimiento reducido; los totales evitan escrituras redundantes y la reconciliación de filas utiliza índices del recorrido.
- Medición comparable en Chrome headless, viewport 768×1024, sin limitación artificial de CPU: catálogos de 100/500/1000 productos y 20 selecciones por catálogo. La mediana de feedback en 1000 productos pasó de aproximadamente 4.7 ms a 0.1 ms; el renderizado repetido del catálogo pasó de 4.4 ms a aproximadamente 0.3 ms por reutilización. La aceptación comprueba al menos 19/20 selecciones por debajo de 100 ms, cantidades persistidas y total exacto de S/442.00. Estas mediciones corresponden a emulación y no representan tiempos del hardware Android físico.
- No hay cambios de backend, contrato HTTP, dependencias, migraciones, correlativos, cálculo comercial, Cocina ni impresión. Se mantienen las regresiones de Preventa, eliminación confirmada, código de pedido y precio unitario. Los scripts modificados usan versión 56 para evitar caché anterior.
- Verificación final: `npm run check`, `git diff --check`, 65/65 pruebas unitarias y 84/84 pruebas Playwright aprobadas. Cobertura nueva: asignación guardada distinta del primer mesero, carga lenta, empleado ausente y reintento conservando borrador, respuestas cruzadas entre mesas, búsqueda borrada manualmente/X en 390/800 px, teclado/rotación, sincronización lenta con desplazamiento y foco conservados, catálogo tardío, reutilización de tarjetas, teclado y toques Android. Las 60 selecciones del benchmark quedaron por debajo de 100 ms.
- Pendiente en cliente: instalar mediante el procedimiento habitual de `ACTUALIZACION_CLIENTE.md` una vez publicada la actualización; comprobar tablet y celular en vertical/horizontal, teclado físico, búsqueda borrada manualmente y mediante X, detalle abierto durante sincronización y selección rápida con catálogo completo. Esta fase no se declara desplegada ni validada físicamente; las pendientes de fases anteriores se conservan.

---

## Fase 57: Buscador de empleados para Descarte y obsequios (Implementada en código; validación física pendiente)

- Las mesas 231–235 de las tres empresas ofrecen empleados activos de la empresa seleccionada, de cualquier `Tipo`, incluidos los que no son mozos. Se mantienen `Empresa` y `FecCese IS NULL` en consulta y guardado, y se conservan las reglas de plataformas 220–230 y mesas normales fuera del rango.
- Las mesas nuevas del grupo empiezan con **Seleccione empleado**, sin selección automática. Elegir un empleado sin productos no crea tickets; si hay productos o pedido existente, utiliza el autoguardado. La asignación existente se recupera sin mostrar primero otro empleado, y la selección se conserva al cancelar.
- El diálogo **Seleccionar empleado** filtra localmente por código parcial/completo o nombre, ignorando mayúsculas y tildes. Cada resultado muestra código y nombre, distingue homónimos y prioriza la coincidencia exacta de código. Los nombres se insertan como texto literal, sin interpretar HTML.
- Buscador con limpieza, resultados desplazables, estados de carga/sin coincidencias/lista vacía, reintento y controles de al menos 44 px. Ancho máximo de 560 px o 96% del viewport; la altura y posición siguen el viewport visual del teclado. Respeta los temas claro y oscuro. Soporta escritorio, tablet y celular, Tab/Enter/Escape, Cancelar, botón de cierre y fondo; devuelve el foco al selector.
- La generación y el contexto de empresa/mesa invalidan selecciones y respuestas tardías. Un fallo o reintento de empleados conserva el borrador; los diálogos abiertos mantienen las protecciones SSE de la Fase 56. Preventa muestra la asignación en solo lectura y permite buscar/corregir al reabrir.
- `GET /api/pos/mozos?empresa=…&mesa=…` mantiene la respuesta `Codemp`/`Nombre`; el guardado mantiene `mozo` y escribe el `Codemp` seleccionado en `Ticket_c.Mozo`. Ambos utilizan la misma regla de elegibilidad; la persistencia usa directamente el código validado y la respuesta del guardado devuelve la asignación actualizada. El servidor rechaza empleados cesados, inexistentes, de otra empresa o selección ausente antes de modificar el pedido o avanzar el correlativo.
- No requiere migraciones, nuevas dependencias ni cambios de esquema; se conservan precios, totales, correlativos, Cocina e impresión. Los recursos de interfaz modificados usan versión 57. Se conservan los cambios locales y pendientes de validación de las fases anteriores.
- Validación SQL en un esquema exclusivo de tempdb: consulta de empleados de cualquier tipo, creación/actualización/recarga en 231 y 235 de las tres empresas, rechazo de empleado cesado, cambio de cese posterior, otra empresa, código inexistente y selección ausente, sin modificar pedido/versiones/detalle/correlativo; límites 230/236 conservan restricciones. El esquema de pruebas se elimina al terminar; no se modifica la base comercial configurada.
- Verificación final: `npm run check`, `git diff --check`, 66/66 pruebas unitarias, 95/95 pruebas Playwright y 28/28 escenarios SQL aprobados. Se revisaron capturas de celular/tablet y tema oscuro. La cobertura incluye búsquedas con tildes y códigos parciales/exactos, homónimos, nombres como texto literal, selección obligatoria, cancelación/foco, teclado y selección táctil, lista vacía, reintento tardío, invalidación por contexto, recarga y Preventa/reapertura, junto con las regresiones de la Fase 56.
- Pendiente en cliente: publicar e instalar mediante `ACTUALIZACION_CLIENTE.md`; verificar empleados reales por empresa y guardar/recargar un pedido de prueba en 231–235. Comprobar tablet y celular en vertical/horizontal con teclado físico, homónimos, código completo/parcial, cancelación y Preventa/reapertura. La emulación no sustituye esta validación y la fase no se declara desplegada.

---

## Fase 58: Todos los empleados en Descarte y obsequios (Implementada en código; validación física pendiente)

- Sustituye la restricción de empresa y actividad de la Fase 57 únicamente para mesas 231–235 de las tres empresas. El buscador ofrece todos los registros de `Empleados`, sin filtros por `Empresa`, `Tipo` o `FecCese`, incluidos cesados, empleados de otras empresas y empleados sin empresa asignada.
- Consulta y guardado comparten la condición completa de elegibilidad. En este grupo se exige solamente un `Codemp` existente y una selección explícita; fuera del rango se conservan empresa, actividad, Tipo 3 y las reglas específicas de plataformas. Los códigos inexistentes o selección ausente se rechazan antes de modificar pedido o correlativo.
- El endpoint y la respuesta `Codemp`/`Nombre` se conservan. La lista inicial completa se ordena por nombre y código; solo la búsqueda escrita por el usuario filtra resultados. Se mantiene la selección manual obligatoria y la persistencia exacta en `Ticket_c.Mozo`. Los mensajes del grupo ya no exigen empleado activo ni pertenencia a la empresa.
- El nombre en nuevos documentos de envío y en Cocina se resuelve por `Codemp` para este grupo, incluso con empresa nula/diferente o cese. Para otras mesas se mantiene la coincidencia de empresa en la resolución de nombre. La empresa, turno y productos del pedido siguen perteneciendo al contexto de la mesa.
- Cambiar posteriormente empresa o fecha de cese del empleado no invalida su asignación en 231–235. Los documentos capturados no se reescriben: la reimpresión utiliza el documento original del destino y los siguientes envíos capturan el nombre vigente.
- Se conservan diseño adaptable, temas, teclado, foco, cancelación, autoguardado y protección de contexto/respuestas tardías de las fases 56–57. No hay migraciones, nuevas dependencias, cambios de esquema, precios, totales ni correlativos. El script de presentación modificado usa versión 58.
- Verificación: `npm run check`, `git diff --check`, 67/67 pruebas unitarias, 98/98 pruebas Playwright y 29/29 escenarios SQL aprobados. La integración utiliza un esquema exclusivo de tempdb y lo elimina al terminar, sin modificar la base comercial configurada.
- Cobertura: lista completa y selección/guardado/recarga de empleados cesados, de otra empresa y sin empresa en las tres empresas; cambios posteriores de empresa/cese; nombres en nuevos envíos y KDS; reimpresión íntegra del original tras renombrar/reasignar al empleado; rechazo de códigos inexistentes/ausentes sin modificar pedido, versión, detalle ni correlativo; límites 230/236 y regresiones existentes del buscador/POS.
- Pendiente en cliente: publicar e instalar mediante `ACTUALIZACION_CLIENTE.md`; comprobar búsqueda y selección de empleados de distintas empresas, cesados y sin empresa en 231–235, guardado/recarga y nombre en una comanda real. Validar tablet/celular con teclado físico y una reimpresión. La fase no se declara desplegada ni validada físicamente; las demás pendientes del roadmap se conservan.


## Fase 59: Edición manual del precio por producto (Implementada en código; validación física y contable pendiente)

- Delivery (201–209), Para llevar (210–219) y PedidosYa | Rappi (220–230) ofrecen **Precio** en cada fila del detalle, en las tres empresas. El ajuste afecta solamente las líneas internas de esa fila agrupada y todas sus unidades; otras filas, notas y precios permanecen independientes. Se admiten S/0.00 hasta S/999,999,999.00 y los permisos actuales del POS.
- El diálogo **Modificar precio** muestra producto, cantidad y precio actual; **Nuevo precio unitario — IGV incluido** admite punto o coma y hasta dos decimales. Cancelar, cierre y Escape no alteran el pedido. Conserva foco, temas claro/oscuro, controles de al menos 44 px y posición/altura según el viewport visual del teclado.
- El precio puede editarse incluso después del envío o mientras Cocina reconoce una corrección, siempre que el pedido sea editable. Operaciones, errores de carga, conflictos y contexto inválido bloquean el ajuste. Preventa mantiene solo lectura y reapertura permite corregirlo. Una selección desactualizada se invalida antes de aplicar.
- `POST /api/pos/pedido` y sus respuestas incorporan `items[].precioManualFinal`: número establece el unitario final; null elimina el ajuste; omitirlo conserva el existente. El servidor valida tipo, rango, decimales y elegibilidad usando la mesa real del pedido. Errores `INVALID_MANUAL_PRICE` / `MANUAL_PRICE_NOT_ALLOWED` responden 400 y no dejan cambios comerciales.
- El ajuste se conserva en `Pedido_lineas.Datos`, sin migraciones ni nuevas dependencias. `precio` / `items.Precio` siguen representando el precio base auxiliar. No se modifica `Productos.PventaMa`; nuevas selecciones del catálogo mantienen el precio habitual, mientras aumentar desde la fila y separar unidades conservan el ajuste.
- El cálculo compartido usa directamente el precio manual final, sin volver a aplicar IGV. El desglose deriva la base con el IGV configurado para afectos; exentos mantienen base igual al final. Agrupación y distribución de centavos distinguen precios manuales y normales. `Ticket_d.Precio` conserva el unitario final, `Importe` el total de línea y `Ticket_c.Total` la suma de importes.
- Autoguardado, versión, snapshot comercial y detalle comparten la transacción existente. Respuestas anteriores no reemplazan un ajuste local posterior; fallos conservan el borrador para reintento y los conflictos mantienen las restricciones actuales. La restauración comercial controlada utiliza el mismo cálculo y conserva precios manuales persistidos.
- El precio no entra en el snapshot operativo de Cocina: editar solamente el precio no crea novedades, correcciones, envíos ni trabajos de impresión, ni altera estados, documentos capturados o reimpresiones. Históricos y pedidos sin ajuste mantienen las reglas anteriores. Los recursos modificados usan versión 59.
- Verificación final: `npm run check`, `git diff --check`, 70/70 pruebas unitarias, 106/106 pruebas Playwright y 30/30 escenarios SQL aprobados. SQL utiliza un esquema exclusivo de tempdb que se elimina al terminar. Cobertura nueva: precios cero/positivos, decimales y límites, las tres empresas/grupos, omisión/null, cantidades 1/2/3, distribución fraccionaria, filas enviadas/nuevas y notas distintas, separación, recarga, edición durante guardado lento, fallo/reintento, conflictos, rollback y restauración comercial. Se comprobaron documentos/estados de Cocina íntegros, Preventa/reapertura, foco y diálogo en 390/768/1280 px; se revisaron capturas en tema oscuro.
- Pendiente en cliente: publicar e instalar mediante el procedimiento habitual; verificar tablet/celular, teclado físico, filas agrupadas, edición posterior a envío, guardado/recarga, Preventa/reapertura y lectura de `Ticket_d` en el POS contable. La fase no se declara desplegada ni validada físicamente/contablemente; se conservan las pendientes anteriores.

---
