const fs = require('fs');
const path = require('path');

// Artifacts directory where chat uploads are placed
const ARTIFACTS_DIR = 'C:\\Users\\arturo\\.gemini\\antigravity-ide\\brain\\09747444-d28f-4acb-a6d5-5e3c686b34e6';
const WORKSPACE_DIR = __dirname;

// Visual asset source mappings (names extracted from listed artifacts)
const SOURCE_BACKGROUND = path.join(ARTIFACTS_DIR, 'media__1783844946781.jpg');
const SOURCE_LOGO = path.join(ARTIFACTS_DIR, 'media__1783845438369.jpg');

// Target destinations
const DEST_LAUNCHER_RESOURCES = path.join(WORKSPACE_DIR, 'launcher', 'resources');
const DEST_BACKEND_ASSETS = path.join(WORKSPACE_DIR, 'backend', 'public', 'assets');
const DEST_BACKEND_MODS = path.join(WORKSPACE_DIR, 'backend', 'public', 'mods');
const DEST_BACKEND_CONFIG = path.join(WORKSPACE_DIR, 'backend', 'public', 'config');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Creado directorio: ${dir}`);
  }
}

async function main() {
  console.log('=== Iniciando configuración de espacio de trabajo ===');

  const manifestPath = path.join(WORKSPACE_DIR, 'backend', 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    console.log('✓ El manifest.json ya existe. Saltando inicialización para preservar tus cambios.');
    console.log('=== Configuración de espacio de trabajo finalizada ===');
    return;
  }

  // 1. Ensure target folders exist
  ensureDir(DEST_LAUNCHER_RESOURCES);
  ensureDir(DEST_BACKEND_ASSETS);
  ensureDir(DEST_BACKEND_MODS);
  ensureDir(DEST_BACKEND_CONFIG);

  // 2. Copy Background
  if (fs.existsSync(SOURCE_BACKGROUND)) {
    fs.copyFileSync(SOURCE_BACKGROUND, path.join(DEST_LAUNCHER_RESOURCES, 'background.jpg'));
    fs.copyFileSync(SOURCE_BACKGROUND, path.join(DEST_BACKEND_ASSETS, 'background.jpg'));
    console.log('✓ Fondo de pantalla copiado a launcher/resources/ y backend/public/assets/');
  } else {
    console.warn(`⚠ No se encontró la imagen de fondo de origen en: ${SOURCE_BACKGROUND}`);
  }

  // 3. Copy Logo
  if (fs.existsSync(SOURCE_LOGO)) {
    fs.copyFileSync(SOURCE_LOGO, path.join(DEST_LAUNCHER_RESOURCES, 'logo.png'));
    fs.copyFileSync(SOURCE_LOGO, path.join(DEST_BACKEND_ASSETS, 'logo.png'));
    console.log('✓ Logotipo copiado a launcher/resources/ y backend/public/assets/');
  } else {
    console.warn(`⚠ No se encontró el logotipo de origen en: ${SOURCE_LOGO}`);
  }

  // 4. Create dummy mods and config files to demonstrate delta updating
  const dummyModPath = path.join(DEST_BACKEND_MODS, 'pedsafio-core-mod-v1.jar');
  if (!fs.existsSync(dummyModPath)) {
    fs.writeFileSync(dummyModPath, 'Dummy Minecraft Mod File Content - SHA256 Verification Test', 'utf8');
    console.log('✓ Creado mod de prueba: backend/public/mods/pedsafio-core-mod-v1.jar');
  }

  const dummyConfigPath = path.join(DEST_BACKEND_CONFIG, 'pedsafio-settings.toml');
  if (!fs.existsSync(dummyConfigPath)) {
    fs.writeFileSync(dummyConfigPath, '# Pedsafio Client Configurations File\nrenderDistance=12\nenableShaders=true\n', 'utf8');
    console.log('✓ Creado archivo de configuración de prueba: backend/public/config/pedsafio-settings.toml');
  }

  // 5. Generate initial manifest.json
  console.log('Generando manifest.json inicial...');
  const manifest = {
    timestamp: Date.now(),
    filesCount: 2,
    files: [
      {
        path: 'mods/pedsafio-core-mod-v1.jar',
        size: fs.statSync(dummyModPath).size,
        hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' // generic hash or placeholder
      },
      {
        path: 'config/pedsafio-settings.toml',
        size: fs.statSync(dummyConfigPath).size,
        hash: '8f75c40212f4585cbb159af8a61427ae34f4649f935fcc49603d1c8f85b341f2'
      }
    ]
  };

  // Re-calculate actual hashes
  const crypto = require('crypto');
  function getHash(filePath) {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(filePath));
    return hash.digest('hex');
  }

  manifest.files[0].hash = getHash(dummyModPath);
  manifest.files[1].hash = getHash(dummyConfigPath);

  fs.writeFileSync(
    path.join(WORKSPACE_DIR, 'backend', 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );
  console.log('✓ Creado manifest.json inicial en la carpeta backend.');

  console.log('=== Configuración de espacio de trabajo finalizada ===');
}

main().catch(err => {
  console.error('Error durante la configuración:', err);
});
