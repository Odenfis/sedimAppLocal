-- Fase 21: Pedido Cocina (KDS)
-- Estados por linea de ticket: 1=Pendiente, 2=En preparacion, 3=Listo, 4=Entregado
-- Clave unica (NroTicket, Codpro): sobrevive a los DELETE+INSERT de Ticket_d en cada guardado

CREATE TABLE Cocina_pedidos (
    Id           INT IDENTITY(1,1) PRIMARY KEY,
    NroTicket    VARCHAR(20)  NOT NULL,
    Codpro       CHAR(10)     NOT NULL,
    Estado       INT NOT NULL DEFAULT 1,
    Fecha_estado SMALLDATETIME NULL,
    Usuario      NVARCHAR(50) NULL,
    CONSTRAINT UQ_Cocina_linea UNIQUE (NroTicket, Codpro)
);

CREATE INDEX nci_cocina_estado ON Cocina_pedidos (Estado, NroTicket);
