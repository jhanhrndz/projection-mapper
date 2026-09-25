/**
 * math_warp.js - Motor de cálculo matemático de deformación de perspectiva (Corner Pinning).
 * Resuelve la matriz de homografía 3x3 que mapea un medio rectangular hacia 4 esquinas libres
 * y genera la matriz homogénea `matrix3d` acelerada por hardware en GPU.
 */

class MathWarp {
  /**
   * Resuelve los coeficientes de proyección del cuadrado unitario [0,1]x[0,1]
   * hacia un cuadrilátero destino D = [ [x0,y0], [x1,y1], [x2,y2], [x3,y3] ].
   *
   * Orden de esquinas:
   * p0: Top-Left (0, 0)
   * p1: Top-Right (1, 0)
   * p2: Bottom-Right (1, 1)
   * p3: Bottom-Left (0, 1)
   */
  static getUnitSquareToQuadHomography(pts) {
    const [x0, y0] = pts[0];
    const [x1, y1] = pts[1];
    const [x2, y2] = pts[2];
    const [x3, y3] = pts[3];

    const dx1 = x1 - x2;
    const dx2 = x3 - x2;
    const dx3 = x0 - x1 + x2 - x3;
    const dy1 = y1 - y2;
    const dy2 = y3 - y2;
    const dy3 = y0 - y1 + y2 - y3;

    // Caso afín (paralelogramo)
    if (Math.abs(dx3) < 1e-7 && Math.abs(dy3) < 1e-7) {
      return {
        a11: x1 - x0, a12: x2 - x1, a13: x0,
        a21: y1 - y0, a22: y2 - y1, a23: y0,
        a31: 0,       a32: 0,       a33: 1
      };
    }

    // Caso proyectivo general (perspectiva completa)
    const d = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(d) < 1e-9) {
      // Degenerado (puntos colineales o solapados), fallback seguro
      return {
        a11: 1, a12: 0, a13: x0,
        a21: 0, a22: 1, a23: y0,
        a31: 0, a32: 0, a33: 1
      };
    }

    const a31 = (dx3 * dy2 - dx2 * dy3) / d;
    const a32 = (dx1 * dy3 - dx3 * dy1) / d;
    const a11 = x1 - x0 + a31 * x1;
    const a12 = x3 - x0 + a32 * x3;
    const a13 = x0;
    const a21 = y1 - y0 + a31 * y1;
    const a22 = y3 - y0 + a32 * y3;
    const a23 = y0;
    const a33 = 1;

