// Didactic help for every box: what it shows, how to read it, what to do with it.
// Each entry is opened by the ⓘ button in the corner of its box.

export const INFO = {
  cube3d: {
    title: "El cubo en 3D",
    html: `
      <p>Es un gemelo de tu cubo. Siempre muestra el estado en el que <b>debería</b> estar el tuyo
      justo antes del paso actual, y luego anima el giro que te toca hacer.</p>
      <h4>Cómo leerlo</h4>
      <ul>
        <li>La animación va a la velocidad que marques abajo a la derecha.</li>
        <li>Si el cubo de la pantalla y el tuyo dejan de coincidir, te has perdido un giro:
        usa «Me he perdido» para volver a escanear y recalcular el camino.</li>
      </ul>
      <h4>Qué puedes hacer</h4>
      <ul>
        <li><b>Arrastra</b> con el ratón o el dedo para girar la vista. Esto no mueve el cubo,
        solo la cámara: es para mirar por detrás.</li>
        <li><b>Rueda o pellizco</b> para acercar y alejar.</li>
        <li><b>↻</b> repite la animación del paso. <b>⌂</b> vuelve a la vista inicial.</li>
      </ul>
      <p class="hint">Consejo: coloca tu cubo en la misma posición que el de la pantalla, con los
      mismos colores arriba y de frente, y no lo gires entero durante la resolución.</p>`,
  },

  step: {
    title: "La ficha del paso",
    html: `
      <p>Cada paso es <b>una arista del grafo</b>: un giro suelto, o un algoritmo entero cuando la
      fase trabaja con algoritmos. Tú lo haces en tu cubo y lo confirmas.</p>
      <h4>La notación</h4>
      <ul>
        <li><b>R</b>, <b>L</b>, <b>U</b>, <b>D</b>, <b>F</b>, <b>B</b>: caras derecha, izquierda,
        arriba, abajo, delante y detrás.</li>
        <li>Sin símbolo: un cuarto de vuelta <b>en sentido horario</b>, mirando esa cara de frente.</li>
        <li><b>'</b> (prima): un cuarto en sentido antihorario. <b>2</b>: media vuelta.</li>
      </ul>
      <h4>Qué puedes hacer</h4>
      <ul>
        <li><b>Hecho ✓</b> cuando ya lo has girado en tu cubo. También vale la tecla → o Intro.</li>
        <li><b>‹ Atrás</b> para volver al paso anterior (tecla ←). Deshaz también el giro en tu cubo.</li>
        <li>Pulsa <b>un giro concreto</b> de la secuencia para repetir la animación desde ahí.</li>
      </ul>`,
  },

  sticker: {
    title: "Grafo de pegatinas",
    html: `
      <p>Aquí el cubo se dibuja como un grafo: cada uno de los <b>54 adhesivos es un vértice</b>,
      y las líneas grises son los caminos por los que los adhesivos se mueven cuando giras una cara.</p>
      <h4>Cómo leerlo</h4>
      <ul>
        <li>Los 9 puntos que forman un grupo son una cara. Las tres caras que ves de frente en tu
        cubo quedan en el centro, y las tres ocultas se reparten por el borde.</li>
        <li>Cada giro mueve <b>12 adhesivos por un anillo exterior</b> y rota los <b>8 de la propia
        cara</b>. En matemáticas, esos anillos son los ciclos de una permutación.</li>
        <li>Durante la animación se ilumina el anillo del giro y verás a los puntos deslizarse por él
        tres posiciones (seis si es media vuelta, y al revés si el giro es prima).</li>
      </ul>
      <h4>Para qué sirve</h4>
      <p>Para ver de un vistazo <b>cuánto desordena un giro</b>: toca 20 adhesivos a la vez, y por eso
      resolver el cubo a base de intuición es tan difícil. Cuando el cubo esté resuelto, cada grupo
      tendrá los nueve puntos del mismo color.</p>
      <p class="hint">En el ordenador, al dejar el ratón sobre un punto te dice qué adhesivo es,
      por ejemplo U6.</p>`,
  },

  neighbors: {
    title: "Vecinos de tu vértice",
    html: `
      <p>El punto azul del centro eres tú: la posición actual de tu cubo. Cada línea es
      <b>un movimiento posible</b>, y lleva a un vértice vecino.</p>
      <h4>Los números</h4>
      <ul>
        <li>En el <b>modo aprendizaje</b> es la <b>distancia exacta</b> a la meta de esta fase,
        calculada de antemano con BFS. El número del centro es a la que estás tú.</li>
        <li>En el <b>modo rápido</b> es una <b>cota inferior</b>: un número que nunca es mayor que la
        distancia real. Sirve para descartar caminos sin explorarlos.</li>
      </ul>
      <h4>Los colores</h4>
      <ul>
        <li><span style="color:var(--good)">Verde</span>: ese movimiento te acerca a la meta.</li>
        <li>Gris: te deja igual de lejos. <span style="color:var(--bad)">Rojo</span>: te aleja.</li>
        <li><span style="color:var(--accent)">Azul grueso</span>: la arista que hemos elegido.</li>
        <li>Línea discontinua (solo en la fase 2 del modo rápido): ese movimiento te sacaría del
        subgrupo en el que ya estás, así que no se usa.</li>
      </ul>
      <h4>Un detalle que sorprende</h4>
      <p>En el modo rápido, a veces la arista elegida <b>no es la que baja más el número</b>. Es
      normal: ahí el número es solo una estimación por abajo, y el buscador ya ha explorado el camino
      completo, así que sabe algo que la estimación no ve.</p>`,
  },

  levels: {
    title: "Capas del grafo",
    html: `
      <p>Agrupa todos los vértices del grafo de esta fase según <b>su distancia a la meta</b>.
      La barra 0 es la meta, la barra 1 son las posiciones que se resuelven con un movimiento, y así.</p>
      <h4>Cómo leerlo</h4>
      <ul>
        <li>La altura es <b>cuántos vértices</b> hay a esa distancia, en escala logarítmica: cada
        marca de la izquierda multiplica por diez.</li>
        <li>La barra azul marcada con «tú» es dónde estás ahora. Con cada paso te desplazas una
        barra hacia la izquierda.</li>
        <li>En el ordenador, al dejar el ratón sobre una barra te dice el número exacto.</li>
      </ul>
      <h4>Lo interesante</h4>
      <p>Casi todos los vértices se acumulan en las barras más altas, y muy pocos están cerca de la
      meta. Por eso <b>mezclar es fácil y resolver es difícil</b>: si giras al azar, casi seguro que
      acabas lejos. En el modo rápido, esta gráfica es la base de datos de patrones: un grafo
      reducido que se recorrió entero con BFS para poder estimar distancias en el grande, que es
      demasiado enorme para recorrerlo.</p>`,
  },

  path: {
    title: "Tu camino",
    html: `
      <p>Es el recorrido completo desde tu cubo mezclado hasta el resuelto, paso a paso de izquierda
      a derecha. El punto azul es dónde estás.</p>
      <h4>Cómo leerlo</h4>
      <ul>
        <li>La altura es <b>lo que te falta</b>. Cuando llega abajo del todo, has terminado.</li>
        <li>La parte azul es lo recorrido, la gris lo que queda.</li>
        <li>Las líneas verticales de puntos separan las fases. En el modo aprendizaje verás que la
        altura <b>sube de golpe</b> al empezar una fase nueva: no es que vayas peor, es que empieza
        otro grafo distinto y la cuenta se reinicia.</li>
        <li>En el modo rápido, la línea discontinua es la cota inferior, siempre por debajo de lo
        que falta de verdad.</li>
      </ul>`,
  },

  tutor: {
    title: "El tutor",
    html: `
      <p>Un modelo de lenguaje que recibe el contexto del paso en el que estás (la fase, el
      movimiento, las distancias y los vecinos) y responde a lo que le preguntes.</p>
      <h4>El punto de color</h4>
      <ul>
        <li><span style="color:var(--good)">Verde</span>: el modelo responde. Al lado verás cuál es
        y lo que tardó en contestar a la comprobación.</li>
        <li><span style="color:var(--bad)">Rojo</span>: no está disponible, y el texto dice por qué.
        <b>Pulsa el punto</b> para volver a comprobarlo.</li>
        <li>Gris: no hay ningún modelo configurado en este despliegue.</li>
      </ul>
      <h4>Qué preguntarle</h4>
      <ul>
        <li>«¿Por qué este giro y no otro?»</li>
        <li>«¿Qué es el subgrupo H?»</li>
        <li>«No encuentro la pieza que dices, ¿cómo la reconozco?»</li>
      </ul>
      <p class="hint">Ojo: el tutor puede equivocarse. Los movimientos que te da la aplicación están
      calculados y comprobados; las explicaciones del tutor no. Si algo no cuadra, hazle caso a la
      ficha del paso.</p>`,
  },

  capture: {
    title: "Cómo se lee tu cubo",
    html: `
      <p>Con la cámara, el cubo se lee <b>cara a cara</b>: seis pasos, cada uno con una cara de
      frente. Es mucho más fiable que intentar leer tres caras a la vez desde una esquina, que es
      como empezó y no funcionaba con cubos reales.</p>
      <h4>Cómo funciona cada paso</h4>
      <ul>
        <li>Enseña la cara <b>de frente</b>, llenando buena parte de la imagen. La aplicación
        busca las 9 pegatinas, las marca con su color y <b>pasa sola</b> a la siguiente cara.</li>
        <li>Cada pegatina se da por buena cuando se lee varias veces igual, así que un fotograma
        movido no cuenta.</li>
        <li>Si te adelantas y aún no has girado el cubo, te avisa: no guarda dos veces la misma cara.</li>
        <li>Si una pegatina se resiste (un reflejo encima), mueve un poco el cubo. Pasados unos
        segundos la lee igualmente del sitio donde la cuadrícula dice que está.</li>
      </ul>
      <h4>El orden de las caras</h4>
      <ul>
        <li>Primero las cuatro laterales, girando <b>siempre en el mismo sentido</b> y manteniendo
        arriba la misma cara. Luego arriba y abajo, inclinando el cubo.</li>
        <li>Ese orden es el que hace que cada cara caiga en su sitio del cubo sin preguntarte nada.</li>
      </ul>
      <h4>Si una cara no hay manera</h4>
      <p><b>Ajustar a mano</b> congela la imagen y colocas las 4 esquinas de la cara; los círculos
      te enseñan el color que lee cada pegatina. A los 18 segundos te lleva ahí solo.</p>
      <p class="hint">Subiendo fotos en vez de usar la cámara, se siguen pidiendo dos fotos con una
      esquina apuntando a la cámara, con el mismo ajuste manual si hace falta.</p>`,
  },

  review: {
    title: "Revisar los colores",
    html: `
      <p>El cubo desplegado, como si lo abrieras en una cruz. Arriba la cara de arriba, en el centro
      la de delante, y la de la derecha del todo es la de detrás.</p>
      <h4>Cómo corregir</h4>
      <ul>
        <li>Elige un color en la paleta y pulsa la pegatina que esté mal.</li>
        <li>El número de cada color de la paleta cuenta cuántas veces aparece: <b>tienen que ser
        nueve</b> de cada uno. Si sale en rojo, falta o sobra alguno.</li>
        <li>Los centros no se pueden mover en un cubo real: son los que definen el color de cada cara.</li>
      </ul>
      <h4>Si dice que el cubo es imposible</h4>
      <p>Comprobamos que sea un cubo que se puede alcanzar girando caras (piezas sin repetir,
      orientaciones y paridad correctas). Si el mensaje aparece, casi siempre es un color mal leído,
      no un cubo roto. El mensaje te dice qué pieza mirar. También puede fallar la orientación de la
      segunda foto: para eso está el botón que prueba otra.</p>`,
  },

  mode: {
    title: "¿Qué modo elijo?",
    html: `
      <h4>Aprender, por capas</h4>
      <p>El método clásico de principiante, en 7 fases: cruz de abajo, esquinas de abajo, segunda
      capa y los cuatro pasos de la última capa. Usa unos 100 a 140 giros, pero <b>los algoritmos se
      repiten</b> y se acaban memorizando. Cada fase es un grafo pequeño con distancias exactas, así
      que verás siempre cuánto te falta de verdad.</p>
      <h4>Rápido, Kociemba en dos fases</h4>
      <p>Unos 20 o 22 giros, casi el mínimo posible (ningún cubo necesita más de 20). No enseña a
      resolver, porque los movimientos no siguen un patrón que se pueda recordar, pero es el camino
      más corto y se ve muy bien cómo funciona una búsqueda con cotas inferiores.</p>
      <h4>El color de la primera capa</h4>
      <p>Solo en el modo aprendizaje: elige por qué cara empiezas. Lo habitual es el blanco. La
      aplicación te dirá cómo sujetar el cubo antes de empezar.</p>`,
  },
};

