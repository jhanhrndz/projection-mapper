/**
 * polygon_model.js - Estructura de datos para objetos poligonales, escenas e historial.
 * Utiliza coordenadas normalizadas [0.0 - 1.0] relativas a la resolución del proyector
 * para ser totalmente independiente de la escala de la pantalla.
 */

class PolygonObject {
  constructor(options = {}) {
    this.id = options.id || ('poly_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5));
    this.name = options.name || 'Superficie ' + this.id.substr(-4);
    // Tipos: 'quad', 'polygon', 'circle', 'occluder', 'circle_occluder'
    this.type = options.type || 'quad';
    // Puntos en coordenadas normalizadas 0.0 a 1.0: [[x0, y0], [x1, y1], ...]
    this.points = options.points ? options.points.map(p => [Number(p[0]), Number(p[1])]) : [];
    
    // Parámetros específicos para círculos y elipses
    this.center = options.center ? [Number(options.center[0]), Number(options.center[1])] : [0.5, 0.5];
    this.radiusX = options.radiusX !== undefined ? Number(options.radiusX) : 0.18;
    this.radiusY = options.radiusY !== undefined ? Number(options.radiusY) : 0.18;
    this.rotation = options.rotation !== undefined ? Number(options.rotation) : 0;

    // Curvas Bézier por arista: { "0-1": { c1: [nx1, ny1], c2: [nx2, ny2] } }
    this.edgeCurves = options.edgeCurves ? JSON.parse(JSON.stringify(options.edgeCurves)) : {};
    
    // Configuración visual y de medios
    this.visible = options.visible !== undefined ? options.visible : true;
    this.locked = options.locked || false;
    this.color = options.color || this._generateRandomColor();
    
    // Medios asociados
    this.media = options.media || {
      type: 'color', // 'color', 'image', 'video'
      src: null,
      opacity: 1.0,
      fit: 'stretch', // 'stretch', 'contain', 'cover'
      loop: true,
      playing: true
    };

    // Si es un círculo y no tiene puntos perimetrales, sincronizarlos
    if (this.isCircular()) {
      this.points = this.getBoundaryPoints(64);
    }
  }

  isCircular() {
    return this.type === 'circle' || this.type === 'circle_occluder';
  }

  isOccluder() {
    return this.type === 'occluder' || this.type === 'circle_occluder';
  }

  _generateRandomColor() {
    const palette = [
      '#00f0ff', '#ff0055', '#ffaa00', '#00ff66', 
      '#bf00ff', '#ffff00', '#0099ff', '#ff3366'
    ];
    return palette[Math.floor(Math.random() * palette.length)];
  }

  /**
   * Genera los puntos de la frontera perimetral para una elipse/círculo con su rotación.
   */
  getBoundaryPoints(samples = 64) {
    if (typeof MathWarp !== 'undefined' && MathWarp.getEllipseBoundary) {
      return MathWarp.getEllipseBoundary(this.center[0], this.center[1], this.radiusX, this.radiusY, this.rotation, samples);
    }
    const rad = (this.rotation * Math.PI) / 180;
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);
    const pts = [];
    for (let i = 0; i < samples; i++) {
      const theta = (i / samples) * 2 * Math.PI;
      const ex = this.radiusX * Math.cos(theta);
      const ey = this.radiusY * Math.sin(theta);
      pts.push([
        Math.max(0, Math.min(1, this.center[0] + (ex * cosR - ey * sinR))),
        Math.max(0, Math.min(1, this.center[1] + (ex * sinR + ey * cosR)))
      ]);
    }
    return pts;
  }

  /**
   * Retorna los puntos escalados a los píxeles reales de un lienzo de ancho W y alto H.
   */
  getPixelPoints(width, height) {
    if (this.isCircular()) {
      return this.getBoundaryPoints(64).map(([nx, ny]) => [nx * width, ny * height]);
    }
    return this.points.map(([nx, ny]) => [nx * width, ny * height]);
  }

  /**
   * Actualiza los puntos a partir de coordenadas en píxeles.
   */
  setPixelPoints(pixelPoints, width, height) {
    this.points = pixelPoints.map(([px, py]) => [
      Math.max(0, Math.min(1, px / width)),
      Math.max(0, Math.min(1, py / height))
    ]);
  }

