import sqlite3
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from app.database.connection import get_db
from app.core.security import get_current_user
from app.core.config import ahora_peru_str, ZONA_PERU
from app.models.schemas import (
    GuardarPlantillaDesdeProyectoModel,
    CrearProyectoDesdePlantillaModel
)

router = APIRouter(tags=["Plantillas Maestras"])

# 1. Listar biblioteca de plantillas disponibles
@router.get("/plantillas")
def listar_plantillas(user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute("""
        SELECT p.id, p.nombre, p.descripcion, p.categoria, p.fecha_creacion,
               COUNT(pa.id) as total_actividades,
               SUM(CASE WHEN pa.codigo NOT LIKE '%.%' THEN pa.dias ELSE 0 END) as duracion_estimada_dias
        FROM plantillas p
        LEFT JOIN plantillas_actividades pa ON p.id = pa.plantilla_id
        GROUP BY p.id
        ORDER BY p.id DESC
    """).fetchall()
    return [dict(r) for r in rows]

# 2. Obtener desglose WBS de una plantilla específica
@router.get("/plantillas/{plantilla_id}")
def obtener_detalle_plantilla(plantilla_id: int, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    plantilla = db.execute("SELECT * FROM plantillas WHERE id = ?", (plantilla_id,)).fetchone()
    if not plantilla:
        raise HTTPException(status_code=404, detail="Plantilla no encontrada.")
    
    actividades = db.execute("""
        SELECT codigo, descripcion, dias, predecesores 
        FROM plantillas_actividades 
        WHERE plantilla_id = ? 
        ORDER BY codigo ASC
    """, (plantilla_id,)).fetchall()

    def clave_wbs(r):
        return [int(p) if p.isdigit() else p for p in str(r["codigo"]).rstrip(".").split(".")]

    acts_ordenadas = sorted([dict(a) for a in actividades], key=clave_wbs)

    res = dict(plantilla)
    res["actividades"] = acts_ordenadas
    return res

# 3. Guardar proyecto activo como nueva plantilla maestra
@router.post("/plantillas/desde-proyecto")
def guardar_plantilla_desde_proyecto(
    data: GuardarPlantillaDesdeProyectoModel,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db)
):
    es_gestor = db.execute("""
        SELECT 1 FROM proyectos p 
        LEFT JOIN proyecto_usuarios pu ON p.id = pu.proyecto_id AND pu.usuario_id = ?
        WHERE p.id = ? AND (p.creador_id = ? OR pu.es_gestor = 1 OR pu.permiso = 'GESTOR')
    """, (user["id"], data.proyecto_id, user["id"])).fetchone()

    if not es_gestor and user.get("rol") != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="Solo un Gestor o Admin TI puede guardar proyectos como plantilla.")

    acts = db.execute("SELECT codigo, descripcion, dias, predecesores FROM actividades WHERE proyecto_id = ? ORDER BY codigo ASC", (data.proyecto_id,)).fetchall()
    if not acts:
        raise HTTPException(status_code=400, detail="El proyecto seleccionado no contiene actividades para crear una plantilla.")

    db.execute("""
        INSERT INTO plantillas (nombre, descripcion, categoria, creador_id)
        VALUES (?, ?, ?, ?)
    """, (data.nombre.strip(), data.descripcion.strip(), data.categoria.strip() or "General", user["id"]))
    
    plantilla_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]

    for a in acts:
        db.execute("""
            INSERT INTO plantillas_actividades (plantilla_id, codigo, descripcion, dias, predecesores)
            VALUES (?, ?, ?, ?, ?)
        """, (plantilla_id, a["codigo"], a["descripcion"], max(1, int(a["dias"] or 1)), a["predecesores"] or ""))

    db.execute("""
        INSERT INTO historial (proyecto_id, timestamp, usuario, accion, detalle)
        VALUES (?, ?, ?, 'Creación de Plantilla', ?)
    """, (data.proyecto_id, ahora_peru_str(), user["username"], f"Guardó este proyecto como plantilla maestra: '{data.nombre.strip()}'"))

    db.commit()
    return {"status": "success", "mensaje": "Plantilla guardada exitosamente en la biblioteca institucional.", "plantilla_id": plantilla_id}

