import { state } from "../core/state.js";
import { apiFetch } from "../core/api.js";
import { notificarToast, confirmModal, formatearFechaLatina, formatearFechaISO, parsearFechaUniversal, abrirInputCustom } from "../core/ui-dialogs.js";
import { actualizarDisplaysUsuario } from "./auth.js";
import { cargarHubProyectos } from "./hub.js";

export async function ingresarAlProyecto(id, nombre, esGestor) {
  state.proyectoActualId = id;
  state.proyectoEsGestor = (esGestor === 1 || esGestor === true || state.currentUser.rol === "ADMIN_TI");

  const proyData = state.proyectosUsuarioGlobal.find(p => p.id === id);
  state.proyectoModoDuracion = proyData?.duration_mode || "business_days";

  const thDias = document.getElementById("th-dias");
  if (thDias) {
    thDias.innerHTML = (state.proyectoModoDuracion === "hours")
      ? `Horas <span class="text-[10px] text-teal-300 opacity-80">✎</span>`
      : `Días <span class="text-[10px] text-teal-300 opacity-80">✎</span>`;
  }

  const txtNombre = document.getElementById("txt-nombre-proyecto");
  if (txtNombre) {
    txtNombre.value = nombre;
    txtNombre.disabled = !state.proyectoEsGestor;
  }

  const badge = document.getElementById("badge-rol-gantt");
  if (badge) {
    if (state.proyectoEsGestor) {
      badge.className = "bg-amber-100 text-amber-900 border border-amber-300 text-[11px] font-extrabold uppercase px-3 py-2 rounded-lg shadow-sm flex items-center space-x-1";
      badge.innerHTML = `<span>👑</span><span>GESTOR DE PROYECTO</span>`;
    } else {
      badge.className = "bg-blue-100 text-blue-900 border border-blue-300 text-[11px] font-extrabold uppercase px-3 py-2 rounded-lg shadow-sm flex items-center space-x-1";
      badge.innerHTML = `<span>👤</span><span>RESPONSABLE ASIGNADO</span>`;
    }
  }

  actualizarDisplaysUsuario();

  document.getElementById("view-hub")?.classList.add("hidden");
  document.getElementById("view-dashboard")?.classList.remove("hidden");
  document.getElementById("bloque-superior-gantt")?.classList.remove("hidden");

  await sincronizarDatosProyecto(id);
  await cargarComentariosProyecto();
}

export function volverAlHub() {
  document.getElementById("view-dashboard")?.classList.add("hidden");
  document.getElementById("bloque-superior-gantt")?.classList.add("hidden");
  document.getElementById("view-hub")?.classList.remove("hidden");
  cargarHubProyectos();
}

export async function sincronizarDatosProyecto(id) {
  try {
    const resActs = await apiFetch(`/proyectos/${id}/actividades`);
    if (resActs.ok) {
      const freshActs = await resActs.json();
      state.actividadesGlobal = (freshActs || []).sort((a, b) => compararCodigosWBS(a.codigo, b.codigo));
      construirCalendarioAnual();
      poblarFiltroResponsablesDinamico();
      renderizarCabeceraGantt();
      renderizarTabla();
      actualizarKPIs();
    }
  } catch (err) {
    renderizarTabla();
  }
}

export function compararCodigosWBS(codA, codB) {
  const partesA = String(codA || "").replace(/\.+$/, "").split(".");
  const partesB = String(codB || "").replace(/\.+$/, "").split(".");
  const maxLen = Math.max(partesA.length, partesB.length);

  for (let i = 0; i < maxLen; i++) {
    const valA = partesA[i];
    const valB = partesB[i];
    if (valA === undefined) return -1;
    if (valB === undefined) return 1;

    const numA = parseInt(valA, 10);
    const numB = parseInt(valB, 10);
    if (!isNaN(numA) && !isNaN(numB)) {
      if (numA !== numB) return numA - numB;
    } else {
      const comp = String(valA).localeCompare(String(valB));
      if (comp !== 0) return comp;
    }
  }
  return 0;
}

export function tieneHijos(codigo) {
  const codLimpio = String(codigo).replace(/\.+$/, "");
  return state.actividadesGlobal.some(a => {
    const aCod = String(a.codigo).replace(/\.+$/, "");
    return aCod.startsWith(codLimpio + ".") && aCod !== codLimpio;
  });
}

