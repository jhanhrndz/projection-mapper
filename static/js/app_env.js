/**
 * Projection Mapper Studio - App Environment Manager
 * Detecta si la aplicación se ejecuta en modo Nativo de Escritorio (Python + GPU/FFmpeg)
 * o en modo Demo Web en la Nube (Vercel / Host Estático).
 */
class AppEnvironment {
  constructor() {
    this.hostname = window.location.hostname;
    this.isLocalHost = this.hostname === 'localhost' || this.hostname === '127.0.0.1' || this.hostname === '';
    this.hasServer = false;
    this.isDemo = !this.isLocalHost;
    this.checked = false;
  }

  /**
   * Inicializa la comprobación de salud del servidor nativo.
   */
  async init() {
    if (!this.isLocalHost) {
      this.isDemo = true;
      this.hasServer = false;
      this.checked = true;
      return this.isDemo;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);
      const res = await fetch('/api/scenes', {
        method: 'GET',
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      this.hasServer = res.ok;
      this.isDemo = !this.hasServer;
    } catch {
      this.hasServer = false;
      this.isDemo = true;
    }
    this.checked = true;
    return this.isDemo;
  }

  isDemoMode() {
    return this.isDemo;
  }

  isNativeDesktop() {
    return this.hasServer && !this.isDemo;
  }
}

window.AppEnv = new AppEnvironment();
