const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const publicUrl = 'https://archive.org/download/instance-admin/instance.zip.enc';
const adminUrl = 'https://archive.org/download/instance-admin/instance-admin.zip.enc';

const manifestPath = path.join(__dirname, 'backend', 'manifest.json');
const localPublicPath = path.join(__dirname, 'instance.zip.enc');
const localAdminPath = path.join(__dirname, 'instance-admin.zip.enc');

function getHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}

async function run() {
  if (!fs.existsSync(localPublicPath)) {
    throw new Error('No se encontró el archivo "instance.zip.enc" cifrado en la carpeta del launcher.');
  }
  if (!fs.existsSync(localAdminPath)) {
    throw new Error('No se encontró el archivo "instance-admin.zip" cifrado en la carpeta del launcher.');
  }

  console.log('Analizando archivo cifrado local instance.zip.enc (procesando streaming)...');
  const sizePublic = fs.statSync(localPublicPath).size;
  const hashPublic = await getHash(localPublicPath);
  console.log(`Pública - Tamaño: ${(sizePublic / (1024 * 1024)).toFixed(2)} MB, Hash: ${hashPublic}`);

  console.log('Analizando archivo cifrado local instance-admin.zip.enc...');
  const sizeAdmin = fs.statSync(localAdminPath).size;
  const hashAdmin = await getHash(localAdminPath);
  console.log(`Admin - Tamaño: ${(sizeAdmin / (1024 * 1024)).toFixed(2)} MB, Hash: ${hashAdmin}`);

  // Leer y actualizar el manifiesto local
  let manifest = { files: [] };
  if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  }

  // Filtrar instancias previas y eliminar archivos de prueba mock
  manifest.files = manifest.files.filter(f => 
    f.path.startsWith('http') && 
    f.path !== publicUrl && 
    f.path !== adminUrl && 
    !f.path.includes('instance.zip') && 
    !f.path.includes('instance-admin.zip')
  );

  // Registrar las nuevas vinculadas con el link de Archive.org encriptado
  manifest.files.push({
    path: publicUrl,
    size: sizePublic,
    hash: hashPublic,
    adminOnly: false
  });

  manifest.files.push({
    path: adminUrl,
    size: sizeAdmin,
    hash: hashAdmin,
    adminOnly: true
  });

  manifest.timestamp = Date.now();
  manifest.filesCount = manifest.files.length;

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log('✓ Manifiesto local (backend/manifest.json) actualizado con éxito.');
}

run().catch(err => {
  console.error('\n[ERROR]', err.message);
  process.exit(1);
});
