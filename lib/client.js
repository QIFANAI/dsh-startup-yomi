/**
 * dsh-startup-yomi — 浏览器半侧（设置页「黄泉启动序列」）
 * ----------------------------------------------------------------------------
 * 以 dsh.client bundle 格式加载（手写 ModuleLoader bundle，无需构建）：
 * 在 DSH 设置里注册一个 `settings.section`，用来改黄泉启动序列的播放方式、
 * 角色文案、配色与声音。
 *
 * 数据不走 settings 命名空间，而是走 Host 半侧自带的 HTTP API
 * （GET/POST /dsh-yomi/config）——与 dsh-meme 同款做法，少受 dsh-settings
 * 版本变更影响。注册 id 必须等于 loader entry 名（dsh-startup-yomi），
 * 否则 ModuleLoader 会报 "loaded without registering dsh-startup-yomi"。
 *
 * 另外带一层桌面端自举：Electron 的启动 HTML 不走 Host 的 tapIndex，
 * 本侧在检测到启动层没被注入时，自己建根节点并加载 splash.css/splash.js。
 */
window.__ModuleLoader__.load({
  id: 'dsh-startup-yomi',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var react = require('react')
    var h = react.createElement

    var API = '/dsh-yomi/config'

    /* ── CSS ─────────────────────────────────────────────────────────────── */
    /* 只用 DSH 设置页的 CSS 变量，不铺自定义背景，深浅主题都跟着宿主走。 */
    var CSS = [
      '.__ym_root{max-width:620px;display:flex;flex-direction:column;gap:14px;font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.__ym_head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}',
      '.__ym_version{font-family:ui-monospace,Consolas,monospace;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}',
      '.__ym_group{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:11px}',
      '.__ym_groupTitle{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}',
      '.__ym_field{display:flex;flex-direction:column;gap:5px}',
      '.__ym_label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.__ym_hint{font-size:11px;line-height:1.55;color:var(--dsw-alias-label-tertiary)}',
      '.__ym_row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.__ym_input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 10px;font-size:13px;box-sizing:border-box;width:100%;outline:none}',
      '.__ym_input:focus{border-color:var(--dsw-alias-state-business-primary)}',
      '.__ym_inputMono{font-family:ui-monospace,Consolas,monospace;font-size:12px;letter-spacing:.06em}',
      '.__ym_select{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 8px;font:inherit;font-size:13px;min-width:200px}',
      '.__ym_check{display:flex;align-items:flex-start;gap:8px;cursor:pointer}',
      '.__ym_check input{margin-top:2px;accent-color:var(--dsw-alias-state-business-primary)}',
      '.__ym_checkText{display:flex;flex-direction:column;gap:2px}',
      '.__ym_two{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
      '.__ym_actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:2px}',
      '.__ym_btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 14px;font:inherit;font-size:13px;cursor:pointer}',
      '.__ym_btn:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary)}',
      '.__ym_btn:disabled{opacity:.5;cursor:default}',
      '.__ym_btnPrimary{border-color:var(--dsw-alias-state-business-primary,#3964fe);background:var(--dsw-alias-state-business-primary,#3964fe);color:#fff}',
      '.__ym_status{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.__ym_ok{font-size:12px;color:var(--dsw-alias-state-business-primary)}',
      '.__ym_err{font-size:12px;color:var(--dsw-alias-state-error-primary,#f85149)}',
      '.__ym_swatch{width:38px;height:26px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;cursor:pointer}',
      '.__ym_preview{margin-top:2px;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:12px}',
      '.__ym_previewText{font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:1.5}'
    ].join('')
    var tagId = 'dsh-startup-yomi/main.css'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {
      var tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-startup-yomi'
      tag.dataset.pluginCss = tagId
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    /* ── 表单原子 ────────────────────────────────────────────────────────── */
    function Field(props) {
      return h('div', { className: '__ym_field' },
        h('label', { className: '__ym_label' }, props.label),
        props.children,
        props.hint ? h('div', { className: '__ym_hint' }, props.hint) : null
      )
    }

    function TextInput(props) {
      return h('input', {
        className: '__ym_input' + (props.mono ? ' __ym_inputMono' : ''),
        type: 'text',
        value: props.value == null ? '' : String(props.value),
        placeholder: props.placeholder || '',
        maxLength: props.maxLength || 64,
        spellCheck: false,
        onChange: (e) => props.onChange(e.target.value)
      })
    }

    function Select(props) {
      return h('select', {
        className: '__ym_select',
        value: props.value,
        onChange: (e) => props.onChange(e.target.value)
      }, props.options.map((o) => h('option', { key: o[0], value: o[0] }, o[1])))
    }

    function Check(props) {
      return h('label', { className: '__ym_check' },
        h('input', {
          type: 'checkbox',
          checked: !!props.checked,
          onChange: (e) => props.onChange(e.target.checked)
        }),
        h('span', { className: '__ym_checkText' },
          h('span', null, props.label),
          props.hint ? h('span', { className: '__ym_hint' }, props.hint) : null
        )
      )
    }

    function ColorInput(props) {
      return h('input', {
        className: '__ym_swatch',
        type: 'color',
        value: props.value,
        onChange: (e) => props.onChange(e.target.value)
      })
    }

    function Range(props) {
      return h('div', { className: '__ym_row' },
        h('input', {
          type: 'range',
          min: props.min, max: props.max, step: props.step || 0.05,
          value: props.value,
          style: { flex: '1 1 200px' },
          onChange: (e) => props.onChange(Number(e.target.value))
        }),
        h('span', { className: '__ym_status' }, props.display)
      )
    }

    /* ── 面板 ────────────────────────────────────────────────────────────── */
    /* 本地兜底默认值：Host 半侧若是旧版本（返回的配置缺字段），面板也要能
       正常显示控件，而不是一片 undefined。数值与 SPEC §3 严格一致。 */
    var FALLBACK = {
      enabled: true,
      mode: 'session',
      speed: 1,
      interaction: 'full',
      allowSkip: true,
      identity: 'OPERATOR',
      rank: '雷鸣的残响',
      fragments: '雷声之前|她曾在此|名字已归还',
      colorA: '#ff2d55',
      colorB: '#7a5cff',
      video: true,
      bgm: true,
      bgmVolume: 0.35,
      sfx: true,
      sfxVolume: 0.6,
      scanlines: true,
      reducedMotion: false,
      glitch: 0.6
    }
    /* reducedMotion 在 SPEC §3 里是配置字段，但 §5 的分组没有列出，
       所以设置页不提供开关：值原样回传，只由配置文件 / HTTP API 控制。 */

    function num(v, d) {
      var n = Number(v)
      return isFinite(n) ? n : d
    }

    /* 版本号来源，按可靠性排序：
       1) 面板从 /dsh-yomi/config 拿到的（Host 读的是它自己的 package.json）
       2) Host 往 index 注入的 window.__DSH_YOMI_VERSION__
       3) 下面这个常量：两份都没拿到时的兜底，别让面板显示 undefined。
       版本号本身只在 lib/index.js 里读一次，这里不重复维护。 */
    var FALLBACK_VERSION = '0.1.0'
    function readInjectedVersion() {
      try {
        var v = window.__DSH_YOMI_VERSION__
        return v ? String(v) : ''
      } catch (e) { return '' }
    }

    function Panel() {
      var [draft, setDraft] = react.useState(null)
      var [defaults, setDefaults] = react.useState(null)
      var [file, setFile] = react.useState('')
      var [version, setVersion] = react.useState(readInjectedVersion)
      var [error, setError] = react.useState(null)
      var [notice, setNotice] = react.useState(null)
      var [busy, setBusy] = react.useState(false)

      function load() {
        setError(null)
        return fetch(API, { headers: { Accept: 'application/json' } })
          .then((r) => r.json())
          .then((j) => {
            if (!j || j.ok !== true) throw new Error((j && j.error) || 'load failed')
            setDraft(Object.assign({}, FALLBACK, j.config))
            setDefaults(Object.assign({}, FALLBACK, j.defaults))
            setFile(j.file || '')
            if (j.version) setVersion(String(j.version))
          })
          .catch((e) => setError('读取配置失败：' + String(e && e.message ? e.message : e)))
      }

      react.useEffect(() => { load() }, [])

      function set(key, value) {
        setNotice(null)
        setDraft((d) => Object.assign({}, d, { [key]: value }))
      }

      function save() {
        if (!draft) return
        setBusy(true); setNotice(null); setError(null)
        fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patch: draft })
        })
          .then((r) => r.json())
          .then((j) => {
            if (!j || j.ok !== true) throw new Error((j && j.error) || 'save failed')
            setDraft(Object.assign({}, FALLBACK, j.config))
            setNotice('已保存，改动下次启动生效。')
          })
          .catch((e) => setError('保存失败：' + String(e && e.message ? e.message : e)))
          .then(() => setBusy(false))
      }

      function reset() {
        setBusy(true); setNotice(null); setError(null)
        fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reset' })
        })
          .then((r) => r.json())
          .then((j) => {
            if (!j || j.ok !== true) throw new Error((j && j.error) || 'reset failed')
            setDraft(Object.assign({}, FALLBACK, j.config))
            setNotice('已恢复默认。')
          })
          .catch((e) => setError('恢复默认失败：' + String(e && e.message ? e.message : e)))
          .then(() => setBusy(false))
      }

      /** 预览：优先让页面里的运行时重播一次；设置页独立打开时退回预览页。
          /dsh-yomi/preview 允许留空（SPEC §5），打开 404 也不影响保存。 */
      function preview() {
        try {
          var api = window.__DSH_YOMI_API__
          if (api && typeof api.replay === 'function') {
            api.replay()
            return
          }
        } catch (e) { /* 没有运行时，走预览页 */ }
        try { window.open('/dsh-yomi/preview') } catch (e) { /* 预览页可留空 */ }
      }

      /* 版本号常驻顶部，不进骨架屏 —— 它不依赖配置接口，
         接口挂了也该看得见当前装的是哪一版。 */
      var headRow = h('div', { className: '__ym_head' },
        h('div', { className: '__ym_version' }, '版本 v' + (version || FALLBACK_VERSION)),
        h('button', { className: '__ym_btn', type: 'button', onClick: preview }, '预览')
      )

      if (!draft) {
        return h('div', { className: '__ym_root' },
          headRow,
          h('div', { className: '__ym_status' }, error ? error : '读取配置中…'),
          error ? h('div', { className: '__ym_actions' },
            h('button', { className: '__ym_btn', onClick: load }, '重试')
          ) : null
        )
      }

      var modeOptions = [
        ['session', '每个浏览器会话一次'],
        ['daily', '每天一次'],
        ['always', '每次打开都播放']
      ]
      var interactionOptions = [
        ['full', '完整：HOLD 接入 + 三枚残响碎片'],
        ['quick', '轻触：单击一次即完成接入'],
        ['off', '无交互：自动揭幕']
      ]

      return h('div', { className: '__ym_root' },
        headRow,

        /* 播放 */
        h('div', { className: '__ym_group' },
          h('div', { className: '__ym_groupTitle' }, '播放'),
          h(Check, {
            label: '启用启动序列',
            hint: '关闭后直接进主界面，不再显示黑屏与揭幕动画。',
            checked: draft.enabled,
            onChange: (v) => set('enabled', v)
          }),
          h(Field, { label: '显示模式' },
            h(Select, { value: draft.mode, options: modeOptions, onChange: (v) => set('mode', v) })
          ),
          h(Field, {
            label: '速度倍率',
            hint: '0.6 慢放 · 1 原速 · 2 快放；过渡与揭幕节奏都按这个倍率缩放。'
          },
            h('div', { className: '__ym_row' },
              h('input', {
                type: 'range', min: 0.6, max: 2, step: 0.05,
                value: num(draft.speed, 1),
                style: { flex: '1 1 240px' },
                onChange: (e) => set('speed', Number(e.target.value))
              }),
              h('span', { className: '__ym_status' }, num(draft.speed, 1).toFixed(2) + '×')
            )
          ),
          h(Field, {
            label: '交互强度',
            hint: '完整档 6.5 秒无操作只会把提示改成「她还在等」，不会自动退出，也不会把画面卡死。'
          },
            h(Select, { value: draft.interaction, options: interactionOptions, onChange: (v) => set('interaction', v) })
          ),
          h(Check, {
            label: '允许跳过',
            hint: '右上角显示 SKIP，按 Esc 也能直接进入揭幕。',
            checked: draft.allowSkip,
            onChange: (v) => set('allowSkip', v)
          })
        ),

        /* 角色 */
        h('div', { className: '__ym_group' },
          h('div', { className: '__ym_groupTitle' }, '角色'),
          h(Field, {
            label: '身份名称',
            hint: '揭幕第二行的身份名称（如「欢迎回来，OPERATOR」），最多 24 字。'
          }, h(TextInput, {
            value: draft.identity,
            placeholder: '例如：OPERATOR',
            maxLength: 24,
            onChange: (v) => set('identity', v)
          })),
          h(Field, {
            label: '称号',
            hint: '显示在身份名称下方，最多 24 字。'
          }, h(TextInput, {
            value: draft.rank,
            placeholder: '例如：雷鸣的残响',
            maxLength: 24,
            onChange: (v) => set('rank', v)
          })),
          h(Field, {
            label: '三段残响文案',
            hint: '用 | 分隔，最多 3 段；每段最多 24 字。例如「雷声之前|她曾在此|名字已归还」。留空回落默认三段。'
          }, h(TextInput, {
            value: draft.fragments,
            placeholder: '雷声之前|她曾在此|名字已归还',
            maxLength: 80,
            onChange: (v) => set('fragments', v)
          }))
        ),

        /* 视觉 */
        h('div', { className: '__ym_group' },
          h('div', { className: '__ym_groupTitle' }, '视觉'),
          h('div', { className: '__ym_two' },
            h(Field, { label: '主色 · 电光红' },
              h('div', { className: '__ym_row' },
                h(ColorInput, { value: draft.colorA, onChange: (v) => set('colorA', v) }),
                h('span', { className: '__ym_status' }, String(draft.colorA))
              )
            ),
            h(Field, { label: '副色 · 残响紫' },
              h('div', { className: '__ym_row' },
                h(ColorInput, { value: draft.colorB, onChange: (v) => set('colorB', v) }),
                h('span', { className: '__ym_status' }, String(draft.colorB))
              )
            )
          ),
          h(Check, {
            label: '扫描线',
            hint: '全屏扫描线与噪点叠加；关闭后画面更干净。',
            checked: draft.scanlines,
            onChange: (v) => set('scanlines', v)
          }),
          h(Field, {
            label: '故障强度',
            hint: '揭幕时的色散 / 撕裂强度：0 最克制，1 最剧烈。'
          },
            h(Range, {
              value: num(draft.glitch, 0.6), min: 0, max: 1, step: 0.05,
              display: Math.round(num(draft.glitch, 0.6) * 100) + '%',
              onChange: (v) => set('glitch', v)
            })
          )
        ),

        /* 声音 */
        h('div', { className: '__ym_group' },
          h('div', { className: '__ym_groupTitle' }, '声音'),
          h(Check, {
            label: '动态母版',
            hint: '优先 lib/assets/hero-loop.mp4（15s 循环），加载失败回退 hero-loop.webm 与 hero.mp4；三路都失败仍保留海报角色。',
            checked: draft.video,
            onChange: (v) => set('video', v)
          }),
          h(Check, {
            label: 'BGM',
            hint: 'lib/assets/bgm.mp3，循环播放、揭幕时淡出；素材缺失时静默。',
            checked: draft.bgm,
            onChange: (v) => set('bgm', v)
          }),
          draft.bgm ? h(Field, { label: 'BGM 音量' },
            h(Range, {
              value: num(draft.bgmVolume, 0.35), min: 0, max: 1, step: 0.01,
              display: Math.round(num(draft.bgmVolume, 0.35) * 100) + '%',
              onChange: (v) => set('bgmVolume', v)
            })
          ) : null,
          h(Check, {
            label: '音效',
            hint: '蓄力、碎片碎裂与揭幕的界面音效，由 WebAudio 现场合成，不依赖素材文件。',
            checked: draft.sfx,
            onChange: (v) => set('sfx', v)
          }),
          draft.sfx ? h(Field, { label: '音效音量' },
            h(Range, {
              value: num(draft.sfxVolume, 0.6), min: 0, max: 1, step: 0.01,
              display: Math.round(num(draft.sfxVolume, 0.6) * 100) + '%',
              onChange: (v) => set('sfxVolume', v)
            })
          ) : null
        ),

        /* 预览说明 */
        h('div', { className: '__ym_preview' },
          h('div', { className: '__ym_previewText' },
            '预览会按当前「已保存」的配置重播一次；想先看新配置，先保存再预览。',
            file ? h('div', { style: { marginTop: '4px', opacity: 0.75 } }, '配置文件：' + file) : null
          ),
          h('button', { className: '__ym_btn', type: 'button', onClick: preview }, '立即预览')
        ),

        /* 操作 */
        h('div', { className: '__ym_actions' },
          h('button', {
            className: '__ym_btn __ym_btnPrimary',
            disabled: busy,
            onClick: save
          }, busy ? '处理中…' : '保存'),
          h('button', { className: '__ym_btn', disabled: busy, onClick: reset }, '恢复默认'),
          h('button', { className: '__ym_btn', disabled: busy, onClick: load }, '放弃修改'),
          notice ? h('span', { className: '__ym_ok' }, notice) : null,
          error ? h('span', { className: '__ym_err' }, error) : null
        )
      )
    }

    /* ── 桌面端自举 ────────────────────────────────────────────────────────
       桌面端（Electron）的启动 HTML 是 web-frontend 静态页 + IPC 结构化注入，
       Host 的 tapIndex 字符串注入只对 web profile 的 index 渲染生效。所以这里
       补一层浏览器半侧自举：宿主没注入启动层时，由本侧建根节点、拉 Host 路由、
       再加载 splash.js。两边靠 window 标记互斥，不会双开。

       判定：__DSH_YOMI_BOOT__（已接管）/ __DSH_YOMI__（Host 已注入配置）/
       #dsh-yomi-root（根节点已存在）/ __DSH_YOMI_FAILED__（已失败过）。 */
    var ROUTE = '/dsh-yomi'

    function releaseBoot() {
      try {
        var r = document.getElementById('dsh-yomi-root')
        if (r && r.parentNode) r.parentNode.removeChild(r)
        if (document.documentElement.classList) document.documentElement.classList.remove('yomi-lock')
        if (document.body && document.body.style) document.body.style.overflow = ''
        window.__DSH_YOMI_FAILED__ = true
      } catch (e) { /* 兜底不再抛 */ }
    }

    function injectBoot(cfg) {
      var root = document.getElementById('dsh-yomi-root')
      if (!root) {
        root = document.createElement('div')
        root.id = 'dsh-yomi-root'
        document.body.appendChild(root)
      }
      root.className = 'yomi-root yomi-boot'
      try { document.documentElement.classList.add('yomi-lock') } catch (e) {}
      try { document.body.style.overflow = 'hidden' } catch (e) {}

      window.__DSH_YOMI__ = cfg || {}

      var css = document.createElement('link')
      css.rel = 'stylesheet'
      css.href = ROUTE + '/splash.css'
      document.head.appendChild(css)

      var script = document.createElement('script')
      script.src = ROUTE + '/splash.js?t=' + Date.now()
      script.onerror = function () { releaseBoot() }
      document.body.appendChild(script)

      /* splash.js 正常接管后会立刻摘掉 yomi-boot；9 秒还在就说明没跑起来 */
      setTimeout(function () {
        try {
          var r = document.getElementById('dsh-yomi-root')
          if (r && r.className && r.className.indexOf('yomi-boot') !== -1) releaseBoot()
        } catch (e) { /* noop */ }
      }, 9000)
    }

    function selfBoot() {
      try {
        if (typeof window === 'undefined' || typeof document === 'undefined') return
        if (!document.body) return
        if (window.__DSH_YOMI_BOOT__) return
        if (window.__DSH_YOMI__) return
        if (document.getElementById('dsh-yomi-root')) return
        if (window.__DSH_YOMI_FAILED__ === true) return
        window.__DSH_YOMI_BOOT__ = 'client'
        fetch(API, { headers: { Accept: 'application/json' } })
          .then(function (r) { return r.json() })
          .then(function (j) { return j && j.ok === true ? j.config : null })
          .catch(function () { return null })
          .then(function (cfg) {
            cfg = cfg || {}
            if (cfg.enabled === false) return
            var today = new Date().toISOString().slice(0, 10)
            var shown = null
            var day = null
            try { shown = window.sessionStorage ? window.sessionStorage.getItem('dsh-startup-yomi:shown') : null } catch (e) {}
            try { day = window.localStorage ? window.localStorage.getItem('dsh-startup-yomi:day') : null } catch (e) {}
            if (cfg.mode === 'session' && shown === '1') return
            if (cfg.mode === 'daily' && day === today) return
            injectBoot(cfg)
          })
          .catch(function () { /* 自举失败就算了，页面本来就是好的 */ })
      } catch (e) { /* 自举是兜底，绝不许把宿主带崩 */ }
    }

    /* ── 插件 ────────────────────────────────────────────────────────────── */
    var inject = ['slots']

    function apply(ctx) {
      /* 桌面端兜底：Host 结构化注入没带上启动层时，由这里自举。
         web profile 下 Host tapIndex 已经写过 window.__DSH_YOMI__，这里直接返回。 */
      selfBoot()
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register(
          { name: 'settings.section', id: 'dsh-startup-yomi', order: 27, label: '黄泉启动序列' },
          function () { return h(Panel, {}) }
        )
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
