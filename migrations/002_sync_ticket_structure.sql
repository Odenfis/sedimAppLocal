IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[Ticket_d]') AND name = 'Igv')
BEGIN
    ALTER TABLE [dbo].[Ticket_d] DROP COLUMN [Igv];
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'[dbo].[Ticket_c]') AND name = 'nci_wi_Ticket_c')
BEGIN
    CREATE NONCLUSTERED INDEX [nci_wi_Ticket_c]
        ON [dbo].[Ticket_c]([NroMesa] ASC, [Estado] ASC);
END