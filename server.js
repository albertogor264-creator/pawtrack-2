require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Servir archivos estáticos desde las carpetas del proyecto
app.use('/CSS', express.static(path.join(__dirname, 'CSS')));
app.use('/JAVASCRIPT', express.static(path.join(__dirname, 'JAVASCRIPT')));
app.use('/HTML', express.static(path.join(__dirname, 'HTML')));
app.use(express.static(path.join(__dirname, 'HTML')));

// Conexión a PostgreSQL: usa DATABASE_URL en producción (Supabase/Vercel) o local en desarrollo
const pool = process.env.DATABASE_URL
    ? new Pool({
          connectionString: process.env.DATABASE_URL,
          ssl: { rejectUnauthorized: false }
      })
    : new Pool({
          user: process.env.PGUSER || 'postgres',
          host: process.env.PGHOST || 'localhost',
          database: process.env.PGDATABASE || 'pawtrack',
          password: process.env.PGPASSWORD || 'postgres',
          port: parseInt(process.env.PGPORT, 10) || 5432
      });

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'HTML', 'index.html'));
});

// --- AUTENTICACIÓN ---
app.post('/api/registro', async (req, res) => {
    const { nombre, correo, contraseña, contrasena } = req.body;
    const pass = contraseña || contrasena;

    if (!nombre || !correo || !pass) {
        return res.status(400).json({ success: false, message: 'Faltan campos obligatorios' });
    }

    try {
        const existe = await pool.query('SELECT id FROM usuarios WHERE correo = $1', [correo]);
        if (existe.rows.length > 0) {
            return res.status(409).json({ success: false, message: 'El correo ya está registrado' });
        }

        const result = await pool.query(
            'INSERT INTO usuarios (nombre, correo, contrasena) VALUES ($1, $2, $3) RETURNING id, nombre, correo',
            [nombre, correo, pass]
        );

        res.json({ success: true, usuario: result.rows[0] });
    } catch (err) {
        console.error('Error en /api/registro:', err);
        res.status(500).json({ success: false, message: 'Error al registrar usuario' });
    }
});

app.post('/api/login', async (req, res) => {
    const { correo, contraseña, contrasena } = req.body;
    const pass = contraseña || contrasena;

    try {
        const result = await pool.query(
            'SELECT id, nombre, correo FROM usuarios WHERE correo = $1 AND contrasena = $2',
            [correo, pass]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Correo o contraseña incorrectos' });
        }

        res.json({ success: true, usuario: result.rows[0] });
    } catch (err) {
        console.error('Error en /api/login:', err);
        res.status(500).json({ success: false, message: 'Error al iniciar sesión' });
    }
});

// --- MASCOTAS ---
app.get('/api/perros/:usuario_id', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, usuario_id, nombre, raza, edad, peso FROM perros WHERE usuario_id = $1 ORDER BY id ASC',
            [req.params.usuario_id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error en /api/perros/:usuario_id:', err);
        res.status(500).json({ error: 'Error al obtener mascotas' });
    }
});

app.post('/api/perros', async (req, res) => {
    const { usuario_id, nombre, raza, edad, peso } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO perros (usuario_id, nombre, raza, edad, peso) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [usuario_id, nombre, raza, edad, peso]
        );
        res.json({ success: true, perro: result.rows[0] });
    } catch (err) {
        console.error('Error en POST /api/perros:', err);
        res.status(500).json({ success: false, message: 'Error al registrar perro' });
    }
});

// --- DISPOSITIVO, TELEMETRÍA Y UBICACIÓN ---
app.get('/api/dispositivo/:perro_id', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, codigo, perro_id, bateria, ultima_conexion FROM dispositivos WHERE perro_id = $1 LIMIT 1',
            [req.params.perro_id]
        );
        res.json(result.rows[0] || {});
    } catch (err) {
        console.error('Error en /api/dispositivo/:perro_id:', err);
        res.status(500).json({ error: 'Error al consultar dispositivo' });
    }
});

app.post('/api/telemetria', async (req, res) => {
    const { codigo_dispositivo, temperatura, pulso, actividad, latitud, longitud, bateria } = req.body;

    if (!codigo_dispositivo) {
        return res.status(400).json({ success: false, message: 'Falta codigo_dispositivo' });
    }

    try {
        const dispQuery = await pool.query(
            'SELECT id, perro_id FROM dispositivos WHERE codigo = $1',
            [codigo_dispositivo]
        );

        if (dispQuery.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Dispositivo no registrado en la base de datos' });
        }

        const { id: dispositivo_id, perro_id } = dispQuery.rows[0];

        if (bateria !== undefined && bateria !== null) {
            await pool.query(
                'UPDATE dispositivos SET bateria = $1, ultima_conexion = NOW() WHERE id = $2',
                [bateria, dispositivo_id]
            );
        } else {
            await pool.query(
                'UPDATE dispositivos SET ultima_conexion = NOW() WHERE id = $1',
                [dispositivo_id]
            );
        }

        if (temperatura !== undefined && pulso !== undefined) {
            await pool.query(
                'INSERT INTO mediciones (dispositivo_id, temperatura, pulso, actividad) VALUES ($1, $2, $3, $4)',
                [dispositivo_id, temperatura, pulso, actividad || 'Normal']
            );

            if (parseFloat(temperatura) > 39.5) {
                await pool.query(
                    'INSERT INTO alertas (perro_id, tipo, descripcion) VALUES ($1, $2, $3)',
                    [perro_id, 'Temperatura Alta', `Temperatura detectada de ${temperatura} °C en ${codigo_dispositivo}`]
                );
            }
        }

        if (latitud !== undefined && longitud !== undefined) {
            await pool.query(
                'INSERT INTO ubicaciones (dispositivo_id, latitud, longitud) VALUES ($1, $2, $3)',
                [dispositivo_id, latitud, longitud]
            );
        }

        res.json({ success: true, message: 'Telemetría registrada correctamente' });
    } catch (err) {
        console.error('Error en /api/telemetria:', err);
        res.status(500).json({ success: false, message: 'Error al guardar telemetría' });
    }
});

app.get('/api/historial-mediciones/:dispositivo_id', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, temperatura, pulso, actividad, fecha_hora FROM mediciones WHERE dispositivo_id = $1 ORDER BY fecha_hora DESC LIMIT 20',
            [req.params.dispositivo_id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error en /api/historial-mediciones:', err);
        res.status(500).json({ error: 'Error al obtener mediciones' });
    }
});

app.get('/api/ubicacion/:dispositivo_id', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, latitud, longitud, fecha_hora FROM ubicaciones WHERE dispositivo_id = $1 ORDER BY fecha_hora DESC LIMIT 1',
            [req.params.dispositivo_id]
        );
        res.json(result.rows[0] || {});
    } catch (err) {
        console.error('Error en /api/ubicacion:', err);
        res.status(500).json({ error: 'Error al obtener ubicación' });
    }
});

app.get('/api/alertas/:perro_id', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, tipo, descripcion, fecha_hora FROM alertas WHERE perro_id = $1 ORDER BY fecha_hora DESC LIMIT 10',
            [req.params.perro_id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error en /api/alertas:', err);
        res.status(500).json({ error: 'Error al obtener alertas' });
    }
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
    });
}

module.exports = app;