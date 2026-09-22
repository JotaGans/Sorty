import { state } from "../core/state.js";
import { apiFetch } from "../core/api.js";
import { notificarToast, confirmModal, formatearFechaLatina, formatearFechaISO, abrirInputCustom } from "../core/ui-dialogs.js";
import { cargarCatalogoUnidades } from "./admin-ti.js";

const SVG_OJO_ABIERTO = `
  <svg class="w-4 h-4 text-gray-500 hover:text-[#0f2a4a] transition" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
`;

const SVG_OJO_CERRADO = `
  <svg class="w-4 h-4 text-amber-600 hover:text-amber-800 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
  </svg>
`;

export async function cargarHubProyectos() {
  if (!state.token) return;

  document.getElementById("view-login")?.classList.add("hidden");
  document.getElementById("view-hub")?.classList.remove("hidden");

  try {
    if (!state.catalogoUnidadesGlobal || state.catalogoUnidadesGlobal.length === 0) {
      const resUo = await apiFetch("/unidades-organicas").catch(() => null);
      if (resUo && resUo.ok) state.catalogoUnidadesGlobal = await resUo.json();
    }

    const res = await apiFetch("/proyectos");
    if (!res.ok) throw new Error("Error al cargar proyectos");
    state.proyectosUsuarioGlobal = await res.json();

    inicializarFiltrosHub();
    actualizarKPIsHub(state.proyectosUsuarioGlobal);
    aplicarConmutadorVistaHub();
    filtrarProyectosHub();
  } catch (err) {
    console.error("Error al cargar Hub:", err);
  }
}

export function actualizarKPIsHub(lista) {
  const total = lista.length;
  const sumaAvance = lista.reduce((acc, p) => acc + (p.avance_global || 0), 0);
  const promAvance = total > 0 ? Math.round(sumaAvance / total) : 0;

  const elTotal = document.getElementById("hub-kpi-total-proy");
  const elProm = document.getElementById("hub-kpi-prom-avance");
  if (elTotal) elTotal.innerText = total;
  if (elProm) elProm.innerText = `${promAvance}%`;
}

export function cambiarVistaHub(modo) {
  state.vistaHubActual = modo;
  localStorage.setItem("vista_hub_proyectos", modo);
  aplicarConmutadorVistaHub();
  filtrarProyectosHub();
}

export function aplicarConmutadorVistaHub() {
  const btnGrid = document.getElementById("btn-vista-grid");
  const btnTable = document.getElementById("btn-vista-table");
  const gridCont = document.getElementById("grid-proyectos-hub");
  const tableCont = document.getElementById("hub-proyectos-tabla-contenedor");

  const estiloActivo = "px-3 py-1.5 rounded-lg text-xs font-black bg-teal-600 hover:bg-teal-700 text-white shadow-sm flex items-center space-x-1.5 transition-all duration-150 cursor-pointer";
  const estiloInactivo = "px-3 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:text-teal-700 hover:bg-slate-200/60 transition-all duration-150 flex items-center space-x-1.5 cursor-pointer";

  if (state.vistaHubActual === "table") {
    if (btnTable) btnTable.className = estiloActivo;
    if (btnGrid) btnGrid.className = estiloInactivo;
    if (gridCont) gridCont.classList.add("hidden");
    if (tableCont) tableCont.classList.remove("hidden");
  } else {
    if (btnGrid) btnGrid.className = estiloActivo;
    if (btnTable) btnTable.className = estiloInactivo;
    if (gridCont) gridCont.classList.remove("hidden");
    if (tableCont) tableCont.classList.add("hidden");
  }
}

export function guardarOcultosLocalStorage() {
  localStorage.setItem("proyectos_ocultos_ids", JSON.stringify(Array.from(state.idsProyectosOcultos)));
  actualizarBotonOcultosHubUI();
}

