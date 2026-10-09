# ZapCut

Extensión para Adobe Premiere Pro: silencia malas palabras, corta silencios y muletillas, reencuadra a 9:16 con pantalla dividida automática, encuentra momentos virales con su hook y monta multicámara.

## Instalar
- **Instalador:** descarga `dist/Install_ZapCut_v1.7.exe` y ejecútalo. Cierra Premiere antes.
- **ZXP:** instala `dist/ZapCut_v1.7.zxp` con ZXP Installer. Si el panel sale en blanco, ejecuta `dist/ZapCut_Activar.reg` y reinicia Premiere.

Luego abre Premiere → Ventana → Extensiones → ZapCut.

## Estructura
- `src/ext` código de la extensión · `src/installer.nsi` script del instalador (NSIS)
- `dist` archivos para descargar · `dist/version.json` versión más reciente

## Actualizaciones
Desde la v1.7 el panel avisa cuando hay una versión nueva y se actualiza con un clic. Cada actualización va firmada; el panel rechaza cualquier archivo cuya firma o huella no coincida.
Para publicar una versión: sube el número en `src/ext/CSXS/manifest.xml`, ejecuta `tools/publicar.ps1` con tu llave de actualizaciones y sube los cambios con git.
