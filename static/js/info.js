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
    title: "Cómo hacer las fotos",
    html: `
      <p>Hacen falta <b>dos fotos</b>: cada una muestra tres caras, y entre las dos se ven las seis.</p>
      <h4>Paso a paso</h4>
      <ul>
        <li><b>Foto 1:</b> apunta a la cámara con la esquina de arriba-delante-derecha. Se ven las
        caras de arriba, delante y derecha.</li>
        <li><b>Foto 2:</b> dale la vuelta al cubo para que apunte a la cámara la <b>esquina
        opuesta</b>, la que estaba abajo-atrás-izquierda. Da igual cómo lo gires mientras sea esa
        esquina: la aplicación deduce la orientación.</li>
        <li>Encaja el cubo dentro del hexágono y procura que lo llene casi entero.</li>
      </ul>
      <h4>Si los colores no se leen bien</h4>
      <ul>
        <li><b>Arrastra los siete puntos azules</b> hasta las esquinas del cubo. Los círculos
        pequeños enseñan el color que se está leyendo en cada adhesivo.</li>
        <li>Luz uniforme y sin reflejos. El brillo del plástico es lo que más confunde, sobre todo
        entre rojo y naranja.</li>
        <li>Da igual si sale imperfecto: en la pantalla siguiente puedes corregir a mano.</li>
      </ul>`,
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
    box.appendChild(b);
  }
}
