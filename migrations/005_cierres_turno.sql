-- Fase 24: archivo inmutable y retencion de auxiliares de pedido/cocina.
-- Solo crea tablas nuevas; la purga se ejecuta en runtime con validaciones transaccionales.
IF OBJECT_ID('dbo.Cierres_turno','U') IS NULL
CREATE TABLE dbo.Cierres_turno (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    Empresa INT NOT NULL,
    Turno INT NOT NULL,
    FechaNegocio DATE NOT NULL,
    CorteUtc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    Usuario NVARCHAR(50) NOT NULL,
    Estado VARCHAR(24) NOT NULL CHECK(Estado IN('cerrado','reabierto','purgando','purgado','error')),
    RetencionDias INT NOT NULL DEFAULT 30 CHECK(RetencionDias BETWEEN 1 AND 3650),
    PurgaProgramada DATETIME2 NOT NULL,
    PurgaFecha DATETIME2 NULL,
    Conteos NVARCHAR(MAX) NULL CHECK(Conteos IS NULL OR ISJSON(Conteos)=1),
    HashGlobal CHAR(64) NULL,
    Error NVARCHAR(1000) NULL,
    CreadoUtc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    ActualizadoUtc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_Cierres_turno_scope UNIQUE(Empresa,Turno,FechaNegocio)
);
IF OBJECT_ID('dbo.Cierre_turno_archivos','U') IS NULL
CREATE TABLE dbo.Cierre_turno_archivos (
    CierreId UNIQUEIDENTIFIER NOT NULL,
    NroTicket VARCHAR(20) NOT NULL,
    Payload NVARCHAR(MAX) NOT NULL CHECK(ISJSON(Payload)=1),
    Hash CHAR(64) NOT NULL,
    CreadoUtc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Cierre_turno_archivos PRIMARY KEY(CierreId,NroTicket),
    CONSTRAINT FK_Cierre_archivo_cierre FOREIGN KEY(CierreId) REFERENCES dbo.Cierres_turno(Id)
);
IF OBJECT_ID('dbo.Cierre_turno_operaciones','U') IS NULL
CREATE TABLE dbo.Cierre_turno_operaciones (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    CierreId UNIQUEIDENTIFIER NOT NULL,
    Clave UNIQUEIDENTIFIER NOT NULL UNIQUE,
    Accion VARCHAR(16) NOT NULL CHECK(Accion IN('cerrar','reabrir','purgar','purga_auto')),
    Usuario NVARCHAR(50) NOT NULL,
    Resultado VARCHAR(16) NOT NULL CHECK(Resultado IN('aplicado','idempotente')),
    FechaUtc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Cierre_operacion_cierre FOREIGN KEY(CierreId) REFERENCES dbo.Cierres_turno(Id)
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Cierres_turno_purga' AND object_id=OBJECT_ID('dbo.Cierres_turno'))
CREATE INDEX IX_Cierres_turno_purga ON dbo.Cierres_turno(Estado,PurgaProgramada);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Cierre_archivo_ticket' AND object_id=OBJECT_ID('dbo.Cierre_turno_archivos'))
CREATE INDEX IX_Cierre_archivo_ticket ON dbo.Cierre_turno_archivos(NroTicket);
