import sqlite3
import os
import bcrypt
from datetime import datetime, timedelta
from typing import List, Optional, Dict
from fastapi import FastAPI, HTTPException, Depends, status, Request
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel
from jose import JWTError, jwt

SECRET_KEY = "IMARPE_CLAVE_SUPER_SECRETA_PRODUCCION_2026_PERU"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 30  # 30 días de sesión activa

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")
app = FastAPI(title="IMARPE Project Management API", version="3.1.0")

# --- MIDDLEWARE ANTI-CACHÉ (Evita que usuarios tengan que borrar caché o usar incógnito) ---
class NoCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if request.url.path in ["/", "/index.html"]:
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

app.add_middleware(NoCacheMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

# Carpeta persistente /data en Railway o raíz en local
DATA_DIR = "/data" if os.path.exists("/data") else "."
DB_PATH = os.path.join(DATA_DIR, "imarpe_gantt.db")

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
    # Verificación directa por si está en texto plano
    if hashed_or_plain == plain_password:
        return True
    try:
        pwd_bytes = plain_password.encode('utf-8')[:72]
        hash_bytes = hashed_or_plain.encode('utf-8')
        return bcrypt.checkpw(pwd_bytes, hash_bytes)
    except Exception:
        return False

def init_db():
    # Si estamos en Railway (/data) y el volumen es nuevo,
    # copiamos la base de datos original del repositorio para no empezar en blanco
    if os.path.exists("/data") and not os.path.exists(DB_PATH) and os.path.exists("imarpe_gantt.db"):
        import shutil
        try:
            shutil.copy("imarpe_gantt.db", DB_PATH)
        except Exception as e:
            print(f"Aviso al copiar BD inicial: {e}")

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    c.execute("""
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            rol TEXT,
            avatar_path TEXT
        )
    """)

    try:
        c.execute("ALTER TABLE actividades ADD COLUMN predecesores TEXT DEFAULT ''")
    except sqlite3.OperationalError:
        pass

    c.execute("SELECT password FROM usuarios WHERE username = 'admin'")
    row = c.fetchone()
    if not row:
        c.execute("INSERT INTO usuarios (username, password, rol) VALUES (?, ?, ?)", 
                  ("admin", "admin123", "ADMINISTRADOR"))
    else:
        if not verify_password("admin123", row[0]):
            c.execute("UPDATE usuarios SET password = ? WHERE username = 'admin'", ("admin123",))

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
    fecha_inicio: Optional[str] = ""
    fecha_fin: Optional[str] = ""
    dias: Optional[int] = 1
    predecesores: Optional[str] = ""

class ResponsableModel(BaseModel):
    nombre: str
    cargo: Optional[str] = ""
    correo: Optional[str] = ""

class ResponsableUpdateModel(BaseModel):
    nombre_original: str
    nombre_nuevo: str
    cargo: Optional[str] = ""
    correo: Optional[str] = ""

class ConfigModel(BaseModel):
    valor: str

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(token: str = Depends(oauth2_scheme), db: sqlite3.Connection = Depends(get_db)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="Token no válido")
    except JWTError:
        raise HTTPException(status_code=401, detail="Sesión expirada")
    
    user = db.execute("SELECT * FROM usuarios WHERE username = ?", (username,)).fetchone()
    if not user:
        raise HTTPException(status_code=401, detail="Usuario inexistente")
    return dict(user)

# --- RECALCULO DE TIEMPOS Y CASCADA WBS (A PRUEBA DE FALLOS) ---
def parsear_fecha_segura(fecha_str):
    if not fecha_str or str(fecha_str).strip() in ["Definir", "None", "", "null"]:
        return None
    s = str(fecha_str).strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            pass
    return None

def recalcular_tiempos_y_cascada(db: sqlite3.Connection):
    try:
        filas = db.execute("SELECT codigo FROM actividades ORDER BY length(codigo) DESC").fetchall()
        for row in filas:
            cod = row["codigo"]
            hijos = db.execute(f"SELECT avance, fecha_inicio, fecha_fin FROM actividades WHERE codigo LIKE '{cod}.%' AND length(codigo) <= {len(cod) + 4}").fetchall()
            if hijos:
                suma_avances = sum([h["avance"] for h in hijos if h["avance"] is not None])
                promedio = int(suma_avances / len(hijos)) if hijos else 0
                
                fechas_ini, fechas_fin = [], []
                for h in hijos:
                    dt_ini = parsear_fecha_segura(h["fecha_inicio"])
                    dt_fin = parsear_fecha_segura(h["fecha_fin"])
                    if dt_ini:
                        fechas_ini.append(dt_ini)
                    if dt_fin:
                        fechas_fin.append(dt_fin)
                
                anio = datetime.now().year
                f_ini_str = min(fechas_ini).strftime("%d/%m/%Y") if fechas_ini else f"01/01/{anio}"
                f_fin_str = max(fechas_fin).strftime("%d/%m/%Y") if fechas_fin else f"05/01/{anio}"
                dias_calc = (max(fechas_fin) - min(fechas_ini)).days + 1 if fechas_ini and fechas_fin else 5
                
                estado = "Ejecutado" if promedio == 100 else ("En proceso" if promedio > 0 else "Pendiente")
                db.execute("UPDATE actividades SET avance=?, estado=?, fecha_inicio=?, fecha_fin=?, dias=? WHERE codigo=?",
                           (promedio, estado, f_ini_str, f_fin_str, dias_calc, cod))
        db.commit()
    except Exception as e:
        print(f"Aviso en recálculo: {e}")

@app.get("/")
def index_view():
    if os.path.exists("templates/index.html"):
        return FileResponse("templates/index.html")
    elif os.path.exists("index.html"):
        return FileResponse("index.html")
    return HTMLResponse("<h2>index.html no encontrado</h2>", status_code=404)

@app.post("/token", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: sqlite3.Connection = Depends(get_db)):
    user = db.execute("SELECT * FROM usuarios WHERE username = ?", (form_data.username.strip(),)).fetchone()
    
    # Si no existe y es admin, crearlo
    if not user and form_data.username.strip() == "admin":
        db.execute("INSERT INTO usuarios (username, password, rol) VALUES (?, ?, ?)",
                   ("admin", "admin123", "ADMINISTRADOR"))
        db.commit()
        user = db.execute("SELECT * FROM usuarios WHERE username = 'admin'").fetchone()

    if not user or not verify_password(form_data.password.strip(), user["password"]):
        raise HTTPException(status_code=400, detail="Usuario o contraseña incorrectos")
    
    rol_str = user["rol"] if user["rol"] else "ADMINISTRADOR"
    token = create_access_token({"sub": user["username"], "rol": rol_str})
    return {
        "access_token": token,
        "token_type": "bearer",
        "username": user["username"],
        "nombre_completo": "Salas Guerrero, Jesús Gianfranco" if user["username"] == "admin" else user["username"].capitalize(),
        "rol": rol_str
    }

@app.get("/actividades")
def listar_actividades(db: sqlite3.Connection = Depends(get_db)):
    recalcular_tiempos_y_cascada(db)
    rows = db.execute("SELECT * FROM actividades ORDER BY codigo ASC").fetchall()
    return [dict(r) for r in rows]

@app.post("/actividades")
def guardar_actividad(act: ActividadModel, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    try:
        cod = str(act.codigo).strip()
        desc = str(act.descripcion).strip()
        resp = str(act.responsable or "No asignado").strip()
        est = str(act.estado or "Pendiente").strip()
        av = int(act.avance if act.avance is not None else 0)
        f_ini = str(act.fecha_inicio or "").strip()
        f_fin = str(act.fecha_fin or "").strip()
        dias_val = int(act.dias if act.dias is not None else 1)
        pred = str(act.predecesores or "").strip()

        # Verificamos si existe por la columna 'codigo' que sí existe
        existe = db.execute("SELECT codigo FROM actividades WHERE codigo = ?", (cod,)).fetchone()

        if existe:
            db.execute("""
                UPDATE actividades 
                SET descripcion = ?, responsable = ?, estado = ?, avance = ?, 
                    fecha_inicio = ?, fecha_fin = ?, dias = ?, predecesores = ?
                WHERE codigo = ?
            """, (desc, resp, est, av, f_ini, f_fin, dias_val, pred, cod))
            accion = "Modificación"
        else:
            db.execute("""
                INSERT INTO actividades (codigo, descripcion, responsable, estado, avance, fecha_inicio, fecha_fin, dias, predecesores)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (cod, desc, resp, est, av, f_ini, f_fin, dias_val, pred))
            accion = "Alta"

        try:
            db.execute("INSERT INTO historial (accion, detalle) VALUES (?, ?)",
                       (accion, f"[{user.get('username', 'usuario')}] [{cod}] {desc}"))
        except Exception:
            pass

        db.commit()
        recalcular_tiempos_y_cascada(db)
        return {"mensaje": "Actividad guardada correctamente"}
    except Exception as e:
        db.rollback()
        print(f"Error grave en guardar_actividad: {e}")
        raise HTTPException(status_code=500, detail=f"Error en base de datos: {str(e)}")

@app.delete("/actividades/{codigo}")
def eliminar_actividad(codigo: str, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    if str(user["rol"]).upper() not in ["ADMIN", "ADMINISTRADOR"]:
        raise HTTPException(status_code=403, detail="Solo Administradores pueden eliminar actividades.")
    
    db.execute("DELETE FROM actividades WHERE codigo = ? OR codigo LIKE ?", (codigo, f"{codigo}.%"))
    try:
        db.execute("INSERT INTO historial (accion, detalle) VALUES (?, ?)",
                   ("Eliminación", f"[{user['username']}] Se eliminó {codigo}."))
    except Exception:
        pass
    db.commit()
    recalcular_tiempos_y_cascada(db)
    return {"mensaje": "Eliminado"}

@app.get("/responsables")
def listar_responsables(db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute("SELECT nombre, cargo, correo FROM responsables ORDER BY nombre ASC").fetchall()
    return [dict(r) for r in rows]

@app.post("/responsables")
def agregar_responsable(resp: ResponsableModel, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    nombre_limpio = resp.nombre.strip()
    if not nombre_limpio:
        raise HTTPException(status_code=400, detail="El nombre es obligatorio")
    
    existe = db.execute("SELECT id FROM responsables WHERE nombre = ?", (nombre_limpio,)).fetchone()
    if existe:
        raise HTTPException(status_code=400, detail="El responsable ya está registrado")
    
    db.execute("INSERT INTO responsables (nombre, cargo, correo) VALUES (?, ?, ?)", 
               (nombre_limpio, resp.cargo.strip(), resp.correo.strip()))
    db.commit()
    return {"mensaje": "Responsable registrado"}

@app.put("/responsables")
def actualizar_responsable(resp: ResponsableUpdateModel, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    orig = resp.nombre_original.strip()
    nuevo = resp.nombre_nuevo.strip()
    if not nuevo:
        raise HTTPException(status_code=400, detail="El nombre no puede estar vacío")
    
    db.execute("UPDATE responsables SET nombre = ?, cargo = ?, correo = ? WHERE nombre = ?", 
               (nuevo, resp.cargo.strip(), resp.correo.strip(), orig))
    
    # Actualizar en cascada en las actividades
    actividades = db.execute("SELECT id, responsable FROM actividades WHERE responsable LIKE ?", (f"%{orig}%",)).fetchall()
    for act in actividades:
        resp_act = act["responsable"].replace(orig, nuevo)
        db.execute("UPDATE actividades SET responsable = ? WHERE id = ?", (resp_act, act["id"]))
    
    db.commit()
    return {"mensaje": "Responsable actualizado"}

@app.delete("/responsables/{nombre}")
def eliminar_responsable(nombre: str, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    db.execute("DELETE FROM responsables WHERE nombre = ?", (nombre.strip(),))
    db.commit()
    return {"mensaje": "Responsable eliminado"}

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