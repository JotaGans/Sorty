import { state } from "../../core/state.js";
import { apiFetch } from "../../core/api.js";
import { notificarToast, confirmModal } from "../../core/ui-dialogs.js";
import { renderizarTabla, tieneHijos, guardarCambioDirecto } from "./project-wbs.js";

// --- GESTIÓN DEL MENÚ DESPLEGABLE CPM ---
export function toggleMenuCpm(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById("dropdown-menu-cpm");
  if (menu) menu.classList.toggle("hidden");
}

export function cerrarMenuCpm() {
  const menu = document.getElementById("dropdown-menu-cpm");
  if (menu) menu.classList.add("hidden");
}

// Cerrar el menú flotante si el usuario hace clic fuera de él
if (typeof window !== "undefined") {
  window.addEventListener("click", () => {
    cerrarMenuCpm();
  });
}

// --- MODAL DE DEPENDENCIAS (PREDECESORAS) ---
export async function abrirModalDependencias() {
  const modal = document.getElementById("modal-dependencias");
  const tbody = document.getElementById("tabla-config-dependencias-body");
  if (!tbody || !modal) return;
  tbody.innerHTML = "";

  const terminales = state.actividadesGlobal.filter(a => !tieneHijos(a.codigo));
  const lista = terminales.length > 0 ? terminales : state.actividadesGlobal;

  lista.forEach(act => {
    const codLimpio = String(act.codigo).replace(/\.+$/, "");
    const posiblesPreds = lista.filter(p => String(p.codigo).replace(/\.+$/, "") !== codLimpio);
    const predsActuales = (act.predecesores || "").split(",").map(s => s.trim().replace(/\.+$/, "")).filter(Boolean);

    let opcionesHTML = "";
    const deshabilitarChecks = !state.proyectoEsGestor ? 'disabled' : '';
    const cursorClase = !state.proyectoEsGestor ? 'cursor-not-allowed opacity-75' : 'cursor-pointer hover:bg-teal-50';

    posiblesPreds.forEach(p => {
      const pCod = String(p.codigo).replace(/\.+$/, "");
      const estaMarcado = predsActuales.includes(pCod);
      opcionesHTML += `
        <label class="inline-flex items-center space-x-1.5 bg-gray-50 px-2 py-1 rounded border border-gray-200 text-[11px] font-bold text-gray-700 mr-1.5 mb-1.5 shadow-xs ${cursorClase}">
          <input type="checkbox" data-act-cod="${codLimpio}" value="${pCod}" ${estaMarcado ? 'checked' : ''} ${deshabilitarChecks} class="chk-dep-item rounded text-[#0f2a4a] focus:ring-0">
          <span>[${pCod}] ${p.descripcion.substring(0, 20)}...</span>
        </label>
      `;
    });

    if (posiblesPreds.length === 0) {
      opcionesHTML = `<span class="text-gray-400 italic text-[11px]">Sin otras actividades para enlazar</span>`;
    }

    const sufijoDep = (state.proyectoModoDuracion === "hours") ? "h" : "d";
    tbody.innerHTML += `
      <tr class="hover:bg-gray-50 border-b border-gray-100">
        <td class="p-2.5 font-mono font-bold text-center text-[#0f2a4a]">${act.codigo}</td>
        <td class="p-2.5 font-semibold text-gray-800">${act.descripcion}</td>
        <td class="p-2.5 text-center font-bold text-teal-800">${act.dias}${sufijoDep}</td>
        <td class="p-2.5 flex flex-wrap items-center">${opcionesHTML}</td>
      </tr>
    `;
  });

  const btnGuardarDep = document.querySelector("#modal-dependencias button[onclick='guardarTodasDependencias()']");
  if (btnGuardarDep) {
    if (!state.proyectoEsGestor) btnGuardarDep.classList.add("hidden");
    else btnGuardarDep.classList.remove("hidden");
  }

  modal.classList.remove("hidden");
}

export function cerrarModalDependencias() {
  document.getElementById("modal-dependencias")?.classList.add("hidden");
}

