import json
import sqlite3
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from app.database.connection import get_db
from app.core.security import get_current_user
from app.models.schemas import PendienteCrearModel, PendienteEstadoUpdate, PendienteDetalleUpdate

router = APIRouter(tags=["Agenda y Pendientes Privados"])

@router.get("/pendientes")
def listar_mis_pendientes(
    user: dict = Depends(get_current_user), 
    db: sqlite3.Connection = Depends(get_db)
):
    rows = db.execute("""
        SELECT id, usuario_id, titulo, COALESCE(descripcion_detallada, '') as descripcion_detallada, 
               fecha_limite, dias_recordatorio, estado, fecha_creacion
        FROM pendientes_personales
        WHERE usuario_id = ?
        ORDER BY 
            CASE WHEN estado = 'Completado' THEN 1 ELSE 0 END ASC,
            fecha_limite ASC, 
            id DESC
    """, (user["id"],)).fetchall()

    resultado = []
    for r in rows:
        d = dict(r)
        try:
            d["dias_recordatorio"] = json.loads(d["dias_recordatorio"] or "[]")
        except Exception:
            d["dias_recordatorio"] = []
        resultado.append(d)

    return resultado

@router.post("/pendientes")
def crear_pendiente(
    data: PendienteCrearModel, 
    user: dict = Depends(get_current_user), 
    db: sqlite3.Connection = Depends(get_db)
):
    titulo_limpio = data.titulo.strip()
    fecha_limite = data.fecha_limite.strip()
    desc_det = (data.descripcion_detallada or "").strip()

    if not titulo_limpio:
        raise HTTPException(status_code=400, detail="El título del pendiente es obligatorio.")
    if not fecha_limite:
        raise HTTPException(status_code=400, detail="La fecha límite es obligatoria.")

    dias_json = json.dumps(sorted(list(set(data.dias_recordatorio or [])), reverse=True))

    db.execute("""
        INSERT INTO pendientes_personales (usuario_id, titulo, descripcion_detallada, fecha_limite, dias_recordatorio, estado)
        VALUES (?, ?, ?, ?, ?, 'Pendiente')
    """, (user["id"], titulo_limpio, desc_det, fecha_limite, dias_json))

    nuevo_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    db.commit()

    return {"status": "success", "mensaje": "Pendiente registrado exitosamente", "id": nuevo_id}

@router.put("/pendientes/{pendiente_id}/detalle")
def actualizar_detalle_pendiente(
    pendiente_id: int,
    data: PendienteDetalleUpdate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db)
):
    item = db.execute("SELECT id, usuario_id FROM pendientes_personales WHERE id = ?", (pendiente_id,)).fetchone()
    if not item:
        raise HTTPException(status_code=404, detail="Pendiente no encontrado.")
    if item["usuario_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="No autorizado.")

    desc_limpia = (data.descripcion_detallada or "").strip()
    if data.titulo is not None:
        db.execute("""
            UPDATE pendientes_personales
            SET titulo = ?, descripcion_detallada = ?
            WHERE id = ? AND usuario_id = ?
        """, (data.titulo.strip(), desc_limpia, pendiente_id, user["id"]))
    else:
        db.execute("""
            UPDATE pendientes_personales
            SET descripcion_detallada = ?
            WHERE id = ? AND usuario_id = ?
        """, (desc_limpia, pendiente_id, user["id"]))
        
    db.commit()
    return {"status": "success", "mensaje": "Detalle actualizado exitosamente"}

@router.put("/pendientes/{pendiente_id}/estado")
def actualizar_estado_pendiente(
    pendiente_id: int,
    data: PendienteEstadoUpdate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db)
):
    item = db.execute("SELECT id, usuario_id FROM pendientes_personales WHERE id = ?", (pendiente_id,)).fetchone()
    if not item:
        raise HTTPException(status_code=404, detail="Pendiente no encontrado.")
    if item["usuario_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="No autorizado.")

    db.execute("""
        UPDATE pendientes_personales
        SET estado = ?
        WHERE id = ? AND usuario_id = ?
    """, (data.estado.strip(), pendiente_id, user["id"]))
    db.commit()

    return {"status": "success", "mensaje": f"Estado actualizado a {data.estado}"}

@router.delete("/pendientes/{pendiente_id}")
def eliminar_pendiente(
    pendiente_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db)
):
    item = db.execute("SELECT id, usuario_id FROM pendientes_personales WHERE id = ?", (pendiente_id,)).fetchone()
    if not item:
        raise HTTPException(status_code=404, detail="Pendiente no encontrado.")
    if item["usuario_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="No autorizado.")

    db.execute("DELETE FROM pendientes_personales WHERE id = ? AND usuario_id = ?", (pendiente_id, user["id"]))
    db.commit()
    return {"status": "success", "mensaje": "Pendiente eliminado."}