  /**
   * Elimina un vértice y reconstruye consistentemente las curvas Bézier de las aristas.
   * Si alguna de las aristas incidentes era curva, fusiona inteligentemente las tangentes
   * para que la nueva arista resultante conserve su condición curva sin distorsiones.
   */
  removeVertex(vertexIndex) {
    if (this.isCircular() || this.points.length <= 3) return false;
    const n = this.points.length;
    if (vertexIndex < 0 || vertexIndex >= n) return false;

    const p = (vertexIndex - 1 + n) % n;
    const q = (vertexIndex + 1) % n;
    const ptP = this.points[p];
    const ptV = this.points[vertexIndex];
    const ptQ = this.points[q];

    const curvePrevKey = `${p}-${vertexIndex}`;
    const curveNextKey = `${vertexIndex}-${q}`;
    const curvePrev = this.edgeCurves ? (this.edgeCurves[curvePrevKey] || this.edgeCurves[`${p}`]) : null;
    const curveNext = this.edgeCurves ? (this.edgeCurves[curveNextKey] || this.edgeCurves[`${vertexIndex}`]) : null;

    let blendedCurve = null;
    if (curvePrev || curveNext) {
      const dx = ptQ[0] - ptP[0];
      const dy = ptQ[1] - ptP[1];
      const lNew = Math.hypot(dx, dy);
      const lPrev = Math.hypot(ptV[0] - ptP[0], ptV[1] - ptP[1]);
      const lNext = Math.hypot(ptQ[0] - ptV[0], ptQ[1] - ptV[1]);

      const s1 = Math.min(2.0, Math.max(0.4, lNew / (lPrev + 1e-6)));
      const s2 = Math.min(2.0, Math.max(0.4, lNew / (lNext + 1e-6)));

      let c1, c2;
      if (curvePrev && curveNext) {
        c1 = [
          ptP[0] + (curvePrev.c1[0] - ptP[0]) * s1,
          ptP[1] + (curvePrev.c1[1] - ptP[1]) * s1
        ];
        c2 = [
          ptQ[0] + (curveNext.c2[0] - ptQ[0]) * s2,
          ptQ[1] + (curveNext.c2[1] - ptQ[1]) * s2
        ];
      } else if (curvePrev) {
        c1 = [
          ptP[0] + (curvePrev.c1[0] - ptP[0]) * s1,
          ptP[1] + (curvePrev.c1[1] - ptP[1]) * s1
        ];
        c2 = [
          ptP[0] + dx * 0.67,
          ptP[1] + dy * 0.67
        ];
      } else {
        c1 = [
          ptP[0] + dx * 0.33,
          ptP[1] + dy * 0.33
        ];
        c2 = [
          ptQ[0] + (curveNext.c2[0] - ptQ[0]) * s2,
          ptQ[1] + (curveNext.c2[1] - ptQ[1]) * s2
        ];
      }

      blendedCurve = {
        c1: [Math.max(0, Math.min(1, c1[0])), Math.max(0, Math.min(1, c1[1]))],
        c2: [Math.max(0, Math.min(1, c2[0])), Math.max(0, Math.min(1, c2[1]))]
      };
    }

    this.points.splice(vertexIndex, 1);
    this.type = this.points.length === 4 ? 'quad' : 'polygon';

    if (this.edgeCurves && Object.keys(this.edgeCurves).length > 0) {
      const newCurves = {};
      const newN = this.points.length;
      const newP = p > vertexIndex ? p - 1 : p;
      const newQ = (newP + 1) % newN;

      for (const key of Object.keys(this.edgeCurves)) {
        const parts = key.split('-');
        if (parts.length === 2) {
          const from = parseInt(parts[0]);
          const to = parseInt(parts[1]);
          if (from === vertexIndex || to === vertexIndex) continue;
          const newFrom = from > vertexIndex ? from - 1 : from;
          const newTo = (newFrom + 1) % newN;
          newCurves[`${newFrom}-${newTo}`] = this.edgeCurves[key];
        }
      }

      if (blendedCurve) {
        newCurves[`${newP}-${newQ}`] = blendedCurve;
      }

      this.edgeCurves = newCurves;
    }
    return true;
  }

