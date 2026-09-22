import { state } from "../core/state.js";
import { apiFetch } from "../core/api.js";
import { notificarToast, confirmModal } from "../core/ui-dialogs.js";

export async function abrirModalAdminTI() {
  if (!state.token) return;
  const modal = document.getElementById("modal-admin-ti");
  if (!modal) return;
  modal.classList.remove("hidden");
  cambiarTabTI("trabajadores");

  await Promise.all([
    cargarDirectorioTrabajadores(),
    cargarCatalogoUnidades(),
    cargarListaFeriados(),
    cargarListaProcesosTI()
  ]);
}

export function cerrarModalAdminTI() {
  const modal = document.getElementById("modal-admin-ti");
  if (modal) modal.classList.add("hidden");
}

export function cambiarTabTI(tab) {
  state.tabTIActiva = tab;
  const tabs = ["trabajadores", "unidades", "feriados", "procesos"];

  tabs.forEach(t => {
    const btn = document.getElementById(`ti-tab-btn-${t}`);
    const content = document.getElementById(`ti-tab-content-${t}`);
    if (!btn || !content) return;

    if (t === tab) {
      btn.className = "px-3.5 py-2 rounded-t-lg bg-white text-[#0f2a4a] border-t border-l border-r border-gray-200 shadow-xs font-bold whitespace-nowrap cursor-pointer";
      content.classList.remove("hidden");
    } else {
      btn.className = "px-3.5 py-2 rounded-t-lg text-gray-500 hover:text-[#0f2a4a] transition font-bold whitespace-nowrap cursor-pointer";
      content.classList.add("hidden");
    }
  });

  if (tab === "trabajadores") cargarDirectorioTrabajadores();
  if (tab === "unidades") cargarCatalogoUnidades();
  if (tab === "feriados") cargarListaFeriados();
  if (tab === "procesos") cargarListaProcesosTI();
}

// --- TRABAJADORES ---
export async function cargarDirectorioTrabajadores() {
  const tbody = document.getElementById("tra-tabla-directorio");
  if (tbody && (!state.catalogoTrabajadoresGlobal || state.catalogoTrabajadoresGlobal.length === 0)) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-gray-400 font-semibold animate-pulse">Cargando directorio de trabajadores...</td></tr>`;
  }

  try {
    const res = await apiFetch("/trabajadores");
    if (!res.ok) throw new Error("Error al consultar trabajadores");
    state.catalogoTrabajadoresGlobal = await res.json();
    renderizarDirectorioTrabajadores(state.catalogoTrabajadoresGlobal);
  } catch (e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-red-500 font-semibold">Error al cargar directorio.</td></tr>`;
  }
}

export function filtrarDirectorioTrabajadores() {
  const q = (document.getElementById("tra-filtro-directorio")?.value || "").toLowerCase().trim();
  const filtrados = (state.catalogoTrabajadoresGlobal || []).filter(t =>
    (t.nombre_completo && t.nombre_completo.toLowerCase().includes(q)) ||
    (t.unidad_organica && t.unidad_organica.toLowerCase().includes(q)) ||
    (t.correo && t.correo.toLowerCase().includes(q))
  );
  renderizarDirectorioTrabajadores(filtrados);
}

export function renderizarDirectorioTrabajadores(lista) {
  const tbody = document.getElementById("tra-tabla-directorio");
  if (!tbody) return;
  tbody.innerHTML = "";
  actualizarBotonTrabajadoresBajaUI();

  const activos = (lista || []).filter(t => t.estado === "ACTIVO" || !t.estado);
  if (activos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-gray-400 font-semibold italic">No se encontraron trabajadores activos con ese criterio.</td></tr>`;
    return;
  }

  activos.forEach(t => {
    const usuarioLogin = (t.correo || "").split("@")[0];
    const cargoTexto = t.cargo || "Sin cargo / nivel";
    const badgeCargo = t.es_directivo === 1
      ? `<span class="bg-purple-50 text-purple-800 border border-purple-200 px-1.5 py-0.5 rounded text-[10px] font-bold">🏛️ ${cargoTexto}</span>`
      : `<span class="text-gray-600 font-semibold text-[11px]">${cargoTexto}</span>`;

    tbody.innerHTML += `
      <tr class="hover:bg-gray-50 border-b border-gray-100">
        <td class="p-2.5 font-bold text-gray-800 text-xs">${t.nombre_completo}</td>
        <td class="p-2.5 font-semibold text-teal-800"><span class="bg-teal-50 px-2 py-0.5 rounded border border-teal-200 text-xs">${t.unidad_organica}</span></td>
        <td class="p-2.5 whitespace-nowrap">${badgeCargo}</td>
        <td class="p-2.5 font-mono text-gray-600 text-xs">@${usuarioLogin}</td>
        <td class="p-2.5 text-center whitespace-nowrap"><span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black bg-emerald-100 text-emerald-800">ACTIVO</span></td>
        <td class="p-2.5 text-center whitespace-nowrap space-x-1.5">
          <button onclick="abrirModalEditarTrabajador(${t.id})" class="p-1 rounded text-blue-600 hover:text-blue-800 hover:bg-blue-50 font-bold cursor-pointer" title="Editar">✏️</button>
          <button onclick="solicitarDarDeBajaTrabajador(${t.id}, '${t.nombre_completo.replace(/'/g, "\\'")}')" class="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200 cursor-pointer">DAR DE BAJA</button>
        </td>
      </tr>
    `;
  });
}

