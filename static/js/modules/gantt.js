import { state } from "../core/state.js";
import { apiFetch } from "../core/api.js";
import {
  notificarToast,
  confirmModal,
  formatearFechaLatina,
  formatearFechaISO,
  parsearFechaUniversal,
  abrirInputCustom
} from "../core/ui-dialogs.js";
import { actualizarDisplaysUsuario } from "./auth.js";
import { cargarHubProyectos } from "./hub.js";

// =========================================================================
// INGRESO AL PROYECTO Y NAVEGACIÓN
// =========================================================================

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
    if (state.responsablesGlobal.length === 0) {
      try {
        const resResp = await apiFetch(`/responsables`);
        if (resResp.ok) state.responsablesGlobal = await resResp.json();
      } catch (e) {}
    }

    const resActs = await apiFetch(`/proyectos/${id}/actividades`);
    if (resActs.ok) {
      const freshActs = await resActs.json();
      state.actividadesGlobal = (freshActs || []).sort((a, b) => compararCodigosWBS(a.codigo, b.codigo));
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

// =========================================================================
// COMPARADOR WBS NATURAL Y ROLL-UP JERÁRQUICO
// =========================================================================

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

  state.actividadesGlobal.forEach(a => {
    a.codigo = String(a.codigo).replace(/\.+$/, "");
  });

  state.actividadesGlobal.sort((a, b) => compararCodigosWBS(a.codigo, b.codigo));

  const niveles = [4, 3, 2, 1];

  niveles.forEach(nivelActual => {
    state.actividadesGlobal.forEach(madre => {
      const codLimpio = madre.codigo;
      const partes = codLimpio.split(".");
      const nivelMadre = partes.length;

      if (nivelMadre === nivelActual) {
        const hijosDirectos = state.actividadesGlobal.filter(h => {
          const c = h.codigo;
          return c.startsWith(codLimpio + ".") && c.split(".").length === nivelMadre + 1;
        });

        if (hijosDirectos.length > 0) {
          const sumaAvances = hijosDirectos.reduce((acc, h) => acc + (parseInt(h.avance) || 0), 0);
          const promAvance = Math.round(sumaAvances / hijosDirectos.length);
          madre.avance = promAvance;

          if (promAvance === 100) {
            madre.estado = "Ejecutado";
          } else if (promAvance > 0) {
            madre.estado = "En proceso";
          } else {
            madre.estado = "No iniciado";
          }

          let minIni = null;
          let maxFin = null;

          hijosDirectos.forEach(h => {
            const dtIni = parsearFechaUniversal(h.fecha_inicio);
            const dtFin = parsearFechaUniversal(h.fecha_fin);

            if (dtIni && (!minIni || dtIni < minIni)) minIni = dtIni;
            if (dtFin && (!maxFin || dtFin > maxFin)) maxFin = dtFin;
          });

          if (minIni && maxFin) {
            const dIni = String(minIni.getDate()).padStart(2, '0');
            const mIni = String(minIni.getMonth() + 1).padStart(2, '0');
            const yIni = minIni.getFullYear();
            madre.fecha_inicio = `${dIni}/${mIni}/${yIni}`;

            const dFin = String(maxFin.getDate()).padStart(2, '0');
            const mFin = String(maxFin.getMonth() + 1).padStart(2, '0');
            const yFin = maxFin.getFullYear();
            madre.fecha_fin = `${dFin}/${mFin}/${yFin}`;

            if (state.proyectoModoDuracion === "hours") {
              const totalHorasHijas = hijosDirectos.reduce((acc, h) => acc + (parseInt(h.dias) || 0), 0);
              madre.dias = Math.max(1, totalHorasHijas);
            } else {
              const diffDias = Math.floor((maxFin - minIni) / (1000 * 60 * 60 * 24)) + 1;
              madre.dias = Math.max(1, diffDias);
            }
          }
        }
      }
    });
  });
}

// =========================================================================
// RENDERIZADO VISUAL DEL GANTT Y TABLA WBS (IDENTICO AL ORIGINAL)
// =========================================================================

