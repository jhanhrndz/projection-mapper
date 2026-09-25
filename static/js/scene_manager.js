/**
 * scene_manager.js - Gestor visual de escenas, proyectos y persistencia profesional.
 * Incluye modal oscuro con buscador en tiempo real, miniaturas vectoriales SVG de las superficies,
 * guardado rápido (Ctrl+S) con notificaciones toast, clonación, eliminación e importación/exportación.
 */

class SceneManager {
  constructor(scene, uiController, sync) {
    this.scene = scene;
    this.ui = uiController;
    if (this.ui) this.ui.sceneManager = this;
    this.sync = sync;

    this.scenesList = [];
    this.searchQuery = '';

    this.initDOM();
    this.bindShortcuts();
  }

  initDOM() {
    // 1. Contenedor del Modal de Escenas
    const modalHTML = `
      <div id="scene-modal-overlay" class="modal-overlay hidden">
        <div class="modal-card" style="max-width: 860px;">
          <div class="modal-header">
            <div class="modal-title-group">
              <span class="modal-icon" style="display: flex; align-items: center; color: var(--accent-cyan);">${Icons.get('folder-open', { size: 22 })}</span>
              <div>
                <h3>Gestor de Escenas y Proyectos</h3>
                <p>Carga, organiza o exporta tus configuraciones de mapping</p>
              </div>
            </div>
            <button id="btn-close-scene-modal" class="modal-close-btn" title="Cerrar (Esc)">&times;</button>
          </div>

          <!-- Barra de búsqueda y acciones rápidas -->
          <div class="modal-toolbar">
            <div class="search-box">
              <span class="search-icon" style="display: flex; align-items: center;">${Icons.get('search', { size: 14 })}</span>
              <input type="text" id="scene-search-input" placeholder="Buscar escena por nombre..." autocomplete="off" />
            </div>
            <div class="modal-actions-right">
              <button id="btn-modal-new-scene" class="secondary-btn">${Icons.get('plus', { size: 13 })} Nueva Escena</button>
              <label for="import-scene-file" class="secondary-btn file-label" title="Cargar paquete autónomo (.pmap) o escena (.json) desde tu equipo">
                ${Icons.get('upload', { size: 13 })} Importar (.pmap / .json)
              </label>
              <input type="file" id="import-scene-file" accept=".pmap,.json" style="display: none;" />
            </div>
          </div>

          <!-- Rejilla de tarjetas de escenas -->
          <div class="modal-body">
            <div id="scenes-grid" class="scenes-grid">
              <!-- Renderizado dinámico -->
            </div>
          </div>

          <div class="modal-footer">
            <span id="scene-count-text">0 escenas guardadas</span>
            <button id="btn-modal-save-as" class="primary-btn">${Icons.get('save', { size: 14 })} Guardar Escena Actual Como...</button>
          </div>
        </div>
      </div>

      <!-- Diálogo para "Guardar Como..." -->
      <div id="save-as-modal" class="modal-overlay hidden" style="z-index: 10001;">
        <div class="modal-card modal-card-sm">
          <div class="modal-header">
            <h3>Guardar Escena</h3>
            <button id="btn-close-save-as" class="modal-close-btn">&times;</button>
          </div>
          <div class="modal-body" style="padding: 16px 20px;">
            <label style="display:block; margin-bottom:8px; font-size:12px; color:#94a3b8;">Nombre de la Escena:</label>
            <input type="text" id="save-as-name-input" class="prop-input" style="font-size:14px; padding:8px 12px;" />
          </div>
          <div class="modal-footer">
            <button id="btn-cancel-save-as" class="secondary-btn">Cancelar</button>
            <button id="btn-confirm-save-as" class="primary-btn">Guardar Escena</button>
          </div>
        </div>
      </div>

      <!-- Contenedor de notificaciones Toast -->
      <div id="toast-container" class="toast-container"></div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    this.overlay = document.getElementById('scene-modal-overlay');
    this.searchInput = document.getElementById('scene-search-input');
    this.grid = document.getElementById('scenes-grid');
    this.countText = document.getElementById('scene-count-text');
    this.toastContainer = document.getElementById('toast-container');

    this.saveAsModal = document.getElementById('save-as-modal');
    this.saveAsInput = document.getElementById('save-as-name-input');

    this.bindModalEvents();
  }

  bindModalEvents() {
    // Abrir modal desde el botón Cargar o menú
    document.getElementById('btn-load-scene')?.addEventListener('click', () => {
      this.openModal();
    });
    document.getElementById('btn-menu-load-scene')?.addEventListener('click', () => {
      this.openModal();
    });

    // Guardar rápido con el botón Guardar
    document.getElementById('btn-save-scene')?.addEventListener('click', () => {
      this.quickSave();
    });

    // Cerrar modales
    document.getElementById('btn-close-scene-modal').addEventListener('click', () => this.closeModal());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.closeModal();
    });

    // Cerrar Save As
    document.getElementById('btn-close-save-as').addEventListener('click', () => this.closeSaveAs());
    document.getElementById('btn-cancel-save-as').addEventListener('click', () => this.closeSaveAs());
    this.saveAsModal.addEventListener('click', (e) => {
      if (e.target === this.saveAsModal) this.closeSaveAs();
    });

    // Guardar Como desde el modal
    document.getElementById('btn-modal-save-as').addEventListener('click', () => {
      this.openSaveAs();
    });

    document.getElementById('btn-confirm-save-as').addEventListener('click', () => {
      this.executeSaveAs();
    });

    // Nueva Escena limpia
    document.getElementById('btn-modal-new-scene').addEventListener('click', () => {
      if (confirm('¿Deseas iniciar una nueva escena en blanco? Se descartarán los cambios no guardados.')) {
        try { localStorage.removeItem('projection_mapper_autosave'); } catch (e) {}
        this.scene.name = 'Nueva_Escena';
        this.scene.polygons = [];
        this.scene.selectedId = null;
        this.scene.saveStateToHistory();
        this.sync.broadcastFullState(this.scene.toJSON());
        this.ui.refreshAll();
        this.closeModal();
        this.showToast('Nueva escena en blanco creada', 'info');
      }
    });

    // Búsqueda en vivo
    this.searchInput.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      this.renderScenesGrid();
    });

    // Importar Proyecto (.pmap / .json)
    document.getElementById('import-scene-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await this.importProject(file);
      e.target.value = '';
    });
  }

  bindShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Ctrl+S o Cmd+S para Guardado Rápido
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (e.shiftKey) {
          this.openSaveAs();
        } else {
          this.quickSave();
        }
      }
      // Ctrl+O para abrir el gestor de escenas
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        this.openModal();
      }
      // Esc para cerrar modal
      if (e.key === 'Escape') {
        if (!this.saveAsModal.classList.contains('hidden')) {
          this.closeSaveAs();
        } else if (!this.overlay.classList.contains('hidden')) {
          this.closeModal();
        }
      }
    });
  }

  async openModal() {
    this.overlay.classList.remove('hidden');
    this.searchInput.value = '';
    this.searchQuery = '';
    this.searchInput.focus();
    await this.fetchScenes();
  }

  closeModal() {
    this.overlay.classList.add('hidden');
  }

  openSaveAs() {
    this.saveAsInput.value = this.scene.name || 'mi_escena';
    this.saveAsModal.classList.remove('hidden');
    this.saveAsInput.focus();
    this.saveAsInput.select();
  }

  closeSaveAs() {
    this.saveAsModal.classList.add('hidden');
  }

  async fetchScenes() {
    try {
      const res = await fetch('/api/scenes');
      if (res.ok) {
        this.scenesList = await res.json();
        this.renderScenesGrid();
      }
    } catch (e) {
      console.error('[SceneManager] Error cargando lista de escenas:', e);
    }
  }

  renderScenesGrid() {
    const filtered = this.scenesList.filter(s => s.name.toLowerCase().includes(this.searchQuery));
    this.countText.textContent = `${filtered.length} escena(s) disponible(s)`;

    if (filtered.length === 0) {
      this.grid.innerHTML = `
        <div class="empty-scenes">
          <div style="display:flex; justify-content:center; margin-bottom: 8px; color: var(--text-muted);">${Icons.get('search', { size: 36 })}</div>
          <p>No se encontraron escenas con el nombre "${this.searchQuery}".</p>
        </div>
      `;
      return;
    }

    let html = '';
    filtered.forEach(item => {
      const dateStr = this.formatDate(item.modified);
      const isCurrent = this.scene.name === item.name;
      const svgThumb = this.generateThumbnailSVG(item.preview_polygons || []);

      html += `
        <div class="scene-card ${isCurrent ? 'current' : ''}">
          <div class="scene-thumb-container">
            ${svgThumb}
            ${isCurrent ? '<span class="current-badge">ACTIVA</span>' : ''}
          </div>

          <div class="scene-info">
            <h4 class="scene-title" title="${item.name}">${item.name}</h4>
            <div class="scene-meta">
              <span>${Icons.get('clock', { size: 12 })} ${dateStr}</span>
              <span>${Icons.get('layers', { size: 12 })} ${item.surface_count || 0} superficies (${item.quad_count || 0} quads)</span>
            </div>
          </div>

          <div class="scene-card-actions">
            <button class="primary-btn btn-load-item" data-name="${item.name}">
              ${Icons.get('check', { size: 13 })} Cargar Escena
            </button>
            <div class="scene-sub-actions">
              <button class="action-icon-btn btn-dup-item" title="Duplicar escena" data-name="${item.name}">${Icons.get('copy', { size: 13 })}</button>
              <button class="action-icon-btn btn-export-pmap-item" title="Exportar paquete completo .pmap con videos e imágenes para otra PC" data-name="${item.name}">${Icons.get('package', { size: 13 })}</button>
              <button class="action-icon-btn btn-export-item" title="Descargar archivo JSON ligero a PC" data-name="${item.name}">${Icons.get('file-code', { size: 13 })}</button>
              <button class="action-icon-btn btn-del-item danger" title="Eliminar escena" data-name="${item.name}">${Icons.get('trash-2', { size: 13 })}</button>
            </div>
          </div>
        </div>
      `;
    });

    this.grid.innerHTML = html;
    this.bindCardEvents();
  }

  bindCardEvents() {
    // Cargar
    this.grid.querySelectorAll('.btn-load-item').forEach(btn => {
      btn.addEventListener('click', () => this.loadScene(btn.dataset.name));
    });

    // Duplicar
    this.grid.querySelectorAll('.btn-dup-item').forEach(btn => {
      btn.addEventListener('click', () => this.duplicateScene(btn.dataset.name));
    });

    // Exportar Paquete .pmap
    this.grid.querySelectorAll('.btn-export-pmap-item').forEach(btn => {
      btn.addEventListener('click', () => this.exportPmap(btn.dataset.name));
    });

    // Exportar JSON
    this.grid.querySelectorAll('.btn-export-item').forEach(btn => {
      btn.addEventListener('click', () => this.exportScene(btn.dataset.name));
    });

    // Eliminar
    this.grid.querySelectorAll('.btn-del-item').forEach(btn => {
      btn.addEventListener('click', () => this.deleteScene(btn.dataset.name));
    });
  }

  generateThumbnailSVG(polygons) {
    if (!polygons || polygons.length === 0) {
      return `
        <svg viewBox="0 0 160 90" class="thumb-svg">
          <rect width="160" height="90" fill="#0c1017"/>
          <text x="80" y="50" fill="#334155" font-size="10" text-anchor="middle">Sin Superficies</text>
        </svg>
      `;
    }

    let shapes = '';
    polygons.forEach(p => {
      if (!p.points || p.points.length < 3) return;
      const pts = p.points.map(([nx, ny]) => `${(nx * 160).toFixed(1)},${(ny * 90).toFixed(1)}`).join(' ');
      const isOccluder = p.type === 'occluder';
      const fill = isOccluder ? '#000000' : (p.color || '#00f0ff');
      const stroke = isOccluder ? '#ffffff' : (p.color || '#00f0ff');
      shapes += `
        <polygon points="${pts}" fill="${fill}" fill-opacity="0.4" stroke="${stroke}" stroke-width="1.2" />
      `;
    });

    return `
      <svg viewBox="0 0 160 90" class="thumb-svg">
        <rect width="160" height="90" fill="#07090e" stroke="#1e293b" stroke-width="1"/>
        ${shapes}
      </svg>
    `;
  }

  async loadScene(name) {
    try {
      const res = await fetch(`/api/scenes/${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error('No se pudo cargar la escena');
      const data = await res.json();

      this.scene.fromJSON(data);
      this.sync.broadcastFullState(this.scene.toJSON());
      this.ui.refreshAll();
      this.closeModal();
      this.showToast(`Escena "${name}" cargada con éxito`, 'success');
    } catch (e) {
      alert('Error cargando escena: ' + e.message);
    }
  }

