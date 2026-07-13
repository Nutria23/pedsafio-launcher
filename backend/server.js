const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const multer = require('multer');

// Configure multer storage for mod files
const modsUploadDir = path.join(__dirname, 'public', 'mods');
if (!fs.existsSync(modsUploadDir)) {
  fs.mkdirSync(modsUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, modsUploadDir);
  },
  filename: (req, file, cb) => {
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    cb(null, cleanName);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === '.jar') {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos .jar para mods.'));
    }
  }
});

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = 'pedsafio-admin-secret-key-2026';

app.use(cors());
app.use(express.json());

// Paths
const CONFIG_PATH = path.join(__dirname, 'config.json');
const MANIFEST_PATH = path.join(__dirname, 'manifest.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Ensure directories exist
if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}
const ASSETS_DIR = path.join(PUBLIC_DIR, 'assets');
if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

// Helpers
function readConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (err) {
    console.error('Error reading config:', err);
  }
  return {};
}

function writeConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// Helper to compute SHA-256 of a file
function getFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', err => reject(err));
  });
}

// Recursively scan folder to build manifest
async function scanDirectory(dir, relativeTo) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      const subResults = await scanDirectory(filePath, relativeTo);
      results = results.concat(subResults);
    } else {
      // Ignore config.json/manifest.json and assets folder in root client files if needed
      // But typically we put mods, configs, resourcepacks, shaders inside public/
      const relPath = path.relative(relativeTo, filePath).replace(/\\/g, '/');
      // Skip assets folder files from delta updating unless requested (background/logo are separate)
      if (relPath.startsWith('assets/')) continue;

      const hash = await getFileHash(filePath);
      results.push({
        path: relPath,
        size: stat.size,
        hash: hash
      });
    }
  }
  return results;
}

// Middleware for Admin Token Authentication
function requireAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader === `Bearer ${ADMIN_TOKEN}`) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized: Invalid Admin Token' });
  }
}

// REST API Endpoints

// 1. Get current launcher configuration
app.get('/api/config', (req, res) => {
  const config = readConfig();
  // Dynamically replace default localhost URLs with the actual protocol/host of the incoming request
  const requestHost = `${req.protocol}://${req.get('host')}`;
  let configStr = JSON.stringify(config);
  configStr = configStr.replace(/http:\/\/localhost:3000/g, requestHost);
  res.json(JSON.parse(configStr));
});

// 2. Update launcher configuration (Admin Only)
app.post('/api/config', requireAdmin, (req, res) => {
  const newConfig = req.body;
  if (!newConfig || typeof newConfig !== 'object') {
    return res.status(400).json({ error: 'Invalid configuration object' });
  }
  
  const currentConfig = readConfig();
  const updatedConfig = { ...currentConfig, ...newConfig };
  writeConfig(updatedConfig);
  res.json({ success: true, config: updatedConfig });
});

// 3. Get client updates manifest
app.get('/api/manifest', (req, res) => {
  try {
    if (fs.existsSync(MANIFEST_PATH)) {
      const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
      return res.json(manifest);
    }
  } catch (err) {
    console.error('Error reading manifest:', err);
  }
  res.json({ files: [] });
});

// Helper to rebuild manifest
async function rebuildManifest() {
  const files = await scanDirectory(PUBLIC_DIR, PUBLIC_DIR);
  const manifest = {
    timestamp: Date.now(),
    filesCount: files.length,
    files: files
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

// 4. Rebuild manifest from files in public/ (Admin Only)
app.post('/api/manifest/rebuild', requireAdmin, async (req, res) => {
  try {
    const manifest = await rebuildManifest();
    res.json({ success: true, manifest });
  } catch (err) {
    console.error('Error rebuilding manifest:', err);
    res.status(500).json({ error: 'Failed to rebuild manifest: ' + err.message });
  }
});

// 5. Get list of currently uploaded mods
app.get('/api/mods', (req, res) => {
  try {
    const modsDir = path.join(PUBLIC_DIR, 'mods');
    if (!fs.existsSync(modsDir)) {
      return res.json([]);
    }
    const list = fs.readdirSync(modsDir);
    const results = [];
    for (const file of list) {
      if (path.extname(file).toLowerCase() === '.jar') {
        const filePath = path.join(modsDir, file);
        const stat = fs.statSync(filePath);
        results.push({
          name: file,
          size: stat.size,
          date: stat.mtime
        });
      }
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read mods list: ' + err.message });
  }
});

// 6. Upload a new mod file (.jar) (Admin Only)
app.post('/api/mods/upload', requireAdmin, (req, res) => {
  upload.single('mod')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No se ha seleccionado ningún archivo.' });
    }

    try {
      // Rebuild manifest automatically to register the new mod file
      await rebuildManifest();
      res.json({ success: true, file: req.file.filename });
    } catch (err) {
      res.status(500).json({ error: 'Fallo al regenerar el manifiesto: ' + err.message });
    }
  });
});

