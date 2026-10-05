# WORKFLOW — Facturación · Emitir el documento de una venta

Prefijo: INVOICE

## Flujos

### INVOICE-F01 El tique (factura simplificada) que nace al cobrar
Estado: hecho
Vertical: comun
Actor: sistema
Pantalla: ninguna
Pasos:
1. El cajero cobra una venta en Ventas como tique, que es lo habitual en barra y en el salón.
2. En cuanto la venta queda cobrada, Facturación emite sola su factura simplificada (F2) en la serie «TICKET» del año, fechada el día del negocio, con las líneas de la venta y el cliente si la venta tenía uno asignado. La base y la cuota se cierran una vez por tipo de impuesto: lo cobrado no cambia ni un céntimo, pero pueden moverse céntimos entre base y cuota (con precios sin IVA, la cuota de cada línea se reparte de nuevo).
3. La factura aparece en **Facturación → Facturas** como «Ticket», «Emitida», con «Origen» «Venta del TPV»; puede tardar un instante después del cobro.
4. Se comprueba abriéndola: las líneas, la «Base», los «Impuestos» y el «Total» son los del tique de Ventas.
Entra: la venta cobrada de Ventas (sale.completed): sus líneas con base y cuota ya calculadas, si los precios llevaban el IVA dentro, el tipo de documento y la copia de los datos del cliente; las reglas de impuestos de Impuestos; la identidad fiscal, el país y la zona horaria del hub.
Sale: la factura F2 con su número, sus líneas, el desglose por tipo de impuesto y su número apuntado en el libro (avisa: invoice.created); VeriFactu crea su registro y Ventas pone el número en su tique.
Si falla: el mismo aviso repetido no crea otra factura ni gasta número. Si el hub no puede leer las reglas de impuestos o la venta, o los importes no cuadran (cuota que no corresponde a su tipo, cuota en una línea exenta, total negativo), no se escribe nada y el hub lo reintenta (INVOICE-F06). El tipo y la calificación de cada línea con categoría se vuelven a resolver contra las reglas vigentes el día de emisión, no el del cobro: si el tipo cambió entre el cobro y una emisión que llega más tarde (un reintento, un reenvío desde «Eventos caídos»), la cuota cobrada ya no cuadra y se rechaza por descuadre (TAXES-F07). Si la venta ya no existe, no se emite. El techo de la simplificada no se mira aquí: una de más de 3.000 € (3.010 € con la tolerancia de la AEAT) se emite y VeriFactu la encadena; su validador la rechaza antes de enviarla, con el número de la cadena ya gastado.
Implicados: SALES-F01, SALES-F04, TAXES-F04, TAXES-F05, TAXES-F06, TAXES-F07, TAXES-F11, TAXES-F18, TAXES-F19, VERIFACTU-F13, REC_FISCAL-F02, REC_FISCAL-F04, HUB-F18, HUB_SHELL-F164
QA: R-09, B-06, BD-09, L-01, L-04

### INVOICE-F02 La factura completa al cobrar a un cliente con NIF
Estado: hecho
Vertical: comun
Actor: sistema
Pantalla: ninguna
Pasos:
1. El cajero cobra en Ventas eligiendo factura, con el nombre, el NIF y la dirección del cliente (Ventas no deja cobrar como factura sin los tres).
2. Facturación emite sola una factura completa (F1) en la serie «FACT» del año, con el NIF, el nombre, la dirección, el país y el tipo de documento del cliente copiados de la venta.
3. Aparece en **Facturas** como «Factura», «Emitida», «Venta del TPV», y la ficha enseña «NIF cliente» y «Dirección».
Entra: la venta cobrada como factura (sale.completed con tipo de documento factura) y la copia fiscal del cliente que la venta tomó de su ficha o del cobro.
Sale: la factura F1 (avisa: invoice.created). Es una copia: editar después la ficha del cliente no la cambia. Un cliente de fuera de España se declara por su país y su documento.
Si falla: como en INVOICE-F01. Si llegara sin NIF, Facturación la emite como F1 y VeriFactu la declara como simplificada.
Implicados: CUSTOMERS-F17, SALES-F04, VERIFACTU-F13, REC_FISCAL-F03
QA: R-09, B-06, BD-09, L-01, qa-hub-restaurant §11

