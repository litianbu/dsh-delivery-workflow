// Client half of the delivery-workflow bundle.
// Single column: the host shell already owns navigation, so this page never
// draws its own rail. Layout follows mockup/delivery-page-v2.html.
window.__ModuleLoader__.load({
  id: '@local/delivery-workflow',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    const WORKSPACE = '/Users/runzhili/Desktop/biomap-delivery'
    // Only the brand tokens below are guaranteed to exist in this shell;
    // everything else is a concrete colour that works in light and dark themes.
    const ACCENT = 'var(--dsw-alias-brand-primary, #2563eb)'
    const PRIMARY_BG = 'var(--dsw-alias-button-primary-fill, #2563eb)'
    // brand-primary-invert is NOT "text on brand": in this theme it resolves to
    // the same dark neutral as the fill, which made the label invisible on the
    // button. bg-base is the page background, so it always inverts the fill.
    const PRIMARY_FG = 'var(--dsw-alias-bg-base, #ffffff)'
    const BORDER = 'rgba(127,127,127,.22)'
    const STRONG = 'rgba(127,127,127,.38)'
    const CHIP_BG = 'rgba(127,127,127,.12)'
    const CARD_BG = 'rgba(127,127,127,.05)'
    const FIELD_BG = 'rgba(127,127,127,.08)'
    const OK = '#16a34a'
    const OK_BG = 'rgba(22,163,74,.10)'
    const OK_BD = 'rgba(22,163,74,.40)'
    const ACCENT_BG = 'rgba(127,127,127,.14)'
    const DANGER = 'rgba(220,38,38,.9)'
    const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace'

    const LABEL = {
      intake: '需求', init: '初始化', develop: '开发', verify: '验证',
      build: '构建', deploy: '部署', accept: '验收', report: '报告', closed: '归档',
    }
    const ORDER = ['intake', 'init', 'develop', 'verify', 'build', 'deploy', 'accept', 'report']
    // The five stops the page draws in a card, and the phases behind each one.
    const STOPS = [
      { label: '需求', phases: ['intake'] },
      { label: '开发', phases: ['init', 'develop'] },
      { label: '验证', phases: ['verify'] },
      { label: '构建', phases: ['build'] },
      { label: '部署', phases: ['deploy'] },
    ]
    const OPS = ['verify', 'build', 'deploy']

    const S = {
      wrap: { height: '100%', minHeight: 0, overflow: 'auto', font: 'inherit', color: 'inherit', boxSizing: 'border-box' },
      page: { maxWidth: 980, margin: '0 auto', padding: '26px 32px 80px' },
      head: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22, flexWrap: 'wrap' },
      h1: { fontSize: 17, margin: 0, fontWeight: 600 },
      sub: { opacity: 0.42, fontSize: 12 },
      spacer: { flex: 1 },
      ws: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: 0.75, border: '1px solid ' + BORDER, borderRadius: 7, padding: '5px 10px', background: CARD_BG },
      primary: { font: 'inherit', fontSize: 12, padding: '6px 13px', borderRadius: 7, border: '1px solid ' + PRIMARY_BG, background: PRIMARY_BG, color: PRIMARY_FG, cursor: 'pointer', fontWeight: 500, whiteSpace: 'nowrap' },
      ghost: { font: 'inherit', fontSize: 12, padding: '6px 13px', borderRadius: 7, border: '1px solid transparent', background: 'transparent', color: 'inherit', opacity: 0.6, cursor: 'pointer' },
      sm: { font: 'inherit', fontSize: 12, padding: '4px 10px', borderRadius: 7, border: '1px solid ' + STRONG, background: CARD_BG, color: 'inherit', cursor: 'pointer' },
      smGhost: { font: 'inherit', fontSize: 12, padding: '4px 10px', borderRadius: 7, border: '1px solid transparent', background: 'transparent', color: 'inherit', opacity: 0.55, cursor: 'pointer' },
      sectionhead: { display: 'flex', alignItems: 'center', gap: 8, margin: '26px 0 10px', fontSize: 12, opacity: 0.6 },
      count: { opacity: 0.65 },
      card: { border: '1px solid ' + BORDER, borderRadius: 10, background: CARD_BG, padding: '15px 17px', marginBottom: 12 },
      top: { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', cursor: 'pointer' },
      id: { fontFamily: mono, fontSize: 12, opacity: 0.62 },
      title: { fontSize: 14, fontWeight: 600 },
      badgeBase: { fontSize: 11, padding: '1px 8px', borderRadius: 999, border: '1px solid ' + STRONG, opacity: 0.7 },
      meta: { display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 9, opacity: 0.62, fontSize: 12 },
      code: { fontFamily: mono, background: CHIP_BG, padding: '1px 6px', borderRadius: 5 },
      docs: { display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 10 },
      doc: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '3px 9px', borderRadius: 6, border: '1px solid ' + BORDER, background: 'transparent', color: 'inherit', textDecoration: 'none' },
      docKind: { opacity: 0.45, fontSize: 11 },
      phases: { display: 'flex', alignItems: 'center', margin: '14px 0 12px', flexWrap: 'wrap' },
      bar: { width: 18, height: 1, background: STRONG, margin: '0 9px' },
      actions: { display: 'flex', gap: 7, flexWrap: 'wrap', paddingTop: 12, borderTop: '1px solid ' + BORDER, alignItems: 'center' },
      hint: { fontSize: 12, opacity: 0.42, marginLeft: 'auto' },
      empty: { fontSize: 12, opacity: 0.42, padding: '2px 0' },
      wizard: { border: '1px solid ' + STRONG, borderRadius: 12, padding: '20px 22px', background: CARD_BG, marginBottom: 12 },
      wizh2: { fontSize: 14, margin: '0 0 4px' },
      lead: { opacity: 0.6, fontSize: 12, margin: '0 0 18px' },
      steplabel: { fontSize: 12, fontWeight: 600, marginBottom: 8 },
      field: { display: 'flex', alignItems: 'center', gap: 8, border: '1px solid ' + STRONG, borderRadius: 7, padding: '7px 10px', background: FIELD_BG, fontSize: 12, marginBottom: 7 },
      fieldVal: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      input: { font: 'inherit', fontSize: 12, border: '1px solid ' + STRONG, borderRadius: 7, padding: '7px 10px', background: FIELD_BG, color: 'inherit', width: '100%', boxSizing: 'border-box' },
      bare: { font: 'inherit', fontSize: 12, border: 'none', padding: 0, background: 'transparent', color: 'inherit', flex: 1, minWidth: 0, outline: 'none' },
      select: { font: 'inherit', fontSize: 12, border: '1px solid ' + STRONG, borderRadius: 7, padding: '6px 10px', background: FIELD_BG, color: 'inherit', cursor: 'pointer', maxWidth: 260 },
      // A single configured project cannot be expressed by a <select>, and a
      // transparent select reads as plain text in this shell, so projects are
      // explicit clickable rows with a visible selected state.
      projRow: { display: 'flex', alignItems: 'center', gap: 8, width: '100%', maxWidth: 520, boxSizing: 'border-box', font: 'inherit', fontSize: 12, color: 'inherit', textAlign: 'left', padding: '8px 10px', borderRadius: 7, border: '1px solid ' + BORDER, background: FIELD_BG, cursor: 'pointer' },
      projOn: { border: '1px solid ' + ACCENT, background: ACCENT_BG },
      tag: { flex: '0 0 auto', fontSize: 11, padding: '1px 8px', borderRadius: 999, color: OK, border: '1px solid ' + OK_BD, background: OK_BG },
      note: { fontSize: 11, opacity: 0.42, marginTop: 6 },
      warn: { fontSize: 11, color: DANGER, marginTop: 6 },
      inline: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      wizfoot: { display: 'flex', gap: 8, alignItems: 'center', paddingTop: 16 },
    }

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

    function badgeOf(run, stage) {
      if (stage === 'closed') return { text: '已归档', tone: 'plain' }
      const phases = run.phases || {}
      const deployed = phases.deploy && phases.deploy.status === 'passed'
      if (deployed) return { text: '已部署 ' + (run.env || ''), tone: 'ok' }
      const word = {
        intake: '待开发', init: '初始化中', develop: '开发中', verify: '验证中',
        build: '构建中', deploy: '部署中', accept: '验收中', report: '报告',
      }[stage] || stage
      return { text: word, tone: 'live' }
    }

    function badgeStyle(tone) {
      if (tone === 'ok') return Object.assign({}, S.badgeBase, { color: OK, border: '1px solid ' + OK_BD, background: OK_BG, opacity: 1 })
      if (tone === 'live') return Object.assign({}, S.badgeBase, { color: ACCENT, border: '1px solid ' + ACCENT, background: ACCENT_BG, opacity: 1 })
      return S.badgeBase
    }

    function requirementOf(run) {
      return (run && run.requirement) || {}
    }

    /** Every Feishu link on the run, newest field shape first. */
    function docsOf(run) {
      const out = []
      const requirement = requirementOf(run)
      const urls = Array.isArray(requirement.docUrls) && requirement.docUrls.length
        ? requirement.docUrls
        : (requirement.docUrl ? [requirement.docUrl] : [])
      urls.forEach((url, i) => {
        out.push({ label: urls.length > 1 ? '飞书文档 ' + (i + 1) : '需求文档', kind: '飞书', url: url })
      })
      const artifacts = (run && run.artifacts) || {}
      if (artifacts.requirement) out.push({ label: '需求 spec', kind: '已生成', url: '' })
      if (artifacts.testcases) out.push({ label: '用例 spec', kind: '已生成', url: '' })
      return out
    }

    /** Accept both the array returned by the Host and a name-keyed map. */
    function projectList(raw) {
      if (Array.isArray(raw)) {
        return raw
          .filter((item) => item && typeof item === 'object')
          .map((item, index) => ({ name: item.name || 'project-' + index, path: item.path || '' }))
      }
      if (raw && typeof raw === 'object') {
        return Object.keys(raw).map((name) => ({ name: name, path: (raw[name] && raw[name].path) || '' }))
      }
      return []
    }

    function Timeline(props) {
      const phases = (props.run && props.run.phases) || {}
      const stage = props.stage
      const nodes = []
      STOPS.forEach((stop, index) => {
        if (index > 0) nodes.push(h('span', { key: 'bar' + index, style: S.bar }))
        let done = false
        let now = false
        stop.phases.forEach((name) => {
          const entry = phases[name]
          if (entry && entry.status === 'passed') done = true
          if (name === stage) now = true
        })
        const mark = done ? '\u2713' : (now ? '\u25cf' : '\u25cb')
        const markStyle = done
          ? { border: '1px solid ' + OK_BD, color: OK }
          : (now ? { border: '1px solid ' + ACCENT, color: ACCENT, background: ACCENT_BG } : { border: '1px solid ' + STRONG })
        nodes.push(h('span', {
          key: stop.label,
          style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: now ? 1 : (done ? 0.75 : 0.42), fontWeight: now ? 500 : 400 },
        },
          h('span', { style: Object.assign({ width: 16, height: 16, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 10 }, markStyle) }, mark),
          stop.label))
      })
      return h('div', { style: S.phases }, nodes)
    }

    function RunCard(props) {
      const [open, setOpen] = useState(false)
      const run = props.run
      const requirement = requirementOf(run)
      const stage = stageOf(run)
      const badge = badgeOf(run, stage)
      const docs = docsOf(run)
      const projects = Array.isArray(run.projects) ? run.projects : []
      const live = stage !== 'closed'
      return h('div', { style: Object.assign({}, S.card, { opacity: live ? 1 : 0.72 }) },
        h('div', { style: S.top, onClick: () => setOpen(!open) },
          h('span', { style: { opacity: 0.4, fontSize: 10 } }, open ? '\u25be' : '\u25b8'),
          h('span', { style: S.id }, requirement.id || run.id || '-'),
          h('span', { style: S.title }, requirement.title || '(未命名需求)'),
          h('span', { style: badgeStyle(badge.tone) }, badge.text),
          h('span', { style: { marginLeft: 'auto', fontFamily: mono, fontSize: 11.5, opacity: 0.5 } }, run.branch || '')),
        open ? h('div', null,
          docs.length
            ? h('div', { style: S.docs }, docs.map((doc, i) => doc.url
                ? h('a', { key: i, href: doc.url, target: '_blank', rel: 'noreferrer', style: S.doc }, doc.label, ' ', h('span', { style: S.docKind }, doc.kind))
                : h('span', { key: i, style: Object.assign({}, S.doc, { opacity: 0.7 }) }, doc.label, ' ', h('span', { style: S.docKind }, doc.kind))))
            : null,
          h('div', { style: S.meta },
            h('span', null, '项目 ', h('code', { style: S.code }, projects.join(', ') || '-')),
            h('span', null, '分支 ', h('code', { style: S.code }, run.branch || '-')),
            h('span', null, '环境 ', h('code', { style: S.code }, run.env || '-')),
            run.sessionId ? h('span', null, '会话 ', h('code', { style: S.code }, run.sessionId)) : null,
            stage === 'closed' && run.closedAt ? h('span', null, String(run.closedAt).slice(0, 10) + ' 手动标记完成') : null),
          h(Timeline, { run: run, stage: stage }),
          live ? h('div', { style: S.actions },
            OPS.map((name) => h('button', {
              key: name,
              style: Object.assign({}, S.sm, props.busy === name ? { opacity: 0.5 } : null),
              disabled: props.busy === name,
              onClick: () => props.onAction(name, run),
            }, props.busy === name ? '执行中…' : (LABEL[name] || name))),
            h('span', { style: S.hint }, '流程未结束：随时可重跑'),
            h('button', { style: S.smGhost, onClick: () => props.onAction('close', run) }, '标记完成')) : null)
          : null)
    }

    function Step(props) {
      return h('div', {
        style: { display: 'flex', gap: 14, padding: '14px 0', borderTop: props.first ? 'none' : '1px solid ' + BORDER, paddingTop: props.first ? 0 : 14 },
      },
        h('div', {
          style: {
            flex: '0 0 22px', height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 11,
            background: props.on ? ACCENT : CHIP_BG, color: props.on ? PRIMARY_FG : 'inherit', opacity: props.on ? 1 : 0.7,
          },
        }, String(props.no)),
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { style: S.steplabel }, props.label),
          props.children))
    }

    function docKindOf(url) {
      const text = String(url || '')
      if (!text) return ''
      if (/sheets|\u8868\u683c/i.test(text)) return '用例文档'
      if (/docx|docs|wiki|\u6587\u6863/i.test(text)) return '需求文档'
      return '飞书链接'
    }

    function Wizard(props) {
      const [v, setV] = useState({
        requirementId: '',
        title: '',
        docs: [''],
        project: '',
        env: props.envs[0] || 'test',
        base: '',
        branch: '',
      })
      const [br, setBr] = useState({ status: 'idle', local: [], current: '', blocking: [], error: null })

      // Fall back to the first configured project so the form is usable even
      // before the user clicks a row (and when only one project exists).
      const projectName = v.project || (props.projects[0] && props.projects[0].name) || ''

      useEffect(() => {
        if (!projectName) {
          setBr({ status: 'idle', local: [], current: '', blocking: [], error: null })
          return undefined
        }
        let live = true
        setBr({ status: 'loading', local: [], current: '', blocking: [], error: null })
        fetch('/delivery/api/branches?workspace=' + encodeURIComponent(WORKSPACE) + '&project=' + encodeURIComponent(projectName))
          .then((r) => r.json().then((b) => ({ ok: r.ok, b: b })))
          .then((res) => {
            if (!live) return
            if (!res.ok || res.b.ok === false) {
              const err = (res.b && res.b.error && res.b.error.message) || '读取分支失败'
              setBr({ status: 'error', local: [], current: '', blocking: [], error: err })
              return
            }
            const local = res.b.local || []
            setBr({ status: 'ok', local: local, current: res.b.current || '', blocking: res.b.blocking || [], error: null })
            setV((prev) => (prev.base || !local.length ? prev : Object.assign({}, prev, { base: res.b.current || local[0] })))
          })
          .catch((e) => {
            if (live) setBr({ status: 'error', local: [], current: '', blocking: [], error: String((e && e.message) || e) })
          })
        return () => { live = false }
      }, [projectName])

      const set = (key) => (e) => {
        const next = Object.assign({}, v)
        next[key] = e.target.value
        setV(next)
      }
      const setDoc = (index) => (e) => {
        const docs = v.docs.slice()
        docs[index] = e.target.value
        setV(Object.assign({}, v, { docs: docs }))
      }
      const addDoc = () => setV(Object.assign({}, v, { docs: v.docs.concat(['']) }))
      const dropDoc = (index) => setV(Object.assign({}, v, { docs: v.docs.filter((_, i) => i !== index) }))
      // Selecting the project that is already active must not disturb the
      // branch choice: with a single configured project the fallback has
      // already picked it, so a "change" here could only reset 基于.
      const pickProject = (name) => {
        if (!name || name === projectName) return
        setV(Object.assign({}, v, { project: name, base: '' }))
      }

      const docUrls = v.docs.map((item) => String(item || '').trim()).filter(Boolean)

      const submit = () => {
        const id = String(v.requirementId || '').trim()
        const title = String(v.title || '').trim()
        if (!id || !title) { props.onWarn('需求 ID 和标题都要填'); return }
        if (!projectName) { props.onWarn('至少选一个项目'); return }
        if (br.status === 'error') { props.onWarn('读不到分支：' + br.error); return }
        const extra = {
          requirementId: id,
          title: title,
          env: v.env || 'test',
          projects: [projectName],
          createBranch: true,
          createSession: true,
        }
        if (v.base) extra.base = v.base
        if (v.branch.trim()) extra.branch = v.branch.trim()
        if (docUrls.length) { extra.docUrls = docUrls; extra.docUrl = docUrls[0] }
        props.onSubmit(extra)
      }

      const branchChoices = br.local.length ? br.local : (br.current ? [br.current] : [])

      return h('div', { style: S.wizard },
        h('h2', { style: S.wizh2 }, '新建交付'),
        h('p', { style: S.lead }, '填需求号 → 贴飞书文档 → 选项目 → 定分支，四步走完开始开发。'),
        h(Step, { no: 1, label: '需求标识', on: true, first: true },
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            h('input', {
              style: Object.assign({}, S.input, { flex: '0 0 200px', width: 'auto' }), value: v.requirementId,
              placeholder: '需求 ID，如 TONGXI-142', onChange: set('requirementId'),
            }),
            h('input', {
              style: Object.assign({}, S.input, { flex: 1, minWidth: 200 }), value: v.title,
              placeholder: '一句话标题', onChange: set('title'),
            })),
          h('div', { style: S.note }, '需求 ID 会进入分支名和 run 目录，创建后不建议改。')),
        h(Step, { no: 2, label: '飞书文档', on: true },
          v.docs.map((doc, i) => {
            const kind = docKindOf(doc)
            return h('div', { key: i, style: S.field },
              h('span', { style: { opacity: 0.5 } }, '\ud83d\udd17'),
              h('input', {
                style: S.bare, value: doc,
                placeholder: i === 0 ? '粘贴飞书需求文档链接' : '再贴一个飞书文档（用例 / 技术方案…）',
                onChange: setDoc(i),
              }),
              kind ? h('span', { style: S.tag }, '识别为 ' + kind) : null,
              v.docs.length > 1
                ? h('button', { style: S.smGhost, onClick: () => dropDoc(i), title: '移除' }, '\u00d7')
                : null)
          }),
          h('div', { style: S.inline },
            h('button', { style: S.smGhost, onClick: addDoc }, '+ 再加一个文档'),
            h('span', { style: { fontSize: 11, opacity: 0.42 } }, docUrls.length ? String(docUrls.length) + ' 个链接' : '可留空')),
          h('div', { style: S.note }, '支持多个飞书文档；第一个作为需求文档，其余在 intake 阶段一并拉取。')),
        h(Step, { no: 3, label: '本地项目 · 分支', on: true },
          props.projects.length === 1
            // One configured project: there is nothing to choose, so show it as
            // a settled field instead of a clickable row that cannot change.
            ? h('div', { style: Object.assign({}, S.field, { marginBottom: 10 }) },
                h('span', { style: { opacity: 0.5 } }, '项目'),
                h('span', { style: { fontWeight: 500 } }, props.projects[0].name),
                h('span', { style: { fontSize: 11, opacity: 0.4, marginLeft: 'auto', wordBreak: 'break-all', textAlign: 'right' } }, props.projects[0].path || ''),
                h('span', { style: S.tag }, '当前项目'))
            : props.projects.length > 1
              ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 } },
                  props.projects.map((p) => h('button', {
                    key: p.name,
                    onClick: () => pickProject(p.name),
                    style: projectName === p.name ? Object.assign({}, S.projRow, S.projOn) : S.projRow,
                  },
                    h('span', { style: { fontSize: 10, opacity: 0.85 } }, projectName === p.name ? '\u25cf' : '\u25cb'),
                    h('span', { style: { fontWeight: projectName === p.name ? 600 : 400 } }, p.name),
                    h('span', { style: { fontSize: 11, opacity: 0.4, marginLeft: 'auto', wordBreak: 'break-all', textAlign: 'right' } }, p.path || ''))))
              : h('div', { style: S.empty }, '配置里没有项目'),
          h('div', { style: S.inline },
            h('span', { style: { fontSize: 11, opacity: 0.5 } }, '基于'),
            branchChoices.length
              ? h('select', { style: S.select, value: v.base || branchChoices[0], onChange: set('base') },
                  branchChoices.map((name) => h('option', { key: name, value: name }, name)))
              : h('span', { style: { fontSize: 11, opacity: 0.5 } },
                  br.status === 'loading' ? '读取分支中…' : '无可用分支'),
            h('span', { style: { fontSize: 11, opacity: 0.5 } }, '新建'),
            h('input', {
              style: Object.assign({}, S.input, { flex: 1, minWidth: 220, maxWidth: 340 }),
              value: v.branch, placeholder: '留空按需求号 + 标题自动生成', onChange: set('branch'),
            })),
          br.status === 'ok' && br.current
            ? h('div', { style: S.note }, '当前在 ' + br.current + '，共 ' + String(br.local.length) + ' 个本地分支。')
            : null,
          br.status === 'error' ? h('div', { style: S.warn }, br.error) : null,
          br.blocking.length
            ? h('div', { style: S.warn },
                '工作区有 ' + String(br.blocking.length) + ' 个已跟踪文件改动，会拒绝切分支：' + br.blocking.slice(0, 3).join(' ; '))
            : null),
        h(Step, { no: 4, label: '创建分支并开始', on: true },
          h('div', { style: Object.assign({}, S.note, { marginTop: 0, fontSize: 12 }) },
            '会在 ' + (projectName || '项目') + ' 仓库里真的基于「' + (v.base || '当前分支') + '」创建分支，并在 DSH 里新开一个对话。'),
          h('div', { style: S.wizfoot },
            h('button', { style: Object.assign({}, S.primary, props.busy ? { opacity: 0.5 } : null), disabled: props.busy, onClick: submit },
              props.busy ? '创建中…' : '创建分支并新建会话'),
            h('button', { style: S.ghost, onClick: props.onCancel }, '取消'),
            h('span', { style: S.hint }, '创建后可立即跑验证'))))
    }

    function Panel() {
      const [state, setState] = useState({ status: 'idle', data: null, error: null })
      const [note, setNote] = useState(null)
      const [busy, setBusy] = useState('')
      const [creating, setCreating] = useState(false)

      const load = useCallback(() => {
        setState((prev) => Object.assign({}, prev, { status: 'loading' }))
        fetch('/delivery/api/state?workspace=' + encodeURIComponent(WORKSPACE), { headers: { accept: 'application/json' } })
          .then((r) => r.json())
          .then((d) => setState({ status: 'ok', data: d, error: null }))
          .catch((e) => setState({ status: 'error', data: null, error: String(e && e.message ? e.message : e) }))
      }, [])

      useEffect(() => { load() }, [load])

      const post = useCallback((action, extra) => {
        setBusy(action)
        return fetch('/delivery/api/action', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: action, args: Object.assign({ workspace: WORKSPACE }, extra || {}) }),
        })
          .then((r) => r.json().then((b) => ({ ok: r.ok, body: b })))
          .then((res) => {
            const failed = !res.ok || res.body.ok === false
            const err = res.body && res.body.error
            if (failed) {
              setNote({ kind: 'error', text: err ? ((err.code || 'ERROR') + ' · ' + (err.message || '')) : '执行失败' })
            } else {
              setNote({ kind: 'ok', text: String((res.body && res.body.summary) || '已完成') })
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

      const data = state.data || {}
      const projects = projectList(data.config && data.config.projects)
      const envs = (data.config && Array.isArray(data.config.envs)) ? data.config.envs : []
      const runs = Array.isArray(data.runs) ? data.runs : []
      const active = runs.filter((r) => stageOf(r) !== 'closed')
      const done = runs.filter((r) => stageOf(r) === 'closed')
      const checks = Array.isArray(data.checks) ? data.checks : []
      const loading = state.status === 'loading'
      const name = String(WORKSPACE).split('/').pop()

      return h('div', { style: S.wrap },
        h('div', { style: S.page },
          h('div', { style: S.head },
            h('h1', { style: S.h1 }, '交付流程'),
            h('span', { style: S.sub }, '需求 → 开发 → 验证 → 构建 → 部署'),
            h('span', { style: S.spacer }),
            h('span', { style: S.ws }, '工作区 · ' + name),
            h('button', { style: S.primary, onClick: () => setCreating(!creating) },
              creating ? '收起向导' : '+ 新建需求')),
          note ? h('div', {
            style: {
              fontSize: 12, padding: '9px 12px', borderRadius: 8, marginBottom: 12, whiteSpace: 'pre-line',
              border: '1px solid ' + (note.kind === 'error' ? 'rgba(220,38,38,.45)' : BORDER),
              background: note.kind === 'error' ? 'rgba(220,38,38,.08)' : 'transparent',
              opacity: note.kind === 'error' ? 1 : 0.72,
            },
          }, note.text) : null,
          creating ? h(Wizard, {
            projects: projects,
            envs: envs,
            busy: busy === 'new',
            onWarn: (text) => setNote({ kind: 'error', text: text }),
            onCancel: () => setCreating(false),
            onSubmit: (extra) => post('new', extra).then((ok) => {
              if (ok) setCreating(false)
            }),
          }) : null,
          h('div', { style: S.sectionhead }, '进行中 ', h('span', { style: S.count }, String(active.length))),
          active.length
            ? active.map((r) => h(RunCard, { key: r.id, run: r, onAction: onAction, busy: busy }))
            : h('div', { style: S.empty }, loading ? '加载中…' : '还没有进行中的交付。点右上角「+ 新建需求」。'),
          done.length ? h('div', null,
            h('div', { style: S.sectionhead }, '已完成 ', h('span', { style: S.count }, String(done.length))),
            done.map((r) => h(RunCard, { key: r.id, run: r, onAction: onAction, busy: '' }))) : null,
          h('div', { style: S.sectionhead }, '环境', h('span', { style: S.count }, state.error ? '接口异常' : '')),
          checks.length
            ? checks.map((c) => h('div', { key: c.name, style: { display: 'flex', gap: 10, fontSize: 12, padding: '2px 0', opacity: 0.72 } },
                h('span', { style: { width: 12, color: c.status === 'ok' ? OK : 'inherit' } }, c.status === 'ok' ? '\u2713' : '!'),
                h('span', { style: { minWidth: 140, opacity: 0.8 } }, c.name),
                h('span', { style: { opacity: 0.66, wordBreak: 'break-all' } }, c.detail || '')))
            : h('div', { style: S.empty }, loading ? '加载中…' : (state.error || '数据接口未接通'))))
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