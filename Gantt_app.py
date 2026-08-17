import sys
import sqlite3
import os
from datetime import datetime, timedelta
from PyQt6.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, 
                             QHBoxLayout, QLabel, QTreeWidget, QTreeWidgetItem, 
                             QHeaderView, QFrame, QPushButton, QInputDialog, 
                             QMessageBox, QStyledItemDelegate, QDialog,
                             QTableWidget, QTableWidgetItem, QMenu, QLineEdit,
                             QDialogButtonBox, QCheckBox, QComboBox, QFileDialog)
from PyQt6.QtCore import Qt, QRect, QPoint
from PyQt6.QtGui import QFont, QColor, QPainter, QBrush, QPixmap

# --- CONVERSIÓN HÍBRIDA DE FECHAS ---
def normalizar_a_formato_peruano(fecha_str):
    if not fecha_str or str(fecha_str).strip() == "Definir":
        return "Definir"
    fecha_str = str(fecha_str).strip()
    try:
        datetime.strptime(fecha_str, "%d/%m/%Y")
        return fecha_str
    except ValueError:
        try:
            dt = datetime.strptime(fecha_str, "%Y-%m-%d")
            return dt.strftime("%d/%m/%Y")
        except ValueError:
            return "Definir"

def parsear_fecha_segura(fecha_str):
    if not fecha_str or str(fecha_str).strip() == "Definir":
        return None
    fecha_str = str(fecha_str).strip()
    try:
        return datetime.strptime(fecha_str, "%d/%m/%Y")
    except ValueError:
        try:
            return datetime.strptime(fecha_str, "%Y-%m-%d")
        except ValueError:
            return None


# --- DIÁLOGO DE ENTRADA MANUAL CON MÁSCARA AUTOMÁTICA ---
class DialogoCalendarioCustom(QDialog):
    def __init__(self, titulo, instruccion, fecha_actual_str, parent=None):
        super().__init__(parent)
        self.setWindowTitle(titulo)
        self.setFixedWidth(380)
        self.setStyleSheet("background-color: #f8f9fa; font-family: 'Segoe UI';")
        self.setWindowModality(Qt.WindowModality.WindowModal)
        
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 20, 20, 20)
        layout.setSpacing(15)
        
        lbl_msg = QLabel(instruccion)
        lbl_msg.setFont(QFont("Segoe UI", 11, QFont.Weight.Bold))
        layout.addWidget(lbl_msg)
        
        lbl_format = QLabel("Las barras '/' se colocan solas automáticamente.")
        lbl_format.setStyleSheet("color: #7f8c8d; font-size: 11px;")
        layout.addWidget(lbl_format)
        
        fecha_limpia = normalizar_a_formato_peruano(fecha_actual_str)
        
        if fecha_limpia == "Definir":
            anio_actual = datetime.now().year
            dia_mes_hoy = datetime.now().strftime("%d/%m/")
            fecha_limpia = f"{dia_mes_hoy}{anio_actual}"
            
        self.txt_fecha = QLineEdit()
        self.txt_fecha.setText(fecha_limpia)
        self.txt_fecha.setPlaceholderText("DD/MM/AAAA")
        self.txt_fecha.setInputMask("99/99/9999;_")
        
        self.txt_fecha.setStyleSheet("""
            QLineEdit { 
                background-color: white; 
                color: #2c3e50; 
                border: 1px solid #b2bec3; 
                border-radius: 4px;
                padding: 8px; 
                font-size: 16px; 
                font-weight: bold;
            }
            QLineEdit:focus {
                border: 1px solid #0f2a4a;
            }
        """)
        layout.addWidget(self.txt_fecha)
        
        self.buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        self.buttons.button(QDialogButtonBox.StandardButton.Ok).setText("Aceptar")
        self.buttons.button(QDialogButtonBox.StandardButton.Cancel).setText("Cancelar")
        
        self.buttons.setStyleSheet("""
            QPushButton { background-color: #0f2a4a; color: white; min-width: 80px; padding: 6px; }
            QPushButton:hover { background-color: #1b4f8a; }
        """)
        
        self.buttons.accepted.connect(self.validar_y_aceptar)
        self.buttons.rejected.connect(self.reject)
        layout.addWidget(self.buttons)

    def validar_y_aceptar(self):
        texto = self.txt_fecha.text().strip()
        try:
            datetime.strptime(texto, "%d/%m/%Y")
            self.accept()
        except ValueError:
            QMessageBox.warning(self, "Fecha Inválida", "La fecha ingresada es irreal o incompleta.\nVerifique los días del mes ingresado.")

    def obtener_fecha_seleccionada(self):
        return self.txt_fecha.text().strip()


# --- CALCULADORA BIDIRECCIONAL EN TIEMPO REAL ---
class DialogoFechaFinInteractiva(QDialog):
    def __init__(self, dt_inicio_obj, fecha_fin_defecto_str, parent=None):
        super().__init__(parent)
        self.dt_inicio = dt_inicio_obj
        self.setWindowTitle("Definir Término de Componente")
        self.setFixedWidth(400)
        self.setStyleSheet("background-color: #f8f9fa; font-family: 'Segoe UI';")
        self.setWindowModality(Qt.WindowModality.WindowModal)
        
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 20, 20, 20)
        layout.setSpacing(15)
        
        lbl_msg = QLabel("Establezca la fecha de fin o la duración en días:")
        lbl_msg.setFont(QFont("Segoe UI", 11, QFont.Weight.Bold))
        layout.addWidget(lbl_msg)
        
        form_layout = QVBoxLayout()
        
        lbl_f = QLabel("Fecha de Fin (DD/MM/AAAA):")
        lbl_f.setStyleSheet("color: #2c3e50; font-weight: bold;")
        self.txt_fecha = QLineEdit()
        self.txt_fecha.setText(fecha_fin_defecto_str)
        self.txt_fecha.setInputMask("99/99/9999;_")
        self.txt_fecha.setStyleSheet("background-color: white; padding: 6px; font-size: 14px; font-weight: bold; color: #2c3e50;")
        
        lbl_d = QLabel("Duración estimada (Días manual):")
        lbl_d.setStyleSheet("color: #2c3e50; font-weight: bold;")
        self.txt_dias = QLineEdit()
        self.txt_dias.setPlaceholderText("Ej. 10")
        self.txt_dias.setStyleSheet("background-color: white; padding: 6px; font-size: 14px; font-weight: bold; color: #0f2a4a;")
        
        form_layout.addWidget(lbl_f)
        form_layout.addWidget(self.txt_fecha)
        form_layout.addWidget(lbl_d)
        form_layout.addWidget(self.txt_dias)
        layout.addLayout(form_layout)
        
        self.bloquear_recalculo = False
        
        self.txt_dias.textChanged.connect(self.recalcular_fecha_por_dias)
        self.txt_fecha.textChanged.connect(self.recalcular_dias_por_fecha)
        
        self.buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        self.buttons.button(QDialogButtonBox.StandardButton.Ok).setText("Confirmar")
        self.buttons.button(QDialogButtonBox.StandardButton.Cancel).setText("Cancelar")
        self.buttons.setStyleSheet("QPushButton { background-color: #0f2a4a; color: white; min-width: 80px; padding: 6px; }")
        
        self.buttons.accepted.connect(self.validar_y_aceptar)
        self.buttons.rejected.connect(self.reject)
        layout.addWidget(self.buttons)
        
        self.bloquear_recalculo = True
        dt_f = parsear_fecha_segura(fecha_fin_defecto_str)
        if dt_f and self.dt_inicio:
            diff = (dt_f - self.dt_inicio).days + 1
            if diff > 0:
                self.txt_dias.setText(str(diff))
        self.bloquear_recalculo = False

    def recalcular_fecha_por_dias(self, texto):
        if self.bloquear_recalculo: return
        if not texto.strip() or not texto.isdigit(): return
        
        dias = int(texto)
        if dias <= 0: return
        
        if self.dt_inicio:
            self.bloquear_recalculo = True
            dt_calculado = self.dt_inicio + timedelta(days=dias - 1)
            self.txt_fecha.setText(dt_calculado.strftime("%d/%m/%Y"))
            self.bloquear_recalculo = False

    def recalcular_dias_por_fecha(self, texto):
        if self.bloquear_recalculo: return
        texto_limpio = texto.strip().replace("/", "")
        if len(texto_limpio) != 8: return 
        
        try:
            dt_f = datetime.strptime(texto.strip(), "%d/%m/%Y")
            if self.dt_inicio and dt_f >= self.dt_inicio:
                self.bloquear_recalculo = True
                diff = (dt_f - self.dt_inicio).days + 1
                self.txt_dias.setText(str(diff))
                self.bloquear_recalculo = False
        except ValueError:
            pass

    def validar_y_aceptar(self):
        txt_f = self.txt_fecha.text().strip()
        try:
            dt_f = datetime.strptime(txt_f, "%d/%m/%Y")
            if self.dt_inicio and dt_f < self.dt_inicio:
                QMessageBox.warning(self, "Inconsistencia Temporal", "La fecha de fin no puede ser cronológicamente anterior a la de inicio.")
                return
            self.accept()
        except ValueError:
            QMessageBox.warning(self, "Formato Erróneo", "La fecha ingresada no es válida o está incompleta.")

    def obtener_valores(self):
        txt_f = self.txt_fecha.text().strip()
        dt_f = datetime.strptime(txt_f, "%d/%m/%Y")
        dias = (dt_f - self.dt_inicio).days + 1 if self.dt_inicio else 5
        return txt_f, dias
    
    # --- DELEGADO GRÁFICO PARA EL GANTT ---
