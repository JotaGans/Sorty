import { state } from "../../core/state.js";
import { apiFetch } from "../../core/api.js";
import {
  notificarToast,
  confirmModal,
  formatearFechaLatina,
  formatearFechaISO,
  parsearFechaUniversal,
  abrirInputCustom
} from "../../core/ui-dialogs.js";
import { actualizarKPIs, sincronizarDatosProyecto, actualizarBotonPlantillaDinamico, obtenerClaveStorageAnchoCol, aplicarAnchoColumnaDescripcion } from "./project-core.js";
import { obtenerAvatarHTML, renderizarGanttFila } from "./project-gantt.js";
import { obtenerComentariosDeActividad, abrirModalComentarios } from "./project-aux.js";

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

  const niveles = [4, 3, 2, 1];
  niveles.forEach(nivelActual => {
    state.actividadesGlobal.forEach(madre => {
      const codLimpio = madre.codigo;
      const partes = codLimpio.split(".");
      if (partes.length === nivelActual) {
        const hijosDirectos = state.actividadesGlobal.filter(h => {
          const c = h.codigo;
          return c.startsWith(codLimpio + ".") && c.split(".").length === nivelActual + 1;
        });

        if (hijosDirectos.length > 0) {
          const sumaAvances = hijosDirectos.reduce((acc, h) => acc + (parseInt(h.avance) || 0), 0);
          const promAvance = Math.round(sumaAvances / hijosDirectos.length);
          madre.avance = promAvance;
          madre.estado = (promAvance === 100) ? "Ejecutado" : (promAvance > 0 ? "En proceso" : "No iniciado");

          let minIni = null, maxFin = null;
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
      iconoColapso = `<button onclick="event.stopPropagation(); alternarColapsoNodo('${act.codigo}')" class="text-[10px] font-black text-[#0f2a4a] mr-1.5 w-4 h-4 rounded hover:bg-blue-200 transition cursor-pointer">${estaColapsado ? '▶' : '▼'}</button>`;
    } else {
      iconoColapso = `<span class="inline-block w-4 mr-1.5"></span>`;
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
        tdFin = `<td class="p-2.5 border-r border-b border-gray-200 hidden sm:table-cell text-xs cursor-not-allowed select-none whitespace-nowrap font-medium" title="Fecha fin calculada por horas netas">${badgeVencidoHTML} ${lockIcon}</td>`;
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

    const ganttHTML = renderizarGanttFila(act, esMadre, codLimpio);
    const tdGantt = state.visibilidadColumnas.gantt ? `<td class="p-1 border-r border-b border-gray-200">${ganttHTML}</td>` : '';

    const comsAct = obtenerComentariosDeActividad(cod);
    const cantComs = comsAct.length;
    const iconoComentarioHTML = cantComs > 0
      ? `<button onclick="event.stopPropagation(); abrirModalComentarios('${cod}')" class="opacity-0 group-hover:opacity-100 inline-flex items-center space-x-1 text-slate-500 hover:text-slate-900 px-1 py-0.5 text-xs ml-1.5 transition select-none leading-none cursor-pointer" title="Ver ${cantComs} comentario(s)"><span class="text-[11px]">💬</span><span class="text-[10px] font-black text-slate-600">${cantComs}</span></button>`
      : `<button onclick="event.stopPropagation(); abrirModalComentarios('${cod}')" class="opacity-0 group-hover:opacity-30 hover:!opacity-90 text-slate-400 hover:text-slate-700 px-1 py-0.5 text-xs ml-1.5 transition select-none leading-none cursor-pointer" title="Agregar comentario"><span class="text-[11px]">💬</span></button>`;

    const descTextoLimpio = String(act.descripcion || "").replace(/"/g, '&quot;');
    const handleDrag = state.proyectoEsGestor ? `<span class="drag-handle text-slate-400 hover:text-slate-800 cursor-grab active:cursor-grabbing mr-2 text-xs select-none inline-block align-middle" title="Arrastrar fila para reubicar">⠿</span>` : '';

    tr.innerHTML = `
      <td class="p-2.5 font-mono font-bold text-xs border-r border-b border-gray-200 whitespace-nowrap">
        <div class="inline-flex items-center">${handleDrag}${iconoColapso}<span>${cod}</span></div>
      </td>
      <td class="p-2 border-r border-b border-gray-200 ${state.proyectoEsGestor ? 'cell-editable cursor-pointer' : ''} group align-middle" style="padding-left: ${paddingLeft}px;" ondblclick="${state.proyectoEsGestor ? `editarDescripcion('${cod}')` : ''}" title="${descTextoLimpio}">
        <div class="flex items-center justify-between gap-1 w-full overflow-hidden">
          <span class="text-xs leading-snug break-words text-gray-800 select-text" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word;" title="${descTextoLimpio}">${act.descripcion}</span>
          <div class="flex-shrink-0">${iconoComentarioHTML}</div>
        </div>
      </td>
      ${tdResp}
      ${tdEst}
      ${tdIni}
      ${tdFin}
      ${tdDias}
      ${tdAvance}
      ${tdGantt}
      <td class="p-2 text-center border-b border-gray-200 space-x-1 whitespace-nowrap">
        ${state.proyectoEsGestor && nivel < 4 ? `<button onclick="event.stopPropagation(); abrirWizardCreacion('${cod}', 'hijo')" class="text-blue-600 hover:text-blue-800 font-bold px-1 text-sm cursor-pointer" title="Agregar subtarea">+</button>` : ''}
        ${state.proyectoEsGestor ? `<button onclick="event.stopPropagation(); eliminarActividad('${cod}')" class="text-red-500 hover:text-red-700 font-bold px-1 cursor-pointer" title="Eliminar">🗑️</button>` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });

  actualizarKPIs();
  actualizarBotonPlantillaDinamico();

  const anchoGuardado = localStorage.getItem(obtenerClaveStorageAnchoCol());
  if (anchoGuardado) aplicarAnchoColumnaDescripcion(anchoGuardado);
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

export function deseleccionarFila() {
  state.codigoFilaSeleccionada = null;
  document.querySelectorAll("#lista-actividades tr").forEach(tr => {
    tr.classList.remove("row-selected");
  });
}

window.deseleccionarFila = deseleccionarFila;

export function esResponsableDeActividad(act) {
  if (!act || !act.responsable || !state.currentUser) return false;
  const respStr = String(act.responsable).toLowerCase();
  const uNom = String(state.currentUser.nombre_completo || "").toLowerCase().trim();
  const uUser = String(state.currentUser.username || "").toLowerCase().trim();
  return (uNom && respStr.includes(uNom)) || (uUser && respStr.includes(uUser));
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

export function filtrarNivelJerarquico(val) {
  state.nivelFiltroActivo = parseInt(val) || 4;
  const labelNivel = document.getElementById("txt-nivel-activo-label");
  if (labelNivel) labelNivel.innerText = val === "4" ? "Todo (N4)" : `Nivel ${val}`;
  renderizarTabla();
}

export function aplicarFiltrosGlobales() {
  renderizarTabla();
}

// --- EDICIÓN INLINE DE CELDAS ---
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
    mensaje: "Seleccione el estado de la actividad:",
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
  const esHoras = (state.proyectoModoDuracion === "hours");

  abrirInputCustom({
    titulo: esHoras ? "Modificar Horas de Dedicación" : "Modificar Duración",
    mensaje: esHoras ? "Ingrese las horas netas de trabajo estimadas:" : "Consigne los Días de duración estimada:",
    tipo: "number",
    valorActual: act.dias,
    onAceptar: async (diasStr) => {
      const d = parseInt(diasStr);
      if (!isNaN(d) && d > 0) {
        act.dias = d;
        const dtIni = parsearFechaUniversal(act.fecha_inicio) || new Date();
        const dtFin = new Date(dtIni);
        const diasASumar = esHoras ? Math.max(0, Math.ceil(d / 8) - 1) : Math.max(0, d - 1);
        dtFin.setDate(dtFin.getDate() + diasASumar);
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
    mensaje: "Porcentaje de avance real (0 a 100):",
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

    if (res.ok) await sincronizarDatosProyecto(pId);
  } catch (error) {
    console.error("Error guardando actividad:", error);
  }
}

// --- DRAG AND DROP WBS ---
let codigoActividadArrastrada = null;
let modoInsercion = "below";
let animacionAutoScrollId = null;
let velocidadAutoScroll = 0;

export function iniciarArrastreFila(e, cod) {
  codigoActividadArrastrada = cod;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", cod);
  document.body.classList.add("is-dragging-row");
  document.getElementById(`fila-act-${cod.replace(/\./g, '_')}`)?.classList.add("row-dragging");

  const actObj = state.actividadesGlobal.find(a => String(a.codigo).replace(/\.+$/, "") === String(cod).replace(/\.+$/, ""));
  const descCorta = actObj ? actObj.descripcion.substring(0, 24) + '...' : cod;

  const dragBadge = document.createElement("div");
  dragBadge.className = "fixed top-[-1000px] left-[-1000px] bg-[#0f2a4a] text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-2xl border border-teal-400 flex items-center space-x-2 z-[9999] pointer-events-none";
  dragBadge.innerHTML = `<span>✊ [${cod}]</span> <span class="font-normal opacity-90">${descCorta}</span>`;
  document.body.appendChild(dragBadge);
  e.dataTransfer.setDragImage(dragBadge, 15, 15);
  setTimeout(() => dragBadge.remove(), 0);

  iniciarBucleAutoScroll();
}

function iniciarBucleAutoScroll() {
  if (animacionAutoScrollId) return;
  const pasoScroll = () => {
    if (codigoActividadArrastrada && velocidadAutoScroll !== 0) {
      const cont = document.querySelector("#view-dashboard > div.overflow-auto") || document.getElementById("view-dashboard");
      if (cont) cont.scrollTop += velocidadAutoScroll;
    }
    if (codigoActividadArrastrada) animacionAutoScrollId = requestAnimationFrame(pasoScroll);
    else animacionAutoScrollId = null;
  };
  animacionAutoScrollId = requestAnimationFrame(pasoScroll);
}

export function sobrevolarFilaArrastre(e, trElement) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";

  const cont = document.querySelector("#view-dashboard > div.overflow-auto") || document.getElementById("view-dashboard");
  if (cont) {
    const cRect = cont.getBoundingClientRect();
    const umbral = 75;
    const yMouse = e.clientY;
    if (yMouse < cRect.top + umbral) velocidadAutoScroll = -Math.round(14 * Math.max(0.2, (cRect.top + umbral - yMouse) / umbral));
    else if (yMouse > cRect.bottom - umbral) velocidadAutoScroll = Math.round(14 * Math.max(0.2, (yMouse - (cRect.bottom - umbral)) / umbral));
    else velocidadAutoScroll = 0;
  }

  if (trElement.classList.contains("row-dragging")) return;

  const rect = trElement.getBoundingClientRect();
  const altura = rect.height;
  const yRel = e.clientY - rect.top;
  const margen = Math.max(5, altura * 0.18);

  document.querySelectorAll("#lista-actividades tr").forEach(tr => {
    if (tr !== trElement) tr.classList.remove("drop-target-above", "drop-target-below", "drop-target-inside");
  });

  if (yRel <= margen) {
    modoInsercion = "above";
    trElement.classList.remove("drop-target-below", "drop-target-inside");
    trElement.classList.add("drop-target-above");
  } else if (yRel >= altura - margen) {
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
  velocidadAutoScroll = 0;
  if (animacionAutoScrollId) { cancelAnimationFrame(animacionAutoScrollId); animacionAutoScrollId = null; }
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
  if (!codOrigen || codOrigen === codigoDestino) { finalizarArrastre(); return; }

  const codOrigenLimpio = String(codOrigen).replace(/\.+$/, "");
  const codDestinoLimpio = String(codigoDestino).replace(/\.+$/, "");

  const bloqueOrigen = state.actividadesGlobal.filter(a => {
    const c = String(a.codigo).replace(/\.+$/, "");
    return c === codOrigenLimpio || c.startsWith(codOrigenLimpio + ".");
  }).map(a => String(a.codigo).replace(/\.+$/, ""));

  if (bloqueOrigen.includes(codDestinoLimpio)) {
    alert("⚠️ No puedes mover una actividad dentro de sus propias componentes subordinadas.");
    finalizarArrastre();
    return;
  }

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
      notificarToast("Estructura WBS reorganizada con éxito.", "success");
      await sincronizarDatosProyecto(state.proyectoActualId);
    }
  } catch (err) {
    alert("Error de conexión al reordenar.");
  }
}

// --- WIZARD CREACIÓN DE ACTIVIDADES ---
let opcionesModoWizard = [];

export function botonSuperiorNuevaActividad() {
  if (!state.proyectoEsGestor) {
    alert("Solo el Gestor del Proyecto puede crear actividades.");
    return;
  }
  if (!state.codigoFilaSeleccionada) {
    abrirWizardCreacion(null, "raiz");
  } else {
    const codLimpio = String(state.codigoFilaSeleccionada).replace(/\.+$/, "");
    const nivel = codLimpio.split(".").length;
    if (nivel < 4) abrirWizardCreacion(codLimpio, "hijo");
    else abrirWizardCreacion(codLimpio, "hermano");
  }
}

export function abrirWizardCreacion(codigoBase = null, modoForzado = "hijo") {
  state.wizardCodigoPadre = codigoBase;
  opcionesModoWizard = [];

  const contToggle = document.getElementById("wz-contenedor-selector-tipo");
  const selToggle = document.getElementById("wz-select-tipo-creacion");

  if (!codigoBase || modoForzado === "raiz") {
    const raices = state.actividadesGlobal.filter(a => !a.codigo.replace(/\.$/, "").includes("."));
    let maxNum = 0;
    raices.forEach(r => {
      const n = parseInt(r.codigo.replace(/\.$/, ""));
      if (!isNaN(n) && n > maxNum) maxNum = n;
    });
    const codRaiz = `${maxNum + 1}`;

    opcionesModoWizard.push({
      modo: "raiz",
      codigo: codRaiz,
      label: "✨ Nueva actividad principal (Nivel 1)",
      titulo: "Nueva actividad principal (Nivel 1)",
      subtitulo: "Creando actividad principal independiente"
    });
  } else {
    const codLimpio = String(codigoBase).replace(/\.+$/, "");
    const nivel = codLimpio.split(".").length;
    const madre = state.actividadesGlobal.find(a => a.codigo.replace(/\.+$/, "") === codLimpio);
    const descBase = madre ? madre.descripcion : codLimpio;
    const nombresSub = ["", "Tarea (Nivel 2)", "Subtarea (Nivel 3)", "Paso (Nivel 4)"];
    const nombresMismo = ["", "actividad principal (Nivel 1)", "tarea (Nivel 2)", "subtarea (Nivel 3)", "paso (Nivel 4)"];

    if (nivel < 4) {
      const hijos = state.actividadesGlobal.filter(a => {
        const c = a.codigo.replace(/\.$/, "");
        return c.startsWith(codLimpio + ".") && c.split(".").length === nivel + 1;
      });
      let maxH = 0;
      hijos.forEach(h => {
        const ult = parseInt(h.codigo.replace(/\.$/, "").split(".").pop());
        if (!isNaN(ult) && ult > maxH) maxH = ult;
      });
      const codHijo = `${codLimpio}.${maxH + 1}`;

      opcionesModoWizard.push({
        modo: "hijo",
        codigo: codHijo,
        label: `➕ ${nombresSub[nivel]} (dependiente de [${codLimpio}])`,
        titulo: `Nueva ${nombresSub[nivel]} para [${codLimpio}]`,
        subtitulo: `Depende de: ${descBase}`
      });

      let codHermano = "1";
      const partes = codLimpio.split(".");
      if (partes.length === 1) {
        const raices = state.actividadesGlobal.filter(a => !a.codigo.replace(/\.$/, "").includes("."));
        let maxR = 0;
        raices.forEach(r => {
          const n = parseInt(r.codigo.replace(/\.$/, ""));
          if (!isNaN(n) && n > maxR) maxR = n;
        });
        codHermano = `${maxR + 1}`;
      } else {
        const padre = partes.slice(0, -1).join(".");
        const hermanos = state.actividadesGlobal.filter(a => a.codigo.startsWith(padre + ".") && a.codigo.split(".").length === partes.length);
        let maxHer = 0;
        hermanos.forEach(h => {
          const ult = parseInt(h.codigo.split(".").pop());
          if (!isNaN(ult) && ult > maxHer) maxHer = ult;
        });
        codHermano = `${padre}.${maxHer + 1}`;
      }

      opcionesModoWizard.push({
        modo: "hermano",
        codigo: codHermano,
        label: `📋 Agregar actividad hermana (${nombresMismo[nivel]})`,
        titulo: `Nueva actividad hermana (${nombresMismo[nivel]})`,
        subtitulo: `Al mismo nivel que [${codLimpio}]`
      });
    }
  }

  if (selToggle) {
    selToggle.innerHTML = "";
    opcionesModoWizard.forEach(op => {
      selToggle.innerHTML += `<option value="${op.modo}">${op.label}</option>`;
    });
    selToggle.value = modoForzado;
  }

  if (contToggle) {
    if (opcionesModoWizard.length > 1) contToggle.classList.remove("hidden");
    else contToggle.classList.add("hidden");
  }

  cambiarModoSeleccionadoWizard(modoForzado);

  const hoy = new Date();
  document.getElementById("wz-input-desc").value = "";
  document.getElementById("wz-input-ini").value = formatearFechaISO(hoy.toISOString().split("T")[0]);

  const esHoras = (state.proyectoModoDuracion === "hours");
  const lblUnidad = document.getElementById("wz-lbl-duracion");
  const sufijoUnidad = document.getElementById("wz-sufijo-duracion");
  const inpDias = document.getElementById("wz-input-dias");
  const inpFin = document.getElementById("wz-input-fin");

  if (esHoras) {
    if (lblUnidad) lblUnidad.innerText = "Horas Duración:";
    if (sufijoUnidad) sufijoUnidad.innerText = "h";
    if (inpDias) inpDias.value = 8;
    if (inpFin) {
      inpFin.readOnly = true;
      inpFin.className = "w-full p-2 bg-slate-100 border border-gray-300 rounded-lg text-xs font-bold text-slate-500 cursor-not-allowed outline-none select-none";
      inpFin.value = formatearFechaISO(hoy.toISOString().split("T")[0]);
    }
  } else {
    if (lblUnidad) lblUnidad.innerText = "Días Duración:";
    if (sufijoUnidad) sufijoUnidad.innerText = "";
    if (inpDias) inpDias.value = 5;
    if (inpFin) {
      inpFin.readOnly = false;
      inpFin.className = "w-full p-2 bg-gray-50 border border-gray-300 rounded-lg text-xs font-bold text-gray-800 outline-none focus:border-[#0f2a4a]";
      const dtFinDef = new Date(hoy);
      dtFinDef.setDate(dtFinDef.getDate() + 4);
      inpFin.value = formatearFechaISO(dtFinDef.toISOString().split("T")[0]);
    }
  }

  const selEst = document.getElementById("wz-input-estado");
  if (selEst) selEst.value = "No iniciado";
  evaluarEstadoWizard("No iniciado");

  irAPasoWizard(1);
  document.getElementById("modal-wizard-creacion")?.classList.remove("hidden");
  setTimeout(() => document.getElementById("wz-input-desc")?.focus(), 100);
}

export function cambiarTipoCreacionDesdeNivel1(modo) {
  cambiarModoSeleccionadoWizard(modo);
}

export function cambiarModoSeleccionadoWizard(modo) {
  const op = opcionesModoWizard.find(o => o.modo === modo) || opcionesModoWizard[0];
  if (!op) return;

  state.wizardCodigoGenerado = op.codigo;
  const prevCod = document.getElementById("wz-codigo-preview");
  if (prevCod) prevCod.innerText = op.codigo;
  const tit = document.getElementById("wz-titulo");
  if (tit) tit.innerText = op.titulo;
  const sub = document.getElementById("wz-subtitulo");
  if (sub) sub.innerText = op.subtitulo;
}

export function evaluarEstadoWizard(estado) {
  const boxAvance = document.getElementById("wz-box-avance");
  const boxPred = document.getElementById("wz-box-pred");
  const inpAvance = document.getElementById("wz-input-avance");

  if (estado === "En proceso") {
    if (boxAvance) boxAvance.classList.remove("hidden");
    if (boxPred) boxPred.className = "sm:col-span-1";
    if (inpAvance && (!inpAvance.value || parseInt(inpAvance.value) <= 0 || parseInt(inpAvance.value) >= 100)) {
      inpAvance.value = 50;
    }
  } else {
    if (boxAvance) boxAvance.classList.add("hidden");
    if (boxPred) boxPred.className = "sm:col-span-2";
  }
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
      alert("Por favor consigna una descripción para continuar.");
      return;
    }
    irAPasoWizard(2);
  } else if (state.wizardPasoActual === 2) {
    const fIniVal = document.getElementById("wz-input-ini").value;
    const fFinVal = document.getElementById("wz-input-fin").value;
    const diasVal = parseInt(document.getElementById("wz-input-dias").value);

    if (!fIniVal || !fFinVal || isNaN(diasVal) || diasVal < 1) {
      alert("Verifique las fechas de inicio, término y la cantidad de días.");
      return;
    }
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
  let avance = 0;

  if (estado === "Ejecutado") avance = 100;
  else if (estado === "En proceso") avance = parseInt(document.getElementById("wz-input-avance")?.value) || 50;

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
  const codLimpio = cod.replace(/\.+$/, "");
  const hijas = state.actividadesGlobal.filter(a => {
    const c = a.codigo.replace(/\.+$/, "");
    return c.startsWith(codLimpio + ".") && c !== codLimpio;
  });

  let mensaje = `¿Está seguro de eliminar la actividad [${cod}]?`;
  if (hijas.length > 0) {
    mensaje = `⚠️ ATENCIÓN: La actividad [${cod}] contiene ${hijas.length} actividad(es) subordinada(s).\n\nSi continúa, se eliminarán todas en cascada. ¿Desea proceder?`;
  }

  const confirma = await confirmModal(mensaje, "Eliminar Registro", "danger");
  if (!confirma) return;

  try {
    const res = await apiFetch(`/proyectos/${state.proyectoActualId}/actividades/${cod}`, { method: "DELETE" });
    if (res.ok) {
      state.codigoFilaSeleccionada = null;
      notificarToast(`Actividad [${cod}] eliminada.`, "info");
      await sincronizarDatosProyecto(state.proyectoActualId);
    }
  } catch (e) {
    alert("Error al eliminar la actividad.");
  }
}

// --- MENÚ CONTEXTUAL EN CASCADA ---
export function abrirMenuContextual(event, cod) {
  event.preventDefault();
  event.stopPropagation();
  seleccionarFila(cod);
  state.actividadContextualSeleccionada = state.actividadesGlobal.find(a => a.codigo === cod);
  if (!state.actividadContextualSeleccionada) return;

  const partes = cod.replace(/\.+$/, "").split(".");
  const nivel = partes.length;
  const nombresSubnivel = ["", "subtarea (Nivel 2)", "subtarea (Nivel 3)", "paso (Nivel 4)"];
  const nombresMismoNivel = ["", "actividad principal (Nivel 1)", "tarea (Nivel 2)", "subtarea (Nivel 3)", "paso (Nivel 4)"];

  const menu = document.getElementById("menu-contextual");
  const headerInfo = document.getElementById("mc-header-info");
  if (headerInfo) {
    headerInfo.classList.remove("hidden");
    headerInfo.innerText = `[${cod}] ${state.actividadContextualSeleccionada.descripcion}`;
  }

  const grupoAgregar = document.getElementById("mc-grupo-agregar");
  const btnRaizDirecto = document.getElementById("mc-btn-raiz-directo");
  const btnHijo = document.getElementById("mc-btn-hijo");
  const btnHermano = document.getElementById("mc-btn-hermano");
  const btnRaiz = document.getElementById("mc-btn-raiz");
  const btnResp = document.getElementById("mc-btn-resp");
  const btnElim = document.getElementById("mc-btn-eliminar");
  const btnCom = document.getElementById("mc-btn-comentarios");

  const esMiActividad = state.actividadContextualSeleccionada.responsable && state.actividadContextualSeleccionada.responsable.includes(state.currentUser.username);
  const puedeCrear = state.proyectoEsGestor || esMiActividad;

  if (grupoAgregar) grupoAgregar.classList.toggle("hidden", !puedeCrear);
  if (btnRaizDirecto) btnRaizDirecto.classList.add("hidden");

  if (btnHijo) {
    if (nivel >= 4 || !puedeCrear) btnHijo.classList.add("hidden");
    else {
      btnHijo.classList.remove("hidden");
      const txtHijo = document.getElementById("mc-txt-hijo");
      if (txtHijo) txtHijo.innerText = `Agregar ${nombresSubnivel[nivel]}`;
    }
  }

  if (btnHermano) {
    if (!puedeCrear) btnHermano.classList.add("hidden");
    else {
      btnHermano.classList.remove("hidden");
      const txtHermano = document.getElementById("mc-txt-hermano");
      if (txtHermano) txtHermano.innerText = `Agregar actividad hermana (${nombresMismoNivel[nivel]})`;
    }
  }

  if (btnRaiz) btnRaiz.classList.toggle("hidden", !state.proyectoEsGestor || nivel <= 1);
  if (btnResp) btnResp.classList.toggle("hidden", !state.proyectoEsGestor);
  if (btnElim) btnElim.classList.toggle("hidden", !state.proyectoEsGestor);

  if (btnCom) {
    const coms = obtenerComentariosDeActividad(cod);
    btnCom.classList.remove("hidden");
    const txtCom = document.getElementById("mc-txt-comentarios");
    if (txtCom) txtCom.innerText = coms.length > 0 ? `Ver Comentarios (${coms.length})` : "Agregar Comentario";
  }

  let posX = event.clientX, posY = event.clientY;
  if (posX + 480 > window.innerWidth) posX = window.innerWidth - 490;
  if (posY + 230 > window.innerHeight) posY = window.innerHeight - 235;

  if (menu) {
    menu.style.left = `${posX}px`;
    menu.style.top = `${posY}px`;
    menu.classList.remove("hidden");
  }
}

export function abrirMenuContextualVacio(event) {
  if (!state.proyectoEsGestor) return;
  event.preventDefault();
  event.stopPropagation();

  state.codigoFilaSeleccionada = null;
  document.querySelectorAll("#lista-actividades tr").forEach(tr => tr.classList.remove("row-selected"));
  state.actividadContextualSeleccionada = null;

  const menu = document.getElementById("menu-contextual");
  const headerInfo = document.getElementById("mc-header-info");
  if (headerInfo) headerInfo.classList.add("hidden");

  const grupoAgregar = document.getElementById("mc-grupo-agregar");
  const btnRaizDirecto = document.getElementById("mc-btn-raiz-directo");
  const btnResp = document.getElementById("mc-btn-resp");
  const btnElim = document.getElementById("mc-btn-eliminar");
  const btnCom = document.getElementById("mc-btn-comentarios");

  if (grupoAgregar) grupoAgregar.classList.add("hidden");
  if (btnRaizDirecto) btnRaizDirecto.classList.remove("hidden");
  if (btnResp) btnResp.classList.add("hidden");
  if (btnElim) btnElim.classList.add("hidden");
  if (btnCom) btnCom.classList.add("hidden");

  let posX = event.clientX, posY = event.clientY;
  if (posX + 480 > window.innerWidth) posX = window.innerWidth - 490;
  if (posY + 230 > window.innerHeight) posY = window.innerHeight - 235;

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

  if (accion === 'agregar_raiz') abrirWizardCreacion(null, "raiz");
  else if (accion === 'agregar_hijo' && cod) abrirWizardCreacion(cod, "hijo");
  else if (accion === 'agregar_hermano' && cod) abrirWizardCreacion(cod, "hermano");
  else if (accion === 'asignar_resp' && cod) editarResponsable(cod);
  else if (accion === 'eliminar' && cod) eliminarActividad(cod);
  else if (accion === 'ver_comentarios' && cod) abrirModalComentarios(cod);
}

// --- MODAL REAL INTERACTIVO DE ASIGNAR RESPONSABLES ---
export async function editarResponsable(cod) {
  if (!state.proyectoEsGestor && state.currentUser.rol !== "ADMIN_TI") {
    alert("Solo un Gestor del Proyecto puede asignar o modificar responsables.");
    return;
  }

  const codLimpio = String(cod).trim().replace(/\.+$/, "");
  state.actividadMultiRespActual = state.actividadesGlobal.find(a => String(a.codigo).trim().replace(/\.+$/, "") === codLimpio);
  if (!state.actividadMultiRespActual) return;

  if (!state.catalogoTrabajadoresGlobal || state.catalogoTrabajadoresGlobal.length === 0) {
    try {
      const resT = await apiFetch("/trabajadores");
      if (resT.ok) state.catalogoTrabajadoresGlobal = await resT.json();
    } catch(e) {}
  }

  const respStr = String(state.actividadMultiRespActual.responsable || "").trim();
  state.responsablesInicialesEdicion = (respStr && respStr !== "No asignado")
    ? (respStr.includes(";") ? respStr.split(";").map(s => s.trim()).filter(Boolean) : [respStr])
    : [];

  state.listaAsignadosModal = [];
  state.responsablesInicialesEdicion.forEach(nom => {
    const tObj = (state.catalogoTrabajadoresGlobal || []).find(t => t.nombre_completo && t.nombre_completo.trim().toLowerCase() === nom.trim().toLowerCase());
    state.listaAsignadosModal.push({
      nombre_completo: nom,
      unidad_organica: tObj ? tObj.unidad_organica : "Personal"
    });
  });

  renderizarListaAsignadosModal();

  const inpBusqResp = document.getElementById("inp-buscar-resp-actividad");
  if (inpBusqResp) inpBusqResp.value = "";
  const sugResp = document.getElementById("sug-responsables-actividad");
  if (sugResp) sugResp.classList.add("hidden");

  const btnGuardarMulti = document.getElementById("btn-guardar-multi-resp");
  if (btnGuardarMulti) {
    btnGuardarMulti.onclick = async () => {
      const seleccionados = state.listaAsignadosModal.map(r => r.nombre_completo.trim()).filter(Boolean);
      const respFinal = seleccionados.length > 0 ? seleccionados.join("; ") : "No asignado";
      const actRef = state.actividadMultiRespActual;
      const codAct = actRef ? actRef.codigo : null;

      cerrarAsignarResponsables();
      if (!actRef) return;

      actRef.responsable = respFinal;
      poblarFiltroResponsablesDinamico();
      renderizarTabla();

      try {
        const res = await apiFetch("/actividades/responsable", {
          method: "PUT",
          body: JSON.stringify({
            proyecto_id: parseInt(state.proyectoActualId),
            codigo: String(codAct).trim(),
            responsable: respFinal
          })
        });

        if (res.ok) {
          notificarToast("Responsable(s) asignado(s) y guardado(s) correctamente.", "success");
        }
      } catch (e) {
        alert("Error al guardar responsable.");
      }

      // Evaluación de nuevos responsables para notificar por correo
      const inicialesSet = new Set((state.responsablesInicialesEdicion || []).map(n => n.trim().toLowerCase()));
      const nuevos = seleccionados.filter(nom => !inicialesSet.has(nom.toLowerCase()));

      if (nuevos.length > 0) {
        const mensajeNotif = nuevos.length === 1
          ? `¿Desea enviar una notificación por correo electrónico al nuevo responsable asignado (${nuevos[0]})?`
          : `¿Desea enviar una notificación por correo electrónico a los ${nuevos.length} nuevos responsables asignados (${nuevos.join(", ")})?`;

        const deseaNotificar = await confirmModal(mensajeNotif, "Notificación Institucional", "question");
        if (deseaNotificar) {
          abrirModalNotificacionCorreo(actRef, nuevos);
        }
      }
    };
  }

  document.getElementById("modal-asignar-responsables")?.classList.remove("hidden");
}

export function renderizarListaAsignadosModal() {
  const contenedor = document.getElementById("lista-checkbox-responsables");
  if (!contenedor) return;
  contenedor.innerHTML = "";

  if (state.listaAsignadosModal.length === 0) {
    contenedor.innerHTML = `<p class="text-xs text-gray-400 italic text-center p-3">No hay responsables asignados. Use el buscador superior para agregar trabajadores.</p>`;
    return;
  }

  state.listaAsignadosModal.forEach((r, idx) => {
    contenedor.innerHTML += `
      <div class="flex items-center justify-between p-2 rounded-lg bg-gray-50 border border-gray-200 hover:bg-gray-100/80 transition">
        <label class="flex items-center space-x-2.5 cursor-pointer flex-1">
          <input type="checkbox" checked onchange="solicitarDesmarcarResponsable(${idx})" class="rounded text-[#0f2a4a] focus:ring-0">
          <span class="text-xs font-bold text-gray-800">${r.nombre_completo}</span>
        </label>
        <span class="text-[10px] font-bold text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200 whitespace-nowrap ml-2">${r.unidad_organica}</span>
      </div>
    `;
  });
}

export async function solicitarDesmarcarResponsable(idx) {
  const r = state.listaAsignadosModal[idx];
  const seguro = await confirmModal(`¿Está seguro de retirar a '${r.nombre_completo}' de esta actividad?`, "Confirmar Retiro", "warning");
  if (seguro) {
    state.listaAsignadosModal.splice(idx, 1);
    notificarToast(`Se retiró a ${r.nombre_completo}.`, "info");
  }
  renderizarListaAsignadosModal();
}

export function autocompletarResponsableActividad(termino) {
  const term = termino.toLowerCase().trim();
  const divSug = document.getElementById("sug-responsables-actividad");
  if (!divSug) return;

  if (!term) {
    divSug.classList.add("hidden");
    return;
  }

  const matches = (state.catalogoTrabajadoresGlobal || []).filter(t => 
    (t.estado === "ACTIVO" || !t.estado) &&
    (t.nombre_completo.toLowerCase().includes(term) || t.unidad_organica.toLowerCase().includes(term))
  );

  divSug.innerHTML = "";
  if (matches.length === 0) {
    divSug.innerHTML = `<div class="p-2.5 text-gray-400 italic">No se encontraron coincidencias para '${termino}'</div>`;
  } else {
    matches.slice(0, 6).forEach(t => {
      const item = document.createElement("div");
      item.className = "p-2.5 hover:bg-teal-50 cursor-pointer flex justify-between items-center transition";
      item.innerHTML = `
        <span class="font-bold text-[#0f2a4a]">${t.nombre_completo}</span>
        <span class="text-[10px] font-bold text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">${t.unidad_organica}</span>
      `;
      item.onclick = () => {
        const yaExiste = state.listaAsignadosModal.some(a => a.nombre_completo.trim().toLowerCase() === t.nombre_completo.trim().toLowerCase());
        if (!yaExiste) {
          state.listaAsignadosModal.push({
            nombre_completo: t.nombre_completo,
            unidad_organica: t.unidad_organica
          });
          renderizarListaAsignadosModal();
          notificarToast(`Agregado: ${t.nombre_completo}`, "success");
        } else {
          alert(`El trabajador ${t.nombre_completo} ya se encuentra asignado.`);
        }
        document.getElementById("inp-buscar-resp-actividad").value = "";
        divSug.classList.add("hidden");
      };
      divSug.appendChild(item);
    });
  }
  divSug.classList.remove("hidden");
}

export function cerrarAsignarResponsables() {
  document.getElementById("modal-asignar-responsables")?.classList.add("hidden");
  state.actividadMultiRespActual = null;
}

// =========================================================================
// MÓDULO DE NOTIFICACIONES Y ALERTAS PREVENTIVAS DE CIERRE
// =========================================================================
export function abrirModalNotificacionCorreo(act, destinatariosNuevos = []) {
  const modDialog = document.getElementById("modal-dialog-imarpe");
  if (modDialog) modDialog.classList.add("hidden");

  state.actividadNotificacionActual = act;
  state.destinatariosNuevosNotificacion = Array.isArray(destinatariosNuevos) ? destinatariosNuevos : [];
  const duracion = parseInt(act.dias) || 1;

  const textoDestinatarios = state.destinatariosNuevosNotificacion.length > 0 
    ? state.destinatariosNuevosNotificacion.join("; ") 
    : (act.responsable || "Personal");

  const txtAct = document.getElementById("notif-txt-actividad");
  if (txtAct) {
    txtAct.innerHTML = `
      <span class="block text-xs font-bold text-[#0f2a4a]">[${act.codigo}] ${act.descripcion}</span>
      <span class="block text-[11px] font-semibold text-emerald-800 mt-0.5">Destinatario(s) nuevo(s): ${textoDestinatarios}</span>
    `;
  }
  
  const txtDur = document.getElementById("notif-txt-duracion");
  if (txtDur) txtDur.innerText = duracion;
  
  const txtFin = document.getElementById("notif-txt-fin");
  if (txtFin) txtFin.innerText = formatearFechaLatina(act.fecha_fin);
  
  const inpCustom = document.getElementById("notif-input-dias-custom");
  if (inpCustom) inpCustom.value = "";

  const contenedor = document.getElementById("notif-contenedor-opciones-dias");
  if (contenedor) {
    contenedor.innerHTML = "";
    const opcionesPredefinidas = [1, 3, 5, 7];
    let opcionesDisponibles = 0;

    opcionesPredefinidas.forEach(diasAntes => {
      if (diasAntes < duracion) {
        opcionesDisponibles++;
        contenedor.innerHTML += `
          <label class="flex items-center space-x-2 p-1.5 rounded hover:bg-teal-50 cursor-pointer font-bold text-gray-700">
            <input type="checkbox" value="${diasAntes}" class="notif-chk-dia rounded text-teal-600 focus:ring-0 cursor-pointer">
            <span>${diasAntes} ${diasAntes === 1 ? 'día' : 'días'} antes</span>
          </label>
        `;
      }
    });

    if (opcionesDisponibles === 0) {
      contenedor.innerHTML = `<p class="col-span-2 text-gray-400 italic text-[11px] text-center">La actividad dura ${duracion} día(s). Solo se registrará la notificación inicial.</p>`;
    }
  }

  document.getElementById("modal-notificacion-correo")?.classList.remove("hidden");
}

export function cerrarModalNotificacionCorreo() {
  document.getElementById("modal-notificacion-correo")?.classList.add("hidden");
  state.actividadNotificacionActual = null;
  state.destinatariosNuevosNotificacion = [];
}

export async function confirmarEnvioNotificaciones() {
  if (!state.actividadNotificacionActual) {
    cerrarModalNotificacionCorreo();
    return;
  }
  
  const duracion = parseInt(state.actividadNotificacionActual.dias) || 1;
  const seleccionados = Array.from(document.querySelectorAll(".notif-chk-dia:checked")).map(cb => parseInt(cb.value));
  const customInput = document.getElementById("notif-input-dias-custom");
  const customVal = customInput ? parseInt(customInput.value) : NaN;

  if (!isNaN(customVal)) {
    if (customVal >= duracion || customVal <= 0) {
      alert(`⚠️ Plazo personalizado inválido:\nEl valor ingresado (${customVal} días) debe ser estrictamente menor a la duración total de la actividad (${duracion} días).`);
      return;
    }
    if (!seleccionados.includes(customVal)) {
      seleccionados.push(customVal);
    }
  }

  const actRef = state.actividadNotificacionActual;
  const nuevosRef = state.destinatariosNuevosNotificacion;

  cerrarModalNotificacionCorreo();

  try {
    const payload = {
      proyecto_id: parseInt(state.proyectoActualId) || 1,
      codigo_actividad: String(actRef.codigo).trim(),
      destinatarios_nuevos: nuevosRef || [],
      dias_recordatorio: seleccionados.sort((a, b) => b - a)
    };

    const res = await apiFetch("/notificaciones/asignacion", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      notificarToast("Notificación procesada y alertas programadas exitosamente.", "success", 4500);
    }
  } catch (e) {
    alert("Error de comunicación con el servidor al programar notificaciones.");
  }
}