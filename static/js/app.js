var catalogoUnidadesGlobal = window.catalogoUnidadesGlobal || [];

var configurarCalculadoraModalFin = window.configurarCalculadoraModalFin || function() {};
var configurarCalculadoraModalFinWizard = window.configurarCalculadoraModalFinWizard || function() {};

var cerrarMenuContextual = window.cerrarMenuContextual || function() {
  const m = document.getElementById('menu-contextual') || document.getElementById('menuContextual');
  if (m) m.classList.add('hidden');
};

let token = localStorage.getItem("token");
let currentUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
let proyectoActualId = null;
let proyectoEsGestor = false;
let proyectoModoDuracion = "business_days";

let actividadesGlobal = [];
let responsablesGlobal = [];
let nivelFiltroActivo = 4;

let modoZoom = "dias";
let zoomNivelEscala = 5;
let diasTotalesAnio = [];
let semanasTotales = [];
let semanaInicioIndex = 0;
let diaInicioIndex = 0;
let indiceSemanaHoy = -1;

let nodosColapsados = new Set();
let actividadMultiRespActual = null;
let actividadContextualSeleccionada = null;
let codigoFilaSeleccionada = null;

let wizardPasoActual = 1;
let wizardCodigoPadre = null;
let wizardCodigoGenerado = "";

let visibilidadColumnas = JSON.parse(localStorage.getItem("visibilidad_columnas") || JSON.stringify({
  responsable: true,
  estado: true,
  inicio: true,
  fin: true,
  dias: true,
  avance: true,
  gantt: true,
  avatares_gantt: true,
  porcentajes_gantt: true
}));

const nombresMeses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];
const coloresAvatar = ['#2980b9', '#27ae60', '#8e44ad', '#d35400', '#16a085', '#c0392b', '#2c3e50', '#7f8c8d'];

let resolverDialogoActual = null;

function notificarToast(mensaje, tipo = "success", duracionMs = 4000) {
  let container = document.getElementById("toast-container-global");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container-global";
    container.className = "fixed bottom-5 right-5 z-[99999] flex flex-col space-y-2 pointer-events-none";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  const estilos = {
    success: "bg-emerald-600 text-white shadow-2xl shadow-emerald-950/50 border border-emerald-500/40",
    error: "bg-[#991b1b] text-white shadow-2xl shadow-red-950/50 border border-red-500/40",
    warning: "bg-[#b45309] text-white shadow-2xl shadow-amber-950/50 border border-amber-500/40",
    info: "bg-[#0f2a4a] text-white shadow-2xl shadow-slate-950/50 border border-blue-500/40"
  };
  const iconos = {
    success: "✓",
    error: "✕",
    warning: "⚠️",
    info: "ℹ️"
  };

  toast.className = `pointer-events-auto flex items-center space-x-3 px-5 py-3.5 rounded-2xl text-xs font-extrabold tracking-wide transition-all transform duration-300 translate-y-4 opacity-0 ${estilos[tipo] || estilos.info}`;
  toast.innerHTML = `
    <span class="w-6 h-6 rounded-full ${tipo === 'success' ? 'bg-lime-400 text-emerald-950' : 'bg-white/25 text-white'} flex items-center justify-center text-xs font-black shadow-sm flex-shrink-0">${iconos[tipo] || 'ℹ️'}</span>
    <span class="flex-1 leading-snug drop-shadow-sm">${mensaje}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.remove("translate-y-4", "opacity-0");
    toast.classList.add("translate-y-0", "opacity-100");
  }, 30);

  setTimeout(() => {
    toast.classList.remove("translate-y-0", "opacity-100");
    toast.classList.add("translate-y-4", "opacity-0");
    setTimeout(() => toast.remove(), 300);
  }, duracionMs);
}

function mostrarMensajeInstitucional({ titulo = "Sistema IMARPE", mensaje, tipo = "info", esConfirmacion = false, textoAceptar = "Aceptar", textoCancelar = "Cancelar" }) {
  return new Promise((resolve) => {
    resolverDialogoActual = resolve;

    const modal = document.getElementById("modal-dialog-imarpe");
    const headerBg = document.getElementById("dialog-header-bg");
    const txtTitulo = document.getElementById("dialog-titulo");
    const txtIcono = document.getElementById("dialog-icono");
    const txtMensaje = document.getElementById("dialog-mensaje");
    const btnAceptar = document.getElementById("dialog-btn-aceptar");
    const btnCancelar = document.getElementById("dialog-btn-cancelar");
    const btnX = document.getElementById("dialog-btn-x");

    txtTitulo.innerText = titulo;
    txtMensaje.innerText = mensaje;
    btnAceptar.innerText = textoAceptar;
    btnCancelar.innerText = textoCancelar;

    if (tipo === "error" || tipo === "warning" || tipo === "danger") {
      headerBg.className = "bg-[#c0392b] text-white px-5 py-3.5 flex items-center justify-between";
      btnAceptar.className = "px-5 py-2 bg-[#c0392b] hover:bg-[#a93226] text-white text-xs font-bold rounded-lg transition shadow cursor-pointer";
      txtIcono.innerText = "⚠️";
    } else if (tipo === "question" || esConfirmacion) {
      headerBg.className = "bg-[#0f2a4a] text-white px-5 py-3.5 flex items-center justify-between";
      btnAceptar.className = "px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-lg transition shadow cursor-pointer";
      txtIcono.innerText = "ℹ️";
    } else {
      headerBg.className = "bg-[#0f2a4a] text-white px-5 py-3.5 flex items-center justify-between";
      btnAceptar.className = "px-5 py-2 bg-[#0f2a4a] hover:bg-[#1b4f8a] text-white text-xs font-bold rounded-lg transition shadow cursor-pointer";
      txtIcono.innerText = "ℹ️";
    }

    btnAceptar.onclick = () => cerrarDialogoImarpe(true);
    btnCancelar.onclick = () => cerrarDialogoImarpe(false);
    if (btnX) btnX.onclick = () => cerrarDialogoImarpe(false);

    if (esConfirmacion) {
      btnCancelar.classList.remove("hidden");
      if (btnX) btnX.classList.remove("hidden");
    } else {
      btnCancelar.classList.add("hidden");
      if (btnX) btnX.classList.add("hidden");
    }

    modal.classList.remove("hidden");
  });
}

function cerrarDialogoImarpe(resultado) {
  const modal = document.getElementById("modal-dialog-imarpe");
  if (modal) modal.classList.add("hidden");
  if (typeof resolverDialogoActual === "function") {
    const fn = resolverDialogoActual;
    resolverDialogoActual = null;
    fn(Boolean(resultado));
  }
}

window.alert = function(msg) {
  mostrarMensajeInstitucional({
    titulo: "Notificación del Sistema",
    mensaje: msg,
    tipo: (String(msg).includes("⚠️") || String(msg).includes("Error") || String(msg).includes("inválido")) ? "warning" : "info",
    esConfirmacion: false
  });
};

window.confirmModal = function(msg, titulo = "Confirmación Requerida", tipo = "question") {
  return mostrarMensajeInstitucional({
    titulo: titulo,
    mensaje: msg,
    tipo: tipo,
    esConfirmacion: true
  });
};

function parsearFechaUniversal(fechaStr) {
  if (!fechaStr || typeof fechaStr !== 'string') return null;
  const s = fechaStr.trim();
  if (s === "Definir" || s === "None" || s === "" || s === "null" || s.includes("NaN")) return null;

  if (s.includes("/")) {
    const p = s.split("/");
    if (p.length === 3) {
      const d = parseInt(p[0]), m = parseInt(p[1]), y = parseInt(p[2]);
      if (!isNaN(d) && !isNaN(m) && !isNaN(y)) return new Date(y, m - 1, d);
    }
  } else if (s.includes("-")) {
    const p = s.split("-");
    if (p.length === 3) {
      if (p[0].length === 4) {
        const y = parseInt(p[0]), m = parseInt(p[1]), d = parseInt(p[2]);
        if (!isNaN(d) && !isNaN(m) && !isNaN(y)) return new Date(y, m - 1, d);
      } else {
        const d = parseInt(p[0]), m = parseInt(p[1]), y = parseInt(p[2]);
        if (!isNaN(d) && !isNaN(m) && !isNaN(y)) return new Date(y, m - 1, d);
      }
    }
  }
  return null;
}

function formatearFechaLatina(fechaStr) {
  const dt = parsearFechaUniversal(fechaStr);
  if (!dt || isNaN(dt.getTime())) return "01/01/2026";
  const d = String(dt.getDate()).padStart(2, '0');
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const y = dt.getFullYear();
  return `${d}/${m}/${y}`;
}

function formatearFechaISO(fechaStr) {
  const dt = parsearFechaUniversal(fechaStr);
  if (!dt || isNaN(dt.getTime())) return "2026-01-01";
  const d = String(dt.getDate()).padStart(2, '0');
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const y = dt.getFullYear();
  return `${y}-${m}-${d}`;
}

function obtenerPrimerNombre(nombreCompleto, usernameFallback) {
  if (!nombreCompleto && !usernameFallback) return "Usuario";
  const texto = String(nombreCompleto || "").trim();
  let nombresParte = texto;

  if (texto.includes(",")) {
    nombresParte = texto.split(",")[1].trim();
  }

  const palabras = nombresParte.split(/\s+/).filter(Boolean);
  let primerNombre = palabras.length > 0 ? palabras[0] : "";

  if (!primerNombre) {
    primerNombre = String(usernameFallback || "Usuario").trim();
  }

  if (primerNombre.toLowerCase() === "admin") {
    return "Administrador";
  }

  return primerNombre.charAt(0).toUpperCase() + primerNombre.slice(1).toLowerCase();
}

function actualizarDisplaysUsuario() {
  const primerNombre = obtenerPrimerNombre(currentUser.nombre_completo, currentUser.username);
  const userText = currentUser.username || "admin";

  let roleText = "PERSONAL IMARPE";
  if (currentUser.rol === "ADMIN_TI") {
    roleText = "ADMINISTRADOR TI";
  } else if (currentUser.unidad_organica && currentUser.unidad_organica.trim() !== "") {
    roleText = currentUser.unidad_organica.trim();
  }

  const saludoHub = document.getElementById("hub-saludo-bienvenida");
  if (saludoHub) saludoHub.innerText = `Bienvenido(a), ${primerNombre}`;

  const uHub = document.getElementById("user-display-hub");
  const rHub = document.getElementById("role-display-hub");
  const uGantt = document.getElementById("user-display");
  const rGantt = document.getElementById("role-display");

  if (uHub) uHub.innerText = userText;
  if (rHub) rHub.innerText = roleText;
  if (uGantt) uGantt.innerText = userText;
  if (rGantt) rGantt.innerText = roleText;

  const esAdminTI = (currentUser.rol === "ADMIN_TI");
  const btnTI = document.getElementById("btn-admin-ti-hub");
  if (btnTI) btnTI.classList.toggle("hidden", !esAdminTI);
}

document.addEventListener("keydown", (e) => {
  if (e.target && e.target.tagName.toLowerCase() === "textarea") return;

  if (e.key === "Enter") {
    const modDialog = document.getElementById("modal-dialog-imarpe");
    if (modDialog && !modDialog.classList.contains("hidden")) {
      e.preventDefault();
      cerrarDialogoImarpe(true);
      return;
    }

    const modInput = document.getElementById("modal-input-custom");
    if (modInput && !modInput.classList.contains("hidden")) {
      e.preventDefault();
      document.getElementById("mic-btn-guardar").click();
      return;
    }

    const modFecha = document.getElementById("modal-fecha-custom");
    if (modFecha && !modFecha.classList.contains("hidden")) {
      e.preventDefault();
      document.getElementById("mfc-btn-guardar").click();
      return;
    }

    const modFin = document.getElementById("modal-fin-interactiva");
    if (modFin && !modFin.classList.contains("hidden")) {
      e.preventDefault();
      document.getElementById("mfi-btn-guardar").click();
      return;
    }

    const modResp = document.getElementById("modal-asignar-responsables");
    if (modResp && !modResp.classList.contains("hidden")) {
      e.preventDefault();
      document.getElementById("btn-guardar-multi-resp").click();
      return;
    }

    const modNotif = document.getElementById("modal-notificacion-correo");
    if (modNotif && !modNotif.classList.contains("hidden")) {
      e.preventDefault();
      confirmarEnvioNotificaciones();
      return;
    }

    const modWz = document.getElementById("modal-wizard-creacion");
    if (modWz && !modWz.classList.contains("hidden")) {
      e.preventDefault();
      avanzarPasoWizard();
      return;
    }

    const modCol = document.getElementById("modal-columnas");
    if (modCol && !modCol.classList.contains("hidden")) {
      e.preventDefault();
      cerrarModalColumnas();
      return;
    }
  }

  if (e.key === "Escape") {
    const modEditFer = document.getElementById("modal-editar-feriado");
    if (modEditFer && !modEditFer.classList.contains("hidden")) {
      cerrarModalEditarFeriado();
      return;
    }
    const modNotif = document.getElementById("modal-notificacion-correo");
    if (modNotif && !modNotif.classList.contains("hidden")) {
      cerrarModalNotificacionCorreo();
      return;
    }
    const modDialog = document.getElementById("modal-dialog-imarpe");
    if (modDialog && !modDialog.classList.contains("hidden")) {
      cerrarDialogoImarpe(false);
      return;
    }
    const modInput = document.getElementById("modal-input-custom");
    if (modInput && !modInput.classList.contains("hidden")) {
      cerrarInputCustom();
      return;
    }
    const modFecha = document.getElementById("modal-fecha-custom");
    if (modFecha && !modFecha.classList.contains("hidden")) {
      cerrarFechaCustom();
      return;
    }
    const modFin = document.getElementById("modal-fin-interactiva");
    if (modFin && !modFin.classList.contains("hidden")) {
      cerrarFinInteractiva();
      return;
    }
    const modResp = document.getElementById("modal-asignar-responsables");
    if (modResp && !modResp.classList.contains("hidden")) {
      cerrarAsignarResponsables();
      return;
    }
    const modWz = document.getElementById("modal-wizard-creacion");
    if (modWz && !modWz.classList.contains("hidden")) {
      cerrarWizardCreacion();
      return;
    }
    const modCol = document.getElementById("modal-columnas");
    if (modCol && !modCol.classList.contains("hidden")) {
      cerrarModalColumnas();
      return;
    }
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const idsModales = [
    "modal-wizard-creacion", "modal-columnas", "modal-dependencias", "modal-cpm", 
    "modal-historial", "modal-responsables", "modal-admin-ti", "modal-editar-trabajador-ti", 
    "modal-trabajadores-baja", "modal-notificacion-correo", "modal-comentarios", 
    "modal-nuevo-proyecto", "modal-guardar-plantilla", "modal-importar-plantilla-proyecto",
    "modal-dialog-imarpe", "modal-input-custom", "modal-fecha-custom", "modal-fin-interactiva",
    "modal-asignar-responsables", "modal-estadisticas-hub", "modal-editar-feriado"
  ];
  idsModales.forEach(id => {
    const el = document.getElementById(id);
    if (el && el.parentElement !== document.body) {
      document.body.appendChild(el);
    }
  });

  const viewHubEl = document.getElementById("view-hub");
  if (viewHubEl) {
    viewHubEl.addEventListener("scroll", () => {
      const divSug = document.getElementById("hub-sugerencias-uo");
      if (divSug && !divSug.classList.contains("hidden")) {
        divSug.classList.add("hidden");
      }
    }, { passive: true });
  }

  document.addEventListener("click", (e) => {
    const divSug = document.getElementById("hub-sugerencias-uo");
    const inpBusq = document.getElementById("hub-filtro-uo-busq");
    if (divSug && !divSug.classList.contains("hidden")) {
      if (!divSug.contains(e.target) && e.target !== inpBusq) {
        divSug.classList.add("hidden");
      }
    }
  });

  if (token && currentUser.username) {
    document.getElementById("view-login").classList.add("hidden");
    actualizarDisplaysUsuario();
    cargarHubProyectos();
  } else {
    mostrarLogin();
  }
  configurarCalculadoraModalFin();
  configurarCalculadoraWizard();
  construirCalendarioAnual();
  sincronizarCheckboxesColumnas();
  aplicarVisibilidadColumnas();
  inicializarRedimensionDescripcion();

  const inputNombreProy = document.getElementById("txt-nombre-proyecto");
  if (inputNombreProy) {
    let nombreOriginalAlEnfocar = "";

    inputNombreProy.addEventListener("focus", () => {
      nombreOriginalAlEnfocar = inputNombreProy.value.trim();
    });

    const guardarNombreProyecto = async () => {
      if (!proyectoActualId || !proyectoEsGestor) return;
      const nuevoNombre = inputNombreProy.value.trim();
      
      if (!nuevoNombre || nuevoNombre === nombreOriginalAlEnfocar) return;

      try {
        const res = await fetch(`/proyectos/${proyectoActualId}/nombre`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({ nombre: nuevoNombre })
        });

        if (res.ok) {
          nombreOriginalAlEnfocar = nuevoNombre;
          notificarToast("Nombre del proyecto actualizado con éxito.", "success");
        } else {
          const err = await res.json().catch(() => ({}));
          alert(err.detail || "No se pudo actualizar el nombre del proyecto.");
        }
      } catch (e) {
        console.error("Error al actualizar nombre:", e);
      }
    };

    inputNombreProy.addEventListener("blur", guardarNombreProyecto);
    inputNombreProy.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        inputNombreProy.blur();
      }
    });
  }

  let acumuladorScrollGantt = 0;
  let ultimoPasoScrollGantt = 0;
  let timerInerciaScroll = null;

  const UMBRAL_SCROLL_NATURAL_PX = 40;
  const CADENCIA_SCROLL_MS = 16;

  window.addEventListener("wheel", (e) => {
    const dashboard = document.getElementById("view-dashboard");
    if (!dashboard || dashboard.classList.contains("hidden")) return;

    const sobreAreaGantt = e.target.closest("#th-gantt, #gantt-header-meses, #gantt-header-semanas, td:nth-child(9), .milestone-diamond, .gantt-avatar-circle") ||
                           e.target.closest("td[class*='border-r']")?.querySelector(".milestone-diamond, .gantt-avatar-circle");

    if (sobreAreaGantt) {
      e.preventDefault();

      if (e.ctrlKey) {
        const dirZoom = e.deltaY > 0 ? -1 : 1;
        ajustarNivelZoomPaso(dirZoom);
        return;
      }

      clearTimeout(timerInerciaScroll);
      timerInerciaScroll = setTimeout(() => {
        acumuladorScrollGantt = 0;
      }, 120);

      let delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (e.deltaMode === 1) delta *= 33;
      else if (e.deltaMode === 2) delta *= 100;

      if ((delta > 0 && acumuladorScrollGantt < 0) || (delta < 0 && acumuladorScrollGantt > 0)) {
        acumuladorScrollGantt = 0;
      }

      acumuladorScrollGantt += delta;
      const ahora = Date.now();

      if (Math.abs(acumuladorScrollGantt) >= UMBRAL_SCROLL_NATURAL_PX && (ahora - ultimoPasoScrollGantt >= CADENCIA_SCROLL_MS)) {
        const direccion = acumuladorScrollGantt > 0 ? 1 : -1;

        let saltoTemporal = 1;
        if (modoZoom === "dias") {
          saltoTemporal = 1;
        } else if (modoZoom === "meses") {
          saltoTemporal = 4;
        } else if (modoZoom === "trimestres") {
          saltoTemporal = 13;
        } else if (modoZoom === "semestres") {
          saltoTemporal = 26;
        }

        const pasos = direccion * saltoTemporal;

        acumuladorScrollGantt = acumuladorScrollGantt > 0
          ? Math.max(0, acumuladorScrollGantt - UMBRAL_SCROLL_NATURAL_PX)
          : Math.min(0, acumuladorScrollGantt + UMBRAL_SCROLL_NATURAL_PX);

        ultimoPasoScrollGantt = ahora;
        cambiarSemanaInicio(pasos);
      }
    }
  }, { passive: false });

  let estaArrastrando = false;
  let inicioX = 0;
  let acumuladorDeltaX = 0;
  const SENSIBILIDAD_ARRASTRE_PX = 30;

  const tablaGanttEl = document.getElementById("tabla-gantt-main");

  if (tablaGanttEl) {
    tablaGanttEl.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;

      const sobreGantt = e.target.closest("#th-gantt, #gantt-header-meses, #gantt-header-semanas, td:nth-child(9)");
      if (sobreGantt) {
        estaArrastrando = true;
        inicioX = e.clientX;
        acumuladorDeltaX = 0;
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
      }
    });

    window.addEventListener("mousemove", (e) => {
      if (!estaArrastrando) return;

      const diffX = e.clientX - inicioX;
      acumuladorDeltaX += diffX;
      inicioX = e.clientX;

      if (Math.abs(acumuladorDeltaX) >= SENSIBILIDAD_ARRASTRE_PX) {
        const pasos = Math.trunc(acumuladorDeltaX / SENSIBILIDAD_ARRASTRE_PX);
        acumuladorDeltaX = acumuladorDeltaX % SENSIBILIDAD_ARRASTRE_PX;
        cambiarSemanaInicio(-pasos);
      }
    });

    window.addEventListener("mouseup", () => {
      if (estaArrastrando) {
        estaArrastrando = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    });
  }
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const user = document.getElementById("login-username").value.trim();
  const pass = document.getElementById("login-password").value.trim();
  
  const formData = new URLSearchParams();
  formData.append("username", user);
  formData.append("password", pass);

  try {
    const res = await fetch(`/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      alert(errData.detail || "Usuario o contraseña incorrectos.");
      return;
    }

    const data = await res.json();
    token = data.access_token;
    currentUser = { 
      id: data.user_id || (data.user && data.user.id),
      username: data.username || (data.user && data.user.username), 
      rol: data.rol || (data.user && data.user.rol), 
      nombre_completo: data.nombre_completo || (data.user && data.user.nombre_completo) || "",
      unidad_organica: data.unidad_organica || (data.user && data.user.unidad_organica) || ""
    };
    localStorage.setItem("token", token);
    localStorage.setItem("currentUser", JSON.stringify(currentUser));
    
    document.getElementById("view-login").classList.add("hidden");
    actualizarDisplaysUsuario();
    cargarHubProyectos();
  } catch (err) {
    console.error("Error en login:", err);
    alert("Error de conexión con el servidor. Intente nuevamente.");
  }
});