export function abrirModalEditarTrabajador(id) {
  const t = (state.catalogoTrabajadoresGlobal || []).find(item => item.id === id);
  if (!t) return;

  document.getElementById("edit-tra-id").value = t.id;
  document.getElementById("edit-tra-nombres").value = t.nombres || (t.nombre_completo ? t.nombre_completo.split(", ")[1] || t.nombre_completo : "");
  document.getElementById("edit-tra-apellidos").value = t.apellidos || (t.nombre_completo ? t.nombre_completo.split(", ")[0] || "" : "");
  
  const uoInputBusq = document.getElementById("edit-tra-uo-busq");
  const uoInputVal = document.getElementById("edit-tra-uo-valor");
  if (uoInputBusq) uoInputBusq.value = t.unidad_organica || "";
  if (uoInputVal) uoInputVal.value = t.unidad_organica || "";

  const cargoSelect = document.getElementById("edit-tra-cargo");
  if (cargoSelect) cargoSelect.value = t.cargo || "Sin cargo / nivel";

  const nivelMandoSelect = document.getElementById("edit-tra-nivel-mando");
  if (nivelMandoSelect) nivelMandoSelect.value = String(t.es_directivo || 0);

  const usuarioLogin = (t.correo || "").split("@")[0];
  document.getElementById("edit-tra-correo-user").value = usuarioLogin;

  document.getElementById("modal-editar-trabajador-ti")?.classList.remove("hidden");
}

export function cerrarModalEditarTrabajador() {
  document.getElementById("modal-editar-trabajador-ti")?.classList.add("hidden");
  document.getElementById("edit-tra-sugerencias-uo")?.classList.add("hidden");
}

export function autocompletarUOEdicion(termino) {
  const term = (termino || "").toLowerCase().trim();
  const divSug = document.getElementById("edit-tra-sugerencias-uo");
  if (!divSug) return;

  if (!term) {
    divSug.innerHTML = "";
    divSug.classList.add("hidden");
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
      item.innerHTML = `<span class="text-gray-800">${u.nombre}</span><strong class="text-[#0f2a4a] ml-2 bg-slate-100 px-1.5 py-0.5 rounded border text-[11px]">[${u.sigla}]</strong>`;
      item.onclick = () => {
        document.getElementById("edit-tra-uo-busq").value = `${u.sigla} - ${u.nombre}`;
        document.getElementById("edit-tra-uo-valor").value = u.sigla;
        divSug.classList.add("hidden");
      };
      divSug.appendChild(item);
    });
  }
  divSug.classList.remove("hidden");
}

