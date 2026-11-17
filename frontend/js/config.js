// Configuración única del front. Cambia aquí, no en cada pantalla.

// true  = las pantallas leen los JSON de la carpeta /mock (no necesitas el back).
// false = las pantallas llaman al back real en API_BASE_URL.
export const USE_MOCKS = true;

// El acceso conectado usa PostgreSQL en todas las áreas. El acceso demo sigue independiente.
export const ALMACEN_API = true;

// Docker sirve frontend y API en http://localhost:8000 (mismo origen).
// Para un servidor separado se puede indicar su URL completa aqui.
export const API_BASE_URL = '';
