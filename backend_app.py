import os
import sqlite3
import hashlib
import binascii
from datetime import datetime, timedelta, timezone
from typing import Optional, List
from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from jose import JWTError, jwt

# --- CONFIGURACIÓN DE ZONA HORARIA PERÚ (UTC-5) ---
ZONA_PERU = timezone(timedelta(hours=-5))

def ahora_peru_str() -> str:
    return datetime.now(ZONA_PERU).strftime("%Y-%m-%d %H:%M:%S")

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
    nombres: str
    apellidos: str
    username: str
    password: str
    rol: str

class UsuarioEstadoUpdate(BaseModel):
    usuario_id: int
    estado: str  # 'ACTIVO' | 'INACTIVO'

class UsuarioRolUpdate(BaseModel):
    usuario_id: int
    rol: str  # 'ADMIN_TI' | 'OPERADOR'

class UnidadOrganicaModel(BaseModel):
    nombre: str
    sigla: str
    tipo_organo: Optional[str] = "Órgano de Línea"

class TrabajadorAltaModel(BaseModel):
    nombres: str
    apellidos: str
    unidad_organica: str
    correo_usuario: str  # parte antes del @imarpe.gob.pe

class TrabajadorActualizarModel(BaseModel):
    id: int
    nombres: str
    apellidos: str
    unidad_organica: str
    correo: str

class PermisoProyectoUpdate(BaseModel):
    usuario_id: int
    nivel: str  # 'NINGUNO' | 'LECTURA' | 'GESTOR'

class ProyectoCrearModel(BaseModel):
    nombre: str
    descripcion: Optional[str] = ""
    unidad_organica: Optional[str] = ""

class ProyectoDescripcionUpdate(BaseModel):
    descripcion: str

class ProyectoNombreUpdate(BaseModel):
    nombre: str

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

class NotificacionRequest(BaseModel):
    proyecto_id: int
    codigo_actividad: str
    destinatarios_nuevos: Optional[List[str]] = []
    dias_recordatorio: Optional[List[int]] = []

class ComentarioCreate(BaseModel):
    proyecto_id: int
    codigo_actividad: str
    texto: str

class ComentarioCreate(BaseModel):
    proyecto_id: int
    codigo_actividad: str
    texto: str

class ComentarioUpdate(BaseModel):
    texto: str

class AsignacionResponsableModel(BaseModel):
    proyecto_id: int
    codigo: str
    responsable: str