export async function guardarEdicionTrabajador(e) {
  e.preventDefault();
  const id = document.getElementById("edit-tra-id").value;
  const nombres = document.getElementById("edit-tra-nombres").value.trim();
  const apellidos = document.getElementById("edit-tra-apellidos").value.trim();
  const uo = document.getElementById("edit-tra-uo-valor").value || document.getElementById("edit-tra-uo-busq").value.trim();
  const cargo = document.getElementById("edit-tra-cargo").value;
  const esDirectivo = parseInt(document.getElementById("edit-tra-nivel-mando").value || "0");
  const usuarioLogin = document.getElementById("edit-tra-correo-user").value.trim();

  if (!nombres || !apellidos || !uo || !usuarioLogin) {
    alert("Por favor complete todos los campos obligatorios.");
    return;
  }

  try {
    const res = await apiFetch(`/trabajadores/${id}`, {
      method: "PUT",
      body: JSON.stringify({ nombres, apellidos, unidad_organica: uo, cargo, es_directivo: esDirectivo, correo_usuario: usuarioLogin })
    });

    if (res.ok) {
      cerrarModalEditarTrabajador();
      notificarToast("Datos del trabajador actualizados con éxito.", "success");
      await cargarDirectorioTrabajadores();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || "Error al actualizar los datos del trabajador.");
    }
  } catch (error) {
    alert("Error de conexión al guardar cambios.");
  }
}

export async function registrarTrabajadorTI(e) {
  e.preventDefault();
  const nombres = document.getElementById("tra-input-nombres").value.trim();
  const apellidos = document.getElementById("tra-input-apellidos").value.trim();
  const uo = document.getElementById("tra-input-uo-valor").value || document.getElementById("tra-input-uo-busq").value.trim();
  const correo_user = document.getElementById("tra-input-correo-user").value.trim();
  const cargo = document.getElementById("tra-input-cargo")?.value.trim() || "Sin cargo / nivel";
  const esDirectivo = parseInt(document.getElementById("tra-input-nivel-mando")?.value || "0");
  const crearAcceso = document.getElementById("tra-chk-crear-acceso")?.checked !== false;
  const passInicial = document.getElementById("tra-input-pass-inicial")?.value.trim() || "imarpe123";

  if (!nombres || !apellidos || !uo || !correo_user) {
    alert("Por favor complete todos los campos requeridos.");
    return;
  }

  try {
    const res = await apiFetch("/trabajadores", {
      method: "POST",
      body: JSON.stringify({ nombres, apellidos, unidad_organica: uo, correo_usuario: correo_user, cargo, es_directivo: esDirectivo, crear_acceso: crearAcceso, password_inicial: passInicial, rol_sistema: "OPERADOR" })
    });

    if (res.ok) {
      notificarToast("Trabajador registrado exitosamente.", "success");
      document.getElementById("tra-input-nombres").value = "";
      document.getElementById("tra-input-apellidos").value = "";
      document.getElementById("tra-input-uo-busq").value = "";
      document.getElementById("tra-input-uo-valor").value = "";
      document.getElementById("tra-input-correo-user").value = "";
      await cargarDirectorioTrabajadores();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || "Error al registrar trabajador.");
    }
  } catch (err) {
    alert("Error de comunicación con el servidor.");
  }
}

export function autocompletarUnidadOrganica(termino) {
  const term = (termino || "").toLowerCase().trim();
  const divSug = document.getElementById("tra-sugerencias-uo");
  if (!divSug) return;

  if (!term) {
    divSug.innerHTML = "";
    divSug.classList.add("hidden");
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
      item.innerHTML = `<span class="text-gray-800">${u.nombre}</span><strong class="text-[#0f2a4a] ml-2 bg-slate-100 px-1.5 py-0.5 rounded border text-[11px]">[${u.sigla}]</strong>`;
      item.onclick = () => {
        document.getElementById("tra-input-uo-busq").value = `${u.sigla} - ${u.nombre}`;
        document.getElementById("tra-input-uo-valor").value = u.sigla;
        divSug.classList.add("hidden");
      };
      divSug.appendChild(item);
    });
  }
  divSug.classList.remove("hidden");
}

export async function alternarEstadoTrabajador(id) {
  try {
    const res = await apiFetch(`/trabajadores/estado/${id}`, { method: "POST" });
    if (res.ok) {
      notificarToast("Estado de trabajador actualizado.", "info");
      await cargarDirectorioTrabajadores();
      const modalBaja = document.getElementById("modal-trabajadores-baja");
      if (modalBaja && !modalBaja.classList.contains("hidden")) renderizarTablaTrabajadoresBaja();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || "No se pudo cambiar el estado.");
    }
  } catch (e) {
    alert("Error de conexión con el servidor.");
  }
}

export async function solicitarDarDeBajaTrabajador(id, nombre) {
  const confirma = await confirmModal(`¿Está seguro de dar de baja al trabajador '${nombre}'?`, "Confirmar Baja", "warning");
  if (!confirma) return;
  await alternarEstadoTrabajador(id);
}

