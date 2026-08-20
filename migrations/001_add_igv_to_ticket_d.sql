IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Ticket_d') AND name = 'Igv')
BEGIN
    ALTER TABLE Ticket_d ADD Igv MONEY DEFAULT 0;
END
