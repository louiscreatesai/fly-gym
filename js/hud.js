// The workout panel (bottom-left of the phone strip) and the header (top-left),
// camera tabs, big stats, phase strip, description, buttons.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Hud {
  constructor(root, { onCam, onPause, onRestart } = {}) {
    this.root = root;
    this.onCam = onCam; this.onPause = onPause; this.onRestart = onRestart;
    this.header = document.createElement('div');
    this.header.className = 'hud-header';
    this.card = document.createElement('div');
    this.card.className = 'hud-card';
    this.flashEl = document.createElement('div');
    this.flashEl.className = 'hud-flash';
    root.append(this.header, this.card, this.flashEl);
    this.cfg = null;
    this.last = {};
  }

  /**
   * cfg = {
   *   title: 'LEG PRESS · 2,340 LB', sub: 'SIX LEGS · NO REST DAYS',
   *   cams: [['gym','Gym view'],['front','Front view'],['close','Close-up']],
   *   stats: [{ key:'reps', label:'REPS', of:'10' }, { key:'set', label:'SET' }, { key:'time', label:'WORKOUT', small:true }],
   *   phases: ['↑ PUSH','HOLD','↓ LOWER'],
   *   footer: 'NeuroMechFly body · articulated exercise animation · Methods',
   * }
   */
  configure(cfg) {
    this.cfg = cfg;
    this.header.innerHTML = `<div class="hh-title">${esc(cfg.title)}</div><div class="hh-sub">${esc(cfg.sub)}</div>`;
    const cams = (cfg.cams || []).map(([k, label], i) =>
      `<button class="cam${i === 0 ? ' on' : ''}" data-cam="${k}">${esc(label)}</button>`).join('');
    const stats = (cfg.stats || []).map(s => `
      <div class="stat${s.small ? ' small' : ''}" data-k="${s.key}">
        <div class="lab">${esc(s.label)}</div>
        <div class="val"><span class="v">–</span>${s.of ? `<span class="of">/ ${esc(s.of)}</span>` : ''}</div>
      </div>`).join('');
    const phases = (cfg.phases || []).map((p, i) => `<span class="ph" data-i="${i}">${esc(p)}</span>`).join('');
    this.card.innerHTML = `
      <div class="cams">${cams}</div>
      <div class="stats">${stats}</div>
      <div class="bar"><i></i></div>
      <div class="phases">${phases}</div>
      <div class="desc"></div>
      <div class="note"></div>
      <div class="btns"><button class="b-pause">Pause</button><button class="b-restart">Restart workout</button></div>
      <div class="foot">${esc(cfg.footer || '')}</div>`;
    this.card.querySelectorAll('.cam').forEach(b => b.addEventListener('click', () => {
      this.setCam(b.dataset.cam);
      this.onCam && this.onCam(b.dataset.cam);
    }));
    this.card.querySelector('.b-pause').addEventListener('click', () => this.onPause && this.onPause());
    this.card.querySelector('.b-restart').addEventListener('click', () => this.onRestart && this.onRestart());
    this.els = {
      bar: this.card.querySelector('.bar i'),
      desc: this.card.querySelector('.desc'),
      note: this.card.querySelector('.note'),
      phases: [...this.card.querySelectorAll('.ph')],
      stats: Object.fromEntries([...this.card.querySelectorAll('.stat')].map(e => [e.dataset.k, e.querySelector('.v')])),
      pause: this.card.querySelector('.b-pause'),
    };
    this.last = {};
  }

  setCam(k) {
    this.card.querySelectorAll('.cam').forEach(b => b.classList.toggle('on', b.dataset.cam === k));
  }
  setPaused(p) { if (this.els) this.els.pause.textContent = p ? 'Resume' : 'Pause'; }

  /** state = { stats:{reps:'4', set:'3', time:'3:06'}, phase:0, progress:0.4, desc:'...', note:'...', title?, sub? } */
  update(state) {
    if (!this.els) return;
    const L = this.last;
    if (state.stats) for (const k in state.stats) {
      const v = String(state.stats[k]);
      if (L['s_' + k] !== v && this.els.stats[k]) {
        this.els.stats[k].textContent = v;
        if (L['s_' + k] !== undefined && state.bump !== false) {
          const el = this.els.stats[k].parentElement.parentElement;
          el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
        }
        L['s_' + k] = v;
      }
    }
    if (state.phase !== undefined && L.phase !== state.phase) {
      this.els.phases.forEach((e, i) => e.classList.toggle('on', i === state.phase));
      L.phase = state.phase;
    }
    if (state.progress !== undefined) this.els.bar.style.transform = `scaleX(${Math.max(0, Math.min(1, state.progress))})`;
    if (state.desc !== undefined && L.desc !== state.desc) { this.els.desc.textContent = state.desc; L.desc = state.desc; }
    if (state.note !== undefined && L.note !== state.note) { this.els.note.textContent = state.note; L.note = state.note; }
    if (state.title !== undefined && L.title !== state.title) {
      this.header.querySelector('.hh-title').textContent = state.title; L.title = state.title;
    }
    if (state.sub !== undefined && L.sub !== state.sub) {
      this.header.querySelector('.hh-sub').textContent = state.sub; L.sub = state.sub;
    }
    if (state.danger !== undefined) this.card.classList.toggle('danger', !!state.danger);
  }

  /** A big pop-up label near the top of the phone strip, e.g. 'NEW PR' or 'BELT FAILURE'. */
  flash(text, { color = '#ffffff', ms = 1100, size = 1 } = {}) {
    const el = this.flashEl;
    el.textContent = text;
    el.style.setProperty('--fc', color);
    el.style.setProperty('--fs', size);
    el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
    clearTimeout(this._ft);
    this._ft = setTimeout(() => el.classList.remove('go'), ms);
  }

  show(v) { this.root.style.display = v ? '' : 'none'; }
}