export function renderizarTabla() {
  recalcularJerarquiaWBS();
  const tbody = document.getElementById("lista-actividades");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!state.actividadesGlobal || state.actividadesGlobal.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="p-8 text-center text-gray-400 font-bold">No hay actividades creadas en este proyecto. Utilice el botón "+ Actividad" para comenzar.</td></tr>`;
    actualizarKPIs();
    actualizarBotonPlantillaDinamico();
    return;
  }

  const txtBusqueda = (document.getElementById("filtro-busqueda")?.value || "").toLowerCase().trim();
  const respFiltro = document.getElementById("filtro-responsable-select")?.value || "";

  const mostrarAvatares = (state.visibilidadColumnas.avatares_gantt !== false);
  const mostrarPorcentajes = (state.visibilidadColumnas.porcentajes_gantt !== false);

  let tInicioVisible, tFinVisible, duracionVisibleMs, divisionesHTML = "";
  const mesHoy = new Date().getMonth();
  const anioHoy = new Date().getFullYear();

  if (state.modoZoom === "dias") {
    const ventanaDias = 28;
    const offset = Math.max(0, Math.min(state.diasTotalesAnio.length - ventanaDias, state.semanaInicioIndex * 7));
    const diasVisibles = state.diasTotalesAnio.slice(offset, offset + ventanaDias);
    if (diasVisibles.length === 0) return;

    tInicioVisible = diasVisibles[0].fecha.getTime();
    const ultDia = diasVisibles[diasVisibles.length - 1].fecha;
    tFinVisible = new Date(ultDia.getFullYear(), ultDia.getMonth(), ultDia.getDate(), 23, 59, 59).getTime();
    duracionVisibleMs = tFinVisible - tInicioVisible;

    divisionesHTML = diasVisibles.map(d => {
      const esFin = (d.diaSemana === 0 || d.diaSemana === 6);
      const colHoy = d.esHoy ? "bg-teal-500/10" : (esFin ? "bg-slate-100/60" : "");
      return `<div class="flex-1 border-r border-slate-200/40 ${colHoy}"></div>`;
    }).join("");

  } else if (state.modoZoom === "meses") {
    const mesesTotales = [];
    let curM = new Date(state.diasTotalesAnio[0].fecha);
    curM.setDate(1);
    const ultFecha = state.diasTotalesAnio[state.diasTotalesAnio.length - 1].fecha;

    while (curM <= ultFecha) {
      mesesTotales.push({
        mesIdx: curM.getMonth(),
        mesNombre: state.nombresMeses[curM.getMonth()],
        anio: curM.getFullYear(),
        fecha: new Date(curM)
      });
      curM.setMonth(curM.getMonth() + 1);
    }

    const ventanaMeses = 12;
    const offsetM = Math.max(0, Math.min(mesesTotales.length - ventanaMeses, Math.floor(state.semanaInicioIndex / 4.33)));
    const mesesVisibles = mesesTotales.slice(offsetM, offsetM + ventanaMeses);
    if (mesesVisibles.length === 0) return;

    tInicioVisible = mesesVisibles[0].fecha.getTime();
    const ultMesObj = new Date(mesesVisibles[mesesVisibles.length - 1].fecha);
    ultMesObj.setMonth(ultMesObj.getMonth() + 1);
    ultMesObj.setDate(0);
    ultMesObj.setHours(23, 59, 59, 999);
    tFinVisible = ultMesObj.getTime();
    duracionVisibleMs = tFinVisible - tInicioVisible;

    divisionesHTML = mesesVisibles.map(m => {
      const esHoy = (m.mesIdx === mesHoy && m.anio === anioHoy);
      const colHoy = esHoy ? "col-semana-actual" : "";
      return `<div class="flex-1 border-r border-slate-200/50 ${colHoy}"></div>`;
    }).join("");

  } else {
    const ventanaSemanas = 16;
    const offsetSem = Math.max(0, Math.min(state.semanasTotales.length - ventanaSemanas, state.semanaInicioIndex));
    const semanasVisibles = state.semanasTotales.slice(offsetSem, offsetSem + ventanaSemanas);
    if (semanasVisibles.length === 0) return;

    tInicioVisible = semanasVisibles[0].fechaLunes.getTime();
    tFinVisible = new Date(semanasVisibles[semanasVisibles.length - 1].fechaDomingo).getTime();
    duracionVisibleMs = tFinVisible - tInicioVisible;

    divisionesHTML = semanasVisibles.map(s => {
      const claseColHoy = s.esHoy ? "col-semana-actual" : "";
      return `<div class="flex-1 border-r border-slate-200/50 ${claseColHoy}"></div>`;
    }).join("");
  }

  state.actividadesGlobal.forEach(act => {
    act.codigo = String(act.codigo).replace(/\.+$/, "");
    const partes = act.codigo.split(".");
    const nivel = partes.length;
    const codLimpio = act.codigo;

    if (state.nivelFiltroActivo < 4 && nivel !== state.nivelFiltroActivo) return;
    if (state.nivelFiltroActivo === 4 && nivel > 4) return;
    if (estaOcultoPorPadre(act.codigo)) return;

    if (txtBusqueda && !act.descripcion.toLowerCase().includes(txtBusqueda) && !act.codigo.toLowerCase().includes(txtBusqueda)) return;
    if (respFiltro && !(act.responsable || "").includes(respFiltro)) return;

    const esNivel1 = (nivel === 1);
    const esMadre = tieneHijos(act.codigo);
    const estaColapsado = state.nodosColapsados.has(codLimpio);
    const estaSeleccionada = (state.codigoFilaSeleccionada === act.codigo);

    const dtIniObj = parsearFechaUniversal(act.fecha_inicio);
    const dtFinObj = parsearFechaUniversal(act.fecha_fin);

    const fechaIniVisual = formatearFechaLatina(act.fecha_inicio);
    const fechaFinVisual = formatearFechaLatina(act.fecha_fin);

    const tr = document.createElement("tr");
    tr.id = `fila-act-${act.codigo.replace(/\./g, '_')}`;
    tr.className = `${esNivel1 ? "tree-row-l1" : (nivel === 4 ? "tree-row-l4 hover:bg-gray-50" : "hover:bg-gray-50")} ${estaSeleccionada ? 'row-selected' : ''}`;
    
    tr.onclick = () => seleccionarFila(act.codigo);
    tr.oncontextmenu = (e) => abrirMenuContextual(e, act.codigo);

    if (state.proyectoEsGestor) {
      tr.draggable = true;
      tr.ondragstart = (e) => iniciarArrastreFila(e, act.codigo);
      tr.ondragover = (e) => sobrevolarFilaArrastre(e, tr);
      tr.ondragleave = () => limpiarBordeArrastre(tr);
      tr.ondrop = (e) => soltarFilaArrastre(e, act.codigo, tr);
      tr.ondragend = () => finalizarArrastre();
    }

    let iconoColapso = "";
    if (esMadre) {
      iconoColapso = `<button onclick="event.stopPropagation(); alternarColapsoNodo('${act.codigo}')" class="text-[10px] font-black text-[#0f2a4a] mr-1.5 w-4 h-4 rounded hover:bg-blue-200 transition">${estaColapsado ? '▶' : '▼'}</button>`;
    } else {
      iconoColapso = `<span class="inline-block w-4 mr-1.5"></span>`;
    }

    let ganttHTML = `
      <div class="relative w-full h-7 bg-[#f8fafc] rounded border border-slate-200/80 overflow-hidden">
        <div class="absolute inset-0 flex pointer-events-none opacity-60">${divisionesHTML}</div>
      </div>
    `;

    if (dtIniObj && dtFinObj) {
      try {
        const dtIni = dtIniObj.getTime();
        const dtFin = new Date(dtFinObj.getFullYear(), dtFinObj.getMonth(), dtFinObj.getDate(), 23, 59, 59).getTime();

        if (dtFin >= tInicioVisible && dtIni <= tFinVisible) {
          const startClamped = Math.max(dtIni, tInicioVisible);
          const endClamped = Math.min(dtFin, tFinVisible);

          const leftPct = Math.min(100, Math.max(0, ((startClamped - tInicioVisible) / duracionVisibleMs) * 100));
          const widthPct = Math.min(100 - leftPct, Math.max(1.2, ((endClamped - startClamped) / duracionVisibleMs) * 100));

          let barraOElementoHTML = "";
          const miniAvataresHTML = mostrarAvatares ? obtenerMiniAvataresGanttHTML(act.responsable) : '';
          const esBarraDelgada = widthPct < 5.0;

          if (esMadre) {
            barraOElementoHTML = `
              <div class="absolute top-1.5 bottom-1.5 z-10 transition-all duration-200 pointer-events-none" style="left: ${leftPct}%; width: ${widthPct}%;">
                <div class="w-full h-full bg-[#0f2a4a] rounded-sm shadow relative">
                  <div class="absolute left-0 -bottom-1 w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[5px] border-t-[#0f2a4a]"></div>
                  <div class="absolute right-0 -bottom-1 w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[5px] border-t-[#0f2a4a]"></div>
                  ${mostrarPorcentajes && !esBarraDelgada ? `<div class="absolute inset-0 flex items-center justify-center text-[9px] font-black text-white px-1 overflow-hidden whitespace-nowrap drop-shadow-xs">${act.avance}%</div>` : ''}
                </div>
              </div>
              <div class="absolute flex items-center top-1 z-20 pointer-events-none text-[9px] font-black text-[#0f2a4a]" style="left: calc(${leftPct + widthPct}% + 4px);">
                ${mostrarPorcentajes && esBarraDelgada ? `<span class="bg-blue-50 px-1 rounded border border-blue-200 mr-1 shadow-xs">${act.avance}%</span>` : ''}
                ${miniAvataresHTML}
              </div>
            `;
          } else {
            let colorFondoRestante = "#e2e8f0";
            let colorBorde = "border-slate-300";
            const esActividadCritica = state.capaCpmActiva && state.datosCpmGlobal.actividadesCriticas.has(codLimpio);

            if (state.capaCpmActiva) {
              colorFondoRestante = esActividadCritica ? "#dc2626" : "#cbd5e1";
              colorBorde = esActividadCritica ? "border-red-800" : "border-slate-300";
            } else {
              if (act.estado === "Ejecutado") {
                colorFondoRestante = "#2ecc71";
                colorBorde = "border-emerald-600";
              } else if (act.estado === "En proceso") {
                colorFondoRestante = "#f1c40f";
                colorBorde = "border-amber-500";
              } else {
                colorFondoRestante = "#e2e8f0";
                colorBorde = "border-slate-300";
              }
            }

            let subAvanceHTML = "";
            let textoDentroDeBarra = "";
            let textoFlotanteHTML = "";

            if (mostrarPorcentajes && !state.capaCpmActiva) {
              if (act.estado === "En proceso") {
                if (act.avance > 0) {
                  subAvanceHTML = `<div class="absolute top-0 bottom-0 left-0 bg-[#d35400] rounded-l-md flex items-center justify-center text-[9px] font-black text-white shadow-inner" style="width: ${act.avance}%;"></div>`;
                }
                if (!esBarraDelgada && widthPct >= 7.0) {
                  textoDentroDeBarra = `<div class="absolute inset-0 flex items-center justify-center text-[9px] font-black text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] z-10 pointer-events-none">${act.avance}%</div>`;
                } else {
                  textoFlotanteHTML = `<span class="text-[9px] font-bold text-gray-700 bg-white/90 px-1 rounded border border-gray-200 shadow-xs mr-1">${act.avance}%</span>`;
                }
              } else if (act.estado === "Ejecutado") {
                if (!esBarraDelgada) {
                  textoDentroDeBarra = `<div class="w-full h-full flex items-center justify-center text-[9px] font-black text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">100%</div>`;
                } else {
                  textoFlotanteHTML = `<span class="text-[9px] font-bold text-gray-700 bg-white/90 px-1 rounded border border-gray-200 shadow-xs mr-1">100%</span>`;
                }
              } else {
                textoFlotanteHTML = `<span class="text-[9px] font-bold text-gray-700 bg-white/90 px-1 rounded border border-gray-200 shadow-xs mr-1">0%</span>`;
              }
            }

            const opacidadCpm = (state.capaCpmActiva && !esActividadCritica && !esMadre) ? "opacity-35" : "opacity-100";

            barraOElementoHTML = `
              <div class="absolute bg-slate-300/70 rounded h-[2px] bottom-0.5" style="left: ${leftPct}%; width: ${widthPct}%;"></div>
              <div class="absolute top-1 bottom-1 z-10 rounded-md border ${colorBorde} shadow-sm transition-all duration-200 overflow-hidden ${opacidadCpm}" 
                   style="left: ${leftPct}%; width: ${widthPct}%; background-color: ${colorFondoRestante};">
                ${!state.capaCpmActiva ? subAvanceHTML : ''}
                ${!state.capaCpmActiva ? textoDentroDeBarra : ''}
              </div>
              <div class="absolute flex items-center top-1 z-20 pointer-events-none ${opacidadCpm}" style="left: calc(${leftPct + widthPct}% + 4px);">
                ${!state.capaCpmActiva ? textoFlotanteHTML : ''}
                ${miniAvataresHTML}
              </div>
            `;
          }

          ganttHTML = `
            <div class="relative w-full h-7 bg-[#f8fafc] rounded border border-slate-200/80 overflow-hidden">
              <div class="absolute inset-0 flex pointer-events-none opacity-60">${divisionesHTML}</div>
              ${barraOElementoHTML}
            </div>
          `;
        }
      } catch(e) {}
    }

    const paddingLeft = (nivel - 1) * 16 + 8;
    const cod = act.codigo;
    const esMio = esResponsableDeActividad(act);
    const puedeEditarTiempos = state.proyectoEsGestor && !esMadre;
    const puedeEditarAvance = (state.proyectoEsGestor || esMio) && !esMadre;

    const claseEditable = "cell-editable cursor-pointer";
    const claseBloqueada = "bg-slate-50/80 text-slate-500 cursor-not-allowed select-none";
    const lockIcon = `
      <svg class="inline-block w-2.5 h-2.5 text-slate-400 opacity-60 ml-1 -mt-0.5 align-middle select-none" viewBox="0 0 20 20" fill="currentColor" title="Autocalculado por subtareas">
        <path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd" />
      </svg>
    `;

    const tdResp = state.visibilidadColumnas.responsable 
      ? `<td class="p-2 border-r border-b border-gray-200 text-center whitespace-nowrap ${state.proyectoEsGestor ? 'cell-editable cursor-pointer' : ''}" ondblclick="${state.proyectoEsGestor ? `editarResponsable('${cod}')` : ''}" title="${state.proyectoEsGestor ? 'Doble clic para asignar responsables' : ''}">${obtenerAvatarHTML(act.responsable)}</td>` 
      : '';

    let tdEst = '';
    if (state.visibilidadColumnas.estado) {
      if (esMadre) {
        tdEst = `<td class="p-2.5 border-r border-b border-gray-200 ${claseBloqueada} whitespace-nowrap">
          <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${act.estado === 'Ejecutado' ? 'bg-green-100 text-green-800' : (act.estado === 'En proceso' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-200 text-gray-700')}">${act.estado} ${lockIcon}</span>
        </td>`;
      } else {
        tdEst = `<td class="p-2.5 border-r border-b border-gray-200 ${puedeEditarAvance ? claseEditable : ''} whitespace-nowrap" ondblclick="${puedeEditarAvance ? `editarEstado('${cod}')` : ''}">
          <span class="px-2 py-0.5 rounded text-[11px] font-bold ${act.estado === 'Ejecutado' ? 'bg-green-100 text-green-800' : (act.estado === 'En proceso' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-200 text-gray-700')}">${act.estado}</span>
        </td>`;
      }
    }

    let tdIni = '';
    if (state.visibilidadColumnas.inicio) {
      if (esMadre) {
        tdIni = `<td class="p-2.5 border-r border-b border-gray-200 hidden sm:table-cell text-xs ${claseBloqueada} whitespace-nowrap font-medium">${fechaIniVisual} ${lockIcon}</td>`;
      } else {
        tdIni = `<td class="p-2.5 border-r border-b border-gray-200 hidden sm:table-cell text-xs ${puedeEditarTiempos ? claseEditable : ''} whitespace-nowrap font-medium" ondblclick="${puedeEditarTiempos ? `editarFechaInicio('${cod}')` : ''}">${fechaIniVisual}</td>`;
      }
    }

    const hoyMs = new Date().setHours(0, 0, 0, 0);
    const finMs = dtFinObj ? dtFinObj.getTime() : null;
    const estaVencida = (finMs !== null && finMs < hoyMs && act.estado !== "Ejecutado");
    const claseFechaVencida = estaVencida ? "bg-rose-100/70 text-rose-800 font-bold border-rose-200" : "";
    const badgeVencidoHTML = estaVencida ? `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-black ${claseFechaVencida}" title="¡Plazo vencido!">${fechaFinVisual}</span>` : fechaFinVisual;

    let tdFin = '';
    if (state.visibilidadColumnas.fin) {
      const esModoHoras = (state.proyectoModoDuracion === "hours");
      if (esMadre) {
        tdFin = `<td class="p-2.5 border-r border-b border-gray-200 hidden sm:table-cell text-xs ${claseBloqueada} whitespace-nowrap font-medium">${badgeVencidoHTML} ${lockIcon}</td>`;
      } else if (esModoHoras) {
        tdFin = `<td class="p-2.5 border-r border-b border-gray-200 hidden sm:table-cell text-xs cursor-not-allowed select-none whitespace-nowrap font-medium">${badgeVencidoHTML} ${lockIcon}</td>`;
      } else {
        tdFin = `<td class="p-2.5 border-r border-b border-gray-200 hidden sm:table-cell text-xs ${puedeEditarTiempos ? claseEditable : ''} whitespace-nowrap font-medium" ondblclick="${puedeEditarTiempos ? `editarFechaFin('${cod}')` : ''}">${badgeVencidoHTML}</td>`;
      }
    }

    const unidadTexto = (state.proyectoModoDuracion === "hours") ? "h" : "d";
    let tdDias = '';
    if (state.visibilidadColumnas.dias) {
      if (esMadre) {
        tdDias = `<td class="p-2.5 border-r border-b border-gray-200 text-center font-bold text-xs ${claseBloqueada} whitespace-nowrap">${act.dias}${unidadTexto} ${lockIcon}</td>`;
      } else {
        tdDias = `<td class="p-2.5 border-r border-b border-gray-200 text-center font-bold text-xs ${puedeEditarTiempos ? claseEditable : ''} whitespace-nowrap" ondblclick="${puedeEditarTiempos ? `editarDias('${cod}')` : ''}">${act.dias}${unidadTexto}</td>`;
      }
    }

    let tdAvance = '';
    if (state.visibilidadColumnas.avance) {
      if (esMadre) {
        tdAvance = `<td class="p-2.5 border-r border-b border-gray-200 text-center font-bold text-xs ${claseBloqueada} whitespace-nowrap">${act.avance}% ${lockIcon}</td>`;
      } else {
        tdAvance = `<td class="p-2.5 border-r border-b border-gray-200 text-center font-bold text-xs ${puedeEditarAvance ? claseEditable : ''} whitespace-nowrap" ondblclick="${puedeEditarAvance ? `editarAvance('${cod}')` : ''}">${act.avance}%</td>`;
      }
    }

    const tdGantt = state.visibilidadColumnas.gantt ? `<td class="p-1 border-r border-b border-gray-200">${ganttHTML}</td>` : '';
    const descTextoLimpio = String(act.descripcion || "").replace(/"/g, '&quot;');
    const handleDrag = state.proyectoEsGestor ? `<span class="drag-handle text-slate-400 hover:text-slate-800 cursor-grab active:cursor-grabbing mr-2 text-xs select-none inline-block align-middle" title="Arrastrar fila para reubicar">⠿</span>` : '';

    tr.innerHTML = `
      <td class="p-2.5 font-mono font-bold text-xs border-r border-b border-gray-200 whitespace-nowrap">
        <div class="inline-flex items-center">
          ${handleDrag}${iconoColapso}<span>${cod}</span>
        </div>
      </td>
      <td class="p-2 border-r border-b border-gray-200 ${state.proyectoEsGestor ? 'cell-editable cursor-pointer' : ''} group align-middle" 
          style="padding-left: ${paddingLeft}px;" 
          ondblclick="${state.proyectoEsGestor ? `editarDescripcion('${cod}')` : ''}" 
          title="${descTextoLimpio}">
        <span class="text-xs leading-snug break-words text-gray-800 select-text">${act.descripcion}</span>
      </td>
      ${tdResp}
      ${tdEst}
      ${tdIni}
      ${tdFin}
      ${tdDias}
      ${tdAvance}
      ${tdGantt}
      <td class="p-2 text-center border-b border-gray-200 space-x-1 whitespace-nowrap">
        ${state.proyectoEsGestor && nivel < 4 ? `<button onclick="event.stopPropagation(); abrirWizardCreacion('${cod}', 'hijo')" class="text-blue-600 hover:text-blue-800 font-bold px-1 text-sm" title="Agregar subtarea">+</button>` : ''}
        ${state.proyectoEsGestor ? `<button onclick="event.stopPropagation(); eliminarActividad('${cod}')" class="text-red-500 hover:text-red-700 font-bold px-1" title="Eliminar">🗑️</button>` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });

  actualizarKPIs();
  actualizarBotonPlantillaDinamico();
}

// =========================================================================
// AVATARES, KPIS Y CALENDARIO GANTT
// =========================================================================

export function obtenerListaResponsablesAsignados(responsablesStr) {
  if (!responsablesStr || responsablesStr === "No asignado" || responsablesStr === "-" || String(responsablesStr).trim() === "") return [];
  const str = String(responsablesStr).trim();
  if (str.includes(";")) return str.split(";").map(s => s.trim()).filter(Boolean);
  return [str];
}

export function obtenerAvatarHTML(responsablesStr) {
  const listaNombres = obtenerListaResponsablesAsignados(responsablesStr);
  if (listaNombres.length === 0) {
    return `<div class="w-6 h-6 rounded-full bg-gray-300 text-gray-600 flex items-center justify-center text-[10px] font-bold mx-auto" title="Sin responsable asignado">?</div>`;
  }

  let avataresHTML = "";
  const maxMostrar = 2;
  const mostrar = listaNombres.slice(0, maxMostrar);
  const restantes = listaNombres.length - maxMostrar;

  mostrar.forEach(nom => {
    let iniciales = "";
    if (nom.includes(",")) {
      const partes = nom.split(",");
      const apellido = partes[0].trim().split(" ")[0];
      const nombre = partes[1] ? partes[1].trim().split(" ")[0] : "";
      iniciales = (apellido[0] + (nombre ? nombre[0] : "")).toUpperCase();
    } else {
      const partes = nom.split(" ");
      iniciales = (partes[0][0] + (partes[1] ? partes[1][0] : "")).toUpperCase();
    }

    let hash = 0;
    for (let i = 0; i < nom.length; i++) hash = nom.charCodeAt(i) + ((hash << 5) - hash);
    const colorBg = state.coloresAvatar[Math.abs(hash) % state.coloresAvatar.length];

    avataresHTML += `<div class="avatar-circle" style="background-color: ${colorBg};">${iniciales}</div>`;
  });

  if (restantes > 0) {
    avataresHTML += `<div class="avatar-circle bg-gray-600 text-[9px] font-black">+${restantes}</div>`;
  }

  return `<div class="avatar-group cursor-pointer">${avataresHTML}</div>`;
}

export function obtenerMiniAvataresGanttHTML(responsablesStr) {
  const listaNombres = obtenerListaResponsablesAsignados(responsablesStr);
  if (listaNombres.length === 0) return "";

  let avataresHTML = "";
  const maxMostrar = 2;
  const mostrar = listaNombres.slice(0, maxMostrar);
  const restantes = listaNombres.length - maxMostrar;

  mostrar.forEach(nom => {
    let iniciales = "";
    if (nom.includes(",")) {
      const partes = nom.split(",");
      const apellido = partes[0].trim().split(" ")[0];
      const nombre = partes[1] ? partes[1].trim().split(" ")[0] : "";
      iniciales = (apellido[0] + (nombre ? nombre[0] : "")).toUpperCase();
    } else {
      const partes = nom.split(" ");
      iniciales = (partes[0][0] + (partes[1] ? partes[1][0] : "")).toUpperCase();
    }

    let hash = 0;
    for (let i = 0; i < nom.length; i++) hash = nom.charCodeAt(i) + ((hash << 5) - hash);
    const colorBg = state.coloresAvatar[Math.abs(hash) % state.coloresAvatar.length];

    avataresHTML += `<div class="gantt-avatar-circle" style="background-color: ${colorBg};">${iniciales}</div>`;
  });

  if (restantes > 0) {
    avataresHTML += `<div class="gantt-avatar-circle bg-gray-700 text-[7px] font-black">+${restantes}</div>`;
  }

  return `<div class="inline-flex items-center ml-1.5 align-middle select-none">${avataresHTML}</div>`;
}

export function construirCalendarioAnual() {
  const anioActual = new Date().getFullYear();
  let minAnio = anioActual, maxAnio = anioActual;

  if (state.actividadesGlobal && state.actividadesGlobal.length > 0) {
    state.actividadesGlobal.forEach(a => {
      const dtIni = parsearFechaUniversal(a.fecha_inicio);
      const dtFin = parsearFechaUniversal(a.fecha_fin);
      if (dtIni) minAnio = Math.min(minAnio, dtIni.getFullYear());
      if (dtFin) maxAnio = Math.max(maxAnio, dtFin.getFullYear());
    });
  }

  state.diasTotalesAnio = [];
  state.semanasTotales = [];

  let currDia = new Date(minAnio, 0, 1);
  const finCalendario = new Date(maxAnio, 11, 31);
  const ahora = new Date();
  ahora.setHours(0, 0, 0, 0);

  while (currDia <= finCalendario) {
    const dNum = currDia.getDate();
    const mIdx = currDia.getMonth();
    const yNum = currDia.getFullYear();
    const esHoy = (currDia.getTime() === ahora.getTime());

    state.diasTotalesAnio.push({
      fecha: new Date(currDia),
      dia: String(dNum).padStart(2, '0'),
      mes: mIdx,
      mesNombre: state.nombresMeses[mIdx],
      anio: yNum,
      diaSemana: currDia.getDay(),
      esHoy: esHoy
    });
    currDia.setDate(currDia.getDate() + 1);
  }

  let currSem = new Date(minAnio, 0, 1);
  while (currSem.getDay() !== 1) currSem.setDate(currSem.getDate() - 1);
  let nroSemGlobal = 1;

  while (currSem <= finCalendario || currSem.getFullYear() <= maxAnio) {
    const dLunes = currSem.getDate();
    const mIndex = currSem.getMonth();
    const yIndex = currSem.getFullYear();
    const fechaIniSem = new Date(currSem);
    const fechaFinSem = new Date(currSem.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
    const esSemanaActual = (ahora >= fechaIniSem && ahora <= fechaFinSem);

    if (esSemanaActual) state.indiceSemanaHoy = nroSemGlobal - 1;

    state.semanasTotales.push({
      nro: nroSemGlobal,
      fechaLunes: fechaIniSem,
      fechaDomingo: fechaFinSem,
      dia: String(dLunes).padStart(2, '0'),
      mes: mIndex,
      mesNombre: state.nombresMeses[mIndex],
      anio: yIndex,
      esHoy: esSemanaActual
    });

    currSem.setDate(currSem.getDate() + 7);
    nroSemGlobal++;
    if (currSem > finCalendario && currSem.getDay() === 1) break;
  }
}

export function renderizarCabeceraGantt() {
  const divMeses = document.getElementById("gantt-header-meses");
  const divSemanas = document.getElementById("gantt-header-semanas");
  if (!divMeses || !divSemanas) return;

  divMeses.innerHTML = "";
  divSemanas.innerHTML = "";

  if (state.modoZoom === "dias") {
    const ventanaDias = 28;
    const offset = Math.max(0, Math.min(state.diasTotalesAnio.length - ventanaDias, state.semanaInicioIndex * 7));
    const diasVisibles = state.diasTotalesAnio.slice(offset, offset + ventanaDias);

    const gruposMes = [];
    let mesActual = null, mesNombreSolo = null, anioSolo = null, contador = 0;

    diasVisibles.forEach(d => {
      const label = `${d.mesNombre} ${d.anio}`;
      if (mesActual === null || mesActual !== label) {
        if (mesActual !== null) gruposMes.push({ nombreCompleto: mesActual, mes: mesNombreSolo, anio: anioSolo, count: contador });
        mesActual = label;
        mesNombreSolo = d.mesNombre;
        anioSolo = d.anio;
        contador = 1;
      } else contador++;
    });
    if (mesActual !== null) gruposMes.push({ nombreCompleto: mesActual, mes: mesNombreSolo, anio: anioSolo, count: contador });

    gruposMes.forEach(g => {
      const pct = (g.count / diasVisibles.length) * 100;
      divMeses.innerHTML += `<div style="width: ${pct}%;" class="text-center font-black border-r border-[#1c335a] text-[10px] tracking-wide text-teal-200 overflow-hidden whitespace-nowrap truncate px-0.5">${g.nombreCompleto}</div>`;
    });

    diasVisibles.forEach(d => {
      const esFinSemana = (d.diaSemana === 0 || d.diaSemana === 6);
      const claseHoy = d.esHoy ? "bg-teal-500 text-white font-black rounded-xs shadow" : (esFinSemana ? "text-gray-400 bg-blue-950/40" : "text-teal-300 opacity-90");
      divSemanas.innerHTML += `<div class="flex-1 text-center py-0.5 border-r border-[#1c335a] text-[9px] font-mono overflow-hidden whitespace-nowrap ${claseHoy}">${d.dia}</div>`;
    });
    return;
  }

  const ventanaSemanas = 16;
  const offsetSem = Math.max(0, Math.min(state.semanasTotales.length - ventanaSemanas, state.semanaInicioIndex));
  const semanasVisibles = state.semanasTotales.slice(offsetSem, offsetSem + ventanaSemanas);

  const gruposMes = [];
  let mesActual = null, mesSolo = null, anioSolo = null, contador = 0;

  semanasVisibles.forEach(s => {
    const label = `${s.mesNombre} ${s.anio}`;
    if (mesActual === null || mesActual !== label) {
      if (mesActual !== null) gruposMes.push({ nombreCompleto: mesActual, mes: mesSolo, anio: anioSolo, count: contador });
      mesActual = label;
      mesSolo = s.mesNombre;
      anioSolo = s.anio;
      contador = 1;
    } else contador++;
  });
  if (mesActual !== null) gruposMes.push({ nombreCompleto: mesActual, mes: mesSolo, anio: anioSolo, count: contador });

  gruposMes.forEach(g => {
    const pct = (g.count / semanasVisibles.length) * 100;
    divMeses.innerHTML += `<div style="width: ${pct}%;" class="text-center font-bold border-r border-[#1c335a] text-[10px] overflow-hidden whitespace-nowrap truncate px-0.5">${g.nombreCompleto}</div>`;
  });

  semanasVisibles.forEach(s => {
    const claseHoy = s.esHoy ? "header-semana-actual rounded-sm shadow" : "opacity-90";
    divSemanas.innerHTML += `<div class="flex-1 text-center py-0.5 border-r border-[#1c335a] text-[9px] font-mono overflow-hidden whitespace-nowrap ${claseHoy}">${s.dia}</div>`;
  });
}

export function autoAjustarSemanaInicio() {
  if (!state.actividadesGlobal || state.actividadesGlobal.length === 0) {
    irASemanaActual();
    return;
  }

  let minTimestamp = null;
  state.actividadesGlobal.forEach(a => {
    const dt = parsearFechaUniversal(a.fecha_inicio);
    if (dt) {
      const t = dt.getTime();
      if (minTimestamp === null || t < minTimestamp) minTimestamp = t;
    }
  });

  if (minTimestamp !== null && state.semanasTotales.length > 0) {
    let indexEncontrado = -1;
    for (let i = 0; i < state.semanasTotales.length; i++) {
      const tLunes = new Date(state.semanasTotales[i].fechaLunes).setHours(0, 0, 0, 0);
      const tDomingo = new Date(state.semanasTotales[i].fechaDomingo).setHours(23, 59, 59, 999);
      if (minTimestamp >= tLunes && minTimestamp <= tDomingo) {
        indexEncontrado = i;
        break;
      }
    }
    if (indexEncontrado >= 0) fijarSemanaInicio(Math.max(1, indexEncontrado));
    else fijarSemanaInicio(1);
  } else {
    irASemanaActual();
  }
}

export function irAInicioProyecto() {
  fijarSemanaInicio(1);
}

export function irASemanaActual() {
  const ahora = new Date().getTime();
  let indexHoy = state.semanasTotales.findIndex(s => {
    const tIni = new Date(s.fechaLunes).setHours(0, 0, 0, 0);
    const tFin = new Date(s.fechaDomingo).setHours(23, 59, 59, 999);
    return ahora >= tIni && ahora <= tFin;
  });
  fijarSemanaInicio(indexHoy >= 0 ? Math.max(1, indexHoy) : 1);
}

export function fijarSemanaInicio(val) {
  let num = parseInt(val);
  if (isNaN(num) || num < 1) num = 1;
  state.semanaInicioIndex = num - 1;
  const input = document.getElementById("input-semana-inicio");
  if (input) input.value = num;
  renderizarCabeceraGantt();
  renderizarTabla();
}

export function cambiarSemanaInicio(delta) {
  const input = document.getElementById("input-semana-inicio");
  let val = (parseInt(input?.value) || 1) + delta;
  if (val < 1) val = 1;
  fijarSemanaInicio(val);
}

export function fijarModoZoomDirecto(modo) {
  state.modoZoom = modo;
  const labelEscala = document.getElementById("txt-escala-activa-label");
  if (labelEscala) labelEscala.innerText = modo.charAt(0).toUpperCase() + modo.slice(1);
  renderizarCabeceraGantt();
  renderizarTabla();
}

export function poblarFiltroResponsablesDinamico() {
  const select = document.getElementById("filtro-responsable-select");
  if (!select) return;
  const prevVal = select.value;
  const setResponsables = new Set();

  (state.actividadesGlobal || []).forEach(act => {
    const respCampo = (act.responsable || "").trim();
    if (respCampo && respCampo !== "No asignado") {
      respCampo.split(/[;\n]+/).map(r => r.trim()).filter(Boolean).forEach(r => setResponsables.add(r));
    }
  });

  select.innerHTML = '<option value="">👤 Todo el Personal</option>';
  Array.from(setResponsables).sort().forEach(nombre => {
    select.innerHTML += `<option value="${nombre}">${nombre}</option>`;
  });
  if (prevVal && setResponsables.has(prevVal)) select.value = prevVal;
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
  const terminales = state.actividadesGlobal.filter(a => !tieneHijos(a.codigo));
  const muestra = terminales.length > 0 ? terminales : state.actividadesGlobal;

  const total = muestra.length;
  const sumaAvances = muestra.reduce((acc, a) => acc + (parseInt(a.avance) || 0), 0);
  const promAvance = total > 0 ? Math.round(sumaAvances / total) : 0;
  const ejecutadas = muestra.filter(a => a.estado === 'Ejecutado').length;
  const enProceso = muestra.filter(a => a.estado === 'En proceso').length;
  const noIniciadas = muestra.filter(a => a.estado === 'No iniciado' || a.estado === 'Pendiente').length;

  const formatearItemsTexto = (cant) => `${cant} ${cant === 1 ? 'Item' : 'Items'}`;

  document.getElementById("kpi-avance").innerText = `${promAvance}%`;
  document.getElementById("kpi-ejecutado").innerText = formatearItemsTexto(ejecutadas);
  document.getElementById("kpi-proceso").innerText = formatearItemsTexto(enProceso);
  document.getElementById("kpi-pendiente").innerText = formatearItemsTexto(noIniciadas);
}

export function filtrarNivelJerarquico(val) {
  state.nivelFiltroActivo = parseInt(val) || 4;
  const labelNivel = document.getElementById("txt-nivel-activo-label");
  if (labelNivel) labelNivel.innerText = val === "4" ? "Todo (N4)" : `Nivel ${val}`;
  renderizarTabla();
}

export function aplicarFiltrosGlobales() {
  renderizarTabla();
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
  notificarToast("Filtros restablecidos.", "info");
}

export function alternarColapsoNodo(cod) {
  const codLimpio = cod.replace(/\.$/, "");
  if (state.nodosColapsados.has(codLimpio)) state.nodosColapsados.delete(codLimpio);
  else state.nodosColapsados.add(codLimpio);
  renderizarTabla();
}

export function estaOcultoPorPadre(codigo) {
  const partes = codigo.replace(/\.$/, "").split(".");
  if (partes.length <= 1) return false;

  let acumulado = "";
  for (let i = 0; i < partes.length - 1; i++) {
    acumulado += (i === 0 ? "" : ".") + partes[i];
    if (state.nodosColapsados.has(acumulado)) return true;
  }
  return false;
}

export function seleccionarFila(cod) {
  state.codigoFilaSeleccionada = cod;
  document.querySelectorAll("#lista-actividades tr").forEach(tr => tr.classList.remove("row-selected"));
  document.getElementById(`fila-act-${cod.replace(/\./g, '_')}`)?.classList.add("row-selected");
}

export function esResponsableDeActividad(act) {
  if (!act || !act.responsable || !state.currentUser) return false;
  const respStr = String(act.responsable).toLowerCase();
  const uNom = String(state.currentUser.nombre_completo || "").toLowerCase().trim();
  const uUser = String(state.currentUser.username || "").toLowerCase().trim();
  return (uNom && respStr.includes(uNom)) || (uUser && respStr.includes(uUser));
}

// =========================================================================
// EDICIÓN DIRECTA EN CELDAS (INLINE)
// =========================================================================

export function editarDescripcion(cod) {
  if (!state.proyectoEsGestor) return;
  const act = state.actividadesGlobal.find(a => a.codigo === cod);
  abrirInputCustom({
    titulo: "Modificar Descripción",
    mensaje: "Ingrese la nueva descripción:",
    tipo: "text",
    valorActual: act.descripcion,
    onAceptar: async (nueva) => {
      if (nueva && nueva.trim() !== "") {
        act.descripcion = nueva.trim();
        await guardarCambioDirecto(act);
      }
    }
  });
}

export function editarEstado(cod) {
  if (tieneHijos(cod)) return;
  const act = state.actividadesGlobal.find(a => a.codigo === cod);
  abrirInputCustom({
    titulo: "Modificar Estado",
    mensaje: "Seleccione el estado:",
    tipo: "select",
    valorActual: act.estado,
    opciones: ["No iniciado", "En proceso", "Ejecutado"],
    onAceptar: async (nuevoEstado) => {
      if (nuevoEstado === "Ejecutado") {
        act.estado = "Ejecutado";
        act.avance = 100;
        await guardarCambioDirecto(act);
      } else if (nuevoEstado === "No iniciado") {
        act.estado = "No iniciado";
        act.avance = 0;
        await guardarCambioDirecto(act);
      } else if (nuevoEstado === "En proceso") {
        abrirInputCustom({
          titulo: "Porcentaje Requerido",
          mensaje: "Digite un valor (0 a 100):",
          tipo: "number",
          valorActual: act.avance > 0 ? act.avance : 50,
          onAceptar: async (pctStr) => {
            const pct = parseInt(pctStr);
            if (!isNaN(pct) && pct >= 0 && pct <= 100) {
              act.avance = pct;
              act.estado = (pct === 100) ? "Ejecutado" : (pct === 0 ? "No iniciado" : "En proceso");
              await guardarCambioDirecto(act);
            }
          }
        });
      }
    }
  });
}

export function editarFechaInicio(cod) {
  if (!state.proyectoEsGestor || tieneHijos(cod)) return;
  const act = state.actividadesGlobal.find(a => a.codigo === cod);
  document.getElementById("mfc-input-date").value = formatearFechaISO(act.fecha_inicio);

  document.getElementById("mfc-btn-guardar").onclick = async () => {
    const valISO = document.getElementById("mfc-input-date").value;
    if (valISO) {
      const dt = parsearFechaUniversal(valISO);
      if (dt) {
        act.fecha_inicio = formatearFechaLatina(valISO);
        dt.setDate(dt.getDate() + ((parseInt(act.dias) || 1) - 1));
        act.fecha_fin = `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
        document.getElementById("modal-fecha-custom")?.classList.add("hidden");
        await guardarCambioDirecto(act);
      }
    }
  };
  document.getElementById("modal-fecha-custom")?.classList.remove("hidden");
}

