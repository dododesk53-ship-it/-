/**
 * 悬浮管理面板宿主：在酒馆主页面里创建一个可拖动、可缩放的窗口，内嵌面板 iframe。
 * 面板 iframe 与酒馆同源，通过 window.parent.F1Manager 调用后端接口。
 */
const ROOT_ID = 'f1m-panel-root';
const STYLE_ID = 'f1m-panel-style';
const GEOM_KEY = 'f1m-panel-geom';

const CSS = `
#${ROOT_ID}{position:fixed;z-index:9990;left:calc(50vw - 490px);top:6vh;width:980px;height:min(720px,88vh);
  max-width:100vw;max-height:100vh;min-width:340px;min-height:300px;display:flex;flex-direction:column;
  background:#0f1115;border:1px solid #2b303b;border-radius:12px;box-shadow:0 24px 64px rgba(0,0,0,.65);overflow:hidden;resize:both}
#${ROOT_ID}.f1m-hidden{display:none}
#${ROOT_ID}.f1m-mobile{left:6px!important;top:max(6px,env(safe-area-inset-top))!important;width:calc(100vw - 12px)!important;height:calc(100dvh - max(12px,env(safe-area-inset-top) + env(safe-area-inset-bottom)))!important;border-radius:8px;resize:none;border:1px solid #2b303b}
#${ROOT_ID} .f1m-titlebar{flex:0 0 38px;display:flex;align-items:center;gap:8px;padding:0 6px 0 12px;
  background:linear-gradient(90deg,#e10600 0,#9e0b0b 28%,#16181d 70%);color:#fff;cursor:move;user-select:none;
  font:600 14px/1 system-ui,-apple-system,"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif;letter-spacing:.5px;touch-action:none}
#${ROOT_ID} .f1m-titlebar .f1m-title{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#${ROOT_ID} .f1m-titlebar button{background:rgba(255,255,255,.08);border:0;color:#fff;width:30px;height:28px;border-radius:6px;
  font-size:16px;line-height:28px;cursor:pointer;padding:0}
#${ROOT_ID} .f1m-titlebar button:hover{background:rgba(255,255,255,.2)}
#${ROOT_ID} iframe{flex:1;border:0;width:100%;background:#0f1115;display:block}
#${ROOT_ID}.f1m-dragging iframe{pointer-events:none}
`;

export class PanelHost {
  private root: HTMLElement | null = null;
  private frame: HTMLIFrameElement | null = null;
  private loaded = false;
  private pendingTab: string | null = null;

  constructor(
    private doc: Document,
    private html: string,
  ) {}

  private get win(): Window {
    return this.doc.defaultView ?? window;
  }

  private isMobile(): boolean {
    return this.win.innerWidth < 768;
  }

  private ensure(): void {
    if (this.root && this.doc.contains(this.root)) return;
    this.doc.getElementById(ROOT_ID)?.remove();
    if (!this.doc.getElementById(STYLE_ID)) {
      const style = this.doc.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      this.doc.head.appendChild(style);
    }
    const root = this.doc.createElement('div');
    root.id = ROOT_ID;
    root.className = 'f1m-hidden';
    root.innerHTML = `<div class="f1m-titlebar"><span class="f1m-title">F1 领队 · 管理面板</span>
      <button type="button" data-act="reload" title="刷新面板">⟳</button>
      <button type="button" data-act="max" title="最大化/还原">⤢</button>
      <button type="button" data-act="close" title="关闭">✕</button></div>`;
    const frame = this.doc.createElement('iframe');
    frame.setAttribute('title', 'F1 领队管理面板');
    root.appendChild(frame);
    this.doc.body.appendChild(root);
    this.root = root;
    this.frame = frame;
    this.loaded = false;
    this.restoreGeometry();
    this.bind();
  }