export function actualizarBotonTrabajadoresBajaUI() {
  const btnBaja = document.getElementById("btn-ver-trabajadores-baja");
  const txtCont = document.getElementById("txt-contador-tra-baja");
  if (!btnBaja) return;

  const inactivos = (state.catalogoTrabajadoresGlobal || []).filter(t => t.estado === "INACTIVO");
  const cant = inactivos.length;
  btnBaja.classList.remove("hidden");
  if (txtCont) txtCont.innerText = `Trabajadores de baja (${cant})`;

  btnBaja.className = cant > 0
    ? "px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 transition flex items-center space-x-1 cursor-pointer shadow-xs"
    : "px-2.5 py-1 rounded-lg text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-600 border border-gray-300 transition flex items-center space-x-1 cursor-pointer";
}

export function abrirModalTrabajadoresBaja() {
  const modal = document.getElementById("modal-trabajadores-baja");
  if (!modal) return;
  const inp = document.getElementById("filtro-trabajadores-baja-input");
  if (inp) inp.value = "";
  renderizarTablaTrabajadoresBaja();
  modal.classList.remove("hidden");
}

export function cerrarModalTrabajadoresBaja() {
  document.getElementById("modal-trabajadores-baja")?.classList.add("hidden");
}

export function filtrarTrabajadoresBajaModal() {
  const q = (document.getElementById("filtro-trabajadores-baja-input")?.value || "").toLowerCase().trim();
  renderizarTablaTrabajadoresBaja(q);
}

export function renderizarTablaTrabajadoresBaja(query = "") {
  const tbody = document.getElementById("tabla-trabajadores-baja-body");
  const txtCant = document.getElementById("txt-baja-resumen-cant");
  if (!tbody) return;
  tbody.innerHTML = "";

  const inactivos = (state.catalogoTrabajadoresGlobal || []).filter(t => t.estado === "INACTIVO");
  if (txtCant) txtCant.innerText = `${inactivos.length} trabajador(es) archivado(s)`;

  const filtrados = inactivos.filter(t =>
    (t.nombre_completo && t.nombre_completo.toLowerCase().includes(query)) ||
    (t.unidad_organica && t.unidad_organica.toLowerCase().includes(query)) ||
    (t.correo && t.correo.toLowerCase().includes(query))
  );

  if (filtrados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-gray-400 font-semibold italic">No hay trabajadores dados de baja registrados.</td></tr>`;
    return;
  }

  filtrados.forEach(t => {
    tbody.innerHTML += `
      <tr class="hover:bg-gray-50 border-b border-gray-100">
        <td class="p-2.5 font-bold text-gray-700">${t.nombre_completo}</td>
        <td class="p-2.5 font-semibold text-gray-500"><span class="bg-gray-100 px-2 py-0.5 rounded border border-gray-200 text-[11px]">${t.unidad_organica}</span></td>
        <td class="p-2.5 font-mono text-gray-500 text-xs">${t.correo}</td>
        <td class="p-2.5 text-center whitespace-nowrap">
          <button onclick="solicitarReactivarTrabajador(${t.id}, '${t.nombre_completo.replace(/'/g, "\\'")}')" class="px-3 py-1 rounded text-[10px] font-black uppercase bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-300 transition cursor-pointer shadow-xs">✓ REACTIVAR</button>
        </td>
      </tr>
    `;
  });
}

export async function solicitarReactivarTrabajador(id, nombre) {
  const confirma = await confirmModal(`¿Desea reactivar a '${nombre}' e integrarlo(a) al directorio activo?`, "Reactivar Trabajador", "question");
  if (!confirma) return;

  try {
    const res = await apiFetch(`/trabajadores/estado/${id}`, { method: "PUT" });
    if (res.ok) {
      notificarToast(`Trabajador '${nombre}' reactivado exitosamente.`, "success");
      await cargarDirectorioTrabajadores();
      const inactivosRestantes = (state.catalogoTrabajadoresGlobal || []).filter(t => t.estado === "INACTIVO");
      if (inactivosRestantes.length === 0) cerrarModalTrabajadoresBaja();
      else renderizarTablaTrabajadoresBaja();
    } else {
      alert("No se pudo reactivar al trabajador.");
    }
  } catch (e) {
    alert("Error de conexión al reactivar trabajador.");
  }
}