let modalActivoAct = null;
export function editarFechaFin(cod) {
  if (!state.proyectoEsGestor || tieneHijos(cod)) return;
  modalActivoAct = state.actividadesGlobal.find(a => a.codigo === cod);
  document.getElementById("mfi-input-fin").value = formatearFechaISO(modalActivoAct.fecha_fin);
  document.getElementById("mfi-input-dias").value = modalActivoAct.dias || 5;

  document.getElementById("mfi-btn-guardar").onclick = async () => {
    const valFin = document.getElementById("mfi-input-fin").value;
    const valDias = parseInt(document.getElementById("mfi-input-dias").value);
    if (valFin && valDias > 0) {
      modalActivoAct.fecha_fin = formatearFechaLatina(valFin);
      modalActivoAct.dias = valDias;
      document.getElementById("modal-fin-interactiva")?.classList.add("hidden");
      await guardarCambioDirecto(modalActivoAct);
    }
  };
  document.getElementById("modal-fin-interactiva")?.classList.remove("hidden");
}

export function editarDias(cod) {
  if (!state.proyectoEsGestor || tieneHijos(cod)) return;
  const act = state.actividadesGlobal.find(a => a.codigo === cod);
  abrirInputCustom({
    titulo: "Modificar Duración",
    mensaje: "Consigne los días de duración:",
    tipo: "number",
    valorActual: act.dias,
    onAceptar: async (diasStr) => {
      const d = parseInt(diasStr);
      if (!isNaN(d) && d > 0) {
        act.dias = d;
        const dtIni = parsearFechaUniversal(act.fecha_inicio) || new Date();
        const dtFin = new Date(dtIni);
        dtFin.setDate(dtFin.getDate() + (d - 1));
        act.fecha_fin = `${String(dtFin.getDate()).padStart(2, '0')}/${String(dtFin.getMonth() + 1).padStart(2, '0')}/${dtFin.getFullYear()}`;
        await guardarCambioDirecto(act);
      }
    }
  });
}

