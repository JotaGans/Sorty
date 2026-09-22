import os
from datetime import timedelta, timezone

# Zona horaria de Perú (UTC-5)
ZONA_PERU = timezone(timedelta(hours=-5))

# Claves de cifrado y expiración de sesión
SECRET_KEY = "IMARPE_SGAS_SUPER_SECRET_KEY_2026_SECURITY_TOKEN"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24

# Directorio de persistencia para Railway (/data) o local (.)
DATA_DIR = "/data" if os.path.exists("/data") else "."

# Nombre de la base de datos
DB_NAME = "imarpe_sgp.db"
DB_PATH = os.path.join(DATA_DIR, DB_NAME)

# Nombre de la base de datos previa (para migración transparente de datos)
LEGACY_DB_NAME = "imarpe_gantt.db"
LEGACY_DB_PATH = os.path.join(DATA_DIR, LEGACY_DB_NAME)

def ahora_peru_str() -> str:
    from datetime import datetime
    return datetime.now(ZONA_PERU).strftime("%Y-%m-%d %H:%M:%S")