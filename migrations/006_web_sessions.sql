-- Sesiones web persistentes. Tabla auxiliar; no modifica tablas comerciales.
IF OBJECT_ID('dbo.Web_sessions','U') IS NULL
CREATE TABLE dbo.Web_sessions (
    Sid VARCHAR(128) NOT NULL PRIMARY KEY,
    Data NVARCHAR(MAX) NOT NULL CHECK(ISJSON(Data)=1),
    ExpiresAt DATETIME2 NOT NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Web_sessions_expiry' AND object_id=OBJECT_ID('dbo.Web_sessions'))
CREATE INDEX IX_Web_sessions_expiry ON dbo.Web_sessions(ExpiresAt);
