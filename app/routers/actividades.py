import sqlite3
from datetime import datetime, date, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from app.database.connection import get_db
from app.core.security import get_current_user
from app.core.config import ahora_peru_str
from app.models.schemas import (
    ActividadModel, AsignacionResponsableModel, ReordenarActividadesModel,
    ComentarioCreate, ComentarioUpdate, NotificacionRequest,
    ResponsableModel, ResponsableActualizarModel
)

router = APIRouter(tags=["Actividades, WBS y CPM"])

def obtener_set_feriados(db: sqlite3.Connection) -> set:
    try:
        rows = db.execute("SELECT fecha FROM feriados_institucionales").fetchall()
        return {r[0] for r in rows}
    except Exception:
        return set()

def es_dia_laborable(dt: date, feriados_set: set) -> bool:
    if dt.weekday() >= 5:
        return False
    return dt.isoformat() not in feriados_set

def calcular_fecha_fin_habil(fecha_ini_date: date, dias_habiles: int, feriados_set: set) -> date:
    if dias_habiles <= 1:
        return fecha_ini_date
    cur = fecha_ini_date
    contados = 1
    while contados < dias_habiles:
        cur += timedelta(days=1)
        if es_dia_laborable(cur, feriados_set):
            contados += 1
    return cur

def clave_orden_natural_wbs(row_dict):
    cod_limpio = str(row_dict.get("codigo", "")).rstrip(".")
    partes = []
    for p in cod_limpio.split("."):
        partes.append(int(p) if p.isdigit() else p)
    return partes

