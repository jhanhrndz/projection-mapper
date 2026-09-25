/**
 * sync.js - Capa de comunicación en tiempo real entre la Ventana de Control y el Proyector.
 * Utiliza BroadcastChannel para latencia instantánea (0 ms) en el mismo navegador/sistema.
 */

class MappingSync {
  constructor(role = 'control') {
    this.role = role; // 'control' o 'projector'
    this.channel = new BroadcastChannel('projection_mapper_channel');
    this.listeners = new Map();

    this.channel.onmessage = (event) => {
      const { type, payload } = event.data;
      if (this.listeners.has(type)) {
        this.listeners.get(type).forEach(callback => callback(payload));
      }
    };
  }

  /**
   * Suscribe un callback a un tipo de mensaje.
   */
  on(type, callback) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(callback);
  }

  /**
   * Envía un mensaje a través del canal de sincronización.
   */
  send(type, payload = {}) {
    try {
      this.channel.postMessage({ type, payload, sender: this.role, timestamp: Date.now() });
    } catch (e) {
      console.error('[Sync] Error enviando mensaje:', e);
    }
  }

  /**
   * Solicita el estado completo (usado por la ventana del proyector al arrancar).
   */
  requestSync() {
    this.send('REQUEST_SYNC', {});
  }

  /**
   * Envía el estado completo de la escena.
   */
  broadcastFullState(sceneData) {
    this.send('SYNC_FULL_STATE', sceneData);
  }

  /**
   * Envía la actualización de un solo polígono.
   */
  broadcastPolygonUpdate(polygon) {
    this.send('POLYGON_UPDATE', polygon);
  }

  /**
   * Notifica eliminación de polígono.
   */
  broadcastPolygonDelete(polygonId) {
    this.send('POLYGON_DELETE', { id: polygonId });
  }

  /**
   * Notifica cambio de modo de visualización (calibración vs presentación).
   */
  broadcastDisplayMode(mode) {
    this.send('DISPLAY_MODE', { mode });
  }

  /**
   * Notifica cambio de selección activa.
   */
  broadcastSelection(polygonId) {
    this.send('SELECTION_CHANGE', { id: polygonId });
  }

  /**
   * Notifica una acción de video (play, pause, seek, loop, rate).
   */
  broadcastVideoAction(polyId, action, value = null) {
    this.send('VIDEO_ACTION', { polyId, action, value });
  }

  /**
   * Notifica el trazado en vivo durante el dibujo de una nueva superficie (soporta curvas Bézier y modos).
   */
  broadcastDraftUpdate(points, pointer = null, curves = null, mode = 'straight') {
    this.send('DRAFT_UPDATE', { points, pointer, curves, mode, active: true });
  }

  /**
   * Limpia el trazado en vivo de dibujo en el proyector.
   */
  broadcastDraftClear() {
    this.send('DRAFT_CLEAR', {});
  }

  /**
   * Notifica el inicio, progreso o fin de una exportación para pausar/reanudar el proyector.
   */
  broadcastExportState(isRunning, progress = 0, message = '') {
    this.send('EXPORT_STATE', { isRunning, progress, message });
  }
}

// Exportar globalmente
window.MappingSync = MappingSync;
