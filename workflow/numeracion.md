# WORKFLOW — Facturación · Series y numeración

Prefijo: INVOICE

## Flujos

### INVOICE-F11 Numerar cada documento en su serie y su año
Estado: hecho
Vertical: comun
Actor: sistema
Pantalla: ninguna
Pasos:
1. Cada vez que se emite un documento (tique, factura, sustitutiva o rectificativa), Facturación toma la serie de su código y del año del día del negocio; si no existe, la crea en ese momento con el contador a 0 y el código como prefijo.
2. Sube el contador de esa serie en uno y escribe el número con el formato de la serie (sin formato, `TICKET-2026-000001`) en la misma operación que guarda el documento.
3. Apunta el número entregado en el libro de numeración, con la serie, el año y el documento.
4. El 1 de enero, a la hora del negocio, el siguiente documento abre la serie del año nuevo y vuelve a 1.
Entra: el código de serie que toca (TICKET para los tiques, FACT para las facturas completas y las sustitutivas, RECT para las rectificativas; en el alta manual, la serie elegida) y la hora y la zona del negocio.
Sale: el número del documento y su fila en el libro. El número entra en la huella encadenada de VeriFactu.
Si falla: si la emisión se rechaza o falla, no se guarda nada y el contador no sube: no queda hueco. Dos cobros a la vez en la misma serie esperan uno al otro y reciben números seguidos; dos documentos de la misma serie no pueden llevar el mismo número. La serie del año nuevo nace con el código como prefijo y sin formato, aunque la del año anterior tuviera otros: hay que crearla antes (INVOICE-F12). Si la serie del año siguiente se crea con un formato sin año igual al del anterior, sus primeros números coinciden con los ya emitidos y la emisión se rechaza (deducido del código, no probado). Sin confirmar: dos rectificaciones simultáneas de la misma factura podrían gastar un número de la serie RECT sin documento detrás, un hueco que vería INVOICE-F15 (deducido del código, sin test).
Implicados: VERIFACTU-F13, REC_FISCAL-F02
QA: L-06, BD-09, qa-hub-restaurant §11

### INVOICE-F12 Crear una serie de numeración
Estado: parcial — no se puede empezar en otro número que el 1 (continuar la numeración de otro sistema); la venta solo numera en las series con código TICKET, FACT y RECT, así que una serie con otro código solo sirve en el alta manual, y ahí emite tiques (F2) aunque se cree como Factura; la pantalla no dice que es el código el que decide qué serie se usa
Vertical: comun
Actor: responsable, administrador
Pantalla: Series
Pasos:
1. En **Facturación → Series**, pulsa el botón de añadir (+): se abre «Nueva serie de numeración».
2. Escribe «Código», «Nombre», «Tipo de factura» (de F1 a R5), «Año» (de entrada, el del dispositivo), «Prefijo» y, si quieres, «Formato del número» (marcadores {prefix}, {code}, {year}, {seq} y {seq:01d}…{seq:09d}; vacío es `PREFIX-YYYY-NNNNNN`). Elige «Activa» y «Serie predeterminada».
3. Pulsa «Crear serie».
4. El panel se cierra y la serie aparece en la tabla con «Nº actual» 0. Para que la usen las ventas y las devoluciones, el código tiene que ser TICKET, FACT o RECT y el año, el que está en curso.
Entra: lo que escribe la persona.
Sale: la serie, con el contador a 0; si se marcó predeterminada, la que lo era ese año deja de serlo.
Si falla: sin código, «El código es obligatorio.». Un «Prefijo» vacío no toma el código: la serie queda sin prefijo y, sin formato, numera `-2026-000001`. Un formato sin marcador de secuencia, o un código que ya existe ese año, se rechaza dentro del panel, encima de «Crear serie» (el texto lo pone el hub, sin confirmar).
Implicados: ninguno
QA: BD-02

### INVOICE-F13 Cambiar una serie
Estado: parcial — «Activa» y «Serie predeterminada» no cambian lo que se emite (una serie inactiva sigue numerando las ventas; solo desaparece del selector del alta manual); el prefijo sí se puede cambiar con la serie ya usada, y con él cambia la forma de los números siguientes, que es lo que el bloqueo del formato quiere evitar
Vertical: comun
Actor: responsable, administrador
Pantalla: Series
Pasos:
1. En **Series**, pulsa «Editar» en la fila (o la fila entera): se abre «Editar serie {código}».
2. Cambia «Nombre», «Prefijo», «Activa», «Serie predeterminada» y, mientras la serie no haya emitido nada, «Formato del número». «Código», «Tipo de factura» y «Año» están bloqueados.
3. Mira «Siguiente número»: es exactamente el número que llevará el próximo documento, calculado por el servidor sin gastarlo.
4. Pulsa «Guardar»; el panel se cierra y la tabla se refresca.
Entra: la serie elegida y los cambios.
Sale: la serie cambiada; los números ya emitidos no cambian. Vaciar el «Prefijo» deja la serie sin prefijo (sin formato, `-2026-000001`). Marcarla predeterminada quita la marca a la del mismo año.
Si falla: con la serie ya usada, el formato está bloqueado y lo dice «Esta serie ya ha emitido facturas, así que su formato de número ya no se puede cambiar…». Un rechazo sale encima de «Guardar».
Implicados: ninguno
QA: BD-02

### INVOICE-F14 Preparar la numeración desde la tarea de Inicio
Estado: parcial — la tarea pide continuar la numeración de otro sistema, que no se puede hacer; se da por hecha con cualquier serie de rectificativas del año aunque su código no sea RECT, que es la única que usan las rectificativas; y no explica que son los códigos TICKET, FACT y RECT los que numeran
Vertical: comun
Actor: responsable, administrador
Pantalla: Series
Pasos:
1. En **Inicio**, la tarea obligatoria «Tu numeración de facturas» sigue pendiente hasta que el año en curso tenga una serie ordinaria (F1, F2 o F3) y otra de rectificativas (R1 a R5).
2. Al abrirla, lleva a **Facturación → Series**.
3. Revisa el prefijo de las series y crea la de rectificativas del año (INVOICE-F12).
4. La tarea queda hecha. La primera venta del año crea sola la serie de tiques; la de rectificativas nace con la primera rectificativa (una devolución o una rectificación a mano), nunca con una venta.
Entra: las series del año del negocio.
Sale: el estado de la tarea en Inicio.
Si falla: si se da por hecha con una serie de otro código, las ventas y las rectificativas siguen numerando en TICKET, FACT y RECT con su prefijo de fábrica.
Implicados: HUB-F35, HUB_SHELL-F31
QA: BD-02

### INVOICE-F15 Comprobar que la numeración no tiene huecos
Estado: parcial — no tiene pantalla: solo con el asistente o la API
Vertical: comun
Actor: empleado, responsable, administrador, asistente
Pantalla: asistente
Pasos:
1. Pide al asistente si la numeración tiene huecos, o el libro de números de una serie.
2. Sin huecos, la respuesta es que no falta ninguno; con huecos, dice la serie, el año, el último número que sí está y cuántos faltan seguidos.
3. El libro dice qué número se dio a qué documento y cuándo.
Entra: el libro de números del hub.
Sale: nada; solo se lee.
Si falla: el libro empieza el día en que el módulo se actualizó a la versión que lo trajo: los números anteriores no están y no cuentan como hueco.
Implicados: ninguno
QA: L-06
