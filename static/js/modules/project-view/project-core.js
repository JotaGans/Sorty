import { state } from "../../core/state.js";
import { apiFetch } from "../../core/api.js";
import { notificarToast } from "../../core/ui-dialogs.js";
import { actualizarDisplaysUsuario } from "../auth.js";
import { cargarHubProyectos } from "../hub.js";
import { construirCalendarioAnual, autoAjustarSemanaInicio, renderizarCabeceraGantt } from "./project-gantt.js";
import { renderizarTabla, recalcularJerarquiaWBS, poblarFiltroResponsablesDinamico } from "./project-wbs.js";
import { cargarComentariosProyecto, abrirModalGuardarPlantilla, abrirModalImportarPlantillaProyecto } from "./project-aux.js";

export async function ingresarAlProyecto(id, nombre, esGestor) {
  state.proyectoActualId = id;
  state.proyectoEsGestor = Boolean(esGestor === 1 || esGestor === true || state.currentUser.rol === "ADMIN_TI");

  const proyData = (state.proyectosUsuarioGlobal || []).find(p => p.id === id);
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
      badge.className = "h-10 bg-amber-100 text-amber-900 border border-amber-300 text-[11px] font-extrabold uppercase px-3.5 rounded-xl shadow-xs flex items-center space-x-1.5 whitespace-nowrap";
      badge.innerHTML = `<span>👑</span><span>GESTOR DE PROYECTO</span>`;
    } else {
      badge.className = "h-10 bg-blue-100 text-blue-900 border border-blue-300 text-[11px] font-extrabold uppercase px-3.5 rounded-xl shadow-xs flex items-center space-x-1.5 whitespace-nowrap";
      badge.innerHTML = `<span>👤</span><span>RESPONSABLE ASIGNADO</span>`;
    }
  }

  actualizarDisplaysUsuario();

  const btnNuevaAct = document.getElementById("btn-nueva-act-gantt");
  const btnHist = document.getElementById("btn-historial-gantt");
  const btnPers = document.getElementById("btn-personal-gantt");
  const btnPlantilla = document.getElementById("btn-accion-plantilla-dinamico");

  if (!state.proyectoEsGestor) {
    if (btnNuevaAct) btnNuevaAct.classList.add("hidden");
    if (btnHist) btnHist.classList.add("hidden");
    if (btnPers) btnPers.classList.add("hidden");
    if (btnPlantilla) btnPlantilla.classList.add("hidden");
  } else {
    if (btnNuevaAct) btnNuevaAct.classList.remove("hidden");
    if (btnHist) btnHist.classList.remove("hidden");
    if (btnPers) btnPers.classList.remove("hidden");
    if (btnPlantilla) btnPlantilla.classList.remove("hidden");
  }

  document.getElementById("view-hub")?.classList.add("hidden");
  document.getElementById("view-dashboard")?.classList.remove("hidden");
  document.getElementById("bloque-superior-gantt")?.classList.remove("hidden");

  aplicarVisibilidadColumnas();
  inicializarRedimensionDescripcion();
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
    if (!state.responsablesGlobal || state.responsablesGlobal.length === 0) {
      try {
        const resResp = await apiFetch(`/responsables`);
        if (resResp.ok) state.responsablesGlobal = await resResp.json();
      } catch (e) {}
    }

    const resActs = await apiFetch(`/proyectos/${id}/actividades`);
    if (resActs.ok) {
      const freshActs = await resActs.json();
      state.actividadesGlobal = (freshActs || []).sort((a, b) => {
        const pA = String(a.codigo || "").replace(/\.+$/, "").split(".");
        const pB = String(b.codigo || "").replace(/\.+$/, "").split(".");
        const mLen = Math.max(pA.length, pB.length);
        for (let i = 0; i < mLen; i++) {
          if (pA[i] === undefined) return -1;
          if (pB[i] === undefined) return 1;
          const nA = parseInt(pA[i], 10), nB = parseInt(pB[i], 10);
          if (!isNaN(nA) && !isNaN(nB)) { if (nA !== nB) return nA - nB; }
          else { const comp = String(pA[i]).localeCompare(String(pB[i])); if (comp !== 0) return comp; }
        }
        return 0;
      });

      localStorage.setItem(`cache_acts_proj_${id}`, JSON.stringify(state.actividadesGlobal));
      construirCalendarioAnual();
      autoAjustarSemanaInicio();
      poblarFiltroResponsablesDinamico();
      renderizarCabeceraGantt();
      renderizarTabla();
      actualizarKPIs();
      actualizarBotonPlantillaDinamico();
    }
  } catch (err) {
    console.error("Error sincronizando actividades:", err);
    renderizarTabla();
  }
}

