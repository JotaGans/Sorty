// =========================================================================
// PUNTO DE ENTRADA PRINCIPAL Y ORQUESTADOR ES6 (MAIN.JS)
// =========================================================================

import { state } from "./core/state.js";
import { notificarToast } from "./core/ui-dialogs.js";
import { inicializarFormularioLogin, actualizarDisplaysUsuario, mostrarLogin } from "./modules/auth/auth.js";
import { cargarHubProyectos } from "./modules/hub/hub.js";

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Reubicar modales en el body para prevenir solapamientos de z-index
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

  // 2. Inicializar autenticación
  inicializarFormularioLogin();

  // 3. Evaluar sesión activa
  if (state.token && state.currentUser.username) {
    document.getElementById("view-login")?.classList.add("hidden");
    actualizarDisplaysUsuario();
    await cargarHubProyectos();
  } else {
    mostrarLogin();
  }
});