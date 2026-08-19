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

SECRET_KEY = "IMARPE_GANTT_SECURE_SECRET_KEY_2026_MASTER_PUBLIC_MGMT"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 30  # 30 Días de sesión continua

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")
app = FastAPI(title="IMARPE Project Management API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

# Apuntar directamente a tu base de datos existente
DB_PATH = "imarpe_gantt.db"

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

def verify_password(plain_password: str, hashed_or_plain: str) -> bool:
    if not hashed_or_plain:
        return False
    # Compatibilidad con contraseñas en texto plano de tu base previa
    if hashed_or_plain == plain_password:
        return True
    try:
        pwd_bytes = plain_password.encode('utf-8')[:72]
        hash_bytes = hashed_or_plain.encode('utf-8')
        return bcrypt.checkpw(pwd_bytes, hash_bytes)
    except Exception:
        return False

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # 1. Asegurar tabla usuarios
    c.execute("""
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            rol TEXT,
            avatar_path TEXT
        )
    """)

    # 2. Agregar columna predecesores a actividades si no existe
    try:
        c.execute("ALTER TABLE actividades ADD COLUMN predecesores TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass

    # 3. Usuarios base si no estuvieran creados
    c.execute("SELECT COUNT(*) FROM usuarios")
    if c.fetchone()[0] == 0:
        c.execute("INSERT INTO usuarios (username, password, rol) VALUES (?, ?, ?)", ("admin", "admin123", "ADMIN"))
        c.execute("INSERT INTO usuarios (username, password, rol) VALUES (?, ?, ?)", ("coordinador", "coord123", "COORDINADOR"))
        c.execute("INSERT INTO usuarios (username, password, rol) VALUES (?, ?, ?)", ("operario", "oper123", "OPERARIO"))

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

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(token: str = Depends(oauth2_scheme), db: sqlite3.Connection = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Sesión expirada",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.execute("SELECT id, username, rol, nombre_completo FROM usuarios WHERE username = ?", (username,)).fetchone()
    if user is None:
        raise credentials_exception
    return dict(user)

# --- RECALCULO DE TIEMPOS Y CASCADA WBS ---
def recalcular_tiempos_y_cascada(db: sqlite3.Connection):
    filas = db.execute("SELECT codigo FROM actividades ORDER BY length(codigo) DESC").fetchall()
    for row in filas:
        cod = row["codigo"]
        hijos = db.execute(f"SELECT avance, fecha_inicio, fecha_fin FROM actividades WHERE codigo LIKE '{cod}.%' AND length(codigo) <= {len(cod) + 4}").fetchall()
        if hijos:
            suma_avances = sum([h["avance"] for h in hijos if h["avance"] is not None])
            promedio = int(suma_avances / len(hijos)) if hijos else 0
            
            fechas_ini, fechas_fin = [], []
            for h in hijos:
                f_ini_val = h["fecha_inicio"]
                f_fin_val = h["fecha_fin"]
                if f_ini_val and f_ini_val != "Definir":
                    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
                        try:
                            fechas_ini.append(datetime.strptime(f_ini_val.strip(), fmt))
                            break
                        except ValueError:
                            pass
                if f_fin_val and f_fin_val != "Definir":
                    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
                        try:
                            fechas_fin.append(datetime.strptime(f_fin_val.strip(), fmt))
                            break
                        except ValueError:
                            pass
            
            anio = datetime.now().year
            f_ini_str = min(fechas_ini).strftime("%d/%m/%Y") if fechas_ini else f"01/01/{anio}"
            f_fin_str = max(fechas_fin).strftime("%d/%m/%Y") if fechas_fin else f"05/01/{anio}"
            dias_calc = (max(fechas_fin) - min(fechas_ini)).days + 1 if fechas_ini and fechas_fin else 5
            
            estado = "Ejecutado" if promedio == 100 else ("En proceso" if promedio > 0 else "Pendiente")
            db.execute("UPDATE actividades SET avance=?, estado=?, fecha_inicio=?, fecha_fin=?, dias=? WHERE codigo=?",
                       (promedio, estado, f_ini_str, f_fin_str, dias_calc, cod))
    db.commit()

@app.get("/")
def index_view():
    if os.path.exists("templates/index.html"):
        return FileResponse("templates/index.html")
    elif os.path.exists("index.html"):
        return FileResponse("index.html")
    return HTMLResponse("<h2>index.html no encontrado</h2>", status_code=404)

@app.post("/token", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: sqlite3.Connection = Depends(get_db)):
    user = db.execute("SELECT * FROM usuarios WHERE username = ?", (form_data.username,)).fetchone()
    if not user or not verify_password(form_data.password, user["password"]):
        raise HTTPException(status_code=400, detail="Credenciales incorrectas")
    
    rol_str = user["rol"] if user["rol"] else "OPERARIO"
    token = create_access_token({"sub": user["username"], "rol": rol_str})
    return {
        "access_token": token,
        "token_type": "bearer",
        "username": user["username"],
        "nombre_completo": user["username"].capitalize(),
        "rol": rol_str
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
    
    db.execute("INSERT INTO historial (accion, detalle) VALUES (?, ?)",
               ("Guardar Actividad", f"[{user['username']}] [{act.codigo}] {act.descripcion}"))
    db.commit()
    recalcular_tiempos_y_cascada(db)
    return {"mensaje": "Actividad guardada"}

@app.delete("/actividades/{codigo}")
def eliminar_actividad(codigo: str, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    if str(user["rol"]).upper() not in ["ADMIN", "ADMINISTRADOR"]:
        raise HTTPException(status_code=403, detail="Solo Administradores pueden eliminar actividades.")
    
    db.execute("DELETE FROM actividades WHERE codigo = ? OR codigo LIKE ?", (codigo, f"{codigo}.%"))
    db.execute("INSERT INTO historial (accion, detalle) VALUES (?, ?)",
               ("Eliminación", f"[{user['username']}] Se eliminó {codigo}."))
    db.commit()
    return {"mensaje": "Eliminado"}

@app.get("/responsables")
def listar_responsables(db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute("SELECT nombre, cargo, correo FROM responsables ORDER BY nombre ASC").fetchall()
    return [dict(r) for r in rows]

@app.get("/historial")
def listar_historial(db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute("SELECT timestamp, accion, detalle FROM historial ORDER BY timestamp DESC LIMIT 100").fetchall()
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
        partes = a["codigo"].replace(".", "").split(".")
        if len(partes) > 1:
            codigos_con_hijos.add(".".join(partes[:-1]))
            
    hojas = [a for a in todas if a["codigo"] not in codigos_con_hijos]
    if not hojas:
        return {"duracion_proyecto_dias": 0, "actividades_criticas": [], "detalles": {}}

    data_map = {}
    for h in hojas:
        preds = [p.strip() for p in (h.get("predecesores") or "").split(",") if p.strip()]
        data_map[h["codigo"]] = {
            "descripcion": h["descripcion"],
            "duracion": max(1, h["dias"] if h["dias"] else 1),
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