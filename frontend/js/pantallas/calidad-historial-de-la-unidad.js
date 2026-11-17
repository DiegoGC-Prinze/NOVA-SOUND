// Pantalla: Calidad · Historial de la unidad. Usa el módulo compartido con «Trazabilidad» de Gerencia,
// pero en su versión de solo tabla: buscar la serie y ver Fecha, Hora, Área, Evento, Resultado y Usuario.
import { iniciarHistorial } from './historial-unidad.js';

iniciarHistorial('calidad/historial-de-la-unidad', { soloTabla: true });
