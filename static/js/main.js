// =========================================================================
// PUNTO DE ENTRADA PRINCIPAL Y ORQUESTADOR ES6
// =========================================================================

import { state } from "./core/state.js";
import { notificarToast } from "./core/ui-dialogs.js";
import { inicializarFormularioLogin, actualizarDisplaysUsuario, mostrarLogin } from "./modules/auth.js";
import { cargarHubProyectos } from "./modules/hub.js";
import "./modules/admin-ti.js";           // Directorio, UO ROF, feriados, procesos
import "./modules/project-view/index.js"; // Dominio completo de Proyectos

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Reubicar modales en la raíz directa del BODY para evitar colisiones de stacking context
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

  // 2. Control de scroll en el Hub para cerrar sugerencias flotantes
  const viewHubEl = document.getElementById("view-hub");
  if (viewHubEl) {
    viewHubEl.addEventListener("scroll", () => {
      const divSug = document.getElementById("hub-sugerencias-uo");
      if (divSug && !divSug.classList.contains("hidden")) divSug.classList.add("hidden");
    }, { passive: true });
  }

  document.addEventListener("click", (e) => {
    const divSug = document.getElementById("hub-sugerencias-uo");
    const inpBusq = document.getElementById("hub-filtro-uo-busq");
    if (divSug && !divSug.classList.contains("hidden")) {
      if (!divSug.contains(e.target) && e.target !== inpBusq) divSug.classList.add("hidden");
    }
  });

  // Deseleccionar fila si se hace clic en el área vacía del dashboard o fuera de las filas
  const viewDashboard = document.getElementById("view-dashboard");
  if (viewDashboard) {
    viewDashboard.addEventListener("click", (e) => {
      // Si el clic no fue dentro de una fila de actividad, ni en menús o modales
      if (!e.target.closest("#lista-actividades tr") && 
          !e.target.closest("#bloque-superior-gantt") && 
          !e.target.closest("#menu-contextual") &&
          !e.target.closest(".fixed")) {
        if (typeof window.deseleccionarFila === "function") {
          window.deseleccionarFila();
        }
      }
    });
  }

  // 3. Inicializar autenticación y evaluar sesión activa
  inicializarFormularioLogin();

  if (state.token && state.currentUser.username) {
    document.getElementById("view-login")?.classList.add("hidden");
    actualizarDisplaysUsuario();
    await cargarHubProyectos();
  } else {
    mostrarLogin();
  }

  // 4. Autoguardado reactivo del nombre del proyecto
  const inputNombreProy = document.getElementById("txt-nombre-proyecto");
  if (inputNombreProy) {
    let nombreOriginalAlEnfocar = "";
    inputNombreProy.addEventListener("focus", () => {
      nombreOriginalAlEnfocar = inputNombreProy.value.trim();
    });

    const guardarNombreProyecto = async () => {
      if (!state.proyectoActualId || !state.proyectoEsGestor) return;
      const nuevoNombre = inputNombreProy.value.trim();
      if (!nuevoNombre || nuevoNombre === nombreOriginalAlEnfocar) return;

      try {
        const res = await fetch(`/proyectos/${state.proyectoActualId}/nombre`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${state.token}`
          },
          body: JSON.stringify({ nombre: nuevoNombre })
        });

        if (res.ok) {
          nombreOriginalAlEnfocar = nuevoNombre;
          notificarToast("Nombre del proyecto actualizado con éxito.", "success");
        }
      } catch (e) {}
    };

    inputNombreProy.addEventListener("blur", guardarNombreProyecto);
    inputNombreProy.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        inputNombreProy.blur();
      }
    });
  }

  // 5. Motor de desplazamiento temporal con rueda (Wheel) a 60 FPS
  let acumuladorScrollGantt = 0;
  let ultimoPasoScrollGantt = 0;
  let timerInerciaScroll = null;
  const UMBRAL_SCROLL_NATURAL_PX = 40;
  const CADENCIA_SCROLL_MS = 16;

  window.addEventListener("wheel", (e) => {
    const dashboard = document.getElementById("view-dashboard");
    if (!dashboard || dashboard.classList.contains("hidden")) return;

    const sobreAreaGantt = e.target.closest("#th-gantt, #gantt-header-meses, #gantt-header-semanas, td:nth-child(9), .gantt-avatar-circle");
    if (sobreAreaGantt) {
      e.preventDefault();

      if (e.ctrlKey) {
        const dirZoom = e.deltaY > 0 ? -1 : 1;
        const mapeo = { "semestres": 1, "trimestres": 2, "meses": 3, "semanas": 4, "dias": 5 };
        const reversa = { 1: "semestres", 2: "trimestres", 3: "meses", 4: "semanas", 5: "dias" };
        let nivelActual = mapeo[state.modoZoom] || 4;
        let nuevoNivel = Math.max(1, Math.min(5, nivelActual + dirZoom));
        if (typeof window.fijarModoZoomDirecto === "function") {
          window.fijarModoZoomDirecto(reversa[nuevoNivel]);
        }
        return;
      }

      clearTimeout(timerInerciaScroll);
      timerInerciaScroll = setTimeout(() => { acumuladorScrollGantt = 0; }, 120);

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
        if (state.modoZoom === "meses") saltoTemporal = 4;
        else if (state.modoZoom === "trimestres") saltoTemporal = 13;
        else if (state.modoZoom === "semestres") saltoTemporal = 26;

        const pasos = direccion * saltoTemporal;
        acumuladorScrollGantt = acumuladorScrollGantt > 0
          ? Math.max(0, acumuladorScrollGantt - UMBRAL_SCROLL_NATURAL_PX)
          : Math.min(0, acumuladorScrollGantt + UMBRAL_SCROLL_NATURAL_PX);

        ultimoPasoScrollGantt = ahora;
        if (typeof window.cambiarSemanaInicio === "function") {
          window.cambiarSemanaInicio(pasos);
        }
      }
    }
  }, { passive: false });

  // 6. Arrastre horizontal interactivo del Gantt
  let estaArrastrandoGantt = false;
  let inicioXGantt = 0;
  let acumuladorDeltaXGantt = 0;
  const SENSIBILIDAD_ARRASTRE_PX = 30;
  const tablaGanttEl = document.getElementById("tabla-gantt-main");

  if (tablaGanttEl) {
    tablaGanttEl.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const sobreGantt = e.target.closest("#th-gantt, #gantt-header-meses, #gantt-header-semanas, td:nth-child(9)");
      if (sobreGantt) {
        estaArrastrandoGantt = true;
        inicioXGantt = e.clientX;
        acumuladorDeltaXGantt = 0;
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
      }
    });

    window.addEventListener("mousemove", (e) => {
      if (!estaArrastrandoGantt) return;
      const diffX = e.clientX - inicioXGantt;
      acumuladorDeltaXGantt += diffX;
      inicioXGantt = e.clientX;

      if (Math.abs(acumuladorDeltaXGantt) >= SENSIBILIDAD_ARRASTRE_PX) {
        const pasos = Math.trunc(acumuladorDeltaXGantt / SENSIBILIDAD_ARRASTRE_PX);
        acumuladorDeltaXGantt = acumuladorDeltaXGantt % SENSIBILIDAD_ARRASTRE_PX;
        if (typeof window.cambiarSemanaInicio === "function") {
          window.cambiarSemanaInicio(-pasos);
        }
      }
    });

    window.addEventListener("mouseup", () => {
      if (estaArrastrandoGantt) {
        estaArrastrandoGantt = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    });
  }

  // 7. Calculadoras dinámicas de fechas en modales (Días Hábiles y Horas Netas)
  const fIniWz = document.getElementById("wz-input-ini");
  const fFinWz = document.getElementById("wz-input-fin");
  const diasWz = document.getElementById("wz-input-dias");

  if (fIniWz && fFinWz && diasWz) {
    let bloqueandoWz = false;

    const recalcularFinWizard = () => {
      if (bloqueandoWz || !fIniWz.value || !diasWz.value) return;
      const dtIni = new Date(fIniWz.value + "T00:00:00");
      const val = parseFloat(diasWz.value);
      if (val > 0) {
        bloqueandoWz = true;
        let dtFin;
        if (state.proyectoModoDuracion === "hours") {
          const diasEquiv = Math.max(1, Math.ceil(val / 8));
          dtFin = window.sumarDiasHabiles ? window.sumarDiasHabiles(dtIni, diasEquiv) : new Date(dtIni.getTime() + (diasEquiv - 1) * 86400000);
        } else {
          dtFin = window.sumarDiasHabiles ? window.sumarDiasHabiles(dtIni, Math.max(1, Math.round(val))) : new Date(dtIni.getTime() + (val - 1) * 86400000);
        }
        fFinWz.value = dtFin.toISOString().split("T")[0];
        bloqueandoWz = false;
      }
    };

    diasWz.addEventListener("input", recalcularFinWizard);
    fIniWz.addEventListener("input", recalcularFinWizard);

    fFinWz.addEventListener("input", () => {
      if (bloqueandoWz || !fIniWz.value || !fFinWz.value || state.proyectoModoDuracion === "hours") return;
      const dt1 = new Date(fIniWz.value + "T00:00:00");
      const dt2 = new Date(fFinWz.value + "T00:00:00");
      if (dt2 >= dt1 && window.contarDiasHabilesEntre) {
        bloqueandoWz = true;
        diasWz.value = window.contarDiasHabilesEntre(dt1, dt2);
        bloqueandoWz = false;
      }
    });
  }

  // 8. Accesibilidad por teclado global (Enter y Escape)
  document.addEventListener("keydown", (e) => {
    if (e.target && e.target.tagName.toLowerCase() === "textarea") return;

    if (e.key === "Enter") {
      const modDialog = document.getElementById("modal-dialog-imarpe");
      if (modDialog && !modDialog.classList.contains("hidden")) { e.preventDefault(); window.cerrarDialogoImarpe?.(true); return; }
      const modInput = document.getElementById("modal-input-custom");
      if (modInput && !modInput.classList.contains("hidden")) { e.preventDefault(); document.getElementById("mic-btn-guardar")?.click(); return; }
      const modFecha = document.getElementById("modal-fecha-custom");
      if (modFecha && !modFecha.classList.contains("hidden")) { e.preventDefault(); document.getElementById("mfc-btn-guardar")?.click(); return; }
      const modFin = document.getElementById("modal-fin-interactiva");
      if (modFin && !modFin.classList.contains("hidden")) { e.preventDefault(); document.getElementById("mfi-btn-guardar")?.click(); return; }
      const modResp = document.getElementById("modal-asignar-responsables");
      if (modResp && !modResp.classList.contains("hidden")) { e.preventDefault(); document.getElementById("btn-guardar-multi-resp")?.click(); return; }
      const modNotif = document.getElementById("modal-notificacion-correo");
      if (modNotif && !modNotif.classList.contains("hidden")) { e.preventDefault(); window.confirmarEnvioNotificaciones?.(); return; }
      const modWz = document.getElementById("modal-wizard-creacion");
      if (modWz && !modWz.classList.contains("hidden")) { e.preventDefault(); window.avanzarPasoWizard?.(); return; }
      const modCol = document.getElementById("modal-columnas");
      if (modCol && !modCol.classList.contains("hidden")) { e.preventDefault(); window.cerrarModalColumnas?.(); return; }
    }

    if (e.key === "Escape") {
      const idsPrioridadCierre = [
        "modal-editar-feriado", "modal-notificacion-correo", "modal-dialog-imarpe",
        "modal-input-custom", "modal-fecha-custom", "modal-fin-interactiva",
        "modal-asignar-responsables", "modal-wizard-creacion", "modal-columnas",
        "modal-comentarios", "modal-dependencias", "modal-cpm", "modal-historial",
        "modal-responsables", "modal-nuevo-proyecto", "modal-guardar-plantilla",
        "modal-importar-plantilla-proyecto", "modal-estadisticas-hub"
      ];
      for (const id of idsPrioridadCierre) {
        const el = document.getElementById(id);
        if (el && !el.classList.contains("hidden")) {
          el.classList.add("hidden");
          return;
        }
      }
    }
  });
});