export function actualizarBotonOcultosHubUI() {
  const btnOcultos = document.getElementById("btn-toggle-proyectos-ocultos");
  if (!btnOcultos) return;

  const cant = state.idsProyectosOcultos.size;
  if (cant > 0) {
    btnOcultos.classList.remove("hidden");
    if (state.mostrandoOcultosHub) {
      btnOcultos.className = "h-[30px] px-2.5 rounded-lg text-xs font-black bg-teal-600 hover:bg-teal-700 text-white shadow-sm transition flex items-center space-x-1 cursor-pointer whitespace-nowrap flex-shrink-0";
      btnOcultos.innerHTML = `<svg class="w-3.5 h-3.5 text-white flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg><span>Ver activos (${cant})</span>`;
    } else {
      btnOcultos.className = "w-[30px] h-[30px] rounded-lg bg-amber-500 hover:bg-amber-600 text-white shadow-sm transition flex items-center justify-center cursor-pointer flex-shrink-0";
      btnOcultos.innerHTML = `<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>`;
    }
  } else {
    btnOcultos.classList.add("hidden");
    state.mostrandoOcultosHub = false;
  }
}

export function alternarVerProyectosOcultos() {
  state.mostrandoOcultosHub = !state.mostrandoOcultosHub;
  actualizarBotonOcultosHubUI();
  filtrarProyectosHub();
}

export function alternarOcultarProyecto(id, event) {
  if (event) event.stopPropagation();
  if (state.idsProyectosOcultos.has(id)) {
    state.idsProyectosOcultos.delete(id);
    notificarToast("Proyecto restaurado al panel principal.", "success");
    if (state.idsProyectosOcultos.size === 0) state.mostrandoOcultosHub = false;
  } else {
    state.idsProyectosOcultos.add(id);
    notificarToast("Proyecto ocultado de la vista principal.", "info");
  }
  guardarOcultosLocalStorage();
  filtrarProyectosHub();
}

export async function solicitarEliminarProyecto(id, nombre, event) {
  if (event) event.stopPropagation();
  const pObj = state.proyectosUsuarioGlobal.find(p => p.id === id);
  const totalActs = pObj ? (pObj.total_actividades || 0) : 0;

  if (totalActs > 0) {
    alert(`⚠️ No se puede eliminar el proyecto '${nombre}'. Contiene ${totalActs} actividad(es).`);
    return;
  }

  const confirma = await confirmModal(`¿Está seguro de eliminar permanentemente '${nombre}'?`, "Eliminar Proyecto Vacío", "danger");
  if (!confirma) return;

  try {
    const res = await apiFetch(`/proyectos/${id}`, { method: "DELETE" });
    if (res.ok) {
      state.idsProyectosOcultos.delete(id);
      guardarOcultosLocalStorage();
      notificarToast(`Proyecto '${nombre}' eliminado con éxito.`, "info");
      await cargarHubProyectos();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || "Error al eliminar el proyecto.");
    }
  } catch (e) {
    alert("Error de conexión al eliminar el proyecto.");
  }
}