export function actualizarKPIs() {
  if (!state.actividadesGlobal || state.actividadesGlobal.length === 0) {
    document.getElementById("kpi-avance").innerText = "0%";
    document.getElementById("kpi-ejecutado").innerText = "0 Items";
    document.getElementById("kpi-proceso").innerText = "0 Items";
    document.getElementById("kpi-pendiente").innerText = "0 Items";
    return;
  }

  recalcularJerarquiaWBS();

  const selNivel = parseInt(document.getElementById("sel-filtro-nivel")?.value || "4");
  const txtBusq = (document.getElementById("filtro-busqueda")?.value || "").toLowerCase().trim();
  const selResp = document.getElementById("filtro-responsable-select")?.value || "";

  const hayFiltroNivel = (selNivel !== 4);
  const hayFiltroTexto = (txtBusq !== "");
  const hayFiltroResp = (selResp !== "");
  const hayFiltroActivo = (hayFiltroNivel || hayFiltroTexto || hayFiltroResp);

  const badgeFiltro = document.getElementById("badge-filtro-activo");
  const badgeTexto = document.getElementById("badge-filtro-texto");

  if (badgeFiltro && badgeTexto) {
    if (hayFiltroActivo) {
      const criterios = [];
      if (hayFiltroNivel) criterios.push(`Nivel ${selNivel}`);
      if (hayFiltroResp) {
        const nomCorto = selResp.includes(",") ? selResp.split(",")[0].trim() : selResp.split(" ")[0];
        criterios.push(`👤 ${nomCorto}`);
      }
      if (hayFiltroTexto) criterios.push(`"${txtBusq}"`);

      badgeTexto.innerText = `Filtrado por: ${criterios.join(" + ")}`;
      badgeFiltro.classList.remove("hidden");
      badgeFiltro.classList.add("flex");
    } else {
      badgeFiltro.classList.add("hidden");
      badgeFiltro.classList.remove("flex");
    }
  }

  let muestraActividades = [];
  if (!hayFiltroActivo) {
    muestraActividades = state.actividadesGlobal.filter(a => {
      const cLimpio = String(a.codigo).replace(/\.+$/, "");
      return !state.actividadesGlobal.some(sub => {
        const subC = String(sub.codigo).replace(/\.+$/, "");
        return subC.startsWith(cLimpio + ".") && subC !== cLimpio;
      });
    });
    if (muestraActividades.length === 0) muestraActividades = state.actividadesGlobal;
  } else {
    muestraActividades = state.actividadesGlobal.filter(act => {
      const codLimpio = String(act.codigo).replace(/\.+$/, "");
      const nivel = codLimpio.split(".").length;
      if (hayFiltroNivel && nivel !== selNivel) return false;
      if (hayFiltroTexto && !act.descripcion.toLowerCase().includes(txtBusq) && !codLimpio.toLowerCase().includes(txtBusq)) return false;
      if (hayFiltroResp && !(act.responsable || "").includes(selResp)) return false;
      return true;
    });
  }

  const total = muestraActividades.length;
  let promAvance = 0;
  if (total > 0) {
    const sumaAvances = muestraActividades.reduce((acc, a) => acc + (parseInt(a.avance) || 0), 0);
    promAvance = Math.round(sumaAvances / total);
  }

  const ejecutadas = muestraActividades.filter(a => a.estado === 'Ejecutado').length;
  const enProceso = muestraActividades.filter(a => a.estado === 'En proceso').length;
  const noIniciadas = muestraActividades.filter(a => a.estado === 'No iniciado' || a.estado === 'Pendiente').length;

  const formatearItemsTexto = (cant) => `${cant} ${cant === 1 ? 'Item' : 'Items'}`;

  document.getElementById("kpi-avance").innerText = `${promAvance}%`;
  document.getElementById("kpi-ejecutado").innerText = formatearItemsTexto(ejecutadas);
  document.getElementById("kpi-proceso").innerText = formatearItemsTexto(enProceso);
  document.getElementById("kpi-pendiente").innerText = formatearItemsTexto(noIniciadas);
}

