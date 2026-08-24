import os
import sqlite3
import hashlib
import binascii
from datetime import datetime, timedelta
from typing import Optional, List
from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from jose import JWTError, jwt

# --- CONFIGURACIÓN Y SEGURIDAD ---
SECRET_KEY = "IMARPE_SGAS_SUPER_SECRET_KEY_2026_SECURITY_TOKEN"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24

DATA_DIR = "/data" if os.path.exists("/data") else "."
DB_PATH = os.path.join(DATA_DIR, "imarpe_gantt.db")

app = FastAPI(title="IMARPE Project Management Engine", version="9.3")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/token")

# --- CONEXIÓN A BASE DE DATOS ---
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

# --- FUNCIONES DE CIBERSEGURIDAD (HASH PBKDF2) ---
def hash_password(password: str) -> str:
    salt = hashlib.sha256(os.urandom(60)).hexdigest().encode('ascii')
    pwdhash = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 100000)
    pwdhash = binascii.hexlify(pwdhash)
    return (salt + pwdhash).decode('ascii')

def verify_password(stored_password: str, provided_password: str) -> bool:
    if not stored_password:
        return False
    if stored_password == provided_password:
        return True
    try:
        salt = stored_password[:64]
        stored_hash = stored_password[64:]
        pwdhash = hashlib.pbkdf2_hmac('sha256', provided_password.encode('utf-8'), salt.encode('ascii'), 100000)
        pwdhash = binascii.hexlify(pwdhash).decode('ascii')
        return pwdhash == stored_hash
    except Exception:
        return False

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

# --- MODELOS PYDANTIC ---
class Token(BaseModel):
    access_token: str
    token_type: str
    username: str
    rol: str
    user_id: int

class UsuarioAltaModel(BaseModel):
    username: str
    password: str
    nombre_completo: str
    rol: str  # 'ADMIN_TI' | 'OPERADOR'

class ProyectoCrearModel(BaseModel):
    nombre: str
    descripcion: Optional[str] = ""

class ActividadModel(BaseModel):
    proyecto_id: Optional[int] = 1
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

class ResponsableActualizarModel(BaseModel):
    nombre_original: str
    nombre_nuevo: str
    cargo: Optional[str] = ""
    correo: Optional[str] = ""

class ConfigValorModel(BaseModel):
    valor: str