// --- UNIDADES DE ORGANIZACIÓN ---
export async function cargarCatalogoUnidades() {
  const tbody = document.getElementById("uo-tabla-cuerpo");
  try {
    const promesas = [apiFetch("/unidades-organicas")];
    if (!state.catalogoTrabajadoresGlobal || state.catalogoTrabajadoresGlobal.length === 0) {
      promesas.push(apiFetch("/trabajadores").catch(() => null));
    }
    const [resUo, resTrab] = await Promise.all(promesas);
    if (resTrab && resTrab.ok) state.catalogoTrabajadoresGlobal = await resTrab.json();
    if (!resUo.ok) throw new Error("Error cargando UO");

    state.catalogoUnidadesGlobal = await resUo.json();
    if (!tbody) return;

    if (!state.catalogoUnidadesGlobal || state.catalogoUnidadesGlobal.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-gray-400 italic">No hay unidades registradas.</td></tr>`;
      return;
    }

    const listaPersonas = (state.catalogoTrabajadoresGlobal && state.catalogoTrabajadoresGlobal.length > 0) ? state.catalogoTrabajadoresGlobal : (state.usuariosTIGlobal || []);

    const selPadre = document.getElementById("uo-input-padre");
    if (selPadre) {
      let opcionesFormPadre = '<option value="">(Ninguna unidad de organización)</option>';
      state.catalogoUnidadesGlobal.forEach(u => {
        opcionesFormPadre += `<option value="${u.sigla}">[${u.sigla}] ${u.nombre}</option>`;
      });
      selPadre.innerHTML = opcionesFormPadre;
    }

    let htmlFilas = "";
    state.catalogoUnidadesGlobal.forEach(u => {
      const siglaPadreActual = String(u.sigla_padre || "").trim().toUpperCase();
      let opcionesPadre = `<option value="" ${siglaPadreActual === "" ? "selected" : ""}>(Nivel Máximo / Alta Dirección)</option>`;
      
      state.catalogoUnidadesGlobal.forEach(padreCand => {
        const siglaCand = String(padreCand.sigla || "").trim().toUpperCase();
        if (siglaCand !== String(u.sigla).trim().toUpperCase()) {
          const estaSeleccionado = (siglaPadreActual === siglaCand) ? "selected" : "";
          opcionesPadre += `<option value="${padreCand.sigla}" ${estaSeleccionado}>[${padreCand.sigla}] ${padreCand.nombre}</option>`;
        }
      });

      let opcionesTitular = '<option value="">(Sin titular asignado)</option>';
      listaPersonas.forEach(p => {
        const pId = p.id;
        const pNombre = p.nombre_completo || p.username;
        const pCargo = p.cargo ? ` - ${p.cargo}` : '';
        const estaAsignado = (u.titular_trabajador_id === pId || u.titular_usuario_id === pId);
        opcionesTitular += `<option value="${pId}" ${estaAsignado ? 'selected' : ''}>${pNombre}${pCargo}</option>`;
      });

      htmlFilas += `
        <tr class="hover:bg-gray-50 border-b border-gray-100 transition">
          <td class="p-2.5 font-bold text-[#0f2a4a] text-xs font-mono whitespace-nowrap">${u.sigla}</td>
          <td class="p-2.5 font-semibold text-gray-800 text-xs">${u.nombre}</td>
          <td class="p-2.5 min-w-[220px]">
            <select onchange="actualizarDependenciaROF(${u.id}, this.value, '${u.sigla}')" class="w-full text-[11px] font-bold p-1.5 bg-slate-50 border border-gray-300 rounded-lg outline-none focus:border-[#0f2a4a] cursor-pointer text-slate-700">
              ${opcionesPadre}
            </select>
          </td>
          <td class="p-2.5 min-w-[210px]">
            <select onchange="asignarTitularUnidad(${u.id}, this.value, '${u.sigla}')" class="w-full text-[11px] font-semibold p-1.5 bg-slate-50 border border-gray-300 rounded-lg outline-none focus:border-[#0f2a4a] cursor-pointer">
              ${opcionesTitular}
            </select>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = htmlFilas;
  } catch (e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-rose-500 font-semibold">Error al cargar unidades.</td></tr>`;
  }
}

export async function registrarNuevaUnidadOrganica(e) {
  e.preventDefault();
  const nombre = document.getElementById("uo-input-nombre").value.trim();
  const sigla = document.getElementById("uo-input-sigla").value.trim().toUpperCase();
  const siglaPadre = document.getElementById("uo-input-padre")?.value || null;

  if (!nombre || !sigla) {
    alert("Por favor ingrese el nombre y la sigla de la unidad.");
    return;
  }

  try {
    const res = await apiFetch("/unidades-organicas", {
      method: "POST",
      body: JSON.stringify({ nombre, sigla, sigla_padre: siglaPadre ? siglaPadre.trim() : null })
    });

    if (res.ok) {
      notificarToast(`Unidad [${sigla}] registrada exitosamente.`, "success");
      document.getElementById("uo-input-nombre").value = "";
      document.getElementById("uo-input-sigla").value = "";
      if (document.getElementById("uo-input-padre")) document.getElementById("uo-input-padre").value = "";
      await cargarCatalogoUnidades();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || "Error al registrar la unidad orgánica.");
    }
  } catch (err) {
    alert("Error de conexión al registrar la unidad.");
  }
}

export async function actualizarDependenciaROF(unidadId, siglaPadre, siglaHijo) {
  try {
    const res = await apiFetch(`/unidades-organicas/${unidadId}/dependencia`, {
      method: "PUT",
      body: JSON.stringify({ sigla_padre: siglaPadre ? siglaPadre.trim() : null })
    });

    if (res.ok) {
      const destino = siglaPadre ? `[${siglaPadre}]` : "Alta Dirección";
      notificarToast(`Dependencia de [${siglaHijo}] actualizada hacia ${destino}.`, "success");
      await cargarCatalogoUnidades();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || "Error al actualizar la dependencia ROF.");
      await cargarCatalogoUnidades();
    }
  } catch (e) {
    alert("Error de conexión al actualizar la dependencia jerárquica.");
  }
}