    return { a11, a12, a13, a21, a22, a23, a31, a32, a33 };
  }

  /**
   * Genera el valor de la propiedad CSS `matrix3d(...)` para deformar un elemento
   * de dimensiones [sourceWidth, sourceHeight] hacia las 4 esquinas destino `destPoints`.
   *
   * @param {Array<Array<number>>} destPoints - 4 esquinas en píxeles [[x0,y0], [x1,y1], [x2,y2], [x3,y3]]
   * @param {number} sourceWidth - Ancho base del elemento (ej. 800)
   * @param {number} sourceHeight - Alto base del elemento (ej. 800)
   * @returns {string} cadena CSS matrix3d(...)
   */
  static getMatrix3D(destPoints, sourceWidth = 1000, sourceHeight = 1000) {
    if (!destPoints || destPoints.length < 4) {
      return 'matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1)';
    }

    const H = this.getUnitSquareToQuadHomography(destPoints);

    // Ajuste de escala por el tamaño del elemento origen
    const h11 = H.a11 / sourceWidth;
    const h12 = H.a12 / sourceHeight;
    const h13 = H.a13;

    const h21 = H.a21 / sourceWidth;
    const h22 = H.a22 / sourceHeight;
    const h23 = H.a23;

    const h31 = H.a31 / sourceWidth;
    const h32 = H.a32 / sourceHeight;
    const h33 = H.a33;

    // CSS matrix3d usa orden column-major de 16 elementos:
    // [ m11, m12, m13, m14,
    //   m21, m22, m23, m24,
    //   m31, m32, m33, m34,
    //   m41, m42, m43, m44 ]
    const m11 = h11, m12 = h21, m13 = 0, m14 = h31;
    const m21 = h12, m22 = h22, m23 = 0, m24 = h32;
    const m31 = 0,   m32 = 0,   m33 = 1, m34 = 0;
    const m41 = h13, m42 = h23, m43 = 0, m44 = h33;

    return `matrix3d(${m11}, ${m12}, ${m13}, ${m14}, ${m21}, ${m22}, ${m23}, ${m24}, ${m31}, ${m32}, ${m33}, ${m34}, ${m41}, ${m42}, ${m43}, ${m44})`;
  }

  /**
   * Genera el atributo SVG polygon o CSS clip-path para polígonos de N esquinas.
   */
  static getClipPathPolygon(points, width = 1920, height = 1080) {
    const coords = points.map(([nx, ny]) => `${(nx * width).toFixed(1)}px ${(ny * height).toFixed(1)}px`);
    return `polygon(${coords.join(', ')})`;
  }

  /**
   * Genera puntos perimetrales para una elipse/círculo con rotación.
   * Retorna un array de [nx, ny] normalizados [0.0 - 1.0].
   */
  static getEllipseBoundary(cx, cy, rx, ry, rotationDeg = 0, samples = 64) {
    const rad = (rotationDeg * Math.PI) / 180;
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);
    const pts = [];

    for (let i = 0; i < samples; i++) {
      const theta = (i / samples) * 2 * Math.PI;
      const ex = rx * Math.cos(theta);
      const ey = ry * Math.sin(theta);
      // Rotar y trasladar al centro
      const nx = cx + (ex * cosR - ey * sinR);
      const ny = cy + (ex * sinR + ey * cosR);
      pts.push([Math.max(0, Math.min(1, nx)), Math.max(0, Math.min(1, ny))]);
    }
    return pts;
  }

  /**
   * Evalúa un punto a lo largo de una curva de Bézier cúbica paramétrica B(t) con t en [0, 1].
   */
  static evaluateCubicBezier(p0, c1, c2, p1, t) {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;
    const t2 = t * t;
    const t3 = t2 * t;

    const x = mt3 * p0[0] + 3 * mt2 * t * c1[0] + 3 * mt * t2 * c2[0] + t3 * p1[0];
    const y = mt3 * p0[1] + 3 * mt2 * t * c1[1] + 3 * mt * t2 * c2[1] + t3 * p1[1];
    return [x, y];
  }

  /**
   * Genera un trazado SVG Path "d" para un polígono que puede contener aristas curvas Bézier.
   */
  static getCurvedSvgPath(points, edgeCurves = {}, width = 1920, height = 1080) {
    if (!points || points.length < 3) return '';
    const n = points.length;
    const p0 = [points[0][0] * width, points[0][1] * height];
    let d = `M ${p0[0].toFixed(1)} ${p0[1].toFixed(1)}`;

    for (let i = 0; i < n; i++) {
      const nextIdx = (i + 1) % n;
      const ptA = points[i];
      const ptB = points[nextIdx];
      const pB = [ptB[0] * width, ptB[1] * height];

      const curveKey = `${i}-${nextIdx}`;
      const altKey = `${i}`;
      const curve = edgeCurves[curveKey] || edgeCurves[altKey];

      if (curve && curve.c1 && curve.c2) {
        const c1 = [curve.c1[0] * width, curve.c1[1] * height];
        const c2 = [curve.c2[0] * width, curve.c2[1] * height];
        d += ` C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${pB[0].toFixed(1)} ${pB[1].toFixed(1)}`;
      } else {
        d += ` L ${pB[0].toFixed(1)} ${pB[1].toFixed(1)}`;
      }
    }
    d += ' Z';
    return d;
  }

  /**
   * Genera un trazado SVG Path "d" abierto (sin cerrar con 'Z') para borradores interactivos (>= 2 puntos).
   */
  static getOpenCurvedSvgPath(points, edgeCurves = {}, width = 1920, height = 1080) {
    if (!points || points.length < 2) return '';
    const p0 = [points[0][0] * width, points[0][1] * height];
    let d = `M ${p0[0].toFixed(1)} ${p0[1].toFixed(1)}`;

    for (let i = 0; i < points.length - 1; i++) {
      const nextIdx = i + 1;
      const ptB = points[nextIdx];
      const pB = [ptB[0] * width, ptB[1] * height];

      const curveKey = `${i}-${nextIdx}`;
      const altKey = `${i}`;
      const curve = edgeCurves[curveKey] || edgeCurves[altKey];

      if (curve && curve.c1 && curve.c2) {
        const c1 = [curve.c1[0] * width, curve.c1[1] * height];
        const c2 = [curve.c2[0] * width, curve.c2[1] * height];
        d += ` C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${pB[0].toFixed(1)} ${pB[1].toFixed(1)}`;
      } else {
        d += ` L ${pB[0].toFixed(1)} ${pB[1].toFixed(1)}`;
      }
    }
    return d;
  }

  /**
   * Discretiza las aristas curvas Bézier a una secuencia densa de puntos normalizados
   * para que OpenCV (video_exporter) y el raycaster los procesen con 0% de distorsión.
   */
  static getSampledCurvedPolygon(points, edgeCurves = {}, samplesPerEdge = 24) {
    if (!points || points.length < 3) return points || [];
    const n = points.length;
    const result = [];

    for (let i = 0; i < n; i++) {
      const nextIdx = (i + 1) % n;
      const ptA = points[i];
      const ptB = points[nextIdx];
      const curveKey = `${i}-${nextIdx}`;
      const altKey = `${i}`;
      const curve = edgeCurves[curveKey] || edgeCurves[altKey];

      if (curve && curve.c1 && curve.c2) {
        for (let s = 0; s < samplesPerEdge; s++) {
          const t = s / samplesPerEdge;
          result.push(this.evaluateCubicBezier(ptA, curve.c1, curve.c2, ptB, t));
        }
      } else {
        result.push([ptA[0], ptA[1]]);
      }
    }
    return result;
  }

  /**
   * Subdivide una curva Bézier cúbica en dos mitades a t=0.5 usando el algoritmo de De Casteljau.
   * Permite insertar nuevos vértices en bordes curvados con 0% de deformación.
   */
  static splitCubicBezier(p0, c1, c2, p1, t = 0.5) {
    const mt = 1 - t;

    // Nivel 1
    const p01 = [mt * p0[0] + t * c1[0], mt * p0[1] + t * c1[1]];
    const p12 = [mt * c1[0] + t * c2[0], mt * c1[1] + t * c2[1]];
    const p23 = [mt * c2[0] + t * p1[0], mt * c2[1] + t * p1[1]];

    // Nivel 2
    const p012 = [mt * p01[0] + t * p12[0], mt * p01[1] + t * p12[1]];
    const p123 = [mt * p12[0] + t * p23[0], mt * p12[1] + t * p23[1]];

    // Punto medio exacto sobre la curva
    const pMid = [mt * p012[0] + t * p123[0], mt * p012[1] + t * p123[1]];

    return {
      pMid,
      left: {
        c1: p01,
        c2: p012
      },
      right: {
        c1: p123,
        c2: p23
      }
    };
  }
}

window.MathWarp = MathWarp;
