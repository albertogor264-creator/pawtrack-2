require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos si existen
app.use(express.static(path.join(__dirname)));
app.use('/HTML', express.static(path.join(__dirname, 'HTML')));
app.use('/CSS', express.static(path.join(__dirname, 'CSS')));
app.use('/JAVASCRIPT', express.static(path.join(__dirname, 'JAVASCRIPT')));

// Conexión a Supabase mediante REST API (@supabase/supabase-js)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY en las variables de entorno.');
}

const supabase = createClient(supabaseUrl || '', supabaseKey || '', {
  auth: { persistSession: false }
});

// Ruta principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'HTML', 'index.html'));
});

// LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const correo = (req.body.correo || '').trim();
    const password = req.body.contraseña ?? req.body.contrasena ?? '';

    if (!correo || !password) {
      return res.status(400).json({ success: false, message: 'Ingresa correo y contraseña' });
    }

    const { data, error } = await supabase
      .from('usuarios')
      .select('id, nombre, correo, contraseña')
      .eq('correo', correo)
      .limit(1);

    if (error) {
      console.error('Error en /api/login:', error);
      return res.status(500).json({ success: false, message: error.message });
    }

    const user = data && data[0];
    if (!user || user.contraseña !== password) {
      return res.status(401).json({ success: false, message: 'Correo o contraseña incorrectos' });
    }

    return res.json({
      success: true,
      usuario: {
        id: user.id,
        nombre: user.nombre,
        correo: user.correo
      }
    });
  } catch (err) {
    console.error('Excepción en /api/login:', err);
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

// REGISTRO
app.post('/api/registro', async (req, res) => {
  try {
    const nombre = (req.body.nombre || '').trim();
    const correo = (req.body.correo || '').trim();
    const password = req.body.contraseña ?? req.body.contrasena ?? '';

    if (!nombre || !correo || !password) {
      return res.status(400).json({ success: false, message: 'Completa todos los campos' });
    }

    const { data: existing, error: checkError } = await supabase
      .from('usuarios')
      .select('id')
      .eq('correo', correo)
      .limit(1);

    if (checkError) {
      console.error('Error verificando correo:', checkError);
      return res.status(500).json({ success: false, message: checkError.message });
    }

    if (existing && existing.length > 0) {
      return res.status(409).json({ success: false, message: 'Ese correo ya está registrado' });
    }

    const { data, error } = await supabase
      .from('usuarios')
      .insert([{ nombre, correo, contraseña: password }])
      .select('id, nombre, correo')
      .single();

    if (error) {
      console.error('Error en /api/registro:', error);
      return res.status(500).json({ success: false, message: error.message });
    }

    return res.status(201).json({ success: true, usuario: data });
  } catch (err) {
    console.error('Excepción en /api/registro:', err);
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

// PERROS POR USUARIO
app.get('/api/perros/:usuarioId', async (req, res) => {
  try {
    const usuarioId = Number(req.params.usuarioId);
    const { data, error } = await supabase
      .from('perros')
      .select('*')
      .eq('usuario_id', usuarioId)
      .order('id', { ascending: true });

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.json(data || []);
  } catch (err) {
    return res.status(500).json({ error: 'Error al obtener mascotas' });
  }
});

// REGISTRAR PERRO
app.post('/api/perros', async (req, res) => {
  try {
    const { usuario_id, nombre, raza, edad, peso } = req.body;
    const { data, error } = await supabase
      .from('perros')
      .insert([{
        usuario_id: Number(usuario_id),
        nombre,
        raza,
        edad: edad ? Number(edad) : null,
        peso: peso ? Number(peso) : null
      }])
      .select()
      .single();

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
    return res.status(201).json({ success: true, perro: data });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Error al registrar perro' });
  }
});

// DISPOSITIVO VINCULADO A PERRO
app.get('/api/dispositivo/:perroId', async (req, res) => {
  try {
    const perroId = Number(req.params.perroId);
    const { data, error } = await supabase
      .from('dispositivos')
      .select('*')
      .eq('perro_id', perroId)
      .limit(1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.json((data && data[0]) || {});
  } catch (err) {
    return res.status(500).json({ error: 'Error al consultar dispositivo' });
  }
});

// HISTORIAL DE MEDICIONES
app.get('/api/historial-mediciones/:dispositivoId', async (req, res) => {
  try {
    const dispositivoId = Number(req.params.dispositivoId);
    const { data, error } = await supabase
      .from('mediciones')
      .select('*')
      .eq('dispositivo_id', dispositivoId)
      .order('fecha_hora', { ascending: false })
      .limit(20);

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.json(data || []);
  } catch (err) {
    return res.status(500).json({ error: 'Error al consultar mediciones' });
  }
});

// ÚLTIMA UBICACIÓN
app.get('/api/ubicacion/:dispositivoId', async (req, res) => {
  try {
    const dispositivoId = Number(req.params.dispositivoId);
    const { data, error } = await supabase
      .from('ubicaciones')
      .select('*')
      .eq('dispositivo_id', dispositivoId)
      .order('fecha_hora', { ascending: false })
      .limit(1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.json((data && data[0]) || {});
  } catch (err) {
    return res.status(500).json({ error: 'Error al consultar ubicación' });
  }
});

// ALERTAS DEL PERRO
app.get('/api/alertas/:perroId', async (req, res) => {
  try {
    const perroId = Number(req.params.perroId);
    const { data, error } = await supabase
      .from('alertas')
      .select('*')
      .eq('perro_id', perroId)
      .order('id', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    return res.json(data || []);
  } catch (err) {
    return res.status(500).json({ error: 'Error al consultar alertas' });
  }
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
  });
}

module.exports = app;
