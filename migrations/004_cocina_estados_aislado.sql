-- Fase 22B: compatibilidad para instalaciones que ya registraron 002/003.
-- Solo crea objetos nuevos y lee Cocina_pedidos; no modifica ninguna tabla existente.
IF OBJECT_ID('dbo.Cocina_estados','U') IS NULL
CREATE TABLE dbo.Cocina_estados (
    LineaId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY, NroTicket VARCHAR(20) NOT NULL,
    Codpro CHAR(10) NOT NULL, Estado INT NOT NULL DEFAULT 1 CHECK(Estado BETWEEN 1 AND 4),
    Operativa NVARCHAR(MAX) NOT NULL CHECK(ISJSON(Operativa)=1), PendienteId UNIQUEIDENTIFIER NULL,
    Anulada BIT NOT NULL DEFAULT 0, FechaEnvio DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    FechaEstado DATETIME2 NULL, Usuario NVARCHAR(50) NULL,
    CONSTRAINT FK_Cocina_estados_control FOREIGN KEY(NroTicket) REFERENCES dbo.Pedido_control(NroTicket),
    CONSTRAINT FK_Cocina_estados_pendiente FOREIGN KEY(PendienteId) REFERENCES dbo.Cocina_envio_detalles(Id)
);
IF OBJECT_ID('dbo.Cocina_pedidos_legacy','U') IS NULL
    SELECT TOP (0) * INTO dbo.Cocina_pedidos_legacy FROM dbo.Cocina_pedidos;
IF OBJECT_ID('dbo.Cocina_pedidos','U') IS NOT NULL AND OBJECT_ID('dbo.Cocina_pedidos_legacy','U') IS NOT NULL
BEGIN
    SET IDENTITY_INSERT dbo.Cocina_pedidos_legacy ON;
    INSERT dbo.Cocina_pedidos_legacy (Id,NroTicket,Codpro,Estado,Fecha_estado,Usuario)
    SELECT c.Id,c.NroTicket,c.Codpro,c.Estado,c.Fecha_estado,c.Usuario
    FROM dbo.Cocina_pedidos c
    WHERE NOT EXISTS (SELECT 1 FROM dbo.Cocina_pedidos_legacy x WHERE x.Id=c.Id);
    SET IDENTITY_INSERT dbo.Cocina_pedidos_legacy OFF;
END;
