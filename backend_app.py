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

app = FastAPI(title="IMARPE Project Management Engine", version="9.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/token")

# --- FUNCIONES DE CIBERSEGURIDAD (HASH PBKDF2) ---
def hash_password(password: str) -> str:
    salt = hashlib.sha256(os.urandom(60)).hexdigest().encode('ascii')
    pwdhash = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 100000)
    pwdhash = binascii.hexlify(pwdhash)
    return (salt + pwdhash).decode('ascii')

def verify_password(stored_password: str, provided_password: str) -> bool:
    if not stored_password:
        return False
    # Compatibilidad con texto plano previo
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

# Reemplaza la función init_db() por esta versión autorreparadora:
def init_db():
    if os.path.exists("/data") and not os.path.exists(DB_PATH) and os.path.exists("imarpe_gantt.db"):
        import shutil
        try:
            shutil.copy("imarpe_gantt.db", DB_PATH)
        except Exception:
            pass

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    # 1. Asegurar tabla usuarios
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

    # Migrar columnas en usuarios si no existían
    for col, definition in [("nombre_completo", "TEXT"), ("rol", "TEXT DEFAULT 'OPERADOR'"), ("estado", "TEXT DEFAULT 'ACTIVO'")]:
        try:
            c.execute(f"ALTER TABLE usuarios ADD COLUMN {col} {definition}")
        except sqlite3.OperationalError:
            pass

    # 2. Asegurar o restablecer la cuenta Administrador TI semilla
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

    # 3. Tablas relacionales del sistema
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

    c.execute("""
        CREATE TABLE IF NOT EXISTS proyecto_usuarios (
            proyecto_id INTEGER,
            usuario_id INTEGER,
            es_gestor BOOLEAN DEFAULT 0,
            PRIMARY KEY (proyecto_id, usuario_id)
        )
    """)

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

    try:
        c.execute("ALTER TABLE actividades ADD COLUMN proyecto_id INTEGER DEFAULT 1")
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
        CREATE TABLE IF NOT EXISTS historial (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            proyecto_id INTEGER DEFAULT 1,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            accion TEXT,
            detalle TEXT
        )
    """)

    # 4. Asegurar Proyecto Semilla
    c.execute("SELECT id FROM proyectos WHERE id = 1")
    if not c.fetchone():
        c.execute("INSERT INTO proyectos (id, nombre, creador_id) VALUES (1, 'GESTIÓN DE CONVENIOS', ?)", (admin_id,))
        c.execute("INSERT OR REPLACE INTO proyecto_usuarios (proyecto_id, usuario_id, es_gestor) VALUES (1, ?, 1)", (admin_id,))
    else:
        c.execute("INSERT OR REPLACE INTO proyecto_usuarios (proyecto_id, usuario_id, es_gestor) VALUES (1, ?, 1)", (admin_id,))

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
@app.get("/proyectos")
def listar_proyectos_usuario(user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    # Retorna proyectos donde el usuario es Creador, Gestor o tiene actividades asignadas
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
        # Métricas calculadas para la tarjeta del Hub
        acts = db.execute("SELECT avance, estado FROM actividades WHERE proyecto_id = ?", (p_dict["id"],)).fetchall()
        total = len(acts)
        ejec = sum(1 for a in acts if a["estado"] == "Ejecutado")
        proc = sum(1 for a in acts if a["estado"] == "En proceso")
        pend = sum(1 for a in acts if a["estado"] == "Pendiente")
        
        # Avance global promedio de nivel 1
        r1 = db.execute("SELECT avance FROM actividades WHERE proyecto_id = ? AND codigo NOT LIKE '%.%'", (p_dict["id"],)).fetchall()
        pct_global = round(sum(a["avance"] for a in r1) / len(r1)) if r1 else 0

        p_dict["total_actividades"] = total
        p_dict["ejecutadas"] = ejec
        p_dict["en_proceso"] = proc
        p_dict["pendientes"] = pend
        p_dict["avance_global"] = pct_global
        proyectos_resumen.append(p_dict)

    return proyectos_resumen

@app.post("/proyectos")
def crear_nuevo_proyecto(p: ProyectoCrearModel, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    # Cualquier usuario autenticado (Admin TI u Operador) puede crear un proyecto y ser su Gestor
    db.execute("INSERT INTO proyectos (nombre, descripcion, creador_id) VALUES (?, ?, ?)",
               (p.nombre.strip(), p.descripcion.strip(), user["id"]))
    nuevo_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    
    # Asignar como Gestor del Proyecto
    db.execute("INSERT INTO proyecto_usuarios (proyecto_id, usuario_id, es_gestor) VALUES (?, ?, 1)",
               (nuevo_id, user["id"]))
    
    db.execute("INSERT INTO historial (proyecto_id, accion, detalle) VALUES (?, 'Creación Proyecto', ?)",
               (nuevo_id, f"Proyecto creado por [{user['username']}]"))
    db.commit()
    return {"mensaje": "Proyecto creado exitosamente", "proyecto_id": nuevo_id}

# --- ACTIVIDADES Y GANTT POR PROYECTO ---
@app.get("/proyectos/{proyecto_id}/actividades")
def obtener_actividades_proyecto(proyecto_id: int, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute("SELECT * FROM actividades WHERE proyecto_id = ? ORDER BY codigo ASC", (proyecto_id,)).fetchall()
    return [dict(r) for r in rows]

@app.post("/actividades")
def guardar_actividad(act: ActividadModel, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    try:
        p_id = act.proyecto_id
        cod = str(act.codigo).strip()
        desc = str(act.descripcion).strip()
        resp = str(act.responsable or "No asignado").strip()
        est = str(act.estado or "Pendiente").strip()
        av = int(act.avance if act.avance is not None else 0)
        f_ini = str(act.fecha_inicio or "").strip()
        f_fin = str(act.fecha_fin or "").strip()
        dias_val = int(act.dias if act.dias is not None else 1)
        pred = str(act.predecesores or "").strip()

        # Validación de seguridad: Verificar si es Gestor o Responsable
        es_gestor = db.execute("""
            SELECT 1 FROM proyectos p 
            LEFT JOIN proyecto_usuarios pu ON p.id = pu.proyecto_id AND pu.usuario_id = ?
            WHERE p.id = ? AND (p.creador_id = ? OR pu.es_gestor = 1)
        """, (user["id"], p_id, user["id"])).fetchone()

        existe = db.execute("SELECT codigo, responsable FROM actividades WHERE proyecto_id = ? AND codigo = ?", (p_id, cod)).fetchone()

        if not es_gestor:
            # Si no es gestor, solo puede actualizar estado y avance de su actividad asignada
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

# --- RESPONSABLES E HISTORIAL ---
@app.get("/responsables")
def listar_responsables(db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute("SELECT nombre, cargo, correo FROM responsables ORDER BY nombre ASC").fetchall()
    return [dict(r) for r in rows]

@app.get("/proyectos/{proyecto_id}/historial")
def ver_historial(proyecto_id: int, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute("SELECT timestamp, accion, detalle FROM historial WHERE proyecto_id = ? ORDER BY id DESC LIMIT 100", (proyecto_id,)).fetchall()
    return [dict(r) for r in rows]

# Servir frontend estático
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/", StaticFiles(directory="templates", html=True), name="templates")