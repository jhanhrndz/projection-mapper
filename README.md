# Projection Mapper Studio

Projection Mapper Studio es un software profesional de **Video Mapping (Mapeo de Proyección)** diseñado para transformar objetos físicos, fachadas, estructuras y esculturas mediante proyección de video e imágenes. Cuenta con una arquitectura de doble ventana a 0 ms de latencia, manipulación geométrica con curvas Bézier de precisión milimétrica (subdivisión De Casteljau), máscaras de oclusión, paquetes de proyecto portables (.pmap) y motor de renderizado de video acelerado por hardware (GPU). Creado para operar 100% offline y listo para uso en shows en vivo.

---

## 📑 Documentación Adicional

* 📘 **[Guía de Usuario](./documentation/GUIA_DE_USUARIO.md):** Manual completo paso a paso para aprender a usar el software, configurar proyectores, calibrar figuras, asignar medios y presentar en vivo.
* 🛠️ **[Documentación Técnica Oficial](./documentation/DOCUMENTACION_TECNICA.md):** Arquitectura interna, fundamentos matemáticos de homografía, protocolos de sincronización a 0 ms, motor de renderizado y estructura del código para desarrolladores.

---

## 🚀 Inicio Rápido (Windows)

1. **Iniciar:** Haz doble clic en [`INICIAR.bat`](./INICIAR.bat)  
   *(Comprueba el entorno, libera el puerto 8085 si estaba ocupado, arranca el servidor local y abre la ventana de control en tu navegador predeterminado).*
2. **Detener:** Haz doble clic en [`DETENER.bat`](./DETENER.bat) o usa el botón **"Apagar Servidor"** desde el menú de 3 puntos (`⋮`) de la interfaz web.

### 🌐 Direcciones Locales
* **Ventana de Control (Operador):** `http://localhost:8085/`
* **Ventana de Proyector (Salida de Video):** `http://localhost:8085/projector`  
  *(Arrastra esta ventana a la pantalla del proyector y pulsa `F11` o `F` para pantalla completa con fondo negro absoluto).*

---

## ✨ Características Principales

* **Arquitectura de Doble Ventana a 0 ms de Latencia:** Comunicación bidireccional inmediata mediante `BroadcastChannel` entre la interfaz de edición y la ventana del proyector sin requerir WebSockets lentos ni servidores externos.
* **Geometrías Avanzadas y Curvas Bézier:**
  * Figuras estándar: Cuadriláteros, Cuadrados, Círculos/Elipses, Triángulos, Pentágonos y Hexágonos.
  * **Polígono Recto Libre (`P`):** Dibuja superficies con cualquier cantidad de vértices haciendo clic sobre la estructura real.
  * **Polígono Curvo (`C`):** Dibuja arcos y contornos orgánicos con ajuste interactivo de tensión Bézier en tiempo real.
* **Máscaras de Oclusión:** Figuras que proyectan negro puro (`#000000`) para bloquear ventanas, vigas, puertas o zonas donde la luz del proyector no debe incidir.
* **Asignación Multimedia Flexible:**
  * Soporte de video (`.mp4`, `.webm`, `.mov`), imágenes (`.png`, `.jpg`, `.svg`, `.webp`) y colores sólidos con opacidad regulable.
  * Control de reproducción individual por superficie: Play/Pausa, Loop, Silencio, Velocidad (0.25x a 2.0x).
  * **Arrastrar y Soltar (Drag & Drop):** Arrastra archivos de imagen o video directamente desde el explorador de Windows sobre cualquier figura del lienzo.
* **Alineación y Calibración Milimétrica:**
  * Guía láser con retícula de proyección y coordenadas antes de fijar vértices.
  * Micro-ajuste óptico con flechas del teclado: 1 px por pulsación (o 10 px manteniendo `Shift`).
  * Conmutación instantánea entre **Modo Calibración** (con líneas guía, esquinas y números) y **Modo Presentación** (salida limpia sin interfaz) pulsando la tecla `Espacio` o `M`.
* **Paquetes de Proyecto Autónomos (`.pmap`):**
  * Empaqueta en un único archivo comprimido las geometrías de la escena junto con los **archivos de video e imágenes reales** asignados a cada superficie.
  * Permite diseñar en una computadora de escritorio y llevar el proyecto en una memoria USB a la laptop del proyector sin enlaces rotos.
* **Exportador de Video Pre-Mapeado (.mp4):**
  * Renderiza frame-a-frame el diseño completo en un archivo `.mp4` mapeado listo para reproducir en cualquier reproductor multimedia (VLC, hardware media player, etc.).
  * **Aceleración Híbrida Inteligente GPU:** Detección automática de hardware (AMD AMF, NVIDIA NVENC, Intel QSV, Windows Media Foundation) con fallback a CPU (`libx264`).
  * **Pausa Automática del Proyector:** Suspende la reproducción de videos en la ventana del proyector durante el render para otorgar el 100% de la GPU al renderizado.
  * **Cancelación Limpia:** Si cancelas un render, el archivo parcial se elimina automáticamente del disco sin dejar residuos corruptos.