  /**
   * Alterna una arista específica entre recta y curva Bézier cúbica.
   * @param {number} edgeIndex Índice del vértice de origen de la arista.
   * @returns {boolean} true si ahora es curva, false si ahora es recta.
   */
  toggleEdgeCurved(edgeIndex) {
    if (this.isCircular()) return false;
    const n = this.points.length;
    if (edgeIndex < 0 || edgeIndex >= n) return false;

    const nextIndex = (edgeIndex + 1) % n;
    const key = `${edgeIndex}-${nextIndex}`;
    if (!this.edgeCurves) this.edgeCurves = {};

    if (this.edgeCurves[key] || this.edgeCurves[`${edgeIndex}`]) {
      delete this.edgeCurves[key];
      delete this.edgeCurves[`${edgeIndex}`];
      return false;
    } else {
      const pA = this.points[edgeIndex];
      const pB = this.points[nextIndex];
      const dx = pB[0] - pA[0];
      const dy = pB[1] - pA[1];
      const nx = -dy * 0.18;
      const ny = dx * 0.18;
      this.edgeCurves[key] = {
        c1: [
          Math.max(0, Math.min(1, pA[0] + dx * 0.33 + nx)),
          Math.max(0, Math.min(1, pA[1] + dy * 0.33 + ny))
        ],
        c2: [
          Math.max(0, Math.min(1, pA[0] + dx * 0.67 + nx)),
          Math.max(0, Math.min(1, pA[1] + dy * 0.67 + ny))
        ]
      };
      return true;
    }
  }

  /**
   * Subdivide una arista (recta o curva) insertando un nuevo vértice en su punto medio.
   * Si la arista es curva Bézier cúbica, utiliza el algoritmo de De Casteljau para una transición 100% libre de distorsión.
   */
  subdivideEdge(edgeIndex, splitResult = null) {
    if (this.isCircular()) return -1;
    const n = this.points.length;
    if (edgeIndex < 0 || edgeIndex >= n) return -1;

    const nextIndex = (edgeIndex + 1) % n;
    const pA = this.points[edgeIndex];
    const pB = this.points[nextIndex];
    const curveKey = `${edgeIndex}-${nextIndex}`;
    const curve = this.edgeCurves ? (this.edgeCurves[curveKey] || this.edgeCurves[`${edgeIndex}`]) : null;

    let pMid;
    let leftCurve = null;
    let rightCurve = null;

    if (curve && curve.c1 && curve.c2) {
      const split = splitResult || MathWarp.splitCubicBezier(pA, curve.c1, curve.c2, pB, 0.5);
      pMid = split.pMid;
      leftCurve = split.left;
      rightCurve = split.right;
    } else {
      pMid = [(pA[0] + pB[0]) / 2, (pA[1] + pB[1]) / 2];
    }

    const insertIdx = edgeIndex + 1;
    this.points.splice(insertIdx, 0, pMid);
    this.type = 'polygon';

    // Reindexar curvas para n+1 aristas
    if (this.edgeCurves && Object.keys(this.edgeCurves).length > 0) {
      const oldCurves = { ...this.edgeCurves };
      const newCurves = {};
      const newN = this.points.length;

      for (let j = 0; j < n; j++) {
        const oldKey = `${j}-${(j + 1) % n}`;
        const c = oldCurves[oldKey] || oldCurves[`${j}`];
        if (j < edgeIndex) {
          if (c) newCurves[`${j}-${j + 1}`] = c;
        } else if (j === edgeIndex) {
          if (leftCurve) newCurves[`${edgeIndex}-${edgeIndex + 1}`] = leftCurve;
          if (rightCurve) newCurves[`${edgeIndex + 1}-${(edgeIndex + 2) % newN}`] = rightCurve;
        } else {
          if (c) newCurves[`${j + 1}-${(j + 2) % newN}`] = c;
        }
      }
      this.edgeCurves = newCurves;
    } else if (leftCurve && rightCurve) {
      const newN = this.points.length;
      this.edgeCurves = {
        [`${edgeIndex}-${edgeIndex + 1}`]: leftCurve,
        [`${edgeIndex + 1}-${(edgeIndex + 2) % newN}`]: rightCurve
      };
    }

    return insertIdx;
  }

  /**
   * Crea un cuadrilátero estándar centrado en el área de proyección.
   */
  static createDefaultQuad(centerX = 0.5, centerY = 0.5, size = 0.3) {
    const hw = size * 0.5;
    const hh = size * 0.5;
    return new PolygonObject({
      type: 'quad',
      name: 'Quad ' + Math.floor(Math.random() * 1000),
      points: [
        [centerX - hw, centerY - hh], // Top-Left
        [centerX + hw, centerY - hh], // Top-Right
        [centerX + hw, centerY + hh], // Bottom-Right
        [centerX - hw, centerY + hh]  // Bottom-Left
      ]
    });
  }

