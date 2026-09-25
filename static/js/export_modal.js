/**
 * export_modal.js - Diálogo modal interactivo para exportar la escena de mapping
 * como video pre-mapeado (.mp4 H.264) listo para reproducirse de forma autónoma.
 */

class ExportModal {
  constructor(scene, sync = null) {
    this.scene = scene;
    this.sync = sync;
    this.pollInterval = null;
    this.initDOM();
  }

  initDOM() {
    // Si ya existe en el DOM, no duplicar
    if (document.getElementById('export-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'export-modal';
    modal.className = 'modal-overlay';
    modal.style.display = 'none';

    modal.innerHTML = `
      <div class="modal-container export-modal-container">
        <div class="modal-header">
          <div class="modal-title-group">
            <h3 style="display: flex; align-items: center; gap: 8px;">
              <span style="display: flex; align-items: center; color: var(--accent-cyan);">${Icons.get('film', { size: 20 })}</span>
              Exportar Video Pre-mapeado (.mp4)
            </h3>
            <span class="modal-subtitle">Genera un video autónomo para reproducir desde USB o cualquier dispositivo sin laptop</span>
          </div>
          <button id="btn-close-export-modal" class="modal-close-btn" title="Cerrar">&times;</button>
        </div>

        <div class="modal-body export-modal-body">
          <!-- Insignia de Aceleración por Hardware GPU / CPU -->
          <div id="export-encoder-badge" class="export-encoder-badge">
            <span class="badge-pulse-dot"></span>
            <span id="export-encoder-txt">Detectando aceleración de hardware (GPU/CPU)...</span>
          </div>

          <!-- Resumen de Escena Activa -->
          <div class="export-scene-summary" id="export-scene-summary">
            <!-- Dinámico -->
          </div>

          <!-- Formulario de Configuración -->
          <div class="export-config-grid">
            <div class="export-field-group">
              <label>Resolución de Salida:</label>
              <select id="export-res-select" class="prop-select">
                <option value="1920x1080" selected>1920 x 1080 (Full HD · Estándar Proyector)</option>
                <option value="3840x2160">3840 x 2160 (4K Ultra HD · Máxima Nitidez)</option>
                <option value="1280x720">1280 x 720 (720p HD · Render Rápido)</option>
              </select>
            </div>

            <div class="export-field-group">
              <label>Tasa de Cuadros (FPS):</label>
              <select id="export-fps-select" class="prop-select">
                <option value="30" selected>30 FPS (Fluido y Eficiente)</option>
                <option value="60">60 FPS (Ultra-suave para Motion Graphics)</option>
              </select>
            </div>

            <div class="export-field-group" style="grid-column: span 2;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <label style="margin: 0;">Duración del Bucle (segundos):</label>
                <button id="btn-detect-duration" class="secondary-btn" style="padding: 3px 8px; font-size: 10px; display: inline-flex; align-items: center; gap: 4px;" title="Calcular automáticamente según el video más largo de la escena">
                  ${Icons.get('clock', { size: 12 })} Auto-detectar Duración
                </button>
              </div>
              <input type="number" id="export-duration-input" min="1" max="600" step="0.5" value="10.0" class="prop-input" />
              <small style="color: var(--text-muted); font-size: 11px; margin-top: 4px; display: block;">
                El video se compondrá en bucle continuo cerrado (seamless loop) para repetirse infinitamente.
              </small>
            </div>
          </div>

          <!-- Panel de Progreso del Renderizado -->
          <div id="export-progress-panel" class="export-progress-panel" style="display: none;">
            <div class="export-progress-header">
              <span id="export-status-label" class="export-status-label">Preparando renderizado...</span>
              <span id="export-progress-pct" class="export-progress-pct">0.0%</span>
            </div>
            
            <div class="export-progress-bar-track">
              <div id="export-progress-bar-fill" class="export-progress-bar-fill" style="width: 0%;"></div>
            </div>

            <div class="export-progress-footer">
              <span id="export-frame-counter" class="export-stat-txt">Cuadro 0 / 0</span>
              <span id="export-eta-counter" class="export-stat-txt">Calculando tiempo restante...</span>
            </div>
          </div>

          <!-- Resultado y Descarga -->
          <div id="export-result-panel" class="export-result-panel" style="display: none;">
            <div class="export-success-badge">
              <span class="badge-icon" style="display: flex; align-items: center; color: #00ff88;">${Icons.get('check-circle', { size: 20 })}</span>
              <div>
                <strong style="color: #00ff88;">¡Video Renderizado con Éxito!</strong>
                <div id="export-file-details" style="font-size: 11px; color: var(--text-muted); margin-top: 2px;"></div>
              </div>
            </div>
            <a id="btn-download-video" href="#" download class="download-video-btn" style="display: inline-flex; align-items: center; justify-content: center; gap: 6px;">
              ${Icons.get('download', { size: 14 })} Descargar Video Mapeado (.mp4)
            </a>
          </div>

          <!-- Error -->
          <div id="export-error-panel" class="export-error-panel" style="display: none;">
            <span id="export-error-msg" style="color: var(--accent-rose); font-size: 12px;"></span>
          </div>
        </div>

        <div class="modal-footer export-modal-footer">
          <button id="btn-cancel-render" class="danger-btn" style="display: none; align-items: center; gap: 6px;">${Icons.get('x', { size: 13 })} Cancelar Render</button>
          <button id="btn-close-export-bottom" class="secondary-btn">Cerrar</button>
          <button id="btn-start-export" class="tool-btn accent-btn" style="padding: 8px 18px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">
            ${Icons.get('rocket', { size: 14 })} Iniciar Renderizado
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    this.modal = modal;
    this.bindEvents();
  }

  bindEvents() {
    // Cerrar modal
    const closeBtn = document.getElementById('btn-close-export-modal');
    const closeBottom = document.getElementById('btn-close-export-bottom');
    const overlay = this.modal;

    const closeModal = () => {
      this.close();
    };

    closeBtn.addEventListener('click', closeModal);
    closeBottom.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    // Auto-detectar duración
    document.getElementById('btn-detect-duration').addEventListener('click', () => {
      this.detectAndFillDuration();
    });

    // Iniciar renderizado
    document.getElementById('btn-start-export').addEventListener('click', () => {
      this.startExport();
    });

    // Cancelar renderizado
    document.getElementById('btn-cancel-render').addEventListener('click', () => {
      this.cancelExport();
    });
  }

  open() {
    this.updateSummary();
    this.modal.style.display = 'flex';
    document.body.classList.add('modal-open');

    // Revisar si ya hay un render en curso en el servidor
    this.checkCurrentServerStatus();
  }

  close() {
    this.modal.style.display = 'none';
    document.body.classList.remove('modal-open');
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  updateSummary() {
    const summaryContainer = document.getElementById('export-scene-summary');
    const polys = this.scene.polygons || [];
    let videoCount = 0;
    let imageCount = 0;
    let occluderCount = 0;

    polys.forEach(p => {
      if (p.type === 'occluder') occluderCount++;
      else if (p.media && p.media.type === 'video' && p.media.src) videoCount++;
      else if (p.media && p.media.type === 'image' && p.media.src) imageCount++;
    });

    summaryContainer.innerHTML = `
      <div class="summary-badge-item">
        <span class="sum-num">${polys.length}</span>
        <span class="sum-lbl">Superficies</span>
      </div>
      <div class="summary-badge-item">
        <span class="sum-num" style="color: #00f0ff;">${videoCount}</span>
        <span class="sum-lbl">Videos Mapeados</span>
      </div>
      <div class="summary-badge-item">
        <span class="sum-num" style="color: #ff0055;">${imageCount}</span>
        <span class="sum-lbl">Imágenes</span>
      </div>
      <div class="summary-badge-item">
        <span class="sum-num" style="color: #aaaaaa;">${occluderCount}</span>
        <span class="sum-lbl">Máscaras</span>
      </div>
    `;

    // Si hay videos, auto-detectar duración por defecto
    if (videoCount > 0) {
      this.detectAndFillDuration();
    }
  }

  detectAndFillDuration() {
    let maxDur = 0.0;
    const polys = this.scene.polygons || [];

    // Buscar la duración máxima reportada por los elementos de video cargados en el DOM
    polys.forEach(p => {
      if (p.media && p.media.type === 'video' && p.media.src) {
        // Consultar el elemento video si existe en memoria
        const videoEls = document.querySelectorAll(`[data-poly-id="${p.id}"] video`);
        videoEls.forEach(v => {
          if (v.duration && !isNaN(v.duration) && v.duration > maxDur) {
            maxDur = v.duration;
          }
        });
      }
    });

    const durationInput = document.getElementById('export-duration-input');
    if (maxDur > 0.5) {
      durationInput.value = (Math.round(maxDur * 10) / 10).toFixed(1);
    } else {
      durationInput.value = '10.0';
    }
  }

  async startExport() {
    const resValue = document.getElementById('export-res-select').value;
    const [wStr, hStr] = resValue.split('x');
    const width = parseInt(wStr, 10);
    const height = parseInt(hStr, 10);
    const fps = parseInt(document.getElementById('export-fps-select').value, 10);
    const duration = parseFloat(document.getElementById('export-duration-input').value) || 10.0;

    const payload = {
      scene: this.scene.toJSON(),
      options: {
        width,
        height,
        fps,
        duration
      }
    };

    // UI state
    document.getElementById('btn-start-export').disabled = true;
    document.getElementById('btn-start-export').style.display = 'none';
    document.getElementById('btn-cancel-render').style.display = 'inline-flex';
    document.getElementById('export-progress-panel').style.display = 'block';
    document.getElementById('export-result-panel').style.display = 'none';
    document.getElementById('export-error-panel').style.display = 'none';

    document.getElementById('export-status-label').textContent = 'Iniciando renderizado en segundo plano...';
    document.getElementById('export-progress-pct').textContent = '0.0%';
    document.getElementById('export-progress-bar-fill').style.width = '0%';

    try {
      const res = await fetch('/api/export/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Error al iniciar la exportación');
      }

      // Notificar al proyector para pausar reproducción y liberar GPU
      if (this.sync) {
        this.sync.broadcastExportState(true, 0, 'Iniciando renderizado con aceleración por hardware...');
      }

      // Iniciar sondeo continuo de progreso
      this.startPolling();
    } catch (err) {
      if (this.sync) {
        this.sync.broadcastExportState(false, 0);
      }
      this.showError(err.message);
      document.getElementById('btn-start-export').disabled = false;
      document.getElementById('btn-start-export').style.display = 'inline-flex';
      document.getElementById('btn-cancel-render').style.display = 'none';
      document.getElementById('export-progress-panel').style.display = 'none';
    }
  }

  async cancelExport() {
    try {
      await fetch('/api/export/cancel', { method: 'POST' });
    } catch (e) {
      console.warn('Error cancelando render:', e);
    }
    if (this.sync) {
      this.sync.broadcastExportState(false, 0);
    }
  }

  startPolling() {
    if (this.pollInterval) clearInterval(this.pollInterval);

    this.pollInterval = setInterval(async () => {
      try {
        const res = await fetch('/api/export/status');
        if (!res.ok) return;
        const st = await res.json();
        this.updateProgressUI(st);

        // Notificar al proyector del avance en vivo
        if (this.sync && st.status === 'rendering') {
          const encLabel = st.encoder_label || (st.is_gpu ? 'GPU' : 'CPU');
          this.sync.broadcastExportState(true, st.progress, `Renderizando video (${encLabel}): ${Math.round(st.progress)}%`);
        }

        if (st.status === 'completed') {
          clearInterval(this.pollInterval);
          this.pollInterval = null;
          if (this.sync) this.sync.broadcastExportState(false, 100);
          this.showSuccess(st);
        } else if (st.status === 'error') {
          clearInterval(this.pollInterval);
          this.pollInterval = null;
          if (this.sync) this.sync.broadcastExportState(false, 0);
          this.showError(st.error || 'Ocurrió un error en el renderizado.');
        } else if (st.status === 'cancelled') {
          clearInterval(this.pollInterval);
          this.pollInterval = null;
          if (this.sync) this.sync.broadcastExportState(false, 0);
          this.showCancelled();
        }
      } catch (err) {
        console.warn('Error sondeando exportación:', err);
      }
    }, 350);
  }

  updateProgressUI(st) {
    const pct = Math.max(0, Math.min(100, st.progress));
    document.getElementById('export-progress-bar-fill').style.width = `${pct}%`;
    document.getElementById('export-progress-pct').textContent = `${pct.toFixed(1)}%`;
    const encText = st.encoder_label ? ` [${st.encoder_label}]` : '';
    document.getElementById('export-status-label').textContent = `Renderizando fotogramas a ${st.fps || 30} FPS${encText}...`;
    document.getElementById('export-frame-counter').textContent = `Cuadro ${st.current_frame} de ${st.total_frames}`;

    if (st.eta_seconds > 0) {
      document.getElementById('export-eta-counter').textContent = `Tiempo restante: ~${st.eta_seconds}s`;
    } else {
      document.getElementById('export-eta-counter').textContent = 'Finalizando codificación...';
    }

    this.renderEncoderBadge(st);
  }

  renderEncoderBadge(st) {
    const badge = document.getElementById('export-encoder-badge');
    const txt = document.getElementById('export-encoder-txt');
    if (!badge || !txt || !st.encoder_label) return;

    if (st.is_gpu) {
      badge.className = 'export-encoder-badge gpu-active';
      txt.innerHTML = `<span style="display:inline-flex; align-items:center; color: var(--accent-cyan); margin-right: 4px;">${Icons.get('zap', { size: 14 })}</span><strong>Aceleración por Hardware Activa:</strong> ${st.encoder_label}`;
    } else {
      badge.className = 'export-encoder-badge cpu-active';
      txt.innerHTML = `<span style="display:inline-flex; align-items:center; color: var(--text-muted); margin-right: 4px;">${Icons.get('cpu', { size: 14 })}</span><strong>Modo Universal:</strong> ${st.encoder_label}`;
    }
  }

  showSuccess(st) {
    document.getElementById('export-progress-panel').style.display = 'none';
    document.getElementById('btn-cancel-render').style.display = 'none';
    document.getElementById('btn-start-export').style.display = 'inline-flex';
    document.getElementById('btn-start-export').disabled = false;
    document.getElementById('btn-start-export').innerHTML = `${Icons.get('refresh-cw', { size: 14 })} Renderizar Nuevamente`;

    const resultPanel = document.getElementById('export-result-panel');
    resultPanel.style.display = 'block';

    const details = document.getElementById('export-file-details');
    details.textContent = `Archivo: ${st.output_filename} · ${st.total_frames} cuadros · ${st.encoder_label || 'H.264'}`;

    const downloadBtn = document.getElementById('btn-download-video');
    downloadBtn.href = st.output_url;
    downloadBtn.setAttribute('download', st.output_filename);

    this.renderEncoderBadge(st);
  }

  showError(msg) {
    document.getElementById('export-error-panel').style.display = 'block';
    document.getElementById('export-error-msg').innerHTML = `<span style="display:inline-flex; align-items:center; gap: 4px;">${Icons.get('alert-triangle', { size: 14 })} ${msg}</span>`;
    document.getElementById('export-progress-panel').style.display = 'none';
    document.getElementById('btn-cancel-render').style.display = 'none';
    document.getElementById('btn-start-export').style.display = 'inline-flex';
    document.getElementById('btn-start-export').disabled = false;
  }

  showCancelled() {
    document.getElementById('export-status-label').textContent = 'Renderizado cancelado por el usuario.';
    document.getElementById('btn-cancel-render').style.display = 'none';
    document.getElementById('btn-start-export').style.display = 'inline-flex';
    document.getElementById('btn-start-export').disabled = false;
  }

  async checkCurrentServerStatus() {
    try {
      const res = await fetch('/api/export/status');
      if (!res.ok) return;
      const st = await res.json();
      this.renderEncoderBadge(st);

      if (st.status === 'rendering') {
        document.getElementById('btn-start-export').style.display = 'none';
        document.getElementById('btn-cancel-render').style.display = 'inline-flex';
        document.getElementById('export-progress-panel').style.display = 'block';
        this.startPolling();
      } else if (st.status === 'completed' && st.output_url) {
        this.showSuccess(st);
      }
    } catch (e) {}
  }
}

window.ExportModal = ExportModal;