export function recalcularJerarquiaWBS() {
  if (!state.actividadesGlobal || state.actividadesGlobal.length === 0) return;
  state.actividadesGlobal.forEach(a => { a.codigo = String(a.codigo).replace(/\.+$/, ""); });
  state.actividadesGlobal.sort((a, b) => compararCodigosWBS(a.codigo, b.codigo));

  const niveles = [4, 3, 2, 1];
  niveles.forEach(nivelActual => {
    state.actividadesGlobal.forEach(madre => {
      const codLimpio = madre.codigo;
      const partes = codLimpio.split(".");
      if (partes.length === nivelActual) {
        const hijosDirectos = state.actividadesGlobal.filter(h => h.codigo.startsWith(codLimpio + ".") && h.codigo.split(".").length === nivelActual + 1);
        if (hijosDirectos.length > 0) {
          const sumaAvances = hijosDirectos.reduce((acc, h) => acc + (parseInt(h.avance) || 0), 0);
          const promAvance = Math.round(sumaAvances / hijosDirectos.length);
          madre.avance = promAvance;
          madre.estado = promAvance === 100 ? "Ejecutado" : (promAvance > 0 ? "En proceso" : "No iniciado");
        }
      }
    });
  });
}

export function renderizarTabla() {
  recalcularJerarquiaWBS();
  const tbody = document.getElementById("lista-actividades");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!state.actividadesGlobal || state.actividadesGlobal.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="p-8 text-center text-gray-400 font-bold">No hay actividades creadas en este proyecto.</td></tr>`;
    actualizarKPIs();
    return;
  }

  const txtBusqueda = (document.getElementById("filtro-busqueda")?.value || "").toLowerCase().trim();
  const respFiltro = document.getElementById("filtro-responsable-select")?.value || "";

  state.actividadesGlobal.forEach(act => {
    const nivel = act.codigo.split(".").length;
    if (state.nivelFiltroActivo < 4 && nivel !== state.nivelFiltroActivo) return;
    if (txtBusqueda && !act.descripcion.toLowerCase().includes(txtBusqueda) && !act.codigo.toLowerCase().includes(txtBusqueda)) return;
    if (respFiltro && !(act.responsable || "").includes(respFiltro)) return;

    const esMadre = tieneHijos(act.codigo);
    const esNivel1 = (nivel === 1);
    const paddingLeft = (nivel - 1) * 16 + 8;
    const cod = act.codigo;

    const tr = document.createElement("tr");
    tr.id = `fila-act-${act.codigo.replace(/\./g, '_')}`;
    tr.className = `${esNivel1 ? "tree-row-l1" : "hover:bg-gray-50"} border-b border-gray-100`;

    tr.innerHTML = `
      <td class="p-2.5 font-mono font-bold text-xs border-r border-b border-gray-200">${cod}</td>
      <td class="p-2 border-r border-b border-gray-200" style="padding-left: ${paddingLeft}px;">
        <span class="text-xs font-semibold text-gray-800">${act.descripcion}</span>
      </td>
      <td class="p-2 border-r border-b border-gray-200 text-center text-xs">${act.responsable || 'No asignado'}</td>
      <td class="p-2.5 border-r border-b border-gray-200 text-xs font-bold">${act.estado}</td>
      <td class="p-2.5 border-r border-b border-gray-200 text-xs font-mono">${formatearFechaLatina(act.fecha_inicio)}</td>
      <td class="p-2.5 border-r border-b border-gray-200 text-xs font-mono">${formatearFechaLatina(act.fecha_fin)}</td>
      <td class="p-2.5 border-r border-b border-gray-200 text-center text-xs font-bold">${act.dias}</td>
      <td class="p-2.5 border-r border-b border-gray-200 text-center text-xs font-bold">${act.avance}%</td>
      <td class="p-1 border-r border-b border-gray-200">
        <div class="h-6 bg-slate-100 rounded relative overflow-hidden flex items-center px-2">
          <div class="h-4 bg-teal-600 rounded text-white text-[9px] font-bold px-1.5 flex items-center" style="width: ${Math.min(100, Math.max(15, act.avance))}%;">
            ${act.avance}%
          </div>
        </div>
      </td>
      <td class="p-2 text-center border-b border-gray-200 whitespace-nowrap">
        ${state.proyectoEsGestor ? `<button onclick="eliminarActividad('${cod}')" class="text-red-500 hover:text-red-700 font-bold px-1">🗑️</button>` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });
  actualizarKPIs();
}

