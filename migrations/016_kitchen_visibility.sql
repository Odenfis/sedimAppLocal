IF OBJECT_ID('dbo.Cocina_visibilidad_operaciones','U') IS NULL
CREATE TABLE dbo.Cocina_visibilidad_operaciones (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY, Empresa INT NOT NULL, Accion VARCHAR(12) NOT NULL,
    Usuario NVARCHAR(100) NOT NULL, SolicitudHash CHAR(64) NOT NULL, Resultado NVARCHAR(MAX) NOT NULL,
    Fecha DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
IF OBJECT_ID('dbo.Cocina_visibilidad','U') IS NULL
CREATE TABLE dbo.Cocina_visibilidad (
    Id BIGINT IDENTITY PRIMARY KEY, OperacionId UNIQUEIDENTIFIER NOT NULL,
    Empresa INT NOT NULL, NroTicket VARCHAR(20) NOT NULL, LineaId UNIQUEIDENTIFIER NOT NULL,
    DetalleEnvioId UNIQUEIDENTIFIER NULL, Accion VARCHAR(12) NOT NULL,
    Usuario NVARCHAR(100) NOT NULL, Fecha DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_Cocina_visibilidad_operacion_linea UNIQUE(OperacionId,LineaId)
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Cocina_visibilidad_linea' AND object_id=OBJECT_ID('dbo.Cocina_visibilidad'))
CREATE INDEX IX_Cocina_visibilidad_linea ON dbo.Cocina_visibilidad(LineaId,Id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Cocina_envio_detalles_linea' AND object_id=OBJECT_ID('dbo.Cocina_envio_detalles'))
CREATE INDEX IX_Cocina_envio_detalles_linea ON dbo.Cocina_envio_detalles(LineaId,EnvioId) INCLUDE(Id);
