// Client half of the delivery-workflow bundle.
// Single column: the host shell already owns navigation, so this page never
// draws its own rail. A run card is one collapsed row until it is opened.
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

    // Labels for the phases the host actually records (see lib/run.js PHASES).
    const LABEL = {
      intake: '需求', init: '初始化', develop: '开发', verify: '验证',
      build: '构建', deploy: '部署', accept: '验收', report: '报告', closed: '已完成',
    }
    const ORDER = ['intake', 'init', 'develop', 'verify', 'build', 'deploy', 'accept', 'report']
    // A delivery stays open and re-runnable until someone marks it finished,
    // so every live run offers these, in this order, however often it is run.
    const OPS = ['verify', 'build', 'deploy']

    const S = {
      main: { height: '100%', minHeight: 0, overflow: 'auto', padding: '22px 28px 70px', font: 'inherit', color: 'inherit', maxWidth: 920, margin: '0 auto', width: '100%', boxSizing: 'border-box' },
      bar: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' },
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
      input: { font: 'inherit', fontSize: 12, padding: '5px 8px', borderRadius: 6, border: BORDER, background: 'transparent', color: 'inherit', width: '100%', boxSizing: 'border-box' },
      empty: { fontSize: 12, opacity: 0.45, padding: '6px 0' },
      fieldLabel: { fontSize: 11, opacity: 0.55, marginBottom: 4 },
    }

    // A run is finished only when a human marks it finished; nothing here
    // closes a delivery on its own.
    function isClosed(run) {
      return Boolean(run && (run.closed === true || run.status === 'closed'))
    }

    // The current stage is the phase the host is running, else the furthest
    // phase that already ended, else intake.
    function stageOf(run) {
      if (isClosed(run)) return 'closed'
      const phases = (run && run.phases) || {}
      for (let i = 0; i < ORDER.length; i += 1) {
        const entry = phases[ORDER[i]]
        if (entry && entry.status === 'running') return ORDER[i]
      }
      let last = ''
      for (let i = 0; i < ORDER.length; i += 1) {
        const entry = phases[ORDER[i]]
        const status = entry && entry.status
        if (status === 'passed' || status === 'failed' || status === 'blocked') last = ORDER[i]
      }
      return last || 'intake'
    }

    function requirementOf(run) {
      return (run && run.requirement) || {}
    }

    // Documents are whatever the run recorded: the Feishu link plus the spec
    // files the host wrote. An empty list is normal before intake runs.
    function docsOf(run) {
      const out = []
      const requirement = requirementOf(run)
      if (requirement.docUrl) out.push({ label: '需求文档', url: requirement.docUrl })
      const artifacts = (run && run.artifacts) || {}
      if (artifacts.requirement) out.push({ label: '需求 spec', url: '' })
      if (artifacts.testcases) out.push({ label: '用例 spec', url: '' })
      return out
    }

    function field(label, node) {
      return h('label', { style: { display: 'block', marginBottom: 10 } },
        h('div', { style: S.fieldLabel }, label),
        node)
    }

    function RunCard(props) {
      const [open, setOpen] = useState(false)
      const run = props.run
      const requirement = requirementOf(run)
      const stage = stageOf(run)
      const docs = docsOf(run)
      const projects = Array.isArray(run.projects) ? run.projects : []
      const live = stage !== 'closed'
      return h('div', { style: S.card },
        h('div', { style: S.row, onClick: () => setOpen(!open) },
          h('span', { style: { opacity: 0.4, fontSize: 10 } }, open ? '\u25be' : '\u25b8'),
          h('span', { style: { fontFamily: mono, fontSize: 12, opacity: 0.7 } }, requirement.id || run.id || '-'),
          h('span', { style: { fontSize: 13, fontWeight: 600 } }, requirement.title || '(未命名需求)'),
          h('span', { style: S.chip }, LABEL[stage] || stage),
          h('span', { style: { marginLeft: 'auto', fontFamily: mono, fontSize: 11.5, opacity: 0.55 } }, run.branch || '')),
        open ? h('div', { style: S.body },
          h('div', { style: S.meta },
            h('span', null, '项目 ', h('code', { style: S.code }, projects.join(', ') || '-')),
            h('span', null, '分支 ', h('code', { style: S.code }, run.branch || '-')),
            h('span', null, '环境 ', h('code', { style: S.code }, run.env || '-'))),
          docs.length
            ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 } },
                docs.map((doc, i) => doc.url
                  ? h('a', { key: i, href: doc.url, target: '_blank', rel: 'noreferrer', style: Object.assign({ textDecoration: 'none', color: 'inherit' }, S.chip) }, doc.label)
                  : h('span', { key: i, style: Object.assign({ opacity: 0.6 }, S.chip) }, doc.label)))
            : h('div', { style: { fontSize: 11.5, opacity: 0.45, marginBottom: 8 } }, '还没有关联文档'),
          live ? h('div', { style: S.acts },
            OPS.map((name) => h('button', {
              key: name,
              style: Object.assign({}, S.sm, props.busy === name ? { opacity: 0.5 } : null),
              disabled: props.busy === name,
              onClick: () => props.onAction(name, run),
            }, props.busy === name ? '执行中…' : (LABEL[name] || name))),
            h('span', { style: S.hint }, '流程未结束，可反复执行'),
            h('button', { style: S.gh, onClick: () => props.onAction('close', run) }, '标记完成')) : null)
          : null)
    }

    function Panel() {
      const [state, setState] = useState({ status: 'idle', data: null, error: null })
      const [note, setNote] = useState(null)
      const [busy, setBusy] = useState('')
      const [creating, setCreating] = useState(false)
      const [form, setForm] = useState({ requirementId: '', title: '', docUrl: '', branch: '', env: '', projects: [] })

      const load = useCallback(() => {
        setState((prev) => Object.assign({}, prev, { status: 'loading' }))
        fetch('/delivery/api/state?workspace=' + encodeURIComponent(WORKSPACE), { headers: { accept: 'application/json' } })
          .then((r) => r.json())
          .then((d) => setState({ status: 'ok', data: d, error: null }))
          .catch((e) => setState({ status: 'error', data: null, error: String(e && e.message ? e.message : e) }))
      }, [])

      useEffect(() => { load() }, [load])

      // Seed the form from config once it arrives, without clobbering typing.
      useEffect(() => {
        const data = state.data
        if (!data || !data.config) return
        const names = (data.config.projects || []).map((p) => p.name)
        const envs = data.config.envs || []
        setForm((prev) => {
          if (prev.projects.length || prev.env) return prev
          return Object.assign({}, prev, { projects: names, env: envs[0] || 'test' })
        })
      }, [state.data])

      const post = useCallback((action, extra) => {
        setBusy(action)
        const args = Object.assign({ workspace: WORKSPACE }, extra || {})
        return fetch('/delivery/api/action', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: action, args: args }),
        })
          .then((r) => r.json().then((b) => ({ ok: r.ok, body: b })))
          .then((res) => {
            const failed = !res.ok || res.body.ok === false
            const err = res.body && res.body.error
            if (failed) {
              setNote({ kind: 'error', text: err ? ((err.code || 'ERROR') + ' · ' + (err.message || '')) : '执行失败' })
            } else {
              const summary = String((res.body && res.body.summary) || '已完成')
              setNote({ kind: 'ok', text: summary.split('\n')[0] })
            }
            load()
            return !failed
          })
          .catch((e) => {
            setNote({ kind: 'error', text: String(e && e.message ? e.message : e) })
            return false
          })
          .finally(() => setBusy(''))
      }, [load])

      const onAction = (action, run) => post(action, { run: run.id })

      const toggleProject = (name) => setForm((prev) => {
        const has = prev.projects.indexOf(name) >= 0
        return Object.assign({}, prev, {
          projects: has ? prev.projects.filter((x) => x !== name) : prev.projects.concat([name]),
        })
      })

      const submitNew = () => {
        const requirementId = String(form.requirementId || '').trim()
        const title = String(form.title || '').trim()
        if (!requirementId || !title) {
          setNote({ kind: 'error', text: '需求 ID 和标题都要填' })
          return
        }
        if (!form.projects.length) {
          setNote({ kind: 'error', text: '至少选一个项目' })
          return
        }
        const extra = { requirementId: requirementId, title: title, env: form.env || 'test', projects: form.projects.slice() }
        const docUrl = String(form.docUrl || '').trim()
        const branch = String(form.branch || '').trim()
        if (docUrl) extra.docUrl = docUrl
        if (branch) extra.branch = branch
        post('new', extra).then((ok) => {
          if (!ok) return
          setCreating(false)
          setForm((prev) => Object.assign({}, prev, { requirementId: '', title: '', docUrl: '', branch: '' }))
        })
      }

      const data = state.data || {}
      const projects = (data.config && Array.isArray(data.config.projects)) ? data.config.projects : []
      const envs = (data.config && Array.isArray(data.config.envs)) ? data.config.envs : []
      const runs = Array.isArray(data.runs) ? data.runs : []
      const active = runs.filter((r) => stageOf(r) !== 'closed')
      const done = runs.filter((r) => stageOf(r) === 'closed')
      const checks = Array.isArray(data.checks) ? data.checks : []
      const loading = state.status === 'loading'
      const name = String(WORKSPACE).split('/').pop()

      const formNode = h('div', { style: Object.assign({}, S.card, { marginBottom: 14 }) },
        h('div', { style: { fontSize: 12, opacity: 0.6, marginBottom: 12 } }, '填需求信息，创建一条交付记录'),
        field('需求 ID', h('input', {
          style: S.input, value: form.requirementId, placeholder: 'REQ-1234',
          onChange: (e) => setForm(Object.assign({}, form, { requirementId: e.target.value })),
        })),
        field('标题', h('input', {
          style: S.input, value: form.title, placeholder: '一句话说明这次改什么',
          onChange: (e) => setForm(Object.assign({}, form, { title: e.target.value })),
        })),
        field('飞书文档链接（可选）', h('input', {
          style: S.input, value: form.docUrl, placeholder: 'https://xxx.feishu.cn/docx/...',
          onChange: (e) => setForm(Object.assign({}, form, { docUrl: e.target.value })),
        })),
        field('项目', h('div', { style: { display: 'flex', gap: 14, flexWrap: 'wrap', paddingTop: 2 } },
          projects.length
            ? projects.map((p) => h('label', { key: p.name, style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' } },
                h('input', { type: 'checkbox', checked: form.projects.indexOf(p.name) >= 0, onChange: () => toggleProject(p.name) }),
                p.name))
            : h('span', { style: { fontSize: 12, opacity: 0.5 } }, '配置里没有项目'))),
        field('环境', h('select', {
          style: S.input, value: form.env,
          onChange: (e) => setForm(Object.assign({}, form, { env: e.target.value })),
        }, (envs.length ? envs : ['test']).map((v) => h('option', { key: v, value: v }, v)))),
        field('分支（可选，留空自动生成）', h('input', {
          style: S.input, value: form.branch, placeholder: 'feat/...',
          onChange: (e) => setForm(Object.assign({}, form, { branch: e.target.value })),
        })),
        h('div', { style: { display: 'flex', gap: 8, marginTop: 2 } },
          h('button', { style: S.btn, disabled: busy === 'new', onClick: submitNew }, busy === 'new' ? '创建中…' : '创建'),
          h('button', { style: S.gh, onClick: () => setCreating(false) }, '取消')))

      return h('div', { style: S.main },
        h('div', { style: S.bar },
          h('h1', { style: S.h1 }, '交付流程'),
          h('span', { style: S.sub }, name + (projects.length ? ' · ' + projects.map((p) => p.name).join(' / ') : ' · 无项目')),
          h('span', { style: { flex: 1 } }),
          h('button', { style: S.btn, onClick: () => setCreating(!creating) }, creating ? '收起' : '新建需求'),
          h('button', { style: S.btn, onClick: load, disabled: loading }, loading ? '加载中…' : '刷新')),
        note ? h('div', {
          style: {
            fontSize: 12, padding: '8px 11px', borderRadius: 7, marginBottom: 12,
            border: note.kind === 'error' ? '1px solid rgba(220,38,38,.4)' : SUBTLE,
            background: note.kind === 'error' ? 'rgba(220,38,38,.08)' : 'transparent',
          },
        }, note.text) : null,
        creating ? formNode : null,
        h('div', { style: S.lb }, '环境'),
        h('div', { style: S.card },
          checks.length
            ? checks.map((c) => h('div', { key: c.name, style: { display: 'flex', gap: 10, fontSize: 12, padding: '2px 0' } },
                h('span', { style: { width: 12, opacity: 0.9 } }, c.status === 'ok' ? '\u2713' : '!'),
                h('span', { style: { minWidth: 140, opacity: 0.72 } }, c.name),
                h('span', { style: { opacity: 0.5, wordBreak: 'break-all' } }, c.detail || '')))
            : h('div', { style: S.empty }, loading ? '加载中…' : (state.error || '数据接口未接通'))),
        h('div', { style: S.lb }, '进行中'),
        active.length
          ? active.map((r) => h(RunCard, { key: r.id, run: r, onAction: onAction, busy: busy }))
          : h('div', { style: S.empty }, '还没有进行中的交付。点右上角「新建需求」开始。'),
        done.length ? h('div', null,
          h('div', { style: S.lb }, '已完成'),
          done.map((r) => h(RunCard, { key: r.id, run: r, onAction: onAction, busy: '' }))) : null)
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