export function editarAvance(cod) {
  if (tieneHijos(cod)) return;
  const act = state.actividadesGlobal.find(a => a.codigo === cod);
  abrirInputCustom({
    titulo: "Porcentaje Requerido",
    mensaje: "Porcentaje de avance (0 a 100):",
    tipo: "number",
    valorActual: act.avance,
    onAceptar: async (avStr) => {
      const num = parseInt(avStr);
      if (!isNaN(num) && num >= 0 && num <= 100) {
        act.avance = num;
        act.estado = (num === 100) ? "Ejecutado" : (num === 0 ? "No iniciado" : "En proceso");
        await guardarCambioDirecto(act);
      }
    }
  });
}

export async function guardarCambioDirecto(act) {
  const fIniLimpia = formatearFechaLatina(act.fecha_inicio);
  const fFinLimpia = formatearFechaLatina(act.fecha_fin);
  const pId = parseInt(state.proyectoActualId) || 1;

  const actLocal = state.actividadesGlobal.find(a => a.codigo === act.codigo);
  if (actLocal) {
    Object.assign(actLocal, act);
    renderizarTabla();
  }

  try {
    const res = await apiFetch(`/actividades`, {
      method: "POST",
      body: JSON.stringify({
        proyecto_id: pId,
        codigo: String(act.codigo).trim(),
        descripcion: String(act.descripcion || '').trim(),
        responsable: String(act.responsable || 'No asignado').trim(),
        estado: act.estado || 'No iniciado',
        avance: parseInt(act.avance) || 0,
        fecha_inicio: fIniLimpia,
        fecha_fin: fFinLimpia,
        dias: parseInt(act.dias) || 1,
        predecesores: String(act.predecesores || '').trim()
      })
    });

    if (res.ok) {
      await sincronizarDatosProyecto(pId);
    }
  } catch (error) {
    console.error("Error guardando actividad:", error);
  }
}

