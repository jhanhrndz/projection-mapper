"""video_exporter.py - Motor de renderizado y exportación de video pre-mapeado para Projection Mapping.
Compone fotograma a fotograma en segundo plano la escena completa (videos, imágenes, homografía, máscaras y capas)
produciendo un archivo .mp4 H.264 listo para proyectarse de forma autónoma desde un USB o reproductor multimedia.
"""

from __future__ import annotations

import json
import math
import os
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import cv2
import numpy as np

# Rutas base
BASE_DIR = Path(__file__).resolve().parent
MEDIA_DIR = BASE_DIR / "media"
EXPORTS_DIR = MEDIA_DIR / "exports"
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)

def evaluate_cubic_bezier(p0, c1, c2, p1, t):
    mt = 1.0 - t
    mt2 = mt * mt
    mt3 = mt2 * mt
    t2 = t * t
    t3 = t2 * t
    x = mt3 * p0[0] + 3.0 * mt2 * t * c1[0] + 3.0 * mt * t2 * c2[0] + t3 * p1[0]
    y = mt3 * p0[1] + 3.0 * mt2 * t * c1[1] + 3.0 * mt * t2 * c2[1] + t3 * p1[1]
    return [x, y]

def get_sampled_curved_polygon(points, edge_curves, samples_per_edge=24):
    if not points or len(points) < 3:
        return points
    n = len(points)
    res = []
    for i in range(n):
        next_idx = (i + 1) % n
        pA = points[i]
        pB = points[next_idx]
        curve_key = f"{i}-{next_idx}"
        alt_key = str(i)
        curve = edge_curves.get(curve_key) or edge_curves.get(alt_key)
        if curve and "c1" in curve and "c2" in curve:
            c1 = curve["c1"]
            c2 = curve["c2"]
            for s in range(samples_per_edge):
                t = s / float(samples_per_edge)
                res.append(evaluate_cubic_bezier(pA, c1, c2, pB, t))
        else:
            res.append([pA[0], pA[1]])
    return res

def get_ellipse_boundary(cx, cy, rx, ry, rotation_deg, samples=64):
    rad = math.radians(rotation_deg)
    cos_r = math.cos(rad)
    sin_r = math.sin(rad)
    pts = []
    for i in range(samples):
        theta = (i / float(samples)) * 2.0 * math.pi
        ex = rx * math.cos(theta)
        ey = ry * math.sin(theta)
        x = max(0.0, min(1.0, cx + (ex * cos_r - ey * sin_r)))
        y = max(0.0, min(1.0, cy + (ex * sin_r + ey * cos_r)))
        pts.append([x, y])
    return pts

_BEST_ENCODER_INFO = None


def probe_best_h264_encoder() -> tuple[str, str, bool, list[str]]:
    """Detecta el mejor codificador H.264 acelerado por hardware GPU disponible en FFmpeg.
    Retorna (codec_name, label, is_gpu, extra_flags).
    """
    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        return "none", "OpenCV VideoWriter (CPU)", False, []

    candidates = [
        ("h264_nvenc", "GPU NVIDIA (NVENC)", True, ["-c:v", "h264_nvenc", "-preset", "p4", "-pix_fmt", "yuv420p"]),
        ("h264_amf",   "GPU AMD Radeon (AMF)", True, ["-c:v", "h264_amf", "-usage", "transcoding", "-quality", "speed", "-pix_fmt", "yuv420p"]),
        ("h264_qsv",   "GPU Intel QuickSync", True, ["-c:v", "h264_qsv", "-preset", "fast", "-pix_fmt", "nv12"]),
        ("h264_mf",    "GPU Windows MediaFoundation", True, ["-c:v", "h264_mf", "-pix_fmt", "yuv420p"]),
        ("libx264",    "CPU Universal (libx264)", False, ["-c:v", "libx264", "-preset", "fast", "-crf", "19", "-pix_fmt", "yuv420p"])
    ]

    for codec, label, is_gpu, flags in candidates:
        try:
            test_cmd = [
                ffmpeg_path, "-y",
                "-f", "lavfi", "-i", "nullsrc=s=128x128:d=0.05",
                "-c:v", codec,
                "-f", "null", "-"
            ]
            res = subprocess.run(test_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=1.5)
            if res.returncode == 0:
                return codec, label, is_gpu, flags
        except Exception:
            continue

    return "libx264", "CPU Universal (libx264)", False, ["-c:v", "libx264", "-preset", "fast", "-crf", "19", "-pix_fmt", "yuv420p"]


