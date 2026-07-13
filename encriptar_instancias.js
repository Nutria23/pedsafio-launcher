const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
const SECRET_KEY = crypto.scryptSync('PedSafioSecureKey2026!', 'salt_pedsafio_instance', 32);
const IV = Buffer.alloc(16, 9);

function encryptFile(srcPath, destPath) {
  return new Promise((resolve, reject) => {
    try {
      const stats = fs.statSync(srcPath);
      if (stats.isDirectory()) {
        return reject(new Error(`El archivo de origen "${path.basename(srcPath)}" es una carpeta, no un archivo ZIP.`));
      }

      const cipher = crypto.createCipheriv(ALGORITHM, SECRET_KEY, IV);
      const input = fs.createReadStream(srcPath);
      const output = fs.createWriteStream(destPath);

      input.on('error', (err) => {
        output.close();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        reject(new Error(`Error de lectura en origen: ${err.message}`));
      });

      cipher.on('error', (err) => {
        output.close();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        reject(new Error(`Error en cifrador AES: ${err.message}`));
      });

      output.on('error', (err) => {
        output.close();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        reject(new Error(`Error de escritura en destino: ${err.message}`));
      });

      output.on('finish', () => {
        resolve();
      });

      input.pipe(cipher).pipe(output);
    } catch (err) {
      reject(err);
    }
  });
}

async function run() {
  const localPublicZip = path.join(__dirname, 'instance.zip');
  const localAdminZip = path.join(__dirname, 'instance-admin.zip');

  const destPublicEnc = path.join(__dirname, 'instance.zip.enc');
  const destAdminEnc = path.join(__dirname, 'instance-admin.zip.enc');

  console.log('===================================================');
  console.log('    CIFRADOR DE SEGURIDAD AES-256 - PEDSAFIO');
  console.log('===================================================');

  if (fs.existsSync(localPublicZip)) {
    console.log('\n[1/2] Cifrando instancia pública (instance.zip)...');
    const start = Date.now();
    await encryptFile(localPublicZip, destPublicEnc);
    if (!fs.existsSync(destPublicEnc)) {
      throw new Error(`El archivo de destino cifrado no fue creado: ${destPublicEnc}`);
    }
    const size = fs.statSync(destPublicEnc).size;
    console.log(`✓ Cifrado finalizado: instance.zip.enc (${(size / (1024*1024)).toFixed(2)} MB) en ${((Date.now() - start)/1000).toFixed(2)}s`);
  } else {
    console.log('\n[!] Omitido: No se encontró instance.zip para cifrar.');
  }

  if (fs.existsSync(localAdminZip)) {
    console.log('\n[2/2] Cifrando instancia de admins (instance-admin.zip)...');
    const start = Date.now();
    await encryptFile(localAdminZip, destAdminEnc);
    if (!fs.existsSync(destAdminEnc)) {
      throw new Error(`El archivo de destino cifrado no fue creado: ${destAdminEnc}`);
    }
    const size = fs.statSync(destAdminEnc).size;
    console.log(`✓ Cifrado finalizado: instance-admin.zip.enc (${(size / (1024*1024)).toFixed(2)} MB) en ${((Date.now() - start)/1000).toFixed(2)}s`);
  } else {
    console.log('\n[!] Omitido: No se encontró instance-admin.zip para cifrar.');
  }

  console.log('\n===================================================');
  console.log(' ¡Proceso completado!');
  console.log(' Sube los archivos .zip.enc a tu carpeta de juego');
  console.log('===================================================');
}

run().catch(err => {
  console.error('\n[ERROR]', err.message);
  process.exit(1);
});
