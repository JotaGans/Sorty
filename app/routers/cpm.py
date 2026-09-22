import sqlite3
from typing import Optional
from fastapi import APIRouter, Depends
from app.database.connection import get_db
from app.core.security import get_current_user

router = APIRouter(tags=["Ruta Crítica CPM"])

@router.get("/ruta-critica")
def calcular_cpm(proyecto_id: Optional[int] = 1, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    p_id = int(proyecto_id or 1)
    
    # 1. Obtener modalidad temporal configurada (horas o días)
    proy = db.execute("SELECT duration_mode, unidad_tiempo FROM proyectos WHERE id = ?", (p_id,)).fetchone()
    modo_duracion = "hours" if (proy and (proy["duration_mode"] == "hours" or proy["unidad_tiempo"] == "HORAS")) else "business_days"

    rows = db.execute("""
        SELECT codigo, descripcion, dias, predecesores, fecha_inicio, fecha_fin 
        FROM actividades 
        WHERE proyecto_id = ? 
        ORDER BY codigo ASC
    """, (p_id,)).fetchall()

    if not rows:
        return {"duracion_proyecto_dias": 0, "modo_duracion": modo_duracion, "detalles": {}}

    todos_codigos = [str(r["codigo"]).rstrip(".") for r in rows]
    actividades_dict = {}
    
    for r in rows:
        cod = str(r["codigo"]).rstrip(".")
        es_madre = any(otro.startswith(f"{cod}.") and otro != cod for otro in todos_codigos)
        
        preds_raw = [p.strip().rstrip(".") for p in (r["predecesores"] or "").split(",") if p.strip()]
        preds_validos = [p for p in preds_raw if p in todos_codigos and p != cod]

        actividades_dict[cod] = {
            "codigo": cod,
            "descripcion": r["descripcion"],
            "duracion": max(1, int(r["dias"] or 1)),
            "predecesores": preds_validos,
            "es_madre": es_madre,
            "ES": 0, "EF": 0, "LS": 0, "LF": 0, "holgura": 0, "es_critica": False
        }

    # Evaluar únicamente actividades terminales/hojas
    nodos = {k: v for k, v in actividades_dict.items() if not v["es_madre"]}
    if not nodos:
        nodos = actividades_dict

    # Ruptura de dependencias circulares directas respetando orden natural WBS
    for cod, n in nodos.items():
        preds_limpios = []
        for pred in n["predecesores"]:
            if pred in nodos and cod in nodos[pred]["predecesores"]:
                if cod > pred:
                    preds_limpios.append(pred)
            else:
                preds_limpios.append(pred)
        n["predecesores"] = preds_limpios

    # 2. Forward Pass (Ida)
    cambio = True
    pasadas = 0
    max_pasadas = len(nodos) + 2
    while cambio and pasadas < max_pasadas:
        cambio = False
        pasadas += 1
        for cod, n in nodos.items():
            max_ef_pred = 0
            for pred in n["predecesores"]:
                if pred in nodos:
                    max_ef_pred = max(max_ef_pred, nodos[pred]["EF"])
            nuevo_es = max_ef_pred
            nuevo_ef = nuevo_es + n["duracion"]
            if nuevo_es != n["ES"] or nuevo_ef != n["EF"]:
                n["ES"] = nuevo_es
                n["EF"] = nuevo_ef
                cambio = True

    duracion_total = max((n["EF"] for n in nodos.values()), default=0)

    # 3. Backward Pass (Vuelta)
    for n in nodos.values():
        n["LF"] = duracion_total
        n["LS"] = max(0, duracion_total - n["duracion"])

    cambio = True
    pasadas = 0
    while cambio and pasadas < max_pasadas:
        cambio = False
        pasadas += 1
        for cod, n in nodos.items():
            sucesores = [s for s in nodos.values() if cod in s["predecesores"]]
            if sucesores:
                min_ls_suc = min(s["LS"] for s in sucesores)
                nuevo_lf = min_ls_suc
                nuevo_ls = max(0, nuevo_lf - n["duracion"])
                if nuevo_lf != n["LF"] or nuevo_ls != n["LS"]:
                    n["LF"] = nuevo_lf
                    n["LS"] = nuevo_ls
                    cambio = True

    # 4. Cálculo de Holguras y Ruta Crítica
    for n in nodos.values():
        n["holgura"] = max(0, n["LS"] - n["ES"])
        n["es_critica"] = (n["holgura"] == 0 and n["duracion"] > 0)

    return {
        "duracion_proyecto_dias": duracion_total,
        "modo_duracion": modo_duracion,
        "detalles": nodos
    }