  private bind(): void {
    const root = this.root!;
    const bar = root.querySelector('.f1m-titlebar') as HTMLElement;
    bar.addEventListener('click', ev => {
      const act = (ev.target as HTMLElement).closest('button')?.getAttribute('data-act');
      if (act === 'close') this.close();
      if (act === 'max') this.toggleMax();
      if (act === 'reload') this.reload();
    });
    let start: { x: number; y: number; left: number; top: number } | null = null;
    bar.addEventListener('pointerdown', ev => {
      if ((ev.target as HTMLElement).closest('button') || this.isMobile()) return;
      const rect = root.getBoundingClientRect();
      start = { x: ev.clientX, y: ev.clientY, left: rect.left, top: rect.top };
      root.classList.add('f1m-dragging');
      bar.setPointerCapture(ev.pointerId);
    });
    bar.addEventListener('pointermove', ev => {
      if (!start) return;
      const w = this.win;
      const left = Math.min(Math.max(start.left + ev.clientX - start.x, -root.offsetWidth + 120), w.innerWidth - 120);
      const top = Math.min(Math.max(start.top + ev.clientY - start.y, 0), w.innerHeight - 40);
      root.style.left = `${left}px`;
      root.style.top = `${top}px`;
    });
    const end = () => {
      if (!start) return;
      start = null;
      root.classList.remove('f1m-dragging');
      this.saveGeometry();
    };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    root.addEventListener('mouseup', () => this.saveGeometry());
    this.win.addEventListener('resize', this.onResize);
  }

  private onResize = () => {
    if (!this.root) return;
    const mobile = this.isMobile();
    this.root.classList.toggle('f1m-mobile', mobile);
    // An iframe's CSS media query can retain a desktop layout viewport even
    // when its host is narrow. Mirror the host mode into the panel document
    // so component styles can respond to the actual usable panel width.
    this.frame?.contentDocument?.documentElement.classList.toggle('f1m-mobile', mobile);
  };

  private saveGeometry(): void {
    if (!this.root || this.isMobile()) return;
    const r = this.root.getBoundingClientRect();
    try {
      this.win.localStorage.setItem(GEOM_KEY, JSON.stringify({ left: r.left, top: r.top, width: r.width, height: r.height }));
    } catch {
      /* 隐私模式 */
    }
  }

  private restoreGeometry(): void {
    const root = this.root!;
    root.classList.toggle('f1m-mobile', this.isMobile());
    try {
      const g = JSON.parse(this.win.localStorage.getItem(GEOM_KEY) ?? 'null');
      if (g && g.width > 300 && g.height > 250) {
        const w = this.win;
        root.style.width = `${Math.min(g.width, w.innerWidth)}px`;
        root.style.height = `${Math.min(g.height, w.innerHeight)}px`;
        root.style.left = `${Math.min(Math.max(g.left, 0), Math.max(0, w.innerWidth - 200))}px`;
        root.style.top = `${Math.min(Math.max(g.top, 0), Math.max(0, w.innerHeight - 80))}px`;
      }
    } catch {
      /* 忽略 */
    }
  }

  private toggleMax(): void {
    if (!this.root) return;
    const maxed = this.root.dataset.max === '1';
    if (maxed) {
      this.root.dataset.max = '0';
      this.restoreGeometry();
    } else {
      this.saveGeometry();
      this.root.dataset.max = '1';
      Object.assign(this.root.style, { left: '0px', top: '0px', width: '100vw', height: '100vh' });
    }
  }

  private load(): void {
    if (!this.frame || this.loaded) return;
    this.loaded = true;
    this.frame.addEventListener(
      'load',
      () => {
        this.onResize();
        if (this.pendingTab) this.sendTab(this.pendingTab);
        this.pendingTab = null;
      },
      { once: true },
    );
    this.frame.srcdoc = this.html;
  }

  private sendTab(tab: string): void {
    try {
      this.frame?.contentWindow?.postMessage({ type: 'f1m:tab', tab }, '*');
    } catch {
      /* 忽略 */
    }
  }

  isOpen(): boolean {
    return !!this.root && !this.root.classList.contains('f1m-hidden');
  }

  open(tab?: string): void {
    this.ensure();
    this.root!.classList.remove('f1m-hidden');
    if (!this.loaded) {
      this.pendingTab = tab ?? null;
      this.load();
    } else if (tab) {
      this.sendTab(tab);
    }
  }

  close(): void {
    this.root?.classList.add('f1m-hidden');
  }

  toggle(tab?: string): void {
    if (this.isOpen()) this.close();
    else this.open(tab);
  }

  reload(): void {
    if (!this.frame) return;
    this.loaded = false;
    this.load();
  }

  destroy(): void {
    this.win.removeEventListener('resize', this.onResize);
    this.root?.remove();
    this.doc.getElementById(STYLE_ID)?.remove();
    this.root = null;
    this.frame = null;
  }
}
