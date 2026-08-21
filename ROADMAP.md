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
├── Dockerfile             # Imagen Node 20 slim
├── docker-compose.yml     # Orquestación (extra_hosts → host DB)
├── actualizar.bat         # Actualización automática del cliente
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

*Última actualización: Agosto 2026 - v3.1*