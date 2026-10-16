-- Fase 64: historial de traslados y avisos independientes de envíos de platos.
IF OBJECT_ID('dbo.Pedido_traslados','U') IS NULL
CREATE TABLE dbo.Pedido_traslados (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    NroTicket VARCHAR(20) NOT NULL,
    Empresa INT NOT NULL,
    Origen INT NOT NULL,
    Destino INT NOT NULL,
    VersionOrigen INT NOT NULL,
    VersionResultado INT NOT NULL,
    Clave UNIQUEIDENTIFIER NOT NULL UNIQUE,
    Usuario NVARCHAR(50) NOT NULL,
    Fecha DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    Documento NVARCHAR(MAX) NOT NULL,
    CHECK(Origen<>Destino)
);
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='IX_Pedido_traslados_ticket_fecha' AND object_id=OBJECT_ID('dbo.Pedido_traslados'))
CREATE INDEX IX_Pedido_traslados_ticket_fecha ON dbo.Pedido_traslados(NroTicket,Fecha DESC);
IF COL_LENGTH('dbo.Impresion_trabajos','TrasladoId') IS NULL
ALTER TABLE dbo.Impresion_trabajos ADD TrasladoId UNIQUEIDENTIFIER NULL REFERENCES dbo.Pedido_traslados(Id);
ALTER TABLE dbo.Impresion_trabajos ALTER COLUMN EnvioId UNIQUEIDENTIFIER NULL;
IF COL_LENGTH('dbo.Impresion_barra_trabajos','TrasladoId') IS NULL
ALTER TABLE dbo.Impresion_barra_trabajos ADD TrasladoId UNIQUEIDENTIFIER NULL REFERENCES dbo.Pedido_traslados(Id);
ALTER TABLE dbo.Impresion_barra_trabajos ALTER COLUMN EnvioId UNIQUEIDENTIFIER NULL;
