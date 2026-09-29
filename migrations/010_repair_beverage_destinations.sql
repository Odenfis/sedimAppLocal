-- Fase 46: reparación aditiva e idempotente de destinos de Cocina/Bebidas/Barra.
-- Este archivo tiene identidad propia para reparar instalaciones cuyo registro de 009
-- no coincide con los objetos realmente presentes.
IF OBJECT_ID('dbo.Impresion_linea_destinos','U') IS NULL
CREATE TABLE dbo.Impresion_linea_destinos (
    LineaId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    Destino VARCHAR(16) NOT NULL CHECK(Destino IN('cocina','bebidas','barra')),
    Fecha DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Impresion_linea_destino_linea FOREIGN KEY(LineaId) REFERENCES dbo.Pedido_lineas(LineaId)
);

INSERT dbo.Impresion_linea_destinos(LineaId,Destino,Fecha)
SELECT r.LineaId,r.Destino,r.Fecha
FROM dbo.Impresion_linea_rutas r
WHERE NOT EXISTS(SELECT 1 FROM dbo.Impresion_linea_destinos d WHERE d.LineaId=r.LineaId);

IF OBJECT_ID('dbo.Impresion_trabajo_destinos','U') IS NULL
CREATE TABLE dbo.Impresion_trabajo_destinos (
    TrabajoId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    Destino VARCHAR(16) NOT NULL CHECK(Destino IN('cocina','bebidas')),
    CONSTRAINT FK_Impresion_trabajo_destino_trabajo FOREIGN KEY(TrabajoId) REFERENCES dbo.Impresion_trabajos(Id)
);

INSERT dbo.Impresion_trabajo_destinos(TrabajoId,Destino)
SELECT j.Id,'cocina'
FROM dbo.Impresion_trabajos j
WHERE NOT EXISTS(SELECT 1 FROM dbo.Impresion_trabajo_destinos d WHERE d.TrabajoId=j.Id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Impresion_linea_destinos_destino' AND object_id=OBJECT_ID('dbo.Impresion_linea_destinos'))
CREATE INDEX IX_Impresion_linea_destinos_destino ON dbo.Impresion_linea_destinos(Destino,LineaId);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Impresion_trabajo_destinos_destino' AND object_id=OBJECT_ID('dbo.Impresion_trabajo_destinos'))
CREATE INDEX IX_Impresion_trabajo_destinos_destino ON dbo.Impresion_trabajo_destinos(Destino,TrabajoId);