export function renderizarTarjetasHub(lista) {
  const grid = document.getElementById("grid-proyectos-hub");
  if (!grid) return;
  grid.innerHTML = "";
  actualizarBotonOcultosHubUI();

  const listaFinal = lista.filter(p => state.mostrandoOcultosHub ? state.idsProyectosOcultos.has(p.id) : !state.idsProyectosOcultos.has(p.id));

  listaFinal.forEach(p => {
    const rolEfectivo = p.rol_efectivo || (p.es_gestor ? 'GESTOR' : 'RESPONSABLE');
    const esGestor = (p.es_gestor === 1 || p.es_gestor === true || state.currentUser.rol === "ADMIN_TI") && rolEfectivo !== "AUTORIDAD";
    const totalActs = p.total_actividades || 0;
    const puedeEliminar = esGestor && (totalActs === 0);
    const esPublico = (p.visibilidad === "PUBLICO");

    let badgeRolClases = "bg-blue-50 text-blue-800 border-blue-200/80";
    let badgeRolTexto = "👤 Responsable";
    if (rolEfectivo === "GESTOR" || esGestor) {
      badgeRolClases = "bg-amber-50 text-amber-800 border-amber-200/80";
      badgeRolTexto = "👑 Gestor";
    }

    const badgeAlcanceHTML = esPublico
      ? `<span class="inline-flex items-center justify-center w-5 h-5 rounded-md bg-teal-50 text-teal-700 border border-teal-200 text-xs shadow-2xs cursor-help" title="Visible institucional">🌐</span>`
      : `<span class="inline-flex items-center justify-center w-5 h-5 rounded-md bg-slate-100 text-slate-600 border border-slate-200 text-xs shadow-2xs cursor-help" title="Privado">🔒</span>`;

    const textoDesc = (p.descripcion && p.descripcion.trim() !== "") ? p.descripcion.trim() : "Sin descripción adicional registrada.";
    const descEscapada = (p.descripcion || "").replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const avanceVal = parseInt(p.avance_global) || 0;
    const estaOculto = state.idsProyectosOcultos.has(p.id);

    let siglaUnidad = "";
    let nombreCompletoUnidad = "";
    if (p.unidad_organica && p.unidad_organica.trim() !== "") {
      const uRaw = p.unidad_organica.trim().toUpperCase();
      const uObj = (state.catalogoUnidadesGlobal || []).find(u => u.sigla.toUpperCase() === uRaw || u.nombre.trim().toUpperCase() === uRaw);
      siglaUnidad = uObj ? uObj.sigla : p.unidad_organica.trim();
      nombreCompletoUnidad = uObj ? uObj.nombre : p.unidad_organica.trim();
    }

    const tieneProceso = Boolean(p.proceso_nombre || p.proceso_codigo);
    const nombreLimpioProceso = tieneProceso ? (p.proceso_nombre || "Proceso sin denominación") : "Sin proceso asignado";

    const card = document.createElement("div");
    card.className = "bg-white rounded-2xl p-6 border border-gray-200/90 shadow-sm hover:shadow-md transition-all flex flex-col justify-between hover:border-teal-500/50 relative";
    card.innerHTML = `
      <div>
        <div class="flex items-center justify-between mb-3.5 gap-1">
          <div class="flex items-center space-x-1.5 flex-wrap">
            <span class="text-[10px] font-black px-2.5 py-1 rounded-md uppercase tracking-wider border ${badgeRolClases}">${badgeRolTexto}</span>
            ${badgeAlcanceHTML}
          </div>
          <div class="flex items-center space-x-1">
            <button onclick="alternarOcultarProyecto(${p.id}, event)" class="p-1 rounded hover:bg-gray-100 transition cursor-pointer">${estaOculto ? SVG_OJO_ABIERTO : SVG_OJO_CERRADO}</button>
            ${puedeEliminar ? `<button onclick="solicitarEliminarProyecto(${p.id}, '${p.nombre.replace(/'/g, "\\'")}', event)" class="p-1 rounded text-rose-400 hover:text-rose-700 hover:bg-rose-50 transition cursor-pointer">🗑️</button>` : ''}
            <span class="text-xs font-black px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200">${avanceVal}% Avance</span>
          </div>
        </div>
        <h3 class="font-bold text-base text-[#0f2a4a] leading-snug">${p.nombre}</h3>
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5">
          <p ondblclick="${esGestor ? `editarUnidadOrganicaProyecto(${p.id}, '${siglaUnidad}')` : ''}" class="text-[11px] font-bold text-teal-800 inline-flex items-center space-x-1 ${esGestor ? 'cursor-pointer hover:underline' : ''}">
            <span>🏢</span><span>${siglaUnidad || 'Sin UO'}</span>
          </p>
          <span class="text-gray-300 text-xs">•</span>
          <p ondblclick="${esGestor ? `editarProcesoProyectoModal(${p.id})` : ''}" class="text-[11px] font-semibold text-slate-600 inline-flex items-center space-x-1 max-w-[220px] truncate ${esGestor ? 'cursor-pointer hover:underline' : ''}">
            <span>⚙️</span><span class="truncate">${nombreLimpioProceso}</span>
          </p>
        </div>
        <p ondblclick="${esGestor ? `editarDescripcionProyecto(${p.id}, '${descEscapada}')` : ''}" class="text-xs text-gray-500 mt-2 line-clamp-2 min-h-[32px] ${esGestor ? 'cursor-pointer hover:text-teal-700' : ''}">${textoDesc}</p>
        <div class="w-full bg-gray-100 rounded-full h-2 mt-4 overflow-hidden shadow-inner">
          <div class="bg-teal-600 h-2 rounded-full transition-all duration-500" style="width: ${avanceVal}%"></div>
        </div>
        <div class="grid grid-cols-3 gap-2 mt-4 text-center">
          <div class="bg-emerald-50/80 p-2 rounded-xl border border-emerald-100"><span class="block text-[9px] font-black text-emerald-700 uppercase">Ejecutado</span><span class="text-xs font-black text-emerald-900">${p.ejecutadas || 0}</span></div>
          <div class="bg-amber-50/80 p-2 rounded-xl border border-amber-100"><span class="block text-[9px] font-black text-amber-700 uppercase">En proceso</span><span class="text-xs font-black text-amber-900">${p.en_proceso || 0}</span></div>
          <div class="bg-rose-50/80 p-2 rounded-xl border border-rose-100"><span class="block text-[9px] font-black text-rose-700 uppercase">No iniciado</span><span class="text-xs font-black text-rose-900">${p.pendientes || 0}</span></div>
        </div>
      </div>
      <button onclick="ingresarAlProyecto(${p.id}, '${p.nombre.replace(/'/g, "\\'")}', ${esGestor})" class="w-full mt-6 py-2.5 bg-[#0f2a4a] hover:bg-[#1b4f8a] text-white font-bold text-xs rounded-xl shadow transition flex items-center justify-center space-x-2 cursor-pointer">
        <span>Ingresar al Proyecto</span><span class="text-sm">→</span>
      </button>
    `;
    grid.appendChild(card);
  });

  if (!state.mostrandoOcultosHub) {
    const cardNuevo = document.createElement("div");
    cardNuevo.onclick = abrirModalNuevoProyecto;
    cardNuevo.className = "bg-slate-50/60 hover:bg-white rounded-2xl p-6 border-2 border-dashed border-slate-300 hover:border-teal-500 transition-all cursor-pointer flex flex-col items-center justify-center text-center group min-h-[290px] shadow-sm hover:shadow-md";
    cardNuevo.innerHTML = `
      <div class="w-12 h-12 rounded-full bg-teal-50 group-hover:bg-teal-600 text-teal-600 group-hover:text-white flex items-center justify-center text-xl font-black mb-3 transition shadow-sm">+</div>
      <h4 class="text-sm font-black text-gray-700 group-hover:text-[#0f2a4a] transition">Nuevo Proyecto / Programa</h4>
      <p class="text-[11px] text-gray-400 mt-1 max-w-[200px]">Cree un proyecto en blanco o seleccione una plantilla.</p>
      <span class="mt-4 text-[11px] font-bold text-teal-600 bg-teal-50 px-3 py-1 rounded-lg border border-teal-100 group-hover:bg-teal-600 group-hover:text-white transition">Comenzar</span>
    `;
    grid.appendChild(cardNuevo);
  }
}

export function renderizarTablaHub(lista) {
  const tbody = document.getElementById("hub-proyectos-tabla-body");
  if (!tbody) return;
  tbody.innerHTML = "";
  actualizarBotonOcultosHubUI();

  const listaFinal = lista.filter(p => state.mostrandoOcultosHub ? state.idsProyectosOcultos.has(p.id) : !state.idsProyectosOcultos.has(p.id));
  if (listaFinal.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-gray-400 font-semibold italic">No se encontraron proyectos.</td></tr>`;
    return;
  }

  listaFinal.forEach((p, idx) => {
    const rolEfectivo = p.rol_efectivo || (p.es_gestor ? 'GESTOR' : 'RESPONSABLE');
    const esGestor = (p.es_gestor === 1 || p.es_gestor === true || state.currentUser.rol === "ADMIN_TI") && rolEfectivo !== "AUTORIDAD";
    const totalActs = p.total_actividades || 0;
    const puedeEliminar = esGestor && (totalActs === 0);
    const esPublico = (p.visibilidad === "PUBLICO");
    const pct = p.avance_global || 0;
    const estaOculto = state.idsProyectosOcultos.has(p.id);
    const descEscapada = (p.descripcion || "").replace(/'/g, "\\'").replace(/"/g, '&quot;');

    tbody.innerHTML += `
      <tr class="hover:bg-gray-50 transition border-b border-gray-100">
        <td class="p-3 text-center text-gray-400 font-mono text-xs">${idx + 1}</td>
        <td class="p-3">
          <div class="flex items-center gap-1.5"><span class="font-bold text-gray-800 text-xs">${p.nombre}</span></div>
          <div ondblclick="${esGestor ? `editarDescripcionProyecto(${p.id}, '${descEscapada}')` : ''}" class="text-[11px] text-gray-500 line-clamp-1 ${esGestor ? 'cursor-pointer hover:text-teal-700' : ''}">${p.descripcion || '<span class="italic text-gray-400">Sin descripción</span>'}</div>
        </td>
        <td class="p-3 text-center whitespace-nowrap"><span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black uppercase bg-blue-100 text-blue-900">${rolEfectivo}</span></td>
        <td class="p-3 text-center"><span class="font-black text-gray-800 text-xs">${pct}%</span></td>
        <td class="p-3 text-center text-[10px] font-bold">${p.ejecutadas || 0} Ejec. | ${p.en_proceso || 0} Proc. | ${p.pendientes || 0} No inic.</td>
        <td class="p-3 text-right whitespace-nowrap">
          <button onclick="alternarOcultarProyecto(${p.id}, event)" class="p-1 rounded hover:bg-gray-200 cursor-pointer mr-1">${estaOculto ? SVG_OJO_ABIERTO : SVG_OJO_CERRADO}</button>
          ${puedeEliminar ? `<button onclick="solicitarEliminarProyecto(${p.id}, '${p.nombre.replace(/'/g, "\\'")}', event)" class="p-1 rounded text-rose-500 hover:text-rose-700 cursor-pointer mr-2">🗑️</button>` : ''}
          <button onclick="ingresarAlProyecto(${p.id}, '${p.nombre.replace(/'/g, "\\'")}', ${esGestor})" class="bg-[#0f2a4a] hover:bg-[#1b4f8a] text-white text-[11px] font-bold px-3 py-1.5 rounded-lg transition shadow cursor-pointer">Ingresar →</button>
        </td>
      </tr>
    `;
  });
}

export function exportarResumenProyectosExcel() {
  if (!state.proyectosUsuarioGlobal || state.proyectosUsuarioGlobal.length === 0) {
    alert("No hay proyectos para exportar.");
    return;
  }

  let csv = "ID;Proyecto / Programa;Unidad Responsable;Descripcion;Rol Asignado;% Avance;Total Actividades;Ejecutadas;En Proceso;No Iniciadas;Fecha de Creacion\n";
  state.proyectosUsuarioGlobal.forEach(p => {
    const rol = (p.es_gestor === 1 || p.es_gestor === true || state.currentUser.rol === "ADMIN_TI") ? "GESTOR" : "RESPONSABLE";
    const desc = (p.descripcion || "").replace(/(\r\n|\n|\r|")/gm, " ");
    csv += `"${p.id}";"${p.nombre.replace(/"/g, '""')}";"${p.unidad_organica || ''}";"${desc}";"${rol}";${p.avance_global || 0}%;${p.total_actividades || 0};${p.ejecutadas || 0};${p.en_proceso || 0};${p.pendientes || 0};"${p.fecha_creacion || ''}"\n`;
  });

  const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `IMARPE_Consolidado_Proyectos_${new Date().toISOString().split("T")[0]}.csv`;
  link.click();
  notificarToast("Resumen consolidado descargado en Excel.", "success");
}

