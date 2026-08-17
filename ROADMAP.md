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
├── ROADMAP.md             # Este archivo
└── public/
    ├── login.html         # Página de login
    ├── dashboard.html     # Panel principal
    ├── script.js          # Lógica frontend
    └── style.css          # Estilos
```

---

## Endpoints API (Actualizado Junio 2026)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/login` | Autenticación con tabla Usuarios |
| POST | `/api/logout` | Cerrar sesión |
| GET | `/api/session` | Verificar sesión activa |
| GET | `/api/users?q=X` | Listar usuarios (autocomplete login) |
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
| POST | `/api/pos/ticket` | Crear ticket directo (body: `turno`, `mozo`). Estado=2 (Preventa) |

---

## Funcionalidades Implementadas (Mayo 2026 - v2.1)

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
- [x] Cortesía y Descuento (placeholder)

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

## Próximos Pasos (Pendientes)

### POS
- [ ] Implementar función de Cortesía
- [ ] Implementar función de Descuento
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

---

*Última actualización: Junio 2026 - v2.2*