// =========================================================================
// DRAG AND DROP WBS Y MENÚ CONTEXTUAL
// =========================================================================

let codigoActividadArrastrada = null;
let modoInsercion = "below";

export function iniciarArrastreFila(e, cod) {
  codigoActividadArrastrada = cod;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", cod);
  document.body.classList.add("is-dragging-row");
  document.getElementById(`fila-act-${cod.replace(/\./g, '_')}`)?.classList.add("row-dragging");
}

export function sobrevolarFilaArrastre(e, trElement) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  if (trElement.classList.contains("row-dragging")) return;

  const rect = trElement.getBoundingClientRect();
  const altura = rect.height;
  const yRelativo = e.clientY - rect.top;
  const margenBorde = Math.max(5, altura * 0.18);

  document.querySelectorAll("#lista-actividades tr").forEach(tr => {
    if (tr !== trElement) tr.classList.remove("drop-target-above", "drop-target-below", "drop-target-inside");
  });

  if (yRelativo <= margenBorde) {
    modoInsercion = "above";
    trElement.classList.remove("drop-target-below", "drop-target-inside");
    trElement.classList.add("drop-target-above");
  } else if (yRelativo >= altura - margenBorde) {
    modoInsercion = "below";
    trElement.classList.remove("drop-target-above", "drop-target-inside");
    trElement.classList.add("drop-target-below");
  } else {
    modoInsercion = "inside";
    trElement.classList.remove("drop-target-above", "drop-target-below");
    trElement.classList.add("drop-target-inside");
  }
}

