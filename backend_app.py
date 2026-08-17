import sqlite3
import os
import bcrypt
from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from jose import JWTError, jwt

SECRET_KEY = os.getenv("SECRET_KEY", "IMARPE_CLAVE_SUPER_SECRETA_PRODUCCION_2026")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")
app = FastAPI(title="IMARPE Project Management API", version="2.5.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Carpeta de estáticos para el imagotipo
os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

DB_PATH = "imarpe_web.db"

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

def hash_password(password: str) -> str:
    pwd_bytes = password.encode('utf-8')[:72]
    return bcrypt.hashpw(pwd_bytes, bcrypt.gensalt()).decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    pwd_bytes = plain_password.encode('utf-8')[:72]
    hash_bytes = hashed_password.encode('utf-8')
    return bcrypt.checkpw(pwd_bytes, hash_bytes)

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # 1. Usuarios y Roles reales
    c.execute("""
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            nombre_completo TEXT NOT NULL,
            rol TEXT CHECK(rol IN ('ADMIN', 'COORDINADOR', 'OPERARIO', 'GESTOR')) DEFAULT 'OPERARIO'
        )
    """)
    
    # 2. Actividades
    c.execute("""
        CREATE TABLE IF NOT EXISTS actividades (
            codigo TEXT PRIMARY KEY,
            descripcion TEXT NOT NULL,
            responsable TEXT,
            estado TEXT DEFAULT 'Pendiente',
            avance INTEGER DEFAULT 0,
            fecha_inicio TEXT,
            fecha_fin TEXT,
            dias INTEGER DEFAULT 1,
            predecesores TEXT DEFAULT ''
        )
    """)
    
    # 3. Responsables
    c.execute("""
        CREATE TABLE IF NOT EXISTS responsables (
            nombre TEXT PRIMARY KEY,
            cargo TEXT,
            correo TEXT
        )
    """)
    
    # 4. Configuración
    c.execute("""
        CREATE TABLE IF NOT EXISTS configuracion (
            clave TEXT PRIMARY KEY,
            valor TEXT
        )
    """)
    
    # 5. Historial
    c.execute("""
        CREATE TABLE IF NOT EXISTS historial (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            usuario TEXT,
            accion TEXT,
            detalle TEXT
        )
    """)

    # Sembrar usuarios por defecto si no existen
    c.execute("SELECT COUNT(*) FROM usuarios")
    if c.fetchone()[0] == 0:
        c.execute("INSERT INTO usuarios (username, password_hash, nombre_completo, rol) VALUES (?, ?, ?, ?)",
                  ("admin", hash_password("admin123"), "Administrador General", "ADMIN"))
        c.execute("INSERT INTO usuarios (username, password_hash, nombre_completo, rol) VALUES (?, ?, ?, ?)",
                  ("coordinador", hash_password("coord123"), "Coordinador de Proyecto", "COORDINADOR"))
        c.execute("INSERT INTO usuarios (username, password_hash, nombre_completo, rol) VALUES (?, ?, ?, ?)",
                  ("operario", hash_password("oper123"), "Operario IMARPE", "OPERARIO"))

    # Configuración de nombre de proyecto inicial
    c.execute("INSERT OR IGNORE INTO configuracion (clave, valor) VALUES ('nombre_proyecto', 'SISTEMA DE GESTION ANTISOBORNO (SGAS)')")
    
    conn.commit()
    conn.close()

init_db()

# --- MODELOS PYDANTIC ---
class Token(BaseModel):
    access_token: str
    token_type: str
    username: str
    nombre_completo: str
    rol: str

class ActividadModel(BaseModel):
    codigo: str
    descripcion: str
    responsable: Optional[str] = "No asignado"
    estado: Optional[str] = "Pendiente"
    avance: Optional[int] = 0
    fecha_inicio: Optional[str] = None
    fecha_fin: Optional[str] = None
    dias: Optional[int] = 1
    predecesores: Optional[str] = ""

class ConfigModel(BaseModel):
    valor: str

# --- SEGURIDAD ---
def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(token: str = Depends(oauth2_scheme), db: sqlite3.Connection = Depends(get_db)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if not username: raise HTTPException(status_code=401, detail="Token no válido")
    except JWTError:
        raise HTTPException(status_code=401, detail="Sesión expirada")
    
    user = db.execute("SELECT * FROM usuarios WHERE username = ?", (username,)).fetchone()
    if not user: raise HTTPException(status_code=401, detail="Usuario inexistente")
    return dict(user)

# --- RECALCULO WBS ---
def recalcular_tiempos_y_cascada(db: sqlite3.Connection):
    filas = db.execute("SELECT codigo FROM actividades ORDER BY length(codigo) DESC").fetchall()
    for row in filas:
        cod = row["codigo"]
        hijos = db.execute(f"SELECT avance, fecha_inicio, fecha_fin FROM actividades WHERE codigo LIKE '{cod}.%' AND length(codigo) <= {len(cod) + 4}").fetchall()
        if hijos:
            suma_avances = sum([h["avance"] for h in hijos])
            promedio = int(suma_avances / len(hijos))
            
            fechas_ini, fechas_fin = [], []
            for h in hijos:
                if h["fecha_inicio"] and h["fecha_inicio"] != "Definir":
                    try: fechas_ini.append(datetime.strptime(h["fecha_inicio"], "%d/%m/%Y"))
                    except: pass
                if h["fecha_fin"] and h["fecha_fin"] != "Definir":
                    try: fechas_fin.append(datetime.strptime(h["fecha_fin"], "%d/%m/%Y"))
                    except: pass
            
            anio = datetime.now().year
            f_ini_str = min(fechas_ini).strftime("%d/%m/%Y") if fechas_ini else f"01/01/{anio}"
            f_fin_str = max(fechas_fin).strftime("%d/%m/%Y") if fechas_fin else f"05/01/{anio}"
            dias_calc = (max(fechas_fin) - min(fechas_ini)).days + 1 if fechas_ini and fechas_fin else 5
            
            estado = "Ejecutado" if promedio == 100 else ("En proceso" if promedio > 0 else "Pendiente")
            db.execute("UPDATE actividades SET avance=?, estado=?, fecha_inicio=?, fecha_fin=?, dias=? WHERE codigo=?",
                       (promedio, estado, f_ini_str, f_fin_str, dias_calc, cod))
    db.commit()

# --- VISTA PRINCIPAL ---
@app.get("/")
def index_view():
    if os.path.exists("templates/index.html"):
        return FileResponse("templates/index.html")
    elif os.path.exists("index.html"):
        return FileResponse("index.html")
    return HTMLResponse("<h2>index.html no encontrado</h2>", status_code=404)

# --- API ENDPOINTS ---
@app.post("/token", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: sqlite3.Connection = Depends(get_db)):
    user = db.execute("SELECT * FROM usuarios WHERE username = ?", (form_data.username,)).fetchone()
    if not user or not verify_password(form_data.password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Credenciales incorrectas")
    
    token = create_access_token({"sub": user["username"], "rol": user["rol"]})
    return {
        "access_token": token,
        "token_type": "bearer",
        "username": user["username"],
        "nombre_completo": user["nombre_completo"],
        "rol": user["rol"]
    }

@app.get("/actividades")
def listar_actividades(db: sqlite3.Connection = Depends(get_db)):
    recalcular_tiempos_y_cascada(db)
    rows = db.execute("SELECT * FROM actividades ORDER BY codigo ASC").fetchall()
    return [dict(r) for r in rows]

@app.post("/actividades")
def guardar_actividad(act: ActividadModel, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    db.execute("""
        INSERT INTO actividades (codigo, descripcion, responsable, estado, avance, fecha_inicio, fecha_fin, dias, predecesores)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(codigo) DO UPDATE SET
            descripcion=excluded.descripcion,
            responsable=excluded.responsable,
            estado=excluded.estado,
            avance=excluded.avance,
            fecha_inicio=excluded.fecha_inicio,
            fecha_fin=excluded.fecha_fin,
            dias=excluded.dias,
            predecesores=excluded.predecesores
    """, (act.codigo, act.descripcion, act.responsable, act.estado, act.avance, act.fecha_inicio, act.fecha_fin, act.dias, act.predecesores))
    
    db.execute("INSERT INTO historial (usuario, accion, detalle) VALUES (?, ?, ?)",
               (user["username"], "Guardar Actividad", f"[{act.codigo}] {act.descripcion}"))
    db.commit()
    recalcular_tiempos_y_cascada(db)
    return {"mensaje": "Actividad guardada"}

@app.delete("/actividades/{codigo}")
def eliminar_actividad(codigo: str, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    if user["rol"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Solo Administradores pueden eliminar actividades.")
    
    db.execute("DELETE FROM actividades WHERE codigo = ? OR codigo LIKE ?", (codigo, f"{codigo}.%"))
    db.execute("INSERT INTO historial (usuario, accion, detalle) VALUES (?, ?, ?)",
               (user["username"], "Eliminación", f"Se eliminó {codigo} y dependencias."))
    db.commit()
    return {"mensaje": "Eliminado"}

@app.get("/responsables")
def listar_responsables(db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute("SELECT * FROM responsables ORDER BY nombre ASC").fetchall()
    return [dict(r) for r in rows]

@app.get("/historial")
def listar_historial(db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute("SELECT * FROM historial ORDER BY timestamp DESC LIMIT 100").fetchall()
    return [dict(r) for r in rows]

@app.get("/configuracion/{clave}")
def obtener_config(clave: str, db: sqlite3.Connection = Depends(get_db)):
    res = db.execute("SELECT valor FROM configuracion WHERE clave = ?", (clave,)).fetchone()
    return {"valor": res["valor"] if res else None}

@app.post("/configuracion/{clave}")
def guardar_config(clave: str, item: ConfigModel, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    db.execute("INSERT INTO configuracion (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor",
               (clave, item.valor))
    db.commit()
    return {"mensaje": "Configuración guardada"}

@app.get("/ruta-critica")
def calcular_cpm(db: sqlite3.Connection = Depends(get_db)):
    todas = [dict(r) for r in db.execute("SELECT * FROM actividades ORDER BY codigo ASC").fetchall()]
    codigos_con_hijos = set()
    for a in todas:
        partes = a["codigo"].split(".")
        if len(partes) > 1:
            codigos_con_hijos.add(".".join(partes[:-1]))
            
    hojas = [a for a in todas if a["codigo"] not in codigos_con_hijos]
    if not hojas:
        return {"duracion_proyecto_dias": 0, "actividades_criticas": [], "detalles": {}}

    data_map = {}
    for h in hojas:
        preds = [p.strip() for p in (h["predecesores"] or "").split(",") if p.strip()]
        data_map[h["codigo"]] = {
            "descripcion": h["descripcion"],
            "duracion": max(1, h["dias"]),
            "predecesores": preds
        }

    es, ef = {}, {}
    for cod, d in data_map.items():
        es[cod] = max([ef[p] for p in d["predecesores"] if p in ef], default=0)
        ef[cod] = es[cod] + d["duracion"]

    duracion_total = max(ef.values()) if ef else 0

    ls, lf = {}, {}
    for cod in reversed(list(data_map.keys())):
        sucesores = [s for s, s_d in data_map.items() if cod in s_d["predecesores"]]
        if not sucesores:
            lf[cod] = duracion_total
        else:
            lf[cod] = min([ls[s] for s in sucesores if s in ls], default=duracion_total)
        ls[cod] = lf[cod] - data_map[cod]["duracion"]

    nodos_cpm = {}
    ruta_critica = []
    for cod in data_map:
        holgura = ls[cod] - es[cod]
        es_critica = (holgura == 0)
        if es_critica:
            ruta_critica.append(cod)
        nodos_cpm[cod] = {
            "codigo": cod,
            "descripcion": data_map[cod]["descripcion"],
            "duracion": data_map[cod]["duracion"],
            "ES": es[cod],
            "EF": ef[cod],
            "LS": ls[cod],
            "LF": lf[cod],
            "holgura": holgura,
            "es_critica": es_critica
        }

    return {
        "duracion_proyecto_dias": duracion_total,
        "actividades_criticas": ruta_critica,
        "detalles": nodos_cpm
    }