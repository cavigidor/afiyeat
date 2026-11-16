// Demo build only. A minimal stand-in for MapKit JS, covering exactly the calls PlaceMap makes, so
// Map views work in the preview with real pins and tap-to-select, without contacting Apple.
// It draws a plain street-grid background; it is not a map of the real area.
/* eslint-disable @typescript-eslint/no-explicit-any */

class Coordinate { constructor(public latitude: number, public longitude: number) {} }
class CoordinateSpan { constructor(public latitudeDelta: number, public longitudeDelta: number) {} }
class CoordinateRegion { constructor(public center: Coordinate, public span: CoordinateSpan) {} }
class Padding { constructor(public top = 0, public right = 0, public bottom = 0, public left = 0) {} }

class Annotation {
  element: HTMLElement;
  private _selected = false;
  map: FakeMap | null = null;
  constructor(public coordinate: Coordinate, factory: () => HTMLElement, public options: any = {}) {
    this.element = factory();
    this.element.style.position = 'absolute';
    this.element.style.transform = 'translate(-50%, -100%)';
    this.element.style.cursor = 'pointer';
    this.element.addEventListener('click', (e) => { e.stopPropagation(); this.selected = true; });
  }
  get data() { return this.options?.data; }
  get selected() { return this._selected; }
  set selected(v: boolean) {
    this._selected = v;
    this.element.style.zIndex = v ? '10' : '1';
    this.element.style.filter = v ? 'drop-shadow(0 2px 6px rgba(0,0,0,.45))' : '';
    if (v && this.map) { this.map.annotations.forEach((a) => { if (a !== this) a.selected = false; }); this.map.emit('select', { annotation: this }); this.map.showCallout(this); }
  }
}

class FakeMap {
  annotations: Annotation[] = [];
  private listeners: Record<string, ((e: any) => void)[]> = {};
  private layer: HTMLDivElement;
  private callout: HTMLDivElement | null = null;
  private _region = new CoordinateRegion(new Coordinate(41.8935, -87.6345), new CoordinateSpan(0.05, 0.05));

  constructor(private container: HTMLElement, _opts: any = {}) {
    container.style.position = container.style.position || 'relative';
    container.style.overflow = 'hidden';
    container.style.background = '#eef1ea';
    container.style.backgroundImage =
      'linear-gradient(#fff 2px, transparent 2px), linear-gradient(90deg, #fff 2px, transparent 2px), linear-gradient(#e1e6dc 1px, transparent 1px), linear-gradient(90deg, #e1e6dc 1px, transparent 1px)';
    container.style.backgroundSize = '120px 120px, 120px 120px, 24px 24px, 24px 24px';
    this.layer = document.createElement('div');
    this.layer.style.cssText = 'position:absolute;inset:0;';
    container.appendChild(this.layer);
    const badge = document.createElement('div');
    badge.textContent = 'Demo map';
    badge.style.cssText = 'position:absolute;left:8px;bottom:8px;font:600 10px system-ui;color:#667;background:#fffc;border-radius:6px;padding:2px 6px;';
    container.appendChild(badge);
    container.addEventListener('click', () => { this.annotations.forEach((a) => { if (a.selected) a.selected = false; }); this.callout?.remove(); this.callout = null; });
    new ResizeObserver(() => this.layout()).observe(container);
  }
  emit(name: string, e: any) { (this.listeners[name] ?? []).forEach((f) => f(e)); }
  addEventListener(name: string, f: (e: any) => void) { (this.listeners[name] ??= []).push(f); }
  removeEventListener(name: string, f: (e: any) => void) { this.listeners[name] = (this.listeners[name] ?? []).filter((x) => x !== f); }
  get region() { return this._region; }
  set region(r: CoordinateRegion) { this._region = r; this.layout(); this.emit('region-change-end', {}); }
  setRegionAnimated(r: CoordinateRegion) { this.region = r; }
  setCenterAnimated(c: Coordinate) { this.region = new CoordinateRegion(c, this._region.span); }
  addAnnotations(list: Annotation[]) { list.forEach((a) => { a.map = this; this.annotations.push(a); this.layer.appendChild(a.element); }); this.layout(); }
  removeAnnotations(list: Annotation[]) { [...list].forEach((a) => { a.element.remove(); a.map = null; }); this.annotations = this.annotations.filter((a) => !list.includes(a)); this.callout?.remove(); this.callout = null; }
  showItems(list: Annotation[], opts: any = {}) {
    if (!list.length) return;
    const lats = list.map((a) => a.coordinate.latitude), lngs = list.map((a) => a.coordinate.longitude);
    const pad = 1.6;
    const center = new Coordinate((Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2);
    const span = new CoordinateSpan(Math.max(0.004, (Math.max(...lats) - Math.min(...lats)) * pad), Math.max(0.004, (Math.max(...lngs) - Math.min(...lngs)) * pad));
    void opts;
    this.region = new CoordinateRegion(center, span);
  }
  showCallout(a: Annotation) {
    this.callout?.remove();
    this.callout = null;
    const content = a.options?.callout?.calloutContentForAnnotation?.(a);
    if (!content) return;
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;transform:translate(-50%,calc(-100% - 46px));background:#fff;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.2);padding:8px 10px;max-width:220px;z-index:20;font:13px system-ui;';
    box.appendChild(content);
    box.addEventListener('click', (e) => e.stopPropagation());
    const p = this.project(a.coordinate);
    box.style.left = `${p.x}px`;
    box.style.top = `${p.y}px`;
    this.layer.appendChild(box);
    this.callout = box;
  }
  private project(c: Coordinate) {
    const w = this.container.clientWidth || 320, h = this.container.clientHeight || 250;
    const { center, span } = this._region;
    return { x: w / 2 + ((c.longitude - center.longitude) / span.longitudeDelta) * w, y: h / 2 - ((c.latitude - center.latitude) / span.latitudeDelta) * h };
  }
  private layout() {
    for (const a of this.annotations) { const p = this.project(a.coordinate); a.element.style.left = `${p.x}px`; a.element.style.top = `${p.y}px`; }
  }
}

export function installFakeMapKit() {
  (window as any).mapkit = {
    Map: FakeMap, Annotation, Coordinate, CoordinateRegion, CoordinateSpan, Padding,
    FeatureVisibility: { Hidden: 'hidden', Visible: 'visible', Adaptive: 'adaptive' },
    init: () => {}, load: async () => {}, addEventListener: () => {},
  };
}