# 4. Crear un proyecto completo a partir de una plantilla
@router.post("/proyectos/desde-plantilla")
def crear_proyecto_desde_plantilla(
    data: CrearProyectoDesdePlantillaModel,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db)
):
    plantilla = db.execute("SELECT * FROM plantillas WHERE id = ?", (data.plantilla_id,)).fetchone()
    if not plantilla:
        raise HTTPException(status_code=404, detail="La plantilla seleccionada no existe.")

    acts_plantilla = db.execute("""
        SELECT codigo, descripcion, dias, predecesores 
        FROM plantillas_actividades 
        WHERE plantilla_id = ?
        ORDER BY codigo ASC
    """, (data.plantilla_id,)).fetchall()

    if not acts_plantilla:
        raise HTTPException(status_code=400, detail="La plantilla seleccionada no contiene actividades.")

    modo_duracion = str(data.duration_mode or "business_days").strip().lower()
    if modo_duracion not in ("business_days", "hours"):
        modo_duracion = "business_days"
    unidad_tiempo = "HORAS" if modo_duracion == "hours" else "DIAS"

    visib = (data.visibilidad or "PRIVADO").upper().strip()
    if visib not in ("PRIVADO", "PUBLICO"):
        visib = "PRIVADO"

    db.execute("""
        INSERT INTO proyectos (
            nombre, descripcion, unidad_organica, proceso_codigo, proceso_nombre,
            es_proceso_personalizado, duration_mode, unidad_tiempo, visibilidad, creador_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data.nombre_proyecto.strip(),
        (data.descripcion or plantilla["descripcion"] or "").strip(),
        (data.unidad_organica or "").strip(),
        (data.proceso_codigo or "").strip(),
        (data.proceso_nombre or "").strip(),
        int(data.es_proceso_personalizado or 0),
        modo_duracion,
        unidad_tiempo,
        visib,
        user["id"]
    ))
    
    nuevo_proy_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    db.execute("INSERT INTO proyecto_usuarios (proyecto_id, usuario_id, es_gestor, permiso) VALUES (?, ?, 1, 'GESTOR')", (nuevo_proy_id, user["id"]))

    try:
        p_fecha = data.fecha_inicio.strip().split("/")
        dt_base = datetime(int(p_fecha[2]), int(p_fecha[1]), int(p_fecha[0]))
    except Exception:
        dt_base = datetime.now(ZONA_PERU)

    def clave_wbs(r):
        return [int(p) if p.isdigit() else p for p in str(r["codigo"]).rstrip(".").split(".")]

    acts_ordenadas = sorted(acts_plantilla, key=clave_wbs)
    acts_a_insertar = []
    mapa_fechas_fin = {}

    for a in acts_ordenadas:
        cod = str(a["codigo"]).rstrip(".")
        dias = max(1, int(a["dias"] or 1))
        preds = [p.strip().rstrip(".") for p in (a["predecesores"] or "").split(",") if p.strip()]

        dt_ini_act = dt_base
        if preds:
            max_fin_pred = None
            for pr in preds:
                if pr in mapa_fechas_fin and (max_fin_pred is None or mapa_fechas_fin[pr] > max_fin_pred):
                    max_fin_pred = mapa_fechas_fin[pr]
            if max_fin_pred:
                dt_ini_act = max_fin_pred + timedelta(days=1)
        
        dt_fin_act = dt_ini_act + timedelta(days=dias - 1)
        mapa_fechas_fin[cod] = dt_fin_act

        f_ini_str = dt_ini_act.strftime("%d/%m/%Y")
        f_fin_str = dt_fin_act.strftime("%d/%m/%Y")

        acts_a_insertar.append((
            nuevo_proy_id,
            cod,
            a["descripcion"],
            "No asignado",
            "No iniciado",
            0,
            f_ini_str,
            f_fin_str,
            dias,
            a["predecesores"] or ""
        ))

    db.executemany("""
        INSERT INTO actividades (proyecto_id, codigo, descripcion, responsable, estado, avance, fecha_inicio, fecha_fin, dias, predecesores)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, acts_a_insertar)

    db.execute("""
        INSERT INTO historial (proyecto_id, timestamp, usuario, accion, detalle)
        VALUES (?, ?, ?, 'Creación desde Plantilla', ?)
    """, (nuevo_proy_id, ahora_peru_str(), user["username"], f"Proyecto inicializado a partir de la plantilla: '{plantilla['nombre']}'"))

    db.commit()
    return {"status": "success", "mensaje": "Proyecto generado exitosamente con la estructura de la plantilla.", "proyecto_id": nuevo_proy_id}