export function limpiarBordeArrastre(trElement) {
  if (trElement) trElement.classList.remove("drop-target-above", "drop-target-below", "drop-target-inside");
}

export function finalizarArrastre() {
  document.body.classList.remove("is-dragging-row");
  document.querySelectorAll("#lista-actividades tr").forEach(tr => {
    tr.classList.remove("row-dragging", "drop-target-above", "drop-target-below", "drop-target-inside");
  });
  codigoActividadArrastrada = null;
}

export async function soltarFilaArrastre(e, codigoDestino, trElement) {
  e.preventDefault();
  limpiarBordeArrastre(trElement);
  const codOrigen = codigoActividadArrastrada;
  if (!codOrigen || codOrigen === codigoDestino) {
    finalizarArrastre();
    return;
  }

  const codOrigenLimpio = String(codOrigen).replace(/\.+$/, "");
  const codDestinoLimpio = String(codigoDestino).replace(/\.+$/, "");
  finalizarArrastre();

  const confirma = await confirmModal(`¿Desea reubicar la actividad [${codOrigenLimpio}] respecto a [${codDestinoLimpio}]?`, "Confirmar Reubicación", "question");
  if (!confirma) return;

  try {
    const res = await apiFetch(`/proyectos/${state.proyectoActualId}/reordenar-actividades`, {
      method: "PUT",
      body: JSON.stringify({
        proyecto_id: parseInt(state.proyectoActualId),
        codigo_origen: codOrigenLimpio,
        codigo_destino: codDestinoLimpio,
        modo: modoInsercion
      })
    });

    if (res.ok) {
      notificarToast("WBS reorganizado exitosamente.", "success");
      await sincronizarDatosProyecto(state.proyectoActualId);
    }
  } catch (err) {
    alert("Error al reordenar actividades.");
  }
}

export function abrirMenuContextual(event, cod) {
  event.preventDefault();
  event.stopPropagation();
  seleccionarFila(cod);
  state.actividadContextualSeleccionada = state.actividadesGlobal.find(a => a.codigo === cod);
  if (!state.actividadContextualSeleccionada) return;

  const menu = document.getElementById("menu-contextual");
  const headerInfo = document.getElementById("mc-header-info");
  if (headerInfo) headerInfo.innerText = `[${cod}] ${state.actividadContextualSeleccionada.descripcion}`;

  let posX = Math.min(window.innerWidth - 240, event.clientX);
  let posY = Math.min(window.innerHeight - 200, event.clientY);
  if (menu) {
    menu.style.left = `${posX}px`;
    menu.style.top = `${posY}px`;
    menu.classList.remove("hidden");
  }
}

export function cerrarMenuContextual() {
  document.getElementById("menu-contextual")?.classList.add("hidden");
}

export function ejecutarAccionContextual(accion) {
  const act = state.actividadContextualSeleccionada;
  const cod = act ? act.codigo : null;
  cerrarMenuContextual();

  if (accion === 'agregar_hijo' && cod) abrirWizardCreacion(cod, "hijo");
  else if (accion === 'agregar_hermano' && cod) abrirWizardCreacion(cod, "hermano");
  else if (accion === 'agregar_raiz') abrirWizardCreacion(null, "raiz");
  else if (accion === 'asignar_resp' && cod) editarResponsable(cod);
  else if (accion === 'eliminar' && cod) eliminarActividad(cod);
  else if (accion === 'ver_comentarios' && cod) abrirModalComentarios(cod);
}

// =========================================================================
// WIZARD DE CREACIÓN DE ACTIVIDADES
// =========================================================================

export function botonSuperiorNuevaActividad() {
  if (!state.proyectoEsGestor) return;
  abrirWizardCreacion(state.codigoFilaSeleccionada, "raiz");
}

export function abrirWizardCreacion(codigoBase = null, modo = "raiz") {
  state.wizardCodigoPadre = codigoBase;
  let nuevoCod = "1";

  if (modo === "hijo" && codigoBase) {
    const hijos = state.actividadesGlobal.filter(a => a.codigo.startsWith(codigoBase + ".") && a.codigo.split(".").length === codigoBase.split(".").length + 1);
    nuevoCod = `${codigoBase}.${hijos.length + 1}`;
  } else {
    const raices = state.actividadesGlobal.filter(a => !a.codigo.includes("."));
    nuevoCod = String(raices.length + 1);
  }

  state.wizardCodigoGenerado = nuevoCod;
  document.getElementById("wz-codigo-preview").innerText = nuevoCod;
  document.getElementById("wz-input-desc").value = "";
  document.getElementById("wz-input-ini").value = new Date().toISOString().split("T")[0];
  document.getElementById("wz-input-dias").value = "5";

  const dtFin = new Date();
  dtFin.setDate(dtFin.getDate() + 4);
  document.getElementById("wz-input-fin").value = dtFin.toISOString().split("T")[0];

  irAPasoWizard(1);
  document.getElementById("modal-wizard-creacion")?.classList.remove("hidden");
}

export function irAPasoWizard(paso) {
  state.wizardPasoActual = paso;
  document.getElementById("wz-paso-1")?.classList.toggle("hidden", paso !== 1);
  document.getElementById("wz-paso-2")?.classList.toggle("hidden", paso !== 2);
  document.getElementById("wz-paso-3")?.classList.toggle("hidden", paso !== 3);

  const barra = document.getElementById("wz-progreso-barra");
  const btnAnt = document.getElementById("wz-btn-anterior");
  const btnSig = document.getElementById("wz-btn-siguiente");

  if (paso === 1) {
    if (barra) barra.style.width = "33.33%";
    btnAnt?.classList.add("invisible");
    if (btnSig) btnSig.innerText = "Siguiente →";
  } else if (paso === 2) {
    if (barra) barra.style.width = "66.66%";
    btnAnt?.classList.remove("invisible");
    if (btnSig) btnSig.innerText = "Siguiente →";
  } else if (paso === 3) {
    if (barra) barra.style.width = "100%";
    btnAnt?.classList.remove("invisible");
    if (btnSig) btnSig.innerText = "✓ Guardar Registro";
  }
}

export function avanzarPasoWizard() {
  if (state.wizardPasoActual === 1) {
    if (!document.getElementById("wz-input-desc").value.trim()) {
      alert("Por favor ingrese una descripción.");
      return;
    }
    irAPasoWizard(2);
  } else if (state.wizardPasoActual === 2) {
    irAPasoWizard(3);
  } else if (state.wizardPasoActual === 3) {
    guardarActividadDesdeWizard();
  }
}

export function retrocederPasoWizard() {
  if (state.wizardPasoActual > 1) irAPasoWizard(state.wizardPasoActual - 1);
}

export function cerrarWizardCreacion() {
  document.getElementById("modal-wizard-creacion")?.classList.add("hidden");
}

