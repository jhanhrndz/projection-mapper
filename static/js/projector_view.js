/**
 * projector_view.js - Motor de renderizado para la ventana de proyección a pantalla completa.
 * Fondo negro puro (#000000), sin bordes, con modo calibración (líneas de alineación sobre el objeto real)
 * y modo presentación (limpio, solo superficies proyectadas).
 */

class ProjectorView {
  constructor() {
    this.sync = new MappingSync('projector');
    this.polygons = [];
    this.selectedId = null;
    this.displayMode = 'calibration'; // 'calibration' | 'show'
    this.draft = { points: [], pointer: null, active: false };

    this.initDOM();
    this.bindSyncEvents();
    this.bindWindowEvents();

    // Solicitar estado a la ventana de control al arrancar
    this.sync.requestSync();
  }

  initDOM() {
    this.container = document.getElementById('projector-container');
    this.container.innerHTML = `
      <!-- Capa de texturas de video/imagen acelerada por GPU -->
      <div id="projector-media-viewport" class="projector-media-viewport"></div>
      <svg id="projector-svg" viewBox="0 0 1920 1080" preserveAspectRatio="none">
        <defs>
          <filter id="p-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
        <!-- Capa de relleno vectorial para superficies sin imagen -->
        <g id="p-vector-layer"></g>
        <!-- Capa de calibración (guías, esquinas y números) -->
        <g id="p-calibration-layer"></g>
      </svg>
      <div id="status-pill" class="status-pill">Modo Calibración (Presiona Espacio para Show)</div>
      
      <!-- Pantalla de suspensión de recursos por renderizado / exportación de video -->
      <div id="export-pause-overlay" class="export-pause-overlay hidden">
        <div class="export-pause-card">
          <div class="export-pause-icon" style="display:flex; justify-content:center; align-items:center; gap: 8px; color: #00f0ff;">
            ${typeof Icons !== 'undefined' ? Icons.get('film', { size: 44 }) + Icons.get('pause', { size: 36 }) : ''}
          </div>
          <h2 class="export-pause-title">Transmisión pausada por renderizado / exportación de video</h2>
          <p class="export-pause-subtitle">Liberando recursos para máxima velocidad de exportación...</p>
          <div class="export-pause-bar-track">
            <div id="export-pause-bar-fill" class="export-pause-bar-fill" style="width: 0%;"></div>
          </div>
          <div id="export-pause-pct-txt" class="export-pause-pct-txt">Renderizando: 0%</div>
        </div>
      </div>
    `;

    this.mediaViewport = document.getElementById('projector-media-viewport');
    this.svg = document.getElementById('projector-svg');
    this.vectorLayer = document.getElementById('p-vector-layer');
    this.calibLayer = document.getElementById('p-calibration-layer');
    this.statusPill = document.getElementById('status-pill');

    this.updateViewportScale();
    window.addEventListener('resize', () => this.updateViewportScale());
  }

  updateViewportScale() {
    if (!this.mediaViewport) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scaleX = w / 1920;
    const scaleY = h / 1080;
    this.mediaViewport.style.width = '1920px';
    this.mediaViewport.style.height = '1080px';
    this.mediaViewport.style.transform = `scale(${scaleX}, ${scaleY})`;
    this.mediaViewport.style.transformOrigin = '0 0';
  }

  bindSyncEvents() {
    this.sync.on('SYNC_FULL_STATE', (sceneData) => {
      this.polygons = sceneData.polygons || [];
      if (sceneData.displayMode) this.displayMode = sceneData.displayMode;
      this.render();
    });

    this.sync.on('POLYGON_UPDATE', (polyData) => {
      const idx = this.polygons.findIndex(p => p.id === polyData.id);
      if (idx !== -1) {
        this.polygons[idx] = polyData;
      } else {
        this.polygons.push(polyData);
      }
      this.render();
    });

    this.sync.on('POLYGON_DELETE', ({ id }) => {
      this.polygons = this.polygons.filter(p => p.id !== id);
      this.render();
    });

    this.sync.on('DISPLAY_MODE', ({ mode }) => {
      this.displayMode = mode;
      this.render();
    });

    this.sync.on('SELECTION_CHANGE', ({ id }) => {
      this.selectedId = id;
      this.render();
    });

    this.sync.on('VIDEO_ACTION', ({ polyId, action, value }) => {
      if (!this.mediaViewport) return;
      const el = this.mediaViewport.querySelector(`[data-poly-id="${polyId}"]`);
      if (!el) return;
      const video = el.querySelector('video');
      if (!video) return;

      if (action === 'play') {
        video.play().catch(() => {});
      } else if (action === 'pause') {
        video.pause();
      } else if (action === 'seek') {
        video.currentTime = value;
      } else if (action === 'rate') {
        video.playbackRate = value;
      } else if (action === 'loop') {
        video.loop = Boolean(value);
      } else if (action === 'mute') {
        video.muted = Boolean(value);
      }
    });

    this.sync.on('DRAFT_UPDATE', ({ points, pointer, curves, mode, active }) => {
      this.draft = { points: points || [], pointer: pointer || null, curves: curves || null, mode: mode || 'straight', active: Boolean(active) };
      this.renderCalibrationLayer();
    });

    this.sync.on('DRAFT_CLEAR', () => {
      this.draft = { points: [], pointer: null, active: false };
      this.renderCalibrationLayer();
    });

    this.sync.on('EXPORT_STATE', ({ isRunning, progress, message }) => {
      this.handleExportState(isRunning, progress, message);
    });
  }

