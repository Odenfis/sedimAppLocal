-- Fase 35: índices exclusivos de tablas auxiliares de SedimApp.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Pedido_control_empresa_ticket' AND object_id=OBJECT_ID('dbo.Pedido_control'))
CREATE INDEX IX_Pedido_control_empresa_ticket ON dbo.Pedido_control(Empresa,NroTicket);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Cocina_estados_activos' AND object_id=OBJECT_ID('dbo.Cocina_estados'))
CREATE INDEX IX_Cocina_estados_activos ON dbo.Cocina_estados(NroTicket,FechaEnvio)
INCLUDE(Codpro,Estado,Operativa,PendienteId,Anulada,FechaEstado)
WHERE Anulada=0 AND Estado<4;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Cocina_estados_pendientes' AND object_id=OBJECT_ID('dbo.Cocina_estados'))
CREATE INDEX IX_Cocina_estados_pendientes ON dbo.Cocina_estados(NroTicket,PendienteId)
INCLUDE(Codpro,Estado,Operativa,Anulada,FechaEnvio,FechaEstado)
WHERE PendienteId IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Impresion_trabajos_envio_fecha' AND object_id=OBJECT_ID('dbo.Impresion_trabajos'))
CREATE INDEX IX_Impresion_trabajos_envio_fecha ON dbo.Impresion_trabajos(EnvioId,Fecha DESC,Id)
INCLUDE(Estado,Error,Intentos,ReimpresionDe);
