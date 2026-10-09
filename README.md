# ZapCut

Extensión para Adobe Premiere Pro: silencia malas palabras, corta silencios y muletillas, reencuadra a 9:16 con pantalla dividida automática, encuentra momentos virales con su hook y monta multicámara.

## Instalar
- **Instalador:** descarga `dist/Install_ZapCut_v1.6.exe` y ejecútalo. Cierra Premiere antes.
- **ZXP:** instala `dist/ZapCut_v1.6.zxp` con ZXP Installer. Si el panel sale en blanco, ejecuta `dist/ZapCut_Activar.reg` y reinicia Premiere.

Luego abre Premiere → Ventana → Extensiones → ZapCut.

## Estructura
- `src/ext` código de la extensión · `src/installer.nsi` script del instalador (NSIS)
- `dist` archivos para descargar · `dist/version.json` versión más reciente