@router.get("/proyectos/{proyecto_id}/actividades")
def obtener_actividades_proyecto(proyecto_id: int, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute("SELECT * FROM actividades WHERE proyecto_id = ?", (proyecto_id,)).fetchall()
    return sorted([dict(r) for r in rows], key=clave_orden_natural_wbs)

@router.post("/actividades")
def guardar_actividad(act: ActividadModel, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    p_id = int(act.proyecto_id) if act.proyecto_id is not None else 1
    cod = str(act.codigo).strip().rstrip(".")
    desc = str(act.descripcion).strip()
    resp = str(act.responsable or "No asignado").strip()
    est = "No iniciado" if act.estado == "Pendiente" else str(act.estado or "No iniciado").strip()
    av = int(act.avance if act.avance is not None else 0)
    f_ini = str(act.fecha_inicio or "").strip()
    f_fin = str(act.fecha_fin or "").strip()
    dias_val = int(act.dias if act.dias is not None else 1)
    pred = str(act.predecesores or "").strip()

    # Recálculo de seguridad blindado en backend para proyectos por horas
    proy_info = db.execute("SELECT duration_mode, unidad_tiempo, horas_por_dia FROM proyectos WHERE id = ?", (p_id,)).fetchone()
    es_modo_horas = bool(proy_info and (proy_info["duration_mode"] == "hours" or proy_info["unidad_tiempo"] == "HORAS"))

    if es_modo_horas and f_ini:
        try:
            partes_ini = f_ini.split("/")
            dt_ini = datetime(int(partes_ini[2]), int(partes_ini[1]), int(partes_ini[0])).date()
            horas_dia = int(proy_info["horas_por_dia"] or 8)
            dias_habiles = max(1, (dias_val + horas_dia - 1) // horas_dia)
            feriados_db = obtener_set_feriados(db)
            f_fin = calcular_fecha_fin_habil(dt_ini, dias_habiles, feriados_db).strftime("%d/%m/%Y")
        except Exception:
            pass

    es_gestor = db.execute("SELECT 1 FROM proyectos p LEFT JOIN proyecto_usuarios pu ON p.id = pu.proyecto_id AND pu.usuario_id = ? WHERE p.id = ? AND (p.creador_id = ? OR pu.es_gestor = 1 OR pu.permiso = 'GESTOR')", (user["id"], p_id, user["id"])).fetchone()
    es_admin_o_gestor = bool(es_gestor or user.get("rol") == "ADMIN_TI")

    existe = db.execute("SELECT * FROM actividades WHERE proyecto_id = ? AND (codigo = ? OR codigo = ?)", (p_id, cod, f"{cod}.")).fetchone()

    if not es_admin_o_gestor:
        u_nombre = (user.get("nombre_completo") or "").strip().lower()
        u_user = (user.get("username") or "").strip().lower()
        resp_db = (existe["responsable"] or "").strip().lower() if existe else ""
        if not existe or not ((u_nombre and u_nombre in resp_db) or (u_user and u_user in resp_db)):
            raise HTTPException(status_code=403, detail="Acceso restringido: Solo el Gestor o Responsable asignado.")

    if existe:
        if es_admin_o_gestor:
            db.execute("""
                UPDATE actividades SET descripcion = ?, responsable = ?, estado = ?, avance = ?, fecha_inicio = ?, fecha_fin = ?, dias = ?, predecesores = ?
                WHERE proyecto_id = ? AND (codigo = ? OR codigo = ?)
            """, (desc, resp, est, av, f_ini, f_fin, dias_val, pred, p_id, cod, f"{cod}."))
        else:
            db.execute("UPDATE actividades SET estado = ?, avance = ? WHERE proyecto_id = ? AND (codigo = ? OR codigo = ?)", (est, av, p_id, cod, f"{cod}."))
        db.execute("INSERT INTO historial (proyecto_id, timestamp, usuario, accion, detalle) VALUES (?, ?, ?, 'Modificación Actividad', ?)",
                   (p_id, ahora_peru_str(), user["username"], f"Modificó [{cod}]: '{desc}'"))
    else:
        if not es_admin_o_gestor:
            raise HTTPException(status_code=403, detail="Solo el Gestor puede crear nuevas actividades.")
        db.execute("""
            INSERT INTO actividades (proyecto_id, codigo, descripcion, responsable, estado, avance, fecha_inicio, fecha_fin, dias, predecesores)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (p_id, cod, desc, resp, est, av, f_ini, f_fin, dias_val, pred))
        db.execute("INSERT INTO historial (proyecto_id, timestamp, usuario, accion, detalle) VALUES (?, ?, ?, 'Creación Actividad', ?)",
                   (p_id, ahora_peru_str(), user["username"], f"Creó [{cod}]: '{desc}'"))

    db.commit()
    return {"mensaje": "Actividad guardada correctamente"}

@router.put("/actividades/responsable")
def actualizar_responsable_actividad(data: AsignacionResponsableModel, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    p_id = int(data.proyecto_id)
    cod_limpio = str(data.codigo).strip().rstrip(".")
    resp_limpio = str(data.responsable or "No asignado").strip()
    db.execute("UPDATE actividades SET responsable = ? WHERE proyecto_id = ? AND (codigo = ? OR codigo = ?)",
               (resp_limpio, p_id, cod_limpio, f"{cod_limpio}."))
    db.execute("INSERT INTO historial (proyecto_id, timestamp, usuario, accion, detalle) VALUES (?, ?, ?, 'Asignación Responsable', ?)",
               (p_id, ahora_peru_str(), user["username"], f"Asignó responsable(s) a [{cod_limpio}]: {resp_limpio}"))
    db.commit()
    return {"mensaje": "Responsable actualizado correctamente", "responsable": resp_limpio}

@router.delete("/proyectos/{proyecto_id}/actividades/{codigo}")
def eliminar_actividad(proyecto_id: int, codigo: str, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    es_gestor = db.execute("SELECT 1 FROM proyectos p LEFT JOIN proyecto_usuarios pu ON p.id = pu.proyecto_id AND pu.usuario_id = ? WHERE p.id = ? AND (p.creador_id = ? OR pu.es_gestor = 1)", (user["id"], proyecto_id, user["id"])).fetchone()
    if not es_gestor and user.get("rol") != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="Solo un Gestor puede eliminar actividades.")
    cod_limpio = codigo.rstrip(".")
    db.execute("DELETE FROM actividades WHERE proyecto_id = ? AND (codigo = ? OR codigo = ? OR codigo LIKE ?)",
               (proyecto_id, cod_limpio, f"{cod_limpio}.", f"{cod_limpio}.%"))
    db.commit()
    return {"mensaje": "Actividad eliminada con éxito"}

@router.put("/proyectos/{proyecto_id}/reordenar-actividades")
def reordenar_actividades_proyecto(proyecto_id: int, data: ReordenarActividadesModel, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    es_gestor = db.execute("SELECT 1 FROM proyectos p LEFT JOIN proyecto_usuarios pu ON p.id = pu.proyecto_id AND pu.usuario_id = ? WHERE p.id = ? AND (p.creador_id = ? OR pu.es_gestor = 1 OR pu.permiso = 'GESTOR')", (user["id"], proyecto_id, user["id"])).fetchone()
    if not es_gestor and user.get("rol") != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="Solo un Gestor puede reorganizar actividades.")
    rows = db.execute("SELECT * FROM actividades WHERE proyecto_id = ?", (proyecto_id,)).fetchall()
    if not rows:
        return {"mensaje": "Sin actividades"}

    filas = sorted(rows, key=lambda r: [int(p) if p.isdigit() else p for p in str(r["codigo"]).rstrip(".").split(".")])
    arbol_raices = []
    mapa_nodos = {}
    for r in filas:
        cod = str(r["codigo"]).rstrip(".")
        nodo = {"codigo": cod, "data": dict(r), "children": []}
        mapa_nodos[cod] = nodo
        partes = cod.split(".")
        if len(partes) == 1:
            arbol_raices.append(nodo)
        else:
            padre = ".".join(partes[:-1])
            if padre in mapa_nodos:
                mapa_nodos[padre]["children"].append(nodo)
            else:
                arbol_raices.append(nodo)

    cod_origen = str(data.codigo_origen or "").rstrip(".")
    cod_destino = str(data.codigo_destino or "").rstrip(".")
    modo = data.modo or "below"

    if cod_origen in mapa_nodos and cod_destino in mapa_nodos:
        def extraer_nodo(lista, cod_buscar):
            for idx, n in enumerate(lista):
                if n["codigo"] == cod_buscar:
                    return lista.pop(idx)
                res = extraer_nodo(n["children"], cod_buscar)
                if res is not None:
                    return res
            return None
        nodo_movido = extraer_nodo(arbol_raices, cod_origen)
        if nodo_movido:
            if modo == "inside":
                mapa_nodos[cod_destino]["children"].append(nodo_movido)
            else:
                def insertar_hermano(lista, target, ins, pos):
                    for idx, n in enumerate(lista):
                        if n["codigo"] == target:
                            lista.insert(idx if pos == "above" else idx + 1, ins)
                            return True
                        if insertar_hermano(n["children"], target, ins, pos):
                            return True
                    return False
                insertar_hermano(arbol_raices, cod_destino, nodo_movido, modo)

    mapeo_codigos = {}
    actividades_nuevas = []
    def aplanar(lista, prefijo=""):
        for idx, n in enumerate(lista, start=1):
            nuevo_cod = f"{prefijo}.{idx}" if prefijo else str(idx)
            mapeo_codigos[n["codigo"]] = nuevo_cod
            d = n["data"]
            d["codigo"] = nuevo_cod
            actividades_nuevas.append(d)
            aplanar(n["children"], nuevo_cod)
    aplanar(arbol_raices)

    for act in actividades_nuevas:
        if len(act["codigo"].split(".")) > 4:
            raise HTTPException(status_code=400, detail="Excedería el límite máximo de 4 niveles jerárquicos.")

    actividades_finales = []
    for act in actividades_nuevas:
        preds = [p.strip().rstrip(".") for p in (act.get("predecesores") or "").split(",") if p.strip()]
        predecesores_str = ", ".join([mapeo_codigos.get(p, p) for p in preds])
        actividades_finales.append((
            proyecto_id, act["codigo"], act["descripcion"], act["responsable"], act["estado"],
            act["avance"], act["fecha_inicio"], act["fecha_fin"], act["dias"], predecesores_str
        ))

    db.execute("DELETE FROM actividades WHERE proyecto_id = ?", (proyecto_id,))
    db.executemany("""
        INSERT INTO actividades (proyecto_id, codigo, descripcion, responsable, estado, avance, fecha_inicio, fecha_fin, dias, predecesores)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, actividades_finales)
    db.commit()
    return {"mensaje": "Actividades reubicadas con éxito"}

# --- RUTA CRÍTICA (CPM) ---
@router.get("/ruta-critica")
def calcular_cpm(proyecto_id: Optional[int] = 1, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    p_id = int(proyecto_id or 1)
    proy = db.execute("SELECT duration_mode, unidad_tiempo FROM proyectos WHERE id = ?", (p_id,)).fetchone()
    modo_duracion = "hours" if (proy and (proy["duration_mode"] == "hours" or proy["unidad_tiempo"] == "HORAS")) else "business_days"
    rows = db.execute("SELECT codigo, descripcion, dias, predecesores FROM actividades WHERE proyecto_id = ? ORDER BY codigo ASC", (p_id,)).fetchall()
    if not rows:
        return {"duracion_proyecto_dias": 0, "modo_duracion": modo_duracion, "detalles": {}}

    todos_codigos = [str(r["codigo"]).rstrip(".") for r in rows]
    actividades_dict = {}
    for r in rows:
        cod = str(r["codigo"]).rstrip(".")
        es_madre = any(otro.startswith(f"{cod}.") and otro != cod for otro in todos_codigos)
        preds_raw = [p.strip().rstrip(".") for p in (r["predecesores"] or "").split(",") if p.strip()]
        actividades_dict[cod] = {
            "codigo": cod, "descripcion": r["descripcion"], "duracion": max(1, int(r["dias"] or 1)),
            "predecesores": [p for p in preds_raw if p in todos_codigos and p != cod],
            "es_madre": es_madre, "ES": 0, "EF": 0, "LS": 0, "LF": 0, "holgura": 0, "es_critica": False
        }

    nodos = {k: v for k, v in actividades_dict.items() if not v["es_madre"]} or actividades_dict

    # Romper ciclos directos
    for cod, n in nodos.items():
        n["predecesores"] = [p for p in n["predecesores"] if not (p in nodos and cod in nodos[p]["predecesores"] and cod <= p)]

    cambio, pasadas, max_pasadas = True, 0, len(nodos) + 2
    while cambio and pasadas < max_pasadas:
        cambio, pasadas = False, pasadas + 1
        for cod, n in nodos.items():
            nuevo_es = max([nodos[p]["EF"] for p in n["predecesores"] if p in nodos], default=0)
            nuevo_ef = nuevo_es + n["duracion"]
            if nuevo_es != n["ES"] or nuevo_ef != n["EF"]:
                n["ES"], n["EF"] = nuevo_es, nuevo_ef
                cambio = True

    duracion_total = max((n["EF"] for n in nodos.values()), default=0)
    for n in nodos.values():
        n["LF"], n["LS"] = duracion_total, max(0, duracion_total - n["duracion"])

    cambio, pasadas = True, 0
    while cambio and pasadas < max_pasadas:
        cambio, pasadas = False, pasadas + 1
        for cod, n in nodos.items():
            sucesores = [s for s in nodos.values() if cod in s["predecesores"]]
            if sucesores:
                nuevo_lf = min(s["LS"] for s in sucesores)
                nuevo_ls = max(0, nuevo_lf - n["duracion"])
                if nuevo_lf != n["LF"] or nuevo_ls != n["LS"]:
                    n["LF"], n["LS"] = nuevo_lf, nuevo_ls
                    cambio = True

    for n in nodos.values():
        n["holgura"] = max(0, n["LS"] - n["ES"])
        n["es_critica"] = (n["holgura"] == 0 and n["duracion"] > 0)

    return {"duracion_proyecto_dias": duracion_total, "modo_duracion": modo_duracion, "detalles": nodos}

# --- COMENTARIOS ---
@router.get("/proyectos/{proyecto_id}/comentarios")
def listar_comentarios_proyecto(proyecto_id: int, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute("SELECT * FROM comentarios_actividad WHERE proyecto_id = ? ORDER BY id ASC", (proyecto_id,)).fetchall()
    def f_peru(f):
        s = str(f or "").strip()
        if "-" in s and len(s) >= 16:
            p = s.split(" ")
            fp, hp = p[0].split("-"), p[1].split(":")
            return f"{fp[2]}/{fp[1]}/{fp[0]} {hp[0]}:{hp[1]}"
        return s
    return [{
        "id": r["id"], "proyecto_id": r["proyecto_id"], "codigo_actividad": r["codigo_actividad"],
        "usuario_id": r["usuario_id"], "autor_nombre": r["autor_nombre"], "autor_unidad": r["autor_unidad"],
        "texto": r["texto"], "fecha_creacion": f_peru(r["fecha_creacion"]), "fecha_edicion": f_peru(r["fecha_edicion"])
    } for r in rows]

@router.post("/comentarios")
def crear_comentario(data: ComentarioCreate, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    texto = data.texto.strip()
    if not texto or len(texto) > 500:
        raise HTTPException(status_code=400, detail="Texto de comentario inválido (1-500 caracteres).")
    autor = user.get("nombre_completo") or user["username"]
    t_row = db.execute("SELECT unidad_organica FROM trabajadores WHERE nombre_completo LIKE ? LIMIT 1", (f"%{autor}%",)).fetchone()
    unidad = t_row["unidad_organica"] if t_row and t_row["unidad_organica"] else (user.get("rol") if user.get("rol") == "ADMIN_TI" else "")
    db.execute("INSERT INTO comentarios_actividad (proyecto_id, codigo_actividad, usuario_id, autor_nombre, autor_unidad, texto, fecha_creacion) VALUES (?, ?, ?, ?, ?, ?, ?)",
               (int(data.proyecto_id), str(data.codigo_actividad).strip().rstrip("."), user["id"], autor, unidad, texto, ahora_peru_str()))
    db.commit()
    return {"status": "success", "message": "Comentario registrado."}

@router.put("/comentarios/{comentario_id}")
def editar_comentario(comentario_id: int, data: ComentarioUpdate, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    texto = data.texto.strip()
    if not texto or len(texto) > 500:
        raise HTTPException(status_code=400, detail="Texto inválido.")
    row = db.execute("SELECT usuario_id FROM comentarios_actividad WHERE id = ?", (comentario_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Comentario no encontrado.")
    if row["usuario_id"] != user["id"] and user.get("rol") != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="Sin permiso para editar.")
    db.execute("UPDATE comentarios_actividad SET texto = ?, fecha_edicion = ? WHERE id = ?", (texto, ahora_peru_str(), comentario_id))
    db.commit()
    return {"status": "success", "message": "Comentario editado."}

@router.delete("/comentarios/{comentario_id}")
def eliminar_comentario(comentario_id: int, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    row = db.execute("SELECT usuario_id, proyecto_id FROM comentarios_actividad WHERE id = ?", (comentario_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Comentario no encontrado.")
    es_gestor = db.execute("SELECT 1 FROM proyectos p LEFT JOIN proyecto_usuarios pu ON p.id = pu.proyecto_id AND pu.usuario_id = ? WHERE p.id = ? AND (p.creador_id = ? OR pu.es_gestor = 1)", (user["id"], row["proyecto_id"], user["id"])).fetchone()
    if not (row["usuario_id"] == user["id"] or user.get("rol") == "ADMIN_TI" or es_gestor):
        raise HTTPException(status_code=403, detail="Sin permiso para eliminar.")
    db.execute("DELETE FROM comentarios_actividad WHERE id = ?", (comentario_id,))
    db.commit()
    return {"status": "success", "message": "Comentario eliminado."}

# --- RESPONSABLES Y NOTIFICACIONES ---
@router.get("/responsables")
def listar_responsables(db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute("SELECT nombre, cargo, correo FROM responsables ORDER BY nombre ASC").fetchall()
    return [dict(r) for r in rows]

@router.post("/notificaciones/asignacion")
def programar_notificacion_asignacion(data: NotificacionRequest, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    cod = str(data.codigo_actividad).strip().rstrip(".")
    act = db.execute("SELECT responsable FROM actividades WHERE proyecto_id = ? AND (codigo = ? OR codigo = ?)", (data.proyecto_id, cod, f"{cod}.")).fetchone()
    destinatarios = data.destinatarios_nuevos or [r.strip() for r in (act["responsable"] or "").split(";") if r.strip() and r.strip() != "No asignado"]
    fecha_hoy = datetime.now().strftime("%Y-%m-%d")
    ahora = ahora_peru_str()
    for nom in destinatarios:
        r_info = db.execute("SELECT correo FROM responsables WHERE nombre = ?", (nom,)).fetchone()
        correo = r_info["correo"] if r_info and r_info["correo"] else f"{nom.lower().replace(' ', '.')}@imarpe.gob.pe"
        db.execute("""
            INSERT INTO alertas_notificaciones (proyecto_id, codigo_actividad, destinatario_nombre, destinatario_correo, tipo_alerta, dias_antes, fecha_programada, estado, fecha_envio)
            VALUES (?, ?, ?, ?, 'ASIGNACION_INICIAL', 0, ?, 'ENVIADO', ?)
        """, (data.proyecto_id, cod, nom, correo, fecha_hoy, ahora))
        for d in (data.dias_recordatorio or []):
            db.execute("""
                INSERT INTO alertas_notificaciones (proyecto_id, codigo_actividad, destinatario_nombre, destinatario_correo, tipo_alerta, dias_antes, fecha_programada, estado)
                VALUES (?, ?, ?, ?, 'RECORDATORIO_PREVENTIVO', ?, ?, 'PROGRAMADO')
            """, (data.proyecto_id, cod, nom, correo, int(d), fecha_hoy))
    db.commit()
    return {"status": "success", "mensaje": f"Notificaciones programadas para {len(destinatarios)} destinatario(s)."}