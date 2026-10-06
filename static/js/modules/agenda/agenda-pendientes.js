// =========================================================================
// MÓDULO DE AGENDA Y PENDIENTES PRIVADOS (CONECTADO A FASTAPI)
// =========================================================================
import { notificarToast } from "../../core/ui-dialogs.js";

let misPendientesLocales = [];

// Helper para llamadas autenticadas a la API
async function apiPendientesFetch(url, options = {}) {
  const token = localStorage.getItem("token") || sessionStorage.getItem("token");
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return fetch(url, { ...options, headers });
}

/**
 * Carga los pendientes privados desde la base de datos
 */
export async function cargarMisPendientesServidor() {
  try {
    const res = await apiPendientesFetch("/pendientes");
    if (!res.ok) return;
    misPendientesLocales = await res.json();
    actualizarTarjetaHubPendientes();
  } catch (err) {
    console.error("Error al cargar pendientes privados:", err);
  }
}

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

  const hoyISO = new Date().toISOString().split("T")[0];
  if (inpFechaLimite) {
    inpFechaLimite.min = hoyISO;
    inpFechaLimite.value = hoyISO;
  }

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
 * Recalcula dinámicamente las pastillas de días antes según el plazo
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
 * Guarda el pendiente enviándolo al backend en FastAPI
 */
export async function guardarPendienteDesdeModal() {
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

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const fechaSel = new Date(fechaLimite + "T00:00:00");
  const duracionDias = Math.max(0, Math.round((fechaSel.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24)));

  const seleccionados = Array.from(document.querySelectorAll(".agenda-chk-recordatorio:checked")).map(cb => parseInt(cb.value));

  if (!isNaN(customVal)) {
    if (duracionDias > 0 && (customVal >= duracionDias || customVal <= 0)) {
      alert(`⚠️ Plazo personalizado inválido:\nEl valor ingresado (${customVal} días) debe ser estrictamente menor a la duración total (${duracionDias} días).`);
      return;
    }
    if (!seleccionados.includes(customVal)) {
      seleccionados.push(customVal);
    }
  }

  try {
    const payload = {
      titulo: titulo,
      fecha_limite: fechaLimite,
      dias_recordatorio: seleccionados.sort((a, b) => b - a)
    };

    const res = await apiPendientesFetch("/pendientes", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Error al registrar");
    }

    cerrarModalCrearPendiente();
    await cargarMisPendientesServidor();
    notificarToast("Pendiente privado registrado con éxito.", "success");
  } catch (error) {
    alert(`❌ No se pudo guardar el pendiente: ${error.message}`);
  }
}

/**
 * Alternar estado de un pendiente (marcar completado)
 */
export async function alternarEstadoPendiente(id, estadoActual) {
  const nuevoEstado = estadoActual === "Completado" ? "Pendiente" : "Completado";
  try {
    const res = await apiPendientesFetch(`/pendientes/${id}/estado`, {
      method: "PUT",
      body: JSON.stringify({ estado: nuevoEstado })
    });
    if (res.ok) {
      await cargarMisPendientesServidor();
    }
  } catch (e) {
    console.error("Error al actualizar estado:", e);
  }
}

/**
 * Eliminar un pendiente
 */
export async function eliminarPendientePrivado(id) {
  if (!confirm("¿Deseas eliminar este pendiente privado de tu agenda?")) return;
  try {
    const res = await apiPendientesFetch(`/pendientes/${id}`, { method: "DELETE" });
    if (res.ok) {
      await cargarMisPendientesServidor();
      notificarToast("Pendiente eliminado.", "info");
    }
  } catch (e) {
    console.error("Error al eliminar pendiente:", e);
  }
}

/**
 * Renderiza la tarjeta fija en el Hub
 */
export function actualizarTarjetaHubPendientes() {
  const contItems = document.getElementById("hub-tarjeta-pendientes-lista");
  const badgeContador = document.getElementById("hub-tarjeta-pendientes-badge");
  if (!contItems) return;

  const activos = misPendientesLocales.filter(p => p.estado !== "Completado");
  if (badgeContador) {
    badgeContador.innerText = `${activos.length} activos`;
  }

  if (misPendientesLocales.length === 0) {
    contItems.innerHTML = `
      <div class="p-4 text-center text-gray-400 text-xs italic">
        🎉 Todo al día. No tienes pendientes privados registrados.
      </div>
    `;
    return;
  }

  contItems.innerHTML = misPendientesLocales.slice(0, 5).map(p => {
    const esCompletado = p.estado === "Completado";
    return `
      <div class="flex items-center justify-between p-2 rounded-lg ${esCompletado ? 'bg-gray-100/70 opacity-60' : 'bg-gray-50 border border-gray-100 hover:bg-teal-50/50'} transition text-xs group">
        <div class="flex items-center space-x-2 truncate min-w-0">
          <input type="checkbox" ${esCompletado ? 'checked' : ''} onchange="alternarEstadoPendiente(${p.id}, '${p.estado}')" class="rounded text-teal-600 focus:ring-0 cursor-pointer">
          <span class="font-semibold text-gray-700 truncate ${esCompletado ? 'line-through text-gray-400' : ''}">${p.titulo}</span>
        </div>
        <div class="flex items-center space-x-1.5 ml-2 flex-shrink-0">
          <span class="text-[10px] font-bold text-gray-400 whitespace-nowrap">${p.fecha_limite}</span>
          <button onclick="eliminarPendientePrivado(${p.id})" class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 transition text-xs cursor-pointer" title="Eliminar pendiente">✕</button>
        </div>
      </div>
    `;
  }).join("");
}

// Carga inicial reactiva
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", cargarMisPendientesServidor);
} else {
  cargarMisPendientesServidor();
}

// Exposición pública al objeto window
window.abrirModalCrearPendiente = abrirModalCrearPendiente;
window.cerrarModalCrearPendiente = cerrarModalCrearPendiente;
window.recalcularPastillasRecordatorio = recalcularPastillasRecordatorio;
window.guardarPendienteDesdeModal = guardarPendienteDesdeModal;
window.actualizarTarjetaHubPendientes = actualizarTarjetaHubPendientes;
window.alternarEstadoPendiente = alternarEstadoPendiente;
window.eliminarPendientePrivado = eliminarPendientePrivado;
window.cargarMisPendientesServidor = cargarMisPendientesServidor;