export function abrirModalNuevoProyecto() {
  if (state.catalogoUnidadesGlobal.length === 0) cargarCatalogoUnidades();
  document.getElementById("input-nuevo-proy-nombre").value = "";
  document.getElementById("input-nuevo-proy-desc").value = "";
  document.getElementById("input-nuevo-proy-uo-busq").value = "";
  document.getElementById("input-nuevo-proy-uo-valor").value = "";
  document.getElementById("modal-nuevo-proyecto")?.classList.remove("hidden");
}

export function cerrarModalNuevoProyecto() {
  document.getElementById("modal-nuevo-proyecto")?.classList.add("hidden");
}

export function autocompletarUOProyecto(termino) {
  const term = termino.toLowerCase().trim();
  const divSug = document.getElementById("sugerencias-uo-proyecto");
  if (!divSug) return;

  if (!term) {
    divSug.classList.add("hidden");
    return;
  }
  const matches = (state.catalogoUnidadesGlobal || []).filter(u =>
    u.sigla.toLowerCase().includes(term) || u.nombre.toLowerCase().includes(term)
  );
  divSug.innerHTML = "";
  if (matches.length === 0) {
    divSug.innerHTML = `<div class="p-2 text-gray-400">Sin coincidencias</div>`;
  } else {
    matches.slice(0, 5).forEach(u => {
      const item = document.createElement("div");
      item.className = "p-2 hover:bg-teal-50 cursor-pointer flex justify-between font-semibold";
      item.innerHTML = `<span>${u.nombre}</span><strong class="text-[#0f2a4a] ml-2">[${u.sigla}]</strong>`;
      item.onclick = () => {
        document.getElementById("input-nuevo-proy-uo-busq").value = `${u.sigla} - ${u.nombre}`;
        document.getElementById("input-nuevo-proy-uo-valor").value = u.sigla;
        divSug.classList.add("hidden");
      };
      divSug.appendChild(item);
    });
  }
  divSug.classList.remove("hidden");
}

