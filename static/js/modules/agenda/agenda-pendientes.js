// =========================================================================
// MÓDULO DE AGENDA Y PENDIENTES PRIVADOS
// =========================================================================
import { notificarToast } from "../../core/ui-dialogs.js";

// Lista temporal en memoria para frontend
let misPendientesLocales = [];

/**
 * Abre el modal para registrar un nuevo pendiente
 */
export function abrirModalCrearPendiente() {
  const inpTitulo = document.getElementById("agenda-inp-titulo");
  const inpFechaLimite = document.getElementById("agenda-inp-limite");
  const inpDiasCustom = document.getElementById("agenda-inp-dias-custom");
  const contenedorOpciones = document.getElementById("agenda-contenedor-opciones-dias");

  if (inpTitulo) inpTitulo.value = "";
  if (inpDiasCustom) inpDiasCustom.value = "";
  if (contenedorOpciones) contenedorOpciones.innerHTML = "";

  // Fecha mínima por defecto: Hoy
  const hoyISO = new Date().toISOString().split("T")[0];
  if (inpFechaLimite) {
    inpFechaLimite.min = hoyISO;
    inpFechaLimite.value = hoyISO;
  }

  // Recalcular opciones inteligentes iniciales
  recalcularPastillasRecordatorio();

  document.getElementById("modal-agenda-pendiente")?.classList.remove("hidden");
  setTimeout(() => inpTitulo?.focus(), 100);
}

/**
 * Cierra el modal de pendientes
 */
export function cerrarModalCrearPendiente() {
  document.getElementById("modal-agenda-pendiente")?.classList.add("hidden");
}

/**
 * Calcula días de plazo entre hoy y la fecha límite, y genera
 * las pastillas inteligentes estrictamente menores a la duración total.
 */
export function recalcularPastillasRecordatorio() {
  const inpFechaLimite = document.getElementById("agenda-inp-limite");
  const contenedor = document.getElementById("agenda-contenedor-opciones-dias");
  const hintPlazo = document.getElementById("agenda-txt-plazo-info");
  if (!inpFechaLimite || !contenedor) return;

  contenedor.innerHTML = "";

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const fechaSel = new Date(inpFechaLimite.value + "T00:00:00");
  if (isNaN(fechaSel.getTime())) return;

  // Diferencia en días enteros
  const diffTiempo = fechaSel.getTime() - hoy.getTime();
  const duracionDias = Math.max(0, Math.round(diffTiempo / (1000 * 60 * 60 * 24)));

  if (hintPlazo) {
    hintPlazo.innerText = duracionDias === 0 
      ? "(Vence hoy - las alertas preventivas previas no aplican)" 
      : `(Plazo disponible: ${duracionDias} ${duracionDias === 1 ? 'día' : 'días'})`;
  }

  const opcionesBase = [1, 3, 5, 7];
  let opcionesDisponibles = 0;

  opcionesBase.forEach(diasAntes => {
    // Mecánica inteligente: Solo si es estrictamente menor al plazo total
    if (diasAntes < duracionDias) {
      opcionesDisponibles++;
      contenedor.innerHTML += `
        <label class="flex items-center space-x-2 p-2 rounded-lg bg-gray-50 border border-gray-200 hover:bg-teal-50 cursor-pointer font-bold text-xs text-gray-700 transition">
          <input type="checkbox" value="${diasAntes}" class="agenda-chk-recordatorio rounded text-teal-600 focus:ring-0 cursor-pointer">
          <span>${diasAntes} ${diasAntes === 1 ? 'día antes' : 'días antes'}</span>
        </label>
      `;
    }
  });

  if (opcionesDisponibles === 0 && duracionDias > 0) {
    contenedor.innerHTML = `<p class="col-span-2 text-gray-400 italic text-[11px] text-center p-2">El plazo es de ${duracionDias} día(s). Puedes indicar un recordatorio manual abajo si lo requieres.</p>`;
  } else if (duracionDias === 0) {
    contenedor.innerHTML = `<p class="col-span-2 text-gray-400 italic text-[11px] text-center p-2">Para tareas del mismo día, el aviso se registrará para hoy.</p>`;
  }
}