export async function asignarTitularUnidad(unidadId, personaId, sigla) {
  try {
    const res = await apiFetch(`/unidades-organicas/${unidadId}/titular`, {
      method: "PUT",
      body: JSON.stringify({ titular_trabajador_id: personaId ? parseInt(personaId) : null, titular_usuario_id: null })
    });

    if (res.ok) {
      notificarToast(`Titular de [${sigla}] actualizado con éxito.`, "success");
      await cargarCatalogoUnidades();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || "Error al actualizar titular.");
    }
  } catch (e) {
    alert("Error de conexión al asignar titular.");
  }
}

// --- FERIADOS ---
export async function cargarListaFeriados() {
  const tbody = document.getElementById("tabla-feriados-body");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-gray-400 font-semibold animate-pulse">Sincronizando calendario institucional...</td></tr>';

  const anoSel = document.getElementById("sel-filtro-ano-feriados")?.value || "";
  const url = anoSel ? `/feriados?year=${anoSel}` : "/feriados";

  try {
    const res = await apiFetch(url);
    if (!res.ok) throw new Error("Error al obtener feriados");
    const feriados = await res.json();
    tbody.innerHTML = "";

    if (feriados.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="p-6 text-center text-gray-400 italic font-semibold">No hay feriados registrados para este periodo.</td></tr>';
      return;
    }

    feriados.forEach(f => {
      const fFecha = f.fecha || "";
      const fMotivo = (f.motivo || f.descripcion || "").replace(/'/g, "\\'");
      const fTipo = f.tipo || "Calendario";
      const badgeTipo = fTipo === "Sector público"
        ? `<span class="bg-purple-50 text-purple-800 border border-purple-200 px-2 py-0.5 rounded text-[10px] font-bold">Sector público</span>`
        : `<span class="bg-blue-50 text-blue-800 border border-blue-200 px-2 py-0.5 rounded text-[10px] font-bold">Calendario</span>`;

      tbody.innerHTML += `
        <tr class="hover:bg-gray-50 border-b border-gray-100">
          <td class="p-2.5 font-bold font-mono text-gray-800">${fFecha}</td>
          <td class="p-2.5">${badgeTipo}</td>
          <td class="p-2.5 font-semibold text-gray-800">${f.descripcion || f.motivo}</td>
          <td class="p-2.5 text-center whitespace-nowrap space-x-1.5">
            <button onclick="iniciarEdicionFeriado(${f.id}, '${fFecha}', '${fMotivo}', '${fTipo}')" class="p-1 text-blue-600 hover:text-blue-800 font-bold cursor-pointer" title="Editar">✏️</button>
            <button onclick="eliminarFeriado(${f.id})" class="p-1 text-rose-500 hover:text-rose-700 font-bold cursor-pointer" title="Eliminar">🗑️</button>
          </td>
        </tr>
      `;
    });
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-rose-500 font-semibold">Error al cargar calendario de feriados.</td></tr>';
  }
}

export async function guardarFeriado(e) {
  e.preventDefault();
  const fecha = document.getElementById("input-feriado-fecha").value;
  const motivo = document.getElementById("input-feriado-motivo").value.trim();
  const tipo = document.getElementById("input-feriado-tipo").value;

  if (!fecha || !motivo) return;

  try {
    const res = await apiFetch("/feriados", {
      method: "POST",
      body: JSON.stringify({ fecha, motivo, tipo })
    });
    if (res.ok) {
      notificarToast("Feriado registrado en el calendario.", "success");
      document.getElementById("input-feriado-fecha").value = "";
      document.getElementById("input-feriado-motivo").value = "";
      await cargarListaFeriados();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || "Error al registrar feriado.");
    }
  } catch (err) {
    alert("Error de conexión al registrar feriado.");
  }
}