export async function guardarNuevoProyecto(e) {
  e.preventDefault();
  const nombre = document.getElementById("input-nuevo-proy-nombre").value.trim();
  const descripcion = document.getElementById("input-nuevo-proy-desc").value.trim();
  const uoBusq = document.getElementById("input-nuevo-proy-uo-busq").value.trim();
  const uoValor = document.getElementById("input-nuevo-proy-uo-valor").value.trim();
  const durationMode = document.getElementById("input-nuevo-proy-duration-mode")?.value || "business_days";
  const visibilidad = document.getElementById("input-nuevo-proy-visibilidad")?.value || "PRIVADO";

  if (!nombre) {
    alert("Por favor ingresa un nombre para el proyecto.");
    return;
  }

  const unidadValida = (state.catalogoUnidadesGlobal || []).find(u =>
    u.sigla.toUpperCase() === uoValor.toUpperCase() ||
    u.sigla.toUpperCase() === uoBusq.toUpperCase() ||
    `${u.sigla} - ${u.nombre}`.toUpperCase() === uoBusq.toUpperCase() ||
    u.nombre.toUpperCase() === uoBusq.toUpperCase()
  );

  if (!unidadValida) {
    alert("Debe seleccionar una Unidad de Organización válida.");
    return;
  }

  try {
    const res = await apiFetch("/proyectos", {
      method: "POST",
      body: JSON.stringify({ nombre, descripcion, unidad_organica: unidadValida.sigla, duration_mode: durationMode, visibilidad })
    });

    if (res.ok) {
      cerrarModalNuevoProyecto();
      await cargarHubProyectos();
      notificarToast("Proyecto creado exitosamente.", "success");
    } else {
      const errData = await res.json().catch(() => ({}));
      alert(errData.detail || "No se pudo crear el proyecto.");
    }
  } catch (err) {
    alert("Error de comunicación con el servidor.");
  }
}