/**
 * Guarda el pendiente validando el valor manual y empaquetando alertas
 */
export function guardarPendienteDesdeModal() {
  const titulo = document.getElementById("agenda-inp-titulo")?.value.trim();
  const fechaLimite = document.getElementById("agenda-inp-limite")?.value;
  const customInp = document.getElementById("agenda-inp-dias-custom");
  const customVal = customInp ? parseInt(customInp.value) : NaN;

  if (!titulo) {
    alert("⚠️ Por favor describe el pendiente.");
    return;
  }
  if (!fechaLimite) {
    alert("⚠️ Selecciona una fecha límite.");
    return;
  }

  // Calcular duración para validar valor manual
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const fechaSel = new Date(fechaLimite + "T00:00:00");
  const duracionDias = Math.max(0, Math.round((fechaSel.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24)));

  const seleccionados = Array.from(document.querySelectorAll(".agenda-chk-recordatorio:checked")).map(cb => parseInt(cb.value));

  // Validación idéntica al módulo de proyectos
  if (!isNaN(customVal)) {
    if (duracionDias > 0 && (customVal >= duracionDias || customVal <= 0)) {
      alert(`⚠️ Plazo personalizado inválido:\nEl valor ingresado (${customVal} días) debe ser estrictamente menor a la duración total (${duracionDias} días).`);
      return;
    }
    if (!seleccionados.includes(customVal)) {
      seleccionados.push(customVal);
    }
  }

  const nuevoItem = {
    id: Date.now(),
    titulo: titulo,
    fecha_limite: fechaLimite,
    dias_recordatorio: seleccionados.sort((a, b) => b - a),
    estado: "Pendiente"
  };

  misPendientesLocales.unshift(nuevoItem);
  cerrarModalCrearPendiente();
  actualizarTarjetaHubPendientes();
  notificarToast("Pendiente privado registrado con éxito.", "success");
}

/**
 * Actualiza el contador y vista de la tarjeta fija en el Hub
 */
export function actualizarTarjetaHubPendientes() {
  const contItems = document.getElementById("hub-tarjeta-pendientes-lista");
  const badgeContador = document.getElementById("hub-tarjeta-pendientes-badge");
  if (!contItems) return;

  const activos = misPendientesLocales.filter(p => p.estado !== "Completado");
  if (badgeContador) {
    badgeContador.innerText = `${activos.length} activos`;
  }

  if (activos.length === 0) {
    contItems.innerHTML = `
      <div class="p-4 text-center text-gray-400 text-xs italic">
        🎉 Todo al día. No tienes pendientes privados activos.
      </div>
    `;
    return;
  }

  contItems.innerHTML = activos.slice(0, 4).map(p => `
    <div class="flex items-center justify-between p-2 rounded-lg bg-gray-50 border border-gray-100 hover:bg-teal-50/50 transition text-xs">
      <div class="flex items-center space-x-2 truncate">
        <span class="w-2 h-2 rounded-full bg-teal-500 flex-shrink-0"></span>
        <span class="font-semibold text-gray-700 truncate">${p.titulo}</span>
      </div>
      <span class="text-[10px] font-bold text-gray-400 ml-2 whitespace-nowrap">${p.fecha_limite}</span>
    </div>
  `).join("");
}

// Exponer a window para interacción directa desde HTML
window.abrirModalCrearPendiente = abrirModalCrearPendiente;
window.cerrarModalCrearPendiente = cerrarModalCrearPendiente;
window.recalcularPastillasRecordatorio = recalcularPastillasRecordatorio;
window.guardarPendienteDesdeModal = guardarPendienteDesdeModal;
window.actualizarTarjetaHubPendientes = actualizarTarjetaHubPendientes;