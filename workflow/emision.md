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
2. En cuanto la venta queda cobrada, Facturación emite sola su factura simplificada (F2) en la serie «TICKET» del año, fechada el día del negocio, con las líneas y los importes que cobró la venta (no se recalculan) y el cliente si la venta tenía uno asignado.
3. La factura aparece en **Facturación → Facturas** como «Ticket», «Emitida», con «Origen» «Venta del TPV»; puede tardar un instante después del cobro.
4. Se comprueba abriéndola: las líneas, la «Base», los «Impuestos» y el «Total» son los del tique de Ventas.
Entra: la venta cobrada de Ventas (sale.completed): sus líneas con base y cuota ya calculadas, si los precios llevaban el IVA dentro, el tipo de documento y la copia de los datos del cliente; las reglas de impuestos de Impuestos; la identidad fiscal, el país y la zona horaria del hub.
Sale: la factura F2 con su número, sus líneas, el desglose por tipo de impuesto y su número apuntado en el libro (avisa: invoice.created); VeriFactu crea su registro y Ventas pone el número en su tique.
Si falla: el mismo aviso repetido no crea otra factura ni gasta número. Si el hub no puede leer las reglas de impuestos o la venta, o los importes no cuadran (cuota que no corresponde a su tipo, cuota en una línea exenta, total negativo), no se escribe nada y el hub lo reintenta (INVOICE-F06). Si la venta ya no existe, no se emite. El techo de la simplificada no se mira aquí: una de más de 3.000 € la rechaza VeriFactu al registrarla.
Implicados: pendiente
Pendiente de enlazar: sales — cobrar una venta como tique y avisar de que está cobrada
Pendiente de enlazar: taxes — dar las reglas que califican cada línea (sujeta, exenta, recargo de equivalencia)
Pendiente de enlazar: verifactu — registrar en la cadena la factura emitida
Pendiente de enlazar: REC_FISCAL — de la venta cobrada al registro aceptado por la AEAT
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
Implicados: pendiente
Pendiente de enlazar: sales — cobrar una venta como factura completa con los datos del cliente
Pendiente de enlazar: customers — dar los datos fiscales del cliente que se asigna a la venta
Pendiente de enlazar: verifactu — registrar la factura completa con su destinatario, o bajarla a simplificada si no tiene NIF
Pendiente de enlazar: REC_FISCAL — de la venta cobrada al registro aceptado por la AEAT
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
Entra: lo que escribe la persona; la identidad fiscal del hub como emisor (el formulario no tiene campos de emisor); las reglas de Impuestos.
Sale: la factura (F1 en la serie FACT, F2 en TICKET) con el IVA calculado encima del precio y cerrado una vez por tipo, y su número en el libro (avisa: invoice.created); VeriFactu la registra.
Si falla: el motivo sale dentro del panel, encima de «Emitir factura»: «Línea {line}: el precio no es un importe…», el precio que «se puede leer de dos maneras», «Línea {line}: un precio no puede ser negativo…», «Una factura completa (F1) necesita el NIF del cliente…», una línea que sale a 0,00, o importes que no cuadran. No se emite nada ni se gasta número, y lo escrito se conserva. Una simplificada de más de 3.000 € sí se emite y luego VeriFactu la rechaza.
Implicados: pendiente
Pendiente de enlazar: taxes — dar el tipo y la calificación de las líneas que llevan categoría fiscal
Pendiente de enlazar: verifactu — emitir una factura de prueba desde VeriFactu con este mismo alta
Pendiente de enlazar: verifactu — registrar en la cadena la factura emitida
QA: BD-09

### INVOICE-F04 El cliente pide la factura completa de su tique
Estado: hecho
Vertical: comun
Actor: cliente
Pantalla: Hub: página pública para pedir la factura
Pasos:
1. El tique que imprime Ventas lleva, junto al QR de VeriFactu, un segundo QR con un localizador para pedir la factura (el texto exacto del tique es de Ventas, sin confirmar aquí).
2. El cliente lo abre en su móvil, sin iniciar sesión, y escribe sus datos fiscales: NIF, nombre, dirección y, si es de fuera, su país y su tipo de documento (elegidos de una lista).
3. Envía el formulario.
4. Facturación emite una factura completa sustitutiva (F3) en la serie «FACT», con las líneas y los importes del tique copiados al céntimo y enlazada a él; el tique no se toca. En **Facturas** sale como «Factura», con «Origen» «Sustituye a una factura simplificada».
Entra: el tique (F2) y sus líneas, que Ventas deja sellados en el localizador; los datos fiscales que escribe el cliente.
Sale: la F3 (avisa: invoice.created); VeriFactu la declara indicando el tique al que sustituye. El localizador sirve una sola vez.
Si falla: sin NIF o sin nombre se rechaza. Un segundo intento sobre el mismo tique no emite otra F3 ni gasta número: hay una sustitutiva por tique. Si Facturación no está instalada o el tique no tiene líneas, el tique sale sin ese QR.
Implicados: pendiente
Pendiente de enlazar: sales — imprimir en el tique el localizador para pedir la factura completa
Pendiente de enlazar: hub — la página pública donde el cliente escribe sus datos y canjea el localizador
Pendiente de enlazar: verifactu — declarar la sustitutiva con el tique al que sustituye
QA: L-02, BD-09

