from .database import engine, Base, SessionLocal

# Función para obtener la sesión de base de datos (dependencia para FastAPI u otros frameworks)
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()