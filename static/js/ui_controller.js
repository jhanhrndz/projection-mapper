/**
 * ui_controller.js - Controlador de la interfaz gráfica de la Ventana de Control (Laptop).
 * Gestiona botones, lista de capas, inspector de propiedades, diálogos de guardado y atajos.
 */

class UIController {
  constructor(scene, canvas, sync) {
    this.scene = scene;
    this.canvas = canvas;
    this.sync = sync;

    this.bindDOM();
    this.bindEvents();
    this.updateLayersList();
    this.updatePropertiesPanel();
  }

  bindDOM() {
    // Botones de herramientas principales
    this.btnToolSelect = document.getElementById('btn-tool-select');
    this.btnToolDrawStraight = document.getElementById('btn-tool-draw-straight');
    this.btnToolDrawCurved = document.getElementById('btn-tool-draw-curved');
    this.btnToolDraw = document.getElementById('btn-tool-draw');

    // Desplegables de figuras y máscaras
    this.btnDropdownSurfaces = document.getElementById('btn-dropdown-surfaces');
    this.menuSurfaces = document.getElementById('menu-surfaces');
    this.btnDropdownMasks = document.getElementById('btn-dropdown-masks');
    this.menuMasks = document.getElementById('menu-masks');

    // Opciones de superficies
    this.btnAddQuad = document.getElementById('btn-add-quad');
    this.btnAddSquare = document.getElementById('btn-add-square');
    this.btnAddCircle = document.getElementById('btn-add-circle');
    this.btnAddTriangle = document.getElementById('btn-add-triangle');
    this.btnAddPentagon = document.getElementById('btn-add-pentagon');
    this.btnAddHexagon = document.getElementById('btn-add-hexagon');

    // Opciones de máscaras
    this.btnAddOccluder = document.getElementById('btn-add-occluder');
    this.btnAddMaskSquare = document.getElementById('btn-add-mask-square');
    this.btnAddCircleOccluder = document.getElementById('btn-add-circle-occluder');
    this.btnAddMaskTriangle = document.getElementById('btn-add-mask-triangle');

    // Botones de control de sesión
    this.btnOpenProjector = document.getElementById('btn-open-projector');
    this.btnToggleMode = document.getElementById('btn-toggle-mode');
    this.btnUndo = document.getElementById('btn-undo');
    this.btnRedo = document.getElementById('btn-redo');
    this.btnSave = document.getElementById('btn-save-scene');
    this.btnLoad = document.getElementById('btn-load-scene');
    this.btnLockAll = document.getElementById('btn-lock-all');
    this.layerCount = document.getElementById('layer-count');

    // Paneles laterales
    this.layersContainer = document.getElementById('layers-list');
    this.propContainer = document.getElementById('properties-panel');
    this.statusIndicator = document.getElementById('sync-indicator');
    this.toolbarContextHint = document.getElementById('toolbar-context-hint');

    // Nombre de Escena Activa (Editable)
    this.topSceneNameInput = document.getElementById('top-scene-name-input');
    if (this.topSceneNameInput) {
      this.topSceneNameInput.value = this.scene.name || 'Mi_Escena_1';
    }

    // Modal de Ayuda
    this.btnHelp = document.getElementById('btn-help');
    this.btnMenuHelp = document.getElementById('btn-menu-help');
    this.modalHelp = document.getElementById('modal-help');
    this.btnCloseHelp = document.getElementById('btn-close-help');
    this.btnCloseHelpFooter = document.getElementById('btn-close-help-footer');

    // Menú de 3 Puntos (⋮)
    this.btnMenuMore = document.getElementById('btn-menu-more');
    this.menuMore = document.getElementById('menu-more');
    this.btnMenuLoadScene = document.getElementById('btn-menu-load-scene');
    this.btnMenuImportProject = document.getElementById('btn-menu-import-project');
    this.btnMenuExportPmap = document.getElementById('btn-menu-export-pmap');
    this.btnMenuExportJson = document.getElementById('btn-menu-export-json');
    this.btnMenuExportsGallery = document.getElementById('btn-menu-exports-gallery');
    this.btnMenuShutdown = document.getElementById('btn-menu-shutdown');
    this.inputImportProject = document.getElementById('input-import-project');

    // Modal de Videos Renderizados
    this.modalExports = document.getElementById('modal-exports');
    this.exportsList = document.getElementById('exports-list');
    this.exportsCountText = document.getElementById('exports-count-text');
    this.btnRefreshExports = document.getElementById('btn-refresh-exports');
    this.btnCloseExports = document.getElementById('btn-close-exports');
    this.btnCloseExportsFooter = document.getElementById('btn-close-exports-footer');

    // Overlay de apagado del sistema
    this.shutdownOverlay = document.getElementById('shutdown-overlay');
  }

  closeAllDropdowns() {
    if (this.menuSurfaces) this.menuSurfaces.classList.add('hidden');
    if (this.menuMasks) this.menuMasks.classList.add('hidden');
    if (this.menuMore) this.menuMore.classList.add('hidden');
    if (this.btnDropdownSurfaces) this.btnDropdownSurfaces.classList.remove('active');
    if (this.btnDropdownMasks) this.btnDropdownMasks.classList.remove('active');
    if (this.btnMenuMore) this.btnMenuMore.classList.remove('active');
  }

  addSurfaceAndSelect(poly) {
    this.scene.addPolygon(poly);
    this.sync.broadcastPolygonUpdate(poly.toJSON());
    this.sync.broadcastSelection(poly.id);
    this.canvas.setMode('select');
    this.setActiveToolButton('select');
    this.closeAllDropdowns();
    this.refreshAll();
  }

