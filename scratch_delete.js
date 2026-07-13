const fs = require('fs');
if (fs.existsSync('.github')) {
  fs.rmSync('.github', { recursive: true, force: true });
  console.log("✓ Carpeta .github eliminada con éxito.");
}
try {
  fs.unlinkSync(__filename);
} catch (e) {}
