# WORKFLOW — Facturación · Consultar, imprimir y cobrar

Prefijo: INVOICE

## Flujos

### INVOICE-F16 Buscar una factura
Estado: parcial — sin ordenar, la lista sale por el identificador interno, que no sigue ni la fecha ni el número: lo último emitido no sale arriba
Vertical: comun
Actor: empleado, responsable, administrador
Pantalla: Facturas
Pasos:
1. Abre **Facturación → Facturas**.
2. Escribe en «Buscar facturas…» un número, un nombre de cliente o un NIF; o filtra por columna (estado, tipo, fecha, total…); o pulsa una columna, por ejemplo «Fecha», para ordenar.
3. La tabla enseña las que casan, de 50 en 50.
4. Pulsa «Ver», o la fila, para abrirla (INVOICE-F17).
Entra: las facturas del hub.
Sale: nada; solo se lee.
Si falla: sin resultados sale «Aún no hay facturas.» (sin confirmar si la tabla lo distingue de una lista vacía); con un error, el mensaje y el botón de reintentar.
Implicados: VERIFACTU-F16
QA: ninguno

### INVOICE-F17 Ver una factura y su justificante VeriFactu
Estado: parcial — la ficha no dice si un tique se sustituyó por una F3 ni enlaza la F3 con su tique; no enseña la forma de pago
Vertical: comun
Actor: empleado, responsable, administrador
Pantalla: Ficha de factura
Pasos:
1. En **Facturas**, abre la factura.
2. Lee la cabecera, las líneas y los totales y, con VeriFactu, el «Justificante VeriFactu» con su estado, el CSV y el QR, que se puede escanear o abrir con «Validar en la Agencia Tributaria ↗».
3. En una rectificativa, «Rectifica a» abre la factura original.
4. «← Volver» regresa a la lista.
Entra: la factura y sus líneas y, si VeriFactu está instalado, su registro.
Sale: nada; solo se lee.
Si falla: «Factura no encontrada» o el motivo del fallo, encima de la lista. Sin VeriFactu, sin registro todavía o sin permiso para verlo, la ficha sale sin la tarjeta del justificante. Abrir otra factura antes de que cargue la primera enseña solo la última.
Implicados: VERIFACTU-F19
QA: L-04, qa-hub §7, qa-hub-restaurant §11 (discrepa)

### INVOICE-F18 Imprimir o guardar en PDF una factura
Estado: parcial — la reimpresión no lleva la marca «duplicado»; no hay descarga de PDF propia, solo el diálogo de impresión del navegador para una factura completa abierta en el navegador; un tique simplificado sin impresora se queda en la cola y no tiene PDF; en la app instalada, el diálogo A4 del sistema no se usa (el módulo no manda el documento en HTML); la rectificativa de un tique no sale por la impresora de tiques
Vertical: comun
Actor: empleado, responsable, administrador
Pantalla: Ficha de factura
Pasos:
1. En la ficha, pulsa «Imprimir / PDF».
2. Con una impresora de tiques (rol de recibos), sale por ella: el tique como tique, y la factura completa como factura en el rollo, con el NIF del cliente, el IVA por tipo, el QR con «QR tributario:» y «VERI*FACTU» y, en una rectificativa completa, su título y la nota de lo que rectifica.
3. Sin impresora de tiques: abierto en el navegador (sin impresoras registradas en el puesto), una factura completa abre el diálogo de impresión del navegador con la factura en A4, en el idioma de la pantalla, desde donde se puede guardar como PDF; si el puesto tiene impresoras registradas pero ninguna con rol de recibos, queda en la cola de impresión del hub. Un tique simplificado va siempre a la cola.
4. Si salió por la impresora, se abrió el diálogo o quedó en una cola que alguien vacía, no aparece ningún aviso: en la cola, el papel sale cuando su impresora lo recoge. Con la impresora de red del dispositivo apagada o sin papel tampoco hay aviso y el papel se pierde (PRINTING-F07). Cada pulsación es una copia nueva, sin la marca de duplicado que sí pone la reimpresión desde Ventas (SALES-F29, PRINTING-F08).
Entra: la factura, sus líneas y el QR de VeriFactu.
Sale: el trabajo de impresión; la factura no cambia y no se crea ningún registro.
Si falla: en cola sin impresora dada de alta: «La factura {número} está en cola, pero no hay ninguna impresora dada de alta en este puesto: saldrá en cuanto se dé de alta una.». Cualquier otro fallo: «No se pudo imprimir la factura» con el motivo. Una factura completa o una rectificativa sin NIF del cliente (también la de un tique devuelto, que sale R1) no sale por la impresora de tiques, y la ficha lo avisa antes de pulsar. En la app instalada que no puede consultar sus impresoras, una factura completa falla con «No se pudo imprimir la factura» (sin confirmar cuándo ocurre).
Implicados: PRINTING-F08
QA: L-05 (discrepa), R-11, qa-hub-restaurant §11 (discrepa)

### INVOICE-F19 Marcar una factura como pagada
Estado: parcial — se ofrece también en las facturas que nacen de una venta ya cobrada en caja y en las rectificativas, que también salen «Emitida»; no guarda la forma de pago
Vertical: comun
Actor: empleado, responsable, administrador
Pantalla: Facturas
Pasos:
1. En **Facturas** (fila) o en la ficha, pulsa «Marcar pagada» en una factura «Emitida».
2. Confirma en «¿Marcar {número} como pagada?» («El cobro se registra con la fecha y la hora de ahora.») con «Marcar pagada», o vuelve atrás con «Cancelar».
3. La factura pasa a «Pagada» y la ficha enseña «Pagada el» con la fecha y la hora, en el reloj del negocio.
Entra: la factura elegida.
Sale: el estado «Pagada» y la fecha de pago. Ningún importe cambia, no se avisa a ningún módulo y la caja no se toca.
Si falla: si mientras tanto alguien la pagó o la rectificó, «Esta factura no se puede marcar como pagada: solo se puede con una factura emitida que aún no esté pagada. No se ha cambiado nada.», donde se pulsó, y la lista se pone al día. Sin permiso de emitir, la acción no aparece.
Implicados: ninguno
QA: ninguno

### INVOICE-F20 Dar a otros módulos la factura de una venta
Estado: hecho
Vertical: comun
Actor: sistema
Pantalla: ninguna
Pasos:
1. Otro módulo pregunta qué factura nació de una venta.
2. Facturación contesta con su número, tipo, serie, fecha, emisor, cliente, total y estado.
3. Ventas lo usa para poner en el tique el número y el QR de VeriFactu, y para sellar las líneas del tique en el localizador de la factura completa (INVOICE-F04); Caja, para nombrar el movimiento de la venta por el número de su factura.
Entra: el identificador de la venta.
Sale: los datos de la factura; solo se lee.
Si falla: si la factura aún no existe (se emite un instante después del cobro, o falló: INVOICE-F06), no contesta nada y quien pregunta sigue sin ella.
Implicados: CASH_REGISTER-F11, INVENTORY-F16, PRINTING-F07, SALES-F29, REC_FISCAL-F07
QA: R-09