// Technical facts for the tooltip: live numbers about what each box is doing.
// `ctx` is filled in by app.js with the current plan, step and metadata.
export function techLines(key, ctx) {
  const { meta, plan, step, stage, mode, tutor } = ctx;
  const n = (v) => (v === undefined || v === null ? "—" : Number(v).toLocaleString("es"));
  switch (key) {
    case "cube3d":
      return [
        ["Motor", "three.js r169 (WebGL)"],
        ["Escena", "27 cubies · 54 pegatinas independientes"],
        ["Animación", "giro de 90° sobre el eje de la cara; al acabar, los cubies vuelven a su sitio y se repinta el estado"],
        ["Estado", "cadena de 54 letras (caras U R F D L B); cada giro es una permutación de esas 54 posiciones"],
      ];
    case "step":
      return [
        ["Paso", plan ? `${(ctx.index ?? 0) + 1} de ${plan.steps.length}` : "—"],
        ["Arista", step ? `${step.label} (${step.moves.length} ${step.moves.length === 1 ? "giro" : "giros"})` : "—"],
        ["Secuencia", step ? step.moves.join(" ") : "—"],
        ["Distancia", step ? `${step.d_before} → ${step.d_after}` : "—"],
        ["Total del camino", plan ? `${plan.steps.length} aristas · ${plan.move_count} giros` : "—"],
      ];
    case "sticker":
      return [
        ["Vértices", "54 (un adhesivo cada uno)"],
        ["Ciclos por giro", "un anillo de 12 adhesivos (avanza 3) y un ciclo de 8 en la propia cara (avanza 2)"],
        ["Proyección", "azimutal equivalente en área, centrada en la esquina que apunta a la cámara"],
        ["Giro actual", step ? step.moves.join(" ") : "—"],
        ["En términos de grupos", "grafo de Schreier de la acción del grupo del cubo sobre los 54 adhesivos"],
      ];
    case "neighbors":
      if (mode === "learn") {
        return [
          ["Fase", stage ? stage.title : "—"],
          ["Aristas por vértice", stage ? n(stage.edges_per_vertex) : "—"],
          ["Vértices de la fase", stage ? n(stage.vertices) : "—"],
          ["Números", "distancia exacta a la meta, precalculada con BFS desde la meta recorriendo las aristas al revés"],
          ["Tu distancia", step ? step.d_before : "—"],
          ["Aristas que acercan", step ? step.neighbors.filter((x) => x.d < step.d_before).length : "—"],
        ];
      }
      return [
        ["Fase", stage ? stage.title : "—"],
        ["Aristas", step && step.stage === "phase1" ? "18 (todos los giros)" : "10 (solo los de H)"],
        ["Números", "cota inferior admisible: máximo de dos bases de datos de patrones"],
        ["Cota actual", step ? step.h_before : "—"],
        ["Giros que faltan", step ? step.d_before : "—"],
      ];
    case "levels":
      if (mode === "learn") {
        return [
          ["Grafo", stage ? `${n(stage.vertices)} vértices · ${stage.edges_per_vertex} aristas por vértice` : "—"],
          ["Distancia máxima", stage ? stage.max_distance : "—"],
          ["Cálculo", "BFS completo desde la meta; la distancia de cada vértice es exacta"],
          ["Escala", "logarítmica (cada marca multiplica por diez)"],
          ["Tu barra", step ? step.d_before : "—"],
        ];
      }
      return [
        ["Base de datos", step && step.stage === "phase1"
          ? `giro de esquinas × aristas centrales: ${n(meta.twophase.sizes.twist_slice)} vértices`
          : `permutación de esquinas × aristas centrales: ${n(meta.twophase.sizes.corners_slice)} vértices`],
        ["Cálculo", "BFS completo en el grafo reducido, guardado como tabla"],
        ["Uso", "cota inferior que nunca supera la distancia real, para podar la búsqueda IDA*"],
        ["Tu valor", step ? step.h_before : "—"],
      ];
    case "path":
      if (mode === "learn") {
        return [
          ["Camino", plan ? `${plan.steps.length} aristas · ${plan.move_count} giros` : "—"],
          ["Fases", plan ? plan.stages.map((s) => s.steps).join(" + ") + " pasos" : "—"],
          ["Altura", "distancia a la meta de la fase en curso; se reinicia al cambiar de fase"],
          ["Método", "descenso por la función de distancia: cada arista baja exactamente 1"],
        ];
      }
      return [
        ["Camino", plan ? `${plan.move_count} giros` : "—"],
        ["Fase 1 / Fase 2", plan ? `${plan.search.phase1_length} + ${plan.move_count - plan.search.phase1_length}` : "—"],
        ["Vértices explorados", plan ? `${n(plan.search.nodes_phase1)} en fase 1 · ${n(plan.search.nodes_phase2)} en fase 2` : "—"],
        ["Soluciones de fase 1 probadas", plan ? n(plan.search.phase1_solutions_tried) : "—"],
        ["Tiempo de búsqueda", plan ? `${plan.search.time} s` : "—"],
        ["Línea discontinua", "cota inferior; la continua son los giros que faltan de verdad"],
      ];
    case "tutor":
      return [
        ["Modelo", meta.tutor_model || "—"],
        ["Estado", tutor || "—"],
        ["Comprobación", "GET /v1/models con 6 s de límite, cacheada 30 s en el servidor"],
        ["Contexto enviado", "modo, fase, objetivo, movimiento elegido, distancias y los vecinos con su distancia"],
        ["Aviso", "el modelo puede equivocarse; los movimientos no salen de él, sino del solver"],
      ];
    case "capture":
      return [
        ["Detección", "segmentación de manchas de color uniforme + ajuste de la rejilla del cubo"],
        ["Cámara", "ortográfica con escala (8 números), ajustada por iteraciones de emparejar y resolver"],
        ["Desambiguación", "líneas negras entre pegatinas y huella de las manchas: una rejilla corrida una casilla también encaja"],
        ["Resolución", "480 px de ancho para analizar; ~13 ms por fotograma en seguimiento"],
        ["Lectura", "cada pegatina se fija cuando 3 lecturas coinciden; si una se contradice 3 veces, se suelta y se vuelve a leer"],
      ];
    case "review":
      return [
        ["Comprobaciones", "9 pegatinas por color, centros distintos, piezas sin repetir"],
        ["Orientaciones", "suma de giros de esquinas ≡ 0 (mod 3) y de volteos de aristas ≡ 0 (mod 2)"],
        ["Paridad", "la permutación de esquinas y la de aristas deben tener la misma paridad"],
        ["Segunda foto", "se prueban las 3 orientaciones posibles y se elige la que da un cubo posible"],
        ["Reparación", "si el cubo es imposible, se intercambian las pegatinas más dudosas hasta que deje de serlo"],
      ];
    case "mode":
      return [
        ["Aprendizaje", "7 fases; grafos de 24 a 190.080 vértices; BFS desde la meta; unos 100-140 giros"],
        ["Rápido", `IDA* en G/H (${n(2217093120)} vértices) y luego dentro de H (${n(19508428800)}); 20-22 giros`],
        ["Grafo completo", "43.252.003.274.489.856.000 posiciones, 18 aristas por vértice, diámetro 20"],
        ["Cotas", "bases de datos de patrones calculadas con BFS y guardadas en la imagen del contenedor"],
      ];
    default:
      return [];
  }
}

export function attachInfoButtons(openInfo) {
  const targets = [
    ["cube3d", ".cube3d-wrap"],
    ["step", "#step-card"],
    ["sticker", "#panel-sticker"],
    ["neighbors", "#panel-neighbors"],
    ["levels", "#panel-levels"],
    ["path", "#panel-path"],
    ["tutor", "#tutor-panel"],
    ["capture", ".capture-guide"],
    ["review", "#panel-review"],
    ["mode", ".mode-card"],
  ];
  for (const [key, selector] of targets) {
    const box = document.querySelector(selector);
    if (!box) continue;
    const b = document.createElement("button");
    b.className = "info-btn";
    b.type = "button";
    b.textContent = "i";
    b.title = "Qué es esto y cómo se usa";
    b.setAttribute("aria-label", `Información sobre: ${INFO[key].title}`);
    b.onclick = () => openInfo(key);
    b.dataset.info = key;
    box.appendChild(b);
  }
}
