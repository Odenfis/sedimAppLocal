-- Fase 54: referencia del pedido, exclusivamente en esquema auxiliar.
IF COL_LENGTH('dbo.Pedido_control', 'CodigoPedido') IS NULL
    ALTER TABLE dbo.Pedido_control ADD CodigoPedido VARCHAR(30) NULL;
