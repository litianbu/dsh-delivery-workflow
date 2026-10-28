// Client half of the delivery-workflow bundle.
// Registers a sidebar panel icon (`sidebar.panellist`) and its page (`main`).
window.__ModuleLoader__.load({
  id: '@local/delivery-workflow',
  factory(require) {
    const React = require('react')
    const h = React.createElement
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

    function Panel() {
      const [state, setState] = useState({ status: 'idle', data: null, error: null })

      const load = useCallback(() => {
        setState((s) => ({ ...s, status: 'loading' }))
        const url = '/delivery/api/state'
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
          state.status === 'ok' && state.data && Array.isArray(state.data.runs) && state.data.runs.length
            ? h(
                'div',
                { style: { display: 'grid', gap: 4, fontSize: 12 } },
                state.data.runs.map((r) =>
                  h(
                    'div',
                    { key: r.id, style: { display: 'flex', gap: 10 } },
                    h('span', { style: { fontFamily: 'ui-monospace, monospace', opacity: 0.85 } }, r.id),
                    h('span', { style: { opacity: 0.55 } }, r.title || ''),
                  ),
                ),
              )
            : h('p', { style: css.muted }, t.empty),
        ),
        h(
          Section,
          { title: t.actions },
          h(
            'div',
            { style: css.row },
            h('button', { type: 'button', style: css.btn, onClick: load, disabled: busy }, t.refresh),
          ),
          h(
            'pre',
            { style: { ...css.pre, marginTop: 12, maxHeight: 160 } },
            state.status === 'ok' ? JSON.stringify(state.data, null, 2) : state.error || '',
          ),
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