function alternarVisibilidadPasswordLogin() {
  const input = document.getElementById("login-password");
  const eyeOpen = document.getElementById("ico-login-eye-open");
  const eyeClosed = document.getElementById("ico-login-eye-closed");
  if (!input) return;

  if (input.type === "password") {
    input.type = "text";
    if (eyeOpen) eyeOpen.classList.add("hidden");
    if (eyeClosed) eyeClosed.classList.remove("hidden");
  } else {
    input.type = "password";
    if (eyeOpen) eyeOpen.classList.remove("hidden");
    if (eyeClosed) eyeClosed.classList.add("hidden");
  }
}

function mostrarLogin() { 
  document.getElementById("view-login").classList.remove("hidden");
  document.getElementById("view-hub").classList.add("hidden");
}

function cerrarSesion() { 
  localStorage.clear(); 
  token = null; 
  currentUser = {};
  location.reload();
}

let proyectosUsuarioGlobal = [];
let vistaHubActual = localStorage.getItem("vista_hub_proyectos") || "cards";

async function cargarHubProyectos() {
  if (!token) {
    mostrarLogin();
    return;
  }

  document.getElementById("view-login").classList.add("hidden");
  document.getElementById("view-hub").classList.remove("hidden");
  actualizarDisplaysUsuario();

  try {
    if (!catalogoUnidadesGlobal || catalogoUnidadesGlobal.length === 0) {
      try {
        const resUo = await fetch("/unidades-organicas", {
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (resUo.ok) catalogoUnidadesGlobal = await resUo.json();
      } catch(e) {}
    }

    const res = await fetch(`/proyectos`, {
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (res.status === 401) {
      cerrarSesion();
      return;
    }

    if (!res.ok) throw new Error("Error al cargar proyectos");
    proyectosUsuarioGlobal = await res.json();

    inicializarFiltrosHub();
    actualizarKPIsHub(proyectosUsuarioGlobal);
    aplicarConmutadorVistaHub();
    filtrarProyectosHub();
  } catch (err) {
    console.error("Error al cargar Hub:", err);
  }
}

function actualizarKPIsHub(lista) {
  const total = lista.length;
  const sumaAvance = lista.reduce((acc, p) => acc + (p.avance_global || 0), 0);
  const promAvance = total > 0 ? Math.round(sumaAvance / total) : 0;

  const elTotal = document.getElementById("hub-kpi-total-proy");
  const elProm = document.getElementById("hub-kpi-prom-avance");
  if (elTotal) elTotal.innerText = total;
  if (elProm) elProm.innerText = `${promAvance}%`;
}

function cambiarVistaHub(modo) {
  vistaHubActual = modo;
  localStorage.setItem("vista_hub_proyectos", modo);
  aplicarConmutadorVistaHub();
  filtrarProyectosHub();
}

function aplicarConmutadorVistaHub() {
  const btnGrid = document.getElementById("btn-vista-grid");
  const btnTable = document.getElementById("btn-vista-table");
  const gridCont = document.getElementById("grid-proyectos-hub");
  const tableCont = document.getElementById("hub-proyectos-tabla-contenedor");

  const estiloActivo = "px-3 py-1.5 rounded-lg text-xs font-black bg-teal-600 hover:bg-teal-700 text-white shadow-sm flex items-center space-x-1.5 transition-all duration-150 cursor-pointer";
  const estiloInactivo = "px-3 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:text-teal-700 hover:bg-slate-200/60 transition-all duration-150 flex items-center space-x-1.5 cursor-pointer";

  if (vistaHubActual === "table") {
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

let idsProyectosOcultos = new Set(JSON.parse(localStorage.getItem("proyectos_ocultos_ids") || "[]"));
let mostrandoOcultosHub = false;

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

function guardarOcultosLocalStorage() {
  localStorage.setItem("proyectos_ocultos_ids", JSON.stringify(Array.from(idsProyectosOcultos)));
  actualizarBotonOcultosHubUI();
}

function actualizarBotonOcultosHubUI() {
  const btnOcultos = document.getElementById("btn-toggle-proyectos-ocultos");
  if (!btnOcultos) return;

  const cant = idsProyectosOcultos.size;
  if (cant > 0) {
    btnOcultos.classList.remove("hidden");
    if (mostrandoOcultosHub) {
      btnOcultos.className = "h-[30px] px-2.5 rounded-lg text-xs font-black bg-teal-600 hover:bg-teal-700 text-white shadow-sm transition flex items-center space-x-1 cursor-pointer whitespace-nowrap flex-shrink-0";
      btnOcultos.innerHTML = `
        <svg class="w-3.5 h-3.5 text-white flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
        <span>Ver activos (${cant})</span>
      `;
      btnOcultos.title = "Volver al panel principal de proyectos";
    } else {
      btnOcultos.className = "w-[30px] h-[30px] rounded-lg bg-amber-500 hover:bg-amber-600 text-white shadow-sm transition flex items-center justify-center cursor-pointer flex-shrink-0";
      btnOcultos.innerHTML = `
        <svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      `;
      btnOcultos.title = `Ver proyectos ocultos (${cant})`;
    }
  } else {
    btnOcultos.classList.add("hidden");
    mostrandoOcultosHub = false;
  }
}

function alternarVerProyectosOcultos() {
  mostrandoOcultosHub = !mostrandoOcultosHub;
  actualizarBotonOcultosHubUI();
  filtrarProyectosHub();
}

function alternarOcultarProyecto(id, event) {
  if (event) event.stopPropagation();
  if (idsProyectosOcultos.has(id)) {
    idsProyectosOcultos.delete(id);
    notificarToast("Proyecto restaurado al panel principal.", "success");
    if (idsProyectosOcultos.size === 0) {
      mostrandoOcultosHub = false;
    }
  } else {
    idsProyectosOcultos.add(id);
    notificarToast("Proyecto ocultado de la vista principal.", "info");
  }
  guardarOcultosLocalStorage();
  filtrarProyectosHub();
}

async function solicitarEliminarProyecto(id, nombre, event) {
  if (event) event.stopPropagation();

  const pObj = proyectosUsuarioGlobal.find(p => p.id === id);
  const totalActs = pObj ? (pObj.total_actividades || 0) : 0;

  if (totalActs > 0) {
    alert(`⚠️ No se puede eliminar el proyecto '${nombre}'.\n\nEl proyecto contiene ${totalActs} actividad(es). Debe ingresar al proyecto y eliminar todas sus actividades para poder borrarlo.`);
    return;
  }

  const confirma = await confirmModal(
    `¿Está seguro de eliminar permanentemente el proyecto '${nombre}'?\n\nEsta acción no se puede deshacer.`,
    "Eliminar Proyecto Vacío",
    "danger"
  );

  if (!confirma) return;

  try {
    const res = await fetch(`/proyectos/${id}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (res.ok) {
      idsProyectosOcultos.delete(id);
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

function renderizarTarjetasHub(lista) {
  const grid = document.getElementById("grid-proyectos-hub");
  if (!grid) return;
  grid.innerHTML = "";

  actualizarBotonOcultosHubUI();

  const listaFinal = lista.filter(p => mostrandoOcultosHub ? idsProyectosOcultos.has(p.id) : !idsProyectosOcultos.has(p.id));

  listaFinal.forEach(p => {
    const rolEfectivo = p.rol_efectivo || (p.es_gestor ? 'GESTOR' : 'RESPONSABLE');
    const esGestor = (p.es_gestor === 1 || p.es_gestor === true || currentUser.rol === "ADMIN_TI") && rolEfectivo !== "AUTORIDAD";
    const totalActs = p.total_actividades || 0;
    const esProyectoVacio = totalActs === 0;
    const puedeEliminar = esGestor && esProyectoVacio;
    const esPublico = (p.visibilidad === "PUBLICO");

    let badgeRolClases = "bg-blue-50 text-blue-800 border-blue-200/80";
    let badgeRolTexto = "👤 Responsable";

    if (rolEfectivo === "GESTOR" || esGestor) {
      badgeRolClases = "bg-amber-50 text-amber-800 border-amber-200/80";
      badgeRolTexto = "👑 Gestor";
    } else if (rolEfectivo === "AUTORIDAD") {
      badgeRolClases = "bg-purple-50 text-purple-800 border-purple-200/80";
      badgeRolTexto = "🏛️ Autoridad";
    } else if (rolEfectivo === "VISUALIZADOR") {
      badgeRolClases = "bg-slate-100 text-slate-700 border-slate-300";
      badgeRolTexto = "👁️ Visualizador";
    }

    const badgeAlcanceHTML = esPublico
      ? `<span class="inline-flex items-center justify-center w-5 h-5 rounded-md bg-teal-50 text-teal-700 border border-teal-200 text-xs shadow-2xs cursor-help" title="Proyecto visible a nivel institucional">🌐</span>`
      : `<span class="inline-flex items-center justify-center w-5 h-5 rounded-md bg-slate-100 text-slate-600 border border-slate-200 text-xs shadow-2xs cursor-help" title="Proyecto privado">🔒</span>`;

    const tooltipEdit = esGestor ? 'title="Doble clic para editar descripción"' : '';
    const estiloCursor = esGestor ? 'cursor-pointer hover:text-teal-700 hover:bg-teal-50/70 p-1 -m-1 rounded transition' : '';
    const textoDesc = (p.descripcion && p.descripcion.trim() !== "") ? p.descripcion.trim() : "Sin descripción adicional registrada.";
    const descEscapada = (p.descripcion || "").replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const avanceVal = parseInt(p.avance_global) || 0;
    const estaOculto = idsProyectosOcultos.has(p.id);

    let badgeAvanceClases = "bg-rose-50 text-rose-700 border border-rose-200";
    let barraColorClase = "bg-rose-500";

    if (avanceVal === 100) {
      badgeAvanceClases = "bg-emerald-50 text-emerald-800 border border-emerald-200";
      barraColorClase = "bg-emerald-500";
    } else if (avanceVal > 0) {
      badgeAvanceClases = "bg-amber-50 text-amber-800 border border-amber-200";
      barraColorClase = "bg-amber-500";
    }

    let siglaUnidad = "";
    let nombreCompletoUnidad = "";
    if (p.unidad_organica && p.unidad_organica.trim() !== "") {
      const uRaw = p.unidad_organica.trim().toUpperCase();
      const uObj = (catalogoUnidadesGlobal || []).html ? null : (catalogoUnidadesGlobal || []).find(u => 
        u.sigla.toUpperCase() === uRaw || 
        u.nombre.trim().toUpperCase() === uRaw
      );
      siglaUnidad = uObj ? uObj.sigla : p.unidad_organica.trim();
      nombreCompletoUnidad = uObj ? uObj.nombre : p.unidad_organica.trim();
    }

    const tooltipUo = nombreCompletoUnidad ? `title="${nombreCompletoUnidad}"` : '';
    const estiloCursorUo = esGestor ? 'cursor-pointer hover:text-teal-900 transition' : '';

    const tieneProceso = Boolean(p.proceso_nombre || p.proceso_codigo);
    const nombreLimpioProceso = tieneProceso 
      ? (p.proceso_nombre || "Proceso sin denominación") 
      : "Sin proceso asignado";
    
    const detalleCompletoProceso = tieneProceso
      ? (p.es_proceso_personalizado ? `${p.proceso_nombre} [PERSONALIZADO]` : `${p.proceso_nombre} [${p.proceso_codigo}]`)
      : "Sin proceso asignado";

    const tooltipProceso = `title="${detalleCompletoProceso}"`;
    const estiloCursorProceso = esGestor ? 'cursor-pointer hover:text-teal-900 transition' : '';

    const card = document.createElement("div");
    card.className = "bg-white rounded-2xl p-6 border border-gray-200/90 shadow-sm hover:shadow-md transition-all flex flex-col justify-between hover:border-teal-500/50 relative";
    card.innerHTML = `
      <div>
        <div class="flex items-center justify-between mb-3.5 gap-1">
          <div class="flex items-center space-x-1.5 flex-wrap">
            <span class="text-[10px] font-black px-2.5 py-1 rounded-md uppercase tracking-wider whitespace-nowrap border ${badgeRolClases}">
              ${badgeRolTexto}
            </span>
            ${badgeAlcanceHTML}
          </div>
          <div class="flex items-center space-x-1">
            <button onclick="alternarOcultarProyecto(${p.id}, event)" class="p-1 rounded hover:bg-gray-100 transition cursor-pointer" title="${estaOculto ? 'Restaurar al panel principal' : 'Ocultar proyecto de la vista'}">
              ${estaOculto ? SVG_OJO_ABIERTO : SVG_OJO_CERRADO}
            </button>
            ${puedeEliminar ? `
              <button onclick="solicitarEliminarProyecto(${p.id}, '${p.nombre.replace(/'/g, "\\'")}', event)" class="p-1 rounded text-rose-400 hover:text-rose-700 hover:bg-rose-50 transition cursor-pointer" title="Eliminar proyecto vacío">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            ` : ''}
            <span class="text-xs font-black px-2 py-0.5 rounded whitespace-nowrap ${badgeAvanceClases}">${avanceVal}% Avance</span>
          </div>
        </div>
        
        <h3 class="font-bold text-base text-[#0f2a4a] leading-snug flex items-center">${p.nombre}</h3>
        
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5">
          <p ${tooltipUo} 
             ondblclick="${esGestor ? `editarUnidadOrganicaProyecto(${p.id}, '${siglaUnidad}')` : ''}"
             class="text-[11px] font-bold text-teal-800 inline-flex items-center space-x-1 ${estiloCursorUo}">
            <span>🏢</span>
            <span>${siglaUnidad || 'Sin UO'}</span>
          </p>
          <span class="text-gray-300 text-xs">•</span>
          <p ${tooltipProceso} 
             ondblclick="${esGestor ? `editarProcesoProyectoModal(${p.id})` : ''}"
             class="text-[11px] font-semibold text-slate-600 inline-flex items-center space-x-1 max-w-[220px] truncate ${estiloCursorProceso}">
            <span>⚙️</span>
            <span class="truncate ${tieneProceso ? 'text-[#0f2a4a] font-bold' : 'italic text-gray-400'}">${nombreLimpioProceso}</span>
          </p>
        </div>

        <p ${tooltipEdit} 
           ondblclick="${esGestor ? `editarDescripcionProyecto(${p.id}, '${descEscapada}')` : ''}" 
           class="text-xs text-gray-500 mt-2 line-clamp-2 min-h-[32px] leading-relaxed ${estiloCursor}">
          ${textoDesc}
        </p>
        
        <div class="w-full bg-gray-100 rounded-full h-2 mt-4 overflow-hidden shadow-inner">
          <div class="${barraColorClase} h-2 rounded-full transition-all duration-500" style="width: ${avanceVal}%"></div>
        </div>

        <div class="grid grid-cols-3 gap-2 mt-4 text-center">
          <div class="bg-emerald-50/80 p-2 rounded-xl border border-emerald-100">
            <span class="block text-[9px] font-black text-emerald-700 uppercase">Ejecutado</span>
            <span class="text-xs font-black text-emerald-900">${p.ejecutadas || 0}</span>
          </div>
          <div class="bg-amber-50/80 p-2 rounded-xl border border-amber-100">
            <span class="block text-[9px] font-black text-amber-700 uppercase">En proceso</span>
            <span class="text-xs font-black text-amber-900">${p.en_proceso || 0}</span>
          </div>
          <div class="bg-rose-50/80 p-2 rounded-xl border border-rose-100">
            <span class="block text-[9px] font-black text-rose-700 uppercase">No iniciado</span>
            <span class="text-xs font-black text-rose-900">${p.pendientes || 0}</span>
          </div>
        </div>
      </div>

      <button onclick="ingresarAlProyecto(${p.id}, '${p.nombre.replace(/'/g, "\\'")}', ${esGestor})" class="w-full mt-6 py-2.5 bg-[#0f2a4a] hover:bg-[#1b4f8a] text-white font-bold text-xs rounded-xl shadow transition flex items-center justify-center space-x-2 cursor-pointer">
        <span>Ingresar al Proyecto</span>
        <span class="text-sm">→</span>
      </button>
    `;
    grid.appendChild(card);
  });

  if (!mostrandoOcultosHub) {
    const cardNuevo = document.createElement("div");
    cardNuevo.onclick = abrirModalNuevoProyecto;
    cardNuevo.className = "bg-slate-50/60 hover:bg-white rounded-2xl p-6 border-2 border-dashed border-slate-300 hover:border-teal-500 transition-all cursor-pointer flex flex-col items-center justify-center text-center group min-h-[290px] shadow-sm hover:shadow-md";
    cardNuevo.innerHTML = `
      <div class="w-12 h-12 rounded-full bg-teal-50 group-hover:bg-teal-600 text-teal-600 group-hover:text-white flex items-center justify-center text-xl font-black mb-3 transition shadow-sm">
        +
      </div>
      <h4 class="text-sm font-black text-gray-700 group-hover:text-[#0f2a4a] transition">Nuevo Proyecto / Programa</h4>
      <p class="text-[11px] text-gray-400 mt-1 max-w-[200px]">Cree un proyecto en blanco o seleccione una plantilla.</p>
      <span class="mt-4 text-[11px] font-bold text-teal-600 bg-teal-50 px-3 py-1 rounded-lg border border-teal-100 group-hover:bg-teal-600 group-hover:text-white transition">Comenzar</span>
    `;
    grid.appendChild(cardNuevo);
  }
}

function renderizarTablaHub(lista) {
  const tbody = document.getElementById("hub-proyectos-tabla-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  actualizarBotonOcultosHubUI();

  const listaFinal = lista.filter(p => mostrandoOcultosHub ? idsProyectosOcultos.has(p.id) : !idsProyectosOcultos.has(p.id));

  if (listaFinal.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-gray-400 font-semibold italic">No se encontraron proyectos.</td></tr>`;
    return;
  }

  listaFinal.forEach((p, idx) => {
    const rolEfectivo = p.rol_efectivo || (p.es_gestor ? 'GESTOR' : 'RESPONSABLE');
    const esGestor = (p.es_gestor === 1 || p.es_gestor === true || currentUser.rol === "ADMIN_TI") && rolEfectivo !== "AUTORIDAD";
    const totalActs = p.total_actividades || 0;
    const esProyectoVacio = totalActs === 0;
    const puedeEliminar = esGestor && esProyectoVacio;
    const esPublico = (p.visibilidad === "PUBLICO");

    let badgeRolHTML = `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black uppercase whitespace-nowrap bg-blue-100 text-blue-900 border border-blue-300">👤 RESPONSABLE</span>`;
    if (rolEfectivo === "GESTOR" || esGestor) {
      badgeRolHTML = `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black uppercase whitespace-nowrap bg-amber-100 text-amber-900 border border-amber-300">👑 GESTOR</span>`;
    } else if (rolEfectivo === "AUTORIDAD") {
      badgeRolHTML = `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black uppercase whitespace-nowrap bg-purple-100 text-purple-900 border border-purple-300">🏛️ AUTORIDAD</span>`;
    } else if (rolEfectivo === "VISUALIZADOR") {
      badgeRolHTML = `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black uppercase whitespace-nowrap bg-slate-100 text-slate-700 border border-slate-300">👁️ VISUALIZADOR</span>`;
    }

    const badgeAlcanceHTML = esPublico
      ? `<span class="inline-flex items-center justify-center w-5 h-5 rounded-md bg-teal-50 text-teal-700 border border-teal-200 text-xs shadow-2xs cursor-help flex-shrink-0" title="Proyecto visible a nivel institucional">🌐</span>`
      : `<span class="inline-flex items-center justify-center w-5 h-5 rounded-md bg-slate-100 text-slate-600 border border-slate-200 text-xs shadow-2xs cursor-help flex-shrink-0" title="Proyecto privado">🔒</span>`;

    const pct = p.avance_global || 0;
    const estaOculto = idsProyectosOcultos.has(p.id);

    const descEscapada = (p.descripcion || "").replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const tooltipDesc = esGestor ? 'title="Doble clic para editar descripción"' : '';
    const cursorDesc = esGestor ? 'cursor-pointer hover:text-teal-700 transition' : '';

    tbody.innerHTML += `
      <tr class="hover:bg-gray-50 transition border-b border-gray-100">
        <td class="p-3 text-center text-gray-400 font-mono text-xs">${idx + 1}</td>
        <td class="p-3">
          <div class="flex items-center gap-1.5">
            <span class="font-bold text-gray-800 text-xs">${p.nombre}</span>${badgeAlcanceHTML}
          </div>
          <div ${tooltipDesc} 
               ondblclick="${esGestor ? `editarDescripcionProyecto(${p.id}, '${descEscapada}')` : ''}" 
               class="text-[11px] text-gray-500 line-clamp-1 ${cursorDesc}">
            ${p.descripcion && p.descripcion.trim() !== '' ? p.descripcion : '<span class="italic text-gray-400">Sin descripción</span>'}
          </div>
          <div class="text-[10px] text-teal-800 font-semibold mt-0.5 flex items-center gap-1">
            <span>⚙️</span>
            <span class="${esGestor ? 'cursor-pointer hover:underline' : ''}" 
                  title="${(p.proceso_nombre || p.proceso_codigo) ? (p.es_proceso_personalizado ? `${p.proceso_nombre} [PERSONALIZADO]` : `${p.proceso_nombre} [${p.proceso_codigo}]`) : 'Sin proceso asignado'}" 
                  ondblclick="${esGestor ? `editarProcesoProyectoModal(${p.id})` : ''}">
              ${p.proceso_nombre ? p.proceso_nombre : (p.proceso_codigo ? `[${p.proceso_codigo}]` : '<span class="text-gray-400 italic">Sin proceso asignado</span>')}
            </span>
          </div>
        </td>
        <td class="p-3 text-center whitespace-nowrap">
          ${badgeRolHTML}
        </td>
        <td class="p-3 text-center">
          <div class="flex items-center space-x-2 justify-center">
            <div class="w-16 bg-gray-200 rounded-full h-2 overflow-hidden">
              <div class="bg-teal-600 h-2 rounded-full" style="width: ${pct}%;"></div>
            </div>
            <span class="font-black text-gray-800 text-xs">${pct}%</span>
          </div>
        </td>
        <td class="p-3 text-center">
          <div class="inline-flex items-center space-x-1.5 text-[10px] font-bold whitespace-nowrap">
            <span class="bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded whitespace-nowrap inline-flex items-center space-x-1" title="Ejecutadas">
              <span>${p.ejecutadas || 0}</span><span>Ejec.</span>
            </span>
            <span class="bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded whitespace-nowrap inline-flex items-center space-x-1" title="En proceso">
              <span>${p.en_proceso || 0}</span><span>En proc.</span>
            </span>
            <span class="bg-rose-50 text-rose-800 border border-rose-200 px-2 py-0.5 rounded whitespace-nowrap inline-flex items-center space-x-1" title="No iniciadas">
              <span>${p.pendientes || 0}</span><span>No inic.</span>
            </span>
          </div>
        </td>
        <td class="p-3 text-right whitespace-nowrap">
          <div class="inline-flex items-center justify-end space-x-1.5 w-full">
            <div class="inline-flex items-center justify-end space-x-1 min-w-[52px]">
              <button onclick="alternarOcultarProyecto(${p.id}, event)" class="p-1 rounded hover:bg-gray-200 transition cursor-pointer inline-flex items-center justify-center" title="${estaOculto ? 'Restaurar al panel' : 'Ocultar vista'}">
                ${estaOculto ? SVG_OJO_ABIERTO : SVG_OJO_CERRADO}
              </button>
              ${puedeEliminar ? `
                <button onclick="solicitarEliminarProyecto(${p.id}, '${p.nombre.replace(/'/g, "\\'")}', event)" class="p-1 rounded text-rose-500 hover:text-rose-700 hover:bg-rose-50 transition cursor-pointer inline-flex items-center justify-center" title="Eliminar proyecto vacío">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              ` : ''}
            </div>
            
            <button onclick="ingresarAlProyecto(${p.id}, '${p.nombre.replace(/'/g, "\\'")}', ${esGestor})" class="bg-[#0f2a4a] hover:bg-[#1b4f8a] text-white text-[11px] font-bold px-3 py-1.5 rounded-lg transition shadow cursor-pointer whitespace-nowrap">
              Ingresar →
            </button>
          </div>
        </td>
      </tr>
    `;
  });
}

// --- CARGA Y RENDERIZADO DE UNIDADES ORGÁNICAS ROF ---
async function cargarCatalogoUnidades() {
  const tbody = document.getElementById("uo-tabla-cuerpo");

  try {
    const promesas = [
      fetch("/unidades-organicas", { headers: { "Authorization": `Bearer ${token}` } })
    ];

    if (!catalogoTrabajadoresGlobal || catalogoTrabajadoresGlobal.length === 0) {
      promesas.push(
        fetch("/trabajadores", { headers: { "Authorization": `Bearer ${token}` } }).catch(() => null)
      );
    }

    const [resUo, resTrab] = await Promise.all(promesas);

    if (resTrab && resTrab.ok) {
      catalogoTrabajadoresGlobal = await resTrab.json();
    }

    if (!resUo.ok) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-rose-500 font-semibold">Error al consultar unidades orgánicas.</td></tr>`;
      return;
    }

    catalogoUnidadesGlobal = await resUo.json();
    if (!tbody) return;

    if (!catalogoUnidadesGlobal || catalogoUnidadesGlobal.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-gray-400 italic">No hay unidades registradas.</td></tr>`;
      return;
    }

    const listaPersonas = (catalogoTrabajadoresGlobal && catalogoTrabajadoresGlobal.length > 0)
      ? catalogoTrabajadoresGlobal
      : (usuariosTIGlobal || []);

    const selPadre = document.getElementById("uo-input-padre");
    if (selPadre) {
      let opcionesFormPadre = '<option value="">(Ninguna unidad de organización)</option>';
      catalogoUnidadesGlobal.forEach(u => {
        opcionesFormPadre += `<option value="${u.sigla}">[${u.sigla}] ${u.nombre}</option>`;
      });
      selPadre.innerHTML = opcionesFormPadre;
    }

    let htmlFilas = "";

    catalogoUnidadesGlobal.forEach(u => {
      const siglaPadreActual = String(u.sigla_padre || "").trim().toUpperCase();

      let opcionesPadre = `<option value="" ${siglaPadreActual === "" ? "selected" : ""}>(Nivel Máximo / Alta Dirección)</option>`;
      
      catalogoUnidadesGlobal.forEach(padreCand => {
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
            <select onchange="actualizarDependenciaROF(${u.id}, this.value, '${u.sigla}')" 
                    class="w-full text-[11px] font-bold p-1.5 bg-slate-50 border border-gray-300 rounded-lg outline-none focus:border-[#0f2a4a] cursor-pointer text-slate-700">
              ${opcionesPadre}
            </select>
          </td>
          <td class="p-2.5 min-w-[210px]">
            <select onchange="asignarTitularUnidad(${u.id}, this.value, '${u.sigla}')" 
                    class="w-full text-[11px] font-semibold p-1.5 bg-slate-50 border border-gray-300 rounded-lg outline-none focus:border-[#0f2a4a] cursor-pointer">
              ${opcionesTitular}
            </select>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = htmlFilas;

  } catch (e) {
    console.error("Error al cargar unidades:", e);
    if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-rose-500 font-semibold">Error de conexión al cargar unidades.</td></tr>`;
  }
}

async function actualizarDependenciaROF(unidadId, siglaPadre, siglaHijo) {
  try {
    const payload = {
      sigla_padre: siglaPadre ? siglaPadre.trim() : null
    };

    const res = await fetch(`/unidades-organicas/${unidadId}/dependencia`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(payload)
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

async function asignarTitularUnidad(unidadId, personaId, sigla) {
  try {
    const payload = {
      titular_trabajador_id: personaId ? parseInt(personaId) : null,
      titular_usuario_id: null
    };

    const res = await fetch(`/unidades-organicas/${unidadId}/titular`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(payload)
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

function autocompletarUnidadOrganica(termino) {
  const term = (termino || "").toLowerCase().trim();
  const divSug = document.getElementById("tra-sugerencias-uo");
  if (!divSug) return;

  if (!term) {
    divSug.innerHTML = "";
    divSug.classList.add("hidden");
    return;
  }

  const matches = (catalogoUnidadesGlobal || []).filter(u => 
    (u.estado === 'ACTIVO' || !u.estado) && (
      u.sigla.toLowerCase().includes(term) || 
      u.nombre.toLowerCase().includes(term)
    )
  );

  divSug.innerHTML = "";
  if (matches.length === 0) {
    divSug.innerHTML = `<div class="p-2.5 text-gray-400 italic">Sin coincidencias</div>`;
  } else {
    matches.slice(0, 6).forEach(u => {
      const item = document.createElement("div");
      item.className = "p-2.5 hover:bg-teal-50 cursor-pointer flex justify-between items-center transition border-b border-gray-100 last:border-0 font-semibold";
      item.innerHTML = `
        <span class="text-gray-800">${u.nombre}</span>
        <strong class="text-[#0f2a4a] ml-2 bg-slate-100 px-1.5 py-0.5 rounded border text-[11px]">[${u.sigla}]</strong>
      `;
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

async function cargarDirectorioTrabajadores() {
  const tbody = document.getElementById("tra-tabla-directorio");
  if (tbody && (!catalogoTrabajadoresGlobal || catalogoTrabajadoresGlobal.length === 0)) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-gray-400 font-semibold animate-pulse">Cargando directorio de trabajadores...</td></tr>`;
  }

  try {
    const res = await fetch("/trabajadores", {
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (res.status === 401) {
      alert("Su sesión ha expirado. Inicie sesión nuevamente.");
      cerrarSesion();
      return;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-red-500 font-semibold">Error al cargar directorio: ${err.detail || res.statusText}</td></tr>`;
      return;
    }

    catalogoTrabajadoresGlobal = await res.json();
    renderizarDirectorioTrabajadores(catalogoTrabajadoresGlobal);
  } catch (e) {
    console.error("Error al cargar trabajadores:", e);
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-red-500 font-semibold">Error de conexión al cargar trabajadores.</td></tr>`;
  }
}

function actualizarBotonTrabajadoresBajaUI() {
  const btnBaja = document.getElementById("btn-ver-trabajadores-baja");
  const txtCont = document.getElementById("txt-contador-tra-baja");
  if (!btnBaja) return;

  const inactivos = (catalogoTrabajadoresGlobal || []).filter(t => t.estado === "INACTIVO");
  const cant = inactivos.length;

  btnBaja.classList.remove("hidden");
  if (txtCont) {
    txtCont.innerText = `Trabajadores de baja (${cant})`;
  }

  if (cant > 0) {
    btnBaja.className = "px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 transition flex items-center space-x-1 cursor-pointer shadow-xs";
  } else {
    btnBaja.className = "px-2.5 py-1 rounded-lg text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-600 border border-gray-300 transition flex items-center space-x-1 cursor-pointer";
  }
}

function filtrarDirectorioTrabajadores() {
  const q = (document.getElementById("tra-filtro-directorio")?.value || "").toLowerCase().trim();
  const filtrados = (catalogoTrabajadoresGlobal || []).filter(t => 
    (t.nombre_completo && t.nombre_completo.toLowerCase().includes(q)) ||
    (t.unidad_organica && t.unidad_organica.toLowerCase().includes(q)) ||
    (t.correo && t.correo.toLowerCase().includes(q))
  );
  renderizarDirectorioTrabajadores(filtrados);
}

function renderizarDirectorioTrabajadores(lista) {
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
      ? `<span class="bg-purple-50 text-purple-800 border border-purple-200 px-1.5 py-0.5 rounded text-[10px] font-bold" title="Cargo: ${cargoTexto}">🏛️ ${cargoTexto}</span>`
      : `<span class="text-gray-600 font-semibold text-[11px]">${cargoTexto}</span>`;

    tbody.innerHTML += `
      <tr class="hover:bg-gray-50 border-b border-gray-100">
        <td class="p-2.5 font-bold text-gray-800 text-xs">${t.nombre_completo}</td>
        <td class="p-2.5 font-semibold text-teal-800"><span class="bg-teal-50 px-2 py-0.5 rounded border border-teal-200 text-xs">${t.unidad_organica}</span></td>
        <td class="p-2.5 whitespace-nowrap">${badgeCargo}</td>
        <td class="p-2.5 font-mono text-gray-600 text-xs">@${usuarioLogin}</td>
        <td class="p-2.5 text-center whitespace-nowrap">
          <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black bg-emerald-100 text-emerald-800">ACTIVO</span>
        </td>
        <td class="p-2.5 text-center whitespace-nowrap space-x-1.5">
          <button onclick="abrirModalEditarTrabajador(${t.id})" class="p-1 rounded text-blue-600 hover:text-blue-800 hover:bg-blue-50 transition font-bold cursor-pointer" title="Editar datos del trabajador">
            ✏️
          </button>
          <button onclick="solicitarDarDeBajaTrabajador(${t.id}, '${t.nombre_completo.replace(/'/g, "\\'")}')" class="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200 transition cursor-pointer">
            DAR DE BAJA
          </button>
        </td>
      </tr>
    `;
  });
}

async function solicitarDarDeBajaTrabajador(id, nombre) {
  const confirma = await confirmModal(
    `¿Está seguro de dar de baja al trabajador '${nombre}'?\n\nEl registro se moverá al archivo de bajas y dejará de aparecer en la lista activa del directorio.`,
    "Confirmar Baja de Trabajador",
    "warning"
  );
  if (!confirma) return;

  await alternarEstadoTrabajador(id);
}

async function registrarTrabajadorTI(e) {
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
    const res = await fetch("/trabajadores", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json", 
        "Authorization": `Bearer ${token}` 
      },
      body: JSON.stringify({ 
        nombres, 
        apellidos, 
        unidad_organica: uo, 
        correo_usuario: correo_user, 
        cargo: cargo,
        es_directivo: esDirectivo,
        crear_acceso: crearAcceso,
        password_inicial: passInicial,
        rol_sistema: "OPERADOR"
      })
    });

    if (res.status === 401) {
      alert("Sesión expirada. Inicie sesión nuevamente.");
      cerrarSesion();
      return;
    }

    if (res.ok) {
      notificarToast("Trabajador registrado exitosamente en el directorio.", "success");
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
    console.error("Error al registrar trabajador:", err);
    alert("Error de comunicación con el servidor.");
  }
}

async function alternarEstadoTrabajador(id) {
  try {
    const res = await fetch(`/trabajadores/estado/${id}`, {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${token}` 
      }
    });

    if (res.ok) {
      notificarToast("Estado de trabajador actualizado con éxito.", "info");
      await cargarDirectorioTrabajadores();
      
      const modalBaja = document.getElementById("modal-trabajadores-baja");
      if (modalBaja && !modalBaja.classList.contains("hidden")) {
        renderizarTablaTrabajadoresBaja();
      }
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || `Error del servidor (${res.status}): No se pudo cambiar el estado.`);
    }
  } catch (e) {
    console.error("Error al alternar estado trabajador:", e);
    alert("Error de conexión al intentar cambiar el estado del trabajador.");
  }
}

function renderizarTablaUsuariosTI(lista) {
  const tbody = document.getElementById("ti-tabla-usuarios");
  if (!tbody) return;
  tbody.innerHTML = "";
  lista.forEach(u => {
    const esActivo = u.estado === 'ACTIVO';
    const rolNormalizado = u.rol === 'ADMIN_TI' ? 'ADMIN_TI' : 'OPERADOR';

    tbody.innerHTML += `
      <tr class="hover:bg-gray-50 transition border-b border-gray-100">
        <td class="p-2.5 font-bold text-gray-800">${u.nombre_completo || '-'}</td>
        <td class="p-2.5 font-mono text-gray-600 whitespace-nowrap text-xs">@${u.username}</td>
        <td class="p-2.5 whitespace-nowrap">
          <select onchange="cambiarRolGlobalUsuario(${u.id}, this.value)" 
                  class="text-[10px] font-extrabold px-2 py-0.5 rounded-md border outline-none cursor-pointer leading-tight ${rolNormalizado === 'ADMIN_TI' ? 'bg-teal-50 text-teal-800 border-teal-300' : 'bg-slate-50 text-slate-700 border-slate-300'}">
            <option value="OPERADOR" ${rolNormalizado === 'OPERADOR' ? 'selected' : ''}>OPERADOR</option>
            <option value="ADMIN_TI" ${rolNormalizado === 'ADMIN_TI' ? 'selected' : ''}>ADMINISTRADOR TI</option>
          </select>
        </td>
        <td class="p-2.5 text-center whitespace-nowrap">
          <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-black leading-tight ${esActivo ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">
            ${u.estado}
          </span>
        </td>
        <td class="p-2.5 text-center whitespace-nowrap">
          <button onclick="alternarEstadoUsuario(${u.id}, '${esActivo ? 'INACTIVO' : 'ACTIVO'}')" 
                  class="inline-flex items-center px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase whitespace-nowrap leading-tight transition ${esActivo ? 'bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200'}">
            ${esActivo ? 'DAR DE BAJA' : 'REACTIVAR'}
          </button>
        </td>
      </tr>
    `;
  });
}

function filtrarUsuariosTI() {
  const q = (document.getElementById("ti-filtro-usuarios")?.value || "").toLowerCase().trim();
  const filtrados = usuariosTIGlobal.filter(u => 
    (u.nombre_completo && u.nombre_completo.toLowerCase().includes(q)) ||
    (u.username && u.username.toLowerCase().includes(q))
  );
  renderizarTablaUsuariosTI(filtrados);
}

async function darAltaUsuario(e) {
  e.preventDefault();
  const nombres = document.getElementById("ti-input-nombres").value.trim();
  const apellidos = document.getElementById("ti-input-apellidos").value.trim();
  const username = document.getElementById("ti-input-user").value.trim();
  const password = document.getElementById("ti-input-pass").value.trim();
  const rol = document.getElementById("ti-input-rol").value;

  try {
    const res = await fetch("/usuarios", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ nombres, apellidos, username, password, rol })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Error al dar de alta");
    }
    notificarToast("Usuario creado con éxito", "success");
    document.getElementById("ti-input-nombres").value = "";
    document.getElementById("ti-input-apellidos").value = "";
    document.getElementById("ti-input-user").value = "";
    document.getElementById("ti-input-pass").value = "";
    cargarListaUsuariosTI();
  } catch (err) {
    alert(err.message);
  }
}

async function alternarEstadoUsuario(usuarioId, nuevoEstado) {
  try {
    const res = await fetch("/usuarios/estado", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ usuario_id: usuarioId, estado: nuevoEstado })
    });
    if (res.ok) {
      notificarToast(`Estado actualizado a ${nuevoEstado}.`, "info");
      cargarListaUsuariosTI();
    }
  } catch (e) {}
}

async function cambiarRolGlobalUsuario(usuarioId, nuevoRol) {
  try {
    const res = await fetch("/usuarios/rol", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ usuario_id: usuarioId, rol: nuevoRol })
    });
    if (res.ok) {
      notificarToast(`Rol actualizado a ${nuevoRol}.`, "success");
      cargarListaUsuariosTI();
    }
  } catch (e) {}
}

let dataPersonalProyecto = { miembros: [], todos_usuarios: [], responsables_en_actividades: [] };
let usuarioSeleccionadoParaRol = null;

async function abrirResponsables() {
  if (!proyectoEsGestor && currentUser.rol !== "ADMIN_TI") {
    alert("Solo un Gestor del Proyecto puede administrar los roles y el personal.");
    return;
  }

  usuarioSeleccionadoParaRol = null;
  const inp = document.getElementById("inp-buscar-usuario-rol");
  if (inp) inp.value = "";
  const divSug = document.getElementById("sugerencias-usuarios-rol");
  if (divSug) divSug.classList.add("hidden");

  const modal = document.getElementById("modal-responsables");
  const tbody = document.getElementById("personal-permisos-tabla-body");

  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-gray-400 font-semibold animate-pulse">Sincronizando miembros y permisos...</td></tr>`;
  }
  modal.classList.remove("hidden");

  await recargarDatosPersonalProyecto();
}

function cerrarResponsables() {
  document.getElementById("modal-responsables").classList.add("hidden");
  cargarActividades();
}

async function recargarDatosPersonalProyecto() {
  try {
    const res = await fetch(`/proyectos/${proyectoActualId}/personal_permisos`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!res.ok) throw new Error("Error cargando permisos");
    dataPersonalProyecto = await res.json();
    renderizarTablaMiembrosProyecto();
  } catch (e) {
    console.error(e);
    alert("No se pudo cargar la lista de personal del proyecto.");
  }
}

function renderizarTablaMiembrosProyecto() {
  const tbody = document.getElementById("personal-permisos-tabla-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!dataPersonalProyecto.miembros || dataPersonalProyecto.miembros.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-gray-400 font-semibold">No hay roles especiales asignados. Utilice el buscador superior para agregar gestores o visualizadores.</td></tr>`;
    return;
  }

  dataPersonalProyecto.miembros.forEach(m => {
    const esGestor = (m.nivel_permiso === "GESTOR" || m.es_gestor === 1);
    tbody.innerHTML += `
      <tr class="hover:bg-gray-50 transition border-b border-gray-100">
        <td class="p-2.5 font-bold text-gray-800">${m.nombre_completo || '-'}</td>
        <td class="p-2.5 font-mono text-gray-500 text-xs">@${m.username}</td>
        <td class="p-2.5 text-center">
          <span class="px-2.5 py-1 rounded-md text-[11px] font-bold ${esGestor ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-blue-100 text-blue-900 border border-blue-300'}">
            ${esGestor ? '👑 Gestor de Proyecto' : '👁️ Visualizador del Proyecto'}
          </span>
        </td>
        <td class="p-2.5 text-center">
          <button onclick="removerRolProyecto(${m.id}, '${m.nombre_completo || m.username}')" class="text-red-500 hover:text-red-700 font-bold px-2 py-1" title="Quitar rol">
            🗑️
          </button>
        </td>
      </tr>
    `;
  });
}

function autocompletarBusquedaUsuarios(termino) {
  const term = termino.toLowerCase().trim();
  const divSugerencias = document.getElementById("sugerencias-usuarios-rol");
  if (!divSugerencias) return;
  
  if (!term) {
    divSugerencias.innerHTML = "";
    divSugerencias.classList.add("hidden");
    usuarioSeleccionadoParaRol = null;
    return;
  }

  const fuenteUsuarios = (dataPersonalProyecto.todos_usuarios && dataPersonalProyecto.todos_usuarios.length > 0)
    ? dataPersonalProyecto.todos_usuarios
    : (usuariosTIGlobal || []);

  const coincidencias = fuenteUsuarios.filter(u => 
    (u.estado === 'ACTIVO' || !u.estado) && (
      (u.nombre_completo && u.nombre_completo.toLowerCase().includes(term)) ||
      (u.username && u.username.toLowerCase().includes(term))
    )
  );

  divSugerencias.innerHTML = "";
  if (coincidencias.length === 0) {
    divSugerencias.innerHTML = `<div class="p-2.5 text-gray-400 italic">No se encontraron usuarios con '${termino}'</div>`;
  } else {
    coincidencias.slice(0, 6).forEach(u => {
      const item = document.createElement("div");
      item.className = "p-2.5 hover:bg-teal-50 cursor-pointer flex justify-between items-center transition border-b border-gray-100 last:border-0";
      item.innerHTML = `
        <span class="font-bold text-[#0f2a4a]">${u.nombre_completo || u.username}</span>
        <span class="font-mono text-gray-400 text-[11px]">@${u.username}</span>
      `;
      item.onclick = () => {
        usuarioSeleccionadoParaRol = u;
        const inp = document.getElementById("inp-buscar-usuario-rol");
        if (inp) {
          inp.value = `${u.nombre_completo || u.username} (@${u.username})`;
        }
        divSugerencias.classList.add("hidden");
      };
      divSugerencias.appendChild(item);
    });
  }
  divSugerencias.classList.remove("hidden");
}

async function confirmarAsignacionRolUsuario() {
  if (!usuarioSeleccionadoParaRol) {
    alert("Por favor busque y seleccione un trabajador de la lista de sugerencias.");
    return;
  }

  const u = usuarioSeleccionadoParaRol;
  const rolElegido = document.getElementById("sel-rol-asignar").value;
  
  const miembroActual = (dataPersonalProyecto.miembros || []).find(m => m.id === u.id);
  if (miembroActual && (miembroActual.nivel_permiso === "GESTOR" || miembroActual.es_gestor === 1)) {
    if (rolElegido === "GESTOR") {
      alert(`ℹ️ El usuario '${u.nombre_completo || u.username}' ya cuenta con el rol de Gestor de Proyecto.`);
      return;
    }
  }

  const tieneActividades = (dataPersonalProyecto.responsables_en_actividades || []).some(nomResp => 
    nomResp.includes(u.nombre_completo) || (u.nombre_completo && nomResp.includes(u.username))
  );

  if (tieneActividades && rolElegido === "VISUALIZADOR") {
    alert(`ℹ️ El usuario '${u.nombre_completo || u.username}' ya tiene actividades asignadas como Responsable en este proyecto, por lo que ya cuenta con visibilidad y acceso operativo.\n\nSi desea concederle privilegios de administración, asígnele el rol 'Gestor de Proyecto'.`);
    return;
  }

  try {
    const res = await fetch(`/proyectos/${proyectoActualId}/personal_permisos`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json", 
        "Authorization": `Bearer ${token}` 
      },
      body: JSON.stringify({ usuario_id: u.id, nivel: rolElegido })
    });

    if (res.ok) {
      notificarToast(`Rol '${rolElegido === 'GESTOR' ? 'Gestor de Proyecto' : 'Visualizador'}' asignado con éxito.`, "success");
      document.getElementById("inp-buscar-usuario-rol").value = "";
      usuarioSeleccionadoParaRol = null;
      await recargarDatosPersonalProyecto();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || "No se pudo asignar el rol.");
    }
  } catch (e) {
    console.error(e);
    alert("Error de comunicación con el servidor.");
  }
}

async function removerRolProyecto(usuarioId, nombre) {
  const seguro = await confirmModal(
    `¿Desea remover los privilegios especiales de ${nombre} en este proyecto?`,
    "Confirmar Retiro de Rol",
    "warning"
  );
  if (!seguro) return;

  try {
    const res = await fetch(`/proyectos/${proyectoActualId}/personal_permisos`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json", 
        "Authorization": `Bearer ${token}` 
      },
      body: JSON.stringify({ usuario_id: usuarioId, nivel: 'NINGUNO' })
    });

    if (res.ok) {
      notificarToast(`Privilegios removidos para ${nombre}.`, "info");
      await recargarDatosPersonalProyecto();
    } else {
      const err = await res.json().catch(() => ({}));
      notificarToast(err.detail || "No se pudo actualizar el permiso.", "error");
    }
  } catch (e) {
    notificarToast("Error al remover permisos.", "error");
  }
}

let listaAsignadosModal = [];
let responsablesInicialesEdicion = [];

async function editarResponsable(cod) {
  if (!proyectoEsGestor && currentUser.rol !== "ADMIN_TI") {
    alert("Solo un Gestor del Proyecto puede asignar o modificar responsables.");
    return;
  }

  const codLimpio = String(cod).trim().replace(/\.+$/, "");
  actividadMultiRespActual = actividadesGlobal.find(a => String(a.codigo).trim().replace(/\.+$/, "") === codLimpio);
  if (!actividadMultiRespActual) {
    alert("No se encontró la actividad seleccionada.");
    return;
  }

  try {
    if (!catalogoTrabajadoresGlobal || catalogoTrabajadoresGlobal.length === 0) {
      await cargarDirectorioTrabajadores();
    }
  } catch (e) {
    console.warn("Precarga de trabajadores diferida:", e);
  }

  responsablesInicialesEdicion = obtenerListaResponsablesAsignados(actividadMultiRespActual.responsable);
  listaAsignadosModal = [];

  responsablesInicialesEdicion.forEach(nom => {
    const tObj = (catalogoTrabajadoresGlobal || []).find(t => t.nombre_completo && t.nombre_completo.trim().toLowerCase() === nom.trim().toLowerCase());
    listaAsignadosModal.push({
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
      const seleccionados = listaAsignadosModal.map(r => r.nombre_completo.trim()).filter(Boolean);
      const respFinal = seleccionados.length > 0 ? seleccionados.join("; ") : "No asignado";
      
      const actRef = actividadMultiRespActual;
      const codAct = actRef ? actRef.codigo : null;
      
      cerrarAsignarResponsables();
      if (!actRef) return;

      actRef.responsable = respFinal;
      poblarFiltroResponsablesDinamico();
      renderizarTabla();

      try {
        const res = await fetch("/actividades/responsable", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({
            proyecto_id: parseInt(proyectoActualId),
            codigo: String(codAct).trim(),
            responsable: respFinal
          })
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          alert(err.detail || "Error al persistir el responsable en la base de datos.");
        } else {
          localStorage.setItem(`cache_acts_proj_${proyectoActualId}`, JSON.stringify(actividadesGlobal));
          notificarToast("Responsable(s) asignado(s) y guardado(s) correctamente.", "success");
        }
      } catch (e) {
        console.error("Error al guardar responsable:", e);
        alert("Error de conexión con el servidor al guardar la asignación.");
      }

      const inicialesSet = new Set(responsablesInicialesEdicion.map(n => n.trim().toLowerCase()));
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

  const modalAsignar = document.getElementById("modal-asignar-responsables");
  if (modalAsignar) {
    modalAsignar.classList.remove("hidden");
  }
}

function renderizarListaAsignadosModal() {
  const contenedor = document.getElementById("lista-checkbox-responsables");
  if (!contenedor) return;
  contenedor.innerHTML = "";

  if (listaAsignadosModal.length === 0) {
    contenedor.innerHTML = `<p class="text-xs text-gray-400 italic text-center p-3">No hay responsables asignados. Use el buscador superior para agregar trabajadores.</p>`;
    return;
  }

  listaAsignadosModal.forEach((r, idx) => {
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

async function solicitarDesmarcarResponsable(idx) {
  const r = listaAsignadosModal[idx];
  const seguro = await confirmModal(`¿Está seguro de retirar a '${r.nombre_completo}' de los responsables de esta actividad?`, "Confirmar Retiro", "warning");
  if (seguro) {
    listaAsignadosModal.splice(idx, 1);
    notificarToast(`Se retiró a ${r.nombre_completo}.`, "info");
  }
  renderizarListaAsignadosModal();
}

function autocompletarResponsableActividad(termino) {
  const term = termino.toLowerCase().trim();
  const divSug = document.getElementById("sug-responsables-actividad");
  if (!divSug) return;
  
  if (!term) {
    divSug.classList.add("hidden");
    return;
  }

  const matches = (catalogoTrabajadoresGlobal || []).filter(t => 
    (t.estado === "ACTIVO") &&
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
        const yaExiste = listaAsignadosModal.some(a => a.nombre_completo.trim().toLowerCase() === t.nombre_completo.trim().toLowerCase());
        if (!yaExiste) {
          listaAsignadosModal.push({
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

function cerrarAsignarResponsables() {
  document.getElementById("modal-asignar-responsables").classList.add("hidden");
  actividadMultiRespActual = null;
}

let comentariosGlobal = [];
let actividadComentarioActual = null;
let comentarioEnEdicionId = null;

async function cargarComentariosProyecto() {
  if (!proyectoActualId) return;
  try {
    const res = await fetch(`/proyectos/${proyectoActualId}/comentarios`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (res.ok) {
      comentariosGlobal = await res.json();
      renderizarTabla();
    }
  } catch (e) {
    console.error("Error al cargar comentarios:", e);
  }
}

function abrirModalComentarios(cod) {
  const codLimpio = String(cod).replace(/\.+$/, "");
  actividadComentarioActual = actividadesGlobal.find(a => String(a.codigo).replace(/\.+$/, "") === codLimpio);
  if (!actividadComentarioActual) return;

  cancelarEdicionComentario();

  document.getElementById("com-modal-titulo").innerText = `Comentarios (${obtenerComentariosDeActividad(codLimpio).length})`;
  document.getElementById("com-modal-subtitulo").innerText = `[${actividadComentarioActual.codigo}] ${actividadComentarioActual.descripcion}`;

  renderizarTarjetasComentarios();
  document.getElementById("modal-comentarios").classList.remove("hidden");
  setTimeout(() => document.getElementById("com-input-texto").focus(), 100);
}

function cerrarModalComentarios() {
  document.getElementById("modal-comentarios").classList.add("hidden");
  actividadComentarioActual = null;
  cancelarEdicionComentario();
}

function obtenerComentariosDeActividad(codigo) {
  const codLimpio = String(codigo).replace(/\.+$/, "");
  return comentariosGlobal.filter(c => String(c.codigo_actividad).replace(/\.+$/, "") === codLimpio);
}

function renderizarTarjetasComentarios() {
  const contenedor = document.getElementById("com-lista-tarjetas");
  if (!contenedor || !actividadComentarioActual) return;
  contenedor.innerHTML = "";

  const lista = obtenerComentariosDeActividad(actividadComentarioActual.codigo);

  if (lista.length === 0) {
    contenedor.innerHTML = `
      <div class="p-8 text-center text-gray-400 space-y-2">
        <span class="text-3xl block">💬</span>
        <p class="text-xs font-semibold">No hay comentarios en esta actividad.</p>
        <p class="text-[11px] text-gray-400">Sea el primero en dejar una nota técnica o de seguimiento.</p>
      </div>
    `;
    return;
  }

  lista.forEach(c => {
    const esMio = (c.usuario_id === currentUser.id);
    const puedeEliminar = esMio || proyectoEsGestor || (currentUser.rol === "ADMIN_TI");
    const puedeEditar = esMio;

    const partes = (c.autor_nombre || "U").split(" ");
    const iniciales = (partes[0][0] + (partes[1] ? partes[1][0] : "")).toUpperCase();

    let hash = 0;
    for (let i = 0; i < c.autor_nombre.length; i++) hash = c.autor_nombre.charCodeAt(i) + ((hash << 5) - hash);
    const colorBg = coloresAvatar[Math.abs(hash) % coloresAvatar.length];

    const editadoTag = c.fecha_edicion ? `<span class="text-[10px] text-gray-400 italic ml-1.5" title="Editado: ${c.fecha_edicion}">(editado)</span>` : '';

    const tarjeta = document.createElement("div");
    tarjeta.className = "bg-white p-3.5 rounded-xl border border-gray-200/90 shadow-xs space-y-2";
    tarjeta.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-2">
          <div class="avatar-circle font-black" style="background-color: ${colorBg}; width: 22px; height: 22px; font-size: 8px;">${iniciales}</div>
          <div>
            <span class="text-xs font-bold text-[#0f2a4a]">${c.autor_nombre}</span>
            ${c.autor_unidad ? `<span class="text-[10px] font-semibold text-teal-800 bg-teal-50 px-1.5 py-0.2 rounded border border-teal-200 ml-1">${c.autor_unidad}</span>` : ''}
          </div>
        </div>
        <div class="flex items-center space-x-1.5 text-gray-400">
          <span class="text-[10px] font-medium text-gray-400">${c.fecha_creacion}</span>
          ${editadoTag}
          ${puedeEditar ? `<button onclick="iniciarEdicionComentario(${c.id}, '${c.texto.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')" class="text-blue-600 hover:text-blue-800 p-1 text-xs font-bold ml-1 cursor-pointer" title="Editar comentario">✏️</button>` : ''}
          ${puedeEliminar ? `<button onclick="eliminarComentario(${c.id})" class="text-rose-500 hover:text-rose-700 p-1 text-xs font-bold cursor-pointer" title="Eliminar comentario">🗑️</button>` : ''}
        </div>
      </div>
      <p class="text-xs text-gray-700 leading-relaxed whitespace-pre-line pl-7">${c.texto}</p>
    `;
    contenedor.appendChild(tarjeta);
  });

  contenedor.scrollTop = contenedor.scrollHeight;
}

function actualizarContadorComentario() {
  const txt = document.getElementById("com-input-texto").value;
  document.getElementById("com-contador-chars").innerText = `${txt.length} / 500 caracteres`;
}

function iniciarEdicionComentario(id, texto) {
  comentarioEnEdicionId = id;
  document.getElementById("com-input-texto").value = texto;
  document.getElementById("com-label-accion").innerText = "✏️ Editando comentario:";
  document.getElementById("com-txt-btn-publicar").innerText = "Guardar Cambios";
  document.getElementById("com-btn-cancelar-edicion").classList.remove("hidden");
  actualizarContadorComentario();
  document.getElementById("com-input-texto").focus();
}

function cancelarEdicionComentario() {
  comentarioEnEdicionId = null;
  const inp = document.getElementById("com-input-texto");
  if (inp) inp.value = "";
  const lbl = document.getElementById("com-label-accion");
  if (lbl) lbl.innerText = "✍️ Agregar un comentario:";
  const btnTxt = document.getElementById("com-txt-btn-publicar");
  if (btnTxt) btnTxt.innerText = "Publicar Comentario";
  const btnCanc = document.getElementById("com-btn-cancelar-edicion");
  if (btnCanc) btnCanc.classList.add("hidden");
  actualizarContadorComentario();
}

async function publicarComentario() {
  const texto = document.getElementById("com-input-texto").value.trim();
  if (!texto) {
    alert("Por favor escriba un texto antes de publicar.");
    return;
  }

  if (comentarioEnEdicionId) {
    try {
      const res = await fetch(`/comentarios/${comentarioEnEdicionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ texto: texto })
      });
      if (res.ok) {
        notificarToast("Comentario editado con éxito.", "success");
        await cargarComentariosProyecto();
        renderizarTarjetasComentarios();
        cancelarEdicionComentario();
      } else {
        const err = await res.json();
        alert(err.detail || "Error al editar comentario.");
      }
    } catch (e) {
      alert("Error de conexión.");
    }
  } else {
    try {
      const res = await fetch(`/comentarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          proyecto_id: proyectoActualId,
          codigo_actividad: actividadComentarioActual.codigo,
          texto: texto
        })
      });
      if (res.ok) {
        notificarToast("Comentario publicado.", "success");
        await cargarComentariosProyecto();
        renderizarTarjetasComentarios();
        document.getElementById("com-input-texto").value = "";
        actualizarContadorComentario();
      } else {
        const err = await res.json();
        alert(err.detail || "Error al publicar.");
      }
    } catch (e) {
      alert("Error de conexión.");
    }
  }
}

async function eliminarComentario(id) {
  const seguro = await confirmModal("¿Está seguro de eliminar este comentario?", "Eliminar Comentario", "danger");
  if (!seguro) return;

  try {
    const res = await fetch(`/comentarios/${id}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (res.ok) {
      notificarToast("Comentario eliminado.", "info");
      await cargarComentariosProyecto();
      renderizarTarjetasComentarios();
    } else {
      const err = await res.json();
      alert(err.detail || "No se pudo eliminar.");
    }
  } catch (e) {
    alert("Error de conexión.");
  }
}

let catalogoPlantillasGlobal = [];
let plantillaSeleccionadaId = null;
let plantillaParaImportarId = null;

function actualizarBotonPlantillaDinamico() {
  const btn = document.getElementById("btn-accion-plantilla-dinamico");
  const ico = document.getElementById("ico-accion-plantilla");
  const txt = document.getElementById("txt-accion-plantilla");
  if (!btn || !ico) return;

  if (!proyectoEsGestor && currentUser.rol !== "ADMIN_TI") {
    btn.classList.add("hidden");
    return;
  }
  btn.classList.remove("hidden");

  const tieneActividades = actividadesGlobal && actividadesGlobal.length > 0;

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

function gestionarAccionPlantillaDinamica() {
  const tieneActividades = actividadesGlobal && actividadesGlobal.length > 0;
  if (tieneActividades) {
    abrirModalGuardarPlantilla();
  } else {
    abrirModalImportarPlantillaProyecto();
  }
}

function cambiarTabNuevoProyecto(tab) {
  const btnBlanco = document.getElementById("np-tab-btn-blanco");
  const btnPlantilla = document.getElementById("np-tab-btn-plantilla");
  const contentBlanco = document.getElementById("np-tab-content-blanco");
  const contentPlantilla = document.getElementById("np-tab-content-plantilla");

  if (tab === "plantilla") {
    btnPlantilla.className = "px-4 py-2 rounded-t-lg bg-white text-[#0f2a4a] border-t border-l border-r border-gray-200 shadow-xs flex items-center space-x-1.5 font-bold";
    btnBlanco.className = "px-4 py-2 rounded-t-lg text-gray-500 hover:text-[#0f2a4a] transition flex items-center space-x-1.5 font-bold";
    contentBlanco.classList.add("hidden");
    contentPlantilla.classList.remove("hidden");
    cancelarSeleccionPlantilla();
    cargarGaleriaPlantillas();
  } else {
    btnBlanco.className = "px-4 py-2 rounded-t-lg bg-white text-[#0f2a4a] border-t border-l border-r border-gray-200 shadow-xs flex items-center space-x-1.5 font-bold";
    btnPlantilla.className = "px-4 py-2 rounded-t-lg text-gray-500 hover:text-[#0f2a4a] transition flex items-center space-x-1.5 font-bold";
    contentPlantilla.classList.add("hidden");
    contentBlanco.classList.remove("hidden");
  }
}

async function cargarGaleriaPlantillas() {
  const cont = document.getElementById("galeria-plantillas-contenedor");
  if (!cont) return;
  cont.innerHTML = `<div class="col-span-2 p-6 text-center text-gray-400 font-bold animate-pulse">Cargando biblioteca de plantillas...</div>`;

  try {
    const res = await fetch("/plantillas", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!res.ok) throw new Error("Error al cargar plantillas");
    catalogoPlantillasGlobal = await res.json();
    renderizarTarjetasPlantillas(catalogoPlantillasGlobal);
  } catch (e) {
    cont.innerHTML = `<div class="col-span-2 p-6 text-center text-red-500 font-semibold">No se pudo cargar la galería de plantillas.</div>`;
  }
}

function renderizarTarjetasPlantillas(lista) {
  const cont = document.getElementById("galeria-plantillas-contenedor");
  if (!cont) return;
  cont.innerHTML = "";

  if (lista.length === 0) {
    cont.innerHTML = `<div class="col-span-2 p-6 text-gray-400 italic font-semibold text-center">No se encontraron plantillas.</div>`;
    return;
  }

  lista.forEach(p => {
    const card = document.createElement("div");
    card.className = "bg-white p-3.5 rounded-xl border border-gray-200 hover:border-teal-500 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between group";
    card.onclick = () => seleccionarPlantillaParaClonar(p);
    card.innerHTML = `
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-[9px] font-black uppercase text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded">${p.categoria || 'General'}</span>
          <span class="text-[10px] font-bold text-gray-400 font-mono">${p.total_actividades || 0} tareas</span>
        </div>
        <h4 class="font-bold text-xs text-[#0f2a4a] group-hover:text-teal-700 transition leading-snug">${p.nombre}</h4>
        <p class="text-[11px] text-gray-500 mt-1 line-clamp-2 leading-relaxed">${p.descripcion || 'Sin descripción adicional.'}</p>
      </div>
      <div class="mt-3 pt-2 border-t border-gray-100 flex items-center justify-between">
        <span class="text-[10px] font-bold text-gray-400">⏱️ ~${p.duracion_estimada_dias || 0}d estim.</span>
        <span class="text-[11px] font-black text-teal-700 group-hover:underline">Seleccionar →</span>
      </div>
    `;
    cont.appendChild(card);
  });
}

function filtrarGaleriaPlantillas() {
  const q = (document.getElementById("filtro-plantillas-input")?.value || "").toLowerCase().trim();
  const filtradas = catalogoPlantillasGlobal.filter(p => 
    (p.nombre && p.nombre.toLowerCase().includes(q)) ||
    (p.descripcion && p.descripcion.toLowerCase().includes(q)) ||
    (p.categoria && p.categoria.toLowerCase().includes(q))
  );
  renderizarTarjetasPlantillas(filtradas);
}

function seleccionarPlantillaParaClonar(plantilla) {
  plantillaSeleccionadaId = plantilla.id;
  document.getElementById("txt-plantilla-elegida-tit").innerText = `📋 ${plantilla.nombre}`;
  document.getElementById("txt-plantilla-elegida-cat").innerText = plantilla.categoria || "General";
  document.getElementById("np-input-clon-nombre").value = plantilla.nombre;
  document.getElementById("np-input-clon-desc").value = plantilla.descripcion || "";
  document.getElementById("np-input-clon-uo-busq").value = "";
  document.getElementById("np-input-clon-uo-valor").value = "";
  document.getElementById("np-input-clon-proceso-busq").value = "";
  document.getElementById("np-input-clon-proceso-codigo").value = "";
  document.getElementById("np-input-clon-proceso-nombre").value = "";
  document.getElementById("np-input-clon-proceso-personalizado").value = "0";
  
  const contOtro = document.getElementById("contenedor-otro-subproceso-clon");
  if (contOtro) contOtro.classList.add("hidden");
  const inpOtroTexto = document.getElementById("input-otro-subproceso-clon-texto");
  if (inpOtroTexto) inpOtroTexto.value = "";

  const selModo = document.getElementById("np-input-clon-duration-mode");
  if (selModo) selModo.value = "business_days";
  const selVis = document.getElementById("np-input-clon-visibilidad");
  if (selVis) selVis.value = "PRIVADO";

  const hoyISO = new Date().toISOString().split("T")[0];
  document.getElementById("np-input-clon-fechaini").value = hoyISO;

  const bloque = document.getElementById("bloque-config-clonacion");
  bloque.classList.remove("hidden");
  bloque.scrollIntoView({ behavior: 'smooth' });
}

function cancelarSeleccionPlantilla() {
  plantillaSeleccionadaId = null;
  const bloque = document.getElementById("bloque-config-clonacion");
  if (bloque) bloque.classList.add("hidden");
}

function autocompletarProcesoClonacion(term) {
  const q = (term || "").toLowerCase().trim();
  const div = document.getElementById("sugerencias-proceso-clonacion");
  const contOtro = document.getElementById("contenedor-otro-subproceso-clon");
  if (!div) return;

  if (!q) {
    div.classList.add("hidden");
    return;
  }

  div.innerHTML = "";

  const matches = (catalogoProcesosGlobal || []).filter(p => 
    p.codigo.toLowerCase().includes(q) || p.nombre.toLowerCase().includes(q)
  );

  matches.slice(0, 6).forEach(p => {
    const row = document.createElement("div");
    row.className = "p-2.5 hover:bg-teal-50 cursor-pointer flex justify-between items-center font-semibold text-gray-800";
    row.innerHTML = `<span>${p.nombre}</span> <strong class="text-[#0f2a4a] bg-gray-100 px-1.5 py-0.5 rounded text-[10px]">[${p.codigo}]</strong>`;
    row.onclick = () => {
      document.getElementById("np-input-clon-proceso-busq").value = `${p.nombre} [${p.codigo}]`;
      document.getElementById("np-input-clon-proceso-codigo").value = p.codigo;
      document.getElementById("np-input-clon-proceso-nombre").value = p.nombre;
      document.getElementById("np-input-clon-proceso-personalizado").value = "0";
      div.classList.add("hidden");
      if (contOtro) contOtro.classList.add("hidden");
    };
    div.appendChild(row);
  });

  const itemOtro = document.createElement("div");
  itemOtro.className = "p-2.5 bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold cursor-pointer border-t border-amber-200 flex items-center justify-between";
  itemOtro.innerHTML = `<span>⚙️ Otro subproceso (Personalizado)</span> <span class="text-[10px] text-amber-700">Especificar</span>`;
  itemOtro.onclick = () => {
    document.getElementById("np-input-clon-proceso-busq").value = "Otro subproceso";
    document.getElementById("np-input-clon-proceso-codigo").value = "OTRO";
    document.getElementById("np-input-clon-proceso-nombre").value = "";
    document.getElementById("np-input-clon-proceso-personalizado").value = "1";
    div.classList.add("hidden");
    if (contOtro) {
      contOtro.classList.remove("hidden");
      document.getElementById("input-otro-subproceso-clon-texto")?.focus();
    }
  };
  div.appendChild(itemOtro);

  div.classList.remove("hidden");
}

function autocompletarUOClonacion(termino) {
  const term = (termino || "").toLowerCase().trim();
  const divSug = document.getElementById("sugerencias-uo-clonacion");
  if (!divSug) return;

  if (!term) {
    divSug.classList.add("hidden");
    return;
  }
  const matches = (catalogoUnidadesGlobal || []).filter(u => 
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
        document.getElementById("np-input-clon-uo-busq").value = `${u.sigla} - ${u.nombre}`;
        document.getElementById("np-input-clon-uo-valor").value = u.sigla;
        divSug.classList.add("hidden");
      };
      divSug.appendChild(item);
    });
  }
  divSug.classList.remove("hidden");
}

async function ejecutarCreacionDesdePlantilla() {
  if (!plantillaSeleccionadaId) return;

  const nombre = document.getElementById("np-input-clon-nombre").value.trim();
  const uo = document.getElementById("np-input-clon-uo-valor").value || document.getElementById("np-input-clon-uo-busq").value.trim();
  const fIniISO = document.getElementById("np-input-clon-fechaini").value;
  const desc = document.getElementById("np-input-clon-desc")?.value.trim() || "";
  const durMode = document.getElementById("np-input-clon-duration-mode")?.value || "business_days";
  const visib = document.getElementById("np-input-clon-visibilidad")?.value || "PRIVADO";

  const esPers = document.getElementById("np-input-clon-proceso-personalizado")?.value === "1";
  const procCod = esPers ? "OTRO" : (document.getElementById("np-input-clon-proceso-codigo")?.value || "");
  const procNom = esPers 
    ? (document.getElementById("input-otro-subproceso-clon-texto")?.value.trim() || "Otro subproceso")
    : (document.getElementById("np-input-clon-proceso-nombre")?.value || "");

  if (!nombre) {
    alert("Por favor ingrese un nombre para el proyecto.");
    return;
  }

  const fIniLatina = formatearFechaLatina(fIniISO);

  try {
    const res = await fetch("/proyectos/desde-plantilla", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json", 
        "Authorization": `Bearer ${token}` 
      },
      body: JSON.stringify({ 
        plantilla_id: plantillaSeleccionadaId, 
        nombre_proyecto: nombre, 
        descripcion: desc, 
        unidad_organica: uo, 
        fecha_inicio: fIniLatina,
        proceso_codigo: procCod,
        proceso_nombre: procNom,
        es_proceso_personalizado: esPers ? 1 : 0,
        duration_mode: durMode,
        visibilidad: visib
      })
    });

    if (res.ok) {
      const data = await res.json();
      cerrarModalNuevoProyecto();
      notificarToast("Proyecto generado desde plantilla exitosamente.", "success");
      await cargarHubProyectos();
      if (data.proyecto_id) {
        ingresarAlProyecto(data.proyecto_id, nombre, true);
      }
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || "Error al crear proyecto desde plantilla.");
    }
  } catch (e) {
    alert("Error de conexión al crear el proyecto.");
  }
}

function abrirModalGuardarPlantilla() {
  if (!proyectoActualId) return;
  document.getElementById("input-plantilla-nombre").value = document.getElementById("txt-nombre-proyecto")?.value || "";
  document.getElementById("input-plantilla-categoria").value = "";
  document.getElementById("input-plantilla-desc").value = "";
  document.getElementById("modal-guardar-plantilla").classList.remove("hidden");
}

function cerrarModalGuardarPlantilla() {
  document.getElementById("modal-guardar-plantilla").classList.add("hidden");
}

async function guardarProyectoComoPlantilla(e) {
  e.preventDefault();
  const nombre = document.getElementById("input-plantilla-nombre").value.trim();
  const cat = document.getElementById("input-plantilla-categoria").value.trim() || "General";
  const desc = document.getElementById("input-plantilla-desc").value.trim();

  if (!nombre) {
    alert("Consigne un nombre para la plantilla.");
    return;
  }

  try {
    const res = await fetch("/plantillas/desde-proyecto", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json", 
        "Authorization": `Bearer ${token}` 
      },
      body: JSON.stringify({ 
        proyecto_id: proyectoActualId, 
        nombre: nombre, 
        categoria: cat, 
        descripcion: desc 
      })
    });

    if (res.ok) {
      cerrarModalGuardarPlantilla();
      notificarToast("Plantilla registrada en la biblioteca institucional.", "success");
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || "Error al guardar plantilla.");
    }
  } catch (e) {
    alert("Error de conexión con el servidor.");
  }
}

async function abrirModalImportarPlantillaProyecto() {
  plantillaParaImportarId = null;
  document.getElementById("bloque-fechaini-importar").classList.add("hidden");
  document.getElementById("btn-confirmar-importar-plantilla").classList.add("hidden");
  document.getElementById("modal-importar-plantilla-proyecto").classList.remove("hidden");

  const cont = document.getElementById("lista-plantillas-importar-contenedor");
  if (!cont) return;
  cont.innerHTML = `<div class="col-span-2 p-4 text-center text-gray-400 font-bold animate-pulse">Cargando plantillas...</div>`;

  try {
    const res = await fetch("/plantillas", { headers: { "Authorization": `Bearer ${token}` } });
    const plantillas = await res.json();
    cont.innerHTML = "";

    if (!plantillas || plantillas.length === 0) {
      cont.innerHTML = `<div class="col-span-2 p-4 text-center text-gray-400 font-semibold italic">No hay plantillas registradas en la biblioteca.</div>`;
      return;
    }

    plantillas.forEach(p => {
      const item = document.createElement("div");
      item.className = "bg-white p-3 rounded-xl border border-gray-200 hover:border-teal-600 hover:shadow cursor-pointer transition flex flex-col justify-between";
      item.onclick = () => {
        plantillaParaImportarId = p.id;
        document.querySelectorAll("#lista-plantillas-importar-contenedor > div").forEach(d => d.classList.remove("border-teal-600", "bg-teal-50/50"));
        item.classList.add("border-teal-600", "bg-teal-50/50");

        const hoyISO = new Date().toISOString().split("T")[0];
        document.getElementById("input-importar-fechaini").value = hoyISO;
        document.getElementById("bloque-fechaini-importar").classList.remove("hidden");
        document.getElementById("btn-confirmar-importar-plantilla").classList.remove("hidden");
      };
      item.innerHTML = `
        <div>
          <span class="text-[9px] font-black uppercase text-teal-800 bg-teal-50 px-1.5 py-0.2 rounded border border-teal-200">${p.categoria || 'General'}</span>
          <h5 class="font-bold text-xs text-[#0f2a4a] mt-1">${p.nombre}</h5>
          <p class="text-[10px] text-gray-500 line-clamp-2 mt-0.5">${p.descripcion || ''}</p>
        </div>
        <span class="text-[10px] font-bold text-teal-700 mt-2 block">Seleccionar →</span>
      `;
      cont.appendChild(item);
    });
  } catch (e) {
    cont.innerHTML = `<div class="col-span-2 p-4 text-center text-red-500 font-semibold">Error al cargar plantillas.</div>`;
  }
}

function cerrarModalImportarPlantillaProyecto() {
  document.getElementById("modal-importar-plantilla-proyecto").classList.add("hidden");
  plantillaParaImportarId = null;
}

async function ejecutarImportacionEnProyectoActivo() {
  if (!plantillaParaImportarId || !proyectoActualId) return;

  const fIniISO = document.getElementById("input-importar-fechaini").value;
  const fIniLatina = formatearFechaLatina(fIniISO);

  try {
    const res = await fetch(`/proyectos/${proyectoActualId}/aplicar-plantilla`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json", 
        "Authorization": `Bearer ${token}` 
      },
      body: JSON.stringify({ 
        plantilla_id: plantillaParaImportarId, 
        nombre_proyecto: "", 
        fecha_inicio: fIniLatina 
      })
    });

    if (res.ok) {
      cerrarModalImportarPlantillaProyecto();
      notificarToast("Estructura importada exitosamente en el proyecto.", "success");
      await cargarActividades();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.detail || "Error al importar plantilla.");
    }
  } catch (e) {
    alert("Error de conexión al importar plantilla.");
  }
}

function obtenerClaveStorageAnchoCol() {
  const uId = currentUser.id || currentUser.username || "default";
  const pId = proyectoActualId || "global";
  return `ancho_col_desc_user_${uId}_proj_${pId}`;
}

function aplicarAnchoColumnaDescripcion(anchoPx) {
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

function inicializarRedimensionDescripcion() {
  const thDesc = document.getElementById("th-descripcion");
  const resizer = document.getElementById("resizer-col-descripcion");
  if (!thDesc || !resizer) return;

  const clave = obtenerClaveStorageAnchoCol();
  const anchoGuardado = localStorage.getItem(clave);
  if (anchoGuardado) {
    aplicarAnchoColumnaDescripcion(anchoGuardado);
  } else {
    aplicarAnchoColumnaDescripcion(260);
  }

  let inicioX = 0;
  let anchoInicial = 0;

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
    if (anchoFinal) {
      const claveActual = obtenerClaveStorageAnchoCol();
      localStorage.setItem(claveActual, anchoFinal);
    }

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

function abrirModalTrabajadoresBaja() {
  const modal = document.getElementById("modal-trabajadores-baja");
  if (!modal) return;

  const inp = document.getElementById("filtro-trabajadores-baja-input");
  if (inp) inp.value = "";

  renderizarTablaTrabajadoresBaja();
  modal.classList.remove("hidden");
}

function cerrarModalTrabajadoresBaja() {
  const modal = document.getElementById("modal-trabajadores-baja");
  if (modal) modal.classList.add("hidden");
}

function filtrarTrabajadoresBajaModal() {
  const q = (document.getElementById("filtro-trabajadores-baja-input")?.value || "").toLowerCase().trim();
  renderizarTablaTrabajadoresBaja(q);
}

function renderizarTablaTrabajadoresBaja(query = "") {
  const tbody = document.getElementById("tabla-trabajadores-baja-body");
  const txtCant = document.getElementById("txt-baja-resumen-cant");
  if (!tbody) return;
  tbody.innerHTML = "";

  const inactivos = (catalogoTrabajadoresGlobal || []).filter(t => t.estado === "INACTIVO");
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
          <button onclick="solicitarReactivarTrabajador(${t.id}, '${t.nombre_completo.replace(/'/g, "\\'")}')" class="px-3 py-1 rounded text-[10px] font-black uppercase bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-300 transition cursor-pointer shadow-xs">
            ✓ REACTIVAR
          </button>
        </td>
      </tr>
    `;
  });
}

async function solicitarReactivarTrabajador(id, nombre) {
  const confirma = await confirmModal(
    `¿Desea reactivar a '${nombre}' e integrarlo(a) nuevamente al Directorio Institucional activo?`,
    "Reactivar Trabajador",
    "question"
  );
  if (!confirma) return;

  try {
    const res = await fetch(`/trabajadores/estado/${id}`, {
      method: "PUT",
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (res.ok) {
      notificarToast(`Trabajador '${nombre}' reactivado exitosamente.`, "success");
      await cargarDirectorioTrabajadores();
      
      const inactivosRestantes = (catalogoTrabajadoresGlobal || []).filter(t => t.estado === "INACTIVO");
      if (inactivosRestantes.length === 0) {
        cerrarModalTrabajadoresBaja();
      } else {
        renderizarTablaTrabajadoresBaja();
      }
    } else {
      alert("No se pudo reactivar al trabajador.");
    }
  } catch (e) {
    alert("Error de conexión al reactivar trabajador.");
  }
}

async function inicializarFiltrosHub() {
  const selUo = document.getElementById("hub-filtro-uo");
  if (!selUo) return;
  
  selUo.innerHTML = '<option value="">🏢 Todas las Unidades</option>';
  
  if (!catalogoUnidadesGlobal || catalogoUnidadesGlobal.length === 0) {
    try {
      const resUo = await fetch("/unidades-organicas", {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (resUo.ok) catalogoUnidadesGlobal = await resUo.json();
    } catch(e) {}
  }

  (catalogoUnidadesGlobal || []).forEach(u => {
    selUo.innerHTML += `<option value="${u.sigla}">${u.sigla} - ${u.nombre}</option>`;
  });
}

function autocompletarUOHub(termino) {
  const term = (termino || "").toLowerCase().trim();
  const divSug = document.getElementById("hub-sugerencias-uo");
  const btnLimpiar = document.getElementById("btn-limpiar-filtro-uo");
  
  if (!divSug) return;

  if (btnLimpiar) {
    if (term.length > 0) btnLimpiar.classList.remove("hidden");
    else btnLimpiar.classList.add("hidden");
  }

  if (!term) {
    divSug.innerHTML = "";
    divSug.classList.add("hidden");
    document.getElementById("hub-filtro-uo-valor").value = "";
    filtrarProyectosHub();
    return;
  }

  const matches = (catalogoUnidadesGlobal || []).filter(u => 
    (u.estado === 'ACTIVO' || !u.estado) && (
      u.sigla.toLowerCase().includes(term) || 
      u.nombre.toLowerCase().includes(term)
    )
  );

  divSug.innerHTML = "";
  if (matches.length === 0) {
    divSug.innerHTML = `<div class="p-2.5 text-gray-400 italic">Sin coincidencias</div>`;
  } else {
    const itemTodos = document.createElement("div");
    itemTodos.className = "p-2 hover:bg-slate-50 cursor-pointer text-slate-500 font-bold border-b border-gray-100 text-[11px]";
    itemTodos.innerHTML = `<span>× Cerrar filtro</span>`;
    itemTodos.onclick = () => {
      limpiarFiltroUnidadHub();
    };
    divSug.appendChild(itemTodos);

    matches.slice(0, 6).forEach(u => {
      const item = document.createElement("div");
      item.className = "p-2.5 hover:bg-teal-50 cursor-pointer flex justify-between items-center transition border-b border-gray-100 last:border-0 font-semibold";
      item.title = `${u.nombre} [${u.sigla}]`; 
      item.innerHTML = `
        <span class="text-gray-800 truncate pr-2">${u.nombre}</span>
        <strong class="text-[#0f2a4a] bg-slate-100 px-1.5 py-0.5 rounded border text-[10px] flex-shrink-0">[${u.sigla}]</strong>
      `;
      item.onclick = () => {
        document.getElementById("hub-filtro-uo-busq").value = `${u.sigla} - ${u.nombre}`;
        document.getElementById("hub-filtro-uo-valor").value = u.sigla;
        if (btnLimpiar) btnLimpiar.classList.remove("hidden");
        divSug.classList.add("hidden");
        filtrarProyectosHub();
      };
      divSug.appendChild(item);
    });
  }
  divSug.classList.remove("hidden");
}

function limpiarFiltroUnidadHub() {
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

function obtenerProyectosFiltradosHub() {
  const query = (document.getElementById("hub-filtro-busqueda")?.value || "").toLowerCase().trim();
  const filtroUoVal = document.getElementById("hub-filtro-uo-valor")?.value || document.getElementById("hub-filtro-uo-busq")?.value || "";
  const filtroUo = filtroUoVal.includes(" - ") ? filtroUoVal.split(" - ")[0].trim() : filtroUoVal.trim();
  const filtroEstado = document.getElementById("hub-filtro-estado")?.value || "";

  return proyectosUsuarioGlobal.filter(p => {
    const matchTexto = !query || (p.nombre && p.nombre.toLowerCase().includes(query)) || (p.descripcion && p.descripcion.toLowerCase().includes(query));
    
    let matchUo = true;
    if (filtroUo !== "") {
      const pUo = (p.unidad_organica || "").trim().toUpperCase();
      const fUo = filtroUo.toUpperCase();
      matchUo = (pUo === fUo || pUo.startsWith(fUo + " ") || pUo.includes(`[${fUo}]`));
    }

    let matchEstado = true;
    if (filtroEstado === "Ejecutado") {
      matchEstado = (p.avance_global === 100);
    } else if (filtroEstado === "En proceso") {
      matchEstado = (p.avance_global > 0 && p.avance_global < 100);
    } else if (filtroEstado === "No iniciado") {
      matchEstado = (p.avance_global === 0);
    }

    return matchTexto && matchUo && matchEstado;
  });
}

function filtrarProyectosHub() {
  const filtrados = obtenerProyectosFiltradosHub();
  actualizarBadgeFiltrosHub();

  if (vistaHubActual === "table") {
    renderizarTablaHub(filtrados);
  } else {
    renderizarTarjetasHub(filtrados);
  }
}

function actualizarBadgeFiltrosHub() {
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

function hubLimpiarTodosFiltros() {
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

let catalogoProcesosGlobal = [];
let tipoGraficoActual = 'bar';
let chartInstancia = null;

async function cargarCatalogoProcesos() {
  try {
    const res = await fetch("/procesos-institucionales", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (res.ok) {
      catalogoProcesosGlobal = await res.json();
    }
  } catch (e) {
    console.error("Error al cargar procesos:", e);
  }
}

function autocompletarProcesoNuevoProy(term) {
  const q = (term || "").toLowerCase().trim();
  const div = document.getElementById("nuevo-proy-proceso-sugerencias");
  const contOtro = document.getElementById("contenedor-otro-subproceso");
  if (!div) return;

  if (!q) {
    div.classList.add("hidden");
    return;
  }

  div.innerHTML = "";

  const matches = (catalogoProcesosGlobal || []).filter(p => 
    p.codigo.toLowerCase().includes(q) || p.nombre.toLowerCase().includes(q)
  );

  matches.slice(0, 6).forEach(p => {
    const row = document.createElement("div");
    row.className = "p-2.5 hover:bg-teal-50 cursor-pointer flex justify-between items-center font-semibold text-gray-800";
    row.innerHTML = `<span>${p.nombre}</span> <strong class="text-[#0f2a4a] bg-gray-100 px-1.5 py-0.5 rounded text-[10px]">[${p.codigo}]</strong>`;
    row.onclick = () => {
      document.getElementById("input-nuevo-proy-proceso-busq").value = `${p.nombre} [${p.codigo}]`;
      document.getElementById("input-nuevo-proy-proceso-codigo").value = p.codigo;
      document.getElementById("input-nuevo-proy-proceso-nombre").value = p.nombre;
      document.getElementById("input-nuevo-proy-proceso-personalizado").value = "0";
      div.classList.add("hidden");
      if (contOtro) contOtro.classList.add("hidden");
    };
    div.appendChild(row);
  });

  const itemOtro = document.createElement("div");
  itemOtro.className = "p-2.5 bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold cursor-pointer border-t border-amber-200 flex items-center justify-between";
  itemOtro.innerHTML = `<span>⚙️ Otro subproceso (Personalizado)</span> <span class="text-[10px] text-amber-700">Especificar</span>`;
  itemOtro.onclick = () => {
    document.getElementById("input-nuevo-proy-proceso-busq").value = "Otro subproceso";
    document.getElementById("input-nuevo-proy-proceso-codigo").value = "OTRO";
    document.getElementById("input-nuevo-proy-proceso-nombre").value = "";
    document.getElementById("input-nuevo-proy-proceso-personalizado").value = "1";
    div.classList.add("hidden");
    if (contOtro) {
      contOtro.classList.remove("hidden");
      document.getElementById("input-otro-subproceso-texto")?.focus();
    }
  };
  div.appendChild(itemOtro);

  div.classList.remove("hidden");
}

async function abrirModalEstadisticasHub() {
  if (!catalogoProcesosGlobal || catalogoProcesosGlobal.length === 0) {
    await cargarCatalogoProcesos();
  }

  const selUo = document.getElementById("stat-filtro-uo");
  if (selUo) {
    const uosExistentes = [...new Set((proyectosUsuarioGlobal || []).map(p => p.unidad_organica).filter(Boolean))];
    selUo.innerHTML = '<option value="">🏢 Todas las Unidades</option>' + 
      uosExistentes.map(u => `<option value="${u}">${u}</option>`).join("");
  }

  document.getElementById("modal-estadisticas-hub").classList.remove("hidden");
  aplicarFiltrosEstadisticas();
}

function cerrarModalEstadisticasHub() {
  document.getElementById("modal-estadisticas-hub").classList.add("hidden");
  if (chartInstancia) {
    chartInstancia.destroy();
    chartInstancia = null;
  }
}

function conmutarTipoGrafico(tipo) {
  tipoGraficoActual = tipo;
  const btnBarras = document.getElementById("btn-chart-barras");
  const btnPastel = document.getElementById("btn-chart-pastel");

  if (tipo === 'bar') {
    if (btnBarras) btnBarras.className = "px-2.5 py-1 rounded-md bg-white shadow-2xs text-[#0f2a4a] transition";
    if (btnPastel) btnPastel.className = "px-2.5 py-1 rounded-md text-gray-500 hover:text-gray-900 transition";
  } else {
    if (btnPastel) btnPastel.className = "px-2.5 py-1 rounded-md bg-white shadow-2xs text-[#0f2a4a] transition";
    if (btnBarras) btnBarras.className = "px-2.5 py-1 rounded-md text-gray-500 hover:text-gray-900 transition";
  }
  aplicarFiltrosEstadisticas();
}

function aplicarFiltrosEstadisticas() {
  const procCod = (document.getElementById("stat-filtro-proceso-val")?.value || "").trim().toUpperCase();
  const procTexto = (document.getElementById("stat-filtro-proceso")?.value || "").trim().toUpperCase();
  const uoFiltro = document.getElementById("stat-filtro-uo")?.value || "";
  const estFiltro = document.getElementById("stat-filtro-estado")?.value || "";

  const proyectosFiltrados = (proyectosUsuarioGlobal || []).filter(p => {
    if (uoFiltro && p.unidad_organica !== uoFiltro) return false;
    
    if (estFiltro) {
      const av = p.avance_global || 0;
      const estadoCalc = av === 100 ? "Ejecutado" : (av > 0 ? "En proceso" : "No iniciado");
      if (estadoCalc !== estFiltro) return false;
    }

    if (procCod || procTexto) {
      const codP = (p.proceso_codigo || "").toUpperCase();
      const nomP = (p.proceso_nombre || "").toUpperCase();
      const matchCod = procCod && (codP === procCod || codP.startsWith(procCod + "."));
      const matchNom = procTexto && (nomP.includes(procTexto) || codP.includes(procTexto));
      if (!matchCod && !matchNom) return false;
    }

    return true;
  });

  actualizarKPIsEstadisticas(proyectosFiltrados);
  renderizarGraficoEstadisticas(proyectosFiltrados);
  renderizarTablaDetalleEstadisticas(proyectosFiltrados);
}

function actualizarKPIsEstadisticas(lista) {
  const total = lista.length;
  let sumaAvance = 0;
  let enProc = 0;
  let ejec = 0;

  lista.forEach(p => {
    const av = p.avance_global || 0;
    sumaAvance += av;
    if (av === 100) ejec++;
    else if (av > 0) enProc++;
  });

  const prom = total > 0 ? Math.round(sumaAvance / total) : 0;

  document.getElementById("stat-kpi-total").innerText = total;
  document.getElementById("stat-kpi-promedio").innerText = `${prom}%`;
  document.getElementById("stat-kpi-en-proceso").innerText = enProc;
  document.getElementById("stat-kpi-ejecutados").innerText = ejec;
}

function renderizarGraficoEstadisticas(lista) {
  const canvas = document.getElementById("canvasEstadisticasHub");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  if (chartInstancia) {
    chartInstancia.destroy();
  }

  if (lista.length === 0) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  if (tipoGraficoActual === 'bar') {
    const labels = lista.map(p => p.nombre.length > 25 ? p.nombre.substring(0, 22) + "..." : p.nombre);
    const data = lista.map(p => p.avance_global || 0);

    chartInstancia = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: '% Avance',
          data: data,
          backgroundColor: data.map(v => v === 100 ? '#10b981' : (v > 0 ? '#0d9488' : '#cbd5e1')),
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } }
        },
        plugins: { legend: { display: false } }
      }
    });
  } else {
    let noInic = 0, enProc = 0, ejec = 0;
    lista.forEach(p => {
      const av = p.avance_global || 0;
      if (av === 100) ejec++;
      else if (av > 0) enProc++;
      else noInic++;
    });

    chartInstancia = new Chart(ctx, {
      type: 'pie',
      data: {
        labels: ['No iniciado', 'En proceso', 'Ejecutado'],
        datasets: [{
          data: [noInic, enProc, ejec],
          backgroundColor: ['#cbd5e1', '#f59e0b', '#10b981']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' }
        }
      }
    });
  }
}

function renderizarTablaDetalleEstadisticas(lista) {
  const cont = document.getElementById("stat-tabla-proyectos");
  const lblConteo = document.getElementById("stat-conteo-tabla");
  if (!cont) return;

  lblConteo.innerText = `${lista.length} proyecto(s)`;
  if (lista.length === 0) {
    cont.innerHTML = '<div class="p-4 text-center text-gray-400 italic">No hay proyectos coincidentes con los filtros seleccionados.</div>';
    return;
  }

  cont.innerHTML = lista.map(p => `
    <div class="p-3 flex items-center justify-between hover:bg-slate-50 transition">
      <div class="flex-1 pr-4">
        <h5 class="font-bold text-gray-800 text-xs">${p.nombre}</h5>
        <p class="text-[11px] text-gray-500 flex items-center gap-2 mt-0.5">
          <span>🏢 ${p.unidad_organica || 'Sin UO'}</span>
          <span>•</span>
          <span class="text-teal-700 font-semibold">⚙️ ${p.proceso_nombre ? `${p.proceso_nombre} [${p.proceso_codigo}]` : 'Sin proceso'}</span>
        </p>
      </div>
      <div class="flex items-center space-x-3">
        <span class="text-xs font-black px-2 py-0.5 rounded ${p.avance_global === 100 ? 'bg-emerald-100 text-emerald-800' : 'bg-teal-100 text-teal-800'}">
          ${p.avance_global || 0}%
        </span>
        <button onclick="cerrarModalEstadisticasHub(); ingresarAlProyecto(${p.id}, '${p.nombre.replace(/'/g, "\\'")}', ${(p.es_gestor === 1 || p.es_gestor === true)});" class="text-xs font-bold text-[#0f2a4a] hover:underline cursor-pointer">
          Ver →
        </button>
      </div>
    </div>
  `).join("");
}

function autocompletarSlicerProceso(term) {
  const q = (term || "").toLowerCase().trim();
  const div = document.getElementById("stat-sugerencias-proceso");
  const btnLimpiar = document.getElementById("btn-limpiar-stat-proceso");
  if (!div) return;

  if (!q) {
    div.classList.add("hidden");
    btnLimpiar.classList.add("hidden");
    document.getElementById("stat-filtro-proceso-val").value = "";
    aplicarFiltrosEstadisticas();
    return;
  }

  btnLimpiar.classList.remove("hidden");
  div.innerHTML = "";

  const matches = (catalogoProcesosGlobal || []).filter(p => 
    p.codigo.toLowerCase().includes(q) || p.nombre.toLowerCase().includes(q)
  );

  if (matches.length === 0) {
    div.innerHTML = `<div class="p-2 text-gray-400 italic">Sin coincidencias</div>`;
  } else {
    matches.slice(0, 6).forEach(p => {
      const item = document.createElement("div");
      item.className = "p-2 hover:bg-teal-50 cursor-pointer flex justify-between items-center font-medium";
      item.innerHTML = `<span>${p.nombre}</span> <strong class="text-[#0f2a4a] text-[10px]">[${p.codigo}]</strong>`;
      item.onclick = () => {
        document.getElementById("stat-filtro-proceso").value = `${p.nombre} [${p.codigo}]`;
        document.getElementById("stat-filtro-proceso-val").value = p.codigo;
        div.classList.add("hidden");
        aplicarFiltrosEstadisticas();
      };
      div.appendChild(item);
    });
  }
  div.classList.remove("hidden");
}

function limpiarSlicerProceso() {
  document.getElementById("stat-filtro-proceso").value = "";
  document.getElementById("stat-filtro-proceso-val").value = "";
  document.getElementById("btn-limpiar-stat-proceso").classList.add("hidden");
  aplicarFiltrosEstadisticas();
}

function resetearSlicersEstadisticas() {
  limpiarSlicerProceso();
  document.getElementById("stat-filtro-uo").value = "";
  document.getElementById("stat-filtro-estado").value = "";
  aplicarFiltrosEstadisticas();
}

async function abrirModalFeriados() {
  document.getElementById("modal-feriados").classList.remove("hidden");
  await cargarListaFeriados();
}

function cerrarModalFeriados() {
  document.getElementById("modal-feriados").classList.add("hidden");
}

async function cargarListaFeriados() {
  const tbody = document.getElementById("tabla-feriados-body");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-gray-400 font-semibold animate-pulse">Sincronizando calendario institucional...</td></tr>';

  const anoSel = document.getElementById("sel-filtro-ano-feriados")?.value || "";
  const url = anoSel ? `/feriados?year=${anoSel}` : "/feriados";

  try {
    const res = await fetch(url, {
      headers: { "Authorization": "Bearer " + token }
    });
    if (!res.ok) throw new Error("Error al obtener feriados");
    const feriados = await res.json();
    tbody.innerHTML = "";

    if (feriados.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="p-6 text-center text-gray-400 italic font-semibold">No hay feriados registrados para este periodo. Use el botón "+ Agregar" o "Proyectar Feriados para Siguiente Año".</td></tr>';
      return;
    }

    feriados.forEach(function(f) {
      const fFecha = f.fecha || "";
      const fMotivo = (f.motivo || f.descripcion || "").replace(/'/g, "\\'");
      const fTipo = f.tipo || "Calendario";
      const fId = f.id;

      const badgeTipo = fTipo === "Sector público"
        ? `<span class="bg-purple-50 text-purple-800 border border-purple-200 px-2 py-0.5 rounded text-[10px] font-bold">Sector público</span>`
        : `<span class="bg-blue-50 text-blue-800 border border-blue-200 px-2 py-0.5 rounded text-[10px] font-bold">Calendario</span>`;

      const fila = document.createElement("tr");
      fila.className = "hover:bg-gray-50 border-b border-gray-100";
      fila.innerHTML = `
        <td class="p-2.5 font-bold font-mono text-gray-800">${fFecha}</td>
        <td class="p-2.5">${badgeTipo}</td>
        <td class="p-2.5 font-semibold text-gray-800">${f.descripcion || f.motivo}</td>
        <td class="p-2.5 text-center whitespace-nowrap space-x-1.5">
          <button onclick="iniciarEdicionFeriado(${fId}, '${fFecha}', '${fMotivo}', '${fTipo}')" class="p-1 text-blue-600 hover:text-blue-800 font-bold hover:bg-blue-50 rounded transition cursor-pointer" title="Modificar feriado">
            ✏️
          </button>
          <button onclick="eliminarFeriado(${fId})" class="p-1 text-rose-500 hover:text-rose-700 font-bold hover:bg-rose-50 rounded transition cursor-pointer" title="Eliminar feriado">
            🗑️
          </button>
        </td>
      `;
      tbody.appendChild(fila);
    });
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-rose-500 font-semibold">Error al cargar calendario de feriados.</td></tr>';
  }
}

async function guardarFeriado(e) {
  e.preventDefault();
  const fecha = document.getElementById("input-feriado-fecha").value;
  const motivo = document.getElementById("input-feriado-motivo").value.trim();
  const tipo = document.getElementById("input-feriado-tipo").value;

  if (!fecha || !motivo) return;

  try {
    const res = await fetch("/feriados", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify({ fecha: fecha, motivo: motivo, tipo: tipo })
    });
    if (res.ok) {
      notificarToast("Feriado registrado en el calendario.", "success");
      document.getElementById("input-feriado-fecha").value = "";
      document.getElementById("input-feriado-motivo").value = "";
      await cargarListaFeriados();
    } else {
      const err = await res.json().catch(function() { return {}; });
      alert(err.detail || "Error al registrar feriado.");
    }
  } catch (err) {
    alert("Error de conexión al registrar feriado.");
  }
}

function iniciarEdicionFeriado(id, fechaActual, motivoActual, tipoActual) {
  document.getElementById("edit-feriado-id").value = id;
  document.getElementById("edit-feriado-fecha").value = fechaActual;
  document.getElementById("edit-feriado-motivo").value = motivoActual;
  document.getElementById("edit-feriado-tipo").value = tipoActual || "Calendario";

  document.getElementById("modal-editar-feriado").classList.remove("hidden");
}

function cerrarModalEditarFeriado() {
  const modal = document.getElementById("modal-editar-feriado");
  if (modal) modal.classList.add("hidden");
}

async function guardarEdicionFeriadoModal(e) {
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
    const res = await fetch(`/feriados/${id}`, {
      method: "PUT",
      headers: { 
        "Content-Type": "application/json", 
        "Authorization": "Bearer " + token 
      },
      body: JSON.stringify({ fecha: fecha, motivo: motivo, tipo: tipo })
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
    alert("Error de conexión al intentar actualizar el feriado.");
  }
}

async function eliminarFeriado(id) {
  const confirma = await confirmModal("¿Desea eliminar esta fecha del calendario institucional?", "Eliminar Feriado", "danger");
  if (!confirma) return;

  try {
    const res = await fetch("/feriados/" + id, {
      method: "DELETE",
      headers: { "Authorization": "Bearer " + token }
    });
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

async function proyectarFeriadosSiguienteAno() {
  const confirma = await confirmModal(
    "¿Desea proyectar los feriados institucionales para el siguiente año fiscal?\n\nEl sistema copiará las festividades de ley y recalculará automáticamente la Semana Santa correspondiente al nuevo año.",
    "Proyección Anual de Feriados",
    "question"
  );
  if (!confirma) return;

  try {
    const res = await fetch("/feriados/proyectar-siguiente-ano", {
      method: "POST",
      headers: { "Authorization": "Bearer " + token }
    });
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

async function abrirModalProcesosTI() {
  document.getElementById("modal-procesos-ti").classList.remove("hidden");
  await cargarListaProcesosTI();
}

function cerrarModalProcesosTI() {
  document.getElementById("modal-procesos-ti").classList.add("hidden");
}

async function cargarListaProcesosTI() {
  const tbody = document.getElementById("tabla-procesos-ti-body");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-gray-400">Cargando procesos...</td></tr>';

  try {
    const res = await fetch("/procesos-institucionales", {
      headers: { "Authorization": "Bearer " + token }
    });
    if (!res.ok) throw new Error("Error al obtener catálogo");
    catalogoProcesosGlobal = await res.json();
    tbody.innerHTML = "";

    if (catalogoProcesosGlobal.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-gray-400 italic">No hay procesos registrados.</td></tr>';
      return;
    }

    catalogoProcesosGlobal.forEach(function(p) {
      const pId = p.id;
      const pCodigo = p.codigo || "";
      const pNombre = (p.nombre || "").replace(/'/g, "\\'");

      const fila = document.createElement("tr");
      fila.className = "hover:bg-gray-50 border-b border-gray-100";
      fila.innerHTML = 
        '<td class="p-2.5 font-bold font-mono text-[#0f2a4a]">[' + pCodigo + ']</td>' +
        '<td class="p-2.5 font-semibold text-gray-800">' + (p.nombre || "") + '</td>' +
        '<td class="p-2.5 text-center">' +
          '<button onclick="eliminarProcesoTI(' + pId + ', \'' + pNombre + '\')" class="text-rose-500 hover:text-rose-700 font-bold px-1" title="Eliminar proceso">🗑️</button>' +
        '</td>';
      tbody.appendChild(fila);
    });
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-rose-500">Error al cargar catálogo de procesos.</td></tr>';
  }
}

async function guardarProcesoTI(e) {
  e.preventDefault();
  const codigo = document.getElementById("input-proc-ti-codigo").value.trim();
  const nombre = document.getElementById("input-proc-ti-nombre").value.trim();

  if (!codigo || !nombre) return;

  try {
    const res = await fetch("/procesos-institucionales", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify({ codigo: codigo, nombre: nombre })
    });
    if (res.ok) {
      notificarToast("Proceso institucional registrado.", "success");
      document.getElementById("input-proc-ti-codigo").value = "";
      document.getElementById("input-proc-ti-nombre").value = "";
      await cargarListaProcesosTI();
    } else {
      const err = await res.json().catch(function() { return {}; });
      alert(err.detail || "Error al registrar proceso.");
    }
  } catch (err) {
    alert("Error de conexión al registrar proceso.");
  }
}

async function eliminarProcesoTI(id, nombre) {
  const confirma = await confirmModal("¿Está seguro de eliminar el proceso '" + nombre + "'?", "Eliminar Proceso TI", "danger");
  if (!confirma) return;

  try {
    const res = await fetch("/procesos-institucionales/" + id, {
      method: "DELETE",
      headers: { "Authorization": "Bearer " + token }
    });
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

// Exponer las funciones reales al objeto global window para los botones onclick del HTML
if (typeof ingresarAlProyecto === 'function') {
  window.ingresarAlProyecto = ingresarAlProyecto;
}
if (typeof abrirModalAdminTI === 'function') {
  window.abrirModalAdminTI = abrirModalAdminTI;
}
if (typeof abrirModalNuevoProyecto === 'function') {
  window.abrirModalNuevoProyecto = abrirModalNuevoProyecto;
}
if (typeof cerrarMenuContextual === 'function') {
  window.cerrarMenuContextual = cerrarMenuContextual;
}