class GanttEscalonadoDelegate(QStyledItemDelegate):
    def paint(self, painter, option, index):
        if index.column() == 8:
            estado = index.sibling(index.row(), 3).data(Qt.ItemDataRole.DisplayRole)
            avance_txt = index.sibling(index.row(), 7).data(Qt.ItemDataRole.DisplayRole)
            f_ini_txt = index.sibling(index.row(), 4).data(Qt.ItemDataRole.DisplayRole)
            f_fin_txt = index.sibling(index.row(), 5).data(Qt.ItemDataRole.DisplayRole)
            
            try:
                avance = float(avance_txt.replace("%", "")) / 100.0 if avance_txt else 0.0
            except:
                avance = 0.0

            painter.save()
            painter.setRenderHint(QPainter.RenderHint.Antialiasing)
            
            rect_celda = option.rect
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(QBrush(QColor("#f1f2f6")))
            
            rect_riel = QRect(rect_celda.left() + 5, rect_celda.top() + 6, rect_celda.width() - 10, 12)
            painter.drawRoundedRect(rect_riel, 3, 3)

            if f_ini_txt and f_fin_txt and f_ini_txt != "Definir" and f_fin_txt != "Definir":
                try:
                    f_ini = datetime.strptime(str(f_ini_txt).strip(), "%d/%m/%Y")
                    f_fin = datetime.strptime(str(f_fin_txt).strip(), "%d/%m/%Y")
                    
                    anio_proyecto = f_ini.year
                    inicio_proyecto = datetime(anio_proyecto, 1, 1)
                    fin_proyecto = datetime(anio_proyecto, 12, 31)
                    total_dias_anio = (fin_proyecto - inicio_proyecto).days + 1
                    
                    ancho_columna_gantt = rect_riel.width()
                    pix_por_dia = ancho_columna_gantt / total_dias_anio
                    
                    dias_desde_inicio = (f_ini - inicio_proyecto).days
                    duracion_dias = (f_fin - f_ini).days + 1
                    
                    pos_x_barra = rect_riel.left() + int(dias_desde_inicio * pix_por_dia)
                    ancho_barra = int(duracion_dias * pix_por_dia)
                    ancho_barra = max(12, ancho_barra)
                    
                    rect_barra_real = QRect(pos_x_barra, rect_riel.top(), ancho_barra, 12)
                    
                    if estado == "Ejecutado": color = QColor("#2ecc71")
                    elif estado == "En proceso": color = QColor("#f39c12")
                    else: color = QColor("#bdc5c8")
                    
                    painter.setBrush(QBrush(color))
                    painter.drawRoundedRect(rect_barra_real, 3, 3)
                    
                    if estado == "En proceso" and avance > 0:
                        rect_avance = QRect(rect_barra_real.left(), rect_barra_real.top(), int(rect_barra_real.width() * avance), 12)
                        painter.setBrush(QBrush(QColor("#d35400")))
                        painter.drawRoundedRect(rect_avance, 3, 3)
                except:
                    pass
            painter.restore()
        else:
            super().paint(painter, option, index)


# --- VENTANA HISTORIAL DE CAMBIOS ---
class VentanaHistorial(QDialog):
    def __init__(self, parent):
        super().__init__(parent)
        self.setWindowTitle("Historial de Cambios e Incidencias - Auditoría")
        self.setMinimumSize(750, 450)
        self.setStyleSheet("background-color: #f5f6fa; font-family: 'Segoe UI';")
        
        layout = QVBoxLayout(self)
        lbl = QLabel("Registro Cronológico de Modificaciones en la Base de Datos:")
        lbl.setFont(QFont("Segoe UI", 11, QFont.Weight.Bold))
        layout.addWidget(lbl)
        
        self.tabla = QTableWidget()
        self.tabla.setColumnCount(3)
        self.tabla.setHorizontalHeaderLabels(["Fecha y Hora", "Tipo de Acción", "Detalle de Modificación"])
        self.tabla.setStyleSheet("""
            QTableWidget { background-color: white; color: #2c3e50; border: 1px solid #dcdde1; border-radius: 6px; }
            QHeaderView::section { background-color: #0f2a4a; color: white; font-weight: bold; padding: 6px; }
        """)
        self.tabla.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        self.tabla.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents)
        self.tabla.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        
        layout.addWidget(self.tabla)
        self.cargar_datos(parent.cursor)

    def cargar_datos(self, cursor):
        self.tabla.setRowCount(0)
        cursor.execute("SELECT timestamp, accion, detalle FROM historial ORDER BY timestamp DESC")
        filas = cursor.fetchall()
        for i, (ts, acc, det) in enumerate(filas):
            self.tabla.insertRow(i)
            item_ts = QTableWidgetItem(str(ts))
            item_acc = QTableWidgetItem(str(acc))
            item_det = QTableWidgetItem(str(det))
            for item in [item_ts, item_acc, item_det]:
                item.setForeground(QColor("#2c3e50"))
            self.tabla.setItem(i, 0, item_ts)
            self.tabla.setItem(i, 1, item_acc)
            self.tabla.setItem(i, 2, item_det)


