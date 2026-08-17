import sqlite3
import os
from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Depends, Request, status
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
import bcrypt
from jose import JWTError, jwt

SECRET_KEY = os.getenv("SECRET_KEY", "IMARPE_CLAVE_SUPER_SECRETA_PRODUCCION_2026")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 Horas de sesión

def hash_password(password: str) -> str:
    # Truncar a 72 bytes por estándar de bcrypt
    pwd_bytes = password.encode('utf-8')[:72]
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pwd_bytes, salt).decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    pwd_bytes = plain_password.encode('utf-8')[:72]
    hash_bytes = hashed_password.encode('utf-8')
    return bcrypt.checkpw(pwd_bytes, hash_bytes)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

app = FastAPI(title="IMARPE Project Management API", version="2.0.0")

# Permitir CORS flexible
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- BASE DE DATOS LOCAL / VOLUMEN RAILWAY ---
DB_PATH = os.getenv("DATABASE_PATH", "imarpe_web.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # 1. Usuarios y Roles
    c.execute("""
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            nombre_completo TEXT NOT NULL,
            rol TEXT CHECK(rol IN ('ADMIN', 'GESTOR', 'OPERADOR')) DEFAULT 'OPERADOR'
        )
    """)
    
    # 2. Actividades y WBS
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
    
    # 4. Auditoría / Historial
    c.execute("""
        CREATE TABLE IF NOT EXISTS historial (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            usuario TEXT,
            accion TEXT,
            detalle TEXT
        )
    """)
    
    # Crear usuario Admin inicial por defecto (admin / admin123)
    c.execute("SELECT * FROM usuarios WHERE username = 'admin'")
    if not c.fetchone():
        hashed = hash_password("admin123")
        c.execute("INSERT INTO usuarios (username, password_hash, nombre_completo, rol) VALUES (?, ?, ?, ?)",
                  ("admin", hashed, "Administrador IMARPE", "ADMIN"))
    
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

# --- SERVICIOS DE AUTENTICACIÓN ---
def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(token: str = Depends(oauth2_scheme), db: sqlite3.Connection = Depends(get_db)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=401, detail="Token inválido")
    except JWTError:
        raise HTTPException(status_code=401, detail="Token inválido o expirado")
    
    user = db.execute("SELECT * FROM usuarios WHERE username = ?", (username,)).fetchone()
    if user is None:
        raise HTTPException(status_code=401, detail="Usuario inexistente")
    return dict(user)

# --- RECALCULO WBS EN CASCADA ---
def recalcular_tiempos_y_cascada(db: sqlite3.Connection):
    filas = db.execute("SELECT codigo FROM actividades ORDER BY length(codigo) DESC").fetchall()
    for row in filas:
        cod = row["codigo"]
        hijos = db.execute(f"SELECT avance, fecha_inicio, fecha_fin FROM actividades WHERE codigo LIKE '{cod}.%' AND length(codigo) <= {len(cod) + 3}").fetchall()
        if hijos:
            suma_avances = sum([h["avance"] for h in hijos])
            promedio = int(suma_avances / len(hijos))
            
            fechas_ini = [datetime.strptime(h["fecha_inicio"], "%d/%m/%Y") for h in hijos if h["fecha_inicio"] and h["fecha_inicio"] != "Definir"]
            fechas_fin = [datetime.strptime(h["fecha_fin"], "%d/%m/%Y") for h in hijos if h["fecha_fin"] and h["fecha_fin"] != "Definir"]
            
            anio = datetime.now().year
            f_ini_str = min(fechas_ini).strftime("%d/%m/%Y") if fechas_ini else f"01/01/{anio}"
            f_fin_str = max(fechas_fin).strftime("%d/%m/%Y") if fechas_fin else f"05/01/{anio}"
            dias_calc = (max(fechas_fin) - min(fechas_ini)).days + 1 if fechas_ini and fechas_fin else 5
            
            estado = "Ejecutado" if promedio == 100 else ("En proceso" if promedio > 0 else "Pendiente")
            db.execute("UPDATE actividades SET avance=?, estado=?, fecha_inicio=?, fecha_fin=?, dias=? WHERE codigo=?",
                       (promedio, estado, f_ini_str, f_fin_str, dias_calc, cod))
    db.commit()

# --- RUTA PRINCIPAL (FRONTEND) ---
@app.get("/")
def index_view():
    if os.path.exists("templates/index.html"):
        return FileResponse("templates/index.html")
    elif os.path.exists("index.html"):
        return FileResponse("index.html")
    return HTMLResponse("<h2>Error: No se encontró index.html</h2>", status_code=404)

# --- ENDPOINTS API ---
@app.post("/token", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: sqlite3.Connection = Depends(get_db)):
    user = db.execute("SELECT * FROM usuarios WHERE username = ?", (form_data.username,)).fetchone()
    if not user or not verify_password(form_data.password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Usuario o contraseña incorrectos")
    
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
    if user["rol"] not in ["ADMIN", "GESTOR"]:
        raise HTTPException(status_code=403, detail="Permisos insuficientes para modificar actividades.")
    
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
               (user["username"], "Guardar Actividad", f"Código: {act.codigo} - {act.descripcion}"))
    db.commit()
    recalcular_tiempos_y_cascada(db)
    return {"mensaje": "Actividad guardada exitosamente"}

@app.delete("/actividades/{codigo}")
def eliminar_actividad(codigo: str, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    if user["rol"] != "ADMIN":
        raise HTTPException(status_code=403, detail="Solo el rol ADMIN puede eliminar actividades.")
    
    db.execute("DELETE FROM actividades WHERE codigo = ? OR codigo LIKE ?", (codigo, f"{codigo}.%"))
    db.execute("INSERT INTO historial (usuario, accion, detalle) VALUES (?, ?, ?)",
               (user["username"], "Eliminación", f"Se eliminó el código {codigo}."))
    db.commit()
    return {"mensaje": "Actividad eliminada"}

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
        preds = [p.strip() for p in h["predecesores"].split(",") if p.strip()]
        data_map[h["codigo"]] = {
            "descripcion": h["descripcion"],
            "duracion": max(1, h["dias"]),
            "predecesores": preds
        }

    # 1. Forward Pass (Fechas Tempranas)
    es, ef = {}, {}
    for cod, d in data_map.items():
        es[cod] = max([ef[p] for p in d["predecesores"] if p in ef], default=0)
        ef[cod] = es[cod] + d["duracion"]

    duracion_total = max(ef.values()) if ef else 0

    # 2. Backward Pass (Fechas Tardías)
    ls, lf = {}, {}
    for cod in reversed(list(data_map.keys())):
        sucesores = [s for s, s_d in data_map.items() if cod in s_d["predecesores"]]
        if not sucesores:
            lf[cod] = duracion_total
        else:
            lf[cod] = min([ls[s] for s in sucesores if s in ls], default=duracion_total)
        ls[cod] = lf[cod] - data_map[cod]["duracion"]

    # 3. Holguras y Ruta Crítica
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