export function inicializarFiltrosHub() {
  const selUo = document.getElementById("hub-filtro-uo");
  if (!selUo) return;
  selUo.innerHTML = '<option value="">🏢 Todas las Unidades</option>';
  (state.catalogoUnidadesGlobal || []).forEach(u => {
    selUo.innerHTML += `<option value="${u.sigla}">${u.sigla} - ${u.nombre}</option>`;
  });
}

export function autocompletarUOHub(termino) {
  const term = (termino || "").toLowerCase().trim();
  const divSug = document.getElementById("hub-sugerencias-uo");
  const btnLimpiar = document.getElementById("btn-limpiar-filtro-uo");
  if (!divSug) return;

  if (btnLimpiar) btnLimpiar.classList.toggle("hidden", term.length === 0);

  if (!term) {
    divSug.innerHTML = "";
    divSug.classList.add("hidden");
    document.getElementById("hub-filtro-uo-valor").value = "";
    filtrarProyectosHub();
    return;
  }

  const matches = (state.catalogoUnidadesGlobal || []).filter(u =>
    (u.estado === 'ACTIVO' || !u.estado) && (u.sigla.toLowerCase().includes(term) || u.nombre.toLowerCase().includes(term))
  );

  divSug.innerHTML = "";
  if (matches.length === 0) {
    divSug.innerHTML = `<div class="p-2.5 text-gray-400 italic">Sin coincidencias</div>`;
  } else {
    matches.slice(0, 6).forEach(u => {
      const item = document.createElement("div");
      item.className = "p-2.5 hover:bg-teal-50 cursor-pointer flex justify-between items-center transition border-b border-gray-100 last:border-0 font-semibold";
      item.innerHTML = `<span class="text-gray-800 truncate pr-2">${u.nombre}</span><strong class="text-[#0f2a4a] bg-slate-100 px-1.5 py-0.5 rounded border text-[10px]">[${u.sigla}]</strong>`;
      item.onclick = () => {
        document.getElementById("hub-filtro-uo-busq").value = `${u.sigla} - ${u.nombre}`;
        document.getElementById("hub-filtro-uo-valor").value = u.sigla;
        divSug.classList.add("hidden");
        filtrarProyectosHub();
      };
      divSug.appendChild(item);
    });
  }
  divSug.classList.remove("hidden");
}