  /**
   * Crea un cuadrado geométrico perfecto (proporción 1:1 en píxeles sobre proyección 16:9).
   */
  static createDefaultSquare(centerX = 0.5, centerY = 0.5, size = 0.25, isOccluder = false) {
    const hw = size * 0.5;
    const hh = hw * (1920 / 1080); // Compensación aspecto 16:9
    return new PolygonObject({
      type: isOccluder ? 'occluder' : 'quad',
      name: (isOccluder ? 'Máscara Cuadrada ' : 'Cuadrado 1:1 ') + Math.floor(Math.random() * 1000),
      points: [
        [centerX - hw, centerY - hh],
        [centerX + hw, centerY - hh],
        [centerX + hw, centerY + hh],
        [centerX - hw, centerY + hh]
      ],
      color: isOccluder ? '#ffffff' : '#00f0ff'
    });
  }

  /**
   * Crea una superficie o máscara circular centrada.
   */
  static createDefaultCircle(centerX = 0.5, centerY = 0.5, radius = 0.18, isOccluder = false) {
    const poly = new PolygonObject({
      type: isOccluder ? 'circle_occluder' : 'circle',
      name: (isOccluder ? 'Máscara Circular ' : 'Círculo ') + Math.floor(Math.random() * 1000),
      center: [centerX, centerY],
      radiusX: radius,
      radiusY: radius * (1920 / 1080), // Aspecto 1:1 en pantalla
      rotation: 0,
      color: isOccluder ? '#ffffff' : '#00f0ff'
    });
    return poly;
  }

  /**
   * Crea un triángulo equilátero centrado (3 esquinas).
   */
  static createDefaultTriangle(centerX = 0.5, centerY = 0.5, size = 0.28, isOccluder = false) {
    const rx = size * 0.5;
    const ry = rx * (1920 / 1080);
    const angles = [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6];
    const pts = angles.map(ang => [
      Math.max(0, Math.min(1, centerX + rx * Math.cos(ang))),
      Math.max(0, Math.min(1, centerY + ry * Math.sin(ang)))
    ]);
    return new PolygonObject({
      type: isOccluder ? 'occluder' : 'polygon',
      name: (isOccluder ? 'Máscara Triángulo ' : 'Triángulo ') + Math.floor(Math.random() * 1000),
      points: pts,
      color: isOccluder ? '#ffffff' : '#ffaa00'
    });
  }

  /**
   * Crea un polígono regular (Pentágono 5 lados, Hexágono 6 lados, etc.).
   */
  static createDefaultRegularPolygon(sides = 5, centerX = 0.5, centerY = 0.5, size = 0.26, isOccluder = false) {
    const rx = size * 0.5;
    const ry = rx * (1920 / 1080);
    const pts = [];
    const step = (2 * Math.PI) / sides;
    const offset = -Math.PI / 2;
    for (let i = 0; i < sides; i++) {
      const ang = offset + i * step;
      pts.push([
        Math.max(0, Math.min(1, centerX + rx * Math.cos(ang))),
        Math.max(0, Math.min(1, centerY + ry * Math.sin(ang)))
      ]);
    }
    const namePrefix = sides === 5 ? 'Pentágono ' : (sides === 6 ? 'Hexágono ' : `Polígono-${sides} `);
    return new PolygonObject({
      type: isOccluder ? 'occluder' : 'polygon',
      name: (isOccluder ? 'Máscara ' + namePrefix : namePrefix) + Math.floor(Math.random() * 1000),
      points: pts,
      color: isOccluder ? '#ffffff' : '#bf00ff'
    });
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      points: this.isCircular() ? this.getBoundaryPoints(64) : this.points,
      center: this.center,
      radiusX: this.radiusX,
      radiusY: this.radiusY,
      rotation: this.rotation,
      edgeCurves: this.edgeCurves,
      visible: this.visible,
      locked: this.locked,
      color: this.color,
      media: this.media
    };
  }

  static fromJSON(data) {
    return new PolygonObject(data);
  }
}


class SceneModel {
  constructor(name = 'Nueva Escena') {
    this.name = name;
    this.polygons = [];
    this.selectedId = null;
    this.displayMode = 'calibration'; // 'calibration' | 'show'
    this.aspectRatio = '16:9';
    
    // Historial para Deshacer / Rehacer
    this.history = [];
    this.historyIndex = 0;
    this.maxHistory = 40;
    
    // Solo inicializar el snapshot en memoria para undo/redo; NO sobrescribir localStorage
    const initialSnapshot = JSON.stringify(this.polygons.map(p => p.toJSON()));
    this.history.push(initialSnapshot);
  }

  saveAutosave() {
    try {
      if (typeof localStorage !== 'undefined' && this.polygons.length > 0) {
        localStorage.setItem('projection_mapper_autosave', JSON.stringify(this.toJSON()));
      }
    } catch (e) {
      console.warn('[SceneModel] No se pudo guardar autosave en localStorage:', e);
    }
  }