// 7. Delete an existing mod file (Admin Only)
app.delete('/api/mods/:filename', requireAdmin, async (req, res) => {
  try {
    const filename = path.basename(req.params.filename); // path sanitization
    const filePath = path.join(PUBLIC_DIR, 'mods', filename);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      // Rebuild manifest automatically to clean references
      await rebuildManifest();
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Archivo de mod no encontrado.' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Fallo al eliminar el archivo: ' + err.message });
  }
});

// Helper for varint encoding (Minecraft Ping)
function writeVarInt(value) {
  const buf = [];
  while (true) {
    if ((value & 0xFFFFFF80) === 0) {
      buf.push(value);
      return Buffer.from(buf);
    }
    buf.push((value & 0x7F) | 0x80);
    value >>>= 7;
  }
}

function readVarInt(buffer, offset = 0) {
  let result = 0;
  let numRead = 0;
  let offsetIndex = offset;
  while (true) {
    if (offsetIndex >= buffer.length) return { value: 0, bytes: 0 };
    const read = buffer.readUInt8(offsetIndex++);
    const value = read & 0x7F;
    result |= value << (7 * numRead);
    numRead++;
    if (numRead > 5) {
      throw new Error('VarInt is too big');
    }
    if ((read & 0x80) !== 128) {
      break;
    }
  }
  return { value: result, bytes: numRead };
}

// 5. Minecraft Server Status Ping (Native Protocol)
app.get('/api/status', async (req, res) => {
  const config = readConfig();
  const host = config.ip || 'localhost';
  const port = parseInt(config.port) || 25565;

  const client = new net.Socket();
  let finished = false;

  const respond = (data) => {
    if (finished) return;
    finished = true;
    client.destroy();
    res.json(data);
  };

  client.setTimeout(2500);

  client.connect(port, host, () => {
    // 1. Send Handshake
    const hostBytes = Buffer.from(host, 'utf8');
    const handshakePacket = Buffer.concat([
      Buffer.from([0x00]), // Packet ID
      writeVarInt(763),    // Protocol version (1.20.1 = 763)
      writeVarInt(hostBytes.length),
      hostBytes,
      Buffer.from([
        (port >> 8) & 0xFF,
        port & 0xFF
      ]),
      writeVarInt(1) // Next state: 1 (status)
    ]);
    const handshakeLength = writeVarInt(handshakePacket.length);
    client.write(Buffer.concat([handshakeLength, handshakePacket]));

    // 2. Send Status Request
    const requestPacket = Buffer.from([0x00]); // Packet ID 0x00
    const requestLength = writeVarInt(requestPacket.length);
    client.write(Buffer.concat([requestLength, requestPacket]));
  });

  let responseData = Buffer.alloc(0);

  client.on('data', (chunk) => {
    responseData = Buffer.concat([responseData, chunk]);
    
    try {
      if (responseData.length < 2) return;
      // Read total length VarInt
      const totalLen = readVarInt(responseData, 0);
      if (responseData.length < totalLen.bytes + totalLen.value) {
        // Wait for more data
        return;
      }

      // Read Packet ID VarInt
      const packetIdOffset = totalLen.bytes;
      const packetId = readVarInt(responseData, packetIdOffset);
      
      // Read JSON length VarInt
      const jsonLenOffset = packetIdOffset + packetId.bytes;
      const jsonLen = readVarInt(responseData, jsonLenOffset);
      
      const jsonStringOffset = jsonLenOffset + jsonLen.bytes;
      const jsonString = responseData.toString('utf8', jsonStringOffset, jsonStringOffset + jsonLen.value);
      
      const pingData = JSON.parse(jsonString);
      respond({
        online: true,
        motd: pingData.description ? (typeof pingData.description === 'string' ? pingData.description : (pingData.description.text || '')) : '',
        players: {
          online: pingData.players ? pingData.players.online : 0,
          max: pingData.players ? pingData.players.max : 0
        },
        version: pingData.version ? pingData.version.name : '',
        latency: 45 // placeholder ping
      });
    } catch (err) {
      // Parsing or reading error, wait for more data or handle error
    }
  });

  client.on('error', (err) => {
    respond({
      online: false,
      motd: 'Servidor fuera de línea o inaccesible',
      players: { online: 0, max: 0 },
      version: 'Desconocida',
      latency: 999
    });
  });

  client.on('timeout', () => {
    respond({
      online: false,
      motd: 'Tiempo de espera agotado al conectar',
      players: { online: 0, max: 0 },
      version: 'Desconocida',
      latency: 999
    });
  });
});

// Serve public files (mods, configs, etc. and assets)
app.use('/', express.static(PUBLIC_DIR));

app.listen(PORT, () => {
  console.log(`Pedsafio Server REST API listening on port ${PORT}`);
});