export function iniciarEdicionFeriado(id, fechaActual, motivoActual, tipoActual) {
  document.getElementById("edit-feriado-id").value = id;
  document.getElementById("edit-feriado-fecha").value = fechaActual;
  document.getElementById("edit-feriado-motivo").value = motivoActual;
  document.getElementById("edit-feriado-tipo").value = tipoActual || "Calendario";
  document.getElementById("modal-editar-feriado")?.classList.remove("hidden");
}

export function cerrarModalEditarFeriado() {
  document.getElementById("modal-editar-feriado")?.classList.add("hidden");
}

export async function guardarEdicionFeriadoModal(e) {
  e.preventDefault();
  const id = document.getElementById("edit-feriado-id").value;
  const fecha = document.getElementById("edit-feriado-fecha").value;
  const motivo = document.getElementById("edit-feriado-motivo").value.trim();
  const tipo = document.getElementById("edit-feriado-tipo").value;

  if (!fecha || !motivo) {
    alert("Por favor complete todos los campos.");
    return;
  }

  try {
    const res = await apiFetch(`/feriados/${id}`, {
      method: "PUT",
      body: JSON.stringify({ fecha, motivo, tipo })
    });

    if (res.ok) {
      cerrarModalEditarFeriado();
      notificarToast("Feriado actualizado con éxito.", "success");
      await cargarListaFeriados();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || "Error al actualizar feriado.");
    }
  } catch (e) {
    alert("Error de conexión al actualizar feriado.");
  }
}

export async function eliminarFeriado(id) {
  const confirma = await confirmModal("¿Desea eliminar esta fecha del calendario institucional?", "Eliminar Feriado", "danger");
  if (!confirma) return;

  try {
    const res = await apiFetch(`/feriados/${id}`, { method: "DELETE" });
    if (res.ok) {
      notificarToast("Feriado eliminado con éxito.", "info");
      await cargarListaFeriados();
    } else {
      alert("Error al eliminar feriado.");
    }
  } catch (err) {
    alert("Error al eliminar feriado.");
  }
}

export async function proyectarFeriadosSiguienteAno() {
  const confirma = await confirmModal("¿Desea proyectar los feriados institucionales para el siguiente año fiscal?", "Proyección Anual de Feriados", "question");
  if (!confirma) return;

  try {
    const res = await apiFetch("/feriados/proyectar-siguiente-ano", { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      notificarToast(data.mensaje, "success", 5000);
      const selAno = document.getElementById("sel-filtro-ano-feriados");
      if (selAno) selAno.value = data.year_proyectado;
      await cargarListaFeriados();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || "Error al proyectar feriados.");
    }
  } catch (e) {
    alert("Error de conexión al proyectar calendario.");
  }
}