export async function guardarTodasDependencias() {
  const inputs = document.querySelectorAll(".chk-dep-item");
  const mapaPreds = {};

  inputs.forEach(chk => {
    const actCod = chk.getAttribute("data-act-cod");
    if (!mapaPreds[actCod]) mapaPreds[actCod] = [];
    if (chk.checked) mapaPreds[actCod].push(chk.value);
  });

  let huboCambios = false;
  for (const act of state.actividadesGlobal) {
    const codLimpio = String(act.codigo).replace(/\.+$/, "");
    if (mapaPreds.hasOwnProperty(codLimpio)) {
      const nuevasPreds = mapaPreds[codLimpio].join(", ");
      if (act.predecesores !== nuevasPreds) {
        act.predecesores = nuevasPreds;
        huboCambios = true;
        await guardarCambioDirecto(act);
      }
    }
  }

  cerrarModalDependencias();
  if (huboCambios) {
    notificarToast("Dependencias actualizadas correctamente.", "success");
    if (state.capaCpmActiva) alternarCapaRutaCritica();
  }
}

// --- CÁLCULO Y ALTERNANCIA DE RUTA CRÍTICA ---
export async function alternarCapaRutaCritica() {
  if (!state.proyectoActualId) return;

  if (state.capaCpmActiva) {
    state.capaCpmActiva = false;
    actualizarBotonCpmUI(false);
    renderizarTabla();
    notificarToast("Capa de Ruta Crítica desactivada.", "info");
    return;
  }

  const tienePredecesoras = state.actividadesGlobal.some(a => a.predecesores && String(a.predecesores).trim() !== "");
  if (!tienePredecesoras) {
    const deseaConfigurar = await confirmModal(
      "ℹ️ Para calcular con precisión la Ruta Crítica (CPM), es necesario configurar las dependencias (predecesoras) entre sus actividades.\n\n¿Desea abrir el configurador de dependencias ahora?",
      "Configuración Requerida",
      "question"
    );
    if (deseaConfigurar === true) abrirModalDependencias();
    state.capaCpmActiva = false;
    actualizarBotonCpmUI(false);
    return;
  }

  state.capaCpmActiva = true;

  try {
    const res = await apiFetch(`/ruta-critica?proyecto_id=${state.proyectoActualId}`);
    if (!res.ok) throw new Error("Error calculando CPM");
    const cpm = await res.json();

    state.datosCpmGlobal.duracionTotal = cpm.duracion_proyecto_dias || 0;
    state.datosCpmGlobal.actividadesCriticas = new Set();

    if (cpm.detalles) {
      Object.values(cpm.detalles).forEach(n => {
        if (n.es_critica) state.datosCpmGlobal.actividadesCriticas.add(String(n.codigo).replace(/\.+$/, ""));
      });
    }

    actualizarBotonCpmUI(true, state.datosCpmGlobal.duracionTotal);
    renderizarTabla();
    notificarToast(`Ruta Crítica activa: ${state.datosCpmGlobal.duracionTotal} días calculados.`, "success");
  } catch (err) {
    console.error("Error al calcular CPM:", err);
    state.capaCpmActiva = false;
    actualizarBotonCpmUI(false);
    alert("No se pudo calcular la Ruta Crítica. Verifique las dependencias del proyecto.");
  }
}

// --- ACTUALIZACIÓN DE ESTADO VISUAL EN EL BOTÓN Y MENÚ ---
function actualizarBotonCpmUI(activo, duracion = 0) {
  const btn = document.getElementById("btn-menu-cpm");
  const txtToggle = document.getElementById("txt-menu-cpm-toggle");
  const sufijo = (state.proyectoModoDuracion === "hours") ? "h" : "d";

  if (activo) {
    if (btn) {
      btn.className = "h-[30px] w-[34px] bg-red-600 hover:bg-red-700 text-white border border-red-700 rounded-lg transition shadow-2xs flex items-center justify-center cursor-pointer animate-pulse";
      btn.title = `Ruta Crítica activa (${duracion}${sufijo})`;
      btn.innerHTML = `<span class="text-xs leading-none">🔥</span>`;
    }
    if (txtToggle) {
      txtToggle.textContent = `Desactivar Ruta Crítica (${duracion}${sufijo})`;
    }
  } else {
    if (btn) {
      btn.className = "h-[30px] w-[34px] bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 rounded-lg transition shadow-2xs flex items-center justify-center cursor-pointer";
      btn.title = "Gestión de Ruta Crítica y Dependencias";
      btn.innerHTML = `<span class="text-xs leading-none">⚡</span>`;
    }
    if (txtToggle) {
      txtToggle.textContent = "Activar Ruta Crítica";
    }
  }
}