# 5. Importar y aplicar estructura de plantilla en un proyecto vacío existente
@router.post("/proyectos/{proyecto_id}/aplicar-plantilla")
def aplicar_plantilla_en_proyecto_existente(
    proyecto_id: int,
    data: CrearProyectoDesdePlantillaModel,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db)
):
    es_gestor = db.execute("""
        SELECT 1 FROM proyectos p 
        LEFT JOIN proyecto_usuarios pu ON p.id = pu.proyecto_id AND pu.usuario_id = ?
        WHERE p.id = ? AND (p.creador_id = ? OR pu.es_gestor = 1 OR pu.permiso = 'GESTOR')
    """, (user["id"], proyecto_id, user["id"])).fetchone()

    if not es_gestor and user.get("rol") != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="Solo un Gestor del Proyecto puede importar plantillas.")

    total_acts = db.execute("SELECT COUNT(*) FROM actividades WHERE proyecto_id = ?", (proyecto_id,)).fetchone()[0]
    if total_acts > 0:
        raise HTTPException(status_code=400, detail="El proyecto ya contiene actividades. Solo puede importar plantillas en proyectos vacíos.")

    plantilla = db.execute("SELECT * FROM plantillas WHERE id = ?", (data.plantilla_id,)).fetchone()
    if not plantilla:
        raise HTTPException(status_code=404, detail="Plantilla no encontrada.")

    acts_plantilla = db.execute("SELECT codigo, descripcion, dias, predecesores FROM plantillas_actividades WHERE plantilla_id = ? ORDER BY codigo ASC", (data.plantilla_id,)).fetchall()
    if not acts_plantilla:
        raise HTTPException(status_code=400, detail="La plantilla no contiene actividades.")

    try:
        p_fecha = data.fecha_inicio.strip().split("/")
        dt_base = datetime(int(p_fecha[2]), int(p_fecha[1]), int(p_fecha[0]))
    except Exception:
        dt_base = datetime.now(ZONA_PERU)

    def clave_wbs(r):
        return [int(p) if p.isdigit() else p for p in str(r["codigo"]).rstrip(".").split(".")]

    acts_ordenadas = sorted(acts_plantilla, key=clave_wbs)
    acts_a_insertar = []
    mapa_fechas_fin = {}

    for a in acts_ordenadas:
        cod = str(a["codigo"]).rstrip(".")
        dias = max(1, int(a["dias"] or 1))
        preds = [p.strip().rstrip(".") for p in (a["predecesores"] or "").split(",") if p.strip()]

        dt_ini_act = dt_base
        if preds:
            max_fin_pred = None
            for pr in preds:
                if pr in mapa_fechas_fin and (max_fin_pred is None or mapa_fechas_fin[pr] > max_fin_pred):
                    max_fin_pred = mapa_fechas_fin[pr]
            if max_fin_pred:
                dt_ini_act = max_fin_pred + timedelta(days=1)
        
        dt_fin_act = dt_ini_act + timedelta(days=dias - 1)
        mapa_fechas_fin[cod] = dt_fin_act

        acts_a_insertar.append((
            proyecto_id,
            cod,
            a["descripcion"],
            "No asignado",
            "No iniciado",
            0,
            dt_ini_act.strftime("%d/%m/%Y"),
            dt_fin_act.strftime("%d/%m/%Y"),
            dias,
            a["predecesores"] or ""
        ))

    db.executemany("""
        INSERT INTO actividades (proyecto_id, codigo, descripcion, responsable, estado, avance, fecha_inicio, fecha_fin, dias, predecesores)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, acts_a_insertar)

    db.execute("""
        INSERT INTO historial (proyecto_id, timestamp, usuario, accion, detalle)
        VALUES (?, ?, ?, 'Importación Plantilla', ?)
    """, (proyecto_id, ahora_peru_str(), user["username"], f"Importó la estructura de la plantilla: '{plantilla['nombre']}'"))

    db.commit()
    return {"status": "success", "mensaje": "Plantilla importada exitosamente en el proyecto."}