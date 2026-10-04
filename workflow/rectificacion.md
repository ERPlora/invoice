# WORKFLOW — Facturación · Rectificar

Prefijo: INVOICE

## Flujos

### INVOICE-F08 Rectificar una factura entera a mano
Estado: parcial — siempre emite una R1 en la serie RECT, sin elegir tipo ni causa; si la factura ya tiene una rectificativa por diferencias, «Devolución» sigue ofrecida, no emite nada y aun así la ventana dice «Rectificativa emitida…»; se ofrece también sobre un tique que ya se sustituyó por su F3; el rótulo «Devolución» no devuelve dinero
Vertical: comun
Actor: responsable, administrador, asistente
Pantalla: Devolución (rectificar)
Pasos:
1. En **Facturas** (fila) o en la ficha, pulsa «Devolución» en una factura que no sea rectificativa ni esté «Cancelada».
2. Lee la nota de la ventana y escribe el «Motivo»; sin él, «Emitir rectificativa» sigue en gris.
3. Pulsa «Emitir rectificativa» («Rectificando…» mientras va; un segundo clic no emite otra).
4. La ventana dice «Rectificativa emitida. {número} queda cancelada.». Al pulsar «Cerrar», la original sale «Cancelada» y la lista tiene una «Rectificativa» nueva fechada hoy, con los importes y las líneas de la original en negativo y la nota «Rectifica la factura {número}. Motivo: {motivo}».
Entra: la factura elegida y el motivo. La fecha y el año los pone el servidor: el día del negocio.
Sale: la rectificativa R1 numerada en la serie «RECT» del año, con el emisor y el cliente de la original, su desglose de impuestos congelado en negativo y sus líneas en negativo; la original pasa a «Cancelada» (avisa: invoice.rectified). VeriFactu la registra como rectificativa (como R5 si no hay NIF del cliente). No mueve dinero ni caja.
Si falla: el rechazo sale dentro de la ventana, traducido. Pedida con otra fecha u otro año (API o asistente): «Una factura rectificativa lleva la fecha del día en que se emite…» y no se emite nada. Sobre una rectificativa o una cancelada, la ventana solo dice por qué («Una rectificativa no se puede rectificar.», «La factura ya está cancelada.»). En pantalla, un empleado no tiene la acción; si la pide por otro camino (el asistente), el hub pide la aprobación con PIN de un responsable. La rectificativa de un tique sale R1 sin NIF del cliente: la ficha avisa de que falta el NIF y la impresora de tiques no la saca. Si la factura ya tenía una rectificativa por diferencias (INVOICE-F10), no se emite nada, no se gasta número, pero la ventana dice que sí.
Implicados: VERIFACTU-F14, VERIFACTU-F24, REC_FISCAL-F12
QA: R-11, B-08, L-03, qa-hub-restaurant §13

### INVOICE-F09 La rectificativa al devolver una venta entera
Estado: parcial — si el tique de la venta ya se sustituyó por una F3, rectifica el tique y no la F3; si la venta se devuelve antes de que exista su factura (cobro en reintentos o en «Eventos caídos»), no rectifica nada ni lo reintenta, y la factura nace después «Emitida»; la rectificativa de un tique no sale por la impresora de tiques
Vertical: comun
Actor: sistema
Pantalla: ninguna
Pasos:
1. Alguien devuelve en Ventas una venta cobrada entera, de una vez.
2. Facturación emite sola la rectificativa: la factura de esa venta entera en negativo, en la serie «RECT» del año, fechada el día del negocio, con las líneas de la original en negativo y el motivo de la devolución.
3. La factura original pasa a «Cancelada»; la rectificativa aparece en **Facturas** con «Origen» «Rectificación» y «Rectifica a» la original.
Entra: la devolución de Ventas (sale.refunded): la venta, la referencia del documento de devolución, el importe devuelto, si cierra la venta y el motivo. La factura original se busca por la venta, nunca por lo que diga el aviso.
Sale: la R1 y la original cancelada (avisa: invoice.rectified); VeriFactu la registra con la factura que rectifica.
Si falla: el mismo aviso repetido no emite otra rectificativa ni gasta número: una por documento de devolución. Si la venta no tiene factura (Facturación se instaló después del cobro, o el cobro sigue en reintentos o en «Eventos caídos») o ya está rectificada entera, no se emite nada, la devolución termina sin error y no se vuelve a intentar: si la factura nace después, queda «Emitida» y hay que rectificarla a mano (INVOICE-F06, INVOICE-F08). La rectificativa de un tique es una R1 sin NIF del cliente: la ficha avisa de que falta el NIF y la impresora de tiques no la saca. Un error se reintenta y, si persiste, acaba en «Eventos caídos», como en INVOICE-F06.
Implicados: SALES-F31, VERIFACTU-F14, REC_FISCAL-F11
QA: R-11, B-08, L-03

### INVOICE-F10 La rectificativa por diferencias al devolver parte de una venta
Estado: parcial — la única línea de la rectificativa dice «Refund {id}», en inglés y con el identificador interno de la devolución, y así sale en el papel del cliente; si el tique ya se sustituyó por una F3, rectifica el tique; la rectificativa de un tique no sale por la impresora de tiques
Vertical: comun
Actor: sistema
Pantalla: ninguna
Pasos:
1. Alguien devuelve en Ventas una parte de una venta cobrada.
2. Facturación emite sola una rectificativa por diferencias por el importe devuelto: en negativo, en la serie «RECT» del año, con el desglose de impuestos de la original repartido en proporción y una sola línea, la devolución. La original sigue «Emitida».
3. Cada devolución siguiente emite la suya sobre lo que queda; la que cierra la venta se lleva exactamente lo que queda, y entonces la original pasa a «Cancelada».
4. Se comprueba sumando: con la venta devuelta entera, la original y sus rectificativas suman cero al céntimo, tipo a tipo.
Entra: la devolución de Ventas (sale.refunded), como en INVOICE-F09.
Sale: una R1 por documento de devolución (avisa: invoice.rectified); la original se cancela solo cuando queda a cero. VeriFactu registra cada una.
Si falla: la misma devolución dos veces es un solo documento, y nunca se rectifica más de lo que queda de la original. Una devolución de importe cero que no cierra la venta no emite nada. La rectificativa de un tique es una R1 sin NIF del cliente: la impresora de tiques no la saca. Mientras la original tenga una rectificativa por diferencias, «Devolución» en Facturación no emite nada aunque diga que sí (INVOICE-F08).
Implicados: SALES-F31, VERIFACTU-F14, REC_FISCAL-F11
QA: L-03, qa-hub-restaurant §13