// --- PROCESOS ---
export async function cargarListaProcesosTI() {
  const tbody = document.getElementById("tabla-procesos-ti-body");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-gray-400">Cargando procesos...</td></tr>';

  try {
    const res = await apiFetch("/procesos-institucionales");
    if (!res.ok) throw new Error("Error al obtener catálogo");
    state.catalogoProcesosGlobal = await res.json();
    tbody.innerHTML = "";

    if (state.catalogoProcesosGlobal.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-gray-400 italic">No hay procesos registrados.</td></tr>';
      return;
    }

    state.catalogoProcesosGlobal.forEach(p => {
      const pNombre = (p.nombre || "").replace(/'/g, "\\'");
      tbody.innerHTML += `
        <tr class="hover:bg-gray-50 border-b border-gray-100">
          <td class="p-2.5 font-bold font-mono text-[#0f2a4a]">[${p.codigo || ''}]</td>
          <td class="p-2.5 font-semibold text-gray-800">${p.nombre || ''}</td>
          <td class="p-2.5 text-center">
            <button onclick="eliminarProcesoTI(${p.id}, '${pNombre}')" class="text-rose-500 hover:text-rose-700 font-bold px-1 cursor-pointer" title="Eliminar proceso">🗑️</button>
          </td>
        </tr>
      `;
    });
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-rose-500">Error al cargar catálogo de procesos.</td></tr>';
  }
}

export async function guardarProcesoTI(e) {
  e.preventDefault();
  const codigo = document.getElementById("input-proc-ti-codigo").value.trim();
  const nombre = document.getElementById("input-proc-ti-nombre").value.trim();
  if (!codigo || !nombre) return;

  try {
    const res = await apiFetch("/procesos-institucionales", {
      method: "POST",
      body: JSON.stringify({ codigo, nombre })
    });
    if (res.ok) {
      notificarToast("Proceso institucional registrado.", "success");
      document.getElementById("input-proc-ti-codigo").value = "";
      document.getElementById("input-proc-ti-nombre").value = "";
      await cargarListaProcesosTI();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || "Error al registrar proceso.");
    }
  } catch (err) {
    alert("Error de conexión al registrar proceso.");
  }
}

export async function eliminarProcesoTI(id, nombre) {
  const confirma = await confirmModal(`¿Está seguro de eliminar el proceso '${nombre}'?`, "Eliminar Proceso TI", "danger");
  if (!confirma) return;

  try {
    const res = await apiFetch(`/procesos-institucionales/${id}`, { method: "DELETE" });
    if (res.ok) {
      notificarToast("Proceso eliminado correctamente.", "info");
      await cargarListaProcesosTI();
    } else {
      alert("Error al eliminar proceso.");
    }
  } catch (err) {
    alert("Error de conexión al eliminar proceso.");
  }
}

// Exposición pública de funciones para eventos HTML
window.abrirModalAdminTI = abrirModalAdminTI;
window.cerrarModalAdminTI = cerrarModalAdminTI;
window.cambiarTabTI = cambiarTabTI;
window.filtrarDirectorioTrabajadores = filtrarDirectorioTrabajadores;
window.abrirModalEditarTrabajador = abrirModalEditarTrabajador;
window.cerrarModalEditarTrabajador = cerrarModalEditarTrabajador;
window.guardarEdicionTrabajador = guardarEdicionTrabajador;
window.autocompletarUOEdicion = autocompletarUOEdicion;
window.registrarTrabajadorTI = registrarTrabajadorTI;
window.autocompletarUnidadOrganica = autocompletarUnidadOrganica;
window.solicitarDarDeBajaTrabajador = solicitarDarDeBajaTrabajador;
window.abrirModalTrabajadoresBaja = abrirModalTrabajadoresBaja;
window.cerrarModalTrabajadoresBaja = cerrarModalTrabajadoresBaja;
window.filtrarTrabajadoresBajaModal = filtrarTrabajadoresBajaModal;
window.solicitarReactivarTrabajador = solicitarReactivarTrabajador;
window.registrarNuevaUnidadOrganica = registrarNuevaUnidadOrganica;
window.actualizarDependenciaROF = actualizarDependenciaROF;
window.asignarTitularUnidad = asignarTitularUnidad;
window.guardarFeriado = guardarFeriado;
window.iniciarEdicionFeriado = iniciarEdicionFeriado;
window.cerrarModalEditarFeriado = cerrarModalEditarFeriado;
window.guardarEdicionFeriadoModal = guardarEdicionFeriadoModal;
window.eliminarFeriado = eliminarFeriado;
window.proyectarFeriadosSiguienteAno = proyectarFeriadosSiguienteAno;
window.cargarListaFeriados = cargarListaFeriados;
window.guardarProcesoTI = guardarProcesoTI;
window.eliminarProcesoTI = eliminarProcesoTI;