export function limpiarTodosFiltros() {
  const selNivel = document.getElementById("sel-filtro-nivel");
  const inpBusq = document.getElementById("filtro-busqueda");
  const selResp = document.getElementById("filtro-responsable-select");

  if (selNivel) selNivel.value = "4";
  if (inpBusq) inpBusq.value = "";
  if (selResp) selResp.value = "";

  state.nivelFiltroActivo = 4;
  renderizarTabla();
  actualizarKPIs();
  notificarToast("Filtros restablecidos a la vista completa del proyecto.", "info");
}

export function obtenerClaveStorageAnchoCol() {
  const uId = state.currentUser.id || state.currentUser.username || "default";
  const pId = state.proyectoActualId || "global";
  return `ancho_col_desc_user_${uId}_proj_${pId}`;
}

export function aplicarAnchoColumnaDescripcion(anchoPx) {
  const thDesc = document.getElementById("th-descripcion");
  if (!thDesc) return;
  const px = parseInt(anchoPx);
  if (isNaN(px) || px < 140) return;

  thDesc.style.width = `${px}px`;
  thDesc.style.minWidth = `${px}px`;
  thDesc.style.maxWidth = `${px}px`;

  document.querySelectorAll("#lista-actividades td:nth-child(2)").forEach(td => {
    td.style.maxWidth = `${px}px`;
  });
}

export function inicializarRedimensionDescripcion() {
  const thDesc = document.getElementById("th-descripcion");
  const resizer = document.getElementById("resizer-col-descripcion");
  if (!thDesc || !resizer) return;

  const clave = obtenerClaveStorageAnchoCol();
  const anchoGuardado = localStorage.getItem(clave);
  if (anchoGuardado) aplicarAnchoColumnaDescripcion(anchoGuardado);
  else aplicarAnchoColumnaDescripcion(260);

  let inicioX = 0, anchoInicial = 0;

  const alMoverMouse = (e) => {
    const deltaX = e.clientX - inicioX;
    const nuevoAncho = Math.min(1400, Math.max(140, anchoInicial + deltaX));
    aplicarAnchoColumnaDescripcion(nuevoAncho);
  };

  const alSoltarMouse = () => {
    resizer.classList.remove("is-resizing");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    const anchoFinal = parseInt(thDesc.style.width);
    if (anchoFinal) localStorage.setItem(obtenerClaveStorageAnchoCol(), anchoFinal);
    window.removeEventListener("mousemove", alMoverMouse);
    window.removeEventListener("mouseup", alSoltarMouse);
  };

  resizer.onmousedown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    inicioX = e.clientX;
    anchoInicial = thDesc.offsetWidth;
    resizer.classList.add("is-resizing");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", alMoverMouse);
    window.addEventListener("mouseup", alSoltarMouse);
  };
}

