/**
 * editor_canvas.js - Motor interactivo de dibujo, edición y manipulación de polígonos.
 * Soporta creación punto a punto, arrastre de vértices con hit-rings ampliados,
 * puntos intermedios (midpoints) para insertar vértices y traslación de cuerpo entero.
 */

class EditorCanvas {
  constructor(containerEl, scene, sync) {
    this.container = containerEl;
    this.scene = scene;
    this.sync = sync;

    // Modos: 'select' | 'draw'
    this.mode = 'select';

    // Estado del dibujo en curso (modo 'draw')
    this.draftPoints = []; // Array de [nx, ny]
    this.draftTangents = []; // Array de [dx, dy] para manijas tangentes Bézier por punto
    this.draftCurves = {}; // Mapa de curvas Bézier para el trazado preliminar
    this.currentPointerPos = null; // [nx, ny] actual para el rubberband
    this.isDrawingDrag = false; // Indica si se está arrastrando para definir tangente Bézier
    this.drawingPointIndex = null; // Índice del punto actual bajo manipulación de tangente

    // Estado de interacción / arrastre
    this.dragging = null; // { type: 'vertex'|'vertex_group'|'body'|..., polyId: string, ... }
    this.hoverTarget = null; // { type: 'vertex'|'midpoint'|'curved_midpoint'|'body'|..., polyId, index }
    this.selectedVertexIndex = null; // Último vértice enfocado
    this.selectedVertexIndices = new Set(); // Conjunto de índices seleccionados para edición y arrastre en bloque
    // Callbacks
    this.onStateChange = null;
    this.onModeChange = null;

    this.initDOM();
    this.bindEvents();
    this.render();
  }

  isDrawMode() {
    return this.mode === 'draw' || this.mode === 'draw_straight' || this.mode === 'draw_curved';
  }

  initDOM() {
    this.container.innerHTML = `
      <div class="canvas-viewport" id="canvas-viewport">
        <!-- Capa de medios deformados acelerada por hardware -->
        <div id="warped-media-layer" class="warped-media-container"></div>
        <svg id="editor-svg" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid meet">
          <defs id="svg-defs">
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>
          <!-- Capa de fondo / cuadrícula -->
          <g id="grid-layer"></g>
          <!-- Capa de polígonos -->
          <g id="polygons-layer"></g>
          <!-- Capa de borrador / dibujo en progreso -->
          <g id="draft-layer"></g>
          <!-- Capa de manijas y gizmos interactivos -->
          <g id="gizmo-layer"></g>
          <!-- Capa de recuadro de selección múltiple (Marquee) -->
          <g id="marquee-layer"></g>
        </svg>
      </div>
    `;

    this.svg = this.container.querySelector('#editor-svg');
    this.viewport = this.container.querySelector('#canvas-viewport');
    this.mediaLayer = this.container.querySelector('#warped-media-layer');
    this.svgDefs = this.container.querySelector('#svg-defs');
    this.polygonsLayer = this.container.querySelector('#polygons-layer');
    this.draftLayer = this.container.querySelector('#draft-layer');
    this.gizmoLayer = this.container.querySelector('#gizmo-layer');
    this.marqueeLayer = this.container.querySelector('#marquee-layer');
    this.gridLayer = this.container.querySelector('#grid-layer');

    this.updateViewportScale();
    window.addEventListener('resize', () => this.updateViewportScale());

    this.renderGrid();
  }

  updateViewportScale() {
    if (!this.viewport || !this.mediaLayer) return;
    const rect = this.viewport.getBoundingClientRect();
    const scale = rect.width / 1920;
    this.mediaLayer.style.transform = `scale(${scale})`;
    this.mediaLayer.style.transformOrigin = '0 0';
  }

  renderGrid() {
    // Dibujar cruz central y bordes del proyector en 1920x1080
    this.gridLayer.innerHTML = `
      <rect x="0" y="0" width="1920" height="1080" fill="#0b0e14" stroke="#1f293d" stroke-width="2"/>
      <line x1="960" y1="0" x2="960" y2="1080" stroke="#151c28" stroke-width="1" stroke-dasharray="4 4"/>
      <line x1="0" y1="540" x2="1920" y2="540" stroke="#151c28" stroke-width="1" stroke-dasharray="4 4"/>
      <circle cx="960" cy="540" r="6" fill="#1f293d"/>
    `;
  }

  /**
   * Convierte coordenadas de evento de ratón a coordenadas normalizadas [0.0 - 1.0]
   */
  getNormalizedCoord(e) {
    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgP = pt.matrixTransform(this.svg.getScreenCTM().inverse());
    const nx = Math.max(0, Math.min(1, svgP.x / 1920));
    const ny = Math.max(0, Math.min(1, svgP.y / 1080));
    return [nx, ny];
  }

  setMode(newMode) {
    this.mode = newMode;
    this.selectedVertexIndices.clear();
    this.selectedVertexIndex = null;
    this.marquee = null;
    if (this.marqueeLayer) this.marqueeLayer.innerHTML = '';
    if (!this.isDrawMode()) {
      this.draftPoints = [];
      this.draftTangents = [];
      this.draftCurves = {};
      this.currentPointerPos = null;
      this.isDrawingDrag = false;
      this.drawingPointIndex = null;
      if (this.sync) this.sync.broadcastDraftClear();
    } else {
      if (this.sync) this.sync.broadcastDraftUpdate([], null, null, this.mode);
    }
    this.svg.style.cursor = this.isDrawMode() ? 'crosshair' : 'default';
    this.render();
    if (this.onModeChange) this.onModeChange(this.mode);
  }