* **Gestor de Escenas y Persistencia:**
  * Auto-guardado en tiempo real en almacenamiento local para no perder trabajo ante cierres inesperados.
  * Guardado rápido (`Ctrl+S`), Guardar Como (`Ctrl+Shift+S`) y Gestor con buscador en vivo (`Ctrl+O`).
  * Edición del nombre de la escena directamente desde la barra superior.
* **Edición Portable (USB Ready):**
  * Paquete autónomo en la carpeta `ProjectionMapper-Portable/` con runtime de Python embebido y FFmpeg incluido, listo para ejecutarse en cualquier PC con Windows 10/11 sin instalar nada.

---

## ⌨️ Atajos de Teclado

| Atajo | Acción |
|---|---|
| <kbd>V</kbd> | Modo Selección y Edición de Vértices |
| <kbd>P</kbd> | Herramienta Dibujar Polígono Recto |
| <kbd>C</kbd> | Herramienta Dibujar Polígono Curvo (Bézier) |
| <kbd>Espacio</kbd> o <kbd>M</kbd> | Alternar entre Modo Calibración y Modo Presentación |
| <kbd>Enter</kbd> | Cerrar y finalizar el polígono en curso de dibujo |
| <kbd>Esc</kbd> | Cancelar dibujo actual / Deseleccionar figura |
| <kbd>Ctrl + S</kbd> | Guardado rápido de la escena actual |
| <kbd>Ctrl + Shift + S</kbd> | Guardar escena como... (con nuevo nombre) |
| <kbd>Ctrl + O</kbd> | Abrir Gestor de Escenas y Proyectos |
| <kbd>Ctrl + Z</kbd> | Deshacer última acción geométrica |
| <kbd>Ctrl + Y</kbd> | Rehacer acción deshecha |
| <kbd>Supr</kbd> / <kbd>Del</kbd> | Eliminar vértice seleccionado o figura activa |
| <kbd>Shift + Clic</kbd> | Selección múltiple de vértices |
| <kbd>Flechas (↑ ↓ ← →)</kbd> | Micro-ajuste milimétrico de vértices (1 px) |
| <kbd>Shift + Flechas</kbd> | Micro-ajuste rápido de vértices (10 px) |
| <kbd>?</kbd> o <kbd>F1</kbd> | Abrir ventana modal de ayuda y atajos |
| <kbd>F</kbd> o <kbd>F11</kbd> *(Proyector)* | Activar / Desactivar pantalla completa |

---

## 📦 Requisitos e Instalación

### Opción 1: Versión Portable (Recomendada para Producción)
Si utilizas la versión ubicada en `ProjectionMapper-Portable/`:
* **No requiere instalar nada.** Incluye Python 3.13 embebido y FFmpeg 7.0 preconfigurados.
* Compatible con Windows 10 y Windows 11 (64 bits).

### Opción 2: Entorno de Desarrollo Python
Si clonas el repositorio o trabajas en la versión fuente:

```bash
# 1. Crear entorno virtual
python -m venv .venv
.venv\Scripts\activate

# 2. Instalar dependencias
pip install -r requirements.txt

# 3. Iniciar servidor
python server.py
```

Dependencias principales (`requirements.txt`):
* `opencv-python>=4.8.0` (procesamiento y homografía de video)
* `numpy>=1.24.0` (operaciones matriciales vectorizadas)

---

## 📁 Estructura del Proyecto

```text
projection-mapper/
├── INICIAR.bat              # Script de arranque en 1 clic
├── DETENER.bat              # Script de apagado y liberación de puerto
├── server.py                # Servidor HTTP multihilo, API REST y streaming
├── video_exporter.py        # Motor de renderizado GPU y composición de video
├── requirements.txt         # Dependencias de Python
├── README.md                # Documentación principal del repositorio
├── GUIA_DE_USUARIO.md       # Manual de usuario final para operadores
├── DOCUMENTACION_TECNICA.md # Especificación técnica y arquitectura para desarrolladores
├── media/                   # Archivos multimedia del proyecto
│   ├── images/              # Imágenes importadas y texturas de prueba
│   ├── videos/              # Clips de video asignados a superficies
│   └── exports/             # Videos renderizados (.mp4)
├── scenes/                  # Escenas guardadas en formato JSON
└── static/                  # Frontend de la aplicación
    ├── index.html           # Interfaz de la Ventana de Control
    ├── projector.html       # Interfaz de la Ventana del Proyector
    ├── css/
    │   ├── control.css      # Estilos de la ventana de control, modales y temas
    │   └── projector.css    # Estilos de salida de proyección limpia
    └── js/
        ├── sync.js          # Sincronización BroadcastChannel (0 ms)
        ├── math_warp.js     # Matemáticas de homografía 3D y curvas Bézier
        ├── polygon_model.js # Modelos de datos de polígonos y escenas
        ├── editor_canvas.js # Motor interactivo del lienzo SVG de diseño
        ├── projector_view.js# Motor de renderizado en proyector (CSS 3D + SVG)
        ├── scene_manager.js # Gestor de escenas, modal e importador/exportador
        ├── ui_controller.js # Controlador principal de eventos y paneles
        └── export_modal.js  # Interfaz y monitor de progreso de renderizado
```