export function limpiarFiltroUnidadHub() {
  const inpBusq = document.getElementById("hub-filtro-uo-busq");
  const inpVal = document.getElementById("hub-filtro-uo-valor");
  const divSug = document.getElementById("hub-sugerencias-uo");
  const btnLimpiar = document.getElementById("btn-limpiar-filtro-uo");

  if (inpBusq) inpBusq.value = "";
  if (inpVal) inpVal.value = "";
  if (divSug) divSug.classList.add("hidden");
  if (btnLimpiar) btnLimpiar.classList.add("hidden");
  filtrarProyectosHub();
}

export function obtenerProyectosFiltradosHub() {
  const query = (document.getElementById("hub-filtro-busqueda")?.value || "").toLowerCase().trim();
  const filtroUoVal = document.getElementById("hub-filtro-uo-valor")?.value || document.getElementById("hub-filtro-uo-busq")?.value || "";
  const filtroUo = filtroUoVal.includes(" - ") ? filtroUoVal.split(" - ")[0].trim() : filtroUoVal.trim();
  const filtroEstado = document.getElementById("hub-filtro-estado")?.value || "";

  return state.proyectosUsuarioGlobal.filter(p => {
    const matchTexto = !query || (p.nombre && p.nombre.toLowerCase().includes(query)) || (p.descripcion && p.descripcion.toLowerCase().includes(query));
    let matchUo = true;
    if (filtroUo !== "") {
      const pUo = (p.unidad_organica || "").trim().toUpperCase();
      const fUo = filtroUo.toUpperCase();
      matchUo = (pUo === fUo || pUo.startsWith(fUo + " ") || pUo.includes(`[${fUo}]`));
    }
    let matchEstado = true;
    if (filtroEstado === "Ejecutado") matchEstado = (p.avance_global === 100);
    else if (filtroEstado === "En proceso") matchEstado = (p.avance_global > 0 && p.avance_global < 100);
    else if (filtroEstado === "No iniciado") matchEstado = (p.avance_global === 0);

    return matchTexto && matchUo && matchEstado;
  });
}