export async function guardarActividadDesdeWizard() {
  const fIniRaw = document.getElementById("wz-input-ini").value;
  const fFinRaw = document.getElementById("wz-input-fin").value;
  const dias = parseInt(document.getElementById("wz-input-dias").value) || 1;
  const estado = document.getElementById("wz-input-estado").value;
  let avance = estado === "Ejecutado" ? 100 : (estado === "En proceso" ? 50 : 0);

  const payload = {
    proyecto_id: parseInt(state.proyectoActualId),
    codigo: state.wizardCodigoGenerado,
    descripcion: document.getElementById("wz-input-desc").value.trim(),
    responsable: "No asignado",
    estado: estado,
    avance: avance,
    fecha_inicio: formatearFechaLatina(fIniRaw),
    fecha_fin: formatearFechaLatina(fFinRaw),
    dias: dias,
    predecesores: document.getElementById("wz-input-pred")?.value.trim() || ""
  };

  try {
    const res = await apiFetch(`/actividades`, {
      method: "POST",
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      cerrarWizardCreacion();
      notificarToast(`Actividad [${state.wizardCodigoGenerado}] creada exitosamente.`, "success");
      await sincronizarDatosProyecto(state.proyectoActualId);
    }
  } catch (e) {
    alert("Error al registrar actividad.");
  }
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

// =========================================================================
// MODALES: RESPONSABLES, CPM, HISTORIAL, EXCEL, COMENTARIOS
// =========================================================================

export async function editarResponsable(cod) {
  if (!state.proyectoEsGestor) return;
  const act = state.actividadesGlobal.find(a => a.codigo === cod);
  if (!act) return;

  const respActual = act.responsable || "";
  abrirInputCustom({
    titulo: `Asignar Responsable a [${cod}]`,
    mensaje: "Ingrese nombres y apellidos:",
    tipo: "text",
    valorActual: respActual === "No asignado" ? "" : respActual,
    onAceptar: async (nuevoResp) => {
      act.responsable = nuevoResp.trim() || "No asignado";
      await guardarCambioDirecto(act);
      notificarToast("Responsable actualizado.", "success");
    }
  });
}

export async function abrirModalDependencias() {
  const modal = document.getElementById("modal-dependencias");
  const tbody = document.getElementById("tabla-config-dependencias-body");
  if (!tbody || !modal) return;
  tbody.innerHTML = "";

  const terminales = state.actividadesGlobal.filter(a => !tieneHijos(a.codigo));
  const lista = terminales.length > 0 ? terminales : state.actividadesGlobal;

  lista.forEach(act => {
    const predsActuales = (act.predecesores || "").split(",").map(s => s.trim()).filter(Boolean);
    let checksHTML = "";

    lista.filter(p => p.codigo !== act.codigo).forEach(p => {
      const marcado = predsActuales.includes(p.codigo);
      checksHTML += `
        <label class="inline-flex items-center space-x-1.5 bg-gray-50 px-2 py-1 rounded border border-gray-200 text-[11px] font-bold text-gray-700 mr-1.5 mb-1.5">
          <input type="checkbox" data-act-cod="${act.codigo}" value="${p.codigo}" ${marcado ? 'checked' : ''} class="chk-dep-item rounded text-[#0f2a4a]">
          <span>[${p.codigo}] ${p.descripcion.substring(0, 18)}...</span>
        </label>
      `;
    });

    tbody.innerHTML += `
      <tr class="hover:bg-gray-50 border-b border-gray-100">
        <td class="p-2.5 font-mono font-bold text-center text-[#0f2a4a]">${act.codigo}</td>
        <td class="p-2.5 font-semibold text-gray-800">${act.descripcion}</td>
        <td class="p-2.5 text-center font-bold text-teal-800">${act.dias}d</td>
        <td class="p-2.5 flex flex-wrap items-center">${checksHTML || '<span class="text-gray-400 italic text-[11px]">Sin predecesoras</span>'}</td>
      </tr>
    `;
  });

  modal.classList.remove("hidden");
}

export function cerrarModalDependencias() {
  document.getElementById("modal-dependencias")?.classList.add("hidden");
}

export async function guardarTodasDependencias() {
  const inputs = document.querySelectorAll(".chk-dep-item");
  const mapa = {};
  inputs.forEach(chk => {
    const cod = chk.getAttribute("data-act-cod");
    if (!mapa[cod]) mapa[cod] = [];
    if (chk.checked) mapa[cod].push(chk.value);
  });

  for (const act of state.actividadesGlobal) {
    if (mapa.hasOwnProperty(act.codigo)) {
      act.predecesores = mapa[act.codigo].join(", ");
      await guardarCambioDirecto(act);
    }
  }

  cerrarModalDependencias();
  notificarToast("Dependencias actualizadas con éxito.", "success");
}

export async function alternarCapaRutaCritica() {
  state.capaCpmActiva = !state.capaCpmActiva;
  const btn = document.getElementById("btn-toggle-cpm");

  if (state.capaCpmActiva) {
    try {
      const res = await apiFetch(`/ruta-critica?proyecto_id=${state.proyectoActualId}`);
      if (res.ok) {
        const cpm = await res.json();
        state.datosCpmGlobal.duracionTotal = cpm.duracion_proyecto_dias || 0;
        state.datosCpmGlobal.actividadesCriticas = new Set();
        if (cpm.detalles) {
          Object.values(cpm.detalles).forEach(n => {
            if (n.es_critica) state.datosCpmGlobal.actividadesCriticas.add(String(n.codigo).replace(/\.+$/, ""));
          });
        }
        if (btn) {
          btn.className = "group h-[29px] px-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-all duration-300 shadow-xs flex items-center justify-center border border-red-700 whitespace-nowrap";
          btn.innerHTML = `<span class="text-sm">🔥</span><span class="ml-1 text-xs font-bold">Ruta Crítica: ${state.datosCpmGlobal.duracionTotal}d</span>`;
        }
        notificarToast(`Ruta Crítica activa: ${state.datosCpmGlobal.duracionTotal} días.`, "success");
      }
    } catch (e) {
      state.capaCpmActiva = false;
    }
  } else {
    if (btn) {
      btn.className = "group h-[29px] px-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-all duration-300 shadow-xs flex items-center justify-center border border-gray-300 whitespace-nowrap";
      btn.innerHTML = `<span class="text-sm">🔥</span><span class="text-xs font-bold ml-1">Ruta Crítica</span>`;
    }
    notificarToast("Capa de Ruta Crítica desactivada.", "info");
  }
  renderizarTabla();
}

export async function abrirHistorial() {
  const modal = document.getElementById("modal-historial");
  const tbody = document.getElementById("historial-tabla-body");
  if (!tbody || !modal) return;
  tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-gray-400 font-semibold animate-pulse">Cargando auditoría...</td></tr>`;
  modal.classList.remove("hidden");

  try {
    const res = await apiFetch(`/proyectos/${state.proyectoActualId}/historial`);
    if (res.ok) {
      const data = await res.json();
      tbody.innerHTML = "";
      if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-gray-400 font-semibold">Sin registros de auditoría.</td></tr>`;
        return;
      }
      data.forEach(h => {
        tbody.innerHTML += `
          <tr class="hover:bg-gray-50 transition border-b border-gray-100">
            <td class="p-2.5 text-gray-500 font-mono text-[11px] whitespace-nowrap">${h.timestamp || '-'}</td>
            <td class="p-2.5 font-bold text-teal-700 font-mono text-xs whitespace-nowrap">@${h.usuario || 'admin'}</td>
            <td class="p-2.5 font-bold text-[#0f2a4a] whitespace-nowrap">${h.accion || '-'}</td>
            <td class="p-2.5 text-gray-800">${h.detalle || '-'}</td>
          </tr>
        `;
      });
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-red-500 font-semibold">Error al consultar historial.</td></tr>`;
  }
}

export function cerrarHistorial() {
  document.getElementById("modal-historial")?.classList.add("hidden");
}

export async function abrirResponsables() {
  const modal = document.getElementById("modal-responsables");
  const tbody = document.getElementById("personal-permisos-tabla-body");
  if (!tbody || !modal) return;
  modal.classList.remove("hidden");
  tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-gray-400 font-semibold animate-pulse">Sincronizando permisos...</td></tr>`;

  try {
    const res = await apiFetch(`/proyectos/${state.proyectoActualId}/personal_permisos`);
    if (res.ok) {
      state.dataPersonalProyecto = await res.json();
      tbody.innerHTML = "";
      if (!state.dataPersonalProyecto.miembros || state.dataPersonalProyecto.miembros.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-gray-400 font-semibold">No hay roles especiales asignados.</td></tr>`;
        return;
      }
      state.dataPersonalProyecto.miembros.forEach(m => {
        const esGestor = (m.nivel_permiso === "GESTOR" || m.es_gestor === 1);
        tbody.innerHTML += `
          <tr class="hover:bg-gray-50 transition border-b border-gray-100">
            <td class="p-2.5 font-bold text-gray-800">${m.nombre_completo || '-'}</td>
            <td class="p-2.5 font-mono text-gray-500 text-xs">@${m.username}</td>
            <td class="p-2.5 text-center">
              <span class="px-2.5 py-1 rounded-md text-[11px] font-bold ${esGestor ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-blue-100 text-blue-900 border border-blue-300'}">
                ${esGestor ? '👑 Gestor de Proyecto' : '👁️ Visualizador'}
              </span>
            </td>
            <td class="p-2.5 text-center">
              <button onclick="removerRolProyecto(${m.id}, '${m.nombre_completo || m.username}')" class="text-red-500 hover:text-red-700 font-bold px-2 py-1">🗑️</button>
            </td>
          </tr>
        `;
      });
    }
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-red-500 font-semibold">Error al consultar roles.</td></tr>`;
  }
}

export function cerrarResponsables() {
  document.getElementById("modal-responsables")?.classList.add("hidden");
  sincronizarDatosProyecto(state.proyectoActualId);
}

export function autocompletarBusquedaUsuarios(termino) {
  const term = termino.toLowerCase().trim();
  const divSug = document.getElementById("sugerencias-usuarios-rol");
  if (!divSug) return;
  if (!term) {
    divSug.classList.add("hidden");
    state.usuarioSeleccionadoParaRol = null;
    return;
  }

  const fuente = state.dataPersonalProyecto.todos_usuarios || [];
  const matches = fuente.filter(u =>
    (u.nombre_completo && u.nombre_completo.toLowerCase().includes(term)) ||
    (u.username && u.username.toLowerCase().includes(term))
  );

  divSug.innerHTML = "";
  if (matches.length === 0) {
    divSug.innerHTML = `<div class="p-2.5 text-gray-400 italic">Sin resultados</div>`;
  } else {
    matches.slice(0, 6).forEach(u => {
      const item = document.createElement("div");
      item.className = "p-2.5 hover:bg-teal-50 cursor-pointer flex justify-between items-center transition border-b border-gray-100 font-semibold";
      item.innerHTML = `<span class="font-bold text-[#0f2a4a]">${u.nombre_completo || u.username}</span><span class="font-mono text-gray-400 text-[11px]">@${u.username}</span>`;
      item.onclick = () => {
        state.usuarioSeleccionadoParaRol = u;
        document.getElementById("inp-buscar-usuario-rol").value = `${u.nombre_completo || u.username} (@${u.username})`;
        divSug.classList.add("hidden");
      };
      divSug.appendChild(item);
    });
  }
  divSug.classList.remove("hidden");
}

export async function confirmarAsignacionRolUsuario() {
  if (!state.usuarioSeleccionadoParaRol) {
    alert("Por favor seleccione un trabajador.");
    return;
  }
  const rol = document.getElementById("sel-rol-asignar").value;

  try {
    const res = await apiFetch(`/proyectos/${state.proyectoActualId}/personal_permisos`, {
      method: "POST",
      body: JSON.stringify({ usuario_id: state.usuarioSeleccionadoParaRol.id, nivel: rol })
    });
    if (res.ok) {
      notificarToast("Rol asignado con éxito.", "success");
      document.getElementById("inp-buscar-usuario-rol").value = "";
      state.usuarioSeleccionadoParaRol = null;
      await abrirResponsables();
    }
  } catch (e) {
    alert("Error al asignar rol.");
  }
}

export async function removerRolProyecto(usuarioId, nombre) {
  const confirma = await confirmModal(`¿Desea remover el rol de ${nombre}?`, "Confirmar", "warning");
  if (!confirma) return;

  try {
    const res = await apiFetch(`/proyectos/${state.proyectoActualId}/personal_permisos`, {
      method: "POST",
      body: JSON.stringify({ usuario_id: usuarioId, nivel: 'NINGUNO' })
    });
    if (res.ok) {
      notificarToast("Rol removido.", "info");
      await abrirResponsables();
    }
  } catch (e) {
    alert("Error al remover rol.");
  }
}

export async function cargarComentariosProyecto() {
  if (!state.proyectoActualId) return;
  try {
    const res = await apiFetch(`/proyectos/${state.proyectoActualId}/comentarios`);
    if (res.ok) {
      state.comentariosGlobal = await res.json();
      renderizarTabla();
    }
  } catch (e) {}
}

export function abrirModalComentarios(cod) {
  state.actividadComentarioActual = state.actividadesGlobal.find(a => a.codigo === cod);
  if (!state.actividadComentarioActual) return;

  document.getElementById("com-modal-titulo").innerText = `Comentarios`;
  document.getElementById("com-modal-subtitulo").innerText = `[${cod}] ${state.actividadComentarioActual.descripcion}`;
  renderizarTarjetasComentarios();
  document.getElementById("modal-comentarios")?.classList.remove("hidden");
}

export function cerrarModalComentarios() {
  document.getElementById("modal-comentarios")?.classList.add("hidden");
  state.actividadComentarioActual = null;
}

function renderizarTarjetasComentarios() {
  const cont = document.getElementById("com-lista-tarjetas");
  if (!cont || !state.actividadComentarioActual) return;
  cont.innerHTML = "";

  const lista = state.comentariosGlobal.filter(c => c.codigo_actividad === state.actividadComentarioActual.codigo);
  if (lista.length === 0) {
    cont.innerHTML = `<p class="p-6 text-center text-gray-400 italic text-xs">No hay comentarios en esta actividad.</p>`;
    return;
  }

  lista.forEach(c => {
    cont.innerHTML += `
      <div class="bg-white p-3 rounded-xl border border-gray-200 shadow-xs space-y-1">
        <div class="flex justify-between items-center text-[10px] text-gray-400">
          <span class="font-bold text-[#0f2a4a] text-xs">${c.autor_nombre}</span>
          <span>${c.fecha_creacion}</span>
        </div>
        <p class="text-xs text-gray-700">${c.texto}</p>
      </div>
    `;
  });
}

export async function publicarComentario() {
  const txt = document.getElementById("com-input-texto").value.trim();
  if (!txt || !state.actividadComentarioActual) return;

  try {
    const res = await apiFetch(`/comentarios`, {
      method: "POST",
      body: JSON.stringify({
        proyecto_id: state.proyectoActualId,
        codigo_actividad: state.actividadComentarioActual.codigo,
        texto: txt
      })
    });
    if (res.ok) {
      document.getElementById("com-input-texto").value = "";
      notificarToast("Comentario publicado.", "success");
      await cargarComentariosProyecto();
      renderizarTarjetasComentarios();
    }
  } catch (e) {
    alert("Error al publicar comentario.");
  }
}

export function exportarExcelCSV() {
  if (!state.actividadesGlobal || state.actividadesGlobal.length === 0) {
    alert("No hay actividades para exportar.");
    return;
  }

  let csv = "Codigo;Descripcion;Responsable;Estado;Fecha Inicio;Fecha Fin;Dias;% Avance;Predecesores\n";
  state.actividadesGlobal.forEach(a => {
    csv += `"${a.codigo}";"${a.descripcion.replace(/"/g, '""')}";"${a.responsable || ''}";"${a.estado}";"${formatearFechaLatina(a.fecha_inicio)}";"${formatearFechaLatina(a.fecha_fin)}";${a.dias};${a.avance}%;"${a.predecesores || ''}"\n`;
  });

  const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Cronograma_${state.proyectoActualId}_${new Date().toISOString().split("T")[0]}.csv`;
  link.click();
  notificarToast("Cronograma exportado a Excel.", "success");
}

function inicializarRedimensionDescripcion() {
  const thDesc = document.getElementById("th-descripcion");
  const resizer = document.getElementById("resizer-col-descripcion");
  if (!thDesc || !resizer) return;

  let inicioX = 0, anchoInicial = 0;
  resizer.onmousedown = (e) => {
    e.preventDefault();
    inicioX = e.clientX;
    anchoInicial = thDesc.offsetWidth;

    const alMover = (ev) => {
      const delta = ev.clientX - inicioX;
      const nuevoAncho = Math.max(160, anchoInicial + delta);
      thDesc.style.width = `${nuevoAncho}px`;
      thDesc.style.minWidth = `${nuevoAncho}px`;
    };

    const alSoltar = () => {
      window.removeEventListener("mousemove", alMover);
      window.removeEventListener("mouseup", alSoltar);
    };

    window.addEventListener("mousemove", alMover);
    window.addEventListener("mouseup", alSoltar);
  };
}

function actualizarBotonPlantillaDinamico() {
  const btn = document.getElementById("btn-accion-plantilla-dinamico");
  if (!btn) return;
  if (!state.proyectoEsGestor) {
    btn.classList.add("hidden");
    return;
  }
  btn.classList.remove("hidden");
}

// Exposición al ámbito global window
window.ingresarAlProyecto = ingresarAlProyecto;
window.volverAlHub = volverAlHub;
window.renderizarTabla = renderizarTabla;
window.botonSuperiorNuevaActividad = botonSuperiorNuevaActividad;
window.abrirWizardCreacion = abrirWizardCreacion;
window.avanzarPasoWizard = avanzarPasoWizard;
window.retrocederPasoWizard = retrocederPasoWizard;
window.cerrarWizardCreacion = cerrarWizardCreacion;
window.fijarModoZoomDirecto = fijarModoZoomDirecto;
window.cambiarSemanaInicio = cambiarSemanaInicio;
window.fijarSemanaInicio = fijarSemanaInicio;
window.irAInicioProyecto = irAInicioProyecto;
window.irASemanaActual = irASemanaActual;
window.filtrarNivelJerarquico = filtrarNivelJerarquico;
window.aplicarFiltrosGlobales = aplicarFiltrosGlobales;
window.limpiarTodosFiltros = limpiarTodosFiltros;
window.alternarColapsoNodo = alternarColapsoNodo;
window.editarResponsable = editarResponsable;
window.editarEstado = editarEstado;
window.editarDescripcion = editarDescripcion;
window.editarFechaInicio = editarFechaInicio;
window.editarFechaFin = editarFechaFin;
window.editarDias = editarDias;
window.editarAvance = editarAvance;
window.eliminarActividad = eliminarActividad;
window.exportarExcelCSV = exportarExcelCSV;
window.abrirModalDependencias = abrirModalDependencias;
window.cerrarModalDependencias = cerrarModalDependencias;
window.guardarTodasDependencias = guardarTodasDependencias;
window.alternarCapaRutaCritica = alternarCapaRutaCritica;
window.abrirHistorial = abrirHistorial;
window.cerrarHistorial = cerrarHistorial;
window.abrirResponsables = abrirResponsables;
window.cerrarResponsables = cerrarResponsables;
window.autocompletarBusquedaUsuarios = autocompletarBusquedaUsuarios;
window.confirmarAsignacionRolUsuario = confirmarAsignacionRolUsuario;
window.removerRolProyecto = removerRolProyecto;
window.abrirMenuContextual = abrirMenuContextual;
window.cerrarMenuContextual = cerrarMenuContextual;
window.ejecutarAccionContextual = ejecutarAccionContextual;
window.abrirModalComentarios = abrirModalComentarios;
window.cerrarModalComentarios = cerrarModalComentarios;
window.publicarComentario = publicarComentario;