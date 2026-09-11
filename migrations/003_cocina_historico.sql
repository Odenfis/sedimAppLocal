-- Fase 22: inicialización únicamente en tablas nuevas.
INSERT dbo.Pedido_control(NroTicket,Empresa,SnapshotComercial)
SELECT RTRIM(t.NroTicket), CASE LEFT(RTRIM(t.NroTicket),4) WHEN 'T001' THEN 2 WHEN 'T002' THEN 4 WHEN 'T005' THEN 6 END,
       COALESCE((SELECT RTRIM(d.Codpro) codPro,RTRIM(d.Descripcion) nombre,d.Cantidad cantidad,d.Precio precio,d.Descuento descuento,d.Importe importe FROM dbo.Ticket_d d WHERE RTRIM(d.NroTicket)=RTRIM(t.NroTicket) FOR JSON PATH),'[]')
FROM dbo.Ticket_c t
WHERE t.Estado IN (1,2)
  AND LEFT(RTRIM(t.NroTicket),4) IN ('T001','T002','T005')
  AND NOT EXISTS (SELECT 1 FROM dbo.Pedido_control p WHERE p.NroTicket=RTRIM(t.NroTicket));
INSERT dbo.Pedido_lineas(LineaId,NroTicket,Orden,Datos)
SELECT NEWID(),RTRIM(d.NroTicket),ROW_NUMBER() OVER(PARTITION BY d.NroTicket ORDER BY d.Codpro,d.Precio),
       (SELECT RTRIM(d.Codpro) codPro,RTRIM(d.Descripcion) nombre,d.Cantidad cantidad,d.Precio precio,ISNULL(p.Afecto,0) afecto,JSON_QUERY('[]') notasRapidas,'' nota FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)
FROM dbo.Ticket_d d JOIN dbo.Pedido_control pc ON pc.NroTicket=RTRIM(d.NroTicket)
LEFT JOIN dbo.Productos p ON p.CodPro=d.Codpro
WHERE NOT EXISTS (SELECT 1 FROM dbo.Pedido_lineas l WHERE l.NroTicket=RTRIM(d.NroTicket));
IF OBJECT_ID('dbo.Cocina_pedidos','U') IS NOT NULL AND OBJECT_ID('dbo.Cocina_pedidos_legacy','U') IS NOT NULL
BEGIN
    -- Id es IDENTITY en la tabla local original. Se conserva en la copia nueva
    -- usando una lista explícita y habilitando IDENTITY_INSERT solo en esta sesión.
    SET IDENTITY_INSERT dbo.Cocina_pedidos_legacy ON;
    INSERT dbo.Cocina_pedidos_legacy (Id,NroTicket,Codpro,Estado,Fecha_estado,Usuario)
    SELECT c.Id,c.NroTicket,c.Codpro,c.Estado,c.Fecha_estado,c.Usuario
    FROM dbo.Cocina_pedidos c
    WHERE NOT EXISTS (SELECT 1 FROM dbo.Cocina_pedidos_legacy x WHERE x.Id=c.Id);
    SET IDENTITY_INSERT dbo.Cocina_pedidos_legacy OFF;
END;