export function filtrarProyectosHub() {
  const filtrados = obtenerProyectosFiltradosHub();
  actualizarBadgeFiltrosHub();
  if (state.vistaHubActual === "table") renderizarTablaHub(filtrados);
  else renderizarTarjetasHub(filtrados);
}

export function actualizarBadgeFiltrosHub() {
  const query = (document.getElementById("hub-filtro-busqueda")?.value || "").trim();
  const uoVal = (document.getElementById("hub-filtro-uo-busq")?.value || "").trim();
  const estadoVal = document.getElementById("hub-filtro-estado")?.value || "";

  const hayFiltro = (query !== "" || uoVal !== "" || estadoVal !== "");
  const badgeDiv = document.getElementById("hub-badge-filtro-activo");
  const badgeTxt = document.getElementById("hub-badge-filtro-texto");

  if (!badgeDiv || !badgeTxt) return;
  if (hayFiltro) {
    const descripciones = [];
    if (query) descripciones.push(`Texto: "${query}"`);
    if (uoVal) descripciones.push(`Unidad: "${uoVal}"`);
    if (estadoVal) descripciones.push(`Estado: "${estadoVal}"`);
    badgeTxt.innerText = descripciones.join(" | ");
    badgeDiv.classList.remove("hidden");
    badgeDiv.classList.add("flex");
  } else {
    badgeDiv.classList.add("hidden");
    badgeDiv.classList.remove("flex");
  }
}

export function hubLimpiarTodosFiltros() {
  const inpBusq = document.getElementById("hub-filtro-busqueda");
  const inpUo = document.getElementById("hub-filtro-uo-busq");
  const inpUoVal = document.getElementById("hub-filtro-uo-valor");
  const selEstado = document.getElementById("hub-filtro-estado");
  const btnLimpiarUo = document.getElementById("btn-limpiar-filtro-uo");

  if (inpBusq) inpBusq.value = "";
  if (inpUo) inpUo.value = "";
  if (inpUoVal) inpUoVal.value = "";
  if (selEstado) selEstado.value = "";
  if (btnLimpiarUo) btnLimpiarUo.classList.add("hidden");

  filtrarProyectosHub();
  notificarToast("Filtros del Hub restablecidos correctamente.", "info");
}

// Exposición pública a window
window.cargarHubProyectos = cargarHubProyectos;
window.cambiarVistaHub = cambiarVistaHub;
window.alternarVerProyectosOcultos = alternarVerProyectosOcultos;
window.alternarOcultarProyecto = alternarOcultarProyecto;
window.solicitarEliminarProyecto = solicitarEliminarProyecto;
window.exportarResumenProyectosExcel = exportarResumenProyectosExcel;
window.abrirModalNuevoProyecto = abrirModalNuevoProyecto;
window.cerrarModalNuevoProyecto = cerrarModalNuevoProyecto;
window.autocompletarUOProyecto = autocompletarUOProyecto;
window.guardarNuevoProyecto = guardarNuevoProyecto;
window.autocompletarUOHub = autocompletarUOHub;
window.limpiarFiltroUnidadHub = limpiarFiltroUnidadHub;
window.filtrarProyectosHub = filtrarProyectosHub;
window.hubLimpiarTodosFiltros = hubLimpiarTodosFiltros;