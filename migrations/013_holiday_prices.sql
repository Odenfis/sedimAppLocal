-- Auxiliary configuration only; Productos and Precios remain read-only.
IF OBJECT_ID('dbo.Precios_feriado_config','U') IS NULL
CREATE TABLE dbo.Precios_feriado_config (
    Empresa INT NOT NULL PRIMARY KEY CHECK(Empresa IN(2,4,6)),
    Activo BIT NOT NULL DEFAULT 0,
    Tarifa INT NOT NULL DEFAULT 1 CHECK(Tarifa BETWEEN 1 AND 6),
    Version INT NOT NULL DEFAULT 0,
    Usuario NVARCHAR(50) NULL,
    Fecha DATETIME2 NULL
);
IF OBJECT_ID('dbo.Precios_feriado_historial','U') IS NULL
CREATE TABLE dbo.Precios_feriado_historial (
    Id BIGINT IDENTITY PRIMARY KEY,
    Empresa INT NOT NULL,
    ActivoAnterior BIT NOT NULL,
    TarifaAnterior INT NOT NULL,
    Activo BIT NOT NULL,
    Tarifa INT NOT NULL,
    Version INT NOT NULL,
    Usuario NVARCHAR(50) NOT NULL,
    Fecha DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
INSERT dbo.Precios_feriado_config(Empresa)
SELECT Empresa FROM (VALUES(2),(4),(6)) companies(Empresa)
WHERE NOT EXISTS(SELECT 1 FROM dbo.Precios_feriado_config c WHERE c.Empresa=companies.Empresa);