class ReordenarActividadesModel(BaseModel):
    proyecto_id: int
    codigos_ordenados: List[str]

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

    # 1. Tabla Usuarios
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

    # 3. Tabla Proyectos
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
    for col, defn in [("descripcion", "TEXT"), ("creador_id", "INTEGER"), ("unidad_organica", "TEXT")]:
        try:
            c.execute(f"ALTER TABLE proyectos ADD COLUMN {col} {defn}")
        except sqlite3.OperationalError:
            pass

    # 4. Tabla Permisos Proyecto
    c.execute("""
        CREATE TABLE IF NOT EXISTS proyecto_usuarios (
            proyecto_id INTEGER,
            usuario_id INTEGER,
            es_gestor BOOLEAN DEFAULT 0,
            permiso TEXT DEFAULT 'GESTOR',
            PRIMARY KEY (proyecto_id, usuario_id)
        )
    """)
    try:
        c.execute("ALTER TABLE proyecto_usuarios ADD COLUMN permiso TEXT DEFAULT 'GESTOR'")
    except sqlite3.OperationalError:
        pass

    # 5. Tabla Actividades
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

    # 6. Tabla Historial con auto-migración garantizada
    c.execute("""
        CREATE TABLE IF NOT EXISTS historial (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            proyecto_id INTEGER DEFAULT 1,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            usuario TEXT DEFAULT 'admin',
            accion TEXT,
            detalle TEXT
        )
    """)
    for col, defn in [("proyecto_id", "INTEGER DEFAULT 1"), ("usuario", "TEXT DEFAULT 'admin'")]:
        try:
            c.execute(f"ALTER TABLE historial ADD COLUMN {col} {defn}")
        except sqlite3.OperationalError:
            pass

    # 7. Tablas auxiliares
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

    c.execute("""
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

    # Proyecto semilla
    c.execute("SELECT id FROM proyectos WHERE id = 1")
    if not c.fetchone():
        c.execute("INSERT INTO proyectos (id, nombre, creador_id) VALUES (1, 'GESTIÓN DE CONVENIOS', ?)", (admin_id,))
        c.execute("INSERT OR REPLACE INTO proyecto_usuarios (proyecto_id, usuario_id, es_gestor) VALUES (1, ?, 1)", (admin_id,))
    else:
        c.execute("INSERT OR REPLACE INTO proyecto_usuarios (proyecto_id, usuario_id, es_gestor) VALUES (1, ?, 1)", (admin_id,))

    # Índices de aceleración seguros en SQLite
    for idx_sql in [
        "CREATE INDEX IF NOT EXISTS idx_historial_proy ON historial(proyecto_id, timestamp DESC)",
        "CREATE INDEX IF NOT EXISTS idx_actividades_proy ON actividades(proyecto_id, codigo)",
        "CREATE INDEX IF NOT EXISTS idx_proy_usuarios ON proyecto_usuarios(proyecto_id, usuario_id)",
        "CREATE INDEX IF NOT EXISTS idx_usuarios_estado ON usuarios(estado)"
    ]:
        try:
            c.execute(idx_sql)
        except sqlite3.OperationalError:
            pass

    # Normalizar roles heredados a los únicos oficiales (ADMIN_TI y OPERADOR)
    c.execute("""
        UPDATE usuarios 
        SET rol = 'OPERADOR' 
        WHERE rol NOT IN ('ADMIN_TI', 'OPERADOR')
    """)

    # Tabla Unidades Orgánicas
    c.execute("""
        CREATE TABLE IF NOT EXISTS unidades_organicas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            sigla TEXT UNIQUE NOT NULL,
            tipo_organo TEXT NOT NULL,
            estado TEXT DEFAULT 'ACTIVO'
        )
    """)

    # Tabla Directorio de Trabajadores Institucionales
    c.execute("""
        CREATE TABLE IF NOT EXISTS trabajadores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombres TEXT NOT NULL,
            apellidos TEXT NOT NULL,
            nombre_completo TEXT NOT NULL,
            unidad_organica TEXT NOT NULL,
            correo TEXT UNIQUE NOT NULL,
            estado TEXT DEFAULT 'ACTIVO'
        )
    """)

    # Índices seguros
    for idx_sql in [
        "CREATE INDEX IF NOT EXISTS idx_trabajadores_busq ON trabajadores(nombre_completo, unidad_organica)",
        "CREATE INDEX IF NOT EXISTS idx_unidades_sigla ON unidades_organicas(sigla)"
    ]:
        try:
            c.execute(idx_sql)
        except sqlite3.OperationalError:
            pass

    # Semilla oficial de Unidades Orgánicas del IMARPE
    c.execute("SELECT COUNT(*) FROM unidades_organicas")
    if c.fetchone()[0] == 0:
        unidades_semilla = [
            ("Consejo Directivo", "CD", "ÓRGANOS DE LA ALTA DIRECCIÓN"),
            ("Presidencia Ejecutiva", "PE", "ÓRGANOS DE LA ALTA DIRECCIÓN"),
            ("Gerencia Científica", "GC", "ÓRGANOS DE LA ALTA DIRECCIÓN"),
            ("Gerencia General", "GG", "ÓRGANOS DE LA ALTA DIRECCIÓN"),
            ("Órgano de Control Institucional", "OCI", "ÓRGANOS DE CONTROL"),
            ("Oficina de Asesoría Jurídica", "OAJ", "ÓRGANOS DE ASESORAMIENTO"),
            ("Oficina de Planeamiento, Presupuesto y Modernización", "OPPM", "ÓRGANOS DE ASESORAMIENTO"),
            ("Oficina de Administración", "OA", "ÓRGANOS DE APOYO"),
            ("Unidad de Abastecimiento y Control Patrimonial", "UACP", "ÓRGANOS DE APOYO"),
            ("Unidad de Gestión Financiera", "UGF", "ÓRGANOS DE APOYO"),
            ("Oficina de Recursos Humanos", "ORH", "ÓRGANOS DE APOYO"),
            ("Oficina de Tecnologías de la Información", "OTI", "ÓRGANOS DE APOYO"),
            ("Dirección de Investigaciones del Subsistema Pelágico", "DISP", "ÓRGANOS DE LINEA"),
            ("Subdirección de Investigaciones en Recursos Neríticos Pelágicos", "SIRNP", "ÓRGANOS DE LINEA"),
            ("Subdirección de Investigaciones en Recursos Transzonales y Altamente Migratorios", "SIRTAM", "ÓRGANOS DE LINEA"),
            ("Subdirección de Investigaciones en Dinámica Poblacional en Recursos Pelágicos", "SIDPRP", "ÓRGANOS DE LINEA"),
            ("Dirección de Investigaciones del Subsistema Bentodemersal", "DISB", "ÓRGANOS DE LINEA"),
            ("Subdirección de Investigaciones en Peces Demersales y Costeros", "SIPDC", "ÓRGANOS DE LINEA"),
            ("Subdirección de Investigaciones en Biodiversidad Acuática", "SIBA", "ÓRGANOS DE LINEA"),
            ("Subdirección de Investigaciones en Invertebrados y Macroalgas Marinas", "SIIMM", "ÓRGANOS DE LINEA"),
            ("Subdirección de Investigaciones en Pesca Artesanal", "SIPA", "ÓRGANOS DE LINEA"),
            ("Dirección de Investigaciones en Ciencias Marinas", "DICM", "ÓRGANOS DE LINEA"),
            ("Subdirección de Investigaciones en Física y Modelado del Océano", "SIFMO", "ÓRGANOS DE LINEA"),
            ("Subdirección de Investigaciones en Química y Geología", "SIQG", "ÓRGANOS DE LINEA"),
            ("Subdirección de Investigaciones en Biología del Océano", "SIBO", "ÓRGANOS DE LINEA"),
            ("Dirección de Investigaciones en Acuicultura", "DIA", "ÓRGANOS DE LINEA"),
            ("Subdirección de Investigaciones en Sistemas Acuícolas", "SISA", "ÓRGANOS DE LINEA"),
            ("Subdirección de Investigaciones en Recursos de Aguas Continentales", "SIRAC", "ÓRGANOS DE LINEA"),
            ("Subdirección de Investigaciones en Calidad Acuática de Ambientes Litorales", "SICAAL", "ÓRGANOS DE LINEA"),
            ("Dirección de Investigaciones en Pesca y Desarrollo Tecnológico", "DIPDT", "ÓRGANOS DE LINEA"),
            ("Subdirección de Investigaciones en Tecnología Hidroacústica", "SITH", "ÓRGANOS DE LINEA"),
            ("Subdirección de Investigaciones en Sensoramiento Remoto", "SISR", "ÓRGANOS DE LINEA"),
            ("Subdirección de Investigaciones en Sistemas y Métodos de Pesca", "SISMP", "ÓRGANOS DE LINEA"),
            ("Subdirección de Ediciones y Difusión del Conocimiento Científico y Tecnológico", "SEDCCT", "ÓRGANOS DE LINEA"),
            ("Sedes Desconcentrada Tumbes", "SD Tumbes", "ÓRGANOS DESCONCENTRADOS"),
            ("Sedes Desconcentrada Paita", "SD Paita", "ÓRGANOS DESCONCENTRADOS"),
            ("Sedes Desconcentrada Santa Rosa", "SD Santa Rosa", "ÓRGANOS DESCONCENTRADOS"),
            ("Sedes Desconcentrada Huanchaco", "SD Huanchaco", "ÓRGANOS DESCONCENTRADOS"),
            ("Sedes Desconcentrada Chimbote", "SD Chimbote", "ÓRGANOS DESCONCENTRADOS"),
            ("Sedes Desconcentrada Huacho", "SD Huacho", "ÓRGANOS DESCONCENTRADOS"),
            ("Sedes Desconcentrada Pisco", "SD Pisco", "ÓRGANOS DESCONCENTRADOS"),
            ("Sedes Desconcentrada Camaná", "SD Camaná", "ÓRGANOS DESCONCENTRADOS"),
            ("Sedes Desconcentrada Ilo", "SD Ilo", "ÓRGANOS DESCONCENTRADOS"),
            ("Sedes Desconcentrada Puno", "SD Puno", "ÓRGANOS DESCONCENTRADOS"),
            ("Centro de Plataformas Flotantes de Investigación Marina y Continental", "CPFIMC", "ÓRGANOS DESCONCENTRADOS")
        ]
        c.executemany("""
            INSERT INTO unidades_organicas (nombre, sigla, tipo_organo, estado)
            VALUES (?, ?, ?, 'ACTIVO')
        """, unidades_semilla)

# Tabla Comentarios de Actividad (Colaborativo tipo Word 365)
    c.execute("""
        CREATE TABLE IF NOT EXISTS comentarios_actividad (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            proyecto_id INTEGER NOT NULL,
            codigo_actividad TEXT NOT NULL,
            usuario_id INTEGER NOT NULL,
            autor_nombre TEXT NOT NULL,
            autor_unidad TEXT NOT NULL,
            texto TEXT NOT NULL,
            fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            fecha_edicion TIMESTAMP,
            FOREIGN KEY (proyecto_id) REFERENCES proyectos(id) ON DELETE CASCADE,
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        )
    """)

    try:
        c.execute("CREATE INDEX IF NOT EXISTS idx_comentarios_proy_act ON comentarios_actividad(proyecto_id, codigo_actividad)")
    except sqlite3.OperationalError:
        pass

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

# --- GESTIÓN DE USUARIOS (ADMIN TI) ---
@app.get("/usuarios")
def listar_usuarios(user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    if user["rol"] != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="Acceso denegado: Solo Admin TI.")
    
    rows = db.execute("""
        SELECT id, username, 
               COALESCE(nombre_completo, username) as nombre_completo, 
               rol, 
               COALESCE(estado, 'ACTIVO') as estado 
        FROM usuarios 
        ORDER BY id DESC
    """).fetchall()
    return [dict(r) for r in rows]

@app.post("/usuarios")
def alta_usuario(nuevo: UsuarioAltaModel, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    if user["rol"] != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="Solo el Administrador TI puede dar de alta usuarios.")
    
    user_limpio = nuevo.username.strip().lower()
    nombre_comp = f"{nuevo.apellidos.strip()}, {nuevo.nombres.strip()}"
    
    existe = db.execute("SELECT id FROM usuarios WHERE username = ?", (user_limpio,)).fetchone()
    if existe:
        raise HTTPException(status_code=400, detail="El nombre de usuario ya está registrado.")

    hashed = hash_password(nuevo.password)
    db.execute("""
        INSERT INTO usuarios (username, password, nombre_completo, rol, estado) 
        VALUES (?, ?, ?, ?, 'ACTIVO')
    """, (user_limpio, hashed, nombre_comp, nuevo.rol))
    
    # Registrar también en el catálogo de responsables
    db.execute("INSERT OR IGNORE INTO responsables (nombre, cargo, correo) VALUES (?, ?, ?)",
               (nombre_comp, "Personal IMARPE", f"{user_limpio}@imarpe.gob.pe"))
    
    db.commit()
    return {"mensaje": "Usuario dado de alta exitosamente"}

@app.put("/usuarios/estado")
def alternar_estado_usuario(data: UsuarioEstadoUpdate, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    if user["rol"] != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="Solo el Administrador TI puede modificar el estado de usuarios.")
    
    if data.usuario_id == user["id"]:
        raise HTTPException(status_code=400, detail="No puedes desactivar tu propia cuenta activa.")

    db.execute("UPDATE usuarios SET estado = ? WHERE id = ?", (data.estado, data.usuario_id))
    db.commit()
    return {"mensaje": f"Estado actualizado a {data.estado}"}

@app.put("/usuarios/rol")
def actualizar_rol_global_usuario(
    data: UsuarioRolUpdate, 
    user: dict = Depends(get_current_user), 
    db: sqlite3.Connection = Depends(get_db)
):
    if user["rol"] != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="Solo el Administrador TI puede modificar roles globales.")
    
    if data.rol not in ["ADMIN_TI", "OPERADOR"]:
        raise HTTPException(status_code=400, detail="Rol no válido.")

    if data.usuario_id == user["id"] and data.rol != "ADMIN_TI":
        raise HTTPException(status_code=400, detail="No puedes quitarte el rol de Administrador TI a ti mismo.")

    db.execute("UPDATE usuarios SET rol = ? WHERE id = ?", (data.rol, data.usuario_id))
    db.commit()
    return {"mensaje": f"Rol actualizado a {data.rol}"}

# --- DIRECTORIO DE TRABAJADORES Y UNIDADES ORGÁNICAS ---
@app.get("/unidades-organicas")
def listar_unidades_organicas(db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute("SELECT id, nombre, sigla, tipo_organo, estado FROM unidades_organicas WHERE estado = 'ACTIVO' ORDER BY tipo_organo ASC, nombre ASC").fetchall()
    return [dict(r) for r in rows]

@app.post("/unidades-organicas")
def crear_unidad_organica(data: UnidadOrganicaModel, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    if user["rol"] != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="Solo el Administrador TI puede gestionar la estructura orgánica.")
    try:
        db.execute("INSERT INTO unidades_organicas (nombre, sigla, tipo_organo, estado) VALUES (?, ?, ?, 'ACTIVO')",
                   (data.nombre.strip(), data.sigla.strip().upper(), data.tipo_organo.strip()))
        db.commit()
        return {"mensaje": "Unidad Orgánica registrada exitosamente"}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="La sigla ingresada ya existe.")

@app.get("/trabajadores")
def listar_trabajadores(db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute("SELECT id, nombres, apellidos, nombre_completo, unidad_organica, correo, estado FROM trabajadores ORDER BY nombre_completo ASC").fetchall()
    return [dict(r) for r in rows]

@app.post("/trabajadores")
def crear_trabajador(data: TrabajadorAltaModel, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    if user["rol"] != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="Solo el Administrador TI puede registrar trabajadores.")
    
    nombres_limp = data.nombres.strip()
    apellidos_limp = data.apellidos.strip()
    nombre_completo = f"{apellidos_limp}, {nombres_limp}"
    
    usuario_correo = data.correo_usuario.strip().lower().replace("@imarpe.gob.pe", "")
    correo_final = f"{usuario_correo}@imarpe.gob.pe"

    try:
        db.execute("""
            INSERT INTO trabajadores (nombres, apellidos, nombre_completo, unidad_organica, correo, estado)
            VALUES (?, ?, ?, ?, ?, 'ACTIVO')
        """, (nombres_limp, apellidos_limp, nombre_completo, data.unidad_organica.strip(), correo_final))
        
        db.execute("""
            INSERT OR REPLACE INTO responsables (nombre, cargo, correo)
            VALUES (?, ?, ?)
        """, (nombre_completo, data.unidad_organica.strip(), correo_final))
        
        db.commit()
        return {"mensaje": "Trabajador registrado en el directorio institucional"}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="El correo institucional ya se encuentra registrado.")

@app.put("/trabajadores/estado/{trabajador_id}")
def alternar_estado_trabajador(trabajador_id: int, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    if user["rol"] != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="Acceso denegado")
    
    actual = db.execute("SELECT estado FROM trabajadores WHERE id = ?", (trabajador_id,)).fetchone()
    if not actual:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")
    
    nuevo_estado = "INACTIVO" if actual["estado"] == "ACTIVO" else "ACTIVO"
    db.execute("UPDATE trabajadores SET estado = ? WHERE id = ?", (nuevo_estado, trabajador_id))
    db.commit()
    return {"mensaje": f"Estado actualizado a {nuevo_estado}"}

# --- HUB DE PROYECTOS ---
@app.get("/proyectos")
def listar_proyectos_usuario(user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    u_id = user["id"]
    u_nom = user.get("nombre_completo", "")

    query = """
        SELECT DISTINCT p.id, p.nombre, p.descripcion, p.unidad_organica, p.fecha_creacion,
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
        
        acts_raw = db.execute("SELECT codigo, avance, estado FROM actividades WHERE proyecto_id = ? ORDER BY codigo ASC", (p_id,)).fetchall()
        
        if not acts_raw:
            p_dict.update({"total_actividades": 0, "ejecutadas": 0, "en_proceso": 0, "pendientes": 0, "avance_global": 0})
            proyectos_resumen.append(p_dict)
            continue

        acts_dict = {}
        for a in acts_raw:
            cod = str(a["codigo"]).rstrip(".")
            acts_dict[cod] = {
                "codigo": cod,
                "avance": int(a["avance"] or 0),
                "estado": str(a["estado"] or "Pendiente")
            }

        def round_half_up(n):
            return int(n + 0.5) if n >= 0 else int(n - 0.5)

        todos_cods = list(acts_dict.keys())
        for nivel_actual in [4, 3, 2, 1]:
            for cod, act in acts_dict.items():
                partes = cod.split(".")
                if len(partes) == nivel_actual:
                    hijos = [acts_dict[c] for c in todos_cods if c.startswith(f"{cod}.") and len(c.split(".")) == nivel_actual + 1]
                    if hijos:
                        prom_av = round_half_up(sum(h["avance"] for h in hijos) / len(hijos))
                        act["avance"] = prom_av
                        act["estado"] = "Ejecutado" if prom_av == 100 else ("En proceso" if prom_av > 0 else "Pendiente")

        acts_finales = list(acts_dict.values())
        raices = [a for a in acts_finales if "." not in a["codigo"]]
        pct_global = round_half_up(sum(a["avance"] for a in raices) / len(raices)) if raices else 0

        p_dict["total_actividades"] = len(acts_finales)
        p_dict["ejecutadas"] = sum(1 for a in acts_finales if a["estado"] == "Ejecutado")
        p_dict["en_proceso"] = sum(1 for a in acts_finales if a["estado"] == "En proceso")
        p_dict["pendientes"] = sum(1 for a in acts_finales if a["estado"] == "Pendiente")
        p_dict["avance_global"] = pct_global
        proyectos_resumen.append(p_dict)

    return proyectos_resumen

