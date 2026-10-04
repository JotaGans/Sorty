import { state } from "../../core/state.js";
import { parsearFechaUniversal } from "../../core/ui-dialogs.js";
import { renderizarTabla } from "./project-wbs.js";

export function obtenerListaResponsablesAsignados(responsablesStr) {
  if (!responsablesStr || responsablesStr === "No asignado" || responsablesStr === "-" || String(responsablesStr).trim() === "") return [];
  const str = String(responsablesStr).trim();
  if (str.includes(";")) return str.split(";").map(s => s.trim()).filter(Boolean);
  return [str];
}

export function obtenerAvatarHTML(responsablesStr) {
  const listaNombres = obtenerListaResponsablesAsignados(responsablesStr);
  if (listaNombres.length === 0) {
    return `<div class="w-6 h-6 rounded-full bg-gray-300 text-gray-600 flex items-center justify-center text-[10px] font-bold mx-auto" title="Sin responsable">?</div>`;
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
  const finCalendario = new Date(maxAnio + 1, 11, 31);
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

  while (currSem <= finCalendario || currSem.getFullYear() <= maxAnio + 1) {
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

// Función auxiliar para obtener la ventana de tiempo según el modo y el offset del scroll
function calcularVentanaTemporal() {
  const modo = state.modoZoom || "semanas";
  const offset = Math.max(0, state.semanaInicioIndex || 0);

  if (modo === "dias") {
    const ventanaDias = 28;
    const maxOffset = Math.max(0, state.diasTotalesAnio.length - ventanaDias);
    const startIdx = Math.min(maxOffset, offset * 7);
    const dias = state.diasTotalesAnio.slice(startIdx, startIdx + ventanaDias);
    if (!dias.length) return null;
    const tIni = dias[0].fecha.getTime();
    const ultDia = dias[dias.length - 1].fecha;
    const tFin = new Date(ultDia.getFullYear(), ultDia.getMonth(), ultDia.getDate(), 23, 59, 59).getTime();
    return { modo, items: dias, tIni, tFin, duracion: tFin - tIni };
  }

  if (modo === "meses") {
    // 1 unidad de scroll = 1 mes desplazado
    const baseYear = new Date().getFullYear();
    const startMonthTotal = (baseYear * 12) + Math.floor(offset / 4);
    const mesesItems = [];
    for (let i = 0; i < 12; i++) {
      const currentMonthTotal = startMonthTotal + i;
      const y = Math.floor(currentMonthTotal / 12);
      const m = currentMonthTotal % 12;
      mesesItems.push({ anio: y, mes: m, nombre: state.nombresMeses[m].substring(0, 3) });
    }
    const tIni = new Date(mesesItems[0].anio, mesesItems[0].mes, 1).getTime();
    const tFin = new Date(mesesItems[11].anio, mesesItems[11].mes + 1, 0, 23, 59, 59).getTime();
    return { modo, items: mesesItems, tIni, tFin, duracion: tFin - tIni };
  }

  if (modo === "trimestres") {
    // 1 unidad de scroll = 1 trimestre desplazado
    const baseYear = new Date().getFullYear();
    const startQTotal = (baseYear * 4) + Math.floor(offset / 12);
    const trimestresItems = [];
    for (let i = 0; i < 8; i++) {
      const currQ = startQTotal + i;
      const y = Math.floor(currQ / 4);
      const q = (currQ % 4) + 1;
      trimestresItems.push({ anio: y, q: `T${q}`, startMonth: (q - 1) * 3 });
    }
    const tIni = new Date(trimestresItems[0].anio, trimestresItems[0].startMonth, 1).getTime();
    const tFin = new Date(trimestresItems[7].anio, trimestresItems[7].startMonth + 3, 0, 23, 59, 59).getTime();
    return { modo, items: trimestresItems, tIni, tFin, duracion: tFin - tIni };
  }

  if (modo === "semestres") {
    // 1 unidad de scroll = 1 semestre desplazado
    const baseYear = new Date().getFullYear();
    const startSTotal = (baseYear * 2) + Math.floor(offset / 24);
    const semestresItems = [];
    for (let i = 0; i < 6; i++) {
      const currS = startSTotal + i;
      const y = Math.floor(currS / 2);
      const s = (currS % 2) + 1;
      semestresItems.push({ anio: y, s: `S${s}`, startMonth: (s - 1) * 6 });
    }
    const tIni = new Date(semestresItems[0].anio, semestresItems[0].startMonth, 1).getTime();
    const tFin = new Date(semestresItems[5].anio, semestresItems[5].startMonth + 6, 0, 23, 59, 59).getTime();
    return { modo, items: semestresItems, tIni, tFin, duracion: tFin - tIni };
  }

  // Semanas (modo por defecto)
  const ventanaSemanas = 16;
  const maxOffset = Math.max(0, state.semanasTotales.length - ventanaSemanas);
  const startIdx = Math.min(maxOffset, offset);
  const semanas = state.semanasTotales.slice(startIdx, startIdx + ventanaSemanas);
  if (!semanas.length) return null;
  const tIni = semanas[0].fechaLunes.getTime();
  const tFin = new Date(semanas[semanas.length - 1].fechaDomingo).getTime();
  return { modo: "semanas", items: semanas, tIni, tFin, duracion: tFin - tIni };
}

export function renderizarCabeceraGantt() {
  const divMeses = document.getElementById("gantt-header-meses");
  const divSemanas = document.getElementById("gantt-header-semanas");
  if (!divMeses || !divSemanas) return;

  divMeses.innerHTML = "";
  divSemanas.innerHTML = "";

  const ventana = calcularVentanaTemporal();
  if (!ventana) return;

  if (ventana.modo === "dias") {
    const gruposMes = [];
    let mesActual = null, mesNombreSolo = null, anioSolo = null, contador = 0;

    ventana.items.forEach(d => {
      const label = `${d.mesNombre} ${d.anio}`;
      if (mesActual === null || mesActual !== label) {
        if (mesActual !== null) gruposMes.push({ nombreCompleto: mesActual, count: contador });
        mesActual = label;
        contador = 1;
      } else contador++;
    });
    if (mesActual !== null) gruposMes.push({ nombreCompleto: mesActual, count: contador });

    gruposMes.forEach(g => {
      const pct = (g.count / ventana.items.length) * 100;
      divMeses.innerHTML += `<div style="width: ${pct}%;" class="text-center font-black border-r border-[#1c335a] text-[10px] tracking-wide text-teal-200 overflow-hidden whitespace-nowrap truncate px-0.5">${g.nombreCompleto}</div>`;
    });

    ventana.items.forEach(d => {
      const esFinSemana = (d.diaSemana === 0 || d.diaSemana === 6);
      const claseHoy = d.esHoy ? "bg-teal-500 text-white font-black rounded-xs shadow" : (esFinSemana ? "text-gray-400 bg-blue-950/40" : "text-teal-300 opacity-90");
      divSemanas.innerHTML += `<div class="flex-1 text-center py-0.5 border-r border-[#1c335a] text-[9px] font-mono overflow-hidden whitespace-nowrap ${claseHoy}">${d.dia}</div>`;
    });
    return;
  }

  if (ventana.modo === "semanas") {
    const gruposMes = [];
    let mesActual = null, contador = 0;

    ventana.items.forEach(s => {
      const label = `${s.mesNombre} ${s.anio}`;
      if (mesActual === null || mesActual !== label) {
        if (mesActual !== null) gruposMes.push({ nombreCompleto: mesActual, count: contador });
        mesActual = label;
        contador = 1;
      } else contador++;
    });
    if (mesActual !== null) gruposMes.push({ nombreCompleto: mesActual, count: contador });

    gruposMes.forEach(g => {
      const pct = (g.count / ventana.items.length) * 100;
      divMeses.innerHTML += `<div style="width: ${pct}%;" class="text-center font-bold border-r border-[#1c335a] text-[10px] overflow-hidden whitespace-nowrap truncate px-0.5">${g.nombreCompleto}</div>`;
    });

    ventana.items.forEach(s => {
      const claseHoy = s.esHoy ? "header-semana-actual rounded-sm shadow" : "opacity-90";
      divSemanas.innerHTML += `<div class="flex-1 text-center py-0.5 border-r border-[#1c335a] text-[9px] font-mono overflow-hidden whitespace-nowrap ${claseHoy}">${s.dia}</div>`;
    });
    return;
  }

  if (ventana.modo === "meses") {
    const aniosUnicos = [...new Set(ventana.items.map(m => m.anio))];
    aniosUnicos.forEach(y => {
      const count = ventana.items.filter(m => m.anio === y).length;
      const pct = (count / ventana.items.length) * 100;
      divMeses.innerHTML += `<div style="width: ${pct}%;" class="text-center font-black border-r border-[#1c335a] text-[10px] text-teal-200 tracking-widest">${y}</div>`;
    });

    const mesActualNum = new Date().getMonth();
    const anioActualNum = new Date().getFullYear();

    ventana.items.forEach(m => {
      const esHoy = (m.anio === anioActualNum && m.mes === mesActualNum);
      const claseHoy = esHoy ? "bg-teal-500 text-white font-black" : "text-teal-200";
      divSemanas.innerHTML += `<div class="flex-1 text-center py-0.5 border-r border-[#1c335a] text-[9.5px] font-bold overflow-hidden ${claseHoy}">${m.nombre}</div>`;
    });
    return;
  }

  if (ventana.modo === "trimestres") {
    const aniosUnicos = [...new Set(ventana.items.map(t => t.anio))];
    aniosUnicos.forEach(y => {
      const count = ventana.items.filter(t => t.anio === y).length;
      const pct = (count / ventana.items.length) * 100;
      divMeses.innerHTML += `<div style="width: ${pct}%;" class="text-center font-black border-r border-[#1c335a] text-[10px] text-teal-200">${y}</div>`;
    });

    ventana.items.forEach(t => {
      divSemanas.innerHTML += `<div class="flex-1 text-center py-0.5 border-r border-[#1c335a] text-[9.5px] font-bold text-teal-200">${t.q}</div>`;
    });
    return;
  }

  if (ventana.modo === "semestres") {
    const aniosUnicos = [...new Set(ventana.items.map(s => s.anio))];
    aniosUnicos.forEach(y => {
      const count = ventana.items.filter(s => s.anio === y).length;
      const pct = (count / ventana.items.length) * 100;
      divMeses.innerHTML += `<div style="width: ${pct}%;" class="text-center font-black border-r border-[#1c335a] text-[10px] text-teal-200">${y}</div>`;
    });

    ventana.items.forEach(s => {
      divSemanas.innerHTML += `<div class="flex-1 text-center py-0.5 border-r border-[#1c335a] text-[9.5px] font-bold text-teal-200">${s.s}</div>`;
    });
  }
}

export function renderizarGanttFila(act, esMadre, codLimpio) {
  const ventana = calcularVentanaTemporal();
  if (!ventana) return "";

  const tInicioVisible = ventana.tIni;
  const tFinVisible = ventana.tFin;
  const duracionVisibleMs = ventana.duracion;

  const mostrarAvatares = (state.visibilidadColumnas.avatares_gantt !== false);
  const mostrarPorcentajes = (state.visibilidadColumnas.porcentajes_gantt !== false);

  let divisionesHTML = "";
  if (ventana.modo === "dias") {
    divisionesHTML = ventana.items.map(d => `<div class="flex-1 border-r border-slate-200/40 ${d.esHoy ? 'bg-teal-500/10' : ''}"></div>`).join("");
  } else if (ventana.modo === "semanas") {
    divisionesHTML = ventana.items.map(s => `<div class="flex-1 border-r border-slate-200/50 ${s.esHoy ? 'col-semana-actual' : ''}"></div>`).join("");
  } else {
    divisionesHTML = ventana.items.map(() => `<div class="flex-1 border-r border-slate-200/50"></div>`).join("");
  }

  const dtIniObj = parsearFechaUniversal(act.fecha_inicio);
  const dtFinObj = parsearFechaUniversal(act.fecha_fin);
  let barraOElementoHTML = "";

  if (dtIniObj && dtFinObj) {
    const dtIni = dtIniObj.getTime();
    const dtFin = new Date(dtFinObj.getFullYear(), dtFinObj.getMonth(), dtFinObj.getDate(), 23, 59, 59).getTime();

    if (dtFin >= tInicioVisible && dtIni <= tFinVisible) {
      const startClamped = Math.max(dtIni, tInicioVisible);
      const endClamped = Math.min(dtFin, tFinVisible);
      const leftPct = Math.min(100, Math.max(0, ((startClamped - tInicioVisible) / duracionVisibleMs) * 100));
      const widthPct = Math.min(100 - leftPct, Math.max(1.2, ((endClamped - startClamped) / duracionVisibleMs) * 100));
      const miniAvataresHTML = mostrarAvatares ? obtenerMiniAvataresGanttHTML(act.responsable) : '';
      const esBarraDelgada = widthPct < 5.0;

      if (esMadre) {
        barraOElementoHTML = `
          <div class="absolute top-1.5 bottom-1.5 z-10 pointer-events-none" style="left: ${leftPct}%; width: ${widthPct}%;">
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
        const esActividadCritica = state.capaCpmActiva && state.datosCpmGlobal?.actividadesCriticas?.has(codLimpio);

        if (state.capaCpmActiva) {
          colorFondoRestante = esActividadCritica ? "#dc2626" : "#cbd5e1";
          colorBorde = esActividadCritica ? "border-red-800" : "border-slate-300";
        } else {
          if (act.estado === "Ejecutado") { colorFondoRestante = "#2ecc71"; colorBorde = "border-emerald-600"; }
          else if (act.estado === "En proceso") { colorFondoRestante = "#f1c40f"; colorBorde = "border-amber-500"; }
        }

        let subAvanceHTML = "";
        let textoDentroDeBarra = "";
        let textoFlotanteHTML = "";

        if (mostrarPorcentajes && !state.capaCpmActiva) {
          if (act.estado === "En proceso") {
            if (act.avance > 0) subAvanceHTML = `<div class="absolute top-0 bottom-0 left-0 bg-[#d35400] rounded-l-md flex items-center justify-center text-[9px] font-black text-white shadow-inner" style="width: ${act.avance}%;"></div>`;
            if (!esBarraDelgada && widthPct >= 7.0) textoDentroDeBarra = `<div class="absolute inset-0 flex items-center justify-center text-[9px] font-black text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] z-10 pointer-events-none">${act.avance}%</div>`;
            else textoFlotanteHTML = `<span class="text-[9px] font-bold text-gray-700 bg-white/90 px-1 rounded border border-gray-200 shadow-xs mr-1">${act.avance}%</span>`;
          } else if (act.estado === "Ejecutado") {
            if (!esBarraDelgada) textoDentroDeBarra = `<div class="w-full h-full flex items-center justify-center text-[9px] font-black text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">100%</div>`;
            else textoFlotanteHTML = `<span class="text-[9px] font-bold text-gray-700 bg-white/90 px-1 rounded border border-gray-200 shadow-xs mr-1">100%</span>`;
          } else {
            textoFlotanteHTML = `<span class="text-[9px] font-bold text-gray-700 bg-white/90 px-1 rounded border border-gray-200 shadow-xs mr-1">0%</span>`;
          }
        }

        const opacidadCpm = (state.capaCpmActiva && !esActividadCritica && !esMadre) ? "opacity-35" : "opacity-100";

        barraOElementoHTML = `
          <div class="absolute bg-slate-300/70 rounded h-[2px] bottom-0.5" style="left: ${leftPct}%; width: ${widthPct}%;"></div>
          <div class="absolute top-1 bottom-1 z-10 rounded-md border ${colorBorde} shadow-sm overflow-hidden ${opacidadCpm}" style="left: ${leftPct}%; width: ${widthPct}%; background-color: ${colorFondoRestante};">
            ${!state.capaCpmActiva ? subAvanceHTML : ''}
            ${!state.capaCpmActiva ? textoDentroDeBarra : ''}
          </div>
          <div class="absolute flex items-center top-1 z-20 pointer-events-none ${opacidadCpm}" style="left: calc(${leftPct + widthPct}% + 4px);">
            ${!state.capaCpmActiva ? textoFlotanteHTML : ''}
            ${miniAvataresHTML}
          </div>
        `;
      }
    }
  }

  return `
    <div class="relative w-full h-7 bg-[#f8fafc] rounded border border-slate-200/80 overflow-hidden">
      <div class="absolute inset-0 flex pointer-events-none opacity-60">${divisionesHTML}</div>
      ${barraOElementoHTML}
    </div>
  `;
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
    fijarSemanaInicio(indexEncontrado >= 0 ? Math.max(1, indexEncontrado) : 1);
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

  const boxSem = document.getElementById("box-input-semana");
  if (boxSem) {
    if (modo === "dias" || modo === "semanas") {
      boxSem.classList.remove("sem-oculto");
    } else {
      boxSem.classList.add("sem-oculto");
    }
  }

  renderizarCabeceraGantt();
  renderizarTabla();
}