  bindEvents() {
    this.svg.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.svg.addEventListener('pointerleave', () => {
      if (this.isDrawMode() && this.draftPoints.length === 0) {
        this.currentPointerPos = null;
        if (this.sync) this.sync.broadcastDraftUpdate([], null, null, this.mode);
      }
    });
    this.bindDragAndDrop();

    // Doble clic para cerrar polígono en modo dibujo
    this.svg.addEventListener('dblclick', (e) => {
      if (this.isDrawMode() && this.draftPoints.length >= 3) {
        this.finishDraftPolygon();
      }
    });

    // Atajos de teclado
    window.addEventListener('keydown', (e) => {
      // Evitar atajos si el foco está en un input de texto
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === 'Enter' && this.isDrawMode()) {
        if (this.draftPoints.length >= 3) {
          this.finishDraftPolygon();
        }
      } else if (e.key === 'Escape') {
        if (this.isDrawMode()) {
          this.draftPoints = [];
          this.draftTangents = [];
          this.draftCurves = {};
          this.currentPointerPos = null;
          this.isDrawingDrag = false;
          this.drawingPointIndex = null;
          if (this.sync) this.sync.broadcastDraftClear();
          this.setMode('select');
        }
      } else if (e.key.toLowerCase() === 'v' && !e.ctrlKey && !e.metaKey) {
        this.setMode('select');
      } else if (e.key.toLowerCase() === 'p' && !e.ctrlKey && !e.metaKey) {
        this.setMode('draw_straight');
      } else if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey) {
        this.setMode('draw_curved');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.mode === 'select' && this.selectedVertexIndices && this.selectedVertexIndices.size > 0) {
          e.preventDefault();
          this.deleteSelectedVertices();
          return;
        }
        if (this.scene.selectedId && this.mode === 'select') {
          const id = this.scene.selectedId;
          this.scene.removePolygon(id);
          this.sync.broadcastPolygonDelete(id);
          this.selectedVertexIndices.clear();
          this.selectedVertexIndex = null;
          this.render();
          if (this.onStateChange) this.onStateChange();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (this.scene.redo()) {
            this.sync.broadcastFullState(this.scene.toJSON());
            this.render();
            if (this.onStateChange) this.onStateChange();
          }
        } else {
          if (this.scene.undo()) {
            this.sync.broadcastFullState(this.scene.toJSON());
            this.render();
            if (this.onStateChange) this.onStateChange();
          }
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        if (this.scene.redo()) {
          this.sync.broadcastFullState(this.scene.toJSON());
          this.render();
          if (this.onStateChange) this.onStateChange();
        }
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        // Micro-ajuste óptico con flechas del teclado (1px normal, 10px con Shift)
        if (this.mode === 'select' && this.scene.selectedId) {
          const poly = this.scene.getSelectedPolygon();
          if (poly && !poly.locked && poly.visible) {
            e.preventDefault();
            const stepPx = e.shiftKey ? 10 : 1;
            let dx = 0;
            let dy = 0;
            if (e.key === 'ArrowLeft') dx = -stepPx / 1920;
            if (e.key === 'ArrowRight') dx = stepPx / 1920;
            if (e.key === 'ArrowUp') dy = -stepPx / 1080;
            if (e.key === 'ArrowDown') dy = stepPx / 1080;

            if (this.selectedVertexIndices && this.selectedVertexIndices.size > 0) {
              // Desplazar todos los vértices seleccionados en bloque
              this.selectedVertexIndices.forEach(idx => {
                if (idx < poly.points.length) {
                  const pt = poly.points[idx];
                  poly.points[idx] = [
                    Math.max(0, Math.min(1, pt[0] + dx)),
                    Math.max(0, Math.min(1, pt[1] + dy))
                  ];
                }
              });
              // Si hay curvas Bézier, desplazar manijas tangentes conectadas
              if (poly.edgeCurves) {
                const indicesSet = this.selectedVertexIndices;
                for (const key of Object.keys(poly.edgeCurves)) {
                  const c = poly.edgeCurves[key];
                  const parts = key.split('-');
                  const fromIdx = parseInt(parts[0]);
                  const toIdx = parseInt(parts[1]);
                  if (indicesSet.has(fromIdx)) {
                    c.c1 = [Math.max(0, Math.min(1, c.c1[0] + dx)), Math.max(0, Math.min(1, c.c1[1] + dy))];
                  }
                  if (indicesSet.has(toIdx)) {
                    c.c2 = [Math.max(0, Math.min(1, c.c2[0] + dx)), Math.max(0, Math.min(1, c.c2[1] + dy))];
                  }
                }
              }
            } else if (this.selectedVertexIndex !== null && this.selectedVertexIndex < poly.points.length) {
              // Desplazar únicamente el vértice enfocado
              const pt = poly.points[this.selectedVertexIndex];
              poly.points[this.selectedVertexIndex] = [
                Math.max(0, Math.min(1, pt[0] + dx)),
                Math.max(0, Math.min(1, pt[1] + dy))
              ];
            } else {
              // Desplazar el polígono completo
              poly.points = poly.points.map(([x, y]) => [
                Math.max(0, Math.min(1, x + dx)),
                Math.max(0, Math.min(1, y + dy))
              ]);
              if (poly.edgeCurves) {
                for (const key of Object.keys(poly.edgeCurves)) {
                  const c = poly.edgeCurves[key];
                  c.c1 = [Math.max(0, Math.min(1, c.c1[0] + dx)), Math.max(0, Math.min(1, c.c1[1] + dy))];
                  c.c2 = [Math.max(0, Math.min(1, c.c2[0] + dx)), Math.max(0, Math.min(1, c.c2[1] + dy))];
                }
              }
            }

            this.scene.saveStateToHistory();
            this.sync.broadcastPolygonUpdate(poly.toJSON());
            this.render();
            if (this.onStateChange) this.onStateChange();
          }
        }
      }
    });
  }

  bindDragAndDrop() {
    this.viewport.addEventListener('dragover', (e) => {
      e.preventDefault();
      const [nx, ny] = this.getNormalizedCoord(e);
      for (let i = this.scene.polygons.length - 1; i >= 0; i--) {
        const p = this.scene.polygons[i];
        if (p.visible && !p.locked && this.isPointInsidePolygon([nx, ny], p.points)) {
          if (this.scene.selectedId !== p.id) {
            this.scene.selectedId = p.id;
            this.sync.broadcastSelection(p.id);
            this.render();
          }
          break;
        }
      }
    });

    this.viewport.addEventListener('drop', async (e) => {
      e.preventDefault();
      const [nx, ny] = this.getNormalizedCoord(e);
      const files = e.dataTransfer.files;
      if (!files || files.length === 0) return;
      const file = files[0];

      const ext = '.' + file.name.split('.').pop().toLowerCase();
      const validImages = ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif'];
      const validVideos = ['.mp4', '.webm', '.mov'];

      const isImg = validImages.includes(ext);
      const isVid = validVideos.includes(ext);

      if (!isImg && !isVid) {
        alert(`Formato '${ext}' no permitido.\nPermitidos: PNG, JPG, WEBP, SVG, GIF (Imágenes) | MP4, WEBM, MOV (Videos).`);
        return;
      }

      const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
      if (file.size > MAX_FILE_SIZE) {
        const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
        alert(`Archivo demasiado pesado (${sizeMb} MB).\nEl límite máximo permitido para mapping en tiempo real es de 50 MB.\nSe recomienda comprimir el video a 1080p H.264 para garantizar fluidez sin colapsos.`);
        return;
      }

      let targetPoly = null;
      for (let i = this.scene.polygons.length - 1; i >= 0; i--) {
        const p = this.scene.polygons[i];
        if (p.visible && !p.locked && this.isPointInsidePolygon([nx, ny], p.points)) {
          targetPoly = p;
          break;
        }
      }
      if (!targetPoly) targetPoly = this.scene.getSelectedPolygon();
      if (!targetPoly) return;

      const mediaType = isVid ? 'video' : 'image';
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const res = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: file.name,
              data: event.target.result
            })
          });
          const data = await res.json();
          targetPoly.media = {
            type: mediaType,
            src: data.success ? data.url : event.target.result,
            opacity: 1.0,
            fit: 'stretch',
            loop: true,
            playing: true,
            playbackRate: 1.0,
            muted: true
          };
        } catch (err) {
          targetPoly.media = {
            type: mediaType,
            src: event.target.result,
            opacity: 1.0,
            fit: 'stretch',
            loop: true,
            playing: true,
            playbackRate: 1.0,
            muted: true
          };
        }
        this.scene.saveStateToHistory();
        this.sync.broadcastPolygonUpdate(targetPoly.toJSON());
        this.render();
        if (this.onStateChange) this.onStateChange();
      };
      reader.readAsDataURL(file);
    });
  }

  /**
   * Elimina los vértices seleccionados actualmente preservando un mínimo de 3 esquinas.
   */
  deleteSelectedVertices() {
    if (this.mode !== 'select' || !this.scene.selectedId) return;
    const poly = this.scene.getSelectedPolygon();
    if (!poly || poly.locked || !poly.visible || poly.isCircular()) return;
    if (!this.selectedVertexIndices || this.selectedVertexIndices.size === 0) return;

    const remainingCount = poly.points.length - this.selectedVertexIndices.size;
    if (remainingCount < 3) {
      alert('No es posible eliminar estos vértices.\nUn polígono debe conservar un mínimo de 3 vértices para formar una superficie válida.');
      return;
    }

    const sortedIndices = Array.from(this.selectedVertexIndices).sort((a, b) => b - a);
    for (const idx of sortedIndices) {
      poly.removeVertex(idx);
    }

    this.selectedVertexIndices.clear();
    this.selectedVertexIndex = null;
    this.scene.saveStateToHistory();
    this.sync.broadcastPolygonUpdate(poly.toJSON());
    this.render();
    if (this.onStateChange) this.onStateChange();
  }

  /**
   * Recalcula las curvas Bézier para el trazado en curso en modo dibujo según las manijas tangentes.
   * En modo 'draw_curved', genera automáticamente un spline suave y continuo C1 entre todos los puntos.
   */
  updateDraftCurves() {
    this.draftCurves = {};
    const n = this.draftPoints.length;
    if (n < 2) return;

    const isCurved = this.mode === 'draw_curved';

    // Calcular tangentes naturales para modo curvo si no hay manuales
    const autoTangents = [];
    if (isCurved) {
      for (let i = 0; i < n; i++) {
        const manualT = this.draftTangents[i];
        if (manualT && Math.hypot(manualT[0], manualT[1]) > 0.003) {
          autoTangents.push(manualT);
        } else {
          let tx = 0, ty = 0;
          if (n === 2) {
            const dx = this.draftPoints[1][0] - this.draftPoints[0][0];
            const dy = this.draftPoints[1][1] - this.draftPoints[0][1];
            if (i === 0) {
              tx = dx * 0.33 - dy * 0.22;
              ty = dy * 0.33 + dx * 0.22;
            } else {
              tx = dx * 0.33 + dy * 0.22;
              ty = dy * 0.33 - dx * 0.22;
            }
          } else if (i === 0) {
            const dx = this.draftPoints[1][0] - this.draftPoints[0][0];
            const dy = this.draftPoints[1][1] - this.draftPoints[0][1];
            tx = dx * 0.33;
            ty = dy * 0.33;
          } else if (i === n - 1) {
            const dx = this.draftPoints[n - 1][0] - this.draftPoints[n - 2][0];
            const dy = this.draftPoints[n - 1][1] - this.draftPoints[n - 2][1];
            tx = dx * 0.33;
            ty = dy * 0.33;
          } else {
            // Tangente centrada entre vecino anterior y posterior
            const dx = this.draftPoints[i + 1][0] - this.draftPoints[i - 1][0];
            const dy = this.draftPoints[i + 1][1] - this.draftPoints[i - 1][1];
            tx = dx * 0.25;
            ty = dy * 0.25;
          }
          autoTangents.push([tx, ty]);
        }
      }
    }

    for (let i = 0; i < n - 1; i++) {
      const pA = this.draftPoints[i];
      const pB = this.draftPoints[i + 1];
      const tA = this.draftTangents[i];
      const tB = this.draftTangents[i + 1];
      const hasTA = tA && Math.hypot(tA[0], tA[1]) > 0.003;
      const hasTB = tB && Math.hypot(tB[0], tB[1]) > 0.003;

      if (isCurved) {
        const tanA = autoTangents[i];
        const tanB = autoTangents[i + 1];
        const c1 = [pA[0] + tanA[0], pA[1] + tanA[1]];
        const c2 = [pB[0] - tanB[0], pB[1] - tanB[1]];
        this.draftCurves[`${i}-${i + 1}`] = { c1, c2 };
      } else if (hasTA || hasTB) {
        const dx = pB[0] - pA[0];
        const dy = pB[1] - pA[1];
        const c1 = hasTA ? [pA[0] + tA[0], pA[1] + tA[1]] : [pA[0] + dx * 0.33, pA[1] + dy * 0.33];
        const c2 = hasTB ? [pB[0] - tB[0], pB[1] - tB[1]] : [pA[0] + dx * 0.67, pA[1] + dy * 0.67];
        this.draftCurves[`${i}-${i + 1}`] = { c1, c2 };
      }
    }
  }

  renderMarquee() {
    if (!this.marquee || !this.marqueeLayer) {
      if (this.marqueeLayer) this.marqueeLayer.innerHTML = '';
      return;
    }
    const x1 = Math.min(this.marquee.start[0], this.marquee.current[0]) * 1920;
    const y1 = Math.min(this.marquee.start[1], this.marquee.current[1]) * 1080;
    const x2 = Math.max(this.marquee.start[0], this.marquee.current[0]) * 1920;
    const y2 = Math.max(this.marquee.start[1], this.marquee.current[1]) * 1080;
    const w = Math.max(1, x2 - x1);
    const h = Math.max(1, y2 - y1);
    this.marqueeLayer.innerHTML = `
      <rect class="selection-marquee" x="${x1}" y="${y1}" width="${w}" height="${h}" />
    `;
  }

  updateMarqueeSelection(e) {
    if (!this.marquee) return;
    const minX = Math.min(this.marquee.start[0], this.marquee.current[0]);
    const maxX = Math.max(this.marquee.start[0], this.marquee.current[0]);
    const minY = Math.min(this.marquee.start[1], this.marquee.current[1]);
    const maxY = Math.max(this.marquee.start[1], this.marquee.current[1]);

    let targetPoly = this.scene.getSelectedPolygon();
    if (!targetPoly || targetPoly.locked || !targetPoly.visible || targetPoly.isCircular()) {
      for (let i = this.scene.polygons.length - 1; i >= 0; i--) {
        const p = this.scene.polygons[i];
        if (p.visible && !p.locked && !p.isCircular()) {
          const anyInside = p.points.some(([x, y]) => x >= minX && x <= maxX && y >= minY && y <= maxY);
          if (anyInside) {
            targetPoly = p;
            this.scene.selectedId = p.id;
            this.sync.broadcastSelection(p.id);
            break;
          }
        }
      }
    }

    if (!targetPoly || targetPoly.locked || !targetPoly.visible || targetPoly.isCircular()) return;

    if (!e.shiftKey && !e.ctrlKey) {
      this.selectedVertexIndices.clear();
    }

    targetPoly.points.forEach(([x, y], idx) => {
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
        this.selectedVertexIndices.add(idx);
        this.selectedVertexIndex = idx;
      }
    });

    this.renderGizmos();
  }

  onPointerDown(e) {
    if (e.button !== 0) return; // Solo clic izquierdo
    const [nx, ny] = this.getNormalizedCoord(e);

    if (this.isDrawMode()) {
      // Verificar si hizo clic cerca del primer punto para cerrar el polígono
      if (this.draftPoints.length >= 3) {
        const [firstNx, firstNy] = this.draftPoints[0];
        const distPx = Math.hypot((firstNx - nx) * 1920, (firstNy - ny) * 1080);
        if (distPx < 28) {
          this.finishDraftPolygon();
          return;
        }
      }
      // Añadir punto
      this.draftPoints.push([nx, ny]);
      const newIdx = this.draftPoints.length - 1;

      if (this.mode === 'draw_curved') {
        this.draftTangents[newIdx] = [0, 0];
        this.drawingPointIndex = newIdx;
        this.isDrawingDrag = true;
      } else {
        // En draw_straight: sin manijas tangentes ni arrastre accidental
        this.draftTangents[newIdx] = null;
        this.drawingPointIndex = null;
        this.isDrawingDrag = false;
      }

      this.updateDraftCurves();
      if (this.sync) this.sync.broadcastDraftUpdate(this.draftPoints, this.currentPointerPos, this.draftCurves, this.mode);
      this.render();
      return;
    }

    // Modo 'select'
    if (this.hoverTarget) {
      const { type, polyId, index } = this.hoverTarget;
      const poly = this.scene.getPolygon(polyId);
      if (!poly || poly.locked) return;

      if (this.scene.selectedId !== polyId) {
        this.scene.selectedId = polyId;
        this.sync.broadcastSelection(polyId);
        this.selectedVertexIndices.clear();
        this.selectedVertexIndex = null;
      }

      if (type === 'circle_center') {
        this.selectedVertexIndex = null;
        this.selectedVertexIndices.clear();
        this.dragging = {
          type: 'circle_center',
          polyId,
          startPos: [nx, ny],
          initialCenter: [...poly.center]
        };
      } else if (type === 'circle_radius') {
        this.selectedVertexIndex = null;
        this.selectedVertexIndices.clear();
        this.dragging = {
          type: 'circle_radius',
          polyId,
          handle: this.hoverTarget.handle,
          startPos: [nx, ny],
          initialRx: poly.radiusX,
          initialRy: poly.radiusY
        };
      } else if (type === 'circle_rotation') {
        this.selectedVertexIndex = null;
        this.selectedVertexIndices.clear();
        this.dragging = {
          type: 'circle_rotation',
          polyId,
          startPos: [nx, ny]
        };
      } else if (type === 'curve_control') {
        this.selectedVertexIndex = null;
        this.selectedVertexIndices.clear();
        this.dragging = {
          type: 'curve_control',
          polyId,
          edgeKey: this.hoverTarget.edgeKey,
          handle: this.hoverTarget.handle
        };
      } else if (type === 'curved_midpoint') {
        // Shift+Click o Alt+Click en curved_midpoint convierte la arista de curva a recta
        if (e.altKey || e.shiftKey) {
          poly.toggleEdgeCurved(index);
          this.scene.saveStateToHistory();
          this.sync.broadcastPolygonUpdate(poly.toJSON());
          this.render();
          if (this.onStateChange) this.onStateChange();
          return;
        }

        // Subdividir curva Bézier usando De Casteljau exacto a t=0.5
        const newIdx = poly.subdivideEdge(index, this.hoverTarget.splitResult);
        this.selectedVertexIndex = newIdx;
        this.selectedVertexIndices = new Set([newIdx]);
        this.dragging = {
          type: 'vertex',
          polyId,
          vertexIndex: newIdx,
          initialPoints: JSON.parse(JSON.stringify(poly.points))
        };
        this.scene.saveStateToHistory();
        this.sync.broadcastPolygonUpdate(poly.toJSON());
      } else if (type === 'midpoint') {
        // Shift+Click o Alt+Click en midpoint convierte arista a curva Bézier suave
        if (e.altKey || e.shiftKey) {
          poly.toggleEdgeCurved(index);
          this.scene.saveStateToHistory();
          this.sync.broadcastPolygonUpdate(poly.toJSON());
          this.render();
          if (this.onStateChange) this.onStateChange();
          return;
        }

        // Clic normal: insertar nuevo vértice en arista recta
        const newIdx = poly.subdivideEdge(index);
        this.selectedVertexIndex = newIdx;
        this.selectedVertexIndices = new Set([newIdx]);
        this.dragging = {
          type: 'vertex',
          polyId,
          vertexIndex: newIdx,
          initialPoints: JSON.parse(JSON.stringify(poly.points))
        };
        this.scene.saveStateToHistory();
        this.sync.broadcastPolygonUpdate(poly.toJSON());
      } else if (type === 'vertex') {
        const isMulti = e.shiftKey || e.ctrlKey;
        if (isMulti) {
          if (this.selectedVertexIndices.has(index)) {
            this.selectedVertexIndices.delete(index);
            this.selectedVertexIndex = this.selectedVertexIndices.size > 0 
              ? Array.from(this.selectedVertexIndices)[this.selectedVertexIndices.size - 1] 
              : null;
          } else {
            this.selectedVertexIndices.add(index);
            this.selectedVertexIndex = index;
          }
        } else {
          if (!this.selectedVertexIndices.has(index)) {
            this.selectedVertexIndices.clear();
            this.selectedVertexIndices.add(index);
            this.selectedVertexIndex = index;
          } else {
            this.selectedVertexIndex = index;
          }
        }

        if (this.selectedVertexIndices.size > 1 && this.selectedVertexIndices.has(index)) {
          this.dragging = {
            type: 'vertex_group',
            polyId,
            startPos: [nx, ny],
            initialPoints: JSON.parse(JSON.stringify(poly.points)),
            initialEdgeCurves: poly.edgeCurves ? JSON.parse(JSON.stringify(poly.edgeCurves)) : {},
            indices: Array.from(this.selectedVertexIndices)
          };
        } else {
          this.dragging = {
            type: 'vertex',
            polyId,
            vertexIndex: index,
            initialPoints: JSON.parse(JSON.stringify(poly.points))
          };
        }
      } else if (type === 'body') {
        this.selectedVertexIndex = null;
        this.selectedVertexIndices.clear();
        this.dragging = {
          type: 'body',
          polyId,
          startPos: [nx, ny],
          initialCenter: poly.center ? [...poly.center] : [0.5, 0.5],
          initialPoints: JSON.parse(JSON.stringify(poly.points)),
          initialEdgeCurves: poly.edgeCurves ? JSON.parse(JSON.stringify(poly.edgeCurves)) : {}
        };
      }

      this.render();
      if (this.onStateChange) this.onStateChange();
      return;
    }

    // Clic en espacio vacío: iniciar recuadro de selección múltiple (Marquee)
    if (!e.shiftKey && !e.ctrlKey) {
      this.selectedVertexIndices.clear();
      this.selectedVertexIndex = null;
    }
    this.marquee = { start: [nx, ny], current: [nx, ny] };
    this.renderMarquee();
    this.render();
    if (this.onStateChange) this.onStateChange();
  }

  onPointerMove(e) {
    const [nx, ny] = this.getNormalizedCoord(e);

    if (this.isDrawMode()) {
      // Verificar proximidad al primer vértice para retroalimentación visual de cierre
      let isNearFirst = false;
      if (this.draftPoints.length >= 3) {
        const [firstNx, firstNy] = this.draftPoints[0];
        const distPx = Math.hypot((firstNx - nx) * 1920, (firstNy - ny) * 1080);
        if (distPx < 28) {
          isNearFirst = true;
        }
      }
      this.isNearFirstPoint = isNearFirst;
      this.svg.style.cursor = isNearFirst ? 'pointer' : 'crosshair';

      if (this.mode === 'draw_curved' && this.isDrawingDrag && this.drawingPointIndex !== null) {
        const originPt = this.draftPoints[this.drawingPointIndex];
        const dx = nx - originPt[0];
        const dy = ny - originPt[1];
        this.draftTangents[this.drawingPointIndex] = [dx, dy];
        this.updateDraftCurves();
        if (this.sync) this.sync.broadcastDraftUpdate(this.draftPoints, this.currentPointerPos, this.draftCurves, this.mode);
        this.renderDraft();
        return;
      }

      this.currentPointerPos = isNearFirst ? [...this.draftPoints[0]] : [nx, ny];
      if (this.sync) this.sync.broadcastDraftUpdate(this.draftPoints, this.currentPointerPos, this.draftCurves, this.mode);
      this.renderDraft();
      return;
    }

    // Modo selección: recuadro de arrastre (Marquee)
    if (this.marquee) {
      this.marquee.current = [nx, ny];
      this.updateMarqueeSelection(e);
      this.renderMarquee();
      return;
    }

    if (this.dragging) {
      const poly = this.scene.getPolygon(this.dragging.polyId);
      if (!poly) return;

      if (this.dragging.type === 'circle_center') {
        const dx = nx - this.dragging.startPos[0];
        const dy = ny - this.dragging.startPos[1];
        poly.center = [
          Math.max(0, Math.min(1, this.dragging.initialCenter[0] + dx)),
          Math.max(0, Math.min(1, this.dragging.initialCenter[1] + dy))
        ];
        poly.points = poly.getBoundaryPoints(64);
      } else if (this.dragging.type === 'circle_radius') {
        const { handle } = this.dragging;
        const cx = poly.center[0] * 1920;
        const cy = poly.center[1] * 1080;
        const px = nx * 1920;
        const py = ny * 1080;
        const rot = (poly.rotation || 0);
        const rad = (rot * Math.PI) / 180;
        const cosR = Math.cos(rad);
        const sinR = Math.sin(rad);

        if (handle === 'e' || handle === 'w') {
          const deltaX = (px - cx) * cosR + (py - cy) * sinR;
          const newRxPx = Math.max(20, handle === 'e' ? deltaX : -deltaX);
          poly.radiusX = Math.min(0.5, newRxPx / 1920);
        } else if (handle === 'n' || handle === 's') {
          const deltaY = (px - cx) * sinR - (py - cy) * cosR;
          const newRyPx = Math.max(20, handle === 'n' ? deltaY : -deltaY);
          poly.radiusY = Math.min(0.5, newRyPx / 1080);
        }
        poly.points = poly.getBoundaryPoints(64);
      } else if (this.dragging.type === 'circle_rotation') {
        const cx = poly.center[0] * 1920;
        const cy = poly.center[1] * 1080;
        const px = nx * 1920;
        const py = ny * 1080;
        const angleDeg = Math.atan2(py - cy, px - cx) * 180 / Math.PI;
        poly.rotation = (Math.round(angleDeg + 90) % 360 + 360) % 360;
        poly.points = poly.getBoundaryPoints(64);
      } else if (this.dragging.type === 'curve_control') {
        const { edgeKey, handle } = this.dragging;
        if (!poly.edgeCurves) poly.edgeCurves = {};
        if (!poly.edgeCurves[edgeKey]) poly.edgeCurves[edgeKey] = {};
        poly.edgeCurves[edgeKey][handle] = [
          Math.max(0, Math.min(1, nx)),
          Math.max(0, Math.min(1, ny))
        ];
      } else if (this.dragging.type === 'vertex') {
        poly.points[this.dragging.vertexIndex] = [nx, ny];
      } else if (this.dragging.type === 'vertex_group') {
        const dx = nx - this.dragging.startPos[0];
        const dy = ny - this.dragging.startPos[1];
        const indicesSet = new Set(this.dragging.indices);

        for (const idx of this.dragging.indices) {
          const initPt = this.dragging.initialPoints[idx];
          poly.points[idx] = [
            Math.max(0, Math.min(1, initPt[0] + dx)),
            Math.max(0, Math.min(1, initPt[1] + dy))
          ];
        }

        if (poly.edgeCurves && this.dragging.initialEdgeCurves) {
          poly.edgeCurves = {};
          for (const key of Object.keys(this.dragging.initialEdgeCurves)) {
            const c = this.dragging.initialEdgeCurves[key];
            const parts = key.split('-');
            const fromIdx = parseInt(parts[0]);
            const toIdx = parseInt(parts[1]);
            const c1dx = indicesSet.has(fromIdx) ? dx : 0;
            const c1dy = indicesSet.has(fromIdx) ? dy : 0;
            const c2dx = indicesSet.has(toIdx) ? dx : 0;
            const c2dy = indicesSet.has(toIdx) ? dy : 0;
            poly.edgeCurves[key] = {
              c1: [Math.max(0, Math.min(1, c.c1[0] + c1dx)), Math.max(0, Math.min(1, c.c1[1] + c1dy))],
              c2: [Math.max(0, Math.min(1, c.c2[0] + c2dx)), Math.max(0, Math.min(1, c.c2[1] + c2dy))]
            };
          }
        }
      } else if (this.dragging.type === 'body') {
        const dx = nx - this.dragging.startPos[0];
        const dy = ny - this.dragging.startPos[1];
        if (poly.isCircular()) {
          poly.center = [
            Math.max(0, Math.min(1, this.dragging.initialCenter[0] + dx)),
            Math.max(0, Math.min(1, this.dragging.initialCenter[1] + dy))
          ];
          poly.points = poly.getBoundaryPoints(64);
        } else {
          poly.points = this.dragging.initialPoints.map(([px, py]) => [
            Math.max(0, Math.min(1, px + dx)),
            Math.max(0, Math.min(1, py + dy))
          ]);
          if (this.dragging.initialEdgeCurves) {
            poly.edgeCurves = {};
            for (const key of Object.keys(this.dragging.initialEdgeCurves)) {
              const c = this.dragging.initialEdgeCurves[key];
              poly.edgeCurves[key] = {
                c1: [Math.max(0, Math.min(1, c.c1[0] + dx)), Math.max(0, Math.min(1, c.c1[1] + dy))],
                c2: [Math.max(0, Math.min(1, c.c2[0] + dx)), Math.max(0, Math.min(1, c.c2[1] + dy))]
              };
            }
          }
        }
      }

      // Sincronizar en tiempo real al proyector con cero retardo
      this.sync.broadcastPolygonUpdate(poly.toJSON());
      this.render();
      return;
    }

    // Detectar hover cuando no se está arrastrando
    this.updateHoverTarget(nx, ny);
  }

  onPointerUp(e) {
    if (this.isDrawMode()) {
      if (this.isDrawingDrag) {
        this.isDrawingDrag = false;
        this.drawingPointIndex = null;
      }
      return;
    }

    if (this.marquee) {
      this.marquee = null;
      if (this.marqueeLayer) this.marqueeLayer.innerHTML = '';
      this.render();
      if (this.onStateChange) this.onStateChange();
      return;
    }

    if (this.dragging) {
      this.scene.saveStateToHistory();
      const poly = this.scene.getPolygon(this.dragging.polyId);
      if (poly) {
        this.sync.broadcastPolygonUpdate(poly.toJSON());
      }
      this.dragging = null;
      this.render();
      if (this.onStateChange) this.onStateChange();
    }
  }

  finishDraftPolygon() {
    if (this.draftPoints.length < 3) return;
    const isCurved = this.mode === 'draw_curved';
    const isQuad = this.draftPoints.length === 4 && !isCurved;
    const count = this.scene.polygons.length + 1;
    const name = isCurved ? (`Superficie Curva ${count}`) : (isQuad ? (`Quad ${count}`) : (`Polígono ${count}`));

    const newPoly = new PolygonObject({
      name,
      type: isQuad ? 'quad' : 'polygon',
      points: [...this.draftPoints]
    });

    // Conectar la arista final de retorno hacia el vértice 0 si es modo curvo o hay tangentes
    const n = this.draftPoints.length;
    const lastIdx = n - 1;
    const tLast = this.draftTangents[lastIdx];
    const tFirst = this.draftTangents[0];
    const hasTLast = tLast && (Math.hypot(tLast[0], tLast[1]) > 0.003);
    const hasTFirst = tFirst && (Math.hypot(tFirst[0], tFirst[1]) > 0.003);

    if (hasTLast || hasTFirst || isCurved) {
      const pA = this.draftPoints[lastIdx];
      const pB = this.draftPoints[0];
      const dx = pB[0] - pA[0];
      const dy = pB[1] - pA[1];
      const c1 = hasTLast ? [pA[0] + tLast[0], pA[1] + tLast[1]] : [pA[0] + dx * 0.33, pA[1] + dy * 0.33];
      const c2 = hasTFirst ? [pB[0] - tFirst[0], pB[1] - tFirst[1]] : [pA[0] + dx * 0.67, pA[1] + dy * 0.67];
      this.draftCurves[`${lastIdx}-0`] = { c1, c2 };
    }

    if (this.draftCurves && Object.keys(this.draftCurves).length > 0) {
      newPoly.edgeCurves = { ...this.draftCurves };
    }

    this.scene.addPolygon(newPoly);
    if (this.sync) {
      this.sync.broadcastDraftClear();
      this.sync.broadcastPolygonUpdate(newPoly.toJSON());
      this.sync.broadcastSelection(newPoly.id);
    }

    this.draftPoints = [];
    this.draftTangents = [];
    this.draftCurves = {};
    this.isDrawingDrag = false;
    this.drawingPointIndex = null;
    this.currentPointerPos = null;
    this.isNearFirstPoint = false;
    this.setMode('select');
    if (this.onStateChange) this.onStateChange();
  }

  updateHoverTarget(nx, ny) {
    const px = nx * 1920;
    const py = ny * 1080;
    const activePoly = this.scene.getSelectedPolygon();

    // 1. Revisar manipuladores de la superficie activa seleccionada
    if (activePoly && !activePoly.locked && activePoly.visible) {
      if (activePoly.isCircular()) {
        const cx = activePoly.center[0] * 1920;
        const cy = activePoly.center[1] * 1080;
        const rx = activePoly.radiusX * 1920;
        const ry = activePoly.radiusY * 1080;
        const rot = activePoly.rotation || 0;
        const rad = (rot * Math.PI) / 180;
        const cosR = Math.cos(rad);
        const sinR = Math.sin(rad);

        // Cardinales (Este, Oeste, Norte, Sur)
        const ex = cx + rx * cosR;
        const ey = cy + rx * sinR;
        const wx = cx - rx * cosR;
        const wy = cy - rx * sinR;
        const nPx = cx + ry * sinR;
        const nPy = cy - ry * cosR;
        const sx = cx - ry * sinR;
        const sy = cy + ry * cosR;

        // Manija de rotación (arriba del polo norte)
        const rotDist = ry + 35;
        const rotX = cx + rotDist * sinR;
        const rotY = cy - rotDist * cosR;

        if (Math.hypot(rotX - px, rotY - py) < 18) {
          this.hoverTarget = { type: 'circle_rotation', polyId: activePoly.id };
          this.svg.style.cursor = 'grab';
          return;
        }
        if (Math.hypot(ex - px, ey - py) < 16) {
          this.hoverTarget = { type: 'circle_radius', polyId: activePoly.id, handle: 'e' };
          this.svg.style.cursor = 'ew-resize';
          return;
        }
        if (Math.hypot(wx - px, wy - py) < 16) {
          this.hoverTarget = { type: 'circle_radius', polyId: activePoly.id, handle: 'w' };
          this.svg.style.cursor = 'ew-resize';
          return;
        }
        if (Math.hypot(nPx - px, nPy - py) < 16) {
          this.hoverTarget = { type: 'circle_radius', polyId: activePoly.id, handle: 'n' };
          this.svg.style.cursor = 'ns-resize';
          return;
        }
        if (Math.hypot(sx - px, sy - py) < 16) {
          this.hoverTarget = { type: 'circle_radius', polyId: activePoly.id, handle: 's' };
          this.svg.style.cursor = 'ns-resize';
          return;
        }
        if (Math.hypot(cx - px, cy - py) < 20) {
          this.hoverTarget = { type: 'circle_center', polyId: activePoly.id };
          this.svg.style.cursor = 'move';
          return;
        }
      } else {
        // Polígono con o sin curvas Bézier
        // A. Puntos de control tangente Bézier (C1 y C2)
        if (activePoly.edgeCurves) {
          for (const key of Object.keys(activePoly.edgeCurves)) {
            const curve = activePoly.edgeCurves[key];
            if (curve && curve.c1 && curve.c2) {
              const c1x = curve.c1[0] * 1920;
              const c1y = curve.c1[1] * 1080;
              const c2x = curve.c2[0] * 1920;
              const c2y = curve.c2[1] * 1080;
              if (Math.hypot(c1x - px, c1y - py) < 16) {
                this.hoverTarget = { type: 'curve_control', polyId: activePoly.id, edgeKey: key, handle: 'c1' };
                this.svg.style.cursor = 'grab';
                return;
              }
              if (Math.hypot(c2x - px, c2y - py) < 16) {
                this.hoverTarget = { type: 'curve_control', polyId: activePoly.id, edgeKey: key, handle: 'c2' };
                this.svg.style.cursor = 'grab';
                return;
              }
            }
          }
        }

        // B. Vértices principales
        const pixelPts = activePoly.getPixelPoints(1920, 1080);
        for (let i = 0; i < pixelPts.length; i++) {
          const [vx, vy] = pixelPts[i];
          if (Math.hypot(vx - px, vy - py) < 18) {
            this.hoverTarget = { type: 'vertex', polyId: activePoly.id, index: i };
            this.svg.style.cursor = 'grab';
            return;
          }
        }

        // C. Puntos intermedios (midpoints) para insertar vértices en aristas rectas o curvas
        for (let i = 0; i < pixelPts.length; i++) {
          const nextIdx = (i + 1) % pixelPts.length;
          const curveKey = `${i}-${nextIdx}`;
          const curve = activePoly.edgeCurves ? (activePoly.edgeCurves[curveKey] || activePoly.edgeCurves[`${i}`]) : null;

          if (curve && curve.c1 && curve.c2) {
            // Detectar punto medio exacto sobre la curva Bézier a t=0.5
            const split = MathWarp.splitCubicBezier(activePoly.points[i], curve.c1, curve.c2, activePoly.points[nextIdx], 0.5);
            const mx = split.pMid[0] * 1920;
            const my = split.pMid[1] * 1080;
            if (Math.hypot(mx - px, my - py) < 16) {
              this.hoverTarget = { type: 'curved_midpoint', polyId: activePoly.id, index: i, splitResult: split };
              this.svg.style.cursor = 'copy';
              return;
            }
          } else {
            const [x1, y1] = pixelPts[i];
            const [x2, y2] = pixelPts[nextIdx];
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;
            if (Math.hypot(mx - px, my - py) < 14) {
              this.hoverTarget = { type: 'midpoint', polyId: activePoly.id, index: i };
              this.svg.style.cursor = 'copy';
              return;
            }
          }
        }
      }
    }

    // 2. Revisar cuerpos de polígonos / círculos (para selección o traslación)
    for (let i = this.scene.polygons.length - 1; i >= 0; i--) {
      const p = this.scene.polygons[i];
      if (!p.visible) continue;
      if (this.isPointInsidePolygon([nx, ny], p.points, p)) {
        this.hoverTarget = { type: 'body', polyId: p.id };
        this.svg.style.cursor = p.locked ? 'not-allowed' : 'move';
        return;
      }
    }

    this.hoverTarget = null;
    this.svg.style.cursor = 'default';
  }

  isPointInsidePolygon(point, vs, poly = null) {
    if (poly && poly.isCircular && poly.isCircular()) {
      const cx = poly.center[0];
      const cy = poly.center[1];
      const rx = poly.radiusX;
      const ry = poly.radiusY;
      const rotRad = (-(poly.rotation || 0) * Math.PI) / 180;
      const dx = point[0] - cx;
      const dy = point[1] - cy;
      const lx = dx * Math.cos(rotRad) - dy * Math.sin(rotRad);
      const ly = dx * Math.sin(rotRad) + dy * Math.cos(rotRad);
      return (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) <= 1.0;
    }
    // Algoritmo Ray-Casting
    const x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      const xi = vs[i][0], yi = vs[i][1];
      const xj = vs[j][0], yj = vs[j][1];
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  render() {
    this.updateViewportScale();
    this.renderMedia();
    this.renderPolygons();
    this.renderDraft();
    this.renderGizmos();
  }

  renderMedia() {
    if (!this.mediaLayer) return;

    const currentIds = new Set();

    this.scene.polygons.forEach((poly, index) => {
      if (!poly.visible) return;
      currentIds.add(poly.id);

      const isOccluder = poly.isOccluder ? poly.isOccluder() : (poly.type === 'occluder' || poly.type === 'circle_occluder');
      const isCircular = poly.isCircular ? poly.isCircular() : (poly.type === 'circle' || poly.type === 'circle_occluder');
      const hasEdgeCurves = !isCircular && poly.edgeCurves && Object.keys(poly.edgeCurves).length > 0;
      const isImage = poly.media && poly.media.type === 'image' && poly.media.src;
      const isVideo = poly.media && poly.media.type === 'video' && poly.media.src;
      const opacity = poly.media?.opacity !== undefined ? poly.media.opacity : 1.0;
      const pixelPts = poly.getPixelPoints(1920, 1080);

      let el = this.mediaLayer.querySelector(`[data-poly-id="${poly.id}"]`);

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
          this.mediaLayer.appendChild(el);
        }
        el.style.zIndex = (index + 1).toString();
        const clipPts = isCircular 
          ? poly.getBoundaryPoints(64) 
          : (hasEdgeCurves ? MathWarp.getSampledCurvedPolygon(poly.points, poly.edgeCurves, 24) : poly.points);
        el.style.clipPath = MathWarp.getClipPathPolygon(clipPts, 1920, 1080);
        this.mediaLayer.appendChild(el);
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
            this.mediaLayer.appendChild(el);
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
          this.mediaLayer.appendChild(el);
        } else if (pixelPts.length >= 3) {
          // Superficie Circular, Elíptica, Polígono Curvo Bézier o Polígono Libre
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
            el.style.overflow = 'hidden';
            el.style.pointerEvents = 'none';
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
            this.mediaLayer.appendChild(el);
          } else {
            const mediaElem = el.querySelector(mediaTag);
            if (mediaElem && mediaElem.getAttribute('src') !== poly.media.src) {
              mediaElem.src = poly.media.src;
              if (isVideo) mediaElem.play().catch(() => {});
            }
          }

          const clipPts = isCircular 
            ? poly.getBoundaryPoints(64) 
            : (hasEdgeCurves ? MathWarp.getSampledCurvedPolygon(poly.points, poly.edgeCurves, 24) : poly.points);

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
          this.mediaLayer.appendChild(el);
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
      }
    });

    const allDom = this.mediaLayer.querySelectorAll('[data-poly-id]');
    allDom.forEach(node => {
      if (!currentIds.has(node.dataset.polyId)) {
        node.remove();
      }
    });
  }

  renderPolygons() {
    let html = '';
    this.scene.polygons.forEach(poly => {
      if (!poly.visible) return;
      const isSelected = poly.id === this.scene.selectedId;
      const isOccluder = poly.isOccluder ? poly.isOccluder() : (poly.type === 'occluder' || poly.type === 'circle_occluder');
      const isCircular = poly.isCircular ? poly.isCircular() : (poly.type === 'circle' || poly.type === 'circle_occluder');
      const hasEdgeCurves = !isCircular && poly.edgeCurves && Object.keys(poly.edgeCurves).length > 0;
      const hasMedia = poly.media && (poly.media.type === 'image' || poly.media.type === 'video') && poly.media.src;

      let fill = isOccluder ? '#000000' : poly.color;
      let fillOpacity = isOccluder ? 0.95 : (hasMedia ? (isSelected ? 0.08 : 0.0) : (isSelected ? 0.35 : 0.15));
      let stroke = isOccluder ? '#ffffff' : poly.color;
      let strokeWidth = isSelected ? 3 : 1.5;
      let strokeDash = isOccluder ? '6 4' : 'none';

      let labelX = 960;
      let labelY = 540;

      if (isCircular) {
        const cx = poly.center[0] * 1920;
        const cy = poly.center[1] * 1080;
        const rx = poly.radiusX * 1920;
        const ry = poly.radiusY * 1080;
        const rot = poly.rotation || 0;
        labelX = cx;
        labelY = cy;

        html += `
          <ellipse 
            class="poly-shape ${isSelected ? 'selected' : ''} ${isOccluder ? 'occluder' : ''}" 
            cx="${cx}" 
            cy="${cy}" 
            rx="${rx}" 
            ry="${ry}" 
            transform="rotate(${rot} ${cx} ${cy})"
            fill="${fill}" 
            fill-opacity="${fillOpacity}" 
            stroke="${stroke}" 
            stroke-width="${strokeWidth}" 
            stroke-dasharray="${strokeDash}"
            data-id="${poly.id}"
          />
        `;
      } else if (hasEdgeCurves) {
        const pathD = MathWarp.getCurvedSvgPath(poly.points, poly.edgeCurves, 1920, 1080);
        const center = poly.points.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
        labelX = (center[0] / poly.points.length) * 1920;
        labelY = (center[1] / poly.points.length) * 1080;

        html += `
          <path 
            class="poly-shape ${isSelected ? 'selected' : ''} ${isOccluder ? 'occluder' : ''}" 
            d="${pathD}" 
            fill="${fill}" 
            fill-opacity="${fillOpacity}" 
            stroke="${stroke}" 
            stroke-width="${strokeWidth}" 
            stroke-dasharray="${strokeDash}"
            data-id="${poly.id}"
          />
        `;
      } else {
        const pts = poly.getPixelPoints(1920, 1080).map(p => p.join(',')).join(' ');
        if (poly.points.length > 0) {
          const center = poly.points.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
          labelX = (center[0] / poly.points.length) * 1920;
          labelY = (center[1] / poly.points.length) * 1080;
        }

        html += `
          <polygon 
            class="poly-shape ${isSelected ? 'selected' : ''} ${isOccluder ? 'occluder' : ''}" 
            points="${pts}" 
            fill="${fill}" 
            fill-opacity="${fillOpacity}" 
            stroke="${stroke}" 
            stroke-width="${strokeWidth}" 
            stroke-dasharray="${strokeDash}"
            data-id="${poly.id}"
          />
        `;
      }

      // Etiqueta del nombre de la superficie
      html += `
        <text x="${labelX}" y="${labelY}" fill="#ffffff" font-size="14" font-weight="600" text-anchor="middle" dominant-baseline="middle" pointer-events="none" opacity="${isSelected ? 1.0 : 0.6}" filter="url(#glow)">
          ${poly.name} ${isOccluder ? '(MÁSCARA)' : ''}
        </text>
      `;
    });
    this.polygonsLayer.innerHTML = html;
  }

  renderDraft() {
    if (!this.isDrawMode() || this.draftPoints.length === 0) {
      this.draftLayer.innerHTML = '';
      return;
    }

    const isCurved = this.mode === 'draw_curved';
    const pixelPts = this.draftPoints.map(([nx, ny]) => [nx * 1920, ny * 1080]);
    let html = '';

    // Previsualización de silueta de cierre si el cursor está cerca del vértice inicial
    if (this.isNearFirstPoint && pixelPts.length >= 3) {
      const closeCurves = { ...this.draftCurves };
      if (isCurved) {
        const lastIdx = pixelPts.length - 1;
        const pA = this.draftPoints[lastIdx];
        const pB = this.draftPoints[0];
        const dx = pB[0] - pA[0];
        const dy = pB[1] - pA[1];
        closeCurves[`${lastIdx}-0`] = {
          c1: [pA[0] + dx * 0.33, pA[1] + dy * 0.33],
          c2: [pA[0] + dx * 0.67, pA[1] + dy * 0.67]
        };
      }
      const closeD = isCurved
        ? MathWarp.getCurvedSvgPath(this.draftPoints, closeCurves, 1920, 1080)
        : `M ${pixelPts[0].join(' ')} L ${pixelPts.slice(1).map(p => p.join(' ')).join(' L ')} Z`;

      html += `<path d="${closeD}" class="draft-closing-preview" />`;
    }

    // Segmentos ya dibujados: curvos o rectos
    if (pixelPts.length >= 2) {
      if (this.draftCurves && Object.keys(this.draftCurves).length > 0) {
        const pathD = MathWarp.getOpenCurvedSvgPath(this.draftPoints, this.draftCurves, 1920, 1080);
        const stroke = isCurved ? '#f472b6' : '#00f0ff';
        html += `
          <path d="${pathD}" fill="none" stroke="${stroke}" stroke-width="${isCurved ? '3' : '2.5'}" stroke-dasharray="6 3" filter="url(#glow)"/>
        `;
      } else {
        const pointsStr = pixelPts.map(p => p.join(',')).join(' ');
        html += `
          <polyline points="${pointsStr}" fill="none" stroke="#00f0ff" stroke-width="2.5" stroke-dasharray="6 3"/>
        `;
      }
    }

    // Línea elástica (rubberband) hacia el puntero
    if (this.currentPointerPos && pixelPts.length > 0) {
      const lastPt = pixelPts[pixelPts.length - 1];
      const curPx = this.currentPointerPos[0] * 1920;
      const curPy = this.currentPointerPos[1] * 1080;

      if (isCurved) {
        // Arco Bézier dinámico continuo hacia el cursor
        let cp1, cp2;
        const dx = curPx - lastPt[0];
        const dy = curPy - lastPt[1];
        const lastIdx = pixelPts.length - 1;
        const lastT = this.draftTangents[lastIdx];
        if (lastT && Math.hypot(lastT[0], lastT[1]) > 0.003) {
          cp1 = [lastPt[0] + lastT[0] * 1920, lastPt[1] + lastT[1] * 1080];
        } else if (pixelPts.length >= 2) {
          const prevPt = pixelPts[pixelPts.length - 2];
          const segDx = lastPt[0] - prevPt[0];
          const segDy = lastPt[1] - prevPt[1];
          cp1 = [lastPt[0] + segDx * 0.25, lastPt[1] + segDy * 0.25];
        } else {
          cp1 = [lastPt[0] + dx * 0.33, lastPt[1] + dy * 0.33];
        }
        cp2 = [curPx - dx * 0.33, curPy - dy * 0.33];

        html += `
          <path d="M ${lastPt[0]} ${lastPt[1]} C ${cp1[0]} ${cp1[1]}, ${cp2[0]} ${cp2[1]}, ${curPx} ${curPy}"
                fill="none" stroke="#f472b6" stroke-width="2.8" stroke-dasharray="6 3" filter="url(#glow)"/>
        `;
      } else {
        html += `
          <line x1="${lastPt[0]}" y1="${lastPt[1]}" x2="${curPx}" y2="${curPy}" stroke="#00f0ff" stroke-width="2" stroke-dasharray="4 4" opacity="0.85"/>
        `;
      }
    }

    // Brazos de manijas tangentes interactivas si se están arrastrando (Modo Curvo)
    if (isCurved && this.isDrawingDrag && this.drawingPointIndex !== null) {
      const orig = pixelPts[this.drawingPointIndex];
      const t = this.draftTangents[this.drawingPointIndex];
      if (t && (t[0] !== 0 || t[1] !== 0)) {
        const h1x = orig[0] + t[0] * 1920;
        const h1y = orig[1] + t[1] * 1080;
        const h2x = orig[0] - t[0] * 1920;
        const h2y = orig[1] - t[1] * 1080;
        html += `
          <line x1="${h2x}" y1="${h2y}" x2="${h1x}" y2="${h1y}" class="draft-tangent-line"/>
          <circle cx="${h1x}" cy="${h1y}" r="6" class="draft-tangent-handle"/>
          <circle cx="${h2x}" cy="${h2y}" r="6" class="draft-tangent-handle"/>
        `;
      }
    }

    // Vértices colocados con retroalimentación visual de cierre
    pixelPts.forEach(([px, py], i) => {
      const isFirst = i === 0;
      const isCloseTarget = isFirst && this.isNearFirstPoint && pixelPts.length >= 3;
      if (isCloseTarget) {
        html += `
          <circle cx="${px}" cy="${py}" r="22" fill="rgba(0, 255, 136, 0.25)" stroke="#00ff88" stroke-width="2.5" stroke-dasharray="4 3" filter="url(#glow)"/>
          <circle cx="${px}" cy="${py}" r="10" fill="#00ff88" stroke="#ffffff" stroke-width="3" filter="url(#glow)"/>
          <rect x="${px - 65}" y="${py - 36}" width="130" height="24" rx="4" fill="#0b0e14" stroke="#00ff88" stroke-width="1.5" opacity="0.95"/>
          <text x="${px}" y="${py - 20}" fill="#00ff88" font-size="11.5" font-weight="bold" text-anchor="middle">✓ Clic para Cerrar</text>
        `;
      } else {
        const nodeColor = isFirst ? '#00ff88' : (isCurved ? '#f472b6' : '#00f0ff');
        const r = isFirst ? 8 : (isCurved ? 6.5 : 5.5);
        html += `
          <circle cx="${px}" cy="${py}" r="${r}" fill="${nodeColor}" stroke="#000000" stroke-width="2"/>
          <text x="${px}" y="${py - 12}" fill="${nodeColor}" font-size="11" font-weight="bold" text-anchor="middle">${i + 1}</text>
        `;
      }
    });

    this.draftLayer.innerHTML = html;
  }

  renderGizmos() {
    const activePoly = this.scene.getSelectedPolygon();
    if (!activePoly || !activePoly.visible || activePoly.locked || this.isDrawMode()) {
      this.gizmoLayer.innerHTML = '';
      return;
    }

    let html = '';

    if (activePoly.isCircular()) {
      // Gizmos específicos para Círculos y Elipses
      const cx = activePoly.center[0] * 1920;
      const cy = activePoly.center[1] * 1080;
      const rx = activePoly.radiusX * 1920;
      const ry = activePoly.radiusY * 1080;
      const rot = activePoly.rotation || 0;
      const rad = (rot * Math.PI) / 180;
      const cosR = Math.cos(rad);
      const sinR = Math.sin(rad);

      // Cardinales
      const ex = cx + rx * cosR;
      const ey = cy + rx * sinR;
      const wx = cx - rx * cosR;
      const wy = cy - rx * sinR;
      const nPx = cx + ry * sinR;
      const nPy = cy - ry * cosR;
      const sx = cx - ry * sinR;
      const sy = cy + ry * cosR;

      // Manija de rotación
      const rotDist = ry + 35;
      const rotX = cx + rotDist * sinR;
      const rotY = cy - rotDist * cosR;

      html += `
        <!-- Ejes de alineación ortogonales locales -->
        <line x1="${wx}" y1="${wy}" x2="${ex}" y2="${ey}" stroke="#00f0ff" stroke-width="1.2" stroke-dasharray="4 4" opacity="0.45"/>
        <line x1="${sx}" y1="${sy}" x2="${nPx}" y2="${nPy}" stroke="#00f0ff" stroke-width="1.2" stroke-dasharray="4 4" opacity="0.45"/>

        <!-- Vástago hacia la manija de rotación -->
        <line x1="${nPx}" y1="${nPy}" x2="${rotX}" y2="${rotY}" stroke="#ff0055" stroke-width="2" stroke-dasharray="3 3"/>

        <!-- Manija de rotación (arriba) -->
        <circle cx="${rotX}" cy="${rotY}" r="18" fill="transparent" pointer-events="all" cursor="grab"/>
        <circle cx="${rotX}" cy="${rotY}" r="7" fill="#ff0055" stroke="#ffffff" stroke-width="2" pointer-events="none" filter="url(#glow)"/>

        <!-- Manija central (Traslación de posición) -->
        <circle cx="${cx}" cy="${cy}" r="22" fill="transparent" pointer-events="all" cursor="move"/>
        <circle cx="${cx}" cy="${cy}" r="7.5" fill="#ffffff" stroke="#00f0ff" stroke-width="2.5" pointer-events="none" filter="url(#glow)"/>
        <line x1="${cx - 4}" y1="${cy}" x2="${cx + 4}" y2="${cy}" stroke="#00f0ff" stroke-width="1.5" pointer-events="none"/>
        <line x1="${cx}" y1="${cy - 4}" x2="${cx}" y2="${cy + 4}" stroke="#00f0ff" stroke-width="1.5" pointer-events="none"/>

        <!-- Manijas cardinales de radio (E, W, N, S) -->
        <circle cx="${ex}" cy="${ey}" r="16" fill="transparent" pointer-events="all" cursor="ew-resize"/>
        <circle cx="${ex}" cy="${ey}" r="6.5" fill="#00ff88" stroke="#ffffff" stroke-width="2" pointer-events="none"/>

        <circle cx="${wx}" cy="${wy}" r="16" fill="transparent" pointer-events="all" cursor="ew-resize"/>
        <circle cx="${wx}" cy="${wy}" r="6.5" fill="#00ff88" stroke="#ffffff" stroke-width="2" pointer-events="none"/>

        <circle cx="${nPx}" cy="${nPy}" r="16" fill="transparent" pointer-events="all" cursor="ns-resize"/>
        <circle cx="${nPx}" cy="${nPy}" r="6.5" fill="#00ff88" stroke="#ffffff" stroke-width="2" pointer-events="none"/>

        <circle cx="${sx}" cy="${sy}" r="16" fill="transparent" pointer-events="all" cursor="ns-resize"/>
        <circle cx="${sx}" cy="${sy}" r="6.5" fill="#00ff88" stroke="#ffffff" stroke-width="2" pointer-events="none"/>
      `;
    } else {
      // Gizmos para Polígonos con o sin curvas Bézier
      const pixelPts = activePoly.getPixelPoints(1920, 1080);

      // 1. Manijas Bézier o Puntos intermedios
      for (let i = 0; i < pixelPts.length; i++) {
        const nextIdx = (i + 1) % pixelPts.length;
        const [x1, y1] = pixelPts[i];
        const [x2, y2] = pixelPts[nextIdx];
        const curveKey = `${i}-${nextIdx}`;
        const curve = activePoly.edgeCurves ? (activePoly.edgeCurves[curveKey] || activePoly.edgeCurves[`${i}`]) : null;

        if (curve && curve.c1 && curve.c2) {
          const c1x = curve.c1[0] * 1920;
          const c1y = curve.c1[1] * 1080;
          const c2x = curve.c2[0] * 1920;
          const c2y = curve.c2[1] * 1080;

          // Punto medio de la curva para subdivisión de Casteljau
          const split = MathWarp.splitCubicBezier(activePoly.points[i], curve.c1, curve.c2, activePoly.points[nextIdx], 0.5);
          const mx = split.pMid[0] * 1920;
          const my = split.pMid[1] * 1080;

          html += `
            <!-- Brazos tangentes Bézier -->
            <line x1="${x1}" y1="${y1}" x2="${c1x}" y2="${c1y}" stroke="#ff00cc" stroke-width="1.6" stroke-dasharray="3 3" opacity="0.85"/>
            <line x1="${x2}" y1="${y2}" x2="${c2x}" y2="${c2y}" stroke="#ff00cc" stroke-width="1.6" stroke-dasharray="3 3" opacity="0.85"/>

            <!-- Manija Tangente C1 -->
            <circle cx="${c1x}" cy="${c1y}" r="16" fill="transparent" pointer-events="all" cursor="grab"/>
            <circle cx="${c1x}" cy="${c1y}" r="6" fill="#ff00cc" stroke="#ffffff" stroke-width="2" pointer-events="none" filter="url(#glow)"/>

            <!-- Manija Tangente C2 -->
            <circle cx="${c2x}" cy="${c2y}" r="16" fill="transparent" pointer-events="all" cursor="grab"/>
            <circle cx="${c2x}" cy="${c2y}" r="6" fill="#ff00cc" stroke="#ffffff" stroke-width="2" pointer-events="none" filter="url(#glow)"/>

            <!-- Punto medio (+) para subdividir o alternar arista curvada -->
            <circle cx="${mx}" cy="${my}" r="14" fill="transparent" pointer-events="all" cursor="copy">
              <title>Punto medio: Clic para añadir esquina | Alt+Clic o Shift+Clic para enderezar arista</title>
            </circle>
            <circle class="midpoint-handle" cx="${mx}" cy="${my}" r="5.5" fill="#00ffcc" stroke="#000000" stroke-width="1.5" opacity="0.9" pointer-events="none" filter="url(#glow)"/>
          `;
        } else {
          // Manija intermedia (Midpoint para subdivisión recta o curvar)
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2;
          html += `
            <circle cx="${mx}" cy="${my}" r="14" fill="transparent" pointer-events="all" cursor="copy">
              <title>Punto medio: Clic para añadir esquina | Alt+Clic o Shift+Clic para curvar arista</title>
            </circle>
            <circle class="midpoint-handle" cx="${mx}" cy="${my}" r="5" fill="#ffaa00" stroke="#000" stroke-width="1.5" opacity="0.75" pointer-events="none"/>
          `;
        }
      }

      // 2. Vértices principales con números de esquina (1, 2, 3, 4...) y soporte multi-selección
      pixelPts.forEach(([px, py], i) => {
        const isVertexSelected = (this.selectedVertexIndex === i);
        const isMultiSelected = this.selectedVertexIndices && this.selectedVertexIndices.has(i);
        const vertexClass = isMultiSelected 
          ? 'multi-selected-vertex' 
          : (isVertexSelected ? 'active-nudge-vertex' : '');
        const fillCol = isMultiSelected ? '#ffaa00' : (isVertexSelected ? '#ff0055' : '#ffffff');
        const strokeCol = isMultiSelected ? '#ffffff' : (isVertexSelected ? '#ffffff' : '#00f0ff');
        const radius = (isMultiSelected || isVertexSelected) ? 9 : 7;
        const strokeW = (isMultiSelected || isVertexSelected) ? 3.5 : 3;

        html += `
          <!-- Anillo invisible de hit-test amplio -->
          <circle cx="${px}" cy="${py}" r="18" fill="transparent" pointer-events="all" cursor="grab"/>
          <!-- Círculo visible de la manija -->
          <circle class="vertex-handle ${vertexClass}" cx="${px}" cy="${py}" r="${radius}" fill="${fillCol}" stroke="${strokeCol}" stroke-width="${strokeW}" pointer-events="none" filter="url(#glow)"/>
          <text x="${px + 14}" y="${py - 10}" fill="${fillCol}" font-size="${(isMultiSelected || isVertexSelected) ? 14 : 12}" font-weight="bold" pointer-events="none">${i + 1}</text>
        `;
      });
    }

    this.gizmoLayer.innerHTML = html;
  }
}

window.EditorCanvas = EditorCanvas;
