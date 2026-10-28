// Client half of the delivery-workflow bundle.
// Left rail (workspace / projects / counts) + collapsed run cards.
window.__ModuleLoader__.load({
  id: '@local/delivery-workflow',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    const WORKSPACE = '/Users/runzhili/Desktop/biomap-delivery'
    const SUBTLE = '1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.22))'
    const BORDER = '1px solid var(--dsw-alias-border-default, rgba(127,127,127,.32))'
    const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace'
    const STAGE = { intake: '需求', develop: '开发', verify: '验证', build: '构建', deploy: '部署', closed: '已完成' }
    const ACTIONS = {
      intake: ['verify'], develop: ['verify'], verify: ['verify', 'build'],
      build: ['verify', 'build', 'deploy'], deploy: ['verify', 'build', 'deploy'], closed: [],
    }
    const ALABEL = { verify: '验证', build: '构建', deploy: '部署' }

    const S = {
      root: { display: 'flex', height: '100%', minHeight: 0, font: 'inherit', color: 'inherit' },
      rail: { flex: '0 0 206px', borderRight: SUBTLE, padding: '18px 14px', overflow: 'auto' },
      rt: { fontSize: 13, fontWeight: 600 },
      rs: { fontSize: 11, opacity: 0.5, margin: '2px 0 14px', wordBreak: 'break-all' },
      rl: { fontSize: 11, opacity: 0.42, margin: '15px 0 6px' },
      ri: { fontSize: 12, padding: '4px 7px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 6 },
      main: { flex: 1, minWidth: 0, overflow: 'auto', padding: '22px 28px 70px' },
      bar: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 },
      h1: { fontSize: 17, margin: 0, fontWeight: 600 },
      sub: { fontSize: 12, opacity: 0.5 },
      btn: { font: 'inherit', fontSize: 12, padding: '5px 12px', borderRadius: 7, border: BORDER, background: 'transparent', color: 'inherit', cursor: 'pointer' },
      sm: { font: 'inherit', fontSize: 12, padding: '3px 9px', borderRadius: 6, border: BORDER, background: 'transparent', color: 'inherit', cursor: 'pointer' },
      gh: { font: 'inherit', fontSize: 12, padding: '3px 9px', borderRadius: 6, border: '1px solid transparent', background: 'transparent', color: 'inherit', opacity: 0.62, cursor: 'pointer' },
      lb: { fontSize: 12, opacity: 0.5, margin: '20px 0 9px' },
      card: { border: SUBTLE, borderRadius: 10, padding: '11px 14px', marginBottom: 8 },
      row: { display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', flexWrap: 'wrap' },
      chip: { fontSize: 11, padding: '1px 8px', borderRadius: 999, border: BORDER, opacity: 0.85 },
      body: { marginTop: 10, paddingTop: 10, borderTop: SUBTLE },
      meta: { display: 'flex', gap: 15, flexWrap: 'wrap', fontSize: 12, opacity: 0.7, marginBottom: 8 },
      code: { fontFamily: mono, fontSize: 11.5 },
      acts: { display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 },
      hint: { fontSize: 11, opacity: 0.42, marginLeft: 'auto' },
    }

    function stageOf(run) {
      if (!run) return 'intake'
      if (run.status === 'closed' || run.closed === true) return 'closed'
      const p = run.currentStage || run.stage || 'intake'
      return STAGE[p] ? p : 'intake'
    }

    function RunCard(props) {
      const [open, setOpen] = useState(false)
      const run = props.run
      const stage = stageOf(run)
      const docs = Array.isArray(run.docs) ? run.docs : []
      const kind = { requirement: '需求文档', testCases: '用例文档' }
      return h('div', { style: S.card },
        h('div', { style: S.row, onClick: () => setOpen(!open) },
          h('span', { style: { opacity: 0.4, fontSize: 10 } }, open ? '▾' : '▸'),
          h('span', { style: { fontFamily: mono, fontSize: 12, opacity: 0.7 } }, run.requirementId || run.id || '-'),
          h('span', { style: { fontSize: 13, fontWeight: 600 } }, run.title || '(未命名需求)'),
          h('span', { style: S.chip }, STAGE[stage]),
          h('span', { style: { marginLeft: 'auto', fontFamily: mono, fontSize: 11.5, opacity: 0.55 } }, run.branch || '')),
        open ? h('div', { style: S.body },
          h('div', { style: S.meta },
            h('span', null, '项目 ', h('code', { style: S.code }, run.project || '-')),
            h('span', null, '分支 ', h('code', { style: S.code }, run.branch || '-'))),
          docs.length
            ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 } },
                docs.map((d, i) => h('a', { key: i, href: d.url, target: '_blank', rel: 'noreferrer', style: Object.assign({ textDecoration: 'none', color: 'inherit' }, S.chip) }, kind[d.kind] || '文档')))
            : h('div', { style: { fontSize: 11.5, opacity: 0.45, marginBottom: 8 } }, '还没有关联文档'),
          props.readOnly ? null : h('div', { style: S.acts },
            (ACTIONS[stage] || []).map((n) => h('button', { key: n, style: S.sm, onClick: () => props.onAction(n, run) }, ALABEL[n] || n)),
            h('span', { style: S.hint }, '流程未结束，可反复执行'),
            h('button', { style: S.gh, onClick: () => props.onAction('close', run) }, '标记完成')))
          : null)
    }

    function Panel() {
      const [state, setState] = useState({ status: 'idle', data: null, error: null })
      const [note, setNote] = useState(null)

      const load = useCallback(() => {
        setState((prev) => Object.assign({}, prev, { status: 'loading' }))
        fetch('/delivery/api/state?workspace=' + encodeURIComponent(WORKSPACE), { headers: { accept: 'application/json' } })
          .then((r) => r.json())
          .then((d) => setState({ status: 'ok', data: d, error: null }))
          .catch((e) => setState({ status: 'error', data: null, error: String(e && e.message ? e.message : e) }))
      }, [])

      useEffect(() => { load() }, [load])

      const onAction = (action, run) => {
        setNote({ kind: 'error', text: '执行中…' })
        fetch('/delivery/api/action', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: action, runId: run && run.id, workspace: WORKSPACE }),
        })
          .then((r) => r.json().then((b) => ({ ok: r.ok, body: b })))
          .then((res) => {
            const failed = !res.ok || (res.body && res.body.ok === false)
            setNote({ kind: failed ? 'error' : 'ok', text: res.body && res.body.error ? res.body.error.message : '已完成' })
            load()
          })
          .catch((e) => setNote({ kind: 'error', text: String(e && e.message ? e.message : e) }))
      }

      const data = state.data || {}
      const projects = (data.config && Array.isArray(data.config.projects)) ? data.config.projects : []
      const runs = Array.isArray(data.runs) ? data.runs : []
      const active = runs.filter((r) => stageOf(r) !== 'closed')
      const done = runs.filter((r) => stageOf(r) === 'closed')
      const checks = Array.isArray(data.checks) ? data.checks : []
      const busy = state.status === 'loading'
      const name = String(WORKSPACE).split('/').pop()

      return h('div', { style: S.root },
        h('div', { style: Object.assign({}, S.main, { maxWidth: 920, margin: '0 auto', width: '100%' }) },
          h('div', { style: S.bar },
            h('h1', { style: S.h1 }, '交付流程'),
            h('span', { style: S.sub }, name + (projects.length ? ' · ' + projects.map((x) => x.name).join(' / ') : ' · 无项目')),
            h('span', { style: { flex: 1 } }),
            h('button', { style: S.btn, onClick: load, disabled: busy }, busy ? '加载中…' : '刷新')),
          note ? h('div', { style: { fontSize: 12, padding: '8px 11px', borderRadius: 7, marginBottom: 12, border: note.kind === 'error' ? '1px solid rgba(220,38,38,.4)' : SUBTLE, background: note.kind === 'error' ? 'rgba(220,38,38,.08)' : 'transparent' } }, note.text) : null,
          h('div', { style: S.lb }, '环境'),
          h('div', { style: S.card },
            checks.length
              ? checks.map((c) => h('div', { key: c.name, style: { display: 'flex', gap: 10, fontSize: 12, padding: '2px 0' } },
                  h('span', { style: { width: 12, opacity: 0.9 } }, c.status === 'ok' ? '✓' : '!'),
                  h('span', { style: { minWidth: 140, opacity: 0.72 } }, c.name),
                  h('span', { style: { opacity: 0.5, wordBreak: 'break-all' } }, c.detail || '')))
              : h('div', { style: { fontSize: 12, opacity: 0.55 } }, busy ? '加载中…' : (state.error || '数据接口未接通'))),
          h('div', { style: S.lb }, '进行中'),
          active.length
            ? active.map((r) => h(RunCard, { key: r.id, run: r, onAction: onAction }))
            : h('div', { style: { fontSize: 12, opacity: 0.45, padding: '6px 0' } }, '还没有交付记录。'),
          done.length ? h('div', null,
            h('div', { style: S.lb }, '已完成'),
            done.map((r) => h(RunCard, { key: r.id, run: r, onAction: onAction, readOnly: true }))) : null))
    }

    function RailIcon() {
      return h('svg', { viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, style: { display: 'block' } },
        h('path', { d: 'M4 7h9' }), h('path', { d: 'M4 12h13' }), h('path', { d: 'M4 17h7' }),
        h('circle', { cx: 18.5, cy: 7, r: 2.1 }), h('circle', { cx: 20, cy: 17, r: 1.6 }))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: 'delivery', order: 20, label: () => '交付流程' }, RailIcon),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'delivery' }, Panel),
        )
      },
    }
  },
})
