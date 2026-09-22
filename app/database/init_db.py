import os
import shutil
import sqlite3
from datetime import datetime, timedelta
from app.core.config import DB_PATH, LEGACY_DB_PATH, ahora_peru_str
from app.core.security import hash_password

def calcular_jueves_viernes_santo(year: int):
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mes = (h + l - 7 * m + 114) // 31
    dia = ((h + l - 7 * m + 114) % 31) + 1
    domingo = datetime(year, mes, dia).date()
    return domingo - timedelta(days=3), domingo - timedelta(days=2)

def init_db():
    # Asegurar copia desde el repositorio hacia /data si en /data no existe o está vacía
    origen_repo = "imarpe_sgp.db" if os.path.exists("imarpe_sgp.db") else ("imarpe_gantt.db" if os.path.exists("imarpe_gantt.db") else None)
    
    debe_copiar = False
    if not os.path.exists(DB_PATH):
        debe_copiar = True
    elif origen_repo and os.path.exists(origen_repo):
        # Si la base en /data pesa menos de 50 KB (está recién inicializada) y el repo tiene datos
        if os.path.getsize(DB_PATH) < 50000 and os.path.getsize(origen_repo) > os.path.getsize(DB_PATH):
            debe_copiar = True

    if debe_copiar and origen_repo:
        try:
            shutil.copy(origen_repo, DB_PATH)
        except Exception:
            pass
    elif not os.path.exists(DB_PATH) and os.path.exists(LEGACY_DB_PATH):
        try:
            shutil.copy(LEGACY_DB_PATH, DB_PATH)
        except Exception:
            pass

    conn = sqlite3.connect(DB_PATH, timeout=30.0, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout = 30000;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    c = conn.cursor()

    # 1. Tabla Usuarios y control de acceso
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

    # 2. Cuenta de Administrador TI institucional
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

    # 3. Tabla Proyectos y Programas
    c.execute("""
        CREATE TABLE IF NOT EXISTS proyectos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            descripcion TEXT,
            creador_id INTEGER,
            unidad_organica TEXT,
            proceso_codigo TEXT,
            proceso_nombre TEXT,
            es_proceso_personalizado INTEGER DEFAULT 0,
            duration_mode TEXT DEFAULT 'business_days',
            unidad_tiempo TEXT DEFAULT 'DIAS',
            horas_por_dia INTEGER DEFAULT 8,
            visibilidad TEXT DEFAULT 'PRIVADO',
            fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(creador_id) REFERENCES usuarios(id)
        )
    """)
    for col, defn in [
        ("descripcion", "TEXT"), ("creador_id", "INTEGER"), ("unidad_organica", "TEXT"),
        ("proceso_codigo", "TEXT"), ("proceso_nombre", "TEXT"), ("es_proceso_personalizado", "INTEGER DEFAULT 0"),
        ("duration_mode", "TEXT DEFAULT 'business_days'"), ("unidad_tiempo", "TEXT DEFAULT 'DIAS'"),
        ("horas_por_dia", "INTEGER DEFAULT 8"), ("visibilidad", "TEXT DEFAULT 'PRIVADO'")
    ]:
        try:
            c.execute(f"ALTER TABLE proyectos ADD COLUMN {col} {defn}")
        except sqlite3.OperationalError:
            pass

    # 4. Tabla Permisos de Proyecto (Gestores y Visualizadores)
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

    # 5. Tabla Actividades WBS y Cronograma
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

    # 6. Tabla Historial de Auditoría
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

    # 7. Tabla Responsables y Alertas por Correo
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

    # 8. Unidades Orgánicas ROF
    c.execute("""
        CREATE TABLE IF NOT EXISTS unidades_organicas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            sigla TEXT UNIQUE NOT NULL,
            tipo_organo TEXT NOT NULL,
            sigla_padre TEXT,
            titular_usuario_id INTEGER,
            titular_trabajador_id INTEGER,
            estado TEXT DEFAULT 'ACTIVO'
        )
    """)
    for col, defn in [("sigla_padre", "TEXT"), ("titular_usuario_id", "INTEGER"), ("titular_trabajador_id", "INTEGER")]:
        try:
            c.execute(f"ALTER TABLE unidades_organicas ADD COLUMN {col} {defn}")
        except sqlite3.OperationalError:
            pass

    # 9. Directorio de Trabajadores Institucionales
    c.execute("""
        CREATE TABLE IF NOT EXISTS trabajadores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombres TEXT NOT NULL,
            apellidos TEXT NOT NULL,
            nombre_completo TEXT NOT NULL,
            unidad_organica TEXT NOT NULL,
            correo TEXT UNIQUE NOT NULL,
            cargo TEXT DEFAULT 'Sin cargo / nivel',
            es_directivo INTEGER DEFAULT 0,
            estado TEXT DEFAULT 'ACTIVO'
        )
    """)
    for col, defn in [("cargo", "TEXT DEFAULT 'Sin cargo / nivel'"), ("es_directivo", "INTEGER DEFAULT 0")]:
        try:
            c.execute(f"ALTER TABLE trabajadores ADD COLUMN {col} {defn}")
        except sqlite3.OperationalError:
            pass

    # 10. Feriados Institucionales y Calendario Laboral
    c.execute("""
        CREATE TABLE IF NOT EXISTS feriados_institucionales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha TEXT UNIQUE NOT NULL,
            descripcion TEXT,
            tipo TEXT DEFAULT 'Calendario',
            creado_por TEXT DEFAULT 'ADMIN_TI',
            fecha_registro TEXT
        )
    """)

    # 11. Catálogo Oficial de Procesos
    c.execute("""
        CREATE TABLE IF NOT EXISTS procesos_institucionales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo TEXT UNIQUE NOT NULL,
            nombre TEXT NOT NULL,
            nivel INTEGER NOT NULL,
            codigo_padre TEXT,
            estado TEXT DEFAULT 'ACTIVO',
            creado_por TEXT DEFAULT 'SISTEMA'
        )
    """)

    # 12. Comentarios Colaborativos
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

    # 13. Plantillas Maestras de Proyecto
    c.execute("""
        CREATE TABLE IF NOT EXISTS plantillas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            descripcion TEXT,
            categoria TEXT DEFAULT 'General',
            creador_id INTEGER,
            fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(creador_id) REFERENCES usuarios(id)
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS plantillas_actividades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plantilla_id INTEGER NOT NULL,
            codigo TEXT NOT NULL,
            descripcion TEXT NOT NULL,
            dias INTEGER DEFAULT 1,
            predecesores TEXT DEFAULT '',
            FOREIGN KEY(plantilla_id) REFERENCES plantillas(id) ON DELETE CASCADE
        )
    """)

    # Índices de aceleración de consultas
    for idx_sql in [
        "CREATE INDEX IF NOT EXISTS idx_historial_proy ON historial(proyecto_id, timestamp DESC)",
        "CREATE INDEX IF NOT EXISTS idx_actividades_proy ON actividades(proyecto_id, codigo)",
        "CREATE INDEX IF NOT EXISTS idx_proy_usuarios ON proyecto_usuarios(proyecto_id, usuario_id)",
        "CREATE INDEX IF NOT EXISTS idx_usuarios_estado ON usuarios(estado)",
        "CREATE INDEX IF NOT EXISTS idx_trabajadores_busq ON trabajadores(nombre_completo, unidad_organica)",
        "CREATE INDEX IF NOT EXISTS idx_unidades_sigla ON unidades_organicas(sigla)",
        "CREATE INDEX IF NOT EXISTS idx_feriados_fecha ON feriados_institucionales(fecha)",
        "CREATE INDEX IF NOT EXISTS idx_procesos_cod ON procesos_institucionales(codigo)",
        "CREATE INDEX IF NOT EXISTS idx_comentarios_proy_act ON comentarios_actividad(proyecto_id, codigo_actividad)"
    ]:
        try:
            c.execute(idx_sql)
        except sqlite3.OperationalError:
            pass

    # Normalización de roles a las categorías oficiales
    c.execute("""
        UPDATE usuarios 
        SET rol = 'OPERADOR' 
        WHERE rol NOT IN ('ADMIN_TI', 'OPERADOR')
    """)

    # Proyecto semilla si la base de datos es nueva
    c.execute("SELECT id FROM proyectos WHERE id = 1")
    if not c.fetchone():
        c.execute("INSERT INTO proyectos (id, nombre, creador_id) VALUES (1, 'GESTIÓN DE CONVENIOS', ?)", (admin_id,))
        c.execute("INSERT OR REPLACE INTO proyecto_usuarios (proyecto_id, usuario_id, es_gestor) VALUES (1, ?, 1)", (admin_id,))

    # Semilla de Unidades Orgánicas ROF
    unidades_semilla = [
        ("Consejo Directivo", "CD", "ÓRGANOS DE LA ALTA DIRECCIÓN", None),
        ("Presidencia Ejecutiva", "PE", "ÓRGANOS DE LA ALTA DIRECCIÓN", "CD"),
        ("Gerencia General", "GG", "ÓRGANOS DE LA ALTA DIRECCIÓN", "PE"),
        ("Gerencia Científica", "GC", "ÓRGANOS DE LA ALTA DIRECCIÓN", "PE"),
        ("Órgano de Control Institucional", "OCI", "ÓRGANOS DE CONTROL", "PE"),
        ("Oficina de Asesoría Jurídica", "OAJ", "ÓRGANOS DE ASESORAMIENTO", "GG"),
        ("Oficina de Planeamiento, Presupuesto y Modernización", "OPPM", "ÓRGANOS DE ASESORAMIENTO", "GG"),
        ("Oficina de Administración", "OA", "ÓRGANOS DE APOYO", "GG"),
        ("Unidad de Abastecimiento y Control Patrimonial", "UACP", "ÓRGANOS DE APOYO", "OA"),
        ("Unidad de Gestión Financiera", "UGF", "ÓRGANOS DE APOYO", "OA"),
        ("Oficina de Recursos Humanos", "ORH", "ÓRGANOS DE APOYO", "GG"),
        ("Oficina de Tecnologías de la Información", "OTI", "ÓRGANOS DE APOYO", "GG"),
        ("Dirección de Investigaciones del Subsistema Pelágico", "DISP", "ÓRGANOS DE LINEA", "GC"),
        ("Subdirección de Investigaciones en Recursos Neríticos Pelágicos", "SIRNP", "ÓRGANOS DE LINEA", "DISP"),
        ("Subdirección de Investigaciones en Recursos Transzonales y Altamente Migratorios", "SIRTAM", "ÓRGANOS DE LINEA", "DISP"),
        ("Subdirección de Investigaciones en Dinámica Poblacional en Recursos Pelágicos", "SIDPRP", "ÓRGANOS DE LINEA", "DISP"),
        ("Dirección de Investigaciones del Subsistema Bentodemersal", "DISB", "ÓRGANOS DE LINEA", "GC"),
        ("Subdirección de Investigaciones en Peces Demersales y Costeros", "SIPDC", "ÓRGANOS DE LINEA", "DISB"),
        ("Subdirección de Investigaciones en Biodiversidad Acuática", "SIBA", "ÓRGANOS DE LINEA", "DISB"),
        ("Subdirección de Investigaciones en Invertebrados y Macroalgas Marinas", "SIIMM", "ÓRGANOS DE LINEA", "DISB"),
        ("Subdirección de Investigaciones en Pesca Artesanal", "SIPA", "ÓRGANOS DE LINEA", "DISB"),
        ("Dirección de Investigaciones en Ciencias Marinas", "DICM", "ÓRGANOS DE LINEA", "GC"),
        ("Subdirección de Investigaciones en Física y Modelado del Océano", "SIFMO", "ÓRGANOS DE LINEA", "DICM"),
        ("Subdirección de Investigaciones en Química y Geología", "SIQG", "ÓRGANOS DE LINEA", "DICM"),
        ("Subdirección de Investigaciones en Biología del Océano", "SIBO", "ÓRGANOS DE LINEA", "DICM"),
        ("Dirección de Investigaciones en Acuicultura", "DIA", "ÓRGANOS DE LINEA", "GC"),
        ("Subdirección de Investigaciones en Sistemas Acuícolas", "SISA", "ÓRGANOS DE LINEA", "DIA"),
        ("Subdirección de Investigaciones en Recursos de Aguas Continentales", "SIRAC", "ÓRGANOS DE LINEA", "DIA"),
        ("Subdirección de Investigaciones en Calidad Acuática de Ambientes Litorales", "SICAAL", "ÓRGANOS DE LINEA", "DIA"),
        ("Dirección de Investigaciones en Pesca y Desarrollo Tecnológico", "DIPDT", "ÓRGANOS DE LINEA", "GC"),
        ("Subdirección de Investigaciones en Tecnología Hidroacústica", "SITH", "ÓRGANOS DE LINEA", "DIPDT"),
        ("Subdirección de Investigaciones en Sensoramiento Remoto", "SISR", "ÓRGANOS DE LINEA", "DIPDT"),
        ("Subdirección de Investigaciones en Sistemas y Métodos de Pesca", "SISMP", "ÓRGANOS DE LINEA", "DIPDT"),
        ("Subdirección de Ediciones y Difusión del Conocimiento Científico y Tecnológico", "SEDCCT", "ÓRGANOS DE LINEA", "DIPDT"),
        ("Sede Desconcentrada Tumbes", "SD Tumbes", "ÓRGANOS DESCONCENTRADOS", "GC"),
        ("Sede Desconcentrada Paita", "SD Paita", "ÓRGANOS DESCONCENTRADOS", "GC"),
        ("Sede Desconcentrada Santa Rosa", "SD Santa Rosa", "ÓRGANOS DESCONCENTRADOS", "GC"),
        ("Sede Desconcentrada Huanchaco", "SD Huanchaco", "ÓRGANOS DESCONCENTRADOS", "GC"),
        ("Sede Desconcentrada Chimbote", "SD Chimbote", "ÓRGANOS DESCONCENTRADOS", "GC"),
        ("Sede Desconcentrada Huacho", "SD Huacho", "ÓRGANOS DESCONCENTRADOS", "GC"),
        ("Sede Desconcentrada Pisco", "SD Pisco", "ÓRGANOS DESCONCENTRADOS", "GC"),
        ("Sede Desconcentrada Camaná", "SD Camaná", "ÓRGANOS DESCONCENTRADOS", "GC"),
        ("Sede Desconcentrada Ilo", "SD Ilo", "ÓRGANOS DESCONCENTRADOS", "GC"),
        ("Sede Desconcentrada Puno", "SD Puno", "ÓRGANOS DESCONCENTRADOS", "GC"),
        ("Centro de Plataformas Flotantes de Investigación Marina y Continental", "CPFIMC", "ÓRGANOS DESCONCENTRADOS", "GC")
    ]

    for nom, sig, tipo, padre in unidades_semilla:
        uo_existente = c.execute("SELECT id, sigla_padre FROM unidades_organicas WHERE sigla = ?", (sig,)).fetchone()
        if uo_existente:
            c.execute("""
                UPDATE unidades_organicas 
                SET nombre = ?, tipo_organo = ?, 
                    sigla_padre = COALESCE(sigla_padre, ?), 
                    estado = 'ACTIVO'
                WHERE id = ?
            """, (nom, tipo, padre, uo_existente[0]))
        else:
            c.execute("""
                INSERT INTO unidades_organicas (nombre, sigla, tipo_organo, sigla_padre, estado)
                VALUES (?, ?, ?, ?, 'ACTIVO')
            """, (nom, sig, tipo, padre))

    # Semilla de Feriados Institucionales Perú
    year_actual = 2026
    jueves_santo, viernes_santo = calcular_jueves_viernes_santo(year_actual)
    feriados_base = [
        (f"{year_actual}-01-01", "Calendario", "Año Nuevo"),
        (f"{year_actual}-01-02", "Sector público", "Día no laborable para el sector público"),
        (jueves_santo.isoformat(), "Calendario", "Jueves Santo"),
        (viernes_santo.isoformat(), "Calendario", "Viernes Santo"),
        (f"{year_actual}-05-01", "Calendario", "Día del Trabajo"),
        (f"{year_actual}-06-07", "Calendario", "Batalla de Arica y Día de la Bandera"),
        (f"{year_actual}-06-29", "Calendario", "Día de San Pedro y San Pablo"),
        (f"{year_actual}-07-23", "Calendario", "Día de la Fuerza Aérea del Perú"),
        (f"{year_actual}-07-27", "Sector público", "Día no laborable para el sector público"),
        (f"{year_actual}-07-28", "Calendario", "Fiestas Patrias"),
        (f"{year_actual}-07-29", "Calendario", "Fiestas Patrias"),
        (f"{year_actual}-08-06", "Calendario", "Batalla de Junín"),
        (f"{year_actual}-08-30", "Calendario", "Santa Rosa de Lima"),
        (f"{year_actual}-10-08", "Calendario", "Combate de Angamos"),
        (f"{year_actual}-11-01", "Calendario", "Día de Todos los Santos"),
        (f"{year_actual}-12-08", "Calendario", "Inmaculada Concepción"),
        (f"{year_actual}-12-09", "Calendario", "Batalla de Ayacucho"),
        (f"{year_actual}-12-25", "Calendario", "Navidad"),
        (f"{year_actual}-12-26", "Sector público", "Día no laborable para el sector público")
    ]

    for f_fecha, f_tipo, f_desc in feriados_base:
        existe_f = c.execute("SELECT id FROM feriados_institucionales WHERE fecha = ?", (f_fecha,)).fetchone()
        if not existe_f:
            c.execute("""
                INSERT INTO feriados_institucionales (fecha, descripcion, tipo, creado_por, fecha_registro)
                VALUES (?, ?, ?, 'SISTEMA', ?)
            """, (f_fecha, f_desc, f_tipo, ahora_peru_str()))

    # Semilla de Catálogo Oficial de Procesos IMARPE
    c.execute("SELECT COUNT(*) FROM procesos_institucionales")
    if c.fetchone()[0] == 0:
        procesos_semilla = [
            ("E1", "Dirección y gestión estratégica", 0, None),
            ("E1.1", "Gestión de la dirección", 1, "E1"),
            ("E1.1.1", "Direccionamiento estratégico, roles y liderazgo institucional", 2, "E1.1"),
            ("E1.1.2", "Formulación y aprobación de políticas institucionales y del SGI", 2, "E1.1"),
            ("E1.1.3", "Revisión del desempeño institucional y del SGI por la Alta Dirección", 2, "E1.1"),
            ("E1.2", "Planeamiento Estratégico Institucional", 1, "E1"),
            ("E1.2.1", "Formulación y actualización del Plan Estratégico Institucional (PEI)", 2, "E1.2"),
            ("E1.2.2", "Seguimiento y evaluación del Plan Estratégico Institucional", 2, "E1.2"),
            ("E1.3", "Planeamiento Operativo Institucional", 1, "E1"),
            ("E1.3.1", "Programación del Plan Operativo Institucional Multianual", 2, "E1.3"),
            ("E1.3.2", "Consistencia y articulación del POI Anual con el PIA", 2, "E1.3"),
            ("E1.3.3", "Seguimiento, control mensual y modificación del POI", 2, "E1.3"),
            ("E2", "Gestión de modernización y mejora institucional", 0, None),
            ("E2.1", "Modernización Institucional", 1, "E2"),
            ("E2.1.1", "Gestión del diseño organizacional", 2, "E2.1"),
            ("E2.1.2", "Gestión por procesos", 2, "E2.1"),
            ("E2.1.3", "Gestión del conocimiento", 2, "E2.1"),
            ("E2.1.4", "Gestión de calidad de servicios", 2, "E2.1"),
            ("E2.1.5", "Gestión de la innovación pública", 2, "E2.1"),
            ("E2.1.6", "Simplificación administrativa", 2, "E2.1"),
            ("E2.2", "Gestión del Sistema de Gestión Integrado (SGI)", 1, "E2"),
            ("E2.2.1", "Gestión del Sistema de Gestión de la Calidad (SGC)", 2, "E2.2"),
            ("E2.2.1.1", "Gestión de salidas no conformes", 3, "E2.2.1"),
            ("E2.2.1.2", "Satisfacción del usuario", 3, "E2.2.1"),
            ("E2.2.2", "Gestión del Sistema de Gestión Antisoborno (SGAS)", 2, "E2.2"),
            ("E2.2.2.1", "Gestión de denuncias y medidas de protección", 3, "E2.2.2"),
            ("E2.2.3", "Gestión del Sistema de la Seguridad de la Información (SGSI)", 2, "E2.2"),
            ("E2.2.4", "Gestión de procesos de soporte para las actividades del SGI", 2, "E2.2"),
            ("E2.2.5", "Determinación de alcance del Sistema de Gestión", 2, "E2.2"),
            ("E2.2.6", "Información documentada", 2, "E2.2"),
            ("E2.2.7", "Comprensión de la organización", 2, "E2.2"),
            ("E2.2.8", "Identificación de partes interesadas", 2, "E2.2"),
            ("E2.2.9", "Auditorias internas SGI", 2, "E2.2"),
            ("E2.2.10", "Gestión de mejora SGI", 2, "E2.2"),
            ("E2.2.11", "Comunicaciones del SGI", 2, "E2.2"),
            ("E2.2.12", "Planificación, medición y evaluación", 2, "E2.2"),
            ("E2.2.13", "Gestión de riesgos SGI", 2, "E2.2"),
            ("E3", "Control de la gestión institucional", 0, None),
            ("E4", "Gestión de comunicaciones, imagen institucional y Relaciones Interinstitucionales.", 0, None),
            ("E4.1", "Gestión de comunicaciones, imagen institucional y protocolo", 1, "E4"),
            ("E4.2", "Gestión de Relaciones Interinstitucionales", 1, "E4"),
            ("E4.3", "Gestión de Convenios", 1, "E4"),
            ("E5", "Gestión de gobierno digital", 0, None),
            ("M1", "Gestión de la investigación científica, tecnológica y de innovación", 0, None),
            ("M2", "Investigación de campo y experimentación científica", 0, None),
            ("M2.1", "Observación", 1, "M2"),
            ("M2.2", "Toma de muestra", 1, "M2"),
            ("M2.3", "Medición", 1, "M2"),
            ("M2.3.1", "Muestreo biométrico y biológico de la anchoveta", 2, "M2.3"),
            ("M2.4", "Recolección de datos", 1, "M2"),
            ("M2.5", "Experimentación", 1, "M2"),
            ("M3", "Gestión de datos e información técnico-científica", 0, None),
            ("M4", "Gestión de la producción y difusión de documentos técnicos- científicos", 0, None),
            ("M4.1", "Gestión de la producción de documentos técnicos el ordenamiento pesquero y acuícula", 1, "M4"),
            ("M4.1.1", "Elaboración de documentos técnicos - científicos", 2, "M4.1"),
            ("M4.1.1.1", "Estimación de la biomasa de la anchoveta", 3, "M4.1.1"),
            ("M4.1.2", "Evaluación de los informes técnicos sobre el ordenamiento pesquero y acuícola", 2, "M4.1"),
            ("M4.1.3", "Aprobación y difusión de documentos técnicos - científicos", 2, "M4.1"),
            ("M4.2", "Gestión de la producción y difusion de articulos cientificos", 1, "M4"),
            ("M4.3", "Gestión de la revisión y difusión de documentos para el boletín", 1, "M4"),
            ("S1", "Gestión del talento humano", 0, None),
            ("S2", "Gestión de la logística e infraestructura", 0, None),
            ("S2.1", "Programación multianual de bienes, servicios y obras", 1, "S2"),
            ("S2.1.1", "Gestión del Cuadro Multianual de Necesidades", 2, "S2.1"),
            ("S2.1.1.1", "Identificación y Valorización del Cuadro Multianual de Necesidades", 3, "S2.1.1"),
            ("S2.1.1.2", "Clasificación y priorización del Cuadro Multianual de Necesidades", 3, "S2.1.1"),
            ("S2.1.1.3", "Consolidación y aprobación del Cuadro Multianual de Necesidades", 3, "S2.1.1"),
            ("S2.1.1.4", "Modificaciones del Cuadro Multianual de Necesidades", 3, "S2.1.1"),
            ("S2.1.1.5", "Evaluación de la ejecución del Cuadro Multianual de Necesidades", 3, "S2.1.1"),
            ("S2.1.2", "Gestión del Plan Anual de Contrataciones", 2, "S2.1"),
            ("S2.2.1.1", "Formulación y aprobación del Plan Anual de Contrataciones", 3, "S2.1.2"),
            ("S2.2.1.2", "Modificaciones del Plan Anual de Contrataciones", 3, "S2.1.2"),
            ("S2.2.1.3", "Evaluación de la ejecución del Plan Anual de Contrataciones", 3, "S2.1.2"),
            ("S2.2", "Gestión de adquisiciones", 1, "S2"),
            ("S2.2.1", "Gestión de procedimientos de selección competitivos", 2, "S2.2"),
            ("S2.2.2", "Gestión de modalidades diferenciadas de contratación", 2, "S2.2"),
            ("S2.2.3", "Gestión de contrataciones públicas eficientes", 2, "S2.2"),
            ("S2.2.3.1", "Gestión de contratos menores", 3, "S2.2.3"),
            ("S2.2.3.2", "Contrataciones con Proveedores No Domiciliados", 3, "S2.2.3"),
            ("S2.2.4", "Gestión de procedimientos de selección no competitivos", 2, "S2.2"),
            ("S2.2.5", "Fiscalización posterior de las contrataciones realizadas por PROINVERSIÓN", 2, "S2.2"),
            ("S2.2.6", "Gestión de contratos", 2, "S2.2"),
            ("S2.2.7", "Pago a proveedores", 2, "S2.2"),
            ("S2.3", "Administración de bienes muebles e inmuebles", 1, "S2"),
            ("S2.3.1", "Almacenamiento de bienes muebles", 2, "S2.3"),
            ("S2.3.2", "Distribución de bienes muebles", 2, "S2.3"),
            ("S2.3.3", "Mantenimiento de bienes muebles", 2, "S2.3"),
            ("S2.3.4", "Inventario", 2, "S2.3"),
            ("S2.3.5", "Disposición final", 2, "S2.3"),
            ("S2.3.6", "Mantenimiento de bienes inmuebles", 2, "S2.3"),
            ("S2.3.7", "Gestión de seguros patrimoniales", 2, "S2.3"),
            ("S2.4", "Gestión de servicios generales", 1, "S2"),
            ("S2.4.1", "Atención del servicio de transporte", 2, "S2.4"),
            ("S2.4.2", "Atención de otros servicios generales", 2, "S2.4"),
            ("S3", "Gestión financiera, contable y presupuestal", 0, None),
            ("S3.1", "Gestión de tesorería y planeación financiera", 1, "S3"),
            ("S3.1.1", "Elaboración de estados financieros y presupuestales", 2, "S3.1"),
            ("S3.2", "Gestión contable y rendición de cuentas", 1, "S3"),
            ("S3.3", "Gestión presupuestaria", 1, "S3"),
            ("S3.4", "Gestión de inversiones", 1, "S3"),
            ("S4", "Gestión de asesoría legal", 0, None),
            ("S5", "Gestión documental y atención al ciudadano", 0, None),
            ("S6", "Gestión de plataformas y flota científica", 0, None)
        ]
        c.executemany("""
            INSERT INTO procesos_institucionales (codigo, nombre, nivel, codigo_padre, estado)
            VALUES (?, ?, ?, ?, 'ACTIVO')
        """, procesos_semilla)

    # Semilla de Plantillas Maestras
    c.execute("SELECT COUNT(*) FROM plantillas")
    if c.fetchone()[0] == 0:
        plantillas_semilla = [
            (
                "Gestión y Formalización de Convenios",
                "Estructura estándar para la negociación, revisión técnica-legal y suscripción de convenios interinstitucionales.",
                "Convenios y Cooperación",
                admin_id,
                [
                    ("1", "FASE 1: ACTOS PREPARATORIOS Y PROPUESTA", 10, ""),
                    ("1.1", "Recepción y revisión técnica de la propuesta", 4, ""),
                    ("1.2", "Evaluación de viabilidad y objetivos conjuntos", 3, "1.1"),
                    ("1.3", "Elaboración del informe técnico preliminar", 3, "1.2"),
                    ("2", "FASE 2: REVISIÓN Y OPINIÓN LEGAL", 12, "1"),
                    ("2.1", "Remisión de expediente a Asesoría Jurídica", 2, "1.3"),
                    ("2.2", "Subsanación de observaciones técnicas", 5, "2.1"),
                    ("2.3", "Emisión de Dictamen Legal favorable", 5, "2.2"),
                    ("3", "FASE 3: SUSCRIPCIÓN Y REGISTRO OFICIAL", 6, "2"),
                    ("3.1", "Firma y protocolización del convenio", 3, "2.3"),
                    ("3.2", "Publicación y distribución a órganos ejecutores", 3, "3.1")
                ]
            ),
            (
                "Estandarización y Optimización de Procesos",
                "Metodología ágil para el levantamiento, rediseño, validación y formalización de trámites internos.",
                "Modernización y Procesos",
                admin_id,
                [
                    ("1", "FASE 1: DIAGNÓSTICO Y LEVANTAMIENTO AS-IS", 15, ""),
                    ("1.1", "Planificación de entrevistas y talleres de trabajo", 3, ""),
                    ("1.2", "Ejecución de entrevistas a personal operativo y táctico", 7, "1.1"),
                    ("1.3", "Mapeo y diagramación del flujo actual (AS-IS)", 5, "1.2"),
                    ("2", "FASE 2: REDISEÑO Y PROPUESTA TO-BE", 14, "1"),
                    ("2.1", "Identificación de cuellos de botella y demoras", 4, "1.3"),
                    ("2.2", "Diseño de la propuesta optimizada (TO-BE)", 6, "2.1"),
                    ("2.3", "Taller de validación con líderes de proceso", 4, "2.2"),
                    ("3", "FASE 3: FORMALIZACIÓN Y MANUALES", 10, "2"),
                    ("3.1", "Redacción de la ficha técnica y manual de procedimiento", 6, "2.3"),
                    ("3.2", "Aprobación formal e implementación operativa", 4, "3.1")
                ]
            )
        ]

        for p_nom, p_desc, p_cat, p_creador, acts in plantillas_semilla:
            c.execute("INSERT INTO plantillas (nombre, descripcion, categoria, creador_id) VALUES (?, ?, ?, ?)",
                      (p_nom, p_desc, p_cat, p_creador))
            p_id = c.lastrowid
            for cod, desc, dias, pred in acts:
                c.execute("""
                    INSERT INTO plantillas_actividades (plantilla_id, codigo, descripcion, dias, predecesores)
                    VALUES (?, ?, ?, ?, ?)
                """, (p_id, cod, desc, dias, pred))

    conn.commit()
    conn.close()