"""Server local para el software de Projection Mapping.
Provee servicio de archivos estáticos, soporte de rangos para video (HTTP 206)
y API REST para guardar y cargar escenas en formato JSON.
"""

from __future__ import annotations

import base64
import io
import json
import mimetypes
import os
import re
import shutil
import sys
import threading
import zipfile
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from video_exporter import global_exporter

# Directorios base
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
SCENES_DIR = BASE_DIR / "scenes"
MEDIA_DIR = BASE_DIR / "media"
EXPORTS_DIR = MEDIA_DIR / "exports"

# Asegurar directorios
SCENES_DIR.mkdir(parents=True, exist_ok=True)
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
(MEDIA_DIR / "images").mkdir(exist_ok=True)
(MEDIA_DIR / "videos").mkdir(exist_ok=True)
EXPORTS_DIR.mkdir(exist_ok=True)

DEFAULT_PORT = 8085


class ProjectionMappingHandler(SimpleHTTPRequestHandler):
    """Manejador HTTP con soporte para API REST y streaming de video por rangos."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def end_headers(self):
        # Deshabilitar caché agresivamente para desarrollo y cambios en tiempo real
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Range")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # Rutas amigables
        if path in ("/", "/index.html"):
            self.path = "/static/index.html"
            return super().do_GET()
        elif path in ("/projector", "/projector.html"):
            self.path = "/static/projector.html"
            return super().do_GET()

        # API: Listar escenas guardadas
        if path == "/api/scenes":
            self.handle_list_scenes()
            return

        # API: Obtener una escena específica
        if path.startswith("/api/scenes/"):
            scene_name = path.replace("/api/scenes/", "").strip()
            self.handle_get_scene(scene_name)
            return

        # API: Listar archivos multimedia disponibles
        if path == "/api/media":
            self.handle_list_media()
            return

        # API: Estado de exportación de video
        if path == "/api/export/status":
            self.send_json_response(global_exporter.get_status())
            return

        # API: Listar videos exportados en media/exports/
        if path == "/api/exports":
            self.handle_list_exports()
            return

        # API: Exportar proyecto (.pmap) por nombre vía GET
        if path == "/api/project/export":
            query = parse_qs(parsed.query)
            scene_name = query.get("name", [""])[0].strip()
            self.handle_export_project(scene_name=scene_name)
            return

        # Archivos estáticos y multimedia normales
        if path.startswith("/static/"):
            return super().do_GET()
        elif path.startswith("/media/"):
            return self.handle_media_stream()

        # Fallback a super
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # API: Guardar escena
        if path == "/api/scenes":
            self.handle_save_scene()
            return

        # API: Duplicar escena
        if path.startswith("/api/scenes/") and path.endswith("/duplicate"):
            scene_name = path.replace("/api/scenes/", "").replace("/duplicate", "").strip()
            self.handle_duplicate_scene(scene_name)
            return

        # API: Subir archivo multimedia (imagen/video)
        if path == "/api/upload":
            self.handle_upload_file()
            return

        # API: Exportar paquete de proyecto autónomo (.pmap)
        if path == "/api/project/export":
            self.handle_export_project()
            return

        # API: Importar proyecto (.pmap o .json)
        if path == "/api/project/import":
            self.handle_import_project()
            return

        # API: Iniciar exportación de video pre-mapeado
        if path == "/api/export/video":
            self.handle_start_export()
            return

        # API: Cancelar exportación de video
        if path == "/api/export/cancel":
            global_exporter.cancel()
            self.send_json_response({"success": True, "status": "cancelled"})
            return

        # API: Apagar servidor de forma segura
        if path == "/api/system/shutdown":
            self.handle_shutdown()
            return

        self.send_error(HTTPStatus.NOT_FOUND, "Ruta no encontrada")

    def do_DELETE(self):
        content_len = int(self.headers.get("Content-Length", 0))
        if content_len > 0:
            self.rfile.read(content_len)
        parsed = urlparse(self.path)
        path = parsed.path

        # API: Eliminar escena
        if path.startswith("/api/scenes/"):
            scene_name = path.replace("/api/scenes/", "").strip()
            self.handle_delete_scene(scene_name)
            return

        # API: Eliminar video renderizado
        if path.startswith("/api/exports/"):
            export_file = path.replace("/api/exports/", "").strip()
            self.handle_delete_export(export_file)
            return

        self.send_error(HTTPStatus.NOT_FOUND, "Ruta no encontrada")

    def handle_list_scenes(self):
        """Retorna una lista de escenas JSON guardadas con metadatos ricos y vista previa."""
        scenes = []
        for file in SCENES_DIR.glob("*.json"):
            try:
                stat = file.stat()
                surface_count = 0
                quad_count = 0
                occluder_count = 0
                preview_polygons = []

                with open(file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    polys = data.get("polygons", [])
                    surface_count = len(polys)
                    for p in polys:
                        ptype = p.get("type", "quad")
                        if ptype == "occluder":
                            occluder_count += 1
                        elif ptype == "quad":
                            quad_count += 1
                        preview_polygons.append({
                            "points": p.get("points", []),
                            "type": ptype,
                            "color": p.get("color", "#00f0ff")
                        })

                scenes.append({
                    "name": file.stem,
                    "filename": file.name,
                    "modified": stat.st_mtime,
                    "size": stat.st_size,
                    "surface_count": surface_count,
                    "quad_count": quad_count,
                    "occluder_count": occluder_count,
                    "preview_polygons": preview_polygons
                })
            except Exception:
                continue
        scenes.sort(key=lambda s: s["modified"], reverse=True)
        self.send_json_response(scenes)

    def handle_get_scene(self, name: str):
        """Carga y retorna el contenido de una escena JSON."""
        safe_name = re.sub(r'[^a-zA-Z0-9_\-]', '', name)
        file_path = SCENES_DIR / f"{safe_name}.json"
        if not file_path.exists():
            self.send_json_response({"error": "Escena no encontrada"}, status=HTTPStatus.NOT_FOUND)
            return

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.send_json_response(data)
        except Exception as e:
            self.send_json_response({"error": str(e)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)

    def handle_delete_scene(self, name: str):
        """Elimina una escena del servidor y purga archivos multimedia huérfanos que no use otra escena."""
        safe_name = re.sub(r'[^a-zA-Z0-9_\-]', '', name)
        file_path = SCENES_DIR / f"{safe_name}.json"
        if not file_path.exists():
            self.send_json_response({"error": "Escena no encontrada"}, status=HTTPStatus.NOT_FOUND)
            return

        try:
            # 1. Leer los archivos multimedia que utilizaba esta escena
            with open(file_path, "r", encoding="utf-8") as f:
                scene_data = json.load(f)

            scene_media_files = set()
            for poly in scene_data.get("polygons", []):
                src = poly.get("media", {}).get("src")
                if src and isinstance(src, str) and not src.startswith("data:"):
                    clean_name = Path(urlparse(src).path).name
                    if clean_name and clean_name != "test_grid.svg":
                        scene_media_files.add(clean_name)

            # 2. Leer todas las demás escenas para ver si alguna comparte estos archivos
            other_scenes_media = set()
            for other_file in SCENES_DIR.glob("*.json"):
                if other_file.name == f"{safe_name}.json":
                    continue
                try:
                    with open(other_file, "r", encoding="utf-8") as of:
                        other_data = json.load(of)
                        for poly in other_data.get("polygons", []):
                            src = poly.get("media", {}).get("src")
                            if src and isinstance(src, str) and not src.startswith("data:"):
                                clean_name = Path(urlparse(src).path).name
                                if clean_name:
                                    other_scenes_media.add(clean_name)
                except Exception:
                    continue

            # 3. Eliminar archivos huérfanos (solo pertenecían a esta escena)
            orphaned_files = scene_media_files - other_scenes_media
            deleted_media_count = 0
            for fname in orphaned_files:
                for candidate_dir in [MEDIA_DIR / "images", MEDIA_DIR / "videos", MEDIA_DIR]:
                    candidate_file = candidate_dir / fname
                    if candidate_file.is_file():
                        try:
                            candidate_file.unlink()
                            deleted_media_count += 1
                            print(f"[Purge] Archivo multimedia huérfano eliminado: {candidate_file}")
                        except Exception as purge_err:
                            print(f"[Purge] Error eliminando {candidate_file}: {purge_err}")

            # 4. Eliminar el archivo de escena
            file_path.unlink()
            self.send_json_response({
                "success": True,
                "deleted": safe_name,
                "orphaned_media_deleted": deleted_media_count,
                "message": f"Escena '{safe_name}' eliminada correctamente ({deleted_media_count} archivos multimedia huérfanos liberados)."
            })
        except Exception as e:
            self.send_json_response({"error": str(e)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)

    def handle_duplicate_scene(self, name: str):
        """Duplica una escena existente."""
        content_len = int(self.headers.get("Content-Length", 0))
        if content_len > 0:
            self.rfile.read(content_len)

        safe_name = re.sub(r'[^a-zA-Z0-9_\-]', '', name)
        src_path = SCENES_DIR / f"{safe_name}.json"
        if not src_path.exists():
            self.send_json_response({"error": "Escena no encontrada"}, status=HTTPStatus.NOT_FOUND)
            return

        try:
            new_name = f"{safe_name}_copia"
            dst_path = SCENES_DIR / f"{new_name}.json"
            counter = 1
            while dst_path.exists():
                new_name = f"{safe_name}_copia_{counter}"
                dst_path = SCENES_DIR / f"{new_name}.json"
                counter += 1

            with open(src_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            data["name"] = new_name

            with open(dst_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

            self.send_json_response({"success": True, "new_name": new_name})
        except Exception as e:
            self.send_json_response({"error": str(e)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)

    def handle_upload_file(self):
        """Sube un archivo de imagen o video validando estrictamente formatos y tamaño máximo (50 MB)."""
        try:
            import base64
            content_len = int(self.headers.get("Content-Length", 0))
            max_upload_size = 50 * 1024 * 1024  # 50 MB
            if content_len > max_upload_size:
                mb_size = content_len / (1024 * 1024)
                self.close_connection = True
                self.send_json_response({
                    "error": f"El archivo supera el tamaño máximo permitido de 50 MB (recibido: {mb_size:.1f} MB). Optimiza el video antes de subirlo."
                }, status=HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
                return

            body = self.rfile.read(content_len).decode("utf-8")
            payload = json.loads(body)

            filename = payload.get("filename", "media_file")
            safe_filename = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', filename)
            ext = Path(safe_filename).suffix.lower()

            allowed_images = {".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"}
            allowed_videos = {".mp4", ".webm", ".mov"}

            if ext in allowed_images:
                media_type = "image"
                target_dir = MEDIA_DIR / "images"
                rel_url = f"/media/images/{safe_filename}"
            elif ext in allowed_videos:
                media_type = "video"
                target_dir = MEDIA_DIR / "videos"
                rel_url = f"/media/videos/{safe_filename}"
            else:
                self.send_json_response({
                    "error": f"Formato '{ext}' no permitido. Permitidos: PNG, JPG, WEBP, SVG, GIF (Imágenes); MP4, WEBM, MOV (Videos)."
                }, status=HTTPStatus.BAD_REQUEST)
                return

            target_dir.mkdir(parents=True, exist_ok=True)
            data_url = payload.get("data", "")

            # Extraer bytes desde base64
            if "," in data_url:
                header, encoded = data_url.split(",", 1)
            else:
                encoded = data_url

            file_bytes = base64.b64decode(encoded)
            target_path = target_dir / safe_filename
            with open(target_path, "wb") as f:
                f.write(file_bytes)

            self.send_json_response({
                "success": True,
                "url": rel_url,
                "filename": safe_filename,
                "media_type": media_type
            })
        except Exception as e:
            self.send_json_response({"error": str(e)}, status=HTTPStatus.BAD_REQUEST)

    def handle_save_scene(self):
        """Guarda una escena en disco."""
        try:
            content_len = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_len).decode("utf-8")
            payload = json.loads(body)

            name = payload.get("name", "untitled").strip()
            safe_name = re.sub(r'[^a-zA-Z0-9_\-]', '', name) or "scene"
            file_path = SCENES_DIR / f"{safe_name}.json"

            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2, ensure_ascii=False)

            self.send_json_response({"success": True, "name": safe_name, "path": str(file_path)})
        except Exception as e:
            self.send_json_response({"error": str(e)}, status=HTTPStatus.BAD_REQUEST)

    def handle_export_project(self, scene_name: str = ""):
        """Empaqueta una escena y todos sus recursos multimedia en un archivo autónomo .pmap (ZIP)."""
        try:
            scene_data = None
            if self.command == "POST":
                content_len = int(self.headers.get("Content-Length", 0))
                if content_len > 0:
                    body = self.rfile.read(content_len).decode("utf-8")
                    payload = json.loads(body)
                    if "scene" in payload:
                        scene_data = payload["scene"]
                        if not scene_name and "name" in payload:
                            scene_name = payload["name"]
                    else:
                        scene_data = payload

            if not scene_data and scene_name:
                safe_name = re.sub(r'[^a-zA-Z0-9_\-]', '', scene_name)
                file_path = SCENES_DIR / f"{safe_name}.json"
                if file_path.exists():
                    with open(file_path, "r", encoding="utf-8") as f:
                        scene_data = json.load(f)

            if not scene_data:
                self.send_json_response({"error": "No se proporcionaron datos de escena válidos"}, status=HTTPStatus.BAD_REQUEST)
                return

            proj_name = scene_name or scene_data.get("name") or "proyecto_mapping"
            safe_proj_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', proj_name) or "proyecto_mapping"

            # Clonar estructura de escena para empaquetar
            packaged_scene = json.loads(json.dumps(scene_data))
            packaged_scene["name"] = safe_proj_name

            media_files_to_pack = {}  # arcname -> Path en disco local
            embedded_data_to_pack = {}  # arcname -> bytes

            polygons = packaged_scene.get("polygons", [])
            for idx, poly in enumerate(polygons):
                media = poly.get("media")
                if not media or not isinstance(media, dict):
                    continue
                src = media.get("src")
                if not src or not isinstance(src, str):
                    continue

                src_clean = src.strip()
                # Caso 1: data URL (ej. imagen embebida en base64)
                if src_clean.startswith("data:"):
                    try:
                        header, encoded = src_clean.split(",", 1)
                        media_bytes = base64.b64decode(encoded)
                        ext = ".png"
                        if "image/jpeg" in header:
                            ext = ".jpg"
                        elif "image/webp" in header:
                            ext = ".webp"
                        elif "video/mp4" in header:
                            ext = ".mp4"
                        arcname = f"media/images/embedded_{idx + 1}{ext}"
                        embedded_data_to_pack[arcname] = media_bytes
                        poly["media"]["src"] = arcname
                    except Exception:
                        pass
                    continue

                # Caso 2: ruta URL o archivo local
                parsed_src = urlparse(src_clean).path.lstrip("/")
                filename = Path(parsed_src).name
                ext = Path(filename).suffix.lower()

                # Buscar el archivo en disco
                candidate_paths = [
                    BASE_DIR / parsed_src,
                    MEDIA_DIR / filename,
                    MEDIA_DIR / "images" / filename,
                    MEDIA_DIR / "videos" / filename,
                ]

                found_file = None
                for c in candidate_paths:
                    if c.is_file():
                        found_file = c
                        break

                if found_file:
                    subdir = "videos" if ext in {".mp4", ".webm", ".mov"} else "images"
                    arcname = f"media/{subdir}/{filename}"
                    media_files_to_pack[arcname] = found_file
                    poly["media"]["src"] = arcname

            # Construir ZIP en memoria
            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
                # Escribir project.json
                proj_json_bytes = json.dumps(packaged_scene, indent=2, ensure_ascii=False).encode("utf-8")
                zf.writestr("project.json", proj_json_bytes)

                # Empaquetar archivos locales
                for arcname, fpath in media_files_to_pack.items():
                    try:
                        zf.write(str(fpath), arcname=arcname)
                    except Exception as err:
                        print(f"[Export] Error agregando archivo {fpath}: {err}")

                # Empaquetar datos embebidos
                for arcname, dbytes in embedded_data_to_pack.items():
                    zf.writestr(arcname, dbytes)

            zip_bytes = zip_buffer.getvalue()

            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Disposition", f'attachment; filename="{safe_proj_name}.pmap"')
            self.send_header("Content-Length", str(len(zip_bytes)))
            self.end_headers()
            self.wfile.write(zip_bytes)
        except Exception as e:
            self.send_json_response({"error": f"Fallo al exportar paquete .pmap: {str(e)}"}, status=HTTPStatus.INTERNAL_SERVER_ERROR)

    def handle_import_project(self):
        """Importa un archivo de proyecto autónomo .pmap (ZIP) o una escena .json."""
        try:
            content_len = int(self.headers.get("Content-Length", 0))
            if content_len <= 0:
                self.send_json_response({"error": "Cuerpo de solicitud vacío"}, status=HTTPStatus.BAD_REQUEST)
                return

            file_bytes = self.rfile.read(content_len)

            # Extraer nombre original sugerido si viene en encabezados
            orig_filename = self.headers.get("X-Filename", "")
            if orig_filename:
                orig_filename = unquote(orig_filename)

            # Si viene como JSON con Base64 (fallback):
            if file_bytes.lstrip().startswith(b'{'):
                try:
                    payload = json.loads(file_bytes.decode("utf-8"))
                    # Si es formato upload { filename: "...", data: "..." }
                    if "data" in payload and isinstance(payload["data"], str):
                        data_str = payload["data"]
                        if "," in data_str:
                            _, b64data = data_str.split(",", 1)
                        else:
                            b64data = data_str
                        file_bytes = base64.b64decode(b64data)
                        if "filename" in payload:
                            orig_filename = payload["filename"]
                    elif "polygons" in payload:
                        # Es directamente una escena JSON cruda enviada como JSON
                        scene_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', payload.get("name") or orig_filename or "escena_importada")
                        payload["name"] = scene_name
                        dest_file = SCENES_DIR / f"{scene_name}.json"
                        with open(dest_file, "w", encoding="utf-8") as f:
                            json.dump(payload, f, indent=2, ensure_ascii=False)
                        self.send_json_response({
                            "success": True,
                            "name": scene_name,
                            "scene": payload,
                            "message": f"Escena '{scene_name}' importada exitosamente."
                        })
                        return
                except Exception:
                    pass

            # Detectar si es un archivo ZIP (.pmap) revisando cabecera PK\x03\x04 o PK\x05\x06
            is_zip = file_bytes.startswith(b"PK")

            if is_zip:
                zf = zipfile.ZipFile(io.BytesIO(file_bytes))
                namelist = zf.namelist()

                # Buscar project.json
                json_arcname = None
                for n in namelist:
                    if Path(n).name.lower() == "project.json":
                        json_arcname = n
                        break
                if not json_arcname:
                    # Buscar cualquier .json si no se llama project.json
                    for n in namelist:
                        if n.lower().endswith(".json"):
                            json_arcname = n
                            break

                if not json_arcname:
                    self.send_json_response({
                        "error": "El paquete .pmap no contiene un archivo 'project.json' válido."
                    }, status=HTTPStatus.BAD_REQUEST)
                    return

                with zf.open(json_arcname) as jf:
                    scene_data = json.loads(jf.read().decode("utf-8"))

                # Nombre de la escena importada
                proj_name = scene_data.get("name") or Path(orig_filename).stem or "proyecto_importado"
                safe_scene_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', proj_name) or "proyecto_importado"
                scene_data["name"] = safe_scene_name

                # Extraer recursos multimedia
                remap_table = {}
                for item in zf.infolist():
                    if item.is_dir():
                        continue
                    if item.filename == json_arcname or item.filename.lower().endswith(".json"):
                        continue

                    # Protección contra Zip Slip
                    raw_name = Path(item.filename).name
                    safe_file_name = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', raw_name)
                    ext = Path(safe_file_name).suffix.lower()

                    if ext in {".mp4", ".webm", ".mov"}:
                        target_dir = MEDIA_DIR / "videos"
                        url_prefix = "/media/videos"
                    else:
                        target_dir = MEDIA_DIR / "images"
                        url_prefix = "/media/images"

                    target_dir.mkdir(parents=True, exist_ok=True)
                    dest_path = target_dir / safe_file_name

                    # Si ya existe con tamaño distinto, renombrar para no sobrescribir material previo
                    if dest_path.exists() and dest_path.stat().st_size != item.file_size:
                        stem = Path(safe_file_name).stem
                        counter = 1
                        while dest_path.exists() and dest_path.stat().st_size != item.file_size:
                            safe_file_name = f"{stem}_{counter}{ext}"
                            dest_path = target_dir / safe_file_name
                            counter += 1

                    # Extraer archivo
                    with zf.open(item) as src_stream, open(dest_path, "wb") as dst_stream:
                        shutil.copyfileobj(src_stream, dst_stream)

                    new_url = f"{url_prefix}/{safe_file_name}"
                    remap_table[item.filename] = new_url
                    remap_table[item.filename.replace("\\", "/")] = new_url
                    remap_table[raw_name] = new_url

                # Remapear rutas en las superficies de la escena
                for poly in scene_data.get("polygons", []):
                    med = poly.get("media")
                    if med and isinstance(med, dict) and med.get("src"):
                        old_src = med["src"].replace("\\", "/")
                        old_base = Path(old_src).name
                        if old_src in remap_table:
                            med["src"] = remap_table[old_src]
                        elif old_base in remap_table:
                            med["src"] = remap_table[old_base]
                        elif not old_src.startswith("http") and not old_src.startswith("/media/"):
                            # Si era ruta relativa pero no extraída, normalizar a /media/
                            ext = Path(old_base).suffix.lower()
                            sub = "videos" if ext in {".mp4", ".webm", ".mov"} else "images"
                            med["src"] = f"/media/{sub}/{old_base}"

                # Guardar la escena importada en disco en scenes/
                dest_scene_file = SCENES_DIR / f"{safe_scene_name}.json"
                with open(dest_scene_file, "w", encoding="utf-8") as sf:
                    json.dump(scene_data, sf, indent=2, ensure_ascii=False)

                self.send_json_response({
                    "success": True,
                    "name": safe_scene_name,
                    "scene": scene_data,
                    "media_count": len(remap_table),
                    "message": f"Proyecto '{safe_scene_name}' importado con éxito ({len(remap_table)} archivos multimedia vinculados)."
                })
                return

            else:
                # Intentar parsear como JSON directo
                try:
                    scene_data = json.loads(file_bytes.decode("utf-8"))
                    scene_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', scene_data.get("name") or Path(orig_filename).stem or "escena_importada")
                    scene_data["name"] = scene_name
                    dest_file = SCENES_DIR / f"{scene_name}.json"
                    with open(dest_file, "w", encoding="utf-8") as f:
                        json.dump(scene_data, f, indent=2, ensure_ascii=False)

                    self.send_json_response({
                        "success": True,
                        "name": scene_name,
                        "scene": scene_data,
                        "media_count": 0,
                        "message": f"Escena '{scene_name}' importada exitosamente."
                    })
                    return
                except Exception as json_err:
                    self.send_json_response({
                        "error": f"El archivo no es un paquete .pmap válido ni un archivo JSON legible: {str(json_err)}"
                    }, status=HTTPStatus.BAD_REQUEST)
                    return

        except Exception as e:
            self.send_json_response({"error": f"Fallo al procesar importación: {str(e)}"}, status=HTTPStatus.INTERNAL_SERVER_ERROR)

    def handle_start_export(self):
        """Inicia el renderizado de video en segundo plano."""
        try:
            content_len = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_len).decode("utf-8")
            payload = json.loads(body)

            scene = payload.get("scene", {})
            options = payload.get("options", {})

            started = global_exporter.start_export(scene, options)
            if started:
                self.send_json_response({"success": True, "status": "rendering"})
            else:
                self.send_json_response({
                    "error": "Ya hay un renderizado en curso. Espera o cancela el actual."
                }, status=HTTPStatus.CONFLICT)
        except Exception as e:
            self.send_json_response({"error": str(e)}, status=HTTPStatus.BAD_REQUEST)

    def handle_list_media(self):
        """Retorna imágenes y videos disponibles en la carpeta media/."""
        media_list = []
        img_exts = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"}
        vid_exts = {".mp4", ".webm", ".mov", ".m4v"}

        for p in MEDIA_DIR.rglob("*"):
            if p.is_file():
                ext = p.suffix.lower()
                rel_path = p.relative_to(BASE_DIR).as_posix()
                if ext in img_exts:
                    media_list.append({"type": "image", "name": p.name, "url": f"/{rel_path}"})
                elif ext in vid_exts:
                    media_list.append({"type": "video", "name": p.name, "url": f"/{rel_path}"})

        self.send_json_response(media_list)

    def handle_list_exports(self):
        """Retorna la lista de videos renderizados en media/exports/ con metadatos."""
        exports = []
        video_exts = {".mp4", ".webm", ".mov", ".m4v"}
        for f in EXPORTS_DIR.glob("*"):
            if f.is_file() and f.suffix.lower() in video_exts:
                try:
                    st = f.stat()
                    exports.append({
                        "name": f.stem,
                        "filename": f.name,
                        "url": f"/media/exports/{f.name}",
                        "size": st.st_size,
                        "size_formatted": f"{st.st_size / (1024 * 1024):.1f} MB",
                        "modified": st.st_mtime
                    })
                except Exception:
                    continue
        exports.sort(key=lambda x: x["modified"], reverse=True)
        self.send_json_response(exports)

    def handle_delete_export(self, filename: str):
        """Elimina un video renderizado en media/exports/."""
        safe_filename = re.sub(r'[^a-zA-Z0-9_\-\.]', '', filename)
        target = EXPORTS_DIR / safe_filename
        if not target.exists() or not target.is_file():
            self.send_json_response({"error": "Video no encontrado"}, status=HTTPStatus.NOT_FOUND)
            return
        try:
            target.unlink()
            self.send_json_response({"success": True, "deleted": safe_filename})
        except Exception as e:
            self.send_json_response({"error": str(e)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)

    def handle_shutdown(self):
        """Apaga el servidor y libera el puerto de forma limpia."""
        self.send_json_response({"success": True, "message": "Servidor detenido correctamente"})
        threading.Timer(0.3, lambda: os._exit(0)).start()

    def handle_media_stream(self):
        """Maneja streaming de video con soporte para encabezado Range (HTTP 206 Partial Content)."""
        rel_path = self.path.lstrip("/")
        file_path = BASE_DIR / rel_path

        if not file_path.exists() or not file_path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND, "Archivo no encontrado")
            return

        mime_type, _ = mimetypes.guess_type(str(file_path))
        mime_type = mime_type or "application/octet-stream"
        file_size = file_path.stat().st_size
        range_header = self.headers.get("Range")

        if not range_header:
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", mime_type)
            self.send_header("Content-Length", str(file_size))
            self.send_header("Accept-Ranges", "bytes")
            self.end_headers()
            try:
                with open(file_path, "rb") as f:
                    self.copyfile(f, self.wfile)
            except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
                pass
            return

        # Parsear Range: bytes=start-end
        range_match = re.match(r"bytes=(\d+)-(\d*)", range_header)
        if not range_match:
            self.send_error(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            return

        start = int(range_match.group(1))
        end = int(range_match.group(2)) if range_match.group(2) else file_size - 1

        if start >= file_size or end >= file_size:
            self.send_error(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            return

        chunk_length = end - start + 1
        self.send_response(HTTPStatus.PARTIAL_CONTENT)
        self.send_header("Content-Type", mime_type)
        self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.send_header("Content-Length", str(chunk_length))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()

        try:
            with open(file_path, "rb") as f:
                f.seek(start)
                bytes_left = chunk_length
                while bytes_left > 0:
                    chunk = f.read(min(bytes_left, 65536))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    bytes_left -= len(chunk)
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass

    def send_json_response(self, data: any, status: HTTPStatus = HTTPStatus.OK):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def run_server(port: int = DEFAULT_PORT):
    current_port = port
    for attempt in range(10):
        try:
            server_address = ("127.0.0.1", current_port)
            httpd = ThreadingHTTPServer(server_address, ProjectionMappingHandler)
            print(f"[ProjectionMapper] Servidor iniciado en http://localhost:{current_port}")
            print(f"[ProjectionMapper] Ventana de Control:   http://localhost:{current_port}/")
            print(f"[ProjectionMapper] Ventana de Proyector: http://localhost:{current_port}/projector")
            httpd.serve_forever()
            return
        except OSError as e:
            if attempt < 9:
                current_port += 1
            else:
                raise e
        except KeyboardInterrupt:
            print("\n[ProjectionMapper] Servidor detenido.")
            break


if __name__ == "__main__":
    port = DEFAULT_PORT
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        port = int(sys.argv[1])
    run_server(port)