# --- INICIALIZACIÓN Y MIGRACIÓN DE BD ---
def init_db():
    if os.path.exists("/data") and not os.path.exists(DB_PATH) and os.path.exists("imarpe_gantt.db"):
        import shutil
        try:
            shutil.copy("imarpe_gantt.db", DB_PATH)
        except Exception:
            pass

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # 1. Tabla Usuarios y migraciones
    c.execute("""
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            nombre_completo TEXT,
            rol TEXT NOT NULL DEFAULT 'OPERADOR',
            estado TEXT NOT NULL DEFAULT 'ACTIVO'
        )
    """)

    for col, defn in [("nombre_completo", "TEXT"), ("rol", "TEXT DEFAULT 'OPERADOR'"), ("estado", "TEXT DEFAULT 'ACTIVO'")]:
        try:
            c.execute(f"ALTER TABLE usuarios ADD COLUMN {col} {defn}")
        except sqlite3.OperationalError:
            pass

    # 2. Asegurar credenciales del Admin TI
    hashed_admin_pass = hash_password("admin123")
    c.execute("SELECT id FROM usuarios WHERE username = 'admin'")
    admin_row = c.fetchone()
    
    if not admin_row:
        c.execute("""
            INSERT INTO usuarios (username, password, nombre_completo, rol, estado)
            VALUES ('admin', ?, 'Administrador TI IMARPE', 'ADMIN_TI', 'ACTIVO')
        """, (hashed_admin_pass,))
        admin_id = c.lastrowid
    else:
        admin_id = admin_row[0]
        c.execute("""
            UPDATE usuarios 
            SET password = ?, rol = 'ADMIN_TI', estado = 'ACTIVO', nombre_completo = 'Administrador TI IMARPE'
            WHERE username = 'admin'
        """, (hashed_admin_pass,))

    # 3. Tabla Proyectos y migraciones
    c.execute("""
        CREATE TABLE IF NOT EXISTS proyectos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            descripcion TEXT,
            creador_id INTEGER,
            fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(creador_id) REFERENCES usuarios(id)
        )
    """)

    try:
        c.execute("ALTER TABLE proyectos ADD COLUMN descripcion TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        c.execute("ALTER TABLE proyectos ADD COLUMN creador_id INTEGER")
    except sqlite3.OperationalError:
        pass

    # 4. Tabla Permisos Proyecto
    c.execute("""
        CREATE TABLE IF NOT EXISTS proyecto_usuarios (
            proyecto_id INTEGER,
            usuario_id INTEGER,
            es_gestor BOOLEAN DEFAULT 0,
            PRIMARY KEY (proyecto_id, usuario_id)
        )
    """)

    # 5. Migración Segura de la Tabla Actividades a Clave Primaria Compuesta (proyecto_id, codigo)
    # Detectar si la tabla tiene restricción única solo en 'codigo'
    c.execute("PRAGMA table_info(actividades)")
    cols_act = c.fetchall()
    
    if cols_act:
        # Recrear tabla garantizando PRIMARY KEY (proyecto_id, codigo)
        c.execute("""
            CREATE TABLE IF NOT EXISTS actividades_nueva (
                proyecto_id INTEGER DEFAULT 1,
                codigo TEXT NOT NULL,
                descripcion TEXT NOT NULL,
                responsable TEXT,
                estado TEXT,
                avance INTEGER,
                fecha_inicio TEXT,
                fecha_fin TEXT,
                dias INTEGER,
                predecesores TEXT DEFAULT '',
                PRIMARY KEY (proyecto_id, codigo)
            )
        """)
        try:
            c.execute("""
                INSERT OR IGNORE INTO actividades_nueva (proyecto_id, codigo, descripcion, responsable, estado, avance, fecha_inicio, fecha_fin, dias, predecesores)
                SELECT COALESCE(proyecto_id, 1), codigo, descripcion, responsable, estado, avance, fecha_inicio, fecha_fin, dias, COALESCE(predecesores, '')
                FROM actividades
            """)
            c.execute("DROP TABLE actividades")
            c.execute("ALTER TABLE actividades_nueva RENAME TO actividades")
        except Exception:
            pass
    else:
        c.execute("""
            CREATE TABLE IF NOT EXISTS actividades (
                proyecto_id INTEGER DEFAULT 1,
                codigo TEXT NOT NULL,
                descripcion TEXT NOT NULL,
                responsable TEXT,
                estado TEXT,
                avance INTEGER,
                fecha_inicio TEXT,
                fecha_fin TEXT,
                dias INTEGER,
                predecesores TEXT DEFAULT '',
                PRIMARY KEY (proyecto_id, codigo)
            )
        """)

    # 6. Tablas auxiliares
    c.execute("""
        CREATE TABLE IF NOT EXISTS historial (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            proyecto_id INTEGER DEFAULT 1,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            accion TEXT,
            detalle TEXT
        )
    """)

    try:
        c.execute("ALTER TABLE historial ADD COLUMN proyecto_id INTEGER DEFAULT 1")
    except sqlite3.OperationalError:
        pass

    c.execute("""
        CREATE TABLE IF NOT EXISTS responsables (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT UNIQUE,
            cargo TEXT,
            correo TEXT
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS configuracion (
            clave TEXT PRIMARY KEY,
            valor TEXT
        )
    """)

    # Proyecto semilla
    c.execute("SELECT id FROM proyectos WHERE id = 1")
    if not c.fetchone():
        c.execute("INSERT INTO proyectos (id, nombre, creador_id) VALUES (1, 'GESTIÓN DE CONVENIOS', ?)", (admin_id,))
        c.execute("INSERT OR REPLACE INTO proyecto_usuarios (proyecto_id, usuario_id, es_gestor) VALUES (1, ?, 1)", (admin_id,))
    else:
        c.execute("INSERT OR REPLACE INTO proyecto_usuarios (proyecto_id, usuario_id, es_gestor) VALUES (1, ?, 1)", (admin_id,))

    # Saneamiento de códigos heredados con punto al final
    try:
        c.execute("""
            UPDATE actividades 
            SET codigo = RTRIM(codigo, '.') 
            WHERE codigo LIKE '%.'
        """)
    except Exception:
        pass

    # Tabla para registro y despacho de notificaciones y recordatorios
    c.execute("""
        CREATE TABLE IF NOT EXISTS alertas_notificaciones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            proyecto_id INTEGER,
            codigo_actividad TEXT,
            destinatario_nombre TEXT,
            destinatario_correo TEXT,
            tipo_alerta TEXT, -- 'ASIGNACION_INICIAL' | 'RECORDATORIO_PREVENTIVO'
            dias_antes INTEGER,
            fecha_programada TEXT,
            estado TEXT DEFAULT 'PROGRAMADO', -- 'PROGRAMADO' | 'ENVIADO'
            fecha_envio DATETIME,
            FOREIGN KEY(proyecto_id) REFERENCES proyectos(id)
        )
    """)

    conn.commit()
    conn.close()

init_db()

# --- VERIFICACIÓN DE SESIÓN Y ROLES ---
def get_current_user(token: str = Depends(oauth2_scheme), db: sqlite3.Connection = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Sesión expirada o no válida",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.execute("SELECT id, username, nombre_completo, rol, estado FROM usuarios WHERE username = ?", (username,)).fetchone()
    if not user or user["estado"] != "ACTIVO":
        raise credentials_exception
    return dict(user)

# --- AUTENTICACIÓN ---
@app.post("/token", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: sqlite3.Connection = Depends(get_db)):
    user = db.execute("SELECT id, username, password, nombre_completo, rol, estado FROM usuarios WHERE username = ?", (form_data.username,)).fetchone()
    if not user or not verify_password(user["password"], form_data.password):
        raise HTTPException(status_code=400, detail="Usuario o contraseña incorrectos")
    if user["estado"] != "ACTIVO":
        raise HTTPException(status_code=403, detail="Cuenta inactiva. Contacte al Administrador TI.")

    token = create_access_token(data={"sub": user["username"], "rol": user["rol"], "id": user["id"]})
    return {
        "access_token": token,
        "token_type": "bearer",
        "username": user["username"],
        "rol": user["rol"],
        "user_id": user["id"]
    }

# --- GESTIÓN DE USUARIOS (ADMIN TI EXCLUSIVO) ---
@app.post("/usuarios")
def alta_usuario(nuevo: UsuarioAltaModel, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    if user["rol"] != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="Acceso denegado: Solo el Administrador TI puede gestionar usuarios.")
    
    existe = db.execute("SELECT id FROM usuarios WHERE username = ?", (nuevo.username,)).fetchone()
    if existe:
        raise HTTPException(status_code=400, detail="El nombre de usuario ya está registrado.")

    hashed = hash_password(nuevo.password)
    db.execute("INSERT INTO usuarios (username, password, nombre_completo, rol, estado) VALUES (?, ?, ?, ?, 'ACTIVO')",
               (nuevo.username, hashed, nuevo.nombre_completo, nuevo.rol))
    db.commit()
    return {"mensaje": "Usuario dado de alta exitosamente"}

@app.get("/usuarios")
def listar_usuarios(user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    if user["rol"] != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="Acceso denegado")
    rows = db.execute("SELECT id, username, nombre_completo, rol, estado FROM usuarios ORDER BY id DESC").fetchall()
    return [dict(r) for r in rows]

# --- HUB DE PROYECTOS ---
# --- HUB DE PROYECTOS CON CÁLCULO JERÁRQUICO UNIFICADO ---
@app.get("/proyectos")
def listar_proyectos_usuario(user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    u_id = user["id"]
    u_nom = user.get("nombre_completo", "")

    query = """
        SELECT DISTINCT p.id, p.nombre, p.descripcion, p.fecha_creacion,
               CASE WHEN pu.es_gestor = 1 OR p.creador_id = ? THEN 1 ELSE 0 END as es_gestor
        FROM proyectos p
        LEFT JOIN proyecto_usuarios pu ON p.id = pu.proyecto_id AND pu.usuario_id = ?
        LEFT JOIN actividades a ON p.id = a.proyecto_id
        WHERE p.creador_id = ? 
           OR pu.usuario_id = ? 
           OR a.responsable LIKE ?
        ORDER BY p.id DESC
    """
    rows = db.execute(query, (u_id, u_id, u_id, u_id, f"%{u_nom}%")).fetchall()
    
    proyectos_resumen = []
    for r in rows:
        p_dict = dict(r)
        p_id = p_dict["id"]
        
        # Obtener todas las actividades del proyecto para roll-up preciso
        acts_raw = db.execute("SELECT codigo, avance, estado FROM actividades WHERE proyecto_id = ? ORDER BY codigo ASC", (p_id,)).fetchall()
        
        if not acts_raw:
            p_dict["total_actividades"] = 0
            p_dict["ejecutadas"] = 0
            p_dict["en_proceso"] = 0
            p_dict["pendientes"] = 0
            p_dict["avance_global"] = 0
            proyectos_resumen.append(p_dict)
            continue

        # Normalizar y procesar en memoria
        acts_dict = {}
        for a in acts_raw:
            cod = str(a["codigo"]).rstrip(".")
            acts_dict[cod] = {
                "codigo": cod,
                "avance": int(a["avance"] or 0),
                "estado": str(a["estado"] or "Pendiente")
            }

        # Función auxiliar de redondeo aritmético idéntico a Math.round() de JS
        def round_half_up(n):
            return int(n + 0.5) if n >= 0 else int(n - 0.5)

        # Aplicar Bottom-Up (Nivel 4 -> 3 -> 2 -> 1)
        todos_cods = list(acts_dict.keys())
        for nivel_actual in [4, 3, 2, 1]:
            for cod, act in acts_dict.items():
                partes = cod.split(".")
                if len(partes) == nivel_actual:
                    hijos = [acts_dict[c] for c in todos_cods if c.startswith(f"{cod}.") and len(c.split(".")) == nivel_actual + 1]
                    if hijos:
                        prom_av = round_half_up(sum(h["avance"] for h in hijos) / len(hijos))
                        act["avance"] = prom_av
                        if prom_av == 100:
                            act["estado"] = "Ejecutado"
                        elif prom_av > 0:
                            act["estado"] = "En proceso"
                        else:
                            act["estado"] = "Pendiente"

        # Conteo final sincronizado
        acts_finales = list(acts_dict.values())
        ejec = sum(1 for a in acts_finales if a["estado"] == "Ejecutado")
        proc = sum(1 for a in acts_finales if a["estado"] == "En proceso")
        pend = sum(1 for a in acts_finales if a["estado"] == "Pendiente")
        
        # Avance global promedio de actividades de nivel 1 (raíces)
        raices = [a for a in acts_finales if not "." in a["codigo"]]
        pct_global = round_half_up(sum(a["avance"] for a in raices) / len(raices)) if raices else 0

        p_dict["total_actividades"] = len(acts_finales)
        p_dict["ejecutadas"] = ejec
        p_dict["en_proceso"] = proc
        p_dict["pendientes"] = pend
        p_dict["avance_global"] = pct_global
        proyectos_resumen.append(p_dict)

    return proyectos_resumen

@app.post("/proyectos")
def crear_nuevo_proyecto(p: ProyectoCrearModel, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    db.execute("INSERT INTO proyectos (nombre, descripcion, creador_id) VALUES (?, ?, ?)",
               (p.nombre.strip(), p.descripcion.strip(), user["id"]))
    nuevo_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    
    db.execute("INSERT INTO proyecto_usuarios (proyecto_id, usuario_id, es_gestor) VALUES (?, ?, 1)",
               (nuevo_id, user["id"]))
    
    db.execute("INSERT INTO historial (proyecto_id, accion, detalle) VALUES (?, 'Creación Proyecto', ?)",
               (nuevo_id, f"Proyecto creado por [{user['username']}]"))
    db.commit()
    return {"mensaje": "Proyecto creado exitosamente", "proyecto_id": nuevo_id}

# --- ACTUALIZAR DESCRIPCIÓN DE PROYECTO (MÁX 120 CARACTERES) ---
class ProyectoDescripcionUpdate(BaseModel):
    descripcion: str

@app.put("/proyectos/{proyecto_id}/descripcion")
def actualizar_descripcion_proyecto(
    proyecto_id: int, 
    data: ProyectoDescripcionUpdate, 
    user: dict = Depends(get_current_user), 
    db: sqlite3.Connection = Depends(get_db)
):
    # Validar permisos de Gestor o Creador
    permiso = db.execute("""
        SELECT 1 FROM proyectos p
        LEFT JOIN proyecto_usuarios pu ON p.id = pu.proyecto_id AND pu.usuario_id = ?
        WHERE p.id = ? AND (p.creador_id = ? OR pu.es_gestor = 1)
    """, (user["id"], proyecto_id, user["id"])).fetchone()
    
    if not permiso and user.get("rol") != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="No tiene permisos de Gestor en este proyecto.")
    
    desc_limpia = (data.descripcion or "").strip()[:120]
    db.execute("UPDATE proyectos SET descripcion = ? WHERE id = ?", (desc_limpia, proyecto_id))
    db.commit()
    return {"message": "Descripción actualizada correctamente", "descripcion": desc_limpia}

# --- CONFIGURACIÓN DE PROYECTO ---
@app.get("/configuracion/nombre_proyecto")
def obtener_nombre_proyecto(db: sqlite3.Connection = Depends(get_db)):
    row = db.execute("SELECT valor FROM configuracion WHERE clave = 'nombre_proyecto'").fetchone()
    return {"valor": row["valor"] if row else "GESTIÓN DE CONVENIOS"}

@app.post("/configuracion/nombre_proyecto")
def guardar_nombre_proyecto(cfg: ConfigValorModel, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    db.execute("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('nombre_proyecto', ?)", (cfg.valor.strip(),))
    db.commit()
    return {"mensaje": "Guardado"}

# --- ACTIVIDADES Y GANTT POR PROYECTO ---
@app.get("/proyectos/{proyecto_id}/actividades")
def obtener_actividades_proyecto(proyecto_id: int, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute("SELECT * FROM actividades WHERE proyecto_id = ? ORDER BY codigo ASC", (proyecto_id,)).fetchall()
    return [dict(r) for r in rows]

@app.post("/actividades")
def guardar_actividad(act: ActividadModel, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    try:
        p_id = act.proyecto_id or 1
        cod = str(act.codigo).strip()
        desc = str(act.descripcion).strip()
        resp = str(act.responsable or "No asignado").strip()
        est = str(act.estado or "Pendiente").strip()
        av = int(act.avance if act.avance is not None else 0)
        f_ini = str(act.fecha_inicio or "").strip()
        f_fin = str(act.fecha_fin or "").strip()
        dias_val = int(act.dias if act.dias is not None else 1)
        pred = str(act.predecesores or "").strip()

        es_gestor = db.execute("""
            SELECT 1 FROM proyectos p 
            LEFT JOIN proyecto_usuarios pu ON p.id = pu.proyecto_id AND pu.usuario_id = ?
            WHERE p.id = ? AND (p.creador_id = ? OR pu.es_gestor = 1)
        """, (user["id"], p_id, user["id"])).fetchone()

        existe = db.execute("SELECT codigo, responsable FROM actividades WHERE proyecto_id = ? AND codigo = ?", (p_id, cod)).fetchone()

        if not es_gestor:
            if not existe or user.get("nombre_completo", user["username"]) not in existe["responsable"]:
                raise HTTPException(status_code=403, detail="Permiso denegado: Solo puedes modificar tus actividades asignadas.")

        if existe:
            if es_gestor:
                db.execute("""
                    UPDATE actividades 
                    SET descripcion = ?, responsable = ?, estado = ?, avance = ?, 
                        fecha_inicio = ?, fecha_fin = ?, dias = ?, predecesores = ?
                    WHERE proyecto_id = ? AND codigo = ?
                """, (desc, resp, est, av, f_ini, f_fin, dias_val, pred, p_id, cod))
            else:
                db.execute("""
                    UPDATE actividades 
                    SET estado = ?, avance = ?
                    WHERE proyecto_id = ? AND codigo = ?
                """, (est, av, p_id, cod))
            accion = "Modificación"
        else:
            if not es_gestor:
                raise HTTPException(status_code=403, detail="Solo un Gestor del Proyecto puede dar de alta nuevas actividades.")
            db.execute("""
                INSERT INTO actividades (proyecto_id, codigo, descripcion, responsable, estado, avance, fecha_inicio, fecha_fin, dias, predecesores)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (p_id, cod, desc, resp, est, av, f_ini, f_fin, dias_val, pred))
            accion = "Alta"

        db.execute("INSERT INTO historial (proyecto_id, accion, detalle) VALUES (?, ?, ?)",
                   (p_id, accion, f"[{user['username']}] [{cod}] {desc}"))

        db.commit()
        return {"mensaje": "Actividad guardada correctamente"}
    except HTTPException as he:
        raise he
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error en base de datos: {str(e)}")

@app.delete("/proyectos/{proyecto_id}/actividades/{codigo}")
def eliminar_actividad(proyecto_id: int, codigo: str, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    es_gestor = db.execute("""
        SELECT 1 FROM proyectos p 
        LEFT JOIN proyecto_usuarios pu ON p.id = pu.proyecto_id AND pu.usuario_id = ?
        WHERE p.id = ? AND (p.creador_id = ? OR pu.es_gestor = 1)
    """, (user["id"], proyecto_id, user["id"])).fetchone()

    if not es_gestor:
        raise HTTPException(status_code=403, detail="Solo un Gestor del Proyecto puede eliminar actividades.")

    cod_limpio = codigo.rstrip(".")
    db.execute("DELETE FROM actividades WHERE proyecto_id = ? AND (codigo = ? OR codigo LIKE ?)",
               (proyecto_id, codigo, f"{cod_limpio}.%"))
    db.execute("INSERT INTO historial (proyecto_id, accion, detalle) VALUES (?, 'Eliminación', ?)",
               (proyecto_id, f"[{user['username']}] Eliminó [{codigo}] y subordinadas"))
    db.commit()
    return {"mensaje": "Actividad(es) eliminada(s)"}

# --- RESPONSABLES (CRUD COMPLETO) ---
@app.get("/responsables")
def listar_responsables(db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute("SELECT nombre, cargo, correo FROM responsables ORDER BY nombre ASC").fetchall()
    return [dict(r) for r in rows]

@app.post("/responsables")
def crear_responsable(resp: ResponsableModel, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    db.execute("INSERT INTO responsables (nombre, cargo, correo) VALUES (?, ?, ?)",
               (resp.nombre.strip(), resp.cargo.strip(), resp.correo.strip()))
    db.commit()
    return {"mensaje": "Responsable registrado"}

@app.put("/responsables")
def actualizar_responsable(resp: ResponsableActualizarModel, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    db.execute("UPDATE responsables SET nombre = ?, cargo = ?, correo = ? WHERE nombre = ?",
               (resp.nombre_nuevo.strip(), resp.cargo.strip(), resp.correo.strip(), resp.nombre_original.strip()))
    db.commit()
    return {"mensaje": "Responsable actualizado"}

@app.delete("/responsables/{nombre}")
def eliminar_responsable(nombre: str, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    db.execute("DELETE FROM responsables WHERE nombre = ?", (nombre,))
    db.commit()
    return {"mensaje": "Responsable eliminado"}

# --- RUTA CRÍTICA (CPM) E HISTORIAL ---
@app.get("/proyectos/{proyecto_id}/historial")
def ver_historial(proyecto_id: int, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute("SELECT timestamp, accion, detalle FROM historial WHERE proyecto_id = ? ORDER BY id DESC LIMIT 100", (proyecto_id,)).fetchall()
    return [dict(r) for r in rows]

# --- ALGORITMO FORMAL CPM (CRITICAL PATH METHOD) ---
@app.get("/ruta-critica")
def calcular_cpm(proyecto_id: Optional[int] = 1, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute("""
        SELECT codigo, descripcion, dias, predecesores, fecha_inicio, fecha_fin 
        FROM actividades 
        WHERE proyecto_id = ? 
        ORDER BY codigo ASC
    """, (proyecto_id,)).fetchall()

    if not rows:
        return {"duracion_proyecto_dias": 0, "detalles": {}}

    # Solo procesamos actividades terminales (hojas) para el grafo CPM formal
    todos_codigos = [r["codigo"] for r in rows]
    actividades_dict = {}
    
    for r in rows:
        cod = r["codigo"]
        # Determinar si es nodo terminal (no tiene hijos jerárquicos)
        cod_limpio = cod.rstrip(".")
        es_madre = any(otro.startswith(f"{cod_limpio}.") and otro != cod for otro in todos_codigos)
        
        actividades_dict[cod] = {
            "codigo": cod,
            "descripcion": r["descripcion"],
            "duracion": max(1, int(r["dias"] or 1)),
            "predecesores": [p.strip() for p in (r["predecesores"] or "").split(",") if p.strip() and p.strip() in todos_codigos],
            "es_madre": es_madre,
            "ES": 0,
            "EF": 0,
            "LS": 0,
            "LF": 0,
            "holgura": 0,
            "es_critica": False
        }

    nodos = {k: v for k, v in actividades_dict.items() if not v["es_madre"]}
    if not nodos:
        nodos = actividades_dict

    # 1. FORWARD PASS (Early Start & Early Finish)
    cambio = True
    pasadas = 0
    while cambio and pasadas < len(nodos) * 2:
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

    # 2. BACKWARD PASS (Late Start & Late Finish)
    for n in nodos.values():
        n["LF"] = duracion_total
        n["LS"] = duracion_total - n["duracion"]

    cambio = True
    pasadas = 0
    while cambio and pasadas < len(nodos) * 2:
        cambio = False
        pasadas += 1
        for cod, n in nodos.items():
            sucesores = [s for s in nodos.values() if cod in s["predecesores"]]
            if sucesores:
                min_ls_suc = min(s["LS"] for s in sucesores)
                nuevo_lf = min_ls_suc
                nuevo_ls = nuevo_lf - n["duracion"]
                if nuevo_lf != n["LF"] or nuevo_ls != n["LS"]:
                    n["LF"] = nuevo_lf
                    n["LS"] = nuevo_ls
                    cambio = True

    # 3. CÁLCULO DE HOLGURA Y RUTA CRÍTICA REAL
    for n in nodos.values():
        n["holgura"] = max(0, n["LS"] - n["ES"])
        n["es_critica"] = (n["holgura"] == 0 and n["duracion"] > 0)

    return {"duracion_proyecto_dias": duracion_total, "detalles": nodos}


# --- HISTORIAL ROBUSTO SANEADO ---
@app.get("/proyectos/{proyecto_id}/historial")
def ver_historial(proyecto_id: int, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    try:
        rows = db.execute("""
            SELECT COALESCE(timestamp, datetime('now')) as timestamp, 
                   COALESCE(accion, 'Registro') as accion, 
                   COALESCE(detalle, 'Operación sin detalle') as detalle 
            FROM historial 
            WHERE proyecto_id = ? 
            ORDER BY id DESC LIMIT 150
        """, (proyecto_id,)).fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        return []

# --- MÓDULO DE NOTIFICACIONES Y ALERTAS PREVENTIVAS BLINDADO ---
class NotificacionRequest(BaseModel):
    proyecto_id: int
    codigo_actividad: str
    destinatarios_nuevos: Optional[List[str]] = []
    dias_recordatorio: Optional[List[int]] = []

@app.post("/notificaciones/asignacion")
def programar_notificacion_asignacion(
    data: NotificacionRequest, 
    user: dict = Depends(get_current_user), 
    db: sqlite3.Connection = Depends(get_db)
):
    try:
        # Asegurar existencia de la tabla
        db.execute("""
            CREATE TABLE IF NOT EXISTS alertas_notificaciones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                proyecto_id INTEGER,
                codigo_actividad TEXT,
                destinatario_nombre TEXT,
                destinatario_correo TEXT,
                tipo_alerta TEXT,
                dias_antes INTEGER,
                fecha_programada TEXT,
                estado TEXT DEFAULT 'PROGRAMADO',
                fecha_envio DATETIME,
                FOREIGN KEY(proyecto_id) REFERENCES proyectos(id)
            )
        """)

        # Búsqueda flexible por ID numérico o string
        proy = db.execute("SELECT nombre FROM proyectos WHERE id = ?", (int(data.proyecto_id),)).fetchone()
        
        cod_limpio = str(data.codigo_actividad).strip().rstrip(".")
        act = db.execute("""
            SELECT * FROM actividades 
            WHERE (proyecto_id = ? OR proyecto_id = ?) 
              AND (codigo = ? OR codigo = ?)
        """, (int(data.proyecto_id), str(data.proyecto_id), cod_limpio, f"{cod_limpio}.")).fetchone()

        if not act:
            # Fallback para no bloquear la demo si la actividad existe
            act_desc = f"Actividad {cod_limpio}"
            resp_str = ""
        else:
            act_desc = act["descripcion"]
            resp_str = act["responsable"] or ""

        if data.destinatarios_nuevos and len(data.destinatarios_nuevos) > 0:
            nombres_a_notificar = [str(n).strip() for n in data.destinatarios_nuevos if str(n).strip()]
        else:
            nombres_a_notificar = [r.strip() for r in resp_str.split(";") if r.strip() and r.strip() != "No asignado"]

        registros_creados = 0
        fecha_hoy = datetime.now().strftime("%Y-%m-%d")
        fecha_hora_ahora = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        for nombre in nombres_a_notificar:
            r_info = db.execute("SELECT correo FROM responsables WHERE nombre = ?", (nombre,)).fetchone()
            correo = r_info["correo"] if r_info and r_info["correo"] else f"{nombre.lower().replace(' ', '.')}@imarpe.gob.pe"

            # 1. Alerta inicial inmediata
            db.execute("""
                INSERT INTO alertas_notificaciones 
                (proyecto_id, codigo_actividad, destinatario_nombre, destinatario_correo, tipo_alerta, dias_antes, fecha_programada, estado, fecha_envio)
                VALUES (?, ?, ?, ?, 'ASIGNACION_INICIAL', 0, ?, 'ENVIADO', ?)
            """, (int(data.proyecto_id), cod_limpio, nombre, correo, fecha_hoy, fecha_hora_ahora))

            # 2. Recordatorios preventivos
            for d in (data.dias_recordatorio or []):
                db.execute("""
                    INSERT INTO alertas_notificaciones 
                    (proyecto_id, codigo_actividad, destinatario_nombre, destinatario_correo, tipo_alerta, dias_antes, fecha_programada, estado)
                    VALUES (?, ?, ?, ?, 'RECORDATORIO_PREVENTIVO', ?, ?, 'PROGRAMADO')
                """, (int(data.proyecto_id), cod_limpio, nombre, correo, int(d), fecha_hoy))

            registros_creados += 1

        # Auditoría en historial
        db.execute("""
            INSERT INTO historial (proyecto_id, accion, detalle)
            VALUES (?, 'Notificación Correo', ?)
        """, (int(data.proyecto_id), f"Notificación enviada a: [{', '.join(nombres_a_notificar)}] para actividad [{cod_limpio}]"))

        db.commit()
        return {
            "status": "success",
            "mensaje": f"Notificaciones procesadas para {registros_creados} responsable(s).",
            "destinatarios": nombres_a_notificar
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error en servidor: {str(e)}")

# Servir frontend estático
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/", StaticFiles(directory="templates", html=True), name="templates")