### INVOICE-F03 Emitir una factura a mano
Estado: parcial — el formulario no pide la categoría fiscal de la línea (se cobra el «IVA %» escrito como venta nacional sujeta) ni el país y el tipo de documento de un cliente extranjero; el selector de serie ofrece también la de rectificativas, que emite una «Rectificativa» en positivo sin original; una serie cuyo código no sea FACT ni RECT emite tiques (F2) aunque se creara como Factura; no avisa del techo de la simplificada
Vertical: comun
Actor: empleado, responsable, administrador
Pantalla: Facturas
Pasos:
1. En **Facturas**, pulsa el botón de añadir (+) de la barra de la tabla: se abre el panel lateral.
2. Elige la «Serie» (FACT de entrada; la lista trae las series activas de todos los años, y sin ninguna ofrece FACT y TICKET) y escribe «Cliente», «NIF cliente», «Dirección» y «Notas».
3. Rellena cada línea: «Descripción», «Cant.» (1 de entrada; admite decimales), «Precio» sin IVA y en el formato del hub, e «IVA %» (21 de entrada). «+ Línea» añade otra y «Quitar línea» (la cruz) la quita.
4. Pulsa «Emitir factura»; está en gris hasta que cada línea tiene descripción, cantidad y precio. El panel se cierra y la factura aparece en la lista con su número y «Origen» «Alta manual».
Entra: lo que escribe la persona; la identidad fiscal del hub como emisor (el formulario no tiene campos de emisor); las reglas de Impuestos. VeriFactu usa esta misma puerta para su «Crear factura de prueba» (VERIFACTU-F11): un tique F2 de una línea de 1,00 € al 21 % en la serie TICKET, que en la ficha sale con «Origen» «Otro» y la nota «Prueba VeriFactu». Es una factura real de Facturación: gasta un número de la serie TICKET del año, y Facturación no distingue lo emitido en pruebas de lo emitido en producción.
Sale: la factura (F1 en la serie FACT, F2 en TICKET) con el IVA calculado encima del precio y cerrado una vez por tipo, y su número en el libro (avisa: invoice.created); VeriFactu la registra.
Si falla: el motivo sale dentro del panel, encima de «Emitir factura»: «Línea {line}: el precio no es un importe…», el precio que «se puede leer de dos maneras», «Línea {line}: un precio no puede ser negativo…», «Una factura completa (F1) necesita el NIF del cliente…», una línea que sale a 0,00, o importes que no cuadran. No se emite nada ni se gasta número, y lo escrito se conserva. El techo de la simplificada no se mira: una de más de 3.000 € (3.010 € con la tolerancia de la AEAT) se emite y VeriFactu la encadena; su validador la rechaza antes de enviarla, con el número de la cadena ya gastado.
Implicados: TAXES-F19, VERIFACTU-F11, VERIFACTU-F13, REC_FISCAL-F14, HUB_SHELL-F164
QA: BD-09

### INVOICE-F04 El cliente pide la factura completa de su tique
Estado: hecho
Vertical: comun
Actor: cliente
Pantalla: Hub: página pública para pedir la factura
Pasos:
1. El tique que imprime Ventas lleva, junto al QR de VeriFactu, un segundo QR con un localizador para pedir la factura (el texto exacto del tique es de Ventas, sin confirmar aquí).
2. El cliente lo abre en su móvil, sin iniciar sesión, y escribe sus datos fiscales: NIF, nombre, dirección y, si es de fuera, su país y su tipo de documento (dos listas que salen siempre).
3. Envía el formulario.
4. Facturación emite una factura completa sustitutiva (F3) en la serie «FACT», con las líneas y los importes del tique copiados al céntimo y enlazada a él; el tique no se toca. En **Facturas** sale como «Factura», con «Origen» «Sustituye a una factura simplificada».
Entra: el tique (F2) y sus líneas, que Ventas deja sellados en el localizador; los datos fiscales que escribe el cliente.
Sale: la F3 (avisa: invoice.created); VeriFactu la declara indicando el tique al que sustituye. El localizador sirve una sola vez.
Si falla: sin NIF o sin nombre se rechaza; un envío rechazado (por ejemplo, un NIF mal escrito) no gasta el localizador y se puede volver a intentar. Pasado el plazo (45 días si Ventas no fija otro), la página dice que el plazo terminó, manda preguntar en el mostrador y no emite nada. Las líneas se vuelven a calificar con las reglas del día en que se pide: si el tipo de una categoría cambió desde el tique, la F3 se rechaza por descuadre (TAXES-F07) y la página enseña la frase técnica en inglés, con los importes en céntimos. Un fallo del propio hub, que no tiene que ver con lo que escribió el cliente, sale como «No se han podido aceptar los datos. Revisa el NIF y vuelve a intentarlo.». Cuando la F3 sale bien, la página no enseña su referencia. Si después se anula la venta en Ventas, la F3 sigue viva (INVOICE-F07). Un segundo intento sobre el mismo tique no emite otra F3 ni gasta número: hay una sustitutiva por tique. Si Facturación no está instalada o el tique no tiene líneas, el tique sale sin ese QR.
Implicados: SALES-F29, TAXES-F07, VERIFACTU-F13, REC_FISCAL-F10, REC_FISCAL-F13, HUB-F16, HUB-F17
QA: L-02, BD-09

