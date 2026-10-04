# WORKFLOW — Facturación

Prefijo: INVOICE
Alcance MVP: nucleo

> Contrato de comportamiento del módulo (pm#620, pm#621). Se lee antes de tocar el código y se
> actualiza en la misma PR que cambie un comportamiento. El detalle técnico vive en
> `architecture/modules/invoice.md`; aquí se escribe lo que ve y hace la persona.

## Para qué sirve y para quién

Facturación convierte cada venta cobrada en un documento fiscal numerado y lo guarda para siempre:
el tique (factura simplificada) de cada cobro, la factura completa cuando el cliente da su NIF, la
factura completa que sustituye a un tique que ya se llevó el cliente, y la rectificativa cuando se
devuelve dinero o un documento estaba mal. Es el eslabón entre Ventas y VeriFactu en la cadena
fiscal española (venta → factura → registro VeriFactu → AEAT): aquí nace el número de serie que
luego viaja a Hacienda. Lo usan el **empleado** (consulta, reimprime, emite una factura a mano y la
marca pagada), el **responsable** y el **administrador** (además rectifican y llevan las series de
numeración) y, sin nadie delante, el **sistema**, que factura cada cobro y rectifica cada devolución.
El **cliente** que se llevó un tique puede pedir su factura completa él solo, desde el código impreso
en el tique. Sirve igual al restaurante y a la peluquería: no hay nada propio de un vertical.

## Referencia adoptada

Aquí manda la especificación oficial sobre el mercado; lo que se adopta, no más:

- [RD 1619/2012 (Reglamento de facturación)](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696):
  factura completa y simplificada (arts. 6 y 7), sustitución del tique por factura completa, y
  rectificativa con su serie propia y la referencia a la factura que corrige (art. 15). Serie
  correlativa obligatoria, y otra aparte para rectificativas, como recuerda la
  [AEAT](https://sede.agenciatributaria.gob.es/Sede/ayuda/consultas-informaticas/presentacion-declaraciones-ayuda-tecnica/aplicacion-gratuita-verifactu-aeat/emision-facturas.html).
- [AEAT — facturas simplificadas](https://sede.agenciatributaria.gob.es/Sede/ayuda/manuales-videos-folletos/manuales-practicos/manual-iva-2025/capitulo-10-obligac-formales-suj-registro/obligaciones-materia-facturacion/facturas-simplificadas.html)
  y [SIF / VERI*FACTU](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu.html)
  (RD 1007/2023, Orden HAC/1177/2024): tipos F1, F2, F3 y R1–R5, inmutabilidad del documento
  emitido, QR con «QR tributario:» y «VERI*FACTU», «duplicado» en las copias. Contrastadas en
  `.claude/agents/qa-hub-restaurant.md` §2 y en el bloque legal L-01…L-18 de
  `.claude/qa/qa-method-shared.md`.
- Numeración, contrastada en ADR-0369 con Odoo, Business Central, NetSuite, Sage 50, Holded,
  Lightspeed, Toast, Shopify, WooCommerce y Square: el número se asigna en la misma operación que
  guarda el documento, una serie por código y año que vuelve a 1 sola cada 1 de enero, plantilla de
  formato configurable que se congela con el primer número, vista previa del siguiente número sin
  gastarlo, y un libro de números entregados para demostrar que no hay huecos.
- El número fiscal se gasta al **cobrar**, nunca al abrir la cuenta (ADR-0141): la cuenta abierta y la
  precuenta no llevan número de serie.
- Sustitución pedida por el propio cliente desde el tique, como «CREAR FACTURA» de Ágora o
  «QuieroFactura» de Cuiner (ADR-0140, `hub/crates/server/src/public_door.rs`).

## Antes de empezar

- Al instalar Facturación se instalan con él **Ventas** e **Impuestos**. **VeriFactu** no se instala
  solo, pero en España hace falta para que cada factura llegue a la AEAT.
- La **identidad fiscal del negocio** (NIF y razón social) se configura en los ajustes generales del
  hub: es la que sale como emisor en cada factura. Sin ella las facturas se emiten igual, pero
  VeriFactu no puede registrarlas.
- La **zona horaria del negocio** decide la fecha de cada documento y, con ella, el año de su serie.
- Las series se crean solas la primera vez que se usan en el año: «TICKET» (tiques), «FACT»
  (facturas completas y sustitutivas) y «RECT» (rectificativas), con el código como prefijo
  (`TICKET-2026-000001`). La venta numera **siempre** en esas tres: una serie con otro código solo
  sirve para facturas hechas a mano (INVOICE-F12).

Configuración inicial, paso a paso:

1. En **Inicio**, abre la tarea «Tu numeración de facturas»; te lleva a **Facturación → Series**
   (INVOICE-F14).
2. Si quieres otro prefijo o formato, crea **antes de la primera venta del año** las series con los
   códigos `TICKET` (tipo Ticket F2), `FACT` (Factura F1) y `RECT` (Rectificativa R1) para el año en
   curso (INVOICE-F12). Comprueba el «Siguiente número» al editarlas (INVOICE-F13).
3. Haz una venta de prueba y comprueba en **Facturación → Facturas** que aparece su tique con el
   número esperado (INVOICE-F01, INVOICE-F16).
4. Con VeriFactu instalado, abre la factura y comprueba el «Justificante VeriFactu» (INVOICE-F17).

## Pantallas

### Facturas
Menú **Facturación → Facturas**. Tabla paginada de 50 en 50 con «Número», «Cliente», «Total»,
«Estado», «Fecha» y «Tipo»; cada columna se ordena y se filtra (el estado y el tipo se eligen de una
lista ya traducida; el total, entre dos importes en la moneda del hub; la fecha, entre dos días). Buscador
«Buscar facturas…», que busca por número, nombre del cliente y NIF del cliente. Vista de tabla o de
tarjetas (en el móvil, tarjeta con el número como título). Por fila: «Ver» (también al pulsar la
fila), «Marcar pagada» (solo en las que están «Emitida») y «Devolución» (solo en las que no son
rectificativas ni están canceladas). El botón de añadir (+) de la barra abre el panel lateral del
alta manual (INVOICE-F03); sin permiso de emitir no aparece, ni tampoco «Marcar pagada». La lista se
recarga sola cuando se emite o se rectifica una factura. Sin ordenar, sale por el identificador
interno, que no sigue la fecha.
Vacía: «Aún no hay facturas.». Cargando: «Cargando…». Error: el mensaje con su botón de reintentar.
Un rechazo de una acción de fila sale encima de la tabla.

### Ficha de factura
Se abre desde una fila de **Facturas**. Arriba, «Factura {número}» con la etiqueta de estado y los
botones «Imprimir / PDF» y «← Volver». Si es una factura completa sin NIF del cliente, incluida toda rectificativa de un tique (sale R1 sin NIF), el aviso
«Esta factura no tiene el NIF del cliente: la impresora de tiques no puede sacarla como factura
completa.». Si VeriFactu tiene registro de ella, la tarjeta «Justificante VeriFactu» con su estado
(«Aceptada por la AEAT», «Pendiente de envío», «Rechazada por la AEAT», «Error de envío»), el «CSV
de la AEAT», el QR entre «QR tributario:» y «VERI*FACTU», «Escanea para validar la factura en la
AEAT» y el enlace «Validar en la Agencia Tributaria ↗»; con registro y sin QR, «Aún no enviada a la
AEAT.»; sin registro, no hay tarjeta. Debajo, «Tipo», «Serie», «Fecha de emisión», «Cliente», «NIF
cliente», «Dirección», «Emisor», «Origen» («Venta del TPV», «Alta manual», «Sustituye a una factura
simplificada», «Rectificación»…), «Rectifica a» (el número de la original, que la abre), «Pagada el»
y «Notas». Las líneas: «#», «Descripción», «Cant.», «Precio», «IVA %», «Base», «Impuesto», «Total»
(en el móvil, cada línea en bloque); sin líneas, «Sin líneas de detalle.». Los totales «Base»,
«Impuestos» y «Total», y los botones «Marcar pagada» y «Devolución» con la misma regla que en la
fila. Un rechazo sale justo encima de esos botones.
Error al abrir: «Factura no encontrada» o el mensaje del fallo, encima de la tabla de Facturas.

### Devolución (rectificar)
Ventana que abre «Devolución», desde la fila o desde la ficha. Título «Rectificar {número}», la nota
«Se emitirá una rectificativa R1 (serie RECT) con los importes negados y la factura original quedará
cancelada. Esta operación no se puede deshacer.», el campo «Motivo» (obligatorio), «Emitir
rectificativa» («Rectificando…» mientras va) y «Cancelar». Tres finales dentro de la misma ventana:
el rechazo traducido, el documento que no se puede rectificar («Una rectificativa no se puede
rectificar.», «La factura ya está cancelada.») y el resultado «Rectificativa emitida. {número} queda
cancelada.», cada uno con «Cerrar».

### Series
Menú **Facturación → Series** (solo con permiso de llevar las series). La entrada «Cada serie
define el prefijo y el contador…» y una tabla con «Código», «Nombre», «Tipo», «Año», «Prefijo»,
«Formato» (vacío se lee `PREFIX-YYYY-NNNNNN`), «Nº actual», «Activa» y «Predet.»; buscador «Buscar
código, nombre…». Por debajo de 1280 px abre en tarjetas. El botón de añadir (+) abre el panel
«Nueva serie de numeración»; «Editar» (o pulsar la fila) abre «Editar serie {código}» en el mismo
panel (INVOICE-F12, INVOICE-F13). No hay pestaña de Ajustes: el módulo no declara ajustes.
Vacía: «Aún no hay series. Crea la primera para numerar tus facturas.». Cargando: «Cargando
series…». Error: «No se pudieron cargar las series» (o el mensaje del fallo), sin reintento propio.

## Flujos

El detalle de cada flujo (pasos, datos, fallos, implicados y QA) vive en `workflow/`, con la misma
gramática y el mismo prefijo. Huecos (`parcial`, `no hecho`): el porqué está en la línea `Estado:`.

| ID | Flujo | Estado | Fichero |
|---|---|---|---|
| INVOICE-F01 | El tique (factura simplificada) que nace al cobrar | hecho | [workflow/emision.md](workflow/emision.md) |
| INVOICE-F02 | La factura completa al cobrar a un cliente con NIF | hecho | [workflow/emision.md](workflow/emision.md) |
| INVOICE-F03 | Emitir una factura a mano | parcial | [workflow/emision.md](workflow/emision.md) |
| INVOICE-F04 | El cliente pide la factura completa de su tique | hecho | [workflow/emision.md](workflow/emision.md) |
| INVOICE-F05 | Pasar un tique a factura completa desde el mostrador | parcial | [workflow/emision.md](workflow/emision.md) |
| INVOICE-F06 | Una venta cobrada que no se ha podido facturar | parcial | [workflow/emision.md](workflow/emision.md) |
| INVOICE-F07 | Anular una venta cobrada que ya tiene su tique | no hecho | [workflow/emision.md](workflow/emision.md) |
| INVOICE-F08 | Rectificar una factura entera a mano | parcial | [workflow/rectificacion.md](workflow/rectificacion.md) |
| INVOICE-F09 | La rectificativa al devolver una venta entera | parcial | [workflow/rectificacion.md](workflow/rectificacion.md) |
| INVOICE-F10 | La rectificativa por diferencias al devolver parte de una venta | parcial | [workflow/rectificacion.md](workflow/rectificacion.md) |
| INVOICE-F11 | Numerar cada documento en su serie y su año | hecho | [workflow/numeracion.md](workflow/numeracion.md) |
| INVOICE-F12 | Crear una serie de numeración | parcial | [workflow/numeracion.md](workflow/numeracion.md) |
| INVOICE-F13 | Cambiar una serie | parcial | [workflow/numeracion.md](workflow/numeracion.md) |
| INVOICE-F14 | Preparar la numeración desde la tarea de Inicio | parcial | [workflow/numeracion.md](workflow/numeracion.md) |
| INVOICE-F15 | Comprobar que la numeración no tiene huecos | parcial | [workflow/numeracion.md](workflow/numeracion.md) |
| INVOICE-F16 | Buscar una factura | parcial | [workflow/consulta.md](workflow/consulta.md) |
| INVOICE-F17 | Ver una factura y su justificante VeriFactu | parcial | [workflow/consulta.md](workflow/consulta.md) |
| INVOICE-F18 | Imprimir o guardar en PDF una factura | parcial | [workflow/consulta.md](workflow/consulta.md) |
| INVOICE-F19 | Marcar una factura como pagada | parcial | [workflow/consulta.md](workflow/consulta.md) |
| INVOICE-F20 | Dar a otros módulos la factura de una venta | hecho | [workflow/consulta.md](workflow/consulta.md) |

## Qué comparten los verticales

Ningún flujo es propio de un vertical: los veinte son `comun`. Lo que comparten, y por tanto lo que
rompe a los dos si se toca:

| Pieza compartida | Flujos que la usan |
|---|---|
| La reacción al cobro de una venta (una factura por venta, F2 o F1 según se cobró) | INVOICE-F01, INVOICE-F02, INVOICE-F06 |
| La emisión con auditoría de importes y lectura obligatoria de las reglas de impuestos | INVOICE-F01, INVOICE-F02, INVOICE-F03, INVOICE-F04, INVOICE-F05 |
| La cadena de rectificar (fecha del día, serie RECT, desglose congelado, cancelar la original) | INVOICE-F08, INVOICE-F09, INVOICE-F10 |
| El contador por serie y año y el libro de números | INVOICE-F11, INVOICE-F12, INVOICE-F13, INVOICE-F15 |
| Las series «TICKET», «FACT» y «RECT» que se crean solas | INVOICE-F01, INVOICE-F02, INVOICE-F03, INVOICE-F04, INVOICE-F08, INVOICE-F11, INVOICE-F14 |
| La ficha de factura (detalle, justificante, impresión, acciones) | INVOICE-F08, INVOICE-F17, INVOICE-F18, INVOICE-F19 |
| La consulta «la factura de esta venta» | INVOICE-F04, INVOICE-F20 |

## Cobertura contra la referencia

| Elemento de la referencia | Estado | Flujo |
|---|---|---|
| Factura simplificada al cobrar, una por venta | hecho | F01 |
| Factura completa al cobrar con NIF, nombre y domicilio del cliente | hecho (los pide Ventas) | F02 |
| Cliente extranjero declarado por país y tipo de documento | hecho desde la venta y la API; no en el alta manual | F02, F03 |
| Techo de la simplificada (3.000 € en hostelería) | parcial: Ventas lo pide al cobrar; aquí no se mira y VeriFactu la rechaza ya encadenada | F01, F03 |
| Factura hecha a mano | parcial: sin categoría fiscal ni cliente extranjero en el formulario | F03 |
| Sustitutiva F3 pedida por el cliente desde el tique | hecho | F04 |
| Sustitutiva F3 desde el mostrador | parcial: solo asistente o API | F05 |
| Venta cobrada sin factura: no se pierde y se avisa | parcial: el aviso es genérico, y una devolución que llega antes de la factura se pierde | F06, F09 |
| Anular una venta cobrada corrige su documento fiscal | no hecho | F07 |
| Rectificativa entera a mano, con motivo y enlazada | parcial | F08 |
| Rectificativa al devolver la venta entera | hecho; parcial si la venta ya tenía F3 o se devuelve antes de tener factura | F09 |
| Rectificativa por diferencias en la devolución parcial | parcial | F10 |
| Elegir el tipo de rectificativa (R1–R5) y su causa | no hecho: siempre R1 (VeriFactu la baja a R5 sin NIF) | F08 |
| Serie de rectificativas separada | hecho | F11 |
| Numeración correlativa, sin huecos ni duplicados, también con dos cobros a la vez | hecho | F11 |
| Vuelta a 1 cada año sin que nadie lo haga | hecho; pierde el prefijo y el formato del año anterior | F11 |
| Formato del número configurable y congelado con el primer número | hecho | F12, F13 |
| Vista previa del siguiente número | hecho | F13 |
| Serie por TPV o elegir la serie de la venta | no hecho: la venta numera siempre en TICKET o FACT | F12 |
| Continuar la numeración de otro sistema | no hecho | F12, F14 |
| Libro de números y huecos | parcial: sin pantalla | F15 |
| Buscar, filtrar y ver facturas | hecho; orden por defecto sin sentido | F16, F17 |
| Justificante VeriFactu (estado, CSV, QR) en la ficha | hecho | F17 |
| Reimprimir con la marca «duplicado» | no hecho | F18 |
| PDF del documento | parcial: solo por el diálogo del navegador; no para el tique ni dentro de la app | F18 |
| Marcar cobrada | parcial: se ofrece también en documentos ya cobrados | F19 |
| Forma de pago en la factura | fuera: no se guarda (ver «Lo que NO hace») | — |
| Envío de la factura por correo | fuera del MVP | — |
| Libro registro de facturas expedidas exportable (L-15) | fuera del MVP (pm#589) | — |

## Datos: de quién es cada dato

- **Propios**: las facturas (cabecera, desglose de impuestos congelado, estado y fecha de pago), sus
  líneas, las series de numeración y el libro de números entregados. Nadie más escribe en ellos;
  otros módulos los leen por sus consultas públicas (`invoice.by_source`, `invoice.list`,
  `invoice.lines`) y VeriFactu, que es parte de la cadena fiscal, lee la factura por su id.
- **De Ventas**: las líneas, los importes ya cobrados, el tipo de documento (tique o factura) y la
  copia de los datos fiscales del cliente llegan en el aviso de venta cobrada; la venta se lee una vez
  para comprobar que existe. La devolución llega en el aviso de venta devuelta.
- **De Impuestos**: las reglas de impuestos del hub, leídas al emitir para calificar cada línea.
- **Del hub**: la identidad fiscal del negocio (emisor), la zona horaria y el país.
- **De Clientes**: nada directo; el cliente llega copiado dentro de la venta. La factura no guarda la
  ficha del cliente, solo la copia: editar la ficha no cambia una factura emitida.
- **Datos personales** (inventario RGPD, recorrido por las migraciones 001–012):
  - factura: nombre, NIF, dirección, país y tipo de documento del cliente; NIF y nombre del emisor
    (un autónomo es una persona); la descripción, que en una rectificativa es el motivo escrito por
    quien la hizo o el motivo de la devolución; las notas libres del alta manual;
  - líneas: la descripción (texto libre en el alta manual);
  - en facturas, series y libro de números: qué empleado creó y cambió cada fila;
  - copias fuera de Facturación: el aviso de factura emitida lleva solo el id, el tipo y el total; el
    aviso de rectificativa repite lo que recibió el comando más quién lo ejecutó y la identidad del negocio: el motivo, el usuario que rectificó y, si viene de una devolución,
    también quién la hizo y las formas de pago devueltas.
  - Facturación no reacciona al borrado de un cliente: la ley obliga a conservar la factura con sus
    datos (L-10, L-14).

## Reglas que no se rompen

- **Aislamiento**: toda lectura y escritura va con el hub; una factura, una venta o una serie de otro
  hub nunca casa.
- **Una factura emitida no se edita ni se borra.** No hay comando para cambiar sus importes, sus
  datos ni su número; solo cambia su estado al marcarla pagada o al rectificarla entera.
- **Una factura por venta, una sustitutiva por tique, una rectificativa por devolución**: lo impone
  la base de datos; el aviso repetido no gasta número ni crea otro documento.
- **El número se asigna en la misma operación que guarda el documento**, con el contador de la serie
  y el año; si algo falla no se guarda nada y el número no se gasta (en las rectificativas queda el
  caso sin confirmar de la duda 12). Dos documentos de la misma serie
  no pueden llevar el mismo número, y cada número entregado queda apuntado en el libro.
- **Código, año y contador de una serie no se cambian**, y su formato se congela con el primer número.
- **Nada se emite sin cuadrar**: la cuota de cada tipo cruza con su base al céntimo, el total es base
  más cuota, solo una operación sujeta lleva cuota, una F1, F2 o F3 no suma menos de cero, una línea
  con precio no sale a 0,00 y una factura completa hecha a mano lleva el NIF del cliente. El rechazo
  no gasta número.
- **Sin reglas de impuestos (o sin la venta) no se emite**: si el hub no puede leerlas, no se adivina
  la fiscalidad.
- **Una rectificativa lleva la fecha del día del negocio** y se numera en la serie RECT de ese año;
  la puerta manual rechaza otra fecha u otro año. Lo rectificado nunca supera lo que queda de la
  original, y la original solo se cancela cuando queda a cero.
- **Permisos**: ver facturas, todos; emitir a mano y marcar pagada, empleado, responsable y
  administrador; rectificar y llevar las series (también ver su pantalla), responsable y administrador. El servidor lo aplica aunque la
  pantalla enseñe el botón: un empleado que pide rectificar o tocar una serie por otro camino (el
  asistente) solo lo consigue con la aprobación (PIN) de un responsable; una consulta sin permiso se
  rechaza sin más.

## Lo que NO hace, a propósito

- No envía nada a la AEAT ni calcula la huella: eso es VeriFactu, que escucha sus avisos.
- No cobra ni devuelve dinero: «Marcar pagada» no toca la caja, y «Devolución» en Facturación no
  devuelve dinero (la devolución con dinero se hace en Ventas).
- No guarda la forma de pago: vive en la venta.
- No envía facturas por correo ni por WhatsApp.
- No hace presupuestos, proformas ni albaranes, aunque exista el estado «Borrador»: nada lo crea.
- No lleva vencimientos, cobros parciales ni recordatorios de impago.
- No exporta el libro registro de facturas expedidas para la gestoría (fuera del MVP).
- No vigila el techo de la factura simplificada: lo pide Ventas al cobrar; si llega una por encima,
  VeriFactu la encadena y su validador la rechaza antes de enviarla.
- No borra ni anonimiza los datos de un cliente en sus facturas.

## Dudas abiertas

Se resuelven con `market-decision`; no las decide el worker.

1. La factura que nace de una venta ya cobrada sale «Emitida» y ofrece «Marcar pagada». ¿Debe nacer
   «Pagada», como en los TPV del mercado? (INVOICE-F01, INVOICE-F19)
2. Tras sustituir un tique por una F3, la devolución y la rectificación manual siguen apuntando al
   tique. ¿Debe rectificarse la F3? (INVOICE-F05, INVOICE-F08, INVOICE-F09)
3. Anular una venta cobrada deja su tique emitido y declarado. ¿Rectificativa automática del tique o
   registro de anulación en VeriFactu? (INVOICE-F07)
4. ¿Se elige el tipo de rectificativa (R1–R4) y su causa, o basta R1 con la bajada a R5 de VeriFactu?
5. ¿Serie por TPV y serie elegible para la venta, como recomienda el sector? Hoy la venta numera
   siempre en TICKET o FACT. (INVOICE-F12)
6. ¿Se puede empezar una serie en un número para continuar la de otro sistema, como pide la tarea de
   Inicio? (INVOICE-F12, INVOICE-F14)
7. Al empezar el año, ¿la serie nueva hereda el prefijo y el formato del año anterior? (INVOICE-F11)
8. «Activa» y «Serie predeterminada» no cambian lo que se emite. ¿Deben gobernar la emisión o
   desaparecer? (INVOICE-F13)
9. ¿Puede el empleado emitir facturas a mano y marcarlas pagadas, o solo el responsable?
10. El rótulo «Devolución» de Facturación rectifica sin devolver dinero. ¿«Rectificar», y la
    devolución solo desde Ventas? (INVOICE-F08)
11. ¿Necesita la venta que no se pudo facturar un aviso propio que diga qué venta es? (INVOICE-F06)
12. Deducido del código, sin test: dos rectificaciones simultáneas de la misma factura (dos puestos
    pulsando «Devolución» a la vez) podrían subir las dos el contador de la serie RECT, porque la
    comprobación del contador mira una foto anterior a la otra rectificativa, y la segunda no llega a
    emitirse: un número gastado sin documento ni fila en el libro. Hace falta un test con dos
    transacciones antes de decidir si se cierra con un bloqueo o un índice. (INVOICE-F08, INVOICE-F11)

## Fuentes contrastadas

Contra `origin/main` v1.2.74 (05/10/2026), `hub` `origin/develop` y `sales` `origin/main`
v2.16.154. Una línea por discrepancia; manda el código.

- **`docs/overview.md`** dice que solo escucha la venta cobrada; escucha también la venta devuelta (F09, F10).
- **`docs/concepts.md`, `docs/limits.md` y `README.md`**: «toda venta sale F2, el tipo de documento no viaja»; viaja, y la venta cobrada como factura sale F1 en FACT (F02).
- **`docs/screens.md`** (rectificar): «la original se marca cancelada»; tras una devolución parcial no se emite nada (F08).
- **`docs/limits.md`**: «rectificar dos veces a mano lleva a la rectificativa que ya existe»; responde bien sin emitir nada y la ventana dice «Rectificativa emitida» (F08).
- **`docs/screens.md`** (alta manual): rellenar el emisor y elegir el producto; el formulario no tiene ni emisor (sale de la identidad del hub) ni producto (F03).
- **`docs/overview.md`**: «no imprime documentos»; la ficha imprime (F18).
- **`docs/concepts.md`**: el estado sube de «Borrador» a «Emitida»; nada crea borradores.
- **`architecture/modules/invoice.md`**: «Depende de: —»; depende de Impuestos y Ventas.
- **`architecture/modules/invoice.md`**: la devolución parcial no emite y la rectificativa no lleva líneas; desde invoice#59 y #63 sí (F08, F09, F10).
- **`architecture/modules/invoice.md`**: tolerancia de «un céntimo por línea»; es un céntimo fijo por tipo, salvo la copia literal de una F3.
- **`architecture/modules/invoice.md`**: la caja de búsqueda dice «Buscar número, cliente o NIF…»; dice «Buscar facturas…» (F16).
- **`architecture/modules/invoice.md`** y `docs/limits.md`: «la sustitución no tiene botón»; cierto en Facturación, pero el cliente la pide desde el tique (F04).
- **`hand-book/modulos/invoice.md`**: la pestaña se llama «Configuración», la acción «Rectificar» y «Marcar como pagada», y se rellena el emisor y la «fiscalidad» de la línea; en pantalla son «Series», «Devolución» y «Marcar pagada», sin emisor y con solo «IVA %».
- **Tarea de Inicio** (`module.json` `setup`, `locales/es.json`): «continúa su numeración en vez de empezar otra vez por el 1»; ninguna serie puede empezar en otro número (F12, F14).
- **`locales/es.json` `ui.seriesIntro`**: solo se editan nombre, prefijo, activa y predeterminada; el formato también, hasta el primer número (F13).
- **Texto en inglés en pantalla española**: las series que se crean solas se llaman «POS Tickets», «Complete Invoices» y «Rectifying Invoices» (Series y selector del alta manual), y la línea de la rectificativa por diferencias dice «Refund {id}» en el papel del cliente (F10, F11).
- **QA L-05**: la reimpresión lleva «duplicado»; la de Facturación no lo lleva (F18).
- **`qa-hub` §7**: «una factura emitida por error se anula con registro de anulación»; Facturación no tiene esa acción (es de VeriFactu) y «Serie correcta (`invoice_series`)» habla de un módulo archivado.
- **`qa-hub-restaurant` §11**: la factura lleva la forma de pago; no se guarda (F17, F18).
- **BD-09**: «sustitución tiquet→factura» en el cobro con rol de cajero; el cajero no tiene botón, solo el cliente desde el tique o el asistente (F05).