@app.post("/proyectos")
def crear_nuevo_proyecto(p: ProyectoCrearModel, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    db.execute("INSERT INTO proyectos (nombre, descripcion, unidad_organica, creador_id) VALUES (?, ?, ?, ?)",
               (p.nombre.strip(), p.descripcion.strip(), (p.unidad_organica or "").strip(), user["id"]))
    nuevo_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    db.execute("INSERT INTO proyecto_usuarios (proyecto_id, usuario_id, es_gestor) VALUES (?, ?, 1)", (nuevo_id, user["id"]))
    db.execute("""
        INSERT INTO historial (proyecto_id, timestamp, usuario, accion, detalle) 
        VALUES (?, ?, ?, 'Creación Proyecto', ?)
    """, (nuevo_id, ahora_peru_str(), user["username"], f"Proyecto creado: '{p.nombre.strip()}'"))
    db.commit()
    return {"mensaje": "Proyecto creado exitosamente", "proyecto_id": nuevo_id}

@app.put("/proyectos/{proyecto_id}/descripcion")
def actualizar_descripcion_proyecto(proyecto_id: int, data: ProyectoDescripcionUpdate, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
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

@app.put("/proyectos/{proyecto_id}/nombre")
def actualizar_nombre_proyecto(proyecto_id: int, data: ProyectoNombreUpdate, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    permiso = db.execute("""
        SELECT 1 FROM proyectos p
        LEFT JOIN proyecto_usuarios pu ON p.id = pu.proyecto_id AND pu.usuario_id = ?
        WHERE p.id = ? AND (p.creador_id = ? OR pu.es_gestor = 1)
    """, (user["id"], proyecto_id, user["id"])).fetchone()
    
    if not permiso and user.get("rol") != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="No tiene permisos de Gestor para renombrar este proyecto.")
    
    nombre_limpio = (data.nombre or "").strip()
    if not nombre_limpio:
        raise HTTPException(status_code=400, detail="El nombre del proyecto no puede estar vacío.")
        
    db.execute("UPDATE proyectos SET nombre = ? WHERE id = ?", (nombre_limpio, proyecto_id))
    db.execute("""
        INSERT INTO historial (proyecto_id, timestamp, usuario, accion, detalle) 
        VALUES (?, ?, ?, 'Renombrar Proyecto', ?)
    """, (proyecto_id, ahora_peru_str(), user["username"], f"Actualizó el nombre del proyecto a: '{nombre_limpio}'"))
    db.commit()
    return {"message": "Nombre del proyecto actualizado correctamente", "nombre": nombre_limpio}

# --- ACTIVIDADES Y GANTT POR PROYECTO ---
@app.get("/proyectos/{proyecto_id}/actividades")
def obtener_actividades_proyecto(proyecto_id: int, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute("SELECT * FROM actividades WHERE proyecto_id = ? ORDER BY codigo ASC", (proyecto_id,)).fetchall()
    return [dict(r) for r in rows]

@app.post("/actividades")
def guardar_actividad(act: ActividadModel, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    try:
        p_id = int(act.proyecto_id) if act.proyecto_id is not None else 1
        cod = str(act.codigo).strip().rstrip(".")
        desc = str(act.descripcion).strip()
        resp = str(act.responsable or "No asignado").strip()
        est = str(act.estado or "Pendiente").strip()
        av = int(act.avance if act.avance is not None else 0)
        f_ini = str(act.fecha_inicio or "").strip()
        f_fin = str(act.fecha_fin or "").strip()
        dias_val = int(act.dias if act.dias is not None else 1)
        pred = str(act.predecesores or "").strip()

        # Validación amplia de permisos de Gestor o Admin TI
        es_gestor = db.execute("""
            SELECT 1 FROM proyectos p 
            LEFT JOIN proyecto_usuarios pu ON p.id = pu.proyecto_id AND pu.usuario_id = ?
            WHERE p.id = ? AND (p.creador_id = ? OR pu.es_gestor = 1 OR pu.permiso = 'GESTOR')
        """, (user["id"], p_id, user["id"])).fetchone()

        es_admin_o_gestor = bool(es_gestor or user.get("rol") == "ADMIN_TI")

        existe = db.execute("""
            SELECT * FROM actividades 
            WHERE proyecto_id = ? AND (codigo = ? OR codigo = ?)
        """, (p_id, cod, f"{cod}.")).fetchone()

        if not es_admin_o_gestor:
            if not existe or user.get("nombre_completo", user["username"]) not in (existe["responsable"] or ""):
                raise HTTPException(status_code=403, detail="Permiso denegado: Solo puedes modificar tus actividades asignadas.")

        ahora_str = ahora_peru_str()

        if existe:
            cambios = []
            if existe["descripcion"] != desc:
                cambios.append(f"Descripción: '{desc}'")
            if (existe["responsable"] or "No asignado") != resp:
                cambios.append(f"Resp: '{resp}'")
            if existe["estado"] != est:
                cambios.append(f"Estado: '{est}'")
            if int(existe["avance"] or 0) != av:
                cambios.append(f"Avance: {av}%")
            if existe["fecha_inicio"] != f_ini or existe["fecha_fin"] != f_fin:
                cambios.append(f"Fechas: {f_ini} al {f_fin} ({dias_val}d)")

            detalle_cambio = f"Modificó [{cod}]: " + (", ".join(cambios) if cambios else "Actualización general")

            if es_admin_o_gestor:
                db.execute("""
                    UPDATE actividades 
                    SET descripcion = ?, responsable = ?, estado = ?, avance = ?, 
                        fecha_inicio = ?, fecha_fin = ?, dias = ?, predecesores = ?
                    WHERE proyecto_id = ? AND (codigo = ? OR codigo = ?)
                """, (desc, resp, est, av, f_ini, f_fin, dias_val, pred, p_id, cod, f"{cod}."))
            else:
                db.execute("""
                    UPDATE actividades 
                    SET estado = ?, avance = ?
                    WHERE proyecto_id = ? AND (codigo = ? OR codigo = ?)
                """, (est, av, p_id, cod, f"{cod}."))

            db.execute("""
                INSERT INTO historial (proyecto_id, timestamp, usuario, accion, detalle) 
                VALUES (?, ?, ?, 'Modificación Actividad', ?)
            """, (p_id, ahora_str, user["username"], detalle_cambio))
        else:
            if not es_admin_o_gestor:
                raise HTTPException(status_code=403, detail="Solo un Gestor del Proyecto puede crear nuevas actividades.")
            
            db.execute("""
                INSERT INTO actividades (proyecto_id, codigo, descripcion, responsable, estado, avance, fecha_inicio, fecha_fin, dias, predecesores)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (p_id, cod, desc, resp, est, av, f_ini, f_fin, dias_val, pred))

            db.execute("""
                INSERT INTO historial (proyecto_id, timestamp, usuario, accion, detalle) 
                VALUES (?, ?, ?, 'Creación Actividad', ?)
            """, (p_id, ahora_str, user["username"], f"Creó [{cod}]: '{desc}' | Inicio: {f_ini} | Días: {dias_val}"))

        db.commit()
        return {"mensaje": "Actividad guardada correctamente"}
    except HTTPException as he:
        raise he
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error en base de datos: {str(e)}")

# --- FUNCIÓN AUXILIAR DE REESTRUCTURACIÓN JERÁRQUICA WBS ---
def reestructurar_codigos_wbs(proyecto_id: int, db: sqlite3.Connection):
    # Obtener todas las actividades restantes del proyecto
    rows = db.execute("""
        SELECT codigo, descripcion, responsable, estado, avance, fecha_inicio, fecha_fin, dias, predecesores 
        FROM actividades 
        WHERE proyecto_id = ?
    """, (proyecto_id,)).fetchall()

    if not rows:
        return

    # Convertir a lista y ordenar de forma natural por jerarquía numérica (1, 1.1, 1.2, 2, 2.1...)
    def clave_orden_wbs(row):
        cod_limpio = str(row["codigo"]).rstrip(".")
        partes = []
        for p in cod_limpio.split("."):
            try:
                partes.append(int(p))
            except ValueError:
                partes.append(p)
        return partes

    actividades_ordenadas = sorted(rows, key=clave_orden_wbs)

    # Construir mapa de reasignación correlativa
    mapeo_nuevos_codigos = {}
    conteo_por_padre = {}

    for act in actividades_ordenadas:
        cod_antiguo = str(act["codigo"]).rstrip(".")
        partes = cod_antiguo.split(".")
        
        if len(partes) == 1:
            padre = ""
        else:
            padre = ".".join(partes[:-1])
        
        # Obtener el nuevo prefijo del padre si ya fue reasignado
        nuevo_padre = mapeo_nuevos_codigos.get(padre, padre) if padre else ""
        
        # Correlativo continuo para este grupo de hermanos
        conteo_por_padre[padre] = conteo_por_padre.get(padre, 0) + 1
        indice_hermano = conteo_por_padre[padre]

        if nuevo_padre:
            nuevo_cod = f"{nuevo_padre}.{indice_hermano}"
        else:
            nuevo_cod = f"{indice_hermano}"

        mapeo_nuevos_codigos[cod_antiguo] = nuevo_cod

    # Reemplazar los registros con los nuevos códigos y mapear predecesores
    actividades_renumeradas = []
    for act in actividades_ordenadas:
        cod_ant = str(act["codigo"]).rstrip(".")
        nuevo_cod = mapeo_nuevos_codigos[cod_ant]

        # Actualizar predecesores si apuntaban a códigos que cambiaron
        preds_antiguos = [p.strip().rstrip(".") for p in (act["predecesores"] or "").split(",") if p.strip()]
        preds_nuevos = [mapeo_nuevos_codigos[p] for p in preds_antiguos if p in mapeo_nuevos_codigos]
        predecesores_str = ", ".join(preds_nuevos)

        actividades_renumeradas.append((
            proyecto_id,
            nuevo_cod,
            act["descripcion"],
            act["responsable"],
            act["estado"],
            act["avance"],
            act["fecha_inicio"],
            act["fecha_fin"],
            act["dias"],
            predecesores_str
        ))

    # Sobrescribir la tabla de actividades del proyecto de forma atómica
    db.execute("DELETE FROM actividades WHERE proyecto_id = ?", (proyecto_id,))
    db.executemany("""
        INSERT INTO actividades (proyecto_id, codigo, descripcion, responsable, estado, avance, fecha_inicio, fecha_fin, dias, predecesores)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, actividades_renumeradas)


@app.delete("/proyectos/{proyecto_id}/actividades/{codigo}")
def eliminar_actividad(
    proyecto_id: int, 
    codigo: str, 
    user: dict = Depends(get_current_user), 
    db: sqlite3.Connection = Depends(get_db)
):
    es_gestor = db.execute("""
        SELECT 1 FROM proyectos p 
        LEFT JOIN proyecto_usuarios pu ON p.id = pu.proyecto_id AND pu.usuario_id = ?
        WHERE p.id = ? AND (p.creador_id = ? OR pu.es_gestor = 1)
    """, (user["id"], proyecto_id, user["id"])).fetchone()

    if not es_gestor and user.get("rol") != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="Solo un Gestor del Proyecto puede eliminar actividades.")

    cod_limpio = codigo.rstrip(".")
    
    # 1. Eliminar la actividad y sus subordinadas
    db.execute("""
        DELETE FROM actividades 
        WHERE proyecto_id = ? AND (codigo = ? OR codigo = ? OR codigo LIKE ?)
    """, (proyecto_id, cod_limpio, f"{cod_limpio}.", f"{cod_limpio}.%"))
    
    # 2. Reestructurar y renumerar correlativamente todos los niveles
    reestructurar_codigos_wbs(proyecto_id, db)

    db.execute("""
        INSERT INTO historial (proyecto_id, timestamp, usuario, accion, detalle) 
        VALUES (?, ?, ?, 'Eliminación Actividad', ?)
    """, (proyecto_id, ahora_peru_str(), user["username"], f"Eliminó [{codigo}] y reestructuró correlativamente el WBS"))
    
    db.commit()
    return {"mensaje": "Actividad eliminada y jerarquía reestructurada correlativamente"}

@app.put("/proyectos/{proyecto_id}/reordenar-actividades")
def reordenar_actividades_proyecto(
    proyecto_id: int,
    data: ReordenarActividadesModel,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db)
):
    es_gestor = db.execute("""
        SELECT 1 FROM proyectos p 
        LEFT JOIN proyecto_usuarios pu ON p.id = pu.proyecto_id AND pu.usuario_id = ?
        WHERE p.id = ? AND (p.creador_id = ? OR pu.es_gestor = 1 OR pu.permiso = 'GESTOR')
    """, (user["id"], proyecto_id, user["id"])).fetchone()

    if not es_gestor and user.get("rol") != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="Solo un Gestor del Proyecto puede reorganizar actividades.")

    rows = db.execute("SELECT * FROM actividades WHERE proyecto_id = ?", (proyecto_id,)).fetchall()
    if not rows:
        return {"mensaje": "Sin actividades para reorganizar"}

    mapa_actual = {str(r["codigo"]).rstrip("."): dict(r) for r in rows}
    
    # Validar que todos los códigos enviados existan
    lista_reorganizada = []
    for cod in data.codigos_ordenados:
        cod_limpio = str(cod).rstrip(".")
        if cod_limpio in mapa_actual:
            lista_reorganizada.append(mapa_actual[cod_limpio])

    if len(lista_reorganizada) != len(rows):
        raise HTTPException(status_code=400, detail="La lista enviada no coincide con el total de actividades.")

    # Reestructuración WBS preservando el nuevo orden secuencial
    db.execute("DELETE FROM actividades WHERE proyecto_id = ?", (proyecto_id,))
    
    # Insertar temporalmente con un índice plano
    for idx, act in enumerate(lista_reorganizada, start=1):
        db.execute("""
            INSERT INTO actividades (proyecto_id, codigo, descripcion, responsable, estado, avance, fecha_inicio, fecha_fin, dias, predecesores)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (proyecto_id, str(act["codigo"]), act["descripcion"], act["responsable"], act["estado"], act["avance"], act["fecha_inicio"], act["fecha_fin"], act["dias"], act["predecesores"]))

    # Renumerar de forma consistente
    reestructurar_codigos_wbs(proyecto_id, db)

    db.execute("""
        INSERT INTO historial (proyecto_id, timestamp, usuario, accion, detalle) 
        VALUES (?, ?, ?, 'Reorganización WBS', ?)
    """, (proyecto_id, ahora_peru_str(), user["username"], "Reorganizó el orden de actividades en el cronograma"))

    db.commit()
    return {"mensaje": "Actividades reubicadas y WBS recalculado con éxito"}

@app.put("/actividades/responsable")
def actualizar_responsable_actividad(
    data: AsignacionResponsableModel,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db)
):
    p_id = int(data.proyecto_id)
    cod_limpio = str(data.codigo).strip().rstrip(".")
    resp_limpio = str(data.responsable or "No asignado").strip()
    
    # 1. Actualizar en la base de datos de forma directa (con y sin punto)
    db.execute("""
        UPDATE actividades 
        SET responsable = ?
        WHERE proyecto_id = ? AND (codigo = ? OR codigo = ?)
    """, (resp_limpio, p_id, cod_limpio, f"{cod_limpio}."))
    
    # 2. Registrar en auditoría
    db.execute("""
        INSERT INTO historial (proyecto_id, timestamp, usuario, accion, detalle)
        VALUES (?, ?, ?, 'Asignación Responsable', ?)
    """, (p_id, ahora_peru_str(), user["username"], f"Asignó responsable(s) a [{cod_limpio}]: {resp_limpio}"))
    
    db.commit()
    return {"mensaje": "Responsable actualizado correctamente", "responsable": resp_limpio}

# --- RESPONSABLES ---
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

# --- HISTORIAL ROBUSTO PARA GESTORES ---
@app.get("/proyectos/{proyecto_id}/historial")
def ver_historial(
    proyecto_id: int, 
    user: dict = Depends(get_current_user), 
    db: sqlite3.Connection = Depends(get_db)
):
    p_id = int(proyecto_id)
    try:
        rows = db.execute("""
            SELECT COALESCE(timestamp, datetime('now')) as timestamp, 
                   COALESCE(usuario, 'admin') as usuario,
                   COALESCE(accion, 'Registro') as accion, 
                   COALESCE(detalle, 'Operación sin detalle') as detalle 
            FROM historial 
            WHERE proyecto_id = ?
            ORDER BY ROWID DESC LIMIT 100
        """, (p_id,)).fetchall()
        
        return [dict(r) for r in rows]
    except Exception as e:
        print(f"Error consultando historial: {e}")
        return []

# --- MÓDULO PERSONAL: ROLES Y PERMISOS POR PROYECTO ---
@app.get("/proyectos/{proyecto_id}/personal_permisos")
def listar_personal_proyecto(
    proyecto_id: int, 
    user: dict = Depends(get_current_user), 
    db: sqlite3.Connection = Depends(get_db)
):
    p_id = int(proyecto_id)
    
    # 1. Miembros asignados al proyecto
    miembros = db.execute("""
        SELECT u.id, u.username, u.nombre_completo, u.rol,
               pu.es_gestor,
               COALESCE(pu.permiso, CASE WHEN pu.es_gestor = 1 OR p.creador_id = u.id THEN 'GESTOR' ELSE 'VISUALIZADOR' END) as nivel_permiso
        FROM proyecto_usuarios pu
        JOIN usuarios u ON pu.usuario_id = u.id
        JOIN proyectos p ON p.id = pu.proyecto_id
        WHERE pu.proyecto_id = ? AND u.estado = 'ACTIVO'
        ORDER BY u.nombre_completo ASC
    """, (p_id,)).fetchall()

    # 2. Catálogo completo de usuarios activos (solo columnas necesarias)
    todos = db.execute("""
        SELECT id, username, nombre_completo, rol FROM usuarios WHERE estado = 'ACTIVO' ORDER BY nombre_completo ASC
    """).fetchall()

    # 3. Responsables de actividades en este proyecto
    acts = db.execute("SELECT DISTINCT responsable FROM actividades WHERE proyecto_id = ? AND responsable IS NOT NULL", (p_id,)).fetchall()
    responsables_en_acts = []
    for a in acts:
        for r in (a["responsable"] or "").split(";"):
            limpio = r.strip()
            if limpio and limpio != "No asignado" and limpio not in responsables_en_acts:
                responsables_en_acts.append(limpio)

    return {
        "miembros": [dict(m) for m in miembros],
        "todos_usuarios": [dict(u) for u in todos],
        "responsables_en_actividades": responsables_en_acts
    }

@app.post("/proyectos/{proyecto_id}/personal_permisos")
def actualizar_permiso_personal(
    proyecto_id: int, 
    data: PermisoProyectoUpdate, 
    user: dict = Depends(get_current_user), 
    db: sqlite3.Connection = Depends(get_db)
):
    p_id = int(proyecto_id)
    u_id = int(user["id"])

    permiso_admin = db.execute("""
        SELECT 1 FROM proyectos p
        LEFT JOIN proyecto_usuarios pu ON p.id = pu.proyecto_id AND pu.usuario_id = ?
        WHERE p.id = ? AND (p.creador_id = ? OR pu.es_gestor = 1 OR pu.permiso = 'GESTOR')
    """, (u_id, p_id, u_id)).fetchone()

    if not permiso_admin and user.get("rol") != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="Solo un Gestor del Proyecto puede asignar permisos.")

    es_gestor_val = 1 if data.nivel == 'GESTOR' else 0

    if data.nivel == 'NINGUNO':
        db.execute("DELETE FROM proyecto_usuarios WHERE proyecto_id = ? AND usuario_id = ?", (p_id, data.usuario_id))
    else:
        db.execute("""
            INSERT INTO proyecto_usuarios (proyecto_id, usuario_id, es_gestor, permiso)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(proyecto_id, usuario_id) DO UPDATE SET es_gestor = excluded.es_gestor, permiso = excluded.permiso
        """, (p_id, data.usuario_id, es_gestor_val, data.nivel))

    u_target = db.execute("SELECT username, nombre_completo FROM usuarios WHERE id = ?", (data.usuario_id,)).fetchone()
    target_info = u_target["nombre_completo"] if u_target and u_target["nombre_completo"] else f"@{u_target['username']}"
    
    db.execute("""
        INSERT INTO historial (proyecto_id, timestamp, usuario, accion, detalle)
        VALUES (?, ?, ?, 'Permisos Proyecto', ?)
    """, (p_id, ahora_peru_str(), user["username"], f"Asignó rol '{data.nivel}' a: {target_info}"))

    db.commit()
    return {"mensaje": "Permiso actualizado exitosamente"}

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

    todos_codigos = [r["codigo"] for r in rows]
    actividades_dict = {}
    
    for r in rows:
        cod = r["codigo"]
        cod_limpio = cod.rstrip(".")
        es_madre = any(otro.startswith(f"{cod_limpio}.") and otro != cod for otro in todos_codigos)
        
        actividades_dict[cod] = {
            "codigo": cod,
            "descripcion": r["descripcion"],
            "duracion": max(1, int(r["dias"] or 1)),
            "predecesores": [p.strip() for p in (r["predecesores"] or "").split(",") if p.strip() and p.strip() in todos_codigos],
            "es_madre": es_madre,
            "ES": 0, "EF": 0, "LS": 0, "LF": 0, "holgura": 0, "es_critica": False
        }

    nodos = {k: v for k, v in actividades_dict.items() if not v["es_madre"]}
    if not nodos:
        nodos = actividades_dict

    # 1. Forward Pass
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

    # 2. Backward Pass
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

    # 3. Holgura y Ruta Crítica
    for n in nodos.values():
        n["holgura"] = max(0, n["LS"] - n["ES"])
        n["es_critica"] = (n["holgura"] == 0 and n["duracion"] > 0)

    return {"duracion_proyecto_dias": duracion_total, "detalles": nodos}

# --- NOTIFICACIONES ---
@app.post("/notificaciones/asignacion")
def programar_notificacion_asignacion(
    data: NotificacionRequest, 
    user: dict = Depends(get_current_user), 
    db: sqlite3.Connection = Depends(get_db)
):
    try:
        proy = db.execute("SELECT nombre FROM proyectos WHERE id = ?", (int(data.proyecto_id),)).fetchone()
        cod_limpio = str(data.codigo_actividad).strip().rstrip(".")
        act = db.execute("""
            SELECT * FROM actividades 
            WHERE (proyecto_id = ? OR proyecto_id = ?) 
              AND (codigo = ? OR codigo = ?)
        """, (int(data.proyecto_id), str(data.proyecto_id), cod_limpio, f"{cod_limpio}.")).fetchone()

        resp_str = act["responsable"] if act and act["responsable"] else ""

        if data.destinatarios_nuevos and len(data.destinatarios_nuevos) > 0:
            nombres_a_notificar = [str(n).strip() for n in data.destinatarios_nuevos if str(n).strip()]
        else:
            nombres_a_notificar = [r.strip() for r in resp_str.split(";") if r.strip() and r.strip() != "No asignado"]

        registros_creados = 0
        fecha_hoy = datetime.now().strftime("%Y-%m-%d")
        fecha_hora_ahora = ahora_peru_str()

        for nombre in nombres_a_notificar:
            r_info = db.execute("SELECT correo FROM responsables WHERE nombre = ?", (nombre,)).fetchone()
            correo = r_info["correo"] if r_info and r_info["correo"] else f"{nombre.lower().replace(' ', '.')}@imarpe.gob.pe"

            db.execute("""
                INSERT INTO alertas_notificaciones 
                (proyecto_id, codigo_actividad, destinatario_nombre, destinatario_correo, tipo_alerta, dias_antes, fecha_programada, estado, fecha_envio)
                VALUES (?, ?, ?, ?, 'ASIGNACION_INICIAL', 0, ?, 'ENVIADO', ?)
            """, (int(data.proyecto_id), cod_limpio, nombre, correo, fecha_hoy, fecha_hora_ahora))

            for d in (data.dias_recordatorio or []):
                db.execute("""
                    INSERT INTO alertas_notificaciones 
                    (proyecto_id, codigo_actividad, destinatario_nombre, destinatario_correo, tipo_alerta, dias_antes, fecha_programada, estado)
                    VALUES (?, ?, ?, ?, 'RECORDATORIO_PREVENTIVO', ?, ?, 'PROGRAMADO')
                """, (int(data.proyecto_id), cod_limpio, nombre, correo, int(d), fecha_hoy))

            registros_creados += 1

        db.execute("""
            INSERT INTO historial (proyecto_id, timestamp, usuario, accion, detalle)
            VALUES (?, ?, ?, 'Notificación Correo', ?)
        """, (int(data.proyecto_id), fecha_hora_ahora, user["username"], f"Notificación enviada a: [{', '.join(nombres_a_notificar)}] para actividad [{cod_limpio}]"))

        db.commit()
        return {
            "status": "success",
            "mensaje": f"Notificaciones procesadas para {registros_creados} responsable(s).",
            "destinatarios": nombres_a_notificar
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error en servidor: {str(e)}")

# --- GESTIÓN DE COMENTARIOS COLABORATIVOS (TIPO WORD 365) ---
@app.get("/proyectos/{proyecto_id}/comentarios")
def listar_comentarios_proyecto(proyecto_id: int, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute("""
        SELECT id, proyecto_id, codigo_actividad, usuario_id, autor_nombre, autor_unidad, texto, 
               strftime('%d/%m/%Y %H:%M', datetime(fecha_creacion, 'localtime')) as fecha_fmt,
               strftime('%d/%m/%Y %H:%M', datetime(fecha_edicion, 'localtime')) as edit_fmt
        FROM comentarios_actividad
        WHERE proyecto_id = ?
        ORDER BY fecha_creacion ASC
    """, (int(proyecto_id),)).fetchall()
    
    return [
        {
            "id": r["id"],
            "proyecto_id": r["proyecto_id"],
            "codigo_actividad": r["codigo_actividad"],
            "usuario_id": r["usuario_id"],
            "autor_nombre": r["autor_nombre"],
            "autor_unidad": r["autor_unidad"],
            "texto": r["texto"],
            "fecha_creacion": r["fecha_fmt"],
            "fecha_edicion": r["edit_fmt"]
        }
        for r in rows
    ]

@app.post("/comentarios")
def crear_comentario(data: ComentarioCreate, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    texto_limpio = data.texto.strip()
    if not texto_limpio:
        raise HTTPException(status_code=400, detail="El comentario no puede estar vacío.")
    if len(texto_limpio) > 500:
        raise HTTPException(status_code=400, detail="El comentario excede el límite permitido (500 caracteres).")

    autor_nombre = user.get("nombre_completo") or user["username"]

    t_row = db.execute("SELECT unidad_organica FROM trabajadores WHERE nombre_completo LIKE ? LIMIT 1", (f"%{autor_nombre}%",)).fetchone()
    autor_unidad = t_row["unidad_organica"] if t_row and t_row["unidad_organica"] else (user.get("rol") if user.get("rol") == "ADMIN_TI" else "")
    cod_limpio = str(data.codigo_actividad).strip().rstrip(".")

    db.execute("""
        INSERT INTO comentarios_actividad (proyecto_id, codigo_actividad, usuario_id, autor_nombre, autor_unidad, texto)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (int(data.proyecto_id), cod_limpio, user["id"], autor_nombre, autor_unidad, texto_limpio))

    # Registro en historial de auditoría
    db.execute("""
        INSERT INTO historial (proyecto_id, timestamp, usuario, accion, detalle)
        VALUES (?, ?, ?, 'Nuevo Comentario', ?)
    """, (int(data.proyecto_id), ahora_peru_str(), user["username"], f"Comentó en la actividad [{cod_limpio}]"))

    db.commit()
    return {"status": "success", "message": "Comentario registrado con éxito."}

@app.put("/comentarios/{comentario_id}")
def editar_comentario(comentario_id: int, data: ComentarioUpdate, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    texto_limpio = data.texto.strip()
    if not texto_limpio:
        raise HTTPException(status_code=400, detail="El comentario no puede estar vacío.")
    if len(texto_limpio) > 500:
        raise HTTPException(status_code=400, detail="El comentario excede el límite permitido (500 caracteres).")

    row = db.execute("SELECT usuario_id, proyecto_id, codigo_actividad FROM comentarios_actividad WHERE id = ?", (int(comentario_id),)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Comentario no encontrado.")

    # Solo el autor o el Administrador TI puede editar el contenido
    if row["usuario_id"] != user["id"] and user.get("rol") != "ADMIN_TI":
        raise HTTPException(status_code=403, detail="No tiene permisos para editar este comentario.")

    db.execute("""
        UPDATE comentarios_actividad
        SET texto = ?, fecha_edicion = CURRENT_TIMESTAMP
        WHERE id = ?
    """, (texto_limpio, int(comentario_id)))
    db.commit()

    return {"status": "success", "message": "Comentario editado con éxito."}

@app.delete("/comentarios/{comentario_id}")
def eliminar_comentario(comentario_id: int, user: dict = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    row = db.execute("SELECT usuario_id, proyecto_id, codigo_actividad FROM comentarios_actividad WHERE id = ?", (int(comentario_id),)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Comentario no encontrado.")

    es_autor = (row["usuario_id"] == user["id"])
    es_admin = (user.get("rol") == "ADMIN_TI")
    
    # Verificar si es Gestor del proyecto
    es_gestor = db.execute("""
        SELECT 1 FROM proyectos p
        LEFT JOIN proyecto_usuarios pu ON p.id = pu.proyecto_id AND pu.usuario_id = ?
        WHERE p.id = ? AND (p.creador_id = ? OR pu.es_gestor = 1 OR pu.permiso = 'GESTOR')
    """, (user["id"], row["proyecto_id"], user["id"])).fetchone()

    if not (es_autor or es_admin or es_gestor):
        raise HTTPException(status_code=403, detail="No tiene permisos para eliminar este comentario.")

    db.execute("DELETE FROM comentarios_actividad WHERE id = ?", (int(comentario_id),))
    db.commit()

    return {"status": "success", "message": "Comentario eliminado."}

# Servir frontend estático
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/", StaticFiles(directory="templates", html=True), name="templates")