def get_best_encoder_info():
    global _BEST_ENCODER_INFO
    if _BEST_ENCODER_INFO is None:
        _BEST_ENCODER_INFO = probe_best_h264_encoder()
    return _BEST_ENCODER_INFO


class VideoExporter:
    """Motor de composición y renderizado de video en segundo plano."""

    def __init__(self):
        self.lock = threading.Lock()
        self.status = "idle"  # "idle" | "rendering" | "completed" | "cancelled" | "error"
        self.progress = 0.0
        self.current_frame = 0
        self.total_frames = 0
        self.fps = 30
        self.eta_seconds = 0.0
        self.error_message = ""
        self.output_filename = ""
        self.output_url = ""
        self.start_time = 0.0
        self._cancel_requested = False
        self._thread: Optional[threading.Thread] = None

        codec, label, is_gpu, _ = get_best_encoder_info()
        self.encoder_name = codec
        self.encoder_label = label
        self.is_gpu = is_gpu

    def get_status(self) -> Dict[str, Any]:
        """Retorna el estado actual de la exportación."""
        with self.lock:
            return {
                "status": self.status,
                "progress": round(self.progress, 1),
                "current_frame": self.current_frame,
                "total_frames": self.total_frames,
                "fps": self.fps,
                "eta_seconds": round(self.eta_seconds, 1),
                "output_filename": self.output_filename,
                "output_url": self.output_url,
                "error": self.error_message,
                "encoder_name": self.encoder_name,
                "encoder_label": self.encoder_label,
                "is_gpu": self.is_gpu
            }

    def cancel(self):
        """Solicita la cancelación del renderizado en curso."""
        with self.lock:
            if self.status == "rendering":
                self._cancel_requested = True

    def start_export(self, scene_data: Dict[str, Any], options: Dict[str, Any]) -> bool:
        """Inicia el proceso de exportación en un hilo secundario."""
        with self.lock:
            if self.status == "rendering":
                return False

            self.status = "rendering"
            self.progress = 0.0
            self.current_frame = 0
            self.total_frames = 0
            self.eta_seconds = 0.0
            self.error_message = ""
            self.output_filename = ""
            self.output_url = ""
            self._cancel_requested = False
            self.start_time = time.time()

        self._thread = threading.Thread(
            target=self._render_worker,
            args=(scene_data, options),
            daemon=True
        )
        self._thread.start()
        return True

    def _resolve_media_path(self, src: str) -> Optional[Path]:
        """Resuelve una ruta de archivo local a partir de la URL relativa."""
        if not src:
            return None
        clean_src = src.lstrip("/").split("?")[0]
        local_path = BASE_DIR / clean_src
        if local_path.exists() and local_path.is_file():
            return local_path
        return None

    def detect_loop_duration(self, scene_data: Dict[str, Any]) -> float:
        """Calcula la duración recomendada del bucle examinando los videos asignados."""
        max_duration = 0.0
        polygons = scene_data.get("polygons", [])

        for poly in polygons:
            media = poly.get("media")
            if media and media.get("type") == "video" and media.get("src"):
                local_path = self._resolve_media_path(media["src"])
                if local_path:
                    try:
                        cap = cv2.VideoCapture(str(local_path))
                        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
                        frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
                        cap.release()
                        if fps > 0 and frame_count > 0:
                            dur = frame_count / fps
                            if dur > max_duration:
                                max_duration = dur
                    except Exception:
                        pass

        # Por defecto 10 segundos si no hay videos o duración nula
        return max_duration if max_duration > 0.5 else 10.0

    def _render_worker(self, scene_data: Dict[str, Any], options: Dict[str, Any]):
        """Bucle principal de renderizado fotograma a fotograma."""
        ffmpeg_proc = None
        cv_writer = None
        caps: Dict[str, cv2.VideoCapture] = {}
        cached_images: Dict[str, np.ndarray] = {}

        try:
            # 1. Parámetros de configuración
            width = int(options.get("width", 1920))
            height = int(options.get("height", 1080))
            fps = int(options.get("fps", 30))
            self.fps = fps

            raw_duration = options.get("duration")
            if raw_duration and float(raw_duration) > 0:
                duration = float(raw_duration)
            else:
                duration = self.detect_loop_duration(scene_data)

            total_frames = max(1, int(round(duration * fps)))
            with self.lock:
                self.total_frames = total_frames

            # Nombre de archivo de salida
            safe_scene_name = re.sub(r'[^a-zA-Z0-9_\-]', '', scene_data.get("name", "mapping")) or "mapping"
            timestamp = int(time.time())
            filename = f"{safe_scene_name}_{width}x{height}_{fps}fps_{timestamp}.mp4"
            output_path = EXPORTS_DIR / filename

            # 2. Inicializar recursos multimedia
            polygons = scene_data.get("polygons", [])
            for poly in polygons:
                poly_id = poly.get("id")
                media = poly.get("media")
                if not media or not media.get("src"):
                    continue

                local_path = self._resolve_media_path(media["src"])
                if not local_path:
                    continue

                mtype = media.get("type", "image")
                if mtype == "video":
                    cap = cv2.VideoCapture(str(local_path))
                    if cap.isOpened():
                        caps[poly_id] = cap
                elif mtype == "image":
                    # Carga y cacheo de imagen
                    img = cv2.imread(str(local_path), cv2.IMREAD_COLOR)
                    if img is not None:
                        cached_images[poly_id] = img

            # 3. Inicializar codificador de video (Aceleración Híbrida Inteligente GPU/CPU)
            ffmpeg_path = shutil.which("ffmpeg")
            use_ffmpeg = ffmpeg_path is not None

            if use_ffmpeg:
                codec, label, is_gpu, extra_flags = get_best_encoder_info()
                with self.lock:
                    self.encoder_name = codec
                    self.encoder_label = label
                    self.is_gpu = is_gpu

                base_cmd = [
                    ffmpeg_path, "-y",
                    "-f", "rawvideo",
                    "-vcodec", "rawvideo",
                    "-s", f"{width}x{height}",
                    "-pix_fmt", "bgr24",
                    "-r", str(fps),
                    "-i", "-"
                ]
                cmd = base_cmd + extra_flags + [str(output_path)]

                try:
                    ffmpeg_proc = subprocess.Popen(
                        cmd,
                        stdin=subprocess.PIPE,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL
                    )
                except Exception as ex:
                    # Fallback inmediato a CPU libx264 si el backend de GPU falla al arrancar
                    print(f"[VideoExporter] Fallo al iniciar {codec}: {ex}. Conmutando a CPU libx264.")
                    with self.lock:
                        self.encoder_name = "libx264"
                        self.encoder_label = "CPU Universal (libx264) [Fallback]"
                        self.is_gpu = False
                    cmd = base_cmd + ["-c:v", "libx264", "-preset", "fast", "-crf", "19", "-pix_fmt", "yuv420p", str(output_path)]
                    ffmpeg_proc = subprocess.Popen(
                        cmd,
                        stdin=subprocess.PIPE,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL
                    )
            else:
                # Fallback con OpenCV VideoWriter
                fourcc = cv2.VideoWriter_fourcc(*'mp4v')
                cv_writer = cv2.VideoWriter(str(output_path), fourcc, float(fps), (width, height))
                if not cv_writer.isOpened():
                    raise RuntimeError("No se pudo inicializar el codificador de video de OpenCV.")

            # 4. Renderizado fotograma a fotograma
            for frame_idx in range(total_frames):
                if self._cancel_requested:
                    with self.lock:
                        self.status = "cancelled"
                    break

                t = frame_idx / fps

                # Lienzo base en negro puro (#000000)
                canvas = np.zeros((height, width, 3), dtype=np.uint8)

                # Componer superficies en estricto orden de capas (Z-Index)
                for poly in polygons:
                    if not poly.get("visible", True):
                        continue

                    ptype = poly.get("type", "quad")
                    is_circular = ptype in ("circle", "circle_occluder")
                    is_occluder = ptype in ("occluder", "circle_occluder")
                    edge_curves = poly.get("edgeCurves") or {}
                    has_edge_curves = bool(edge_curves) and not is_circular

                    if is_circular:
                        center = poly.get("center", [0.5, 0.5])
                        rx = float(poly.get("radiusX", 0.18))
                        ry = float(poly.get("radiusY", 0.18))
                        rot = float(poly.get("rotation", 0))
                        norm_pts = get_ellipse_boundary(center[0], center[1], rx, ry, rot, 64)
                    elif has_edge_curves:
                        norm_pts = get_sampled_curved_polygon(poly.get("points", []), edge_curves, 24)
                    else:
                        norm_pts = poly.get("points", [])

                    if len(norm_pts) < 3:
                        continue

                    # Coordenadas escaladas al lienzo
                    pixel_pts = np.float32([[p[0] * width, p[1] * height] for p in norm_pts])
                    int_pts = np.int32(pixel_pts)
                    media = poly.get("media")

                    # Caso A: Máscara de Oclusión (Negro absoluto #000000)
                    if is_occluder:
                        cv2.fillPoly(canvas, [int_pts], (0, 0, 0))
                        continue

                    # Caso B: Cuadrilátero, Círculo o Polígono con Video o Imagen
                    poly_id = poly.get("id")
                    source_frame = None

                    if media and media.get("type") == "video" and poly_id in caps:
                        cap = caps[poly_id]
                        vid_fps = cap.get(cv2.CAP_PROP_FPS) or fps
                        vid_total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                        rate = float(media.get("playbackRate", 1.0)) or 1.0

                        if vid_total_frames > 0 and vid_fps > 0:
                            target_frame_num = int((t * rate * vid_fps) % vid_total_frames)
                            cap.set(cv2.CAP_PROP_POS_FRAMES, target_frame_num)
                            ret, f = cap.read()
                            if ret and f is not None:
                                source_frame = f

                    elif media and media.get("type") == "image" and poly_id in cached_images:
                        source_frame = cached_images[poly_id]

                    # Si hay textura que proyectar
                    if source_frame is not None:
                        src_h, src_w = source_frame.shape[:2]
                        opacity = float(media.get("opacity", 1.0)) if media else 1.0

                        if ptype == "quad" and not is_circular and not has_edge_curves and len(pixel_pts) == 4:
                            src_pts = np.float32([
                                [0, 0],
                                [src_w - 1, 0],
                                [src_w - 1, src_h - 1],
                                [0, src_h - 1]
                            ])
                            # Matriz de homografía 3x3 exacta
                            M = cv2.getPerspectiveTransform(src_pts, pixel_pts)
                            warped = cv2.warpPerspective(
                                source_frame, M, (width, height),
                                flags=cv2.INTER_LINEAR,
                                borderMode=cv2.BORDER_CONSTANT,
                                borderValue=(0, 0, 0)
                            )
                            # Máscara de recorte poligonal
                            mask = np.zeros((height, width), dtype=np.uint8)
                            cv2.fillPoly(mask, [int_pts], 255)

                            if opacity >= 0.99:
                                cv2.copyTo(warped, mask, canvas)
                            else:
                                blended = cv2.addWeighted(canvas, 1.0 - opacity, warped, opacity, 0)
                                cv2.copyTo(blended, mask, canvas)

                        elif len(pixel_pts) >= 3:
                            # Círculo, Elipse, Polígono Curvo Bézier o Polígono Libre
                            xs = [p[0] for p in pixel_pts]
                            ys = [p[1] for p in pixel_pts]
                            min_x, max_x = max(0, int(min(xs))), min(width, int(max(xs)))
                            min_y, max_y = max(0, int(min(ys))), min(height, int(max(ys)))
                            bb_w = max(1, max_x - min_x)
                            bb_h = max(1, max_y - min_y)

                            resized = cv2.resize(source_frame, (bb_w, bb_h), interpolation=cv2.INTER_LINEAR)
                            patch = np.zeros((height, width, 3), dtype=np.uint8)
                            patch[min_y:min_y+bb_h, min_x:min_x+bb_w] = resized

                            mask = np.zeros((height, width), dtype=np.uint8)
                            cv2.fillPoly(mask, [int_pts], 255)

                            if opacity >= 0.99:
                                cv2.copyTo(patch, mask, canvas)
                            else:
                                blended = cv2.addWeighted(canvas, 1.0 - opacity, patch, opacity, 0)
                                cv2.copyTo(blended, mask, canvas)

                    else:
                        # Si no tiene imagen ni video, dibujar color sólido de guía si tiene opacidad
                        hex_color = poly.get("color", "#00f0ff").lstrip("#")
                        if len(hex_color) == 6:
                            r = int(hex_color[0:2], 16)
                            g = int(hex_color[2:4], 16)
                            b = int(hex_color[4:6], 16)
                            cv2.fillPoly(canvas, [int_pts], (b, g, r))

                # Escribir fotograma en codificador
                if use_ffmpeg and ffmpeg_proc and ffmpeg_proc.stdin:
                    ffmpeg_proc.stdin.write(canvas.tobytes())
                elif cv_writer:
                    cv_writer.write(canvas)

                # 5. Actualizar progreso y tiempo estimado
                elapsed = time.time() - self.start_time
                done_count = frame_idx + 1
                prog = (done_count / total_frames) * 100.0
                fps_actual = done_count / max(0.01, elapsed)
                remaining_frames = total_frames - done_count
                eta = remaining_frames / max(0.1, fps_actual)

                with self.lock:
                    self.progress = prog
                    self.current_frame = done_count
                    self.eta_seconds = eta

            # Finalizar escritura y cerrar procesos
            if use_ffmpeg and ffmpeg_proc:
                if ffmpeg_proc.stdin:
                    try:
                        ffmpeg_proc.stdin.close()
                    except Exception:
                        pass
                try:
                    ffmpeg_proc.wait(timeout=3)
                except Exception:
                    try:
                        ffmpeg_proc.kill()
                    except Exception:
                        pass
            elif cv_writer:
                cv_writer.release()
                cv_writer = None

            # 6. Finalización exitosa vs Cancelación
            if self._cancel_requested:
                with self.lock:
                    self.status = "cancelled"
                    self.progress = 0.0
                    self.current_frame = 0
                    self.eta_seconds = 0.0
                    self.output_filename = ""
                    self.output_url = ""
                # Eliminar archivo incompleto/truncado del disco
                try:
                    if output_path and output_path.exists():
                        output_path.unlink(missing_ok=True)
                        print(f"[VideoExporter] Archivo incompleto cancelado '{filename}' eliminado del disco.")
                except Exception as del_err:
                    print(f"[VideoExporter] Advertencia al eliminar archivo cancelado: {del_err}")
            else:
                with self.lock:
                    self.status = "completed"
                    self.progress = 100.0
                    self.eta_seconds = 0.0
                    self.output_filename = filename
                    self.output_url = f"/media/exports/{filename}"

        except Exception as e:
            with self.lock:
                self.status = "error"
                self.error_message = str(e)
                self.output_filename = ""
                self.output_url = ""
            # Limpiar archivo en caso de error fatal durante el renderizado
            try:
                if use_ffmpeg and ffmpeg_proc:
                    try:
                        ffmpeg_proc.kill()
                    except Exception:
                        pass
                if cv_writer:
                    try:
                        cv_writer.release()
                    except Exception:
                        pass
                if output_path and output_path.exists():
                    output_path.unlink(missing_ok=True)
                    print(f"[VideoExporter] Archivo corrupto por error '{filename}' eliminado del disco.")
            except Exception:
                pass
        finally:
            for cap in caps.values():
                try:
                    cap.release()
                except Exception:
                    pass
            if cv_writer:
                try:
                    cv_writer.release()
                except Exception:
                    pass


# Instancia singleton global del exportador
global_exporter = VideoExporter()
