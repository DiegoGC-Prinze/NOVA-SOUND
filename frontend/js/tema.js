// Carga la identidad visual (css/tema.css) en Tailwind.
// Se importa desde layout.js, así que ninguna pantalla tiene que acordarse de él.
// Usa "top-level await": las pantallas esperan a que el tema cargue y por eso no parpadean sin estilo.

import { leerArchivo } from './leer.js';

const estilo = document.createElement('style');
estilo.setAttribute('type', 'text/tailwindcss');
estilo.textContent = await leerArchivo(new URL('../css/tema.css', import.meta.url));
document.head.appendChild(estilo);
