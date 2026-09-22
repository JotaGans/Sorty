import sqlite3
from typing import Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from app.database.connection import get_db
from app.core.security import get_current_user
from app.core.config import ZONA_PERU, ahora_peru_str
from app.models.schemas import (
    ProyectoCrearModel, ProyectoNombreUpdate, ProyectoDescripcionUpdate,
    ProyectoUnidadUpdate, ProyectoProcesoUpdate, PermisoProyectoUpdate,
    GuardarPlantillaDesdeProyectoModel, CrearProyectoDesdePlantillaModel
)

router = APIRouter(tags=["Proyectos y Programas"])

@router.get("/proyectos")
def listar_proyectos_usuario(user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    u_id = user["id"]
    u_nom = user.get("nombre_completo", "")
    es_admin_ti = (user.get("rol") == "ADMIN_TI")

    uo_row = db.execute("""
        SELECT uo.sigla FROM unidades_organicas uo
        LEFT JOIN trabajadores t ON uo.titular_trabajador_id = t.id
        LEFT JOIN usuarios u ON (uo.titular_usuario_id = u.id OR u.nombre_completo = t.nombre_completo OR t.correo LIKE u.username || '@%')
        WHERE u.id = ? AND uo.estado = 'ACTIVO' LIMIT 1
    """, (u_id,)).fetchone()

    mi_sigla_autoridad = uo_row["sigla"] if uo_row else ""

    query = """
        WITH RECURSIVE ArbolSubordinadas(sigla) AS (
            SELECT sigla FROM unidades_organicas WHERE sigla = ?
            UNION ALL
            SELECT uo.sigla FROM unidades_organicas uo
            JOIN ArbolSubordinadas a ON uo.sigla_padre = a.sigla
        )
        SELECT DISTINCT p.id, p.nombre, p.descripcion, p.unidad_organica, 
               p.proceso_codigo, p.proceso_nombre, p.es_proceso_personalizado,
               COALESCE(p.duration_mode, CASE WHEN p.unidad_tiempo = 'HORAS' THEN 'hours' ELSE 'business_days' END) as duration_mode,
               COALESCE(p.visibilidad, 'PRIVADO') as visibilidad,
               p.unidad_tiempo, p.horas_por_dia, p.fecha_creacion,
               CASE WHEN pu.es_gestor = 1 OR p.creador_id = ? OR ? = 1 THEN 1 ELSE 0 END as es_gestor,
               CASE 
                   WHEN pu.es_gestor = 1 OR p.creador_id = ? THEN 'GESTOR'
                   WHEN a.responsable LIKE ? THEN 'RESPONSABLE'
                   WHEN pu.permiso IS NOT NULL THEN pu.permiso
                   WHEN p.visibilidad = 'PUBLICO' AND (p.unidad_organica IN (SELECT sigla FROM ArbolSubordinadas) OR ? = 'PE') THEN 'AUTORIDAD'
                   ELSE 'VISUALIZADOR'
               END as rol_efectivo
        FROM proyectos p
        LEFT JOIN proyecto_usuarios pu ON p.id = pu.proyecto_id AND pu.usuario_id = ?
        LEFT JOIN actividades a ON p.id = a.proyecto_id
        WHERE ? = 1 OR p.creador_id = ? OR pu.usuario_id = ? OR a.responsable LIKE ?
           OR (p.visibilidad = 'PUBLICO' AND (? = 'PE' OR p.unidad_organica IN (SELECT sigla FROM ArbolSubordinadas)))
        ORDER BY p.id DESC
    """
    resp_like = f"%{u_nom}%"
    es_admin_flag = 1 if es_admin_ti else 0

    rows = db.execute(query, (
        mi_sigla_autoridad, u_id, es_admin_flag, u_id, resp_like, mi_sigla_autoridad,
        u_id, es_admin_flag, u_id, u_id, resp_like, mi_sigla_autoridad
    )).fetchall()

    proyectos_resumen = []
    for r in rows:
        p_dict = dict(r)
        p_id = p_dict["id"]
        acts_raw = db.execute("SELECT codigo, avance, estado FROM actividades WHERE proyecto_id = ? ORDER BY codigo ASC", (p_id,)).fetchall()
        if not acts_raw:
            p_dict.update({"total_actividades": 0, "ejecutadas": 0, "en_proceso": 0, "pendientes": 0, "avance_global": 0})
            proyectos_resumen.append(p_dict)
            continue

        acts_dict = {str(a["codigo"]).rstrip("."): {"codigo": str(a["codigo"]).rstrip("."), "avance": int(a["avance"] or 0), "estado": str(a["estado"] or "No iniciado")} for a in acts_raw}
        def round_half_up(n): return int(n + 0.5) if n >= 0 else int(n - 0.5)

        todos_cods = list(acts_dict.keys())
        for nivel_actual in [4, 3, 2, 1]:
            for cod, act in acts_dict.items():
                if len(cod.split(".")) == nivel_actual:
                    hijos = [acts_dict[c] for c in todos_cods if c.startswith(f"{cod}.") and len(c.split(".")) == nivel_actual + 1]
                    if hijos:
                        prom_av = round_half_up(sum(h["avance"] for h in hijos) / len(hijos))
                        act["avance"] = prom_av
                        act["estado"] = "Ejecutado" if prom_av == 100 else ("En proceso" if prom_av > 0 else "No iniciado")

        acts_finales = list(acts_dict.values())
        raices = [a for a in acts_finales if "." not in a["codigo"]]
        pct_global = round_half_up(sum(a["avance"] for a in raices) / len(raices)) if raices else 0

        p_dict.update({
            "total_actividades": len(acts_finales),
            "ejecutadas": sum(1 for a in acts_finales if a["estado"] == "Ejecutado"),
            "en_proceso": sum(1 for a in acts_finales if a["estado"] == "En proceso"),
            "pendientes": sum(1 for a in acts_finales if a["estado"] in ["No iniciado", "Pendiente"]),
            "avance_global": pct_global
        })
        proyectos_resumen.append(p_dict)
    return proyectos_resumen

@router.post("/proyectos")
def crear_nuevo_proyecto(p: ProyectoCrearModel, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    modo_duracion = str(p.duration_mode or "").strip().lower()
    if modo_duracion not in ("business_days", "hours"):
        modo_duracion = "hours" if (p.unidad_tiempo or "").upper() == "HORAS" else "business_days"
    unidad_tiempo = "HORAS" if modo_duracion == "hours" else "DIAS"
    visibilidad_final = "PUBLICO" if (p.visibilidad or "").upper().strip() == "PUBLICO" else "PRIVADO"

    db.execute("""
        INSERT INTO proyectos (nombre, descripcion, unidad_organica, proceso_codigo, proceso_nombre,
                               es_proceso_personalizado, duration_mode, unidad_tiempo, horas_por_dia, visibilidad, creador_id) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (p.nombre.strip(), p.descripcion.strip(), (p.unidad_organica or "").strip(),
          (p.proceso_codigo or "").strip(), (p.proceso_nombre or "").strip(), int(p.es_proceso_personalizado or 0),
          modo_duracion, unidad_tiempo, int(p.horas_por_dia or 8), visibilidad_final, user["id"]))
    nuevo_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    db.execute("INSERT INTO proyecto_usuarios (proyecto_id, usuario_id, es_gestor, permiso) VALUES (?, ?, 1, 'GESTOR')", (nuevo_id, user["id"]))
    db.execute("INSERT INTO historial (proyecto_id, timestamp, usuario, accion, detalle) VALUES (?, ?, ?, 'Creación Proyecto', ?)",
               (nuevo_id, ahora_peru_str(), user["username"], f"Proyecto creado: '{p.nombre.strip()}'"))
    db.commit()
    return {"mensaje": "Proyecto creado exitosamente", "proyecto_id": nuevo_id}

@router.put("/proyectos/{proyecto_id}/nombre")
def actualizar_nombre_proyecto(proyecto_id: int, data: ProyectoNombreUpdate, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    permiso = db.execute("SELECT 1 FROM proyectos p LEFT JOIN proyecto_usuarios pu ON p.id = pu.proyecto_id AND pu.usuario_id = ? WHERE p.id = ? AND (p.creador_id = ? OR pu.es_gestor = 1)", (user["id"], proyecto_id, user["id"])).fetchone()
    if not permiso and user.get("rol") != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="No tiene permisos de Gestor.")
    nom = (data.nombre or "").strip()
    if not nom:
        raise HTTPException(status_code=400, detail="El nombre no puede estar vacío.")
    db.execute("UPDATE proyectos SET nombre = ? WHERE id = ?", (nom, proyecto_id))
    db.execute("INSERT INTO historial (proyecto_id, timestamp, usuario, accion, detalle) VALUES (?, ?, ?, 'Renombrar Proyecto', ?)",
               (proyecto_id, ahora_peru_str(), user["username"], f"Nombre actualizado a: '{nom}'"))
    db.commit()
    return {"message": "Nombre del proyecto actualizado correctamente", "nombre": nom}

@router.put("/proyectos/{proyecto_id}/descripcion")
def actualizar_descripcion_proyecto(proyecto_id: int, data: ProyectoDescripcionUpdate, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    permiso = db.execute("SELECT 1 FROM proyectos p LEFT JOIN proyecto_usuarios pu ON p.id = pu.proyecto_id AND pu.usuario_id = ? WHERE p.id = ? AND (p.creador_id = ? OR pu.es_gestor = 1)", (user["id"], proyecto_id, user["id"])).fetchone()
    if not permiso and user.get("rol") != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="No tiene permisos de Gestor.")
    desc = (data.descripcion or "").strip()[:120]
    db.execute("UPDATE proyectos SET descripcion = ? WHERE id = ?", (desc, proyecto_id))
    db.commit()
    return {"message": "Descripción actualizada correctamente", "descripcion": desc}

@router.put("/proyectos/{proyecto_id}/unidad-organica")
def actualizar_unidad_organica_proyecto(proyecto_id: int, data: ProyectoUnidadUpdate, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    permiso = db.execute("SELECT 1 FROM proyectos p LEFT JOIN proyecto_usuarios pu ON p.id = pu.proyecto_id AND pu.usuario_id = ? WHERE p.id = ? AND (p.creador_id = ? OR pu.es_gestor = 1 OR pu.permiso = 'GESTOR')", (user["id"], proyecto_id, user["id"])).fetchone()
    if not permiso and user.get("rol") != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="No tiene permisos de Gestor.")
    uo = (data.unidad_organica or "").strip()
    if not uo:
        raise HTTPException(status_code=400, detail="La unidad no puede estar vacía.")
    db.execute("UPDATE proyectos SET unidad_organica = ? WHERE id = ?", (uo, proyecto_id))
    db.execute("INSERT INTO historial (proyecto_id, timestamp, usuario, accion, detalle) VALUES (?, ?, ?, 'Modificar Unidad Orgánica', ?)",
               (proyecto_id, ahora_peru_str(), user["username"], f"Unidad actualizada a: '{uo}'"))
    db.commit()
    return {"message": "Unidad de organización actualizada", "unidad_organica": uo}

@router.put("/proyectos/{proyecto_id}/proceso")
def actualizar_proceso_proyecto(proyecto_id: int, data: ProyectoProcesoUpdate, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    permiso = db.execute("SELECT 1 FROM proyectos p LEFT JOIN proyecto_usuarios pu ON p.id = pu.proyecto_id AND pu.usuario_id = ? WHERE p.id = ? AND (p.creador_id = ? OR pu.es_gestor = 1 OR pu.permiso = 'GESTOR')", (user["id"], proyecto_id, user["id"])).fetchone()
    if not permiso and user.get("rol") != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="No tiene permisos de Gestor.")
    db.execute("UPDATE proyectos SET proceso_codigo = ?, proceso_nombre = ?, es_proceso_personalizado = ? WHERE id = ?",
               ((data.proceso_codigo or "").strip(), (data.proceso_nombre or "").strip(), int(data.es_proceso_personalizado or 0), proyecto_id))
    db.execute("INSERT INTO historial (proyecto_id, timestamp, usuario, accion, detalle) VALUES (?, ?, ?, 'Modificar Proceso', ?)",
               (proyecto_id, ahora_peru_str(), user["username"], f"Asignó proceso: {data.proceso_nombre}"))
    db.commit()
    return {"message": "Proceso relacionado actualizado"}

@router.delete("/proyectos/{proyecto_id}")
def eliminar_proyecto_vacio(proyecto_id: int, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    permiso = db.execute("SELECT 1 FROM proyectos p LEFT JOIN proyecto_usuarios pu ON p.id = pu.proyecto_id AND pu.usuario_id = ? WHERE p.id = ? AND (p.creador_id = ? OR pu.es_gestor = 1 OR pu.permiso = 'GESTOR')", (user["id"], proyecto_id, user["id"])).fetchone()
    if not permiso and user.get("rol") != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="No tiene permisos para eliminar este proyecto.")
    total_acts = db.execute("SELECT COUNT(*) FROM actividades WHERE proyecto_id = ?", (proyecto_id,)).fetchone()[0]
    if total_acts > 0:
        raise HTTPException(status_code=400, detail=f"No se puede eliminar: contiene {total_acts} actividad(es).")
    db.execute("DELETE FROM proyecto_usuarios WHERE proyecto_id = ?", (proyecto_id,))
    db.execute("DELETE FROM comentarios_actividad WHERE proyecto_id = ?", (proyecto_id,))
    db.execute("DELETE FROM historial WHERE proyecto_id = ?", (proyecto_id,))
    db.execute("DELETE FROM proyectos WHERE id = ?", (proyecto_id,))
    db.commit()
    return {"status": "success", "mensaje": "Proyecto eliminado exitosamente."}

# --- PERMISOS Y PERSONAL ---
@router.get("/proyectos/{proyecto_id}/personal_permisos")
def listar_personal_proyecto(proyecto_id: int, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    miembros = db.execute("""
        SELECT u.id, u.username, u.nombre_completo, u.rol, pu.es_gestor,
               COALESCE(pu.permiso, CASE WHEN pu.es_gestor = 1 OR p.creador_id = u.id THEN 'GESTOR' ELSE 'VISUALIZADOR' END) as nivel_permiso
        FROM proyecto_usuarios pu
        JOIN usuarios u ON pu.usuario_id = u.id
        JOIN proyectos p ON p.id = pu.proyecto_id
        WHERE pu.proyecto_id = ? AND u.estado = 'ACTIVO' ORDER BY u.nombre_completo ASC
    """, (proyecto_id,)).fetchall()
    todos = db.execute("SELECT id, username, nombre_completo, rol FROM usuarios WHERE estado = 'ACTIVO' ORDER BY nombre_completo ASC").fetchall()
    acts = db.execute("SELECT DISTINCT responsable FROM actividades WHERE proyecto_id = ? AND responsable IS NOT NULL", (proyecto_id,)).fetchall()
    responsables = []
    for a in acts:
        for r in (a["responsable"] or "").split(";"):
            limpio = r.strip()
            if limpio and limpio != "No asignado" and limpio not in responsables:
                responsables.append(limpio)
    return {"miembros": [dict(m) for m in miembros], "todos_usuarios": [dict(u) for u in todos], "responsables_en_actividades": responsables}

@router.post("/proyectos/{proyecto_id}/personal_permisos")
def actualizar_permiso_personal(proyecto_id: int, data: PermisoProyectoUpdate, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    permiso_admin = db.execute("SELECT 1 FROM proyectos p LEFT JOIN proyecto_usuarios pu ON p.id = pu.proyecto_id AND pu.usuario_id = ? WHERE p.id = ? AND (p.creador_id = ? OR pu.es_gestor = 1 OR pu.permiso = 'GESTOR')", (user["id"], proyecto_id, user["id"])).fetchone()
    if not permiso_admin and user.get("rol") != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="Solo un Gestor puede asignar permisos.")
    es_gestor_val = 1 if data.nivel == 'GESTOR' else 0
    if data.nivel == 'NINGUNO':
        db.execute("DELETE FROM proyecto_usuarios WHERE proyecto_id = ? AND usuario_id = ?", (proyecto_id, data.usuario_id))
    else:
        db.execute("""
            INSERT INTO proyecto_usuarios (proyecto_id, usuario_id, es_gestor, permiso) VALUES (?, ?, ?, ?)
            ON CONFLICT(proyecto_id, usuario_id) DO UPDATE SET es_gestor = excluded.es_gestor, permiso = excluded.permiso
        """, (proyecto_id, data.usuario_id, es_gestor_val, data.nivel))
    db.commit()
    return {"mensaje": "Permiso actualizado exitosamente"}

@router.get("/proyectos/{proyecto_id}/historial")
def ver_historial(proyecto_id: int, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute("""
        SELECT COALESCE(timestamp, datetime('now')) as timestamp, COALESCE(usuario, 'admin') as usuario,
               COALESCE(accion, 'Registro') as accion, COALESCE(detalle, 'Operación sin detalle') as detalle 
        FROM historial WHERE proyecto_id = ? ORDER BY ROWID DESC LIMIT 100
    """, (proyecto_id,)).fetchall()
    return [dict(r) for r in rows]

# --- PLANTILLAS ---
@router.get("/plantillas")
def listar_plantillas(user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute("""
        SELECT p.id, p.nombre, p.descripcion, p.categoria, p.fecha_creacion,
               COUNT(pa.id) as total_actividades,
               SUM(CASE WHEN pa.codigo NOT LIKE '%.%' THEN pa.dias ELSE 0 END) as duracion_estimada_dias
        FROM plantillas p LEFT JOIN plantillas_actividades pa ON p.id = pa.plantilla_id GROUP BY p.id ORDER BY p.id DESC
    """).fetchall()
    return [dict(r) for r in rows]

@router.post("/plantillas/desde-proyecto")
def guardar_plantilla_desde_proyecto(data: GuardarPlantillaDesdeProyectoModel, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    permiso = db.execute("SELECT 1 FROM proyectos p LEFT JOIN proyecto_usuarios pu ON p.id = pu.proyecto_id AND pu.usuario_id = ? WHERE p.id = ? AND (p.creador_id = ? OR pu.es_gestor = 1 OR pu.permiso = 'GESTOR')", (user["id"], data.proyecto_id, user["id"])).fetchone()
    if not permiso and user.get("rol") != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="Solo un Gestor o Admin TI puede guardar plantillas.")
    acts = db.execute("SELECT codigo, descripcion, dias, predecesores FROM actividades WHERE proyecto_id = ? ORDER BY codigo ASC", (data.proyecto_id,)).fetchall()
    if not acts:
        raise HTTPException(status_code=400, detail="El proyecto no contiene actividades.")
    db.execute("INSERT INTO plantillas (nombre, descripcion, categoria, creador_id) VALUES (?, ?, ?, ?)",
               (data.nombre.strip(), data.descripcion.strip(), data.categoria.strip() or "General", user["id"]))
    plantilla_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    for a in acts:
        db.execute("INSERT INTO plantillas_actividades (plantilla_id, codigo, descripcion, dias, predecesores) VALUES (?, ?, ?, ?, ?)",
                   (plantilla_id, a["codigo"], a["descripcion"], max(1, int(a["dias"] or 1)), a["predecesores"] or ""))
    db.commit()
    return {"status": "success", "mensaje": "Plantilla guardada exitosamente.", "plantilla_id": plantilla_id}

@router.post("/proyectos/desde-plantilla")
def crear_proyecto_desde_plantilla(data: CrearProyectoDesdePlantillaModel, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    plantilla = db.execute("SELECT * FROM plantillas WHERE id = ?", (data.plantilla_id,)).fetchone()
    if not plantilla:
        raise HTTPException(status_code=404, detail="La plantilla no existe.")
    acts = db.execute("SELECT codigo, descripcion, dias, predecesores FROM plantillas_actividades WHERE plantilla_id = ? ORDER BY codigo ASC", (data.plantilla_id,)).fetchall()
    if not acts:
        raise HTTPException(status_code=400, detail="La plantilla no contiene actividades.")

    modo = str(data.duration_mode or "business_days").strip().lower()
    if modo not in ("business_days", "hours"):
        modo = "business_days"
    visib = "PUBLICO" if (data.visibilidad or "").upper().strip() == "PUBLICO" else "PRIVADO"

    db.execute("""
        INSERT INTO proyectos (nombre, descripcion, unidad_organica, proceso_codigo, proceso_nombre,
                               es_proceso_personalizado, duration_mode, unidad_tiempo, visibilidad, creador_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (data.nombre_proyecto.strip(), (data.descripcion or plantilla["descripcion"] or "").strip(),
          (data.unidad_organica or "").strip(), (data.proceso_codigo or "").strip(),
          (data.proceso_nombre or "").strip(), int(data.es_proceso_personalizado or 0), modo,
          "HORAS" if modo == "hours" else "DIAS", visib, user["id"]))
    nuevo_proy_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    db.execute("INSERT INTO proyecto_usuarios (proyecto_id, usuario_id, es_gestor, permiso) VALUES (?, ?, 1, 'GESTOR')", (nuevo_proy_id, user["id"]))

    try:
        p_fecha = data.fecha_inicio.strip().split("/")
        dt_base = datetime(int(p_fecha[2]), int(p_fecha[1]), int(p_fecha[0]))
    except Exception:
        dt_base = datetime.now(ZONA_PERU)

    mapa_fin = {}
    acts_a_insertar = []
    for a in acts:
        cod = str(a["codigo"]).rstrip(".")
        dias = max(1, int(a["dias"] or 1))
        preds = [p.strip().rstrip(".") for p in (a["predecesores"] or "").split(",") if p.strip()]
        dt_ini = dt_base
        if preds:
            max_fin = max([mapa_fin[pr] for pr in preds if pr in mapa_fin], default=None)
            if max_fin:
                dt_ini = max_fin + timedelta(days=1)
        dt_fin = dt_ini + timedelta(days=dias - 1)
        mapa_fin[cod] = dt_fin
        acts_a_insertar.append((
            nuevo_proy_id, cod, a["descripcion"], "No asignado", "No iniciado", 0,
            dt_ini.strftime("%d/%m/%Y"), dt_fin.strftime("%d/%m/%Y"), dias, a["predecesores"] or ""
        ))

    db.executemany("""
        INSERT INTO actividades (proyecto_id, codigo, descripcion, responsable, estado, avance, fecha_inicio, fecha_fin, dias, predecesores)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, acts_a_insertar)
    db.commit()
    return {"status": "success", "mensaje": "Proyecto generado desde plantilla.", "proyecto_id": nuevo_proy_id}

@router.post("/proyectos/{proyecto_id}/aplicar-plantilla")
def aplicar_plantilla_en_proyecto_existente(proyecto_id: int, data: CrearProyectoDesdePlantillaModel, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    permiso = db.execute("SELECT 1 FROM proyectos p LEFT JOIN proyecto_usuarios pu ON p.id = pu.proyecto_id AND pu.usuario_id = ? WHERE p.id = ? AND (p.creador_id = ? OR pu.es_gestor = 1 OR pu.permiso = 'GESTOR')", (user["id"], proyecto_id, user["id"])).fetchone()
    if not permiso and user.get("rol") != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="Solo un Gestor puede importar plantillas.")
    total_acts = db.execute("SELECT COUNT(*) FROM actividades WHERE proyecto_id = ?", (proyecto_id,)).fetchone()[0]
    if total_acts > 0:
        raise HTTPException(status_code=400, detail="El proyecto ya contiene actividades.")

    acts = db.execute("SELECT codigo, descripcion, dias, predecesores FROM plantillas_actividades WHERE plantilla_id = ? ORDER BY codigo ASC", (data.plantilla_id,)).fetchall()
    if not acts:
        raise HTTPException(status_code=400, detail="La plantilla no contiene actividades.")

    try:
        p_fecha = data.fecha_inicio.strip().split("/")
        dt_base = datetime(int(p_fecha[2]), int(p_fecha[1]), int(p_fecha[0]))
    except Exception:
        dt_base = datetime.now(ZONA_PERU)

    mapa_fin = {}
    acts_a_insertar = []
    for a in acts:
        cod = str(a["codigo"]).rstrip(".")
        dias = max(1, int(a["dias"] or 1))
        preds = [p.strip().rstrip(".") for p in (a["predecesores"] or "").split(",") if p.strip()]
        dt_ini = dt_base
        if preds:
            max_fin = max([mapa_fin[pr] for pr in preds if pr in mapa_fin], default=None)
            if max_fin:
                dt_ini = max_fin + timedelta(days=1)
        dt_fin = dt_ini + timedelta(days=dias - 1)
        mapa_fin[cod] = dt_fin
        acts_a_insertar.append((
            proyecto_id, cod, a["descripcion"], "No asignado", "No iniciado", 0,
            dt_ini.strftime("%d/%m/%Y"), dt_fin.strftime("%d/%m/%Y"), dias, a["predecesores"] or ""
        ))

    db.executemany("""
        INSERT INTO actividades (proyecto_id, codigo, descripcion, responsable, estado, avance, fecha_inicio, fecha_fin, dias, predecesores)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, acts_a_insertar)
    db.commit()
    return {"status": "success", "mensaje": "Plantilla importada exitosamente."}