  async quickSave() {
    if (!this.scene.name || this.scene.name === 'Nueva Escena' || this.scene.name === 'Nueva_Escena') {
      this.openSaveAs();
      return;
    }

    try {
      const res = await fetch('/api/scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.scene.toJSON())
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(`Escena "${this.scene.name}" guardada`, 'success');
      } else {
        throw new Error(data.error || 'Error desconocido');
      }
    } catch (e) {
      console.error(e);
      this.showToast('Error al guardar: ' + e.message, 'error');
    }
  }

  async executeSaveAs() {
    const rawName = this.saveAsInput.value.trim();
    if (!rawName) return;

    this.scene.name = rawName;
    try {
      const res = await fetch('/api/scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.scene.toJSON())
      });
      const data = await res.json();
      if (data.success) {
        this.closeSaveAs();
        if (!this.overlay.classList.contains('hidden')) {
          await this.fetchScenes();
        }
        this.showToast(`Escena guardada como "${data.name}"`, 'success');
        this.ui.refreshAll();
      } else {
        throw new Error(data.error);
      }
    } catch (e) {
      alert('Error guardando: ' + e.message);
    }
  }

  async duplicateScene(name) {
    try {
      const res = await fetch(`/api/scenes/${encodeURIComponent(name)}/duplicate`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        this.showToast(`Copia creada: "${data.new_name}"`, 'info');
        await this.fetchScenes();
      }
    } catch (e) {
      alert('Error duplicando escena: ' + e.message);
    }
  }

  async deleteScene(name) {
    if (!confirm(`¿Estás seguro de que deseas eliminar permanentemente la escena "${name}"?`)) return;

    try {
      const res = await fetch(`/api/scenes/${encodeURIComponent(name)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        this.showToast(`Escena "${name}" eliminada`, 'info');
        await this.fetchScenes();
      }
    } catch (e) {
      alert('Error eliminando escena: ' + e.message);
    }
  }

  async exportPmap(name) {
    try {
      this.showToast(`Generando paquete .pmap para "${name}"...`, 'info');
      const res = await fetch(`/api/project/export?name=${encodeURIComponent(name)}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}.pmap`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast(`Paquete "${name}.pmap" descargado con éxito`, 'success');
    } catch (e) {
      alert('Error exportando paquete .pmap: ' + e.message);
    }
  }

  async exportScene(name) {
    try {
      const res = await fetch(`/api/scenes/${encodeURIComponent(name)}`);
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast(`Archivo "${name}.json" descargado`, 'info');
    } catch (e) {
      alert('Error exportando: ' + e.message);
    }
  }

  async importProject(file) {
    try {
      this.showToast(`Importando "${file.name}"...`, 'info');
      const res = await fetch('/api/project/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Filename': encodeURIComponent(file.name)
        },
        body: file
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      this.scene.fromJSON(data.scene);
      this.sync.broadcastFullState(this.scene.toJSON());
      this.ui.refreshAll();
      await this.fetchScenes();
      this.closeModal();
      const msg = data.message || `Proyecto "${data.name}" importado exitosamente`;
      this.showToast(msg, 'success');
    } catch (err) {
      alert('Error importando archivo: ' + err.message);
    }
  }

  showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? Icons.get('check-circle', { size: 16 }) : (type === 'error' ? Icons.get('alert-triangle', { size: 16 }) : Icons.get('info', { size: 16 }));
    toast.innerHTML = `<span style="display:flex; align-items:center;">${icon}</span><span>${message}</span>`;
    this.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }

  formatDate(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffMin = Math.floor((now - date) / 60000);

    if (diffMin < 1) return 'Hace un momento';
    if (diffMin < 60) return `Hace ${diffMin} min`;
    return date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
}

window.SceneManager = SceneManager;