  handleExportState(isRunning, progress = 0, message = '') {
    const overlay = document.getElementById('export-pause-overlay');
    const bar = document.getElementById('export-pause-bar-fill');
    const txt = document.getElementById('export-pause-pct-txt');

    if (isRunning) {
      if (overlay) overlay.classList.remove('hidden');
      const safePct = Math.min(100, Math.max(0, progress));
      if (bar) bar.style.width = `${safePct}%`;
      if (txt) txt.textContent = message || `Renderizando: ${Math.round(safePct)}%`;

      // Pausar todos los videos activos en el proyector para liberar la GPU
      if (this.mediaViewport) {
        this.mediaViewport.querySelectorAll('video').forEach(vid => {
          if (!vid.paused) {
            vid.dataset.pausedByExport = "true";
            vid.pause();
          }
        });
      }
    } else {
      if (overlay) overlay.classList.add('hidden');
      // Reanudar la reproducción de los videos que estaban en marcha
      if (this.mediaViewport) {
        this.mediaViewport.querySelectorAll('video').forEach(vid => {
          if (vid.dataset.pausedByExport === "true") {
            delete vid.dataset.pausedByExport;
            vid.play().catch(() => {});
          }
        });
      }
    }
  }

  bindWindowEvents() {
    // Tecla F o doble clic para pantalla completa
    window.addEventListener('dblclick', () => this.toggleFullscreen());
    window.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'f') {
        this.toggleFullscreen();
      } else if (e.code === 'Space' || e.key.toLowerCase() === 'c') {
        this.displayMode = this.displayMode === 'calibration' ? 'show' : 'calibration';
        this.sync.broadcastDisplayMode(this.displayMode);
        this.render();
      }
    });
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.warn('[Projector] Error activando pantalla completa:', err);
      });
    } else {
      document.exitFullscreen();
    }
  }

  render() {
    this.updateViewportScale();
    this.updateStatusPill();
    this.renderMediaLayer();
    this.renderCalibrationLayer();
  }

  updateStatusPill() {
    if (this.displayMode === 'calibration') {
      document.body.classList.remove('presentation-mode');
      this.statusPill.textContent = 'Modo Calibración · Presiona F para Pantalla Completa · Espacio para Presentación';
      this.statusPill.style.opacity = '0.8';
    } else {
      document.body.classList.add('presentation-mode');
      this.statusPill.style.opacity = '0';
    }
  }

  renderMediaLayer() {
    if (!this.mediaViewport) return;

    const currentIds = new Set();
    let vectorHtml = '';

    this.polygons.forEach((poly, index) => {
      if (!poly.visible) return;
      currentIds.add(poly.id);

      const isOccluder = poly.type === 'occluder' || poly.type === 'circle_occluder';
      const isCircular = poly.type === 'circle' || poly.type === 'circle_occluder';
      const hasEdgeCurves = !isCircular && poly.edgeCurves && Object.keys(poly.edgeCurves).length > 0;
      const isImage = poly.media && poly.media.type === 'image' && poly.media.src;
      const isVideo = poly.media && poly.media.type === 'video' && poly.media.src;
      const opacity = poly.media?.opacity !== undefined ? poly.media.opacity : 1.0;

      let clipPts = [];
      if (isCircular) {
        const center = poly.center || [0.5, 0.5];
        const rx = poly.radiusX !== undefined ? poly.radiusX : 0.18;
        const ry = poly.radiusY !== undefined ? poly.radiusY : 0.18;
        const rot = poly.rotation || 0;
        clipPts = MathWarp.getEllipseBoundary(center[0], center[1], rx, ry, rot, 64);
      } else if (hasEdgeCurves) {
        clipPts = MathWarp.getSampledCurvedPolygon(poly.points, poly.edgeCurves, 24);
      } else {
        clipPts = poly.points || [];
      }

      const pixelPts = clipPts.map(([nx, ny]) => [nx * 1920, ny * 1080]);
      const ptsStr = pixelPts.map(p => p.join(',')).join(' ');

      let el = this.mediaViewport.querySelector(`[data-poly-id="${poly.id}"]`);

      if (isOccluder) {
        if (!el || el.dataset.kind !== 'occluder') {
          if (el) el.remove();
          el = document.createElement('div');
          el.dataset.polyId = poly.id;
          el.dataset.kind = 'occluder';
          el.style.position = 'absolute';
          el.style.top = '0';
          el.style.left = '0';
          el.style.width = '1920px';
          el.style.height = '1080px';
          el.style.background = '#000000';
          this.mediaViewport.appendChild(el);
        }
        el.style.zIndex = (index + 1).toString();
        el.style.clipPath = MathWarp.getClipPathPolygon(clipPts, 1920, 1080);
        this.mediaViewport.appendChild(el);

        if (isCircular) {
          const cx = poly.center[0] * 1920;
          const cy = poly.center[1] * 1080;
          const rx = poly.radiusX * 1920;
          const ry = poly.radiusY * 1080;
          const rot = poly.rotation || 0;
          vectorHtml += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${rot} ${cx} ${cy})" fill="#000000" stroke="none" />`;
        } else if (hasEdgeCurves) {
          vectorHtml += `<path d="${MathWarp.getCurvedSvgPath(poly.points, poly.edgeCurves, 1920, 1080)}" fill="#000000" stroke="none" />`;
        } else {
          vectorHtml += `<polygon points="${ptsStr}" fill="#000000" stroke="none" />`;
        }
        return;
      }

      if (isImage || isVideo) {
        const mediaTag = isVideo ? 'video' : 'img';
        const isStandardQuad = !isCircular && !hasEdgeCurves && poly.type === 'quad' && pixelPts.length === 4;

        if (isStandardQuad) {
          const kind = `quad-${mediaTag}`;
          if (!el || el.dataset.kind !== kind) {
            if (el) el.remove();
            el = document.createElement('div');
            el.dataset.polyId = poly.id;
            el.dataset.kind = kind;
            el.className = 'warped-media-quad';
            const mediaElem = document.createElement(mediaTag);
            mediaElem.draggable = false;
            mediaElem.src = poly.media.src;
            if (isVideo) {
              mediaElem.playsInline = true;
              mediaElem.autoplay = true;
              mediaElem.muted = poly.media.muted !== false;
              mediaElem.loop = poly.media.loop !== false;
              mediaElem.playbackRate = poly.media.playbackRate || 1.0;
              mediaElem.play().catch(() => {});
            }
            el.appendChild(mediaElem);
            this.mediaViewport.appendChild(el);
          } else {
            const mediaElem = el.querySelector(mediaTag);
            if (mediaElem && mediaElem.getAttribute('src') !== poly.media.src) {
              mediaElem.src = poly.media.src;
              if (isVideo) mediaElem.play().catch(() => {});
            }
          }

          // Transformación in-situ fluida sin parpadeo
          const matrix = MathWarp.getMatrix3D(pixelPts, 1000, 1000);
          el.style.transform = matrix;
          el.style.opacity = opacity;
          el.style.zIndex = (index + 1).toString();
          this.mediaViewport.appendChild(el);
        } else if (pixelPts.length >= 3) {
          // Circular, elíptica o polígono con curvas Bézier
          const kind = `polygon-${mediaTag}`;
          if (!el || el.dataset.kind !== kind) {
            if (el) el.remove();
            el = document.createElement('div');
            el.dataset.polyId = poly.id;
            el.dataset.kind = kind;
            el.style.position = 'absolute';
            el.style.top = '0';
            el.style.left = '0';
            el.style.width = '1920px';
            el.style.height = '1080px';
            el.style.overflow = 'visible';
            const mediaElem = document.createElement(mediaTag);
            mediaElem.draggable = false;
            mediaElem.style.position = 'absolute';
            mediaElem.style.objectFit = 'fill';
            mediaElem.src = poly.media.src;
            if (isVideo) {
              mediaElem.playsInline = true;
              mediaElem.autoplay = true;
              mediaElem.muted = poly.media.muted !== false;
              mediaElem.loop = poly.media.loop !== false;
              mediaElem.playbackRate = poly.media.playbackRate || 1.0;
              mediaElem.play().catch(() => {});
            }
            el.appendChild(mediaElem);
            this.mediaViewport.appendChild(el);
          } else {
            const mediaElem = el.querySelector(mediaTag);
            if (mediaElem && mediaElem.getAttribute('src') !== poly.media.src) {
              mediaElem.src = poly.media.src;
              if (isVideo) mediaElem.play().catch(() => {});
            }
          }

          const clipPath = MathWarp.getClipPathPolygon(clipPts, 1920, 1080);
          const xs = pixelPts.map(p => p[0]);
          const ys = pixelPts.map(p => p[1]);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);

          el.style.clipPath = clipPath;
          el.style.opacity = opacity;
          el.style.zIndex = (index + 1).toString();
          this.mediaViewport.appendChild(el);
          const mediaElem = el.querySelector(mediaTag);
          if (mediaElem) {
            mediaElem.style.left = `${minX}px`;
            mediaElem.style.top = `${minY}px`;
            mediaElem.style.width = `${Math.max(1, maxX - minX)}px`;
            mediaElem.style.height = `${Math.max(1, maxY - minY)}px`;
          }
        }
      } else {
        if (el) el.remove();
        const fill = poly.color || '#00f0ff';
        if (isCircular) {
          const cx = poly.center[0] * 1920;
          const cy = poly.center[1] * 1080;
          const rx = poly.radiusX * 1920;
          const ry = poly.radiusY * 1080;
          const rot = poly.rotation || 0;
          vectorHtml += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${rot} ${cx} ${cy})" fill="${fill}" fill-opacity="${opacity}" stroke="none" />`;
        } else if (hasEdgeCurves) {
          vectorHtml += `<path d="${MathWarp.getCurvedSvgPath(poly.points, poly.edgeCurves, 1920, 1080)}" fill="${fill}" fill-opacity="${opacity}" stroke="none" />`;
        } else {
          vectorHtml += `<polygon points="${ptsStr}" fill="${fill}" fill-opacity="${opacity}" stroke="none" />`;
        }
      }
    });

    // Limpiar polígonos que hayan sido eliminados
    const allDom = this.mediaViewport.querySelectorAll('[data-poly-id]');
    allDom.forEach(node => {
      if (!currentIds.has(node.dataset.polyId)) {
        node.remove();
      }
    });

    if (this.vectorLayer) this.vectorLayer.innerHTML = vectorHtml;
  }

  renderCalibrationLayer() {
    let html = '';

    // Si está en modo calibración, dibujar líneas de alambre de las superficies existentes
    if (this.displayMode === 'calibration') {
      this.polygons.forEach(poly => {
        if (!poly.visible) return;
        const isSelected = poly.id === this.selectedId;
        const isOccluder = poly.type === 'occluder' || poly.type === 'circle_occluder';
        const isCircular = poly.type === 'circle' || poly.type === 'circle_occluder';
        const hasEdgeCurves = !isCircular && poly.edgeCurves && Object.keys(poly.edgeCurves).length > 0;

        const strokeColor = isOccluder ? '#ffffff' : (isSelected ? '#ffffff' : poly.color);
        const strokeWidth = isSelected ? 3 : 1.5;
        const strokeDash = isOccluder ? '8 4' : 'none';

        if (isCircular) {
          const cx = poly.center[0] * 1920;
          const cy = poly.center[1] * 1080;
          const rx = poly.radiusX * 1920;
          const ry = poly.radiusY * 1080;
          const rot = poly.rotation || 0;

          html += `
            <ellipse 
              cx="${cx}" 
              cy="${cy}" 
              rx="${rx}" 
              ry="${ry}" 
              transform="rotate(${rot} ${cx} ${cy})"
              fill="none" 
              stroke="${strokeColor}" 
              stroke-width="${strokeWidth}" 
              stroke-dasharray="${strokeDash}"
              filter="url(#p-glow)"
            />
            <!-- Cruz central óptica -->
            <line x1="${cx - 10}" y1="${cy}" x2="${cx + 10}" y2="${cy}" stroke="#ffffff" stroke-width="2"/>
            <line x1="${cx}" y1="${cy - 10}" x2="${cx}" y2="${cy + 10}" stroke="#ffffff" stroke-width="2"/>
            <circle cx="${cx}" cy="${cy}" r="4" fill="#00f0ff" stroke="#000000" stroke-width="1.5"/>

            <text x="${cx}" y="${cy - 18}" fill="#ffffff" font-size="16" font-weight="bold" text-anchor="middle" dominant-baseline="middle" opacity="0.9">
              ${poly.name}
            </text>
          `;
        } else if (hasEdgeCurves) {
          const pathD = MathWarp.getCurvedSvgPath(poly.points, poly.edgeCurves, 1920, 1080);
          const pixelPts = poly.points.map(([nx, ny]) => [nx * 1920, ny * 1080]);

          html += `
            <path 
              d="${pathD}" 
              fill="none" 
              stroke="${strokeColor}" 
              stroke-width="${strokeWidth}" 
              stroke-dasharray="${strokeDash}"
              filter="url(#p-glow)"
            />
          `;

          // Cruces y números en cada esquina
          pixelPts.forEach(([px, py], i) => {
            html += `
              <line x1="${px - 8}" y1="${py}" x2="${px + 8}" y2="${py}" stroke="#ffffff" stroke-width="2"/>
              <line x1="${px}" y1="${py - 8}" x2="${px}" y2="${py + 8}" stroke="#ffffff" stroke-width="2"/>
              <circle cx="${px}" cy="${py}" r="4" fill="#00f0ff" stroke="#000000" stroke-width="1.5"/>
              <text x="${px + 8}" y="${py - 8}" fill="#ffffff" font-size="14" font-weight="bold">${i + 1}</text>
            `;
          });

          if (poly.points.length > 0) {
            const center = poly.points.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
            const cx = (center[0] / poly.points.length) * 1920;
            const cy = (center[1] / poly.points.length) * 1080;
            html += `
              <text x="${cx}" y="${cy}" fill="#ffffff" font-size="16" font-weight="bold" text-anchor="middle" dominant-baseline="middle" opacity="0.9">
                ${poly.name}
              </text>
            `;
          }
        } else {
          const pixelPts = poly.points.map(([nx, ny]) => [nx * 1920, ny * 1080]);
          const ptsStr = pixelPts.map(p => p.join(',')).join(' ');

          html += `
            <polygon 
              points="${ptsStr}" 
              fill="none" 
              stroke="${strokeColor}" 
              stroke-width="${strokeWidth}" 
              stroke-dasharray="${strokeDash}"
              filter="url(#p-glow)"
            />
          `;

          pixelPts.forEach(([px, py], i) => {
            html += `
              <line x1="${px - 8}" y1="${py}" x2="${px + 8}" y2="${py}" stroke="#ffffff" stroke-width="2"/>
              <line x1="${px}" y1="${py - 8}" x2="${px}" y2="${py + 8}" stroke="#ffffff" stroke-width="2"/>
              <circle cx="${px}" cy="${py}" r="4" fill="#00f0ff" stroke="#000000" stroke-width="1.5"/>
              <text x="${px + 8}" y="${py - 8}" fill="#ffffff" font-size="14" font-weight="bold">${i + 1}</text>
            `;
          });

          if (poly.points.length > 0) {
            const center = poly.points.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
            const cx = (center[0] / poly.points.length) * 1920;
            const cy = (center[1] / poly.points.length) * 1080;
            html += `
              <text x="${cx}" y="${cy}" fill="#ffffff" font-size="16" font-weight="bold" text-anchor="middle" dominant-baseline="middle" opacity="0.9">
                ${poly.name}
              </text>
            `;
          }
        }
      });
    }

    // Trazado en vivo proyectado sobre el objeto físico mientras el usuario dibuja
    if (this.draft && this.draft.active) {
      const hasPoints = this.draft.points && this.draft.points.length > 0;

      // Puntero de alineación óptica proyectado SOLO antes de colocar el primer punto
      if (!hasPoints && this.draft.pointer) {
        const cx = this.draft.pointer[0] * 1920;
        const cy = this.draft.pointer[1] * 1080;
        html += `
          <!-- Retícula de mira óptica para el primer vértice -->
          <circle cx="${cx}" cy="${cy}" r="26" fill="none" stroke="#00f0ff" stroke-width="2" stroke-dasharray="6 4" filter="url(#p-glow)"/>
          <circle cx="${cx}" cy="${cy}" r="9" fill="rgba(0, 240, 255, 0.25)" stroke="#ffffff" stroke-width="1.8" filter="url(#p-glow)"/>
          <circle cx="${cx}" cy="${cy}" r="3" fill="#ffffff"/>
          
          <!-- Cruz óptica de alineación -->
          <line x1="${cx - 36}" y1="${cy}" x2="${cx - 12}" y2="${cy}" stroke="#00f0ff" stroke-width="2.5" filter="url(#p-glow)"/>
          <line x1="${cx + 12}" y1="${cy}" x2="${cx + 36}" y2="${cy}" stroke="#00f0ff" stroke-width="2.5" filter="url(#p-glow)"/>
          <line x1="${cx}" y1="${cy - 36}" x2="${cx}" y2="${cy - 12}" stroke="#00f0ff" stroke-width="2.5" filter="url(#p-glow)"/>
          <line x1="${cx}" y1="${cy + 12}" x2="${cx}" y2="${cy + 36}" stroke="#00f0ff" stroke-width="2.5" filter="url(#p-glow)"/>

          <!-- Etiqueta guía -->
          <text x="${cx + 18}" y="${cy - 18}" fill="#ffffff" font-size="14" font-weight="bold" filter="url(#p-glow)">+ Vértice 1</text>
        `;
      }

      // Trazado de líneas y vértices una vez colocado al menos el primer punto
      if (hasPoints) {
        const pts = this.draft.points.map(([nx, ny]) => [nx * 1920, ny * 1080]);
        const ptsStr = pts.map(p => p.join(',')).join(' ');

        // Líneas fijadas entre vértices ya marcados
        if (pts.length >= 2) {
          if (this.draft.curves && Object.keys(this.draft.curves).length > 0) {
            const pathD = MathWarp.getOpenCurvedSvgPath(this.draft.points, this.draft.curves, 1920, 1080);
            const stroke = this.draft.mode === 'draw_curved' ? '#f472b6' : '#00f0ff';
            html += `
              <path 
                d="${pathD}" 
                fill="none" 
                stroke="${stroke}" 
                stroke-width="3.5" 
                stroke-dasharray="6 3" 
                filter="url(#p-glow)"
              />
            `;
          } else {
            html += `
              <polyline 
                points="${ptsStr}" 
                fill="none" 
                stroke="#00f0ff" 
                stroke-width="3.5" 
                stroke-dasharray="6 3" 
                filter="url(#p-glow)"
              />
            `;
          }
        }

        // Haz elástico interactivo hacia la posición del puntero del usuario
        if (this.draft.pointer && pts.length >= 1) {
          const lastPt = pts[pts.length - 1];
          const curPx = [this.draft.pointer[0] * 1920, this.draft.pointer[1] * 1080];
          if (this.draft.mode === 'draw_curved') {
            const dx = curPx[0] - lastPt[0];
            const dy = curPx[1] - lastPt[1];
            const cp1 = [lastPt[0] + dx * 0.33, lastPt[1] + dy * 0.33];
            const cp2 = [curPx[0] - dx * 0.33, curPx[1] - dy * 0.33];
            html += `
              <path 
                d="M ${lastPt[0]} ${lastPt[1]} C ${cp1[0]} ${cp1[1]}, ${cp2[0]} ${cp2[1]}, ${curPx[0]} ${curPx[1]}" 
                fill="none" 
                stroke="#f472b6" 
                stroke-width="3.5" 
                stroke-dasharray="6 3"
                filter="url(#p-glow)"
              />
            `;
          } else {
            html += `
              <line 
                x1="${lastPt[0]}" y1="${lastPt[1]}" 
                x2="${curPx[0]}" y2="${curPx[1]}" 
                stroke="#00f0ff" 
                stroke-width="3" 
                stroke-dasharray="5 5"
                filter="url(#p-glow)"
              />
            `;
          }
        }

        // Vértices marcados con anillos concéntricos brillantes
        pts.forEach(([px, py], i) => {
          html += `
            <circle cx="${px}" cy="${py}" r="7" fill="#00f0ff" stroke="#ffffff" stroke-width="2" filter="url(#p-glow)"/>
            <circle cx="${px}" cy="${py}" r="14" fill="none" stroke="#00f0ff" stroke-width="1.5" stroke-dasharray="3 3"/>
            <text x="${px + 12}" y="${py - 12}" fill="#ffffff" font-size="16" font-weight="bold" filter="url(#p-glow)">${i + 1}</text>
          `;
        });
      }
    }

    this.calibLayer.innerHTML = html;
  }
}

window.ProjectorView = ProjectorView;