export function actualizarBotonPlantillaDinamico() {
  const btn = document.getElementById("btn-accion-plantilla-dinamico");
  const ico = document.getElementById("ico-accion-plantilla");
  const txt = document.getElementById("txt-accion-plantilla");
  if (!btn || !ico) return;

  if (!state.proyectoEsGestor && state.currentUser.rol !== "ADMIN_TI") {
    btn.classList.add("hidden");
    return;
  }
  btn.classList.remove("hidden");

  const tieneActividades = state.actividadesGlobal && state.actividadesGlobal.length > 0;
  if (tieneActividades) {
    btn.className = "group h-[29px] px-2 bg-indigo-700 hover:bg-indigo-800 text-white rounded-lg transition-all duration-400 ease-[cubic-bezier(0.4,0,0.2,1)] shadow-xs flex items-center justify-center flex-shrink-0 cursor-pointer overflow-hidden whitespace-nowrap";
    btn.title = "Guardar Plantilla";
    ico.innerText = "📥";
    if (txt) txt.innerText = "Guardar Plantilla";
  } else {
    btn.className = "group h-[29px] px-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition-all duration-400 ease-[cubic-bezier(0.4,0,0.2,1)] shadow-xs flex items-center justify-center flex-shrink-0 cursor-pointer overflow-hidden whitespace-nowrap animate-pulse";
    btn.title = "Importar Plantilla";
    ico.innerText = "📂";
    if (txt) txt.innerText = "Importar Plantilla";
  }
}

export function gestionarAccionPlantillaDinamica() {
  const tieneActividades = state.actividadesGlobal && state.actividadesGlobal.length > 0;
  if (tieneActividades) {
    abrirModalGuardarPlantilla();
  } else {
    abrirModalImportarPlantillaProyecto();
  }
}

// --- GESTIÓN DE COLUMNAS VISIBLES ---
export function abrirModalColumnas() {
  sincronizarCheckboxesColumnas();
  document.getElementById("modal-columnas")?.classList.remove("hidden");
}

export function cerrarModalColumnas() {
  document.getElementById("modal-columnas")?.classList.add("hidden");
}

export function sincronizarCheckboxesColumnas() {
  document.getElementById("col-chk-responsable").checked = state.visibilidadColumnas.responsable;
  document.getElementById("col-chk-estado").checked = state.visibilidadColumnas.estado;
  document.getElementById("col-chk-inicio").checked = state.visibilidadColumnas.inicio;
  document.getElementById("col-chk-fin").checked = state.visibilidadColumnas.fin;
  document.getElementById("col-chk-dias").checked = state.visibilidadColumnas.dias;
  document.getElementById("col-chk-avance").checked = state.visibilidadColumnas.avance;
  document.getElementById("col-chk-gantt").checked = state.visibilidadColumnas.gantt;

  const chkAv = document.getElementById("col-chk-avatares-gantt");
  if (chkAv) chkAv.checked = state.visibilidadColumnas.avatares_gantt !== false;

  const chkPct = document.getElementById("col-chk-porcentajes-gantt");
  if (chkPct) chkPct.checked = state.visibilidadColumnas.porcentajes_gantt !== false;
}

export function alternarColumna(colKey, estado) {
  state.visibilidadColumnas[colKey] = estado;
  localStorage.setItem("visibilidad_columnas", JSON.stringify(state.visibilidadColumnas));
  aplicarVisibilidadColumnas();
  renderizarTabla();
}

export function restablecerColumnas() {
  state.visibilidadColumnas = { responsable: true, estado: true, inicio: true, fin: true, dias: true, avance: true, gantt: true, avatares_gantt: true, porcentajes_gantt: true };
  localStorage.setItem("visibilidad_columnas", JSON.stringify(state.visibilidadColumnas));
  sincronizarCheckboxesColumnas();
  aplicarVisibilidadColumnas();
  renderizarTabla();
}

export function aplicarVisibilidadColumnas() {
  const setCol = (id, visible) => {
    const el = document.getElementById(id);
    if (el) {
      if (visible) el.classList.remove("hidden");
      else el.classList.add("hidden");
    }
  };
  setCol("th-responsable", state.visibilidadColumnas.responsable);
  setCol("th-estado", state.visibilidadColumnas.estado);
  setCol("th-inicio", state.visibilidadColumnas.inicio);
  setCol("th-fin", state.visibilidadColumnas.fin);
  setCol("th-dias", state.visibilidadColumnas.dias);
  setCol("th-avance", state.visibilidadColumnas.avance);
  setCol("th-gantt", state.visibilidadColumnas.gantt);
}