  restoreFromAutosave() {
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('projection_mapper_autosave');
        if (saved) {
          const data = JSON.parse(saved);
          if (data && Array.isArray(data.polygons)) {
            this.fromJSON(data);
            return true;
          }
        }
      }
    } catch (e) {
      console.warn('[SceneModel] Error restaurando autosave:', e);
    }
    return false;
  }

  saveStateToHistory() {
    // Si estamos en un punto intermedio de la historia, descartar el futuro
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }
    const state = JSON.stringify(this.polygons.map(p => p.toJSON()));
    this.history.push(state);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    } else {
      this.historyIndex++;
    }

    // Persistir estado en autosave
    this.saveAutosave();
  }

  toggleLockAll() {
    const allLocked = this.polygons.length > 0 && this.polygons.every(p => p.locked);
    const nextState = !allLocked;
    this.polygons.forEach(p => { p.locked = nextState; });
    this.saveStateToHistory();
    return nextState;
  }

  isAllLocked() {
    return this.polygons.length > 0 && this.polygons.every(p => p.locked);
  }

  undo() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this._restoreHistoryState(this.history[this.historyIndex]);
      return true;
    }
    return false;
  }

  redo() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this._restoreHistoryState(this.history[this.historyIndex]);
      return true;
    }
    return false;
  }

  _restoreHistoryState(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);
      this.polygons = data.map(item => PolygonObject.fromJSON(item));
      if (!this.getPolygon(this.selectedId)) {
        this.selectedId = this.polygons.length > 0 ? this.polygons[this.polygons.length - 1].id : null;
      }
    } catch (e) {
      console.error('[SceneModel] Error restaurando historial:', e);
    }
  }

  addPolygon(polygon) {
    this.polygons.push(polygon);
    this.selectedId = polygon.id;
    this.saveStateToHistory();
  }

  removePolygon(id) {
    const idx = this.polygons.findIndex(p => p.id === id);
    if (idx !== -1) {
      this.polygons.splice(idx, 1);
      if (this.selectedId === id) {
        this.selectedId = this.polygons.length > 0 ? this.polygons[Math.max(0, idx - 1)].id : null;
      }
      this.saveStateToHistory();
    }
  }

  getPolygon(id) {
    return this.polygons.find(p => p.id === id) || null;
  }

  getSelectedPolygon() {
    return this.getPolygon(this.selectedId);
  }

  moveLayerUp(id) {
    const idx = this.polygons.findIndex(p => p.id === id);
    if (idx === -1 || idx >= this.polygons.length - 1) return false;
    const temp = this.polygons[idx];
    this.polygons[idx] = this.polygons[idx + 1];
    this.polygons[idx + 1] = temp;
    this.saveStateToHistory();
    return true;
  }

  moveLayerDown(id) {
    const idx = this.polygons.findIndex(p => p.id === id);
    if (idx <= 0) return false;
    const temp = this.polygons[idx];
    this.polygons[idx] = this.polygons[idx - 1];
    this.polygons[idx - 1] = temp;
    this.saveStateToHistory();
    return true;
  }

  bringToFront(id) {
    const idx = this.polygons.findIndex(p => p.id === id);
    if (idx === -1 || idx === this.polygons.length - 1) return false;
    const [poly] = this.polygons.splice(idx, 1);
    this.polygons.push(poly);
    this.saveStateToHistory();
    return true;
  }

  sendToBack(id) {
    const idx = this.polygons.findIndex(p => p.id === id);
    if (idx <= 0) return false;
    const [poly] = this.polygons.splice(idx, 1);
    this.polygons.unshift(poly);
    this.saveStateToHistory();
    return true;
  }

  toJSON() {
    return {
      name: this.name,
      aspectRatio: this.aspectRatio,
      displayMode: this.displayMode,
      polygons: this.polygons.map(p => p.toJSON())
    };
  }

  fromJSON(data) {
    this.name = data.name || this.name;
    this.aspectRatio = data.aspectRatio || '16:9';
    this.displayMode = data.displayMode || 'calibration';
    if (Array.isArray(data.polygons)) {
      this.polygons = data.polygons.map(p => PolygonObject.fromJSON(p));
      this.selectedId = this.polygons.length > 0 ? this.polygons[0].id : null;
    }
    this.history = [];
    this.historyIndex = -1;
    this.saveStateToHistory();
  }
}

window.PolygonObject = PolygonObject;
window.SceneModel = SceneModel;