export function construirCalendarioAnual() {
  const anioActual = new Date().getFullYear();
  state.diasTotalesAnio = [];
  state.semanasTotales = [];
  let currDia = new Date(anioActual, 0, 1);
  const finCalendario = new Date(anioActual, 11, 31);

  while (currDia <= finCalendario) {
    state.diasTotalesAnio.push({
      fecha: new Date(currDia),
      dia: String(currDia.getDate()).padStart(2, '0'),
      mes: currDia.getMonth(),
      mesNombre: state.nombresMeses[currDia.getMonth()],
      anio: currDia.getFullYear()
    });
    currDia.setDate(currDia.getDate() + 1);
  }
}

export function renderizarCabeceraGantt() {
  const divMeses = document.getElementById("gantt-header-meses");
  const divSemanas = document.getElementById("gantt-header-semanas");
  if (!divMeses || !divSemanas) return;
  divMeses.innerHTML = `<div class="flex-1 text-center py-1 font-bold text-white bg-[#0f2a4a]">Cronograma Institucional 2026</div>`;
  divSemanas.innerHTML = "";
  for (let s = 1; s <= 16; s++) {
    divSemanas.innerHTML += `<div class="flex-1 text-center py-0.5 border-r border-[#1c335a] text-[9px] font-mono text-teal-300">S${s}</div>`;
  }
}

export function poblarFiltroResponsablesDinamico() {
  const select = document.getElementById("filtro-responsable-select");
  if (!select) return;
  const setResponsables = new Set();
  (state.actividadesGlobal || []).forEach(act => {
    const resp = (act.responsable || "").trim();
    if (resp && resp !== "No asignado") setResponsables.add(resp);
  });
  select.innerHTML = '<option value="">👤 Todo el Personal</option>';
  Array.from(setResponsables).sort().forEach(nombre => {
    select.innerHTML += `<option value="${nombre}">${nombre}</option>`;
  });
}

export function actualizarKPIs() {
  if (!state.actividadesGlobal || state.actividadesGlobal.length === 0) return;
  const total = state.actividadesGlobal.length;
  const sumaAvance = state.actividadesGlobal.reduce((acc, a) => acc + (parseInt(a.avance) || 0), 0);
  const prom = Math.round(sumaAvance / total);
  const ejec = state.actividadesGlobal.filter(a => a.estado === 'Ejecutado').length;
  const proc = state.actividadesGlobal.filter(a => a.estado === 'En proceso').length;
  const noInic = state.actividadesGlobal.filter(a => a.estado === 'No iniciado').length;

  document.getElementById("kpi-avance").innerText = `${prom}%`;
  document.getElementById("kpi-ejecutado").innerText = `${ejec} Items`;
  document.getElementById("kpi-proceso").innerText = `${proc} Items`;
  document.getElementById("kpi-pendiente").innerText = `${noInic} Items`;
}

export async function eliminarActividad(cod) {
  if (!state.proyectoEsGestor) return;
  const confirma = await confirmModal(`¿Está seguro de eliminar la actividad [${cod}]?`, "Eliminar Registro", "danger");
  if (!confirma) return;

  try {
    const res = await apiFetch(`/proyectos/${state.proyectoActualId}/actividades/${cod}`, { method: "DELETE" });
    if (res.ok) {
      notificarToast(`Actividad [${cod}] eliminada.`, "info");
      await sincronizarDatosProyecto(state.proyectoActualId);
    }
  } catch (e) {
    alert("Error al eliminar la actividad.");
  }
}

export async function cargarComentariosProyecto() {
  if (!state.proyectoActualId) return;
  try {
    const res = await apiFetch(`/proyectos/${state.proyectoActualId}/comentarios`);
    if (res.ok) state.comentariosGlobal = await res.json();
  } catch (e) {}
}

export function exportarExcelCSV() {
  let csv = "Codigo;Descripcion;Responsable;Estado;Fecha Inicio;Fecha Fin;Dias;% Avance\n";
  state.actividadesGlobal.forEach(a => {
    csv += `"${a.codigo}";"${a.descripcion.replace(/"/g, '""')}";"${a.responsable || ''}";"${a.estado}";"${a.fecha_inicio}";"${a.fecha_fin}";${a.dias};${a.avance}%\n`;
  });
  const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Cronograma_${state.proyectoActualId}.csv`;
  link.click();
  notificarToast("Cronograma exportado a Excel.", "success");
}

// Exposición pública a window
window.ingresarAlProyecto = ingresarAlProyecto;
window.volverAlHub = volverAlHub;
window.renderizarTabla = renderizarTabla;
window.eliminarActividad = eliminarActividad;
window.exportarExcelCSV = exportarExcelCSV;