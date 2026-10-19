import sqlite3
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from app.database.connection import get_db
from app.core.security import get_current_user
from app.core.config import ahora_peru_str, ZONA_PERU
from app.models.schemas import NotificacionRequest

router = APIRouter(tags=["Notificaciones"])

# 1. Programación de Alertas Preventivas y Notificación de Asignación
@router.post("/notificaciones/asignacion")
def programar_notificacion_asignacion(
    data: NotificacionRequest, 
    user: dict = Depends(get_current_user), 
    db: sqlite3.Connection = Depends(get_db)
):
    try:
        cod_limpio = str(data.codigo_actividad).strip().rstrip(".")
        act = db.execute("""
            SELECT * FROM actividades 
            WHERE (proyecto_id = ? OR proyecto_id = ?) 
              AND (codigo = ? OR codigo = ?)
        """, (int(data.proyecto_id), str(data.proyecto_id), cod_limpio, f"{cod_limpio}.")).fetchone()

        resp_str = act["responsable"] if act and act["responsable"] else ""

        # Parsear la fecha de fin real de la actividad (formato DD/MM/YYYY)
        dt_fin_actividad = datetime.now(ZONA_PERU).date()
        if act and act["fecha_fin"]:
            try:
                p_fin = str(act["fecha_fin"]).strip().split("/")
                if len(p_fin) == 3:
                    dt_fin_actividad = datetime(int(p_fin[2]), int(p_fin[1]), int(p_fin[0])).date()
            except Exception:
                pass

        if data.destinatarios_nuevos and len(data.destinatarios_nuevos) > 0:
            nombres_a_notificar = [str(n).strip() for n in data.destinatarios_nuevos if str(n).strip()]
        else:
            nombres_a_notificar = [r.strip() for r in resp_str.split(";") if r.strip() and r.strip() != "No asignado"]

        registros_creados = 0
        fecha_hoy_obj = datetime.now(ZONA_PERU).date()
        fecha_hoy = fecha_hoy_obj.strftime("%Y-%m-%d")
        fecha_hora_ahora = ahora_peru_str()

        for nombre in nombres_a_notificar:
            r_info = db.execute("SELECT correo FROM trabajadores WHERE nombre_completo = ? UNION SELECT correo FROM responsables WHERE nombre = ? LIMIT 1", (nombre, nombre)).fetchone()
            correo = r_info["correo"] if r_info and r_info["correo"] else f"{nombre.lower().replace(' ', '.')}@imarpe.gob.pe"

            # Alerta de asignación inmediata
            db.execute("""
                INSERT INTO alertas_notificaciones 
                (proyecto_id, codigo_actividad, destinatario_nombre, destinatario_correo, tipo_alerta, dias_antes, fecha_programada, estado, fecha_envio)
                VALUES (?, ?, ?, ?, 'ASIGNACION_INICIAL', 0, ?, 'ENVIADO', ?)
            """, (int(data.proyecto_id), cod_limpio, nombre, correo, fecha_hoy, fecha_hora_ahora))

            # Limpiar recordatorios preventivos previos para no duplicar si se reprograma
            db.execute("""
                DELETE FROM alertas_notificaciones 
                WHERE proyecto_id = ? AND codigo_actividad = ? AND destinatario_nombre = ? 
                  AND tipo_alerta = 'RECORDATORIO_PREVENTIVO' AND estado = 'PROGRAMADO'
            """, (int(data.proyecto_id), cod_limpio, nombre))

            # Calcular fecha exacta de disparo: Fecha Fin - X días
            for d in (data.dias_recordatorio or []):
                dias_ant = int(d)
                dt_disparo = max(fecha_hoy_obj, dt_fin_actividad - timedelta(days=dias_ant))
                fecha_prog_str = dt_disparo.strftime("%Y-%m-%d")

                db.execute("""
                    INSERT INTO alertas_notificaciones 
                    (proyecto_id, codigo_actividad, destinatario_nombre, destinatario_correo, tipo_alerta, dias_antes, fecha_programada, estado)
                    VALUES (?, ?, ?, ?, 'RECORDATORIO_PREVENTIVO', ?, ?, 'PROGRAMADO')
                """, (int(data.proyecto_id), cod_limpio, nombre, correo, dias_ant, fecha_prog_str))

            registros_creados += 1

        db.execute("""
            INSERT INTO historial (proyecto_id, timestamp, usuario, accion, detalle)
            VALUES (?, ?, ?, 'Notificación Correo', ?)
        """, (int(data.proyecto_id), fecha_hora_ahora, user["username"], f"Notificación y alertas programadas para: [{', '.join(nombres_a_notificar)}] en [{cod_limpio}]"))

        db.commit()
        return {
            "status": "success",
            "mensaje": f"Notificaciones procesadas para {registros_creados} responsable(s).",
            "destinatarios": nombres_a_notificar
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error en servidor: {str(e)}")