# --- VENTANA GESTIÓN RESPONSABLES ---
class VentanaResponsables(QDialog):
    def __init__(self, parent):
        super().__init__(parent)
        self.parent = parent
        self.setWindowTitle("Administrador de Responsables - IMARPE")
        self.setMinimumSize(750, 450)
        self.setStyleSheet("background-color: #f5f6fa; font-family: 'Segoe UI';")
        
        layout = QVBoxLayout(self)
        lbl = QLabel("Listado de Personal, Roles y Correos Electrónicos:")
        lbl.setFont(QFont("Segoe UI", 11, QFont.Weight.Bold))
        layout.addWidget(lbl)
        
        self.tabla = QTableWidget()
        self.tabla.setColumnCount(3)
        self.tabla.setHorizontalHeaderLabels(["Apellidos y Nombres", "Cargo / Rol", "Correo Electrónico"])
        self.tabla.setStyleSheet("""
            QTableWidget { background-color: white; color: #2c3e50; border: 1px solid #dcdde1; border-radius: 6px; }
            QHeaderView::section { background-color: #0f2a4a; color: white; font-weight: bold; padding: 5px; }
        """)
        self.tabla.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        self.tabla.itemChanged.connect(self.guardar_celda_editada)
        layout.addWidget(self.tabla)
        
        btn_layout = QHBoxLayout()
        self.btn_crear = QPushButton("+ Agregar Nuevo")
        self.btn_eliminar = QPushButton("Eliminar Seleccionado")
        
        for b in [self.btn_crear, self.btn_eliminar]:
            b.setStyleSheet("background-color: #0f2a4a; color: white; padding: 8px 15px; border-radius: 4px; font-weight: bold;")
            btn_layout.addWidget(b)
        layout.addLayout(btn_layout)
        
        self.btn_crear.clicked.connect(self.crear_responsable)
        self.btn_eliminar.clicked.connect(self.eliminar_responsable)
        
        self.bloquear_eventos = False
        self.cargar_tabla()

    def cargar_tabla(self):
        self.bloquear_eventos = True
        self.tabla.setRowCount(0)
        self.parent.cursor.execute("SELECT nombre, cargo, correo FROM responsables ORDER BY nombre")
        filas = self.parent.cursor.fetchall()
        
        for i, (nombre, cargo, correo) in enumerate(filas):
            self.tabla.insertRow(i)
            item_nom = QTableWidgetItem(str(nombre).strip())
            item_car = QTableWidgetItem(str(cargo).strip() if cargo else "")
            item_cor = QTableWidgetItem(str(correo).strip() if correo else "")
            
            item_nom.setData(Qt.ItemDataRole.UserRole, str(nombre).strip())
            item_nom.setForeground(QColor("#2c3e50"))
            item_car.setForeground(QColor("#2c3e50"))
            item_cor.setForeground(QColor("#2c3e50"))
            
            self.tabla.setItem(i, 0, item_nom)
            self.tabla.setItem(i, 1, item_car)
            self.tabla.setItem(i, 2, item_cor)
            
        self.bloquear_eventos = False

    def crear_responsable(self):
        nombre, ok1 = QInputDialog.getText(self, "Nuevo Registro", "Ingrese Apellidos y Nombres:")
        if not ok1 or not nombre.strip(): return
        cargo, ok2 = QInputDialog.getText(self, "Nuevo Registro", "Ingrese Cargo o Rol:")
        if not ok2: return
        correo, ok3 = QInputDialog.getText(self, "Nuevo Registro", "Ingrese Correo Electrónico:")
        if not ok3: return
        
        self.parent.cursor.execute("INSERT INTO responsables (nombre, cargo, correo) VALUES (?, ?, ?)", (nombre.strip(), cargo.strip(), correo.strip()))
        self.parent.registrar_historial("Alta Responsable", f"Se agregó al personal: {nombre.strip()} ({correo.strip()})")
        self.parent.conn.commit()
        
        self.tabla.itemChanged.disconnect(self.guardar_celda_editada)
        self.cargar_tabla()
        self.tabla.itemChanged.connect(self.guardar_celda_editada)
        self.parent.actualizar_responsables_cache()

    def guardar_celda_editada(self, item):
        if self.bloquear_eventos: return
        fila = item.row()
        columna = item.column()
        
        valor_nuevo = item.text().strip()
        if not valor_nuevo and columna != 1 and columna != 2:
            QMessageBox.warning(self, "Atención", "Este campo no puede quedar vacío.")
            self.cargar_tabla()
            return
            
        item_nombre_base = self.tabla.item(fila, 0)
        nombre_original = item_nombre_base.data(Qt.ItemDataRole.UserRole)
        
        try:
            if columna == 0:
                self.parent.cursor.execute("UPDATE responsables SET nombre = ? WHERE nombre = ?", (valor_nuevo, nombre_original))
                self.parent.cursor.execute("UPDATE actividades SET responsable = ? WHERE responsable = ?", (valor_nuevo, nombre_original))
                self.parent.registrar_historial("Modificar Responsable", f"Nombre: {nombre_original} -> {valor_nuevo}")
            elif columna == 1:
                self.parent.cursor.execute("UPDATE responsables SET cargo = ? WHERE nombre = ?", (valor_nuevo, nombre_original))
            elif columna == 2:
                self.parent.cursor.execute("UPDATE responsables SET correo = ? WHERE nombre = ?", (valor_nuevo, nombre_original))
                
            self.parent.conn.commit()
            if columna == 0:
                item_nombre_base.setData(Qt.ItemDataRole.UserRole, valor_nuevo)
            self.parent.actualizar_responsables_cache()
        except sqlite3.Error as e:
            QMessageBox.critical(self, "Error BD", f"No se pudo guardar el cambio: {e}")
            self.cargar_tabla()

    def eliminar_responsable(self):
        fila = self.tabla.currentRow()
        if fila < 0: return
        nombre = self.tabla.item(fila, 0).text()
        
        conf = QMessageBox.question(self, "Remover", f"¿Eliminar a {nombre} de los registros?", QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
        if conf == QMessageBox.StandardButton.Yes:
            self.parent.cursor.execute("DELETE FROM responsables WHERE nombre = ?", (nombre,))
            self.parent.registrar_historial("Baja Responsable", f"Se eliminó de los registros a: {nombre}")
            self.parent.conn.commit()
            self.cargar_tabla()
            self.parent.actualizar_responsables_cache()


# --- MODULE ACCESO Y ROLES ---
class VentanaGestionUsuarios(QDialog):
    def __init__(self, parent):
        super().__init__(parent)
        self.parent = parent
        self.setWindowTitle("Módulo de Administración de Acceso y Roles - IMARPE")
        self.setMinimumSize(680, 400)
        self.setStyleSheet("background-color: #f5f6fa; font-family: 'Segoe UI';")
        
        layout = QVBoxLayout(self)
        lbl = QLabel("Usuarios con credenciales de acceso activas en el sistema:")
        lbl.setFont(QFont("Segoe UI", 11, QFont.Weight.Bold))
        layout.addWidget(lbl)
        
        self.tabla = QTableWidget()
        self.tabla.setColumnCount(3)
        self.tabla.setHorizontalHeaderLabels(["Nombre de Usuario", "Contraseña", "Rol Asignado"])
        self.tabla.setStyleSheet("""
            QTableWidget { background-color: white; color: #2c3e50; border: 1px solid #dcdde1; border-radius: 6px; }
            QHeaderView::section { background-color: #0f2a4a; color: white; font-weight: bold; padding: 5px; }
        """)
        self.tabla.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        self.tabla.itemChanged.connect(self.guardar_cambio_usuario)
        layout.addWidget(self.tabla)
        
        btn_layout = QHBoxLayout()
        self.btn_crear = QPushButton("+ Crear Nuevo Usuario")
        self.btn_eliminar = QPushButton("Dar de Baja Seleccionado")
        
        for b in [self.btn_crear, self.btn_eliminar]:
            b.setStyleSheet("background-color: #0f2a4a; color: white; padding: 8px 15px; border-radius: 4px; font-weight: bold;")
            btn_layout.addWidget(b)
        layout.addLayout(btn_layout)
        
        self.btn_crear.clicked.connect(self.crear_usuario)
        self.btn_eliminar.clicked.connect(self.eliminar_usuario)
        
        self.bloquear_eventos = False
        self.cargar_tabla()

    def cargar_tabla(self):
        self.bloquear_eventos = True
        self.tabla.setRowCount(0)
        self.parent.cursor.execute("SELECT id, username, password, rol FROM usuarios ORDER BY username")
        filas = self.parent.cursor.fetchall()
        
        for i, (uid, user, pwd, rol) in enumerate(filas):
            self.tabla.insertRow(i)
            item_user = QTableWidgetItem(str(user).strip())
            item_pwd = QTableWidgetItem(str(pwd).strip())
            item_rol = QTableWidgetItem(str(rol).strip())
            
            item_user.setData(Qt.ItemDataRole.UserRole, uid)
            item_user.setForeground(QColor("#2c3e50"))
            item_pwd.setForeground(QColor("#2c3e50"))
            item_rol.setForeground(QColor("#2c3e50"))
            
            if user == "admin":
                item_user.setFlags(item_user.flags() & ~Qt.ItemFlag.ItemIsEditable)
                item_rol.setFlags(item_rol.flags() & ~Qt.ItemFlag.ItemIsEditable)
                
            self.tabla.setItem(i, 0, item_user)
            self.tabla.setItem(i, 1, item_pwd)
            self.tabla.setItem(i, 2, item_rol)
            
        self.bloquear_eventos = False

    def crear_usuario(self):
        user, ok1 = QInputDialog.getText(self, "Nuevo Acceso", "Escriba el nombre de usuario único:")
        if not ok1 or not user.strip(): return
        pwd, ok2 = QInputDialog.getText(self, "Nuevo Acceso", "Fije una contraseña de ingreso:")
        if not ok2 or not pwd.strip(): return
        
        roles = ["Administrador", "Coordinador", "Operario"]
        rol, ok3 = QInputDialog.getItem(self, "Asignar Nivel", "Seleccione el Rol Institucional:", roles, 2, False)
        if not ok3: return
        
        try:
            self.parent.cursor.execute("INSERT INTO usuarios (username, password, rol) VALUES (?, ?, ?)", (user.strip(), pwd.strip(), rol))
            self.parent.registrar_historial("Alta de Usuario", f"Se otorgó acceso al sistema a: {user.strip()} con rol {rol}")
            self.parent.conn.commit()
            self.cargar_tabla()
        except sqlite3.IntegrityError:
            QMessageBox.critical(self, "Duplicado", "El nombre de usuario especificado ya existe en la base de datos.")

    def guardar_cambio_usuario(self, item):
        if self.bloquear_eventos: return
        fila = item.row()
        col = item.column()
        valor = item.text().strip()
        uid = self.tabla.item(fila, 0).data(Qt.ItemDataRole.UserRole)
        
        if not valor:
            QMessageBox.warning(self, "Error", "El valor no puede quedar en blanco.")
            self.cargar_tabla()
            return
            
        if col == 2 and valor not in ["Administrador", "Coordinador", "Operario"]:
            QMessageBox.warning(self, "Rol Inválido", "El rol debe ser estrictamente: Administrador, Coordinador u Operario.")
            self.cargar_tabla()
            return
            
        try:
            if col == 0:
                self.parent.cursor.execute("UPDATE usuarios SET username = ? WHERE id = ?", (valor, uid))
            elif col == 1:
                self.parent.cursor.execute("UPDATE usuarios SET password = ? WHERE id = ?", (valor, uid))
            elif col == 2:
                self.parent.cursor.execute("UPDATE usuarios SET rol = ? WHERE id = ?", (valor, uid))
            self.parent.conn.commit()
        except sqlite3.Error as e:
            QMessageBox.critical(self, "Error", f"No se procesó el cambio: {e}")
            self.cargar_tabla()

    def eliminar_usuario(self):
        fila = self.tabla.currentRow()
        if fila < 0: return
        user = self.tabla.item(fila, 0).text().strip()
        uid = self.tabla.item(fila, 0).data(Qt.ItemDataRole.UserRole)
        
        if user == "admin":
            QMessageBox.warning(self, "Restricción", "La cuenta maestra 'admin' no puede darse de baja por seguridad.")
            return
            
        conf = QMessageBox.question(self, "Baja", f"¿Revocar el acceso del usuario '{user}' del sistema?", QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
        if conf == QMessageBox.StandardButton.Yes:
            self.parent.cursor.execute("DELETE FROM usuarios WHERE id = ?", (uid,))
            self.parent.registrar_historial("Baja de Usuario", f"Se removió del sistema las credenciales de: {user}")
            self.parent.conn.commit()
            self.cargar_tabla()


# --- DIÁLOGO DE LOGIN ---
class DialogoLogin(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Acceso al Sistema - IMARPE")
        self.setFixedSize(340, 270)
        self.setStyleSheet("""
            QDialog { background-color: #f5f6fa; font-family: 'Segoe UI'; }
            QLabel { color: #000000; font-weight: bold; font-size: 13px; }
            QLineEdit { background-color: white; color: #000000; border: 1px solid #b2bec3; border-radius: 4px; padding: 6px; font-size: 13px; font-weight: bold; }
            QCheckBox { color: #000000; font-weight: bold; font-size: 12px; }
            QPushButton { background-color: #0f2a4a; color: white; border: none; padding: 10px; border-radius: 4px; font-weight: bold; font-size: 13px; }
            QPushButton:hover { background-color: #1b4f8a; }
        """)
        
        layout = QVBoxLayout(self)
        layout.setContentsMargins(25, 20, 25, 20)
        layout.setSpacing(10)
        
        lbl_info = QLabel("AUTENTICACIÓN INSTITUCIONAL")
        lbl_info.setAlignment(Qt.AlignmentFlag.AlignCenter)
        lbl_info.setStyleSheet("font-size: 14px; color: #0f2a4a; margin-bottom: 5px;")
        layout.addWidget(lbl_info)
        
        layout.addWidget(QLabel("Nombre de Usuario:"))
        self.user_input = QLineEdit()
        layout.addWidget(self.user_input)
        
        layout.addWidget(QLabel("Contraseña del Sistema:"))
        self.pass_input = QLineEdit()
        self.pass_input.setEchoMode(QLineEdit.EchoMode.Password)
        layout.addWidget(self.pass_input)
        
        self.chk_recordar = QCheckBox("Recordar mi cuenta y contraseña")
        layout.addWidget(self.chk_recordar)
        
        btn_login = QPushButton("Ingresar al Sistema")
        btn_login.clicked.connect(self.validar)
        layout.addWidget(btn_login)
        
        self.usuario_logueado = None
        self.rol_logueado = None
        
        self.cargar_usuario_recordado()

    def cargar_usuario_recordado(self):
        parent = self.parent()
        if parent:
            parent.cursor.execute("SELECT valor FROM configuracion WHERE clave = 'usuario_recordado'")
            res_user = parent.cursor.fetchone()
            parent.cursor.execute("SELECT valor FROM configuracion WHERE clave = 'password_recordado'")
            res_pass = parent.cursor.fetchone()
            parent.cursor.execute("SELECT valor FROM configuracion WHERE clave = 'recordar_estado'")
            res_estado = parent.cursor.fetchone()
            
            if res_estado and res_estado[0] == "1" and res_user:
                self.user_input.setText(str(res_user[0]).strip())
                if res_pass:
                    self.pass_input.setText(str(res_pass[0]).strip())
                self.chk_recordar.setChecked(True)

    def validar(self):
        user = self.user_input.text().strip()
        pw = self.pass_input.text().strip()
        
        parent = self.parent()
        parent.cursor.execute("SELECT rol FROM usuarios WHERE username=? AND password=?", (user, pw))
        res = parent.cursor.fetchone()
        
        if res:
            self.usuario_logueado = user
            self.rol_logueado = res[0]
            
            if self.chk_recordar.isChecked():
                parent.cursor.execute("INSERT INTO configuracion (clave, valor) VALUES ('usuario_recordado', ?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor", (user,))
                parent.cursor.execute("INSERT INTO configuracion (clave, valor) VALUES ('password_recordado', ?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor", (pw,))
                parent.cursor.execute("INSERT INTO configuracion (clave, valor) VALUES ('recordar_estado', '1') ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor")
            else:
                parent.cursor.execute("INSERT INTO configuracion (clave, valor) VALUES ('usuario_recordado', '') ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor")
                parent.cursor.execute("INSERT INTO configuracion (clave, valor) VALUES ('password_recordado', '') ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor")
                parent.cursor.execute("INSERT INTO configuracion (clave, valor) VALUES ('recordar_estado', '0') ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor")
            parent.conn.commit()
            
            self.accept()
        else:
            QMessageBox.warning(self, "Error de Autenticación", "Usuario o contraseña incorrectos.\nVerifique sus credenciales.")


# --- APLICACIÓN PRINCIPAL ---
class GanttAppReal(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Sistema de Gestión - IMARPE Gantt v10.1")
        self.setGeometry(50, 70, 1450, 840)
        
        self.setStyleSheet("""
            QMainWindow { background-color: #f5f6fa; }
            QLabel { color: #2c3e50; font-family: 'Segoe UI'; }
            QDialog, QInputDialog, QMessageBox { background-color: #f5f6fa; }
            QLineEdit { background-color: #ffffff; color: #2c3e50; border: 1px solid #b2bec3; border-radius: 4px; padding: 6px; font-size: 13px; }
            QPushButton { background-color: #0f2a4a; color: #ffffff; border: none; padding: 10px 18px; border-radius: 6px; font-family: 'Segoe UI'; font-size: 13px; font-weight: bold; }
            QPushButton:hover { background-color: #1b4f8a; }
            QPushButton:disabled { background-color: #bdc3c7; color: #7f8c8d; border: none; }
        """)
        
        self.usuario_actual = "Invitado"
        self.rol_actual = "Operario"
        self.cerrar_sesion_solicitado = False
        
        self.conectar_base_datos()
        
        main_widget = QWidget()
        self.CentralWidget = main_widget
        self.setCentralWidget(main_widget)
        main_layout = QVBoxLayout(main_widget)
        main_layout.setContentsMargins(0, 0, 0, 20)
        main_layout.setSpacing(15)
        
        # --- CINTA SUPERIOR REORGANIZADA ---
        self.cinta_azul = QFrame()
        self.cinta_azul.setFixedHeight(75)
        self.cinta_azul.setStyleSheet("background-color: #0f2a4a; border: none;")
        cinta_layout = QHBoxLayout(self.cinta_azul)
        cinta_layout.setContentsMargins(30, 0, 30, 0)
        
        self.lbl_logo = QLabel()
        ruta_logo = "IMARPE IMAGOTIPO.png"
        if os.path.exists(ruta_logo):
            pixmap = QPixmap(ruta_logo)
            self.lbl_logo.setPixmap(pixmap.scaled(260, 55, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
        else:
            self.lbl_logo.setText("IMARPE")
            self.lbl_logo.setStyleSheet("color: white; font-size: 24px; font-weight: bold; font-family: 'Calibri'; letter-spacing: 2px;")
            
        cinta_layout.addWidget(self.lbl_logo)
        cinta_layout.addStretch()
        
        # ESPACIO DE PERFIL DE USUARIO
        self.contenedor_perfil = QWidget()
        self.contenedor_perfil.setCursor(Qt.CursorShape.PointingHandCursor)
        self.contenedor_perfil.mousePressEvent = self.desplegar_menu_perfil
        
        layout_perfil = QHBoxLayout(self.contenedor_perfil)
        layout_perfil.setContentsMargins(0, 0, 0, 0)
        self.label_usuario = QLabel("Invitado (Operario)")
        self.label_usuario.setStyleSheet("color: white; font-weight: bold; font-family: 'Segoe UI'; font-size: 15px;")
        
        self.avatar_temp = QLabel()
        self.avatar_temp.setFixedSize(35, 35)
        self.avatar_temp.setStyleSheet("background-color: #7f8c8d; border-radius: 17px; border: 2px solid white;")
        self.avatar_temp.setAlignment(Qt.AlignmentFlag.AlignCenter)
        
        layout_perfil.addWidget(self.label_usuario)
        layout_perfil.addWidget(self.avatar_temp)
        cinta_layout.addWidget(self.contenedor_perfil)
        
        main_layout.addWidget(self.cinta_azul)

        cuerpo_layout = QVBoxLayout()
        cuerpo_layout.setContentsMargins(20, 0, 20, 0)
        cuerpo_layout.setSpacing(15)
        
        # --- TÍTULO REUBICADO ---
        titulo_layout = QHBoxLayout()
        titulo_layout.setContentsMargins(0, 0, 0, 0)
        
        self.txt_nombre_proyecto = QLineEdit()
        self.txt_nombre_proyecto.setFixedWidth(600)
        self.txt_nombre_proyecto.setPlaceholderText("Nombre del Proyecto...")
        self.txt_nombre_proyecto.setStyleSheet("""
            QLineEdit {
                background-color: transparent; 
                border: none; 
                border-radius: 4px;
                font-weight: bold; 
                font-size: 20px; 
                color: #2c3e50; 
                padding: 4px 8px;
                font-family: 'Segoe UI';
            }
            QLineEdit:hover {
                background-color: #d6e4f0;
                border: none;
            }
            QLineEdit:focus {
                background-color: #ffffff; 
                border: 1px solid #0f2a4a;
            }
        """)
        self.txt_nombre_proyecto.textChanged.connect(self.guardar_nombre_proyecto)
        
        titulo_layout.addWidget(self.txt_nombre_proyecto)
        titulo_layout.addStretch()
        cuerpo_layout.addLayout(titulo_layout)
        
        kpi_layout = QHBoxLayout()
        self.lbl_avance = self.crear_tarjeta_kpi(kpi_layout, "AVANCE GLOBAL", "0%", "#1abc9c", "#ffffff")
        self.lbl_ejecutado = self.crear_tarjeta_kpi(kpi_layout, "EJECUTADO", "0", "#2ecc71", "#ffffff")
        self.lbl_proceso = self.crear_tarjeta_kpi(kpi_layout, "EN PROCESO", "0", "#f1c40f", "#2c3e50")
        self.lbl_pendiente = self.crear_tarjeta_kpi(kpi_layout, "PENDIENTE", "0", "#e74c3c", "#ffffff")
        cuerpo_layout.addLayout(kpi_layout)
        
        control_layout = QHBoxLayout()
        self.btn_recuperar_cols = QPushButton("👁️ Mostrar Columnas Ocultas")
        self.btn_recuperar_cols.setStyleSheet("background-color: #27ae60; color: white; padding: 7px 15px;")
        self.btn_recuperar_cols.clicked.connect(self.mostrar_menu_recuperar_columnas)
        
        btn_historial = QPushButton("📜 Ver Historial de Cambios")
        btn_historial.setStyleSheet("background-color: #718093; color: white; padding: 7px 15px;")
        btn_historial.clicked.connect(self.abrir_historial_cambios)
        
        self.btn_gestionar_resp = QPushButton("⚙️ Gestionar Responsables")
        self.btn_gestionar_resp.setStyleSheet("background-color: #2980b9; color: white; padding: 7px 15px;")
        self.btn_gestionar_resp.clicked.connect(self.abrir_gestion_responsables)
        
        self.btn_gestionar_usuarios = QPushButton("👤 Gestionar Usuarios")
        self.btn_gestionar_usuarios.setStyleSheet("background-color: #6c5ce7; color: white; padding: 7px 15px;")
        self.btn_gestionar_usuarios.clicked.connect(self.abrir_gestion_usuarios)
        
        control_layout.addStretch()
        control_layout.addWidget(self.btn_recuperar_cols)
        control_layout.addWidget(btn_historial)
        control_layout.addWidget(self.btn_gestionar_resp)
        control_layout.addWidget(self.btn_gestionar_usuarios)
        cuerpo_layout.addLayout(control_layout)
        
        # --- TABLA ÁRBOL CONFIGURADA ---
        self.tree = QTreeWidget()
        self.tree.setColumnCount(9)
        
        self.nombres_columnas = ["Código", "Descripción de Actividad", "Responsable asignado", "Estado", "   Inicio", "      Fin", "  Días", "  % Avance", "Linea de Tiempo (Gantt)"]
        self.tree.setHeaderLabels(self.nombres_columnas)
        
        self.tree.setStyleSheet("""
            QTreeWidget { 
                background-color: white; 
                border: 1px solid #dcdde1; 
                border-radius: 8px; 
                font-family: 'Segoe UI'; 
                color: #2c3e50;
                outline: none;  
            }
            QHeaderView::section { 
                background-color: #0f2a4a; 
                color: white; 
                padding: 8px 2px; 
                font-weight: bold; 
                border: none; 
            }
            QTreeWidget::item { 
                padding-right: 18px; 
                padding-top: 5px; 
                padding-bottom: 5px; 
                border-bottom: 1px solid #f1f2f6; 
            }
            QTreeWidget::item:selected:focus { 
                background-color: #d6e4f0; 
                color: #2c3e50;
                border: 1px solid #a4bcd4; 
                border-radius: 4px;
            }
            QTreeWidget::item:selected:!focus { 
                background-color: #d6e4f0; 
                color: #2c3e50;
            }
        """)
        
        self.tree.setIndentation(15)
        self.tree.header().setStretchLastSection(True)
        self.tree.header().setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.tree.header().customContextMenuRequested.connect(self.abrir_menu_ocultar_columna)
        
        self.tree.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.tree.customContextMenuRequested.connect(self.abrir_menu_contextual_item)
        
        self.tree.header().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        self.tree.header().setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents)
        
        self.tree.setColumnWidth(2, 190)
        self.tree.setColumnWidth(3, 100)
        self.tree.setColumnWidth(4, 115) 
        self.tree.setColumnWidth(5, 115) 
        self.tree.setColumnWidth(6, 65)  
        self.tree.setColumnWidth(7, 95)  
        self.tree.setColumnWidth(8, 400)
        
        self.tree.setExpandsOnDoubleClick(False)
        self.tree.itemDoubleClicked.connect(self.editar_columna_especifica)
        
        self.tree.header().setDefaultAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        
        self.gantt_delegate = GanttEscalonadoDelegate(self)
        self.tree.setItemDelegate(self.gantt_delegate)
        cuerpo_layout.addWidget(self.tree)
        
        # --- PANEL DE ACCIONES INFERIORES ---
        botones_layout = QHBoxLayout()
        botones_layout.setContentsMargins(5, 5, 5, 5)
        botones_layout.setSpacing(10)
        
        self.btn_act = QPushButton("+ Agregar Actividad (Nivel 1)")
        self.btn_act.setFixedWidth(280)
        self.btn_act.setFixedHeight(43)
        self.btn_act.setStyleSheet("""
            QPushButton { background-color: #0f2a4a; color: white; border-radius: 6px; font-weight: bold; } 
            QPushButton:hover { background-color: #1b4f8a; }
            QPushButton:disabled { background-color: #bdc3c7; color: #7f8c8d; }
        """)
        self.btn_act.clicked.connect(lambda: self.intentar_agregar_actividad(1))
        botones_layout.addWidget(self.btn_act)
        
        self.btn_vista_jerarquica = QPushButton("👁️ Ver hasta...")
        self.btn_vista_jerarquica.setToolTip("Ajustar el nivel de detalle jerárquico visible en el árbol")
        self.btn_vista_jerarquica.setFixedWidth(160)
        self.btn_vista_jerarquica.setFixedHeight(43)
        self.btn_vista_jerarquica.setStyleSheet("""
            QPushButton { background-color: #2c3e50; color: white; border-radius: 6px; font-weight: bold; } 
            QPushButton:hover { background-color: #34495e; }
        """)
        self.btn_vista_jerarquica.clicked.connect(self.mostrar_menu_filtros_jerarquicos)
        botones_layout.addWidget(self.btn_vista_jerarquica)
        
        self.btn_eliminar_global = QPushButton("🗑️ Eliminar elemento")
        self.btn_eliminar_global.setToolTip("Eliminar elemento seleccionado de la tabla y sus dependencias")
        self.btn_eliminar_global.setFixedWidth(170)
        self.btn_eliminar_global.setFixedHeight(43)
        self.btn_eliminar_global.setStyleSheet("""
            QPushButton { 
                background-color: #c0392b; 
                color: #ffffff; 
                font-weight: bold;
                font-size: 13px; 
                border-radius: 6px; 
                border: none;
            } 
            QPushButton:hover { background-color: #a93226; }
            QPushButton:disabled { background-color: #bdc3c7; color: #7f8c8d; }
        """)
        self.btn_eliminar_global.clicked.connect(self.intentar_eliminar_elemento)
        botones_layout.addWidget(self.btn_eliminar_global)
        
        botones_layout.addStretch()
            
        cuerpo_layout.addLayout(botones_layout)
        main_layout.addLayout(cuerpo_layout)
        
        self.cargar_nombre_proyecto()
        self.cargar_datos_desde_db()
        
        self.tree.setFocus()

    # --- MÉTODOS DE LA CLASE PRINCIPAL ---
    def conectar_base_datos(self):
        self.conn = sqlite3.connect("imarpe_gantt.db")
        self.cursor = self.conn.cursor()
        
        self.cursor.execute("""
            CREATE TABLE IF NOT EXISTS actividades (
                codigo TEXT PRIMARY KEY, descripcion TEXT, responsable TEXT, estado TEXT,
                avance INTEGER DEFAULT 0, fecha_inicio TEXT, fecha_fin TEXT, dias INTEGER DEFAULT 1
            )
        """)
        
        self.cursor.execute("CREATE TABLE IF NOT EXISTS responsables (nombre TEXT PRIMARY KEY, cargo TEXT, correo TEXT)")
        
        self.cursor.execute("""
            CREATE TABLE IF NOT EXISTS usuarios (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE,
                password TEXT,
                rol TEXT,
                avatar_path TEXT
            )
        """)
        self.cursor.execute("INSERT OR IGNORE INTO usuarios (username, password, rol) VALUES ('admin', 'admin123', 'Administrador')")
        self.cursor.execute("INSERT OR IGNORE INTO usuarios (username, password, rol) VALUES ('coordinador', 'coord123', 'Coordinador')")
        self.cursor.execute("INSERT OR IGNORE INTO usuarios (username, password, rol) VALUES ('operario', 'oper123', 'Operario')")

        try:
            self.cursor.execute("ALTER TABLE responsables ADD COLUMN correo TEXT")
        except sqlite3.OperationalError:
            pass
            
        self.cursor.execute("CREATE TABLE IF NOT EXISTS configuracion (clave TEXT PRIMARY KEY, valor TEXT)")
        self.cursor.execute("""
            CREATE TABLE IF NOT EXISTS historial (
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, accion TEXT, detalle TEXT
            )
        """)
        self.conn.commit()
        self.actualizar_responsables_cache()

    def actualizar_responsables_cache(self):
        self.cursor.execute("SELECT nombre FROM responsables ORDER BY nombre")
        self.responsables_reales = [str(r[0]).strip() for r in self.cursor.fetchall()]

    def tiene_permiso(self, nivel_requerido):
        roles_jerarquia = {'Administrador': 3, 'Coordinador': 2, 'Operario': 1}
        rol_usuario = getattr(self, 'rol_actual', 'Operario')
        return roles_jerarquia.get(rol_usuario, 0) >= roles_jerarquia.get(nivel_requerido, 0)

    def desplegar_menu_perfil(self, event):
        menu = QMenu(self)
        menu.setStyleSheet("""
            QMenu { background-color: white; border: 1px solid #dcdde1; }
            QMenu::item { padding: 8px 25px 8px 20px; font-family: 'Segoe UI'; font-weight: bold; color: #2c3e50; }
            QMenu::item:selected { background-color: #d6e4f0; color: #2c3e50; }
        """)
        
        acc_datos = menu.addAction("👤 Mis Datos")
        acc_foto = menu.addAction("🖼️ Cambiar Foto (Avatar)")
        menu.addSeparator()
        acc_logout = menu.addAction("🚪 Cerrar Sesión")
        
        seleccion = menu.exec(self.contenedor_perfil.mapToGlobal(QPoint(0, self.contenedor_perfil.height())))
        
        if seleccion == acc_datos:
            self.cursor.execute("SELECT password, rol FROM usuarios WHERE username = ?", (self.usuario_actual,))
            res = self.cursor.fetchone()
            pwd = res[0] if res else "---"
            QMessageBox.information(self, "Mis Datos Institucionales", 
                                    f"• Nombre de Usuario: {self.usuario_actual}\n• Credencial Clave: {pwd}\n• Rol Asignado: {self.rol_actual}")
        elif seleccion == acc_foto:
            ruta, _ = QFileDialog.getOpenFileName(self, "Seleccionar Foto de Perfil", "", "Imágenes (*.png *.jpg *.jpeg)")
            if ruta:
                self.cursor.execute("UPDATE usuarios SET avatar_path = ? WHERE username = ?", (ruta, self.usuario_actual))
                self.conn.commit()
                self.actualizar_avatar_visual(ruta)
                QMessageBox.information(self, "Éxito", "Foto de perfil actualizada correctamente.")
        elif seleccion == acc_logout:
            conf = QMessageBox.question(self, "Cerrar Sesión", "¿Está seguro de querer salir de la sesión actual?", 
                                        QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
            if conf == QMessageBox.StandardButton.Yes:
                self.cerrar_sesion_solicitado = True
                self.close()

    def actualizar_avatar_visual(self, ruta_imagen):
        if ruta_imagen and os.path.exists(ruta_imagen):
            pixmap = QPixmap(ruta_imagen)
            if not pixmap.isNull():
                self.avatar_temp.setPixmap(pixmap.scaled(35, 35, Qt.AspectRatioMode.KeepAspectRatioByExpanding, Qt.TransformationMode.SmoothTransformation))
                self.avatar_temp.setStyleSheet("border-radius: 17px; border: 2px solid white;")
                return
        
        if self.rol_actual == "Administrador":
            self.avatar_temp.setStyleSheet("background-color: #6c5ce7; border-radius: 17px; border: 2px solid white;")
        elif self.rol_actual == "Coordinador":
            self.avatar_temp.setStyleSheet("background-color: #2980b9; border-radius: 17px; border: 2px solid white;")
        else:
            self.avatar_temp.setStyleSheet("background-color: #7f8c8d; border-radius: 17px; border: 2px solid white;")
        self.avatar_temp.setPixmap(QPixmap())

    def agenda_input_dialog_custom(self, titulo, mensaje, opciones=None, predeterminado=""):
        dialog = QInputDialog(self)
        if titulo == "Porcentaje Requerido":
            dialog.setWindowTitle("Indique el % de avance")
        else:
            dialog.setWindowTitle(titulo)
            
        dialog.setLabelText(mensaje)
        dialog.setFont(QFont("Segoe UI", 10))
        
        # Corrección CSS Avanzada: Se quita el fondo, el borde y el outline del elemento ':selected'
        # para que no deje rastros visuales, forzando la pintura limpia solo en ':hover'.
        dialog.setStyleSheet("""
            QInputDialog { background-color: #f5f6fa; }
            QLabel { color: #2c3e50; font-weight: bold; }
            QComboBox { 
                background-color: white; 
                color: #2c3e50; 
                border: 1px solid #b2bec3; 
                border-radius: 4px; 
                padding: 5px 5px 5px 12px; 
                min-width: 260px;
            }
            QComboBox QAbstractItemView { 
                background-color: white; 
                color: #2c3e50; 
                border: 1px solid #b2bec3;
                outline: none;
            }
            QComboBox QAbstractItemView::item {
                padding-left: 12px;
                min-height: 28px;
                background-color: white;
                color: #2c3e50;
                border: none;
            }
            QComboBox QAbstractItemView::item:selected {
                background-color: transparent !important;
                color: #2c3e50 !important;
                border: none !important;
                outline: none !important;
            }
            QComboBox QAbstractItemView::item:hover, QComboBox QAbstractItemView::item:selected:hover {
                background-color: #d6e4f0 !important;
                color: #2c3e50 !important;
                border: none !important;
            }
            QLineEdit { background-color: white; color: #2c3e50; border: 1px solid #b2bec3; border-radius: 4px; padding: 5px 10px; }
            QPushButton { background-color: #0f2a4a; color: white; min-width: 80px; padding: 6px; }
        """)

        if opciones:
            dialog.setComboBoxItems(opciones)
            dialog.setComboBoxEditable(False)
            if predeterminado in opciones: 
                dialog.setTextValue(str(predeterminado).strip())
        else:
            dialog.setInputMode(QInputDialog.InputMode.TextInput)
            dialog.setTextValue(str(predeterminado).strip())
            
        ok = dialog.exec()
        return dialog.textValue().strip(), ok

    def intentar_eliminar_elemento(self):
        if self.tiene_permiso('Administrador'):
            self.ejecutar_eliminacion_por_boton_papelera()
        else:
            QMessageBox.critical(self, "Acceso Denegado", "No tienes permisos de Administrador para eliminar registros del sistema.")

    def intentar_agregar_actividad(self, nivel):
        if self.tiene_permiso('Coordinador'):
            self.agregar_item_interactivo(nivel)
        else:
            QMessageBox.critical(self, "Acceso Denegado", "Tu rol de Operario solo permite la visualización de datos.")

    def mostrar_menu_filtros_jerarquicos(self):
        menu = QMenu(self)
        menu.setStyleSheet("""
            QMenu { background-color: white; border: 1px solid #dcdde1; }
            QMenu::item { padding: 8px 25px 8px 20px; font-family: 'Segoe UI'; font-weight: bold; color: #2c3e50; }
            QMenu::item:selected { background-color: #d6e4f0; color: #2c3e50; }
        """)
        act1 = menu.addAction("Nivel 1: Solo Actividades")
        act2 = menu.addAction("Nivel 2: Hasta Tareas")
        act3 = menu.addAction("Nivel 3: Hasta Subtareas")
        act4 = menu.addAction("Nivel 4: Mostrar Todo (Pasos)")
        
        pos_global = self.btn_vista_jerarquica.mapToGlobal(QPoint(0, -menu.sizeHint().height()))
        seleccion = menu.exec(pos_global)
        if not seleccion: return
        
        nivel_limite = 4
        if seleccion == act1: nivel_limite = 1
        elif seleccion == act2: nivel_limite = 2
        elif seleccion == act3: nivel_limite = 3
        
        self.ajustar_colapso_recursivo(self.tree.invisibleRootItem(), nivel_limite)

    def ajustar_colapso_recursivo(self, item_padre, nivel_limite):
        for i in range(item_padre.childCount()):
            child = item_padre.child(i)
            codigo = child.text(0).strip()
            if codigo.endswith("."): codigo = codigo[:-1]
            nivel_actual = len(codigo.split("."))
            if nivel_actual < nivel_limite:
                child.setExpanded(True)
                self.ajustar_colapso_recursivo(child, nivel_limite)
            else:
                child.setExpanded(False)

    def registrar_historial(self, accion, detalle):
        self.cursor.execute("INSERT INTO historial (accion, detalle) VALUES (?, ?)", (accion, detalle))
        self.conn.commit()

    def abrir_historial_cambios(self):
        v = VentanaHistorial(self)
        v.exec()

    def abrir_menu_contextual_item(self, pos):
        if not self.tiene_permiso('Coordinador'): return
        item = self.tree.itemAt(pos)
        if not item: return
        codigo = item.text(0).strip()
        if codigo.endswith("."): codigo = codigo[:-1]
        partes = codigo.split(".")
        nivel_actual = len(partes)
        
        menu = QMenu(self)
        menu.setStyleSheet("background-color: white; color: #2c3e50; font-family: 'Segoe UI'; font-weight: bold;")
        if nivel_actual == 1:
            accion_crear = menu.addAction("+ Agregar Tarea (Nivel 2)")
            nivel_objetivo = 2
        elif nivel_actual == 2:
            accion_crear = menu.addAction("+ Agregar Subtarea (Nivel 3)")
            nivel_objetivo = 3
        elif nivel_actual == 3:
            accion_crear = menu.addAction("+ Agregar Paso (Nivel 4)")
            nivel_objetivo = 4
        else:
            accion_crear = menu.addAction("Nivel estructural máximo alcanzado")
            accion_crear.setEnabled(False)
            nivel_objetivo = None
            
        accion = menu.exec(self.tree.viewport().mapToGlobal(pos))
        if nivel_objetivo and accion == accion_crear:
            self.tree.setCurrentItem(item)
            self.intentar_agregar_actividad(nivel_objetivo)

    def ejecutar_eliminacion_por_boton_papelera(self):
        item = self.tree.currentItem()
        if not item:
            QMessageBox.warning(self, "Atención", "Por favor, seleccione una fila de la tabla para eliminarla.")
            return
        codigo = item.text(0).strip()
        desc = item.text(1).strip()
        conf = QMessageBox.question(self, "Eliminar Ítem", f"¿Eliminar el código {codigo} y sus dependencias?\n\n({desc})", QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
        if conf == QMessageBox.StandardButton.Yes:
            self.cursor.execute("DELETE FROM actividades WHERE codigo = ? OR codigo LIKE ?", (codigo, f"{codigo}.%"))
            self.registrar_historial("Eliminación", f"Se eliminó la actividad {codigo} junto con sus desgloses.")
            self.conn.commit()
            self.cargar_datos_desde_db()

    def abrir_menu_ocultar_columna(self, pos):
        columna = self.tree.header().logicalIndexAt(pos)
        if columna in [0, 1]: return
        menu = QMenu(self)
        menu.setStyleSheet("background-color: white; color: #2c3e50; font-family: 'Segoe UI';")
        accion_ocultar = menu.addAction(f"❌ Ocultar columna: {self.nombres_columnas[columna].strip()}")
        accion = menu.exec(self.tree.header().mapToGlobal(pos))
        if accion == accion_ocultar:
            self.tree.setColumnHidden(columna, True)

    def mostrar_menu_recuperar_columnas(self):
        menu = QMenu(self)
        menu.setStyleSheet("background-color: white; color: #2c3e50; font-family: 'Segoe UI';")
        columnas_ocultas = False
        for i in range(self.tree.columnCount()):
            if self.tree.isColumnHidden(i):
                columnas_ocultas = True
                accion = menu.addAction(f"👁️ Restaurar: {self.nombres_columnas[i].strip()}")
                accion.setData(i)
        if not columnas_ocultas:
            menu.addAction("Todas las columnas están visibles").setEnabled(False)
        pos_global = self.btn_recuperar_cols.mapToGlobal(QPoint(0, self.btn_recuperar_cols.height()))
        accion_seleccionada = menu.exec(pos_global)
        if accion_seleccionada and accion_seleccionada.data() is not None:
            self.tree.setColumnHidden(accion_seleccionada.data(), False)

    def crear_tarjeta_kpi(self, layout, titulo, valor_init, color_fondo, color_texto):
        frame = QFrame()
        frame.setStyleSheet(f"QFrame {{ background-color: {color_fondo}; border-radius: 8px; }}")
        vbox = QVBoxLayout(frame)
        lbl_tit = QLabel(titulo)
        lbl_tit.setFont(QFont("Segoe UI", 9, QFont.Weight.Bold))
        lbl_tit.setStyleSheet(f"color: {color_texto};")
        lbl_val = QLabel(valor_init)
        lbl_val.setFont(QFont("Segoe UI", 18, QFont.Weight.Bold))
        lbl_val.setStyleSheet(f"color: {color_texto};")
        vbox.addWidget(lbl_tit)
        vbox.addWidget(lbl_val)
        layout.addWidget(frame)
        return lbl_val

    def cargar_nombre_proyecto(self):
        self.cursor.execute("SELECT valor FROM configuracion WHERE clave = 'nombre_proyecto'")
        res = self.cursor.fetchone()
        nombre = res[0] if res else "Proyecto de Gestión Interna - IMARPE"
        self.txt_nombre_proyecto.textChanged.disconnect(self.guardar_nombre_proyecto)
        self.txt_nombre_proyecto.setText(str(nombre).strip())
        self.txt_nombre_proyecto.textChanged.connect(self.guardar_nombre_proyecto)

    def guardar_nombre_proyecto(self, texto):
        if self.tiene_permiso('Coordinador'):
            self.cursor.execute("INSERT INTO configuracion (clave, valor) VALUES ('nombre_proyecto', ?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor", (texto.strip(),))
            self.conn.commit()
        else:
            self.txt_nombre_proyecto.textChanged.disconnect(self.guardar_nombre_proyecto)
            self.cargar_nombre_proyecto()
            QMessageBox.critical(self, "Acceso Denegado", "No tienes permisos para modificar el nombre del proyecto.")

    def abrir_gestion_responsables(self):
        if self.tiene_permiso('Administrador'):
            dialog = VentanaResponsables(self)
            dialog.exec()
            self.cargar_datos_desde_db()
        else:
            QMessageBox.critical(self, "Acceso Denegado", "Solo un Administrador puede gestionar el personal responsable.")

    def abrir_gestion_usuarios(self):
        if self.tiene_permiso('Administrador'):
            dialog = VentanaGestionUsuarios(self)
            dialog.exec()
        else:
            QMessageBox.critical(self, "Acceso Denegado", "Solo un Administrador posee acceso a las credenciales de usuarios.")

    def recalcular_tiempos_y_porcentajes_cascada(self):
        self.cursor.execute("SELECT codigo FROM actividades ORDER BY length(codigo) DESC")
        todos_codigos = [str(f[0]).strip() for f in self.cursor.fetchall()]
        
        for cod in todos_codigos:
            self.cursor.execute(f"SELECT avance, fecha_inicio, fecha_fin FROM actividades WHERE codigo LIKE '{cod}.%' AND length(codigo) <= {len(cod) + 3}")
            hijos = self.cursor.fetchall()
            if not hijos and cod.endswith('.'):
                self.cursor.execute(f"SELECT avance, fecha_inicio, fecha_fin FROM actividades WHERE codigo LIKE '{cod}%' AND codigo != '{cod}'")
                hijos = self.cursor.fetchall()
            
            if hijos:
                suma_avances = sum([h[0] for h in hijos])
                promedio = int(suma_avances / len(hijos))
                
                fechas_inicio = []
                fechas_fin = []
                for h in hijos:
                    f_ini_obj = parsear_fecha_segura(h[1])
                    f_fin_obj = parsear_fecha_segura(h[2])
                    if f_ini_obj: fechas_inicio.append(f_ini_obj)
                    if f_fin_obj: fechas_fin.append(f_fin_obj)
                
                anio_dinamico = datetime.now().year
                f_ini_calc = min(fechas_inicio).strftime("%d/%m/%Y") if fechas_inicio else f"01/01/{anio_dinamico}"
                f_fin_calc = max(fechas_fin).strftime("%d/%m/%Y") if fechas_fin else f"05/01/{anio_dinamico}"
                dias_calc = (max(fechas_fin) - min(fechas_inicio)).days + 1 if fechas_inicio and fechas_fin else 5
                
                nuevo_estado = "Pendiente"
                if promedio == 100: nuevo_estado = "Ejecutado"
                elif promedio > 0: nuevo_estado = "En proceso"
                
                self.cursor.execute("""
                    UPDATE actividades SET avance = ?, estado = ?, fecha_inicio = ?, fecha_fin = ?, dias = ? WHERE codigo = ?
                """, (promedio, nuevo_estado, f_ini_calc, f_fin_calc, dias_calc, cod))
        self.conn.commit()

    def cargar_datos_desde_db(self):
        self.recalcular_tiempos_y_porcentajes_cascada()
        self.tree.clear()
        
        for col in range(9):
            self.tree.headerItem().setTextAlignment(col, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)

        self.cursor.execute("SELECT codigo, descripcion, responsable, estado, avance, fecha_inicio, fecha_fin, dias FROM actividades ORDER BY codigo")
        filas = self.cursor.fetchall()
        
        items_registrados = {}
        cant_ejecutado = 0; cant_proceso = 0; cant_pendiente = 0
        color_texto_oscuro = QColor("#2c3e50")
        
        font_actividad_bold = QFont("Segoe UI", 10, QFont.Weight.Bold)
        font_paso_italic = QFont("Segoe UI", 9)
        font_paso_italic.setItalic(True)
        font_estandar = QFont("Segoe UI", 9)
        
        meses_es = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
        
        for codigo_db, desc, resp, estado, avance, f_ini, f_fin, dias in filas:
            codigo_limpio = str(codigo_db).strip().replace("\n", "").replace("\r", "")
            desc_limpia = str(desc).strip()
            resp_limpia = str(resp).strip() if resp else "No asignado"
            estado_limpio = str(estado).strip()
            
            if estado_limpio == "Ejecutado": cant_ejecutado += 1
            elif estado_limpio == "En proceso": cant_proceso += 1
            else: cant_pendiente += 1
            
            codigo_analisis = codigo_limpio[:-1] if codigo_limpio.endswith(".") and len(codigo_limpio) > 1 else codigo_limpio
            partes = codigo_analisis.split(".")
            nivel = len(partes)
            if len(partes) == 1: nivel = 1
            
            avance_str = f"{avance}%"
            fecha_inicio_peruana = normalizar_a_formato_peruano(f_ini)
            fecha_fin_peruana = normalizar_a_formato_peruano(f_fin)
            
            item = QTreeWidgetItem()
            item.setText(0, codigo_limpio)
            item.setText(1, desc_limpia)
            item.setText(2, resp_limpia)
            item.setText(3, estado_limpio)
            item.setText(4, fecha_inicio_peruana)
            item.setText(5, fecha_fin_peruana)
            item.setText(6, str(dias))
            item.setText(7, avance_str)
            item.setText(8, "")
            
            if not self.tiene_permiso('Coordinador'):
                item.setFlags(item.flags() & ~Qt.ItemFlag.ItemIsEditable)
            
            dt_ini = parsear_fecha_segura(fecha_inicio_peruana)
            dt_fin = parsear_fecha_segura(fecha_fin_peruana)
            if dt_ini and dt_fin:
                num_semana_ini = dt_ini.isocalendar()[1]
                num_semana_fin = dt_fin.isocalendar()[1]
                mes_nombre_ini = meses_es[dt_ini.month - 1]
                mes_nombre_fin = meses_es[dt_fin.month - 1]
                
                texto_tiempo = f"📅 Cronograma de Ejecución Anual ({dt_ini.year}):\n" \
                               f"• Inicio: {fecha_inicio_peruana} ({mes_nombre_ini} -> Semana {num_semana_ini})\n" \
                               f"• Término: {fecha_fin_peruana} ({mes_nombre_fin} -> Semana {num_semana_fin})"
                item.setToolTip(8, texto_tiempo)
            
            item.setTextAlignment(0, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
            item.setTextAlignment(1, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
            item.setTextAlignment(2, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
            item.setTextAlignment(3, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
            item.setTextAlignment(4, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter) 
            item.setTextAlignment(5, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter) 
            item.setTextAlignment(6, Qt.AlignmentFlag.AlignCenter) 
            item.setTextAlignment(7, Qt.AlignmentFlag.AlignCenter)
            
            for c in [0, 1, 2, 3]:
                txt = self.tree.headerItem().text(c)
                if not txt.startswith(" "): self.tree.headerItem().setText(c, " " + txt)

            if nivel == 1:
                for col in range(9):
                    item.setFont(col, font_actividad_bold)
                    item.setBackground(col, QColor("#e8f4f8"))
                    item.setForeground(col, color_texto_oscuro)
                self.tree.addTopLevelItem(item)
                items_registrados[codigo_analisis] = item
            else:
                padre_codigo = ".".join(partes[:-1])
                padre_item = items_registrados.get(padre_codigo)
                if padre_item:
                    padre_item.addChild(item)
                    if nivel == 4:
                        for col in range(9): item.setFont(col, font_paso_italic)
                    elif nivel == 2: 
                        for col in range(9): item.setFont(col, font_estandar)
                        item.setFont(1, QFont("Segoe UI", 9, QFont.Weight.Medium))
                    else:
                        for col in range(9): item.setFont(col, font_estandar)
                        
                    for col in range(9): item.setForeground(col, color_texto_oscuro)
                    items_registrados[codigo_analisis] = item
                else:
                    for col in range(9):
                        item.setFont(col, font_estandar)
                        item.setForeground(col, color_texto_oscuro)
                    self.tree.addTopLevelItem(item)
                    items_registrados[codigo_analisis] = item
                    
        self.tree.expandAll()
        self.lbl_ejecutado.setText(f"{cant_ejecutado} Items")
        self.lbl_proceso.setText(f"{cant_proceso} Items")
        self.lbl_pendiente.setText(f"{cant_pendiente} Items")
        
        self.cursor.execute("SELECT avance FROM actividades WHERE codigo NOT LIKE '%.%'")
        raices = self.cursor.fetchall()
        if raices:
            global_pct = int(sum([r[0] for r in raices]) / len(raices))
            self.lbl_avance.setText(f"{global_pct}%")

    def agregar_item_interactivo(self, nivel_deseado):
        item_seleccionado = self.tree.currentItem()
        codigo_base = item_seleccionado.text(0).strip() if item_seleccionado else ""
        if codigo_base.endswith("."): codigo_base = codigo_base[:-1]

        desc, ok1 = self.agenda_input_dialog_custom("Nueva Entrada", "Ingrese la descripción:")
        if not ok1 or not desc.strip(): return
        
        resp, ok2 = self.agenda_input_dialog_custom("Asignar Responsable", "Responsable:", self.responsables_reales)
        if not ok2: return
        
        estado, ok3 = self.agenda_input_dialog_custom("Establecer Estado", "Estado:", ["Pendiente", "En proceso", "Ejecutado"])
        if not ok3: return
        
        anio_dinamico = datetime.now().year
        dialogo_ini = DialogoCalendarioCustom("Planificación Inicial", "Digite la Fecha de Inicio:", f"01/01/{anio_dinamico}", self)
        if dialogo_ini.exec() != QDialog.DialogCode.Accepted: return
        f_ini_input = dialogo_ini.obtener_fecha_seleccionada()
        dt_ini_obj = datetime.strptime(f_ini_input, "%d/%m/%Y")
        
        dialogo_fin = DialogoFechaFinInteractiva(dt_ini_obj, f"05/01/{anio_dinamico}", self)
        if dialogo_fin.exec() != QDialog.DialogCode.Accepted: return
        f_fin_input, dias_calculados = dialogo_fin.obtener_valores()
        
        nuevo_cod = self.calcular_codigo_por_seleccion(codigo_base, nivel_deseado)
        if not nuevo_cod: return
        
        avance_num = 0
        if estado == "Ejecutado": avance_num = 100
        elif estado == "En proceso":
            av_txt, ok_av = self.agenda_input_dialog_custom("Porcentaje Requerido", "Digite un valor (0 a 100):", None, "50")
            if ok_av and av_txt.isdigit():
                pct = int(av_txt)
                if pct < 0 or pct > 100:
                    QMessageBox.critical(self, "Valor Inválido", "El porcentaje debe estar en el rango de 0% a 100%.")
                    return
                avance_num = pct
                if pct == 100: estado = "Ejecutado"
                elif pct == 0: estado = "En proceso"
            else: return

        try:
            self.cursor.execute("INSERT INTO actividades VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (nuevo_cod, desc.strip(), resp, estado, avance_num, f_ini_input, f_fin_input, dias_calculados))
            self.registrar_historial("Agregar Elemento", f"Se creó el código {nuevo_cod}: {desc.strip()} ({avance_num}%) con {dias_calculados} días.")
            self.conn.commit()
            
            self.cursor.execute("SELECT correo FROM responsables WHERE nombre = ?", (resp,))
            correo_res = self.cursor.fetchone()
            if correo_res and correo_res[0]:
                QMessageBox.information(self, "Sistema de Notificaciones", f"Registro completado.\nEstructura lista para alertar a {resp} al buzón: {correo_res[0]}")
            self.cargar_datos_desde_db()
        except Exception as e:
            QMessageBox.critical(self, "Error", f"Conflicto de duplicidad en la jerarquía estructural: {str(e)}")

    def calcular_codigo_por_seleccion(self, codigo_base, nivel_deseado):
        codigo_base = str(codigo_base).strip()
        if nivel_deseado == 1:
            self.cursor.execute("SELECT codigo FROM actividades WHERE codigo NOT LIKE '%.%' ORDER BY CAST(codigo AS INTEGER) DESC LIMIT 1")
            res = self.cursor.fetchone()
            if res:
                c = res[0].strip()
                if c.endswith('.'): c = c[:-1]
                return f"{int(c) + 1}."
            return "1."
            
        partes_base = codigo_base.split(".")
        if len(partes_base) == nivel_deseado - 1:
            self.cursor.execute(f"SELECT codigo FROM actividades WHERE codigo LIKE '{codigo_base}.%' ORDER BY length(codigo) DESC, codigo DESC LIMIT 1")
            res = self.cursor.fetchone()
            if res:
                ultimas = res[0].strip().split(".")
                ultimas[-1] = str(int(ultimas[-1]) + 1)
                return ".".join(ultimas)
            return f"{codigo_base}.1"
        elif len(partes_base) == nivel_deseado:
            parent_code = ".".join(partes_base[:-1])
            self.cursor.execute(f"SELECT codigo FROM actividades WHERE codigo LIKE '{parent_code}.%' ORDER BY length(codigo) DESC, codigo DESC LIMIT 1")
            res = self.cursor.fetchone()
            if res:
                text_split = res[0].strip().split(".")
                if text_split[-1] == "": text_split.pop()
                text_split[-1] = str(int(text_split[-1]) + 1)
                return ".".join(text_split)
        return None

    def editar_columna_especifica(self, item, column):
        if not self.tiene_permiso('Coordinador'):
            QMessageBox.critical(self, "Acceso Denegado", "Tu nivel institucional actual (Operario) solo otorga permisos de lectura de datos.")
            return

        codigo_actual = item.text(0).strip()
        self.cursor.execute("SELECT descripcion, responsable, estado, avance, fecha_inicio, fecha_fin, dias FROM actividades WHERE codigo = ?", (codigo_actual,))
        datos = self.cursor.fetchone()
        if not datos: return
        
        desc_actual, resp_actual, estado_actual, avance_actual, f_ini_act, f_fin_act, dias_actual = datos
        self.cursor.execute(f"SELECT count(*) FROM actividades WHERE codigo LIKE '{codigo_actual}.%'")
        tiene_hijos = self.cursor.fetchone()[0] > 0

        if column == 0 or column == 1:
            if column == 1:
                nueva_desc, ok = self.agenda_input_dialog_custom("Modificar Descripción", "Descripción:", None, desc_actual)
                if ok and nueva_desc.strip():
                    self.cursor.execute("UPDATE actividades SET descripcion = ? WHERE codigo = ?", (nueva_desc.strip(), codigo_actual))
                    self.registrar_historial("Editar Descripción", f"[{codigo_actual}] Nueva descripción asignada.")
        elif column == 2:
            nuevo_resp, ok = self.agenda_input_dialog_custom("Modificar Responsable", "Responsable:", self.responsables_reales, resp_actual)
            if ok: 
                self.cursor.execute("UPDATE actividades SET responsable = ? WHERE codigo = ?", (nuevo_resp, codigo_actual))
                self.registrar_historial("Cambio Responsable", f"[{codigo_actual}] Asignado a: {nuevo_resp}")
                self.cursor.execute("SELECT correo FROM responsables WHERE nombre = ?", (nuevo_resp,))
                correo_res = self.cursor.fetchone()
                if correo_res and correo_res[0]:
                    QMessageBox.information(self, "Notificación Planificada", f"Responsabilidad modificada.\nBuzón detectado: {correo_res[0]}")
        elif column == 3:
            if tiene_hijos:
                QMessageBox.warning(self, "Bloqueado", "El Estado se calcula de sus subtareas.")
                return
            nuevo_estado, ok = self.agenda_input_dialog_custom("Modificar Estado", "Estado:", ["Pendiente", "En proceso", "Ejecutado"], estado_actual)
            if ok:
                avance_calc = avance_actual
                if nuevo_estado == "Ejecutado": avance_calc = 100
                elif nuevo_estado == "Pendiente": avance_calc = 0
                elif nuevo_estado == "En proceso":
                    av_txt, ok_av = self.agenda_input_dialog_custom("Porcentaje Requerido", "Digite un valor (0 a 100):", None, str(avance_actual))
                    if ok_av and av_txt.isdigit():
                        pct = int(av_txt)
                        if pct < 0 or pct > 100:
                            QMessageBox.critical(self, "Valor Inválido", "El porcentaje debe estar entre 0% y 100%.")
                            return
                        avance_calc = pct
                        if pct == 100: nuevo_estado = "Ejecutado"
                    else: return 

                self.cursor.execute("UPDATE actividades SET estado = ?, avance = ? WHERE codigo = ?", (nuevo_estado, avance_calc, codigo_actual))
                self.registrar_historial("Cambio Estado", f"[{codigo_actual}] Estado actualizado a: {nuevo_estado} ({avance_calc}%)")
        elif column == 4:
            if tiene_hijos:
                QMessageBox.warning(self, "Bloqueado CPM", "La Fecha de Inicio se calcula automáticamente de las componentes hijas.")
                return
            dialogo = DialogoCalendarioCustom("Fecha de Inicio", "Digite la fecha de inicio:", f_ini_act if f_ini_act and f_ini_act != "Definir" else "", self)
            if dialogo.exec() == QDialog.DialogCode.Accepted:
                f_ini_input = dialogo.obtener_fecha_seleccionada()
                dt_ini = datetime.strptime(f_ini_input, "%d/%m/%Y")
                dt_fin = dt_ini + timedelta(days=int(dias_actual)-1)
                self.cursor.execute("UPDATE actividades SET fecha_inicio = ?, fecha_fin = ? WHERE codigo = ?", (f_ini_input, dt_fin.strftime("%d/%m/%Y"), codigo_actual))
                self.registrar_historial("Modificar Fecha Inicio", f"[{codigo_actual}] Movido a {f_ini_input}")
        elif column == 5:
            if tiene_hijos:
                QMessageBox.warning(self, "Bloqueado CPM", "La Fecha de Fin se calcula automáticamente de sus desgloses.")
                return
            dt_ini = parsear_fecha_segura(f_ini_act)
            if not dt_ini: dt_ini = datetime.now()
            dialogo = DialogoFechaFinInteractiva(dt_ini, f_fin_act if f_fin_act and f_fin_act != "Definir" else f_ini_act, self)
            if dialogo.exec() == QDialog.DialogCode.Accepted:
                f_fin_input, dias_calc = dialogo.obtener_valores()
                self.cursor.execute("UPDATE actividades SET fecha_fin = ?, dias = ? WHERE codigo = ?", (f_fin_input, dias_calc, codigo_actual))
                self.registrar_historial("Modificar Fecha Fin", f"[{codigo_actual}] Nueva fecha límite: {f_fin_input}")
        elif column == 6:
            if tiene_hijos:
                QMessageBox.warning(self, "Bloqueado CPM", "Los Días se autocalculan midiendo la ventana de ejecución total.")
                return
            dias_txt, ok = self.agenda_input_dialog_custom("Duración", "Consigne los Días de duración:", None, str(dias_actual))
            if ok and dias_txt.isdigit():
                dias_num = int(dias_txt)
                dt_ini = parsear_fecha_segura(f_ini_act)
                if not dt_ini: dt_ini = datetime(datetime.now().year, 1, 1)
                dt_fin = dt_ini + timedelta(days=dias_num - 1)
                self.cursor.execute("UPDATE actividades SET dias = ?, fecha_fin = ? WHERE codigo = ?", (dias_num, dt_fin.strftime("%d/%m/%Y"), codigo_actual))
                self.registrar_historial("Modificar Duración", f"[{codigo_actual}] Plazo fijado en {dias_num} días.")
        elif column == 7:
            if tiene_hijos:
                QMessageBox.warning(self, "Bloqueado", "El % de Avance se calcula automáticamente por promedio.")
                return
            av_txt, ok = self.agenda_input_dialog_custom("Porcentaje Requerido", "Porcentaje de avance real (0 a 100):", None, str(avance_actual))
            if ok and av_txt.isdigit():
                nuevo_avance = int(av_txt)
                if nuevo_avance < 0 or nuevo_avance > 100:
                    QMessageBox.critical(self, "Valor Fuera de Rango", "Porcentaje inválido.\nDebe ingresar un número entre 0 y 100%.")
                    return
                nuevo_estado = "Ejecutado" if nuevo_avance == 100 else "Pendiente" if nuevo_avance == 0 else "En proceso"
                self.cursor.execute("UPDATE actividades SET avance = ?, estado = ? WHERE codigo = ?", (nuevo_avance, nuevo_estado, codigo_actual))
                self.registrar_historial("Modificar Progreso", f"[{codigo_actual}] Progreso fijado en {nuevo_avance}%")

        self.conn.commit()
        self.cargar_datos_desde_db()


# --- PUNTO DE ARRANQUE CON LOOP DE CERRAR/RE-INICIAR SESIÓN INTERNA ---
if __name__ == "__main__":
    while True:
        app = QApplication(sys.argv)
        window = GanttAppReal()
        login = DialogoLogin(window)
        
        if login.exec() == QDialog.DialogCode.Accepted:
            window.usuario_actual = login.usuario_logueado
            window.rol_actual = login.rol_logueado
            window.label_usuario.setText(f"{window.usuario_actual} ({window.rol_actual})")
            
            if window.rol_actual == "Operario":
                window.btn_act.setDisabled(True)
                window.btn_eliminar_global.setDisabled(True)
                window.btn_gestionar_resp.setDisabled(True)
                window.btn_gestionar_usuarios.setDisabled(True)
            elif window.rol_actual == "Coordinador":
                window.btn_eliminar_global.setDisabled(True)
                window.btn_gestionar_resp.setDisabled(True)
                window.btn_gestionar_usuarios.setDisabled(True)
                
            window.cursor.execute("SELECT avatar_path FROM usuarios WHERE username = ?", (window.usuario_actual,))
            avatar_res = window.cursor.fetchone()
            ruta_av = avatar_res[0] if avatar_res else None
            window.actualizar_avatar_visual(ruta_av)
            
            window.cargar_datos_desde_db()
            window.show()
            app.exec()
            
            if window.cerrar_sesion_solicitado:
                del window
                del app
                continue
            else:
                break
        else:
            sys.exit()