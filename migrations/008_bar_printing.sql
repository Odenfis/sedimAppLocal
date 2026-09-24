-- Fase 37: enrutamiento inmutable de líneas y cola independiente para Barra.
-- Solo crea tablas auxiliares de SedimApp; no altera tablas comerciales ni la cola de Cocina.
IF OBJECT_ID('dbo.Impresion_linea_rutas','U') IS NULL
CREATE TABLE dbo.Impresion_linea_rutas (
    LineaId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    Destino VARCHAR(16) NOT NULL CHECK(Destino IN('cocina','barra')),
    Fecha DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Impresion_linea_ruta_linea FOREIGN KEY(LineaId) REFERENCES dbo.Pedido_lineas(LineaId)
);

IF OBJECT_ID('dbo.Impresion_barra_trabajos','U') IS NULL
CREATE TABLE dbo.Impresion_barra_trabajos (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    EnvioId UNIQUEIDENTIFIER NOT NULL,
    ReimpresionDe UNIQUEIDENTIFIER NULL,
    Clave UNIQUEIDENTIFIER NOT NULL UNIQUE,
    Documento NVARCHAR(MAX) NOT NULL,
    Estado VARCHAR(24) NOT NULL DEFAULT 'en_cola' CHECK(Estado IN('en_cola','procesando','enviado','error','incierto')),
    Intentos INT NOT NULL DEFAULT 0,
    Error NVARCHAR(1000) NULL,
    Usuario NVARCHAR(50) NOT NULL,
    Fecha DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    Actualizado DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ProximoIntento DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Impresion_barra_envio FOREIGN KEY(EnvioId) REFERENCES dbo.Cocina_envios(Id),
    CONSTRAINT FK_Impresion_barra_reprint FOREIGN KEY(ReimpresionDe) REFERENCES dbo.Impresion_barra_trabajos(Id)
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Impresion_linea_rutas_destino' AND object_id=OBJECT_ID('dbo.Impresion_linea_rutas'))
CREATE INDEX IX_Impresion_linea_rutas_destino ON dbo.Impresion_linea_rutas(Destino,LineaId);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Impresion_barra_cola' AND object_id=OBJECT_ID('dbo.Impresion_barra_trabajos'))
CREATE INDEX IX_Impresion_barra_cola ON dbo.Impresion_barra_trabajos(Estado,ProximoIntento);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Impresion_barra_envio_fecha' AND object_id=OBJECT_ID('dbo.Impresion_barra_trabajos'))
CREATE INDEX IX_Impresion_barra_envio_fecha ON dbo.Impresion_barra_trabajos(EnvioId,Fecha DESC,Id)
INCLUDE(Estado,Error,Intentos,ReimpresionDe);
