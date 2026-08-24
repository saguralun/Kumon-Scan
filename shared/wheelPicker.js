

export class WheelPicker {

  constructor({

    element,
    items = [],
    value = null,
    visibleCount = 7,
    itemHeight = 44,
    onChange = () => {}

  }) {

    // ---------- Config ----------

    this.element = element;
    this.items = items;
    this.itemStyle = [
      { scale: 1.00, opacity: 1.00 },
      { scale: 0.97, opacity: 0.85 },
      { scale: 0.94, opacity: 0.65 },
      { scale: 0.91, opacity: 0.45 }
    ];
    this.visibleCount = visibleCount;
    this.itemHeight = itemHeight;

    this.onChange = onChange;

    // ---------- State ----------

    this.currentIndex =
      Math.max(0, items.indexOf(value));

    this.offset = 0;

    this.dragging = false;

    this.startY = 0;

    this.value =
      this.items[this.currentIndex];

    // ---------- Handlers ----------

    this.handlePointerDown =
      this.onPointerDown.bind(this);

    this.handlePointerMove =
      this.onPointerMove.bind(this);

    this.handlePointerUp =
      this.onPointerUp.bind(this);

    this.handleWheel =
      this.onWheel.bind(this);

    // ---------- Init ----------

    this.createDOM();

    this.bindEvents();

    this.render();

  }

  createDOM() {

    this.element.innerHTML = "";

    // Root
    this.root = document.createElement("div");
    this.root.className = "wheel-picker";

    // Viewport
    this.viewport = document.createElement("div");
    this.viewport.className = "wheel-viewport";

    // List
    this.list = document.createElement("div");
    this.list.className = "wheel-list";

    // Items
    this.itemElements = [];

    for (let i = 0; i < this.visibleCount; i++) {

      const item = document.createElement("div");

      item.className = "wheel-item";

      this.list.appendChild(item);

      this.itemElements.push(item);

    }

    // Highlight
    this.highlight = document.createElement("div");
    this.highlight.className = "wheel-highlight";

    // Build
    this.viewport.appendChild(this.list);

    this.root.appendChild(this.viewport);

    this.root.appendChild(this.highlight);

    this.element.appendChild(this.root);

  }

  bindEvents() {

    this.viewport.addEventListener(
      "pointerdown",
      this.handlePointerDown
    );

    this.viewport.addEventListener(
      "pointermove",
      this.handlePointerMove
    );

    this.viewport.addEventListener(
      "pointerup",
      this.handlePointerUp
    );

    this.viewport.addEventListener(
      "pointercancel",
      this.handlePointerUp
    );

    this.viewport.addEventListener(
      "wheel",
      this.handleWheel,
      { passive: false }
    );

  }

  render() {

    const t = performance.now();

    this.updateItems();
    this.updatePosition();
    this.updateStyle();

    console.log("render", performance.now() - t);

  }

  updateItems() {

    const center =
      Math.floor(this.visibleCount / 2);

    const total =
      this.items.length;

    for (let i = 0; i < this.itemElements.length; i++) {

      const offset =
        i - center;

      const index =
        (
          this.currentIndex +
          offset +
          total
        ) % total;

      this.itemElements[i].textContent =
        this.items[index];

    }

  }

  updatePosition() {

    this.list.style.transform =
      `translateY(${this.offset}px)`;

  }

  updateStyle() {

    const center =
      Math.floor(this.visibleCount / 2);

    for (let i = 0; i < this.itemElements.length; i++) {

      const item = this.itemElements[i];

      const distance =
        Math.abs(i - center);

      const style =
        this.itemStyle[
          Math.min(
            distance,
            this.itemStyle.length - 1
          )
        ];

      item.style.transform =
        `scale(${style.scale})`;

      item.style.opacity =
        style.opacity;

      item.classList.toggle(
        "selected",
        distance === 0
      );

    }

  }

  onPointerDown(e) {

    console.log("DOWN", e.pointerId);
    console.log("DOWN", e.clientY);
    e.preventDefault();

    this.dragging = true;
    this.startY = e.clientY;
    this.offset = 0;

    this.viewport.setPointerCapture(e.pointerId);

    //console.log(
    //  "capture",
    //  this.viewport.hasPointerCapture(e.pointerId)
    //);

  }

  onPointerMove(e) {

    const delta = e.clientY - this.startY;

    console.log({
        clientY: e.clientY,
        startY: this.startY,
        delta
    });

    if (!this.dragging) return;
    e.preventDefault();

    this.drag(
      delta
    );

  }

  onPointerUp(e) {

    console.log("UP", e.pointerId);
    if (!this.dragging) return;

    this.dragging = false;

    this.offset = 0;

    this.render();

    this.onChange(this.value);

    this.viewport.releasePointerCapture(e.pointerId);

  }

  onWheel(e) {

    e.preventDefault();

    this.changeIndex(e.deltaY > 0 ? 1 : -1);

    this.render();

    this.onChange(this.value);

  }

  drag(delta) {

    const total = this.items.length;

    // ไม่ให้เลื่อนเกิน 1/3 ของข้อมูล
    const MAX_STEP = Math.max(
      1,
      Math.min(
        Math.floor(total / 3),
        5        // กันข้อมูลเยอะเกิน
      )
    );

    let steps = Math.trunc(delta / this.itemHeight);

    // Clamp
    if (steps > MAX_STEP) steps = MAX_STEP;
    if (steps < -MAX_STEP) steps = -MAX_STEP;

    if (steps !== 0) {

      this.changeIndex(-steps);

      this.startY += steps * this.itemHeight;

      delta -= steps * this.itemHeight;

    }

    this.offset = delta;

    this.render();

  }

  shift(step) {

    console.log(
      "shift",
      step,
      this.offset,
      this.startY
    );

    this.offset -= step * this.itemHeight;

    this.startY += step * this.itemHeight;

    this.changeIndex(step);

  }

  changeIndex(step) {

    const total = this.items.length;

    this.currentIndex =
      (this.currentIndex + step + total) % total;

    this.value =
      this.items[this.currentIndex];

  }

  changeItems(items, value = null) {

    this.items = items;

    if (value === null) {

      value = items[0];

    }

    this.setValue(value);

  }

  setValue(value) {

    const index = this.items.indexOf(value);

    if (index === -1) return;

    this.currentIndex = index;

    this.value = value;

    this.offset = 0;

    this.render();

  }

  getValue() {

    return this.value;

  }

  destroy() {

    this.viewport.removeEventListener(
      "pointerdown",
      this.handlePointerDown
    );

    window.removeEventListener(
      "pointermove",
      this.handlePointerMove
    );

    window.removeEventListener(
      "pointerup",
      this.handlePointerUp
    );

    this.viewport.removeEventListener(
      "wheel",
      this.handleWheel
    );

    this.element.innerHTML = "";

  }

}