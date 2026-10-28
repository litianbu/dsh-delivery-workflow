// Client half of the delivery-workflow bundle.
// Registers a sidebar panel icon (`sidebar.panellist`) and its page (`main`).
window.__ModuleLoader__.load({
  id: '@local/delivery-workflow',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // Workspace holding .delivery/config.json. The Host route requires it.
    const WORKSPACE = '/Users/runzhili/Desktop/biomap-delivery'
    const { useState, useEffect, useCallback } = React

    const t = {
      title: '交付流程',
      subtitle: '需求 → 验证 → 构建 → 部署',
      health: '环境体检',
      runs: '运行列表',
      actions: '操作',
      empty: '还没有运行。在对话里说「新建需求」即可创建。',
      refresh: '刷新',
      loading: '加载中…',
      noApi: '数据接口尚未接通（Host 侧 /delivery/api 未注册）',
    }

    const css = {
      page: {
        height: '100%',
        overflow: 'auto',
        padding: '24px 32px',
        font: 'inherit',
        color: 'inherit',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      },
      header: { display: 'flex', alignItems: 'baseline', gap: 12 },
      h1: { fontSize: 18, fontWeight: 600, margin: 0 },
      sub: { fontSize: 12, opacity: 0.6 },
      section: {
        border: '1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,0.22))',
        borderRadius: 8,
        padding: 16,
      },
      h2: { fontSize: 13, fontWeight: 600, margin: '0 0 10px' },
      muted: { fontSize: 12, opacity: 0.6, lineHeight: 1.6 },
      row: { display: 'flex', gap: 8, alignItems: 'center' },
      btn: {
        font: 'inherit',
        fontSize: 12,
        padding: '5px 12px',
        borderRadius: 6,
        cursor: 'pointer',
        color: 'inherit',
        background: 'var(--dsw-alias-bg-subtle, rgba(127,127,127,0.10))',
        border: '1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,0.28))',
      },
      pre: {
        fontSize: 11,
        lineHeight: 1.5,
        margin: 0,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        opacity: 0.85,
        maxHeight: 260,
        overflow: 'auto',
      },
    }

    function Icon(props) {
      const size = (props && props.size) || 18
      const active = !!(props && props.active)
      const stroke = active ? 'currentColor' : 'currentColor'
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke,
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { display: 'block', opacity: active ? 1 : 0.72 },
        },
        h('path', { d: 'M4 7h9' }),
        h('path', { d: 'M4 12h13' }),
        h('path', { d: 'M4 17h7' }),
        h('circle', { cx: 18.5, cy: 7, r: 2.1 }),
        h('circle', { cx: 20, cy: 17, r: 1.6 }),
      )
    }

    function Section(props) {
      return h('section', { style: css.section }, h('h2', { style: css.h2 }, props.title), props.children)
    }

    const STAGE_LABEL = { intake: '需求', develop: '开发', verify: '验证', build: '构建', deploy: '部署', closed: '已完成' }
    const STAGE_ACTIONS = {
      intake: ['verify'],
      develop: ['verify'],
      verify: ['verify', 'build'],
      build: ['verify', 'build', 'deploy'],
      deploy: ['verify', 'build', 'deploy'],
      closed: [],
    }
    const ACTION_LABEL = { verify: '验证', build: '构建', deploy: '部署' }
    const BORDER = '1px solid var(--dsw-alias-border-default, rgba(127,127,127,.3))'
    const SUBTLE = '1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.2))'
    const chipStyle = { fontSize: 11, padding: '1px 8px', borderRadius: 999, border: BORDER, opacity: 0.85 }
    const smallBtn = { font: 'inherit', fontSize: 12, padding: '3px 9px', borderRadius: 6, border: BORDER, background: 'transparent', color: 'inherit', cursor: 'pointer' }

    function stageOf(run) {
      if (!run) return 'intake'
      if (run.status === 'closed' || run.closed === true) return 'closed'
      const phase = run.currentStage || run.stage || 'intake'
      return STAGE_LABEL[phase] ? phase : 'intake'
    }

    function RunCard(props) {
      const run = props.run
      const [open, setOpen] = useState(false)
      const stage = stageOf(run)
      const actions = STAGE_ACTIONS[stage] || []
      const docs = Array.isArray(run.docs) ? run.docs : []
      const kind = { requirement: '需求文档', testCases: '用例文档' }
      const line = { display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flexWrap: 'wrap' }
      return h('div', { style: { border: SUBTLE, borderRadius: 9, padding: '10px 13px', marginBottom: 8 } },
        h('div', { style: line, onClick: () => setOpen(!open) },
          h('span', { style: { opacity: 0.4, fontSize: 10 } }, open ? '▾' : '▸'),
          h('span', { style: { fontFamily: 'ui-monospace, monospace', fontSize: 12, opacity: 0.7 } }, run.requirementId || run.id || '-'),
          h('span', { style: { fontSize: 13, fontWeight: 600 } }, run.title || '(未命名需求)'),
          h('span', { style: chipStyle }, STAGE_LABEL[stage]),
          h('span', { style: { marginLeft: 'auto', fontFamily: 'ui-monospace, monospace', fontSize: 11.5, opacity: 0.6 } }, run.branch || '')),
        open ? h('div', { style: { marginTop: 10, paddingTop: 10, borderTop: SUBTLE } },
          h('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, opacity: 0.72, marginBottom: 9 } },
            h('span', null, '项目 ', h('code', null, run.project || '-')),
            h('span', null, '分支 ', h('code', null, run.branch || '-'))),
          docs.length
            ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 9 } },
                docs.map((d, i) => h('a', { key: i, href: d.url, target: '_blank', rel: 'noreferrer', style: Object.assign({ textDecoration: 'none', color: 'inherit' }, chipStyle) }, kind[d.kind] || '文档')))
            : h('div', { style: { fontSize: 11.5, opacity: 0.5, marginBottom: 9 } }, '还没有关联文档'),
          h('div', { style: { display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' } },
            actions.map((name) => h('button', { key: name, style: smallBtn, onClick: () => props.onAction(name, run) }, ACTION_LABEL[name] || name)),
            h('span', { style: { fontSize: 11.5, opacity: 0.45, marginLeft: 'auto' } }, '流程未结束，可反复执行'),
            h('button', { style: Object.assign({}, smallBtn, { border: '1px solid transparent', opacity: 0.6 }), onClick: () => props.onAction('close', run) }, '标记完成')))
          : null)
    }

    function Panel() {
      const [state, setState] = useState({ status: 'idle', data: null, error: null })

      const load = useCallback(() => {
        setState((s) => ({ ...s, status: 'loading' }))
        const url = '/delivery/api/state?workspace=' + encodeURIComponent(WORKSPACE)
        Promise.resolve()
          .then(() => fetch(url, { headers: { accept: 'application/json' } }))
          .then((res) => {
            if (!res.ok) throw new Error('HTTP ' + res.status)
            return res.json()
          })
          .then((data) => setState({ status: 'ok', data, error: null }))
          .catch((err) => setState({ status: 'error', data: null, error: String(err && err.message ? err.message : err) }))
      }, [])

      useEffect(() => {
        load()
      }, [load])

      const [note, setNote] = useState(null)
      const onAction = (action, run) => {
        setNote({ kind: 'pending', text: '执行中…' })
        fetch('/delivery/api/action', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: action, runId: run && run.id, workspace: WORKSPACE }),
        })
          .then((res) => res.json().then((body) => ({ ok: res.ok, body: body })))
          .then((r) => {
            const failed = !r.ok || (r.body && r.body.ok === false)
            const msg = r.body && r.body.error ? r.body.error.message : '已提交'
            setNote({ kind: failed ? 'error' : 'ok', text: msg })
            load()
          })
          .catch((err) => setNote({ kind: 'error', text: String(err && err.message ? err.message : err) }))
      }

      const busy = state.status === 'loading'

      return h(
        'div',
        { style: css.page },
        h(
          'div',
          { style: css.header },
          h('h1', { style: css.h1 }, t.title),
          h('span', { style: css.sub }, t.subtitle),
        ),
        h(
          Section,
          { title: t.health },
          state.status === 'ok' && state.data && Array.isArray(state.data.checks)
            ? h(
                'div',
                { style: { display: 'grid', gap: 6 } },
                state.data.checks.map((c) =>
                  h(
                    'div',
                    { key: c.name, style: { display: 'flex', gap: 10, fontSize: 12 } },
                    h('span', { style: { width: 12, opacity: 0.9 } }, c.status === 'ok' ? '✓' : '!'),
                    h('span', { style: { minWidth: 190, opacity: 0.75 } }, c.name),
                    h('span', { style: { opacity: 0.55 } }, c.detail || ''),
                  ),
                ),
              )
            : h(
                'p',
                { style: css.muted },
                busy ? t.loading : state.status === 'error' ? t.noApi : t.loading,
                state.error ? h('span', { style: { display: 'block', opacity: 0.5 } }, state.error) : null,
              ),
        ),
        h(
          Section,
          { title: t.runs },
          note
            ? h('div', { style: { fontSize: 12, padding: '8px 11px', borderRadius: 7, marginBottom: 9, border: note.kind === 'error' ? '1px solid rgba(220,38,38,.4)' : SUBTLE, background: note.kind === 'error' ? 'rgba(220,38,38,.08)' : 'transparent' } }, note.text)
            : null,
          state.status === 'ok' && state.data && Array.isArray(state.data.runs) && state.data.runs.length
            ? h('div', null, state.data.runs.map((r) => h(RunCard, { key: r.id, run: r, onAction: onAction })))
            : h('p', { style: css.muted }, t.empty),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'delivery', order: 20, label: () => t.title },
            Icon,
          ),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'delivery' }, Panel),
        )
      },
    }
  },
})