  bindEvents() {
    // Edición de Nombre de Escena Activa
    if (this.topSceneNameInput) {
      const saveSceneName = () => {
        let val = this.topSceneNameInput.value.trim();
        if (!val) val = 'Escena_Sin_Nombre';
        if (val !== this.scene.name) {
          this.scene.name = val;
          this.scene.saveStateToHistory();
          this.sync.broadcastFullState(this.scene.toJSON());
          this.showToast(`Nombre de escena actualizado a "${val}"`, 'info');
        }
      };
      this.topSceneNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          this.topSceneNameInput.blur();
        }
      });
      this.topSceneNameInput.addEventListener('change', saveSceneName);
      this.topSceneNameInput.addEventListener('blur', saveSceneName);
    }

    // Desplegable de Superficies
    if (this.btnDropdownSurfaces) {
      this.btnDropdownSurfaces.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.menuMasks) this.menuMasks.classList.add('hidden');
        if (this.menuMore) this.menuMore.classList.add('hidden');
        if (this.btnDropdownMasks) this.btnDropdownMasks.classList.remove('active');
        if (this.btnMenuMore) this.btnMenuMore.classList.remove('active');
        const isClosed = this.menuSurfaces.classList.contains('hidden');
        if (isClosed) {
          this.menuSurfaces.classList.remove('hidden');
          this.btnDropdownSurfaces.classList.add('active');
        } else {
          this.menuSurfaces.classList.add('hidden');
          this.btnDropdownSurfaces.classList.remove('active');
        }
      });
    }

    // Desplegable de Máscaras
    if (this.btnDropdownMasks) {
      this.btnDropdownMasks.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.menuSurfaces) this.menuSurfaces.classList.add('hidden');
        if (this.menuMore) this.menuMore.classList.add('hidden');
        if (this.btnDropdownSurfaces) this.btnDropdownSurfaces.classList.remove('active');
        if (this.btnMenuMore) this.btnMenuMore.classList.remove('active');
        const isClosed = this.menuMasks.classList.contains('hidden');
        if (isClosed) {
          this.menuMasks.classList.remove('hidden');
          this.btnDropdownMasks.classList.add('active');
        } else {
          this.menuMasks.classList.add('hidden');
          this.btnDropdownMasks.classList.remove('active');
        }
      });
    }

    // Menú de 3 Puntos (⋮)
    if (this.btnMenuMore) {
      this.btnMenuMore.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.menuSurfaces) this.menuSurfaces.classList.add('hidden');
        if (this.menuMasks) this.menuMasks.classList.add('hidden');
        if (this.btnDropdownSurfaces) this.btnDropdownSurfaces.classList.remove('active');
        if (this.btnDropdownMasks) this.btnDropdownMasks.classList.remove('active');
        const isClosed = this.menuMore.classList.contains('hidden');
        if (isClosed) {
          this.menuMore.classList.remove('hidden');
          this.btnMenuMore.classList.add('active');
        } else {
          this.menuMore.classList.add('hidden');
          this.btnMenuMore.classList.remove('active');
        }
      });
    }

    // Opciones del Menú de 3 Puntos
    if (this.btnMenuLoadScene) {
      this.btnMenuLoadScene.addEventListener('click', () => {
        this.closeAllDropdowns();
        if (this.sceneManager) {
          this.sceneManager.openModal();
        } else {
          document.getElementById('scene-modal-overlay')?.classList.remove('hidden');
        }
      });
    }

    if (this.btnMenuImportProject && this.inputImportProject) {
      this.btnMenuImportProject.addEventListener('click', () => {
        this.closeAllDropdowns();
        this.inputImportProject.click();
      });

      this.inputImportProject.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        await this.importProjectFile(file);
        e.target.value = '';
      });
    }

    if (this.btnMenuExportPmap) {
      this.btnMenuExportPmap.addEventListener('click', () => {
        this.closeAllDropdowns();
        this.exportCurrentPmap();
      });
    }

    if (this.btnMenuExportJson) {
      this.btnMenuExportJson.addEventListener('click', () => {
        this.closeAllDropdowns();
        this.exportCurrentJson();
      });
    }

    if (this.btnMenuExportsGallery) {
      this.btnMenuExportsGallery.addEventListener('click', () => {
        this.closeAllDropdowns();
        this.openExportsModal();
      });
    }

    if (this.btnMenuHelp) {
      this.btnMenuHelp.addEventListener('click', () => {
        this.closeAllDropdowns();
        this.toggleHelpModal(true);
      });
    }

    if (this.btnMenuShutdown) {
      this.btnMenuShutdown.addEventListener('click', () => {
        this.closeAllDropdowns();
        this.shutdownSystem();
      });
    }

    // Modal de Videos Renderizados
    if (this.btnRefreshExports) {
      this.btnRefreshExports.addEventListener('click', () => this.fetchExports());
    }
    if (this.btnCloseExports) {
      this.btnCloseExports.addEventListener('click', () => this.closeExportsModal());
    }
    if (this.btnCloseExportsFooter) {
      this.btnCloseExportsFooter.addEventListener('click', () => this.closeExportsModal());
    }
    if (this.modalExports) {
      this.modalExports.addEventListener('click', (e) => {
        if (e.target === this.modalExports) this.closeExportsModal();
      });
    }

    // Cerrar desplegables al hacer clic fuera
    window.addEventListener('click', (e) => {
      if (!e.target.closest('.dropdown-menu-container')) {
        this.closeAllDropdowns();
      }
    });

    // Cambio de modo
    if (this.btnToolSelect) {
      this.btnToolSelect.addEventListener('click', () => {
        this.closeAllDropdowns();
        this.canvas.setMode('select');
      });
    }

    if (this.btnToolDrawStraight) {
      this.btnToolDrawStraight.addEventListener('click', () => {
        this.closeAllDropdowns();
        this.canvas.setMode('draw_straight');
      });
    }

    if (this.btnToolDrawCurved) {
      this.btnToolDrawCurved.addEventListener('click', () => {
        this.closeAllDropdowns();
        this.canvas.setMode('draw_curved');
      });
    }

    if (this.btnToolDraw) {
      this.btnToolDraw.addEventListener('click', () => {
        this.closeAllDropdowns();
        this.canvas.setMode('draw_straight');
      });
    }

    // Opciones de creación de superficies
    if (this.btnAddQuad) {
      this.btnAddQuad.addEventListener('click', () => {
        this.addSurfaceAndSelect(PolygonObject.createDefaultQuad());
      });
    }

    if (this.btnAddSquare) {
      this.btnAddSquare.addEventListener('click', () => {
        this.addSurfaceAndSelect(PolygonObject.createDefaultSquare(0.5, 0.5, 0.25, false));
      });
    }

    if (this.btnAddCircle) {
      this.btnAddCircle.addEventListener('click', () => {
        this.addSurfaceAndSelect(PolygonObject.createDefaultCircle(0.5, 0.5, 0.18, false));
      });
    }

    if (this.btnAddTriangle) {
      this.btnAddTriangle.addEventListener('click', () => {
        this.addSurfaceAndSelect(PolygonObject.createDefaultTriangle(0.5, 0.5, 0.28, false));
      });
    }

    if (this.btnAddPentagon) {
      this.btnAddPentagon.addEventListener('click', () => {
        this.addSurfaceAndSelect(PolygonObject.createDefaultRegularPolygon(5, 0.5, 0.5, 0.26, false));
      });
    }

    if (this.btnAddHexagon) {
      this.btnAddHexagon.addEventListener('click', () => {
        this.addSurfaceAndSelect(PolygonObject.createDefaultRegularPolygon(6, 0.5, 0.5, 0.26, false));
      });
    }

    // Opciones de creación de máscaras
    if (this.btnAddOccluder) {
      this.btnAddOccluder.addEventListener('click', () => {
        const occ = PolygonObject.createDefaultQuad(0.5, 0.5, 0.25);
        occ.type = 'occluder';
        occ.name = 'Máscara Cuad ' + (this.scene.polygons.length + 1);
        occ.color = '#ffffff';
        this.addSurfaceAndSelect(occ);
      });
    }

    if (this.btnAddMaskSquare) {
      this.btnAddMaskSquare.addEventListener('click', () => {
        this.addSurfaceAndSelect(PolygonObject.createDefaultSquare(0.5, 0.5, 0.25, true));
      });
    }

    if (this.btnAddCircleOccluder) {
      this.btnAddCircleOccluder.addEventListener('click', () => {
        this.addSurfaceAndSelect(PolygonObject.createDefaultCircle(0.5, 0.5, 0.18, true));
      });
    }

    if (this.btnAddMaskTriangle) {
      this.btnAddMaskTriangle.addEventListener('click', () => {
        this.addSurfaceAndSelect(PolygonObject.createDefaultTriangle(0.5, 0.5, 0.28, true));
      });
    }

    // Abrir ventana de proyector
    this.btnOpenProjector.addEventListener('click', () => {
      const w = window.open('/projector', 'ProjectionMapperOutput', 'width=1280,height=720,menubar=no,toolbar=no,location=no');
      if (w) {
        w.focus();
        setTimeout(() => {
          this.sync.broadcastFullState(this.scene.toJSON());
        }, 500);
      }
    });

    // Conmutar modo Calibración / Presentación
    this.btnToggleMode.addEventListener('click', () => {
      this.toggleCalibrationMode();
    });

    // Modal de Ayuda
    if (this.btnHelp) {
      this.btnHelp.addEventListener('click', () => this.toggleHelpModal(true));
    }
    if (this.btnCloseHelp) {
      this.btnCloseHelp.addEventListener('click', () => this.toggleHelpModal(false));
    }
    if (this.btnCloseHelpFooter) {
      this.btnCloseHelpFooter.addEventListener('click', () => this.toggleHelpModal(false));
    }
    if (this.modalHelp) {
      this.modalHelp.addEventListener('click', (e) => {
        if (e.target === this.modalHelp) this.toggleHelpModal(false);
      });
    }

    // Atajos de teclado globales para Calibración (Espacio / M) y Ayuda (? / F1)
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.code === 'Space' || (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey)) {
        e.preventDefault();
        this.toggleCalibrationMode();
      } else if (e.key === '?' || e.key === 'F1') {
        e.preventDefault();
        this.toggleHelpModal();
      }
    });

    // Deshacer / Rehacer
    this.btnUndo.addEventListener('click', () => {
      if (this.scene.undo()) {
        this.sync.broadcastFullState(this.scene.toJSON());
        this.refreshAll();
      }
    });

    this.btnRedo.addEventListener('click', () => {
      if (this.scene.redo()) {
        this.sync.broadcastFullState(this.scene.toJSON());
        this.refreshAll();
      }
    });

    // Bloquear / Desbloquear todas las superficies
    if (this.btnLockAll) {
      this.btnLockAll.addEventListener('click', () => {
        this.scene.toggleLockAll();
        this.sync.broadcastFullState(this.scene.toJSON());
        this.refreshAll();
      });
    }

    // Responder a peticiones de sincronización del proyector
    this.sync.on('REQUEST_SYNC', () => {
      this.sync.broadcastFullState(this.scene.toJSON());
    });

    // Callbacks del canvas
    this.canvas.onStateChange = () => {
      this.updateLayersList();
      this.updatePropertiesPanel();
    };

    this.canvas.onModeChange = (mode) => {
      this.setActiveToolButton(mode);
    };
  }

  toggleCalibrationMode() {
    const nextMode = this.scene.displayMode === 'calibration' ? 'show' : 'calibration';
    this.scene.displayMode = nextMode;
    if (this.btnToggleMode) {
      const icon = nextMode === 'calibration' ? Icons.get('crosshair', { size: 14 }) : Icons.get('monitor-play', { size: 14 });
      const label = nextMode === 'calibration' ? 'Modo: Calibración' : 'Modo: Presentación';
      this.btnToggleMode.innerHTML = `${icon} <span>${label}</span>`;
      this.btnToggleMode.classList.toggle('mode-presentation', nextMode === 'show');
    }
    this.sync.broadcastDisplayMode(nextMode);
  }

  toggleHelpModal(show = null) {
    if (!this.modalHelp) return;
    const isCurrentlyHidden = this.modalHelp.classList.contains('hidden');
    const shouldShow = show !== null ? show : isCurrentlyHidden;
    this.modalHelp.classList.toggle('hidden', !shouldShow);
  }

  setActiveToolButton(mode) {
    const isStraight = mode === 'draw_straight' || mode === 'draw';
    const isCurved = mode === 'draw_curved';
    const isSelect = mode === 'select';

    if (this.btnToolSelect) this.btnToolSelect.classList.toggle('active', isSelect);
    if (this.btnToolDrawStraight) this.btnToolDrawStraight.classList.toggle('active', isStraight);
    if (this.btnToolDrawCurved) this.btnToolDrawCurved.classList.toggle('active', isCurved);
    if (this.btnToolDraw) this.btnToolDraw.classList.toggle('active', isStraight);

    if (this.toolbarContextHint) {
      if (isStraight) {
        this.toolbarContextHint.innerHTML = `${Icons.get('pen-tool', { size: 13 })} <b>Polígono Recto:</b> Haz clic para colocar esquinas · Clic en vértice 1 o Enter para cerrar · Esc para cancelar`;
        this.toolbarContextHint.style.color = '#00f0ff';
      } else if (isCurved) {
        this.toolbarContextHint.innerHTML = `${Icons.get('spline', { size: 13 })} <b>Polígono Curvo:</b> Clic o arrastra para trazar arcos suaves · Clic en vértice 1 o Enter para cerrar · Esc para cancelar`;
        this.toolbarContextHint.style.color = '#f472b6';
      } else {
        this.toolbarContextHint.innerHTML = `${Icons.get('mouse-pointer', { size: 13 })} Arrastra figuras o vértices · Shift+Clic / Recuadro selec. múltiple · Supr para borrar`;
        this.toolbarContextHint.style.color = 'var(--text-muted)';
      }
    }
  }

  refreshAll() {
    this.canvas.render();
    this.updateLayersList();
    this.updatePropertiesPanel();
    if (this.topSceneNameInput && document.activeElement !== this.topSceneNameInput) {
      this.topSceneNameInput.value = this.scene.name || 'Mi_Escena_1';
    }
  }

  updateLayersList() {
    if (this.layerCount) {
      this.layerCount.textContent = `${this.scene.polygons.length} Capas`;
    }
    if (this.btnLockAll) {
      const isAll = this.scene.isAllLocked();
      this.btnLockAll.innerHTML = Icons.get(isAll ? 'lock' : 'unlock', { size: 14 });
      this.btnLockAll.title = isAll ? 'Desbloquear todas las superficies' : 'Bloquear todas las superficies';
    }

    if (this.scene.polygons.length === 0) {
      this.layersContainer.innerHTML = `
        <div class="empty-state">
          <p>No hay superficies creadas.</p>
          <small>Haz clic en "+ Quad" o "Dibujar" para comenzar.</small>
        </div>
      `;
      return;
    }

    let html = '';
    // Mostramos en orden inverso (las superiores arriba)
    for (let i = this.scene.polygons.length - 1; i >= 0; i--) {
      const poly = this.scene.polygons[i];
      const isSelected = poly.id === this.scene.selectedId;
      const isOccluder = poly.type === 'occluder' || poly.type === 'circle_occluder';
      const typeLabels = {
        'quad': 'QUAD',
        'polygon': 'POLÍGONO',
        'circle': 'CÍRCULO',
        'occluder': 'MÁSCARA CUAD',
        'circle_occluder': 'MÁSCARA CIRC'
      };
      const typeLabel = typeLabels[poly.type] || poly.type.toUpperCase();

      html += `
        <div class="layer-item ${isSelected ? 'active' : ''}" data-id="${poly.id}">
          <div class="layer-header-row">
            <div class="layer-title-group">
              <div class="layer-color-dot" style="background: ${isOccluder ? '#0f172a' : poly.color}; border-color: ${isOccluder ? '#ffffff' : poly.color};"></div>
              <span class="layer-name" title="${poly.name}">${poly.name}</span>
            </div>
            <span class="layer-type">${typeLabel}</span>
          </div>
          <div class="layer-actions-row">
            <div class="layer-order-actions">
              <button class="icon-btn btn-up" title="Subir capa (al frente)" data-id="${poly.id}" ${i === this.scene.polygons.length - 1 ? 'disabled' : ''}>
                ${Icons.get('chevron-up', { size: 11 })}
              </button>
              <button class="icon-btn btn-down" title="Bajar capa (al fondo)" data-id="${poly.id}" ${i === 0 ? 'disabled' : ''}>
                ${Icons.get('chevron-down', { size: 11 })}
              </button>
            </div>
            <div class="layer-state-actions">
              <button class="icon-btn btn-vis" title="Visibilidad" data-id="${poly.id}">
                ${poly.visible ? Icons.get('eye', { size: 12 }) : Icons.get('eye-off', { size: 12 })}
              </button>
              <button class="icon-btn btn-lock" title="Bloquear" data-id="${poly.id}">
                ${poly.locked ? Icons.get('lock', { size: 12 }) : Icons.get('unlock', { size: 12 })}
              </button>
              <button class="icon-btn btn-del" title="Eliminar" data-id="${poly.id}">
                ${Icons.get('trash-2', { size: 12 })}
              </button>
            </div>
          </div>
        </div>
      `;
    }
    this.layersContainer.innerHTML = html;

    // Delegación de eventos para la lista de capas
    this.layersContainer.querySelectorAll('.layer-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const id = item.dataset.id;
        this.scene.selectedId = id;
        this.sync.broadcastSelection(id);
        this.refreshAll();
      });
    });

    this.layersContainer.querySelectorAll('.btn-up').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (this.scene.moveLayerUp(id)) {
          this.sync.broadcastFullState(this.scene.toJSON());
          this.refreshAll();
        }
      });
    });

    this.layersContainer.querySelectorAll('.btn-down').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (this.scene.moveLayerDown(id)) {
          this.sync.broadcastFullState(this.scene.toJSON());
          this.refreshAll();
        }
      });
    });

    this.layersContainer.querySelectorAll('.btn-vis').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const poly = this.scene.getPolygon(btn.dataset.id);
        if (poly) {
          poly.visible = !poly.visible;
          this.scene.saveAutosave();
          this.sync.broadcastPolygonUpdate(poly.toJSON());
          this.refreshAll();
        }
      });
    });

    this.layersContainer.querySelectorAll('.btn-lock').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const poly = this.scene.getPolygon(btn.dataset.id);
        if (poly) {
          poly.locked = !poly.locked;
          this.scene.saveAutosave();
          this.refreshAll();
        }
      });
    });

    this.layersContainer.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        this.scene.removePolygon(id);
        this.sync.broadcastPolygonDelete(id);
        this.refreshAll();
      });
    });
  }

  updatePropertiesPanel() {
    const active = this.scene.getSelectedPolygon();
    if (!active) {
      this.propContainer.innerHTML = `
        <div class="empty-state">
          <p>Selecciona una superficie para ajustar sus propiedades.</p>
        </div>
      `;
      return;
    }

    const isOccluder = active.isOccluder ? active.isOccluder() : (active.type === 'occluder' || active.type === 'circle_occluder');
    const isCircular = active.isCircular ? active.isCircular() : (active.type === 'circle' || active.type === 'circle_occluder');

    this.propContainer.innerHTML = `
      <div class="prop-group">
        <label>Nombre de Superficie:</label>
        <input type="text" id="prop-name" value="${active.name}" class="prop-input" />
      </div>

      <div class="prop-group">
        <label>Tipo de Geometría:</label>
        <select id="prop-type" class="prop-select">
          <option value="quad" ${active.type === 'quad' ? 'selected' : ''}>Cuadrilátero (Quad 4-Puntos)</option>
          <option value="polygon" ${active.type === 'polygon' ? 'selected' : ''}>Polígono Libre</option>
          <option value="circle" ${active.type === 'circle' ? 'selected' : ''}>Círculo / Elipse</option>
          <option value="occluder" ${active.type === 'occluder' ? 'selected' : ''}>Máscara Cuadrada (Negro)</option>
          <option value="circle_occluder" ${active.type === 'circle_occluder' ? 'selected' : ''}>Máscara Circular (Negro)</option>
        </select>
      </div>

      ${isCircular ? `
      <!-- Propiedades Exclusivas para Círculo / Elipse -->
      <div class="prop-group">
        <label>Geometría Circular / Elíptica:</label>
        <div style="display:flex; flex-direction:column; gap:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:12px; color:var(--text-muted);">Radio Horizontal (X):</span>
            <span id="txt-rx" style="font-size:12px; font-family:var(--font-mono); color:var(--accent-cyan);">${Math.round(active.radiusX * 1920)}px (${Math.round(active.radiusX * 100)}%)</span>
          </div>
          <input type="range" id="prop-rx" min="0.02" max="0.5" step="0.002" value="${active.radiusX}" class="prop-range" />

          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:12px; color:var(--text-muted);">Radio Vertical (Y):</span>
            <span id="txt-ry" style="font-size:12px; font-family:var(--font-mono); color:var(--accent-cyan);">${Math.round(active.radiusY * 1080)}px (${Math.round(active.radiusY * 100)}%)</span>
          </div>
          <input type="range" id="prop-ry" min="0.02" max="0.5" step="0.002" value="${active.radiusY}" class="prop-range" />

          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:12px; color:var(--text-muted);">Rotación:</span>
            <span id="txt-rot" style="font-size:12px; font-family:var(--font-mono); color:var(--accent-cyan);">${Math.round(active.rotation || 0)}°</span>
          </div>
          <input type="range" id="prop-rot" min="0" max="360" step="1" value="${Math.round(active.rotation || 0)}" class="prop-range" />

          <button id="btn-make-perfect-circle" class="secondary-btn" style="margin-top:4px; font-size:11px;" title="Ajustar radios para que sea un círculo geométrico perfecto (1:1)">
            ${Icons.get('circle', { size: 13 })} Hacer Círculo Perfecto (1:1)
          </button>
        </div>
      </div>
      ` : `
      <!-- Propiedades de Curvatura Bézier para Polígonos -->
      <div class="prop-group">
        <label>Curvatura Bézier y Geometría:</label>
        <div style="display:flex; flex-direction:column; gap:6px;">
          <div style="display:flex; gap:6px;">
            <button id="btn-curve-all-edges" class="secondary-btn" style="flex:1; font-size:11px;" title="Convertir todas las aristas en curvas Bézier suaves">
              ${Icons.get('spline', { size: 13 })} Curvar Bordes
            </button>
            <button id="btn-straighten-all-edges" class="secondary-btn" style="flex:1; font-size:11px;" title="Enderezar todas las aristas">
              ${Icons.get('pen-tool', { size: 13 })} Enderezar
            </button>
          </div>
          ${this.canvas && this.canvas.selectedVertexIndex !== null && (!this.canvas.selectedVertexIndices || this.canvas.selectedVertexIndices.size <= 1) ? `
          <button id="btn-toggle-selected-edge" class="secondary-btn" style="margin-top:2px; font-size:11px;" title="Alternar curvatura Bézier de la arista que sale de la esquina seleccionada">
            ${Icons.get('spline', { size: 13 })} Alternar Curvatura Arista (${this.canvas.selectedVertexIndex + 1} → ${(this.canvas.selectedVertexIndex + 1) % active.points.length + 1})
          </button>
          ` : ''}
          ${active.points && active.points.length === 4 ? `
          <button id="btn-make-perfect-square" class="secondary-btn" style="margin-top:2px; font-size:11px;" title="Ajustar dimensiones para que sea un cuadrado geométrico perfecto (1:1 en pantalla 16:9)">
            ${Icons.get('square', { size: 13 })} Hacer Cuadrado Perfecto (1:1)
          </button>
          ` : ''}
          ${this.canvas && this.canvas.selectedVertexIndices && this.canvas.selectedVertexIndices.size > 0 ? `
          <button id="btn-delete-selected-vertices" class="danger-btn" style="margin-top:2px; font-size:11px;" title="Eliminar los vértices seleccionados actualmente">
            ${Icons.get('trash-2', { size: 13 })} Eliminar Vértices Seleccionados (${this.canvas.selectedVertexIndices.size})
          </button>
          ` : ''}
          <small style="color:var(--text-muted); font-size:10px; line-height:1.3; display: flex; align-items: flex-start; gap: 4px;">
            <span style="flex: none; color: var(--accent-cyan); margin-top: 1px;">${Icons.get('info', { size: 12 })}</span>
            <span>Clic en (+) para añadir vértice. <b>Alt+Clic</b> o <b>Shift+Clic</b> en (+) para curvar o enderezar ese borde individual.</span>
          </small>
        </div>
      </div>
      `}

      <div class="prop-group">
        <label>Jerarquía de Capa:</label>
        <div class="layer-order-group">
          <button id="btn-order-front" class="layer-order-btn" title="Traer al frente absoluto">${Icons.get('chevrons-up', { size: 12 })} Frente</button>
          <button id="btn-order-up" class="layer-order-btn" title="Subir un nivel">${Icons.get('chevron-up', { size: 12 })} Subir</button>
          <button id="btn-order-down" class="layer-order-btn" title="Bajar un nivel">${Icons.get('chevron-down', { size: 12 })} Bajar</button>
          <button id="btn-order-back" class="layer-order-btn" title="Enviar al fondo">${Icons.get('chevrons-down', { size: 12 })} Fondo</button>
        </div>
      </div>

      <div class="prop-group">
        <label>Color de Guía:</label>
        <input type="color" id="prop-color" value="${active.color}" class="prop-color-picker" />
      </div>

      <div class="prop-group">
        <label>Control Geométrico:</label>
        <div class="prop-readonly-pill">${isCircular ? 'Superficie elíptica continua' : `${active.points.length} puntos de control`}</div>
      </div>

      <div class="prop-group">
        <label>Opacidad de Mapeo:</label>
        <input type="range" id="prop-opacity" min="0" max="1" step="0.05" value="${active.media?.opacity ?? 1.0}" class="prop-range" />
      </div>

      <!-- Sección de Multimedia (Video e Imagen) -->
      ${!isOccluder ? `
      <div class="prop-group">
        <label>Medio Asignado (Video o Imagen):</label>
        <div id="media-drop-zone" class="media-preview-box">
          ${active.media && active.media.src ?
            (active.media.type === 'video' ?
              `<video id="inspector-video-preview" src="${active.media.src}" playsinline muted loop autoplay style="width:100%; height:100%; object-fit:contain;"></video>` :
              `<img src="${active.media.src}" alt="Textura" />`
            ) :
            `<div class="media-placeholder-text">
               <div style="display:flex; justify-content:center; margin-bottom: 6px; color: var(--accent-cyan);">${Icons.get('film', { size: 24 })}</div>
               <span>Sin video o imagen asignada</span><br/>
               <small style="opacity:0.6;">Arrastra un video (MP4/WEBM) o imagen (PNG/JPG)</small>
             </div>`
          }
        </div>

        ${active.media && active.media.type === 'video' && active.media.src ? `
        <!-- Controles de Reproducción de Video -->
        <div class="video-playback-panel">
          <div class="vid-timeline-row">
            <input type="range" id="vid-scrub-bar" min="0" max="100" value="0" step="0.1" class="prop-range" style="flex:1;" />
            <span id="vid-time-display" class="vid-time-txt">00:00 / 00:00</span>
          </div>
          <div class="vid-controls-row">
            <button id="btn-vid-toggle-play" class="tool-btn" style="flex:1; justify-content:center;" title="Reproducir / Pausar video">
              ${Icons.get('pause', { size: 12 })} Pausar
            </button>
            <button id="btn-vid-toggle-loop" class="tool-btn ${active.media.loop !== false ? 'active' : ''}" title="Bucle continuo">
              ${Icons.get('repeat', { size: 11 })} Loop
            </button>
            <button id="btn-vid-toggle-mute" class="tool-btn ${active.media.muted !== false ? 'active' : ''}" title="Silenciar / Activar sonido">
              ${active.media.muted !== false ? Icons.get('volume-x', { size: 12 }) : Icons.get('volume-2', { size: 12 })}
            </button>
            <select id="vid-rate-select" class="prop-select" title="Velocidad de reproducción">
              <option value="0.5" ${active.media.playbackRate === 0.5 ? 'selected' : ''}>0.5x</option>
              <option value="1.0" ${(!active.media.playbackRate || active.media.playbackRate === 1.0) ? 'selected' : ''}>1.0x</option>
              <option value="1.5" ${active.media.playbackRate === 1.5 ? 'selected' : ''}>1.5x</option>
              <option value="2.0" ${active.media.playbackRate === 2.0 ? 'selected' : ''}>2.0x</option>
            </select>
          </div>
        </div>
        ` : ''}

        <!-- Entradas de archivo para formatos estrictos -->
        <input type="file" id="prop-image-file" accept=".png,.jpg,.jpeg,.webp,.svg,.gif" style="display:none;" />
        <input type="file" id="prop-video-file" accept=".mp4,.webm,.mov" style="display:none;" />

        <div class="media-actions-row">
          <button id="btn-pick-video" class="secondary-btn" title="Cargar video local (MP4, WEBM, MOV)">${Icons.get('video', { size: 13 })} Video...</button>
          <button id="btn-pick-image" class="secondary-btn" title="Cargar imagen local (PNG, JPG, WEBP, SVG, GIF)">${Icons.get('image', { size: 13 })} Imagen...</button>
          ${active.media && active.media.src ?
            `<button id="btn-clear-media" class="danger-btn" style="padding:6px 8px;" title="Quitar medio">${Icons.get('trash-2', { size: 13 })}</button>` : ''
          }
        </div>
      </div>
      ` : ''}

      <div class="prop-actions">
        <button id="btn-duplicate" class="secondary-btn">${Icons.get('copy', { size: 13 })} Duplicar</button>
        <button id="btn-delete-active" class="danger-btn">${Icons.get('trash-2', { size: 13 })} Eliminar Superficie</button>
      </div>
    `;

    // Eventos de propiedades generales
    document.getElementById('btn-order-front').addEventListener('click', () => {
      if (this.scene.bringToFront(active.id)) {
        this.sync.broadcastFullState(this.scene.toJSON());
        this.refreshAll();
      }
    });

    document.getElementById('btn-order-up').addEventListener('click', () => {
      if (this.scene.moveLayerUp(active.id)) {
        this.sync.broadcastFullState(this.scene.toJSON());
        this.refreshAll();
      }
    });

    document.getElementById('btn-order-down').addEventListener('click', () => {
      if (this.scene.moveLayerDown(active.id)) {
        this.sync.broadcastFullState(this.scene.toJSON());
        this.refreshAll();
      }
    });

    document.getElementById('btn-order-back').addEventListener('click', () => {
      if (this.scene.sendToBack(active.id)) {
        this.sync.broadcastFullState(this.scene.toJSON());
        this.refreshAll();
      }
    });

    document.getElementById('prop-name').addEventListener('input', (e) => {
      active.name = e.target.value;
      this.scene.saveAutosave();
      this.sync.broadcastPolygonUpdate(active.toJSON());
      this.canvas.renderPolygons();
      this.updateLayersList();
    });

    document.getElementById('prop-type').addEventListener('change', (e) => {
      active.type = e.target.value;
      if (active.isCircular()) {
        if (!active.center) active.center = [0.5, 0.5];
        if (!active.radiusX) active.radiusX = 0.18;
        if (!active.radiusY) active.radiusY = 0.18;
        active.points = active.getBoundaryPoints(64);
      } else if (active.points.length < 3) {
        const d = PolygonObject.createDefaultQuad();
        active.points = d.points;
      }
      this.scene.saveStateToHistory();
      this.sync.broadcastPolygonUpdate(active.toJSON());
      this.refreshAll();
    });

    // Controladores de Círculo / Elipse
    const rxInput = document.getElementById('prop-rx');
    if (rxInput) {
      rxInput.addEventListener('input', (e) => {
        active.radiusX = parseFloat(e.target.value);
        active.points = active.getBoundaryPoints(64);
        const txtRx = document.getElementById('txt-rx');
        if (txtRx) txtRx.textContent = `${Math.round(active.radiusX * 1920)}px (${Math.round(active.radiusX * 100)}%)`;
        this.scene.saveAutosave();
        this.sync.broadcastPolygonUpdate(active.toJSON());
        this.canvas.render();
      });
    }

    const ryInput = document.getElementById('prop-ry');
    if (ryInput) {
      ryInput.addEventListener('input', (e) => {
        active.radiusY = parseFloat(e.target.value);
        active.points = active.getBoundaryPoints(64);
        const txtRy = document.getElementById('txt-ry');
        if (txtRy) txtRy.textContent = `${Math.round(active.radiusY * 1080)}px (${Math.round(active.radiusY * 100)}%)`;
        this.scene.saveAutosave();
        this.sync.broadcastPolygonUpdate(active.toJSON());
        this.canvas.render();
      });
    }

    const rotInput = document.getElementById('prop-rot');
    if (rotInput) {
      rotInput.addEventListener('input', (e) => {
        active.rotation = parseFloat(e.target.value);
        active.points = active.getBoundaryPoints(64);
        const txtRot = document.getElementById('txt-rot');
        if (txtRot) txtRot.textContent = `${Math.round(active.rotation || 0)}°`;
        this.scene.saveAutosave();
        this.sync.broadcastPolygonUpdate(active.toJSON());
        this.canvas.render();
      });
    }

    const btnPerfectCircle = document.getElementById('btn-make-perfect-circle');
    if (btnPerfectCircle) {
      btnPerfectCircle.addEventListener('click', () => {
        // En 1920x1080, para que el radio en píxeles sea igual: radiusY = radiusX * (1920 / 1080)
        active.radiusY = Math.min(0.48, active.radiusX * (1920 / 1080));
        active.points = active.getBoundaryPoints(64);
        this.scene.saveStateToHistory();
        this.sync.broadcastPolygonUpdate(active.toJSON());
        this.refreshAll();
      });
    }

    // Controladores de Curvas Bézier
    const btnCurveAll = document.getElementById('btn-curve-all-edges');
    if (btnCurveAll) {
      btnCurveAll.addEventListener('click', () => {
        const pts = active.points;
        const n = pts.length;
        if (n >= 3) {
          if (!active.edgeCurves) active.edgeCurves = {};
          for (let i = 0; i < n; i++) {
            const nextIdx = (i + 1) % n;
            const pA = pts[i];
            const pB = pts[nextIdx];
            const dx = pB[0] - pA[0];
            const dy = pB[1] - pA[1];
            // Tangentes Bézier desplazadas hacia afuera perpendicularmente
            const nx = -dy * 0.15;
            const ny = dx * 0.15;
            active.edgeCurves[`${i}-${nextIdx}`] = {
              c1: [pA[0] + dx * 0.33 + nx, pA[1] + dy * 0.33 + ny],
              c2: [pA[0] + dx * 0.67 + nx, pA[1] + dy * 0.67 + ny]
            };
          }
          this.scene.saveStateToHistory();
          this.sync.broadcastPolygonUpdate(active.toJSON());
          this.refreshAll();
        }
      });
    }

    const btnStraightenAll = document.getElementById('btn-straighten-all-edges');
    if (btnStraightenAll) {
      btnStraightenAll.addEventListener('click', () => {
        active.edgeCurves = {};
        this.scene.saveStateToHistory();
        this.sync.broadcastPolygonUpdate(active.toJSON());
        this.refreshAll();
      });
    }

    const btnToggleEdge = document.getElementById('btn-toggle-selected-edge');
    if (btnToggleEdge && this.canvas && this.canvas.selectedVertexIndex !== null) {
      btnToggleEdge.addEventListener('click', () => {
        const idx = this.canvas.selectedVertexIndex;
        active.toggleEdgeCurved(idx);
        this.scene.saveStateToHistory();
        this.sync.broadcastPolygonUpdate(active.toJSON());
        this.refreshAll();
      });
    }

    const btnSquare = document.getElementById('btn-make-perfect-square');
    if (btnSquare) {
      btnSquare.addEventListener('click', () => {
        if (active.points && active.points.length === 4) {
          const pts = active.points;
          const cx = pts.reduce((acc, p) => acc + p[0], 0) / 4;
          const cy = pts.reduce((acc, p) => acc + p[1], 0) / 4;
          const xs = pts.map(p => p[0]);
          const currentW = Math.max(...xs) - Math.min(...xs);
          const size = Math.max(0.1, currentW || 0.3);
          const hw = size * 0.5;
          const hh = hw * (1920 / 1080);
          active.points = [
            [Math.max(0, Math.min(1, cx - hw)), Math.max(0, Math.min(1, cy - hh))],
            [Math.max(0, Math.min(1, cx + hw)), Math.max(0, Math.min(1, cy - hh))],
            [Math.max(0, Math.min(1, cx + hw)), Math.max(0, Math.min(1, cy + hh))],
            [Math.max(0, Math.min(1, cx - hw)), Math.max(0, Math.min(1, cy + hh))]
          ];
          this.scene.saveStateToHistory();
          this.sync.broadcastPolygonUpdate(active.toJSON());
          this.refreshAll();
        }
      });
    }

    const btnDeleteVerts = document.getElementById('btn-delete-selected-vertices');
    if (btnDeleteVerts) {
      btnDeleteVerts.addEventListener('click', () => {
        this.canvas.deleteSelectedVertices();
        this.refreshAll();
      });
    }

    document.getElementById('prop-color').addEventListener('input', (e) => {
      active.color = e.target.value;
      this.scene.saveAutosave();
      this.sync.broadcastPolygonUpdate(active.toJSON());
      this.canvas.render();
      this.updateLayersList();
    });

    document.getElementById('prop-opacity').addEventListener('input', (e) => {
      if (!active.media) active.media = { type: 'color', opacity: 1.0 };
      active.media.opacity = parseFloat(e.target.value);
      this.scene.saveAutosave();
      this.sync.broadcastPolygonUpdate(active.toJSON());
      this.canvas.render();
    });

    // Eventos de Medios (Imágenes y Videos)
    if (!isOccluder) {
      const imgInput = document.getElementById('prop-image-file');
      const vidInput = document.getElementById('prop-video-file');

      document.getElementById('btn-pick-image').addEventListener('click', () => imgInput.click());
      document.getElementById('btn-pick-video').addEventListener('click', () => vidInput.click());

      const handleFileUpload = (file, mediaType) => {
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        const validImages = ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif'];
        const validVideos = ['.mp4', '.webm', '.mov'];

        if (mediaType === 'image' && !validImages.includes(ext)) {
          alert(`Formato '${ext}' no permitido para imágenes.\nPermitidos: PNG, JPG, JPEG, WEBP, SVG, GIF.`);
          return;
        }
        if (mediaType === 'video' && !validVideos.includes(ext)) {
          alert(`Formato '${ext}' no permitido para videos.\nPermitidos: MP4, WEBM, MOV.`);
          return;
        }

        const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
        if (file.size > MAX_FILE_SIZE) {
          const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
          alert(`Archivo demasiado pesado (${sizeMb} MB).\nEl límite máximo permitido para mapping en tiempo real es de 50 MB.\nSe recomienda comprimir el video a 1080p H.264 para garantizar fluidez sin colapsos.`);
          return;
        }

        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            const res = await fetch('/api/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename: file.name, data: event.target.result })
            });
            const data = await res.json();
            active.media = {
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
            active.media = {
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
          this.sync.broadcastPolygonUpdate(active.toJSON());
          this.refreshAll();
        };
        reader.readAsDataURL(file);
      };

      imgInput.addEventListener('change', (e) => {
        if (e.target.files[0]) handleFileUpload(e.target.files[0], 'image');
      });

      vidInput.addEventListener('change', (e) => {
        if (e.target.files[0]) handleFileUpload(e.target.files[0], 'video');
      });

      // Quitar medio
      const clearBtn = document.getElementById('btn-clear-media');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          active.media = {
            type: 'color',
            src: null,
            opacity: 1.0,
            fit: 'stretch'
          };
          this.scene.saveStateToHistory();
          this.sync.broadcastPolygonUpdate(active.toJSON());
          this.refreshAll();
        });
      }

      // Controles de Video en vivo
      if (active.media && active.media.type === 'video') {
        const previewVid = document.getElementById('inspector-video-preview');
        const playBtn = document.getElementById('btn-vid-toggle-play');
        const loopBtn = document.getElementById('btn-vid-toggle-loop');
        const muteBtn = document.getElementById('btn-vid-toggle-mute');
        const rateSelect = document.getElementById('vid-rate-select');
        const scrubBar = document.getElementById('vid-scrub-bar');
        const timeDisplay = document.getElementById('vid-time-display');

        // Play / Pause
        playBtn.addEventListener('click', () => {
          const el = this.canvas.mediaLayer.querySelector(`[data-poly-id="${active.id}"] video`);
          const isPlaying = active.media.playing !== false;
          active.media.playing = !isPlaying;

          if (active.media.playing) {
            playBtn.innerHTML = `${Icons.get('pause', { size: 12 })} Pausar`;
            if (previewVid) previewVid.play().catch(() => {});
            if (el) el.play().catch(() => {});
            this.sync.broadcastVideoAction(active.id, 'play');
          } else {
            playBtn.innerHTML = `${Icons.get('play', { size: 12 })} Play`;
            if (previewVid) previewVid.pause();
            if (el) el.pause();
            this.sync.broadcastVideoAction(active.id, 'pause');
          }
        });

        // Loop
        loopBtn.addEventListener('click', () => {
          active.media.loop = !active.media.loop;
          loopBtn.classList.toggle('active', active.media.loop);
          if (previewVid) previewVid.loop = active.media.loop;
          const el = this.canvas.mediaLayer.querySelector(`[data-poly-id="${active.id}"] video`);
          if (el) el.loop = active.media.loop;
          this.sync.broadcastVideoAction(active.id, 'loop', active.media.loop);
        });

        // Mute
        muteBtn.addEventListener('click', () => {
          active.media.muted = !active.media.muted;
          muteBtn.innerHTML = active.media.muted ? Icons.get('volume-x', { size: 12 }) : Icons.get('volume-2', { size: 12 });
          muteBtn.classList.toggle('active', active.media.muted);
          if (previewVid) previewVid.muted = active.media.muted;
          const el = this.canvas.mediaLayer.querySelector(`[data-poly-id="${active.id}"] video`);
          if (el) el.muted = active.media.muted;
          this.sync.broadcastVideoAction(active.id, 'mute', active.media.muted);
        });

        // Velocidad
        rateSelect.addEventListener('change', (e) => {
          const rate = parseFloat(e.target.value);
          active.media.playbackRate = rate;
          if (previewVid) previewVid.playbackRate = rate;
          const el = this.canvas.mediaLayer.querySelector(`[data-poly-id="${active.id}"] video`);
          if (el) el.playbackRate = rate;
          this.sync.broadcastVideoAction(active.id, 'rate', rate);
        });

        // Barra de tiempo
        if (previewVid) {
          previewVid.addEventListener('timeupdate', () => {
            if (previewVid.duration) {
              const pct = (previewVid.currentTime / previewVid.duration) * 100;
              scrubBar.value = pct;
              timeDisplay.textContent = `${this.formatTime(previewVid.currentTime)} / ${this.formatTime(previewVid.duration)}`;
            }
          });
        }

        scrubBar.addEventListener('input', (e) => {
          if (previewVid && previewVid.duration) {
            const targetTime = (parseFloat(e.target.value) / 100) * previewVid.duration;
            previewVid.currentTime = targetTime;
            const el = this.canvas.mediaLayer.querySelector(`[data-poly-id="${active.id}"] video`);
            if (el) el.currentTime = targetTime;
            this.sync.broadcastVideoAction(active.id, 'seek', targetTime);
          }
        });
      }
    }

    document.getElementById('btn-duplicate').addEventListener('click', () => {
      const dup = new PolygonObject(JSON.parse(JSON.stringify(active.toJSON())));
      dup.id = 'poly_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
      dup.name = active.name + ' (Copia)';
      dup.points = dup.points.map(([x, y]) => [Math.min(1, x + 0.03), Math.min(1, y + 0.03)]);
      this.scene.addPolygon(dup);
      this.sync.broadcastPolygonUpdate(dup.toJSON());
      this.sync.broadcastSelection(dup.id);
      this.refreshAll();
    });

    document.getElementById('btn-delete-active').addEventListener('click', () => {
      const id = active.id;
      this.scene.removePolygon(id);
      this.sync.broadcastPolygonDelete(id);
      this.refreshAll();
    });
  }

  formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? Icons.get('check-circle', { size: 16 }) : (type === 'error' ? Icons.get('alert-triangle', { size: 16 }) : Icons.get('info', { size: 16 }));
    toast.innerHTML = `<span style="display:flex; align-items:center;">${icon}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }

  async exportCurrentPmap() {
    try {
      const sceneData = this.scene.toJSON();
      const sceneName = (this.scene.name || 'proyecto_mapeo').trim();
      this.showToast('Empaquetando proyecto y medios...', 'info');

      const res = await fetch('/api/project/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene: sceneData, name: sceneName })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sceneName}.pmap`;
      a.click();
      URL.revokeObjectURL(url);

      this.showToast(`Paquete "${sceneName}.pmap" descargado con éxito`, 'success');
    } catch (err) {
      alert('Error exportando paquete .pmap: ' + err.message);
    }
  }

  exportCurrentJson() {
    try {
      const sceneData = this.scene.toJSON();
      const sceneName = (this.scene.name || 'escena_mapeo').trim();
      const blob = new Blob([JSON.stringify(sceneData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sceneName}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast(`Escena "${sceneName}.json" descargada`, 'success');
    } catch (err) {
      alert('Error exportando JSON: ' + err.message);
    }
  }

  async importProjectFile(file) {
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

      // Cargar escena importada
      this.scene.fromJSON(data.scene);
      this.sync.broadcastFullState(this.scene.toJSON());
      this.refreshAll();

      const msg = data.message || `Proyecto "${data.name}" importado con éxito`;
      this.showToast(msg, 'success');
    } catch (err) {
      alert('Error importando proyecto: ' + err.message);
    }
  }

  openExportsModal() {
    if (this.modalExports) {
      this.modalExports.classList.remove('hidden');
      this.fetchExports();
    }
  }

  closeExportsModal() {
    if (this.modalExports) {
      this.modalExports.classList.add('hidden');
    }
  }

  async fetchExports() {
    if (!this.exportsList) return;
    this.exportsList.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:20px; color:#94a3b8;">Cargando videos...</div>';
    try {
      const res = await fetch('/api/exports');
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        this.exportsList.innerHTML = `
          <div style="grid-column: 1/-1; text-align:center; padding: 40px 20px; color: var(--text-muted);">
            <div style="display:flex; justify-content:center; margin-bottom: 12px; color: var(--text-muted);">${Icons.get('film', { size: 36 })}</div>
            <p style="margin: 0; font-size: 13px;">No hay videos exportados aún en <code>media/exports/</code>.</p>
            <small style="color: #64748b;">Usa el botón "Exportar Video" para renderizar tu primer diseño mapeado.</small>
          </div>
        `;
        if (this.exportsCountText) this.exportsCountText.textContent = '0 videos guardados';
        return;
      }

      if (this.exportsCountText) {
        this.exportsCountText.textContent = `${data.length} video${data.length === 1 ? '' : 's'} guardado${data.length === 1 ? '' : 's'}`;
      }

      let html = '';
      data.forEach(item => {
        const dateStr = item.modified ? new Date(item.modified * 1000).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '';
        html += `
          <div class="export-card">
            <video class="export-video-preview" src="${item.url}" preload="metadata" controls playsinline></video>
            <div class="export-card-info">
              <div class="export-card-title" title="${item.filename}">${item.name}</div>
              <div class="export-card-meta">
                <span>${Icons.get('hard-drive', { size: 12 })} ${item.size_formatted}</span>
                <span>${Icons.get('clock', { size: 12 })} ${dateStr}</span>
              </div>
            </div>
            <div class="export-card-actions">
              <a href="${item.url}" download="${item.filename}" class="tool-btn accent-btn" title="Descargar video a tu computadora">
                ${Icons.get('download', { size: 13 })} Descargar
              </a>
              <button class="tool-btn danger-item btn-del-export" data-filename="${item.filename}" title="Eliminar render del disco">
                ${Icons.get('trash-2', { size: 13 })}
              </button>
            </div>
          </div>
        `;
      });
      this.exportsList.innerHTML = html;

      // Eventos de eliminar video
      this.exportsList.querySelectorAll('.btn-del-export').forEach(btn => {
        btn.addEventListener('click', () => this.deleteExport(btn.dataset.filename));
      });
    } catch (e) {
      this.exportsList.innerHTML = `<div style="grid-column: 1/-1; color:#f87171; padding:20px;">Error cargando videos: ${e.message}</div>`;
    }
  }

  async deleteExport(filename) {
    if (!confirm(`¿Eliminar permanentemente el video renderizado "${filename}"?`)) return;
    try {
      const res = await fetch(`/api/exports/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        this.showToast(`Video "${filename}" eliminado`, 'info');
        await this.fetchExports();
      } else {
        alert('Error: ' + (data.error || 'No se pudo eliminar'));
      }
    } catch (e) {
      alert('Error al eliminar video: ' + e.message);
    }
  }

  async shutdownSystem() {
    if (!confirm('¿Deseas salir y detener el servidor de Projection Mapper?')) return;
    try {
      if (this.shutdownOverlay) {
        this.shutdownOverlay.classList.remove('hidden');
      }
      await fetch('/api/system/shutdown', { method: 'POST' }).catch(() => {});
    } catch (e) {
      // Ignorar si la conexión se cierra al apagarse el servidor
    }
  }
}

window.UIController = UIController;