### INVOICE-F05 Pasar un tique a factura completa desde el mostrador
Estado: parcial — no hay botón ni en Facturas ni en la ficha del tique: solo con el asistente o la API, que tienen que mandar también las líneas del tique; no se comprueba que el documento sustituido exista ni que sea un tique; la ficha del tique no dice que se sustituyó
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
Implicados: pendiente
Pendiente de enlazar: verifactu — declarar la sustitutiva con el tique al que sustituye
QA: L-02, BD-09 (discrepa)

### INVOICE-F06 Una venta cobrada que no se ha podido facturar
Estado: parcial — el único aviso es genérico («Eventos caídos», sin decir que es una venta sin factura ni cuál) y Facturación no enseña nada; tras los reintentos espera a que alguien lo reenvíe a mano
Vertical: comun
Actor: sistema, administrador
Pantalla: Hub: Sistema, pestaña «Eventos caídos»
Pasos:
1. Una venta queda cobrada y Facturación no puede emitir su factura: el hub no puede leer las reglas de impuestos o la venta, los importes no cuadran, o una regla cobra cuota en una línea exenta.
2. La venta no se pierde: su aviso queda guardado y el hub lo reintenta, cada vez más espaciado (unos minutos en total), hasta 8 veces; un intento fallido no escribe nada ni gasta número.
3. Si sigue fallando, pasa a «Eventos caídos» y la campana de «Notificaciones» dice cuántos hay.
4. Quien arregla la causa (por ejemplo, la regla de impuestos) lo reenvía desde la pestaña «Eventos caídos» de Sistema, uno a uno o con «Reenviar todos», y la factura se emite.
Entra: el aviso de la venta cobrada que no se pudo facturar.
Sale: nada mientras falle. Al reenviarse con éxito, lo de INVOICE-F01 o INVOICE-F02, fechado el día en que por fin se emite, no el del cobro.
Si falla: descartar el evento caído deja la venta sin factura para siempre; el hub pide confirmarlo. Mientras no hay factura, el tique de Ventas sale sin número de factura.
Implicados: pendiente
Pendiente de enlazar: hub — la pestaña «Eventos caídos» de Sistema y la campana de Notificaciones
Pendiente de enlazar: sales — el tique que espera el número de su factura y sale sin él si no llega
Pendiente de enlazar: REC_FISCAL — todo tique con QR tiene que llegar a la AEAT
QA: BD-09, qa-hub-restaurant §11

### INVOICE-F07 Anular una venta cobrada que ya tiene su tique
Estado: no hecho — al anular en Ventas una venta cobrada como tique, su factura simplificada sigue «Emitida» y declarada a la AEAT y nadie emite su rectificativa: Facturación no escucha la anulación
Vertical: comun
Actor: sistema
Pantalla: ninguna
Pasos:
1. Alguien anula en Ventas una venta cobrada como tique, con su motivo (Ventas no deja anular una venta cobrada como factura ni una que ya tiene devoluciones).
2. Hoy, en Facturación no pasa nada: el tique sigue en la lista como «Emitida».
3. Lo que falta, sin decidir todavía (ver «Dudas abiertas» 3 del índice): que el documento fiscal quede corregido solo, como en una devolución.
Entra: la anulación de la venta (sale.voided), que hoy no escucha nadie aquí.
Sale: nada.
Si falla: mientras no exista, quien anula tiene que abrir el tique en **Facturas** y rectificarlo con «Devolución» (INVOICE-F08).
Implicados: pendiente
Pendiente de enlazar: sales — anular una venta cobrada y avisar de la anulación
Pendiente de enlazar: verifactu — anular o rectificar el registro del tique de una venta anulada
Pendiente de enlazar: REC_FISCAL — de la venta cobrada al registro aceptado por la AEAT
QA: R-11, B-08, qa-hub-restaurant §13