### INVOICE-F05 Pasar un tique a factura completa desde el mostrador
Estado: parcial — no hay botón ni en Facturas ni en la ficha del tique: solo con el asistente o la API, que tienen que mandar también las líneas del tique, o abriendo el empleado la página pública desde el QR del tique, como haría el cliente; no se comprueba que el documento sustituido exista ni que sea un tique; la ficha del tique no dice que se sustituyó
Vertical: comun
Actor: empleado, responsable, asistente
Pantalla: asistente
Pasos:
1. El cliente vuelve con su tique y pide la factura a su nombre.
2. Se pide al asistente la factura completa de ese tique con el NIF, el nombre y la dirección del cliente (sin confirmar que el asistente lea solo las líneas del tique antes de pedirla).
3. Se emite la F3 igual que en INVOICE-F04 y aparece en **Facturas**.
Entra: el tique que se sustituye y sus líneas, y los datos fiscales del cliente.
Sale: la F3 enlazada al tique (avisa: invoice.created); VeriFactu la declara con el tique sustituido.
Si falla: sin NIF o sin nombre, rechazo. Si el tique ya tiene su F3, la petición responde bien pero no emite nada ni gasta número.
Implicados: VERIFACTU-F13, REC_FISCAL-F10
QA: L-02, BD-09 (discrepa)

### INVOICE-F06 Una venta cobrada que no se ha podido facturar
Estado: parcial — el único aviso es genérico («Eventos caídos», sin decir que es una venta sin factura ni cuál) y Facturación no enseña nada; tras los reintentos espera a que alguien lo reenvíe a mano; una devolución que llega antes que la factura se pierde y la factura nace después sin rectificar
Vertical: comun
Actor: sistema, administrador
Pantalla: Hub: Sistema, pestaña «Eventos caídos»
Pasos:
1. Una venta queda cobrada y Facturación no puede emitir su factura: el hub no puede leer las reglas de impuestos o la venta, los importes no cuadran, una regla cobra cuota en una línea exenta (TAXES-F09), o el tipo de la categoría cambió entre el cobro y el día en que se intenta emitir (TAXES-F07).
2. La venta no se pierde: su aviso queda guardado y el hub lo reintenta, cada vez más espaciado (unos minutos en total), hasta 8 veces; un intento fallido no escribe nada ni gasta número.
3. Si sigue fallando, pasa a «Eventos caídos» y la campana de «Notificaciones» dice cuántos hay.
4. Quien arregla la causa (por ejemplo, la regla de impuestos) lo reenvía desde la pestaña «Eventos caídos» de Sistema, uno a uno o con «Reenviar todos», y la factura se emite.
Entra: el aviso de la venta cobrada que no se pudo facturar.
Sale: nada mientras falle. Al reenviarse con éxito, lo de INVOICE-F01 o INVOICE-F02, fechado el día en que por fin se emite, no el del cobro.
Si falla: descartar el evento caído deja la venta sin factura para siempre; el hub pide confirmarlo. Mientras no hay factura, el tique de Ventas sale sin número de factura. Si la venta se devuelve mientras su factura no existe, la devolución no rectifica nada, termina sin error y no se reintenta (INVOICE-F09): al reenviar después el cobro, la factura nace «Emitida» sin rectificativa y hay que rectificarla a mano (INVOICE-F08).
Implicados: SALES-F01, SALES-F29, TAXES-F09, REC_FISCAL-F09, HUB-F52, HUB_SHELL-F62, HUB_SHELL-F145, HUB_SHELL-F146, HUB_SHELL-F147, HUB_SHELL-F148
QA: BD-09, qa-hub-restaurant §11

### INVOICE-F07 Anular una venta cobrada que ya tiene su tique
Estado: no hecho — al anular en Ventas una venta cobrada como tique, su factura simplificada sigue «Emitida» y declarada a la AEAT y nadie emite su rectificativa: Facturación no escucha la anulación
Vertical: comun
Actor: sistema
Pantalla: ninguna
Pasos:
1. Alguien anula en Ventas una venta cobrada como tique, con su motivo (Ventas no deja anular una venta cobrada como factura ni una que ya tiene devoluciones; sí una cuyo tique el cliente ya canjeó por factura completa, INVOICE-F04).
2. Hoy, en Facturación no pasa nada: el tique sigue en la lista como «Emitida», su registro sigue declarado en VeriFactu y, si se canjeó, su F3 también sigue viva.
3. Lo que falta, sin decidir todavía (ver «Dudas abiertas» 3 del índice): que el documento fiscal quede corregido solo, como en una devolución: con una rectificativa que VeriFactu registraría como cualquier otra (VERIFACTU-F14) o con un registro de anulación (VERIFACTU-F30, que hoy solo se crea con el asistente).
Entra: la anulación de la venta (sale.voided), que hoy no escucha nadie aquí.
Sale: nada.
Si falla: mientras no exista, quien anula tiene que abrir el tique en **Facturas** y rectificarlo con «Devolución» (INVOICE-F08).
Implicados: SALES-F30, VERIFACTU-F14, VERIFACTU-F30, REC_FISCAL-F13
QA: R-11, B-08, qa-hub-restaurant §13
