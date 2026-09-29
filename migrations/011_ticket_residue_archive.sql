-- Archivo inmutable para residuos auxiliares no enviados que bloquean el correlativo comercial.
IF OBJECT_ID('dbo.Pedido_residuos_archivo','U') IS NULL
CREATE TABLE dbo.Pedido_residuos_archivo (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    NroTicket VARCHAR(20) NOT NULL,
    Empresa INT NOT NULL,
    Motivo VARCHAR(48) NOT NULL CHECK(Motivo IN('correlativo_auxiliar_huerfano')),
    Payload NVARCHAR(MAX) NOT NULL CHECK(ISJSON(Payload)=1),
    Hash CHAR(64) NOT NULL,
    Usuario NVARCHAR(50) NOT NULL,
    CreadoUtc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Pedido_residuos_ticket_fecha' AND object_id=OBJECT_ID('dbo.Pedido_residuos_archivo'))
CREATE INDEX IX_Pedido_residuos_ticket_fecha ON dbo.Pedido_residuos_archivo(NroTicket,CreadoUtc);
