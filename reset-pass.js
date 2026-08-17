const { getConnection, sql } = require('./db');
const bcrypt = require('bcryptjs');

async function resetPassword() {
    try {
        console.log("Conectando a Azure...");
        const pool = await getConnection();

        // 1. Encriptar 'admin123' de forma real
        const nuevaPassword = await bcrypt.hash('admin123', 10);
        console.log("Contraseña encriptada generada.");

        // 2. Actualizar el usuario 'admin' en la base de datos
        await pool.request()
            .input('pass', sql.NVarChar, nuevaPassword)
            .query("UPDATE usuariosweb SET password = @pass WHERE usuario = 'admin'");

        console.log("✅ ¡ÉXITO! Contraseña actualizada.");
        console.log("Ahora intenta loguearte con: admin / admin123");
        process.exit();

    } catch (error) {
        console.error("❌ Error:", error);
    }
}

resetPassword();