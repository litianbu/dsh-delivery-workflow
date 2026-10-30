// Client half of the delivery-workflow bundle.
// Single column: the host shell already owns navigation, so this page never
// draws its own rail. Layout follows mockup/delivery-page-v2.html.
window.__ModuleLoader__.load({
  id: '@local/delivery-workflow',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React

    const WORKSPACE = '/Users/runzhili/Desktop/biomap-delivery'
    // Captured at apply() time so a run card can open an existing delivery
    // conversation through uiWorkspace.openSession. Creating a delivery stays on
    // this page; navigation is always an explicit click.
    let uiContext = null
    // Only the brand tokens below are guaranteed to exist in this shell;
    // everything else is a concrete colour that works in light and dark themes.
    const ACCENT = '#2563eb'
    const PRIMARY_BG = '#2563eb'
    // brand-primary-invert is NOT "text on brand": in this theme it resolves to
    // the same dark neutral as the fill, which made the label invisible on the
    // button. bg-base is the page background, so it always inverts the fill.
    const PRIMARY_FG = '#ffffff'
    const BORDER = 'rgba(127,127,127,.22)'
    const STRONG = 'rgba(127,127,127,.42)'
    const CHIP_BG = 'rgba(127,127,127,.12)'
    const CARD_BG = 'rgba(127,127,127,.07)'
    const FIELD_BG = 'rgba(127,127,127,.08)'
    const OK = '#16a34a'
    const OK_BG = 'rgba(22,163,74,.12)'
    const OK_BD = 'rgba(22,163,74,.45)'
    const ACCENT_BG = 'rgba(37,99,235,.12)'
    const DANGER = '#dc2626'
    const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace'

    const LABEL = {
      intake: '需求', init: '初始化', develop: '开发', verify: '验证',
      build: '构建', deploy: '部署', accept: '验收', report: '报告', closed: '归档',
    }
    const ORDER = ['intake', 'init', 'develop', 'build', 'deploy', 'accept', 'report']
    // The five stops the page draws in a card, and the phases behind each one.
    const STOPS = [
      { label: '需求', phases: ['intake'] },
      { label: '开发', phases: ['init', 'develop'] },
      { label: '构建', phases: ['build'] },
      { label: '部署', phases: ['deploy'] },
    ]
    const OPS = ['build', 'deploy']

// A build request stays open until Jenkins reports a result. The button must not
// imply the click failed, and a second click must not start a second build, so
// in-flight builds are tracked here instead of through the busy flag.
const PENDING_BUILDS = new Set()

    const S = {
      wrap: { height: '100%', minHeight: 0, overflow: 'auto', font: 'inherit', color: 'inherit', boxSizing: 'border-box' },
      page: { maxWidth: 980, margin: '0 auto', padding: '26px 32px 80px' },
      head: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22, flexWrap: 'wrap' },
      h1: { fontSize: 17, margin: 0, fontWeight: 600 },
      sub: { opacity: 0.6, fontSize: 12 },
      spacer: { flex: 1 },
      ws: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: 0.75, border: '1px solid ' + BORDER, borderRadius: 7, padding: '5px 10px', background: CARD_BG },
      primary: { font: 'inherit', fontSize: 12, padding: '6px 13px', borderRadius: 7, border: '1px solid ' + PRIMARY_BG, background: PRIMARY_BG, color: PRIMARY_FG, cursor: 'pointer', fontWeight: 500, whiteSpace: 'nowrap' },
      ghost: { font: 'inherit', fontSize: 12, padding: '6px 13px', borderRadius: 7, border: '1px solid transparent', background: 'transparent', color: 'inherit', opacity: 0.6, cursor: 'pointer' },
      sm: { font: 'inherit', fontSize: 12, padding: '4px 10px', borderRadius: 7, border: '1px solid ' + STRONG, background: CARD_BG, color: 'inherit', cursor: 'pointer' },
      smGhost: { font: 'inherit', fontSize: 12, padding: '4px 10px', borderRadius: 7, border: '1px solid transparent', background: 'transparent', color: 'inherit', opacity: 0.68, cursor: 'pointer' },
      smBtn: { font: 'inherit', fontSize: 12, padding: '4px 10px', borderRadius: 7, border: '1px solid ' + STRONG, background: FIELD_BG, color: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap', flex: '0 0 auto' },
      sectionhead: { display: 'flex', alignItems: 'center', gap: 8, margin: '26px 0 10px', fontSize: 12, opacity: 0.6 },
      count: { opacity: 0.65 },
      card: { border: '1px solid ' + BORDER, borderRadius: 10, background: CARD_BG, padding: '15px 17px', marginBottom: 12 },
      top: { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', cursor: 'pointer' },
      id: { fontFamily: mono, fontSize: 12, opacity: 0.72 },
      title: { fontSize: 14, fontWeight: 600 },
      badgeBase: { fontSize: 11, padding: '1px 8px', borderRadius: 999, border: '1px solid ' + STRONG, opacity: 0.7 },
      meta: { display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 9, opacity: 0.72, fontSize: 12 },
      code: { fontFamily: mono, background: CHIP_BG, padding: '1px 6px', borderRadius: 5 },
      docs: { display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 10 },
      doc: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '3px 9px', borderRadius: 6, border: '1px solid ' + BORDER, background: 'transparent', color: 'inherit', textDecoration: 'none' },
      docKind: { opacity: 0.6, fontSize: 11 },
      phases: { display: 'flex', alignItems: 'center', margin: '14px 0 12px', flexWrap: 'wrap' },
      bar: { width: 18, height: 1, background: STRONG, margin: '0 9px' },
      actions: { display: 'flex', gap: 7, flexWrap: 'wrap', paddingTop: 12, borderTop: '1px solid ' + BORDER, alignItems: 'center' },
      hint: { fontSize: 12, opacity: 0.6, marginLeft: 'auto' },
      empty: { fontSize: 12, opacity: 0.6, padding: '2px 0' },
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
      note: { fontSize: 11, opacity: 0.6, marginTop: 6 },
      warn: { fontSize: 11, color: DANGER, marginTop: 6 },
      inline: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      wizfoot: { display: 'flex', gap: 8, alignItems: 'center', paddingTop: 16 },
    }

    function isClosed(run) {
      return Boolean(run && (run.closed === true || run.status === 'closed'))
    }

    // The current stage is the latest phase the host is running, else the
    // furthest phase that already ended, else intake.
    //
    // "Latest" instead of "first" matters once a delivery is created: `new`
    // puts develop into running immediately, so a later intake (the same run
    // going back to read the document) would otherwise pull the card back to
    // 待开发 while the branch and the worktree already exist.
    function stageOf(run) {
      if (isClosed(run)) return 'closed'
      const phases = (run && run.phases) || {}
      let running = ''
      for (let i = 0; i < ORDER.length; i += 1) {
        const entry = phases[ORDER[i]]
        if (entry && entry.status === 'running') running = ORDER[i]
      }
      if (running) return running
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
      // `jenkins` has to survive this reshaping: the creation form prefills the
      // job from it, and dropping the field here is why the input stayed empty.
      const jobMap = (value) => (value && typeof value === 'object' && value.jenkins && typeof value.jenkins === 'object' ? value.jenkins : {})
      if (Array.isArray(raw)) {
        return raw
          .filter((item) => item && typeof item === 'object')
          .map((item, index) => ({ name: item.name || 'project-' + index, path: item.path || '', jenkins: jobMap(item) }))
      }
      if (raw && typeof raw === 'object') {
        return Object.keys(raw).map((name) => ({ name: name, path: (raw[name] && raw[name].path) || '', jenkins: jobMap(raw[name]) }))
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

    // Open the conversation a run is bound to. The shell owns navigation, so the
    // session id is handed over instead of guessing a route; a missing service is
    // reported rather than silently pretending the conversation opened.
    function openRunSession(sessionId) {
      if (!sessionId) return
      const service = uiContext
        ? (typeof uiContext.get === 'function' ? uiContext.get('uiWorkspace') : null) || uiContext.uiWorkspace
        : null
      if (!service || typeof service.openSession !== 'function') {
        console.warn('[delivery] uiWorkspace.openSession is unavailable; cannot open ' + sessionId)
        return
      }
      try {
        const pending = service.openSession(sessionId)
        if (pending && typeof pending.catch === 'function') {
          pending.catch((error) => console.warn('[delivery] openSession failed', error))
        }
      } catch (error) {
        console.warn('[delivery] openSession failed', error)
      }
    }

    // A notebook deploy runs by hand in the Kubeflow terminal, so the card can
    // only ever hold what the operator pastes back. The panel shows the exact
    // command and refuses to record an empty result: the host checks the pasted
    // text against the configured markers and decides pass or fail from that.
    function DeployPanel(props) {
      const run = props.run
      const env = run.env || 'test'
      const projects = Array.isArray(run.projects) ? run.projects : []
      // Plans are stored per project so two notebook deploys in one run keep
      // their own command. Old single-project runs only have deployPlan[env].
      const plan = (run.deployPlans && run.deployPlans[props.project] && run.deployPlans[props.project][env])
        || (projects.length === 1 && run.deployPlan ? run.deployPlan[env] : null)
      const [out, setOut] = useState('')
      const [copied, setCopied] = useState('')
      if (!plan || !plan.command) return null
      const phase = (run.phases && run.phases.deploy) || {}
      if (phase.status === 'passed') return null
      const text = String(out || '')
      const copy = () => {
        const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null
        if (!clipboard || typeof clipboard.writeText !== 'function') {
          setCopied('复制不可用，请手动选中命令')
          return
        }
        clipboard.writeText(String(plan.command))
          .then(() => setCopied('已复制'))
          .catch((e) => setCopied('复制失败：' + String((e && e.message) || e)))
      }
      const submit = () => {
        if (!text.trim()) return
        props.onAction('deploy', run, { output: text, env: env, project: props.project })
      }
      return h('div', {
        style: {
          marginTop: 12, padding: '10px 12px', border: '1px solid ' + BORDER, borderRadius: 10,
          display: 'flex', flexDirection: 'column', gap: 8,
        },
      },
        h('div', { style: { display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 12, flexWrap: 'wrap' } },
          h('span', null, '部署命令'),
          h('span', { style: S.hint }, '在 notebook 终端执行，然后把输出粘回下面')),
        h('pre', {
          style: {
            margin: 0, padding: '8px 10px', background: CHIP_BG, borderRadius: 8, fontSize: 11.5,
            fontFamily: mono, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 160, overflow: 'auto',
          },
        }, String(plan.command)),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          plan.notebookUrl
            ? h('a', { href: plan.notebookUrl, target: '_blank', rel: 'noreferrer', style: S.sm }, '打开 Notebook')
            : null,
          h('button', { style: S.sm, onClick: copy }, '复制命令'),
          copied ? h('span', { style: S.hint }, copied) : null,
          Array.isArray(plan.expect) && plan.expect.length
            ? h('span', { style: S.hint }, '成功标记：' + plan.expect.join(' | '))
            : null),
        h('textarea', {
          style: {
            width: '100%', boxSizing: 'border-box', fontFamily: mono, fontSize: 11.5, padding: '8px 10px',
            borderRadius: 8, border: '1px solid ' + BORDER, background: 'transparent', color: 'inherit', resize: 'vertical',
          },
          rows: 4,
          placeholder: '粘贴终端完整输出。没有出现成功标记不会判通过。',
          value: out,
          onChange: (event) => setOut(event.target.value),
        }),
        h('button', {
          style: Object.assign({}, S.sm, { alignSelf: 'flex-start' }, props.busy || !text.trim() ? { opacity: 0.5 } : null),
          disabled: Boolean(props.busy) || !text.trim(),
          onClick: submit,
        }, props.busy ? '记录中…' : '记录执行结果'))
    }

    function RunCard(props) {
      const run = props.run
      const stage = stageOf(run)
      const projects = Array.isArray(run.projects) ? run.projects : []
      // A multi-project run merges, builds and deploys one project at a time;
      // the chips pick which one the two buttons act on. Single-project runs
      // keep the selected value implicit and look exactly as before.
      const [project, setProject] = useState(projects[0] || '')
      const selected = projects.includes(project) ? project : (projects[0] || '')
      const multi = projects.length > 1
      const buildRecord = run.builds && run.builds[selected] ? run.builds[selected] : (projects.length === 1 ? run.build : null)
      const merging = props.busy === 'merge:' + run.id
      // Archived runs start collapsed: the archive only grows, and dozens of
      // expanded cards would bury the live work above them.
      const [open, setOpen] = useState(stage !== 'closed')
      const requirement = requirementOf(run)
      const badge = badgeOf(run, stage)
      const docs = docsOf(run)
      const live = stage !== 'closed'
      return h('div', { style: Object.assign({}, S.card, { opacity: live ? 1 : 0.72 }) },
        h('div', { style: S.top, onClick: () => setOpen(!open) },
          h('span', { style: { opacity: 0.4, fontSize: 10 } }, open ? '\u25be' : '\u25b8'),
          h('span', { style: S.id }, requirement.id || run.id || '-'),
          h('span', { style: S.title }, requirement.title || '(未命名需求)'),
          h('span', { style: badgeStyle(badge.tone) }, badge.text),
          // Archived cards start collapsed, so the delete control sits on the
          // header row; stopPropagation keeps that click from also toggling.
          !live ? h('button', {
            style: Object.assign({}, S.smGhost, { color: DANGER, fontSize: 11 }),
            onClick: (event) => {
              if (event && event.stopPropagation) event.stopPropagation()
              if (typeof window === 'undefined' || typeof window.confirm !== 'function') return
              if (window.confirm('删除交付记录 ' + run.id + '？只删除本地记录，不会删除分支、代码或开发会话，不可撤销。')) props.onAction('remove', run)
            },
          }, '删除') : null,
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
            run.merges && run.merges[selected] ? h('span', null, '合并 ',
              h('code', { style: S.code },
                (run.merges[selected].target || '-') + ' ' +
                (run.merges[selected].status === 'merged' ? '已合并'
                  : run.merges[selected].status === 'noop' ? '已包含'
                    : '待处理'))) : null,
            run.sessionId ? h('span', null, '会话 ', h('code', { style: S.code }, run.sessionId)) : null,
            stage === 'closed' && run.closedAt ? h('span', null, String(run.closedAt).slice(0, 10) + ' 手动标记完成') : null),
          h(Timeline, { run: run, stage: stage }),
          h(DeployPanel, { run: run, project: selected, busy: props.busy === 'deploy:' + run.id + ':' + selected, onAction: props.onAction }),
          live ? h('div', { style: S.actions },
            // The run already owns a conversation: this is the way back into it,
            // so in-progress work continues instead of being re-described.
            run.sessionId ? h('button', {
              style: Object.assign({}, S.sm, { background: ACCENT, borderColor: ACCENT, color: PRIMARY_FG, fontWeight: 500 }),
              onClick: (event) => {
                if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
                openRunSession(run.sessionId)
              },
            }, '打开开发会话') : null,
            multi ? h('span', { style: { display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' } },
              h('span', { style: S.hint }, '项目'),
              projects.map((name) => h('button', {
                key: name,
                style: Object.assign({}, S.sm, { fontSize: 11, padding: '4px 8px' },
                  name === selected ? { borderColor: ACCENT, color: ACCENT, fontWeight: 600 } : { opacity: 0.6 }),
                onClick: (event) => { if (event && event.stopPropagation) event.stopPropagation(); setProject(name) },
              }, name))) : null,
            // Merging is a separate step before the build: the image is fixed at
            // build time, so a merge performed during deploy could never reach
            // it. It merges every project into its own env branch and pushes; a
            // conflict is left in the working tree for a human.
            h('button', {
              style: Object.assign({}, S.sm, { fontWeight: 500 }, merging ? { opacity: 0.5 } : null),
              disabled: merging,
              title: '把当前分支合并到每个项目自己的环境分支并 push；冲突会留在工作区等待手工解决',
              onClick: () => props.onAction('merge', run),
            }, merging ? '合并中…' : '合并'),
            OPS.map((name) => {
              const busyKey = props.busy === name + ':' + run.id + ':' + selected
              // The per-project build state is the source of truth for
              // "building": it survives a refresh and only clears when Jenkins
              // reports success or failure, so a click can never start a second
              // build on top of a running one. Old runs only have run.build and
              // the phase.
              const building = name === 'build' && (buildRecord
                ? ['running', 'queued', 'started'].includes(buildRecord.status)
                : Boolean(run.phases && run.phases.build && run.phases.build.status === 'running'))
              const locked = busyKey || building
              return h('button', {
                key: name,
                style: Object.assign({}, S.sm, locked ? { opacity: 0.5 } : null),
                disabled: locked,
                onClick: () => props.onAction(name, run, { project: selected }),
              }, locked ? (name === 'build' ? '构建中…' : '执行中…') : (LABEL[name] || name))
            }),
            h('span', { style: S.hint }, '流程未结束：随时可重跑'),
            h('button', { style: S.smGhost, onClick: () => props.onAction('close', run) }, '标记完成'),
            h('button', {
              style: Object.assign({}, S.smGhost, { color: DANGER }),
              onClick: () => {
                // Deleting a record cannot be undone, so it asks first and spells
                // out what is NOT touched. Without a working confirm it refuses
                // rather than deleting silently.
                if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
                  console.warn('[delivery] window.confirm is unavailable; refusing to delete without confirmation')
                  return
                }
                const ok = window.confirm('删除交付记录 ' + run.id + '？\n\n只删除本地记录，不会删除分支、代码或开发会话。\n此操作不可撤销。')
                if (ok) props.onAction('remove', run)
              },
            }, '删除')) : null)
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
        docs: [''],
        project: '',
        env: props.envs[0] || 'test',
        base: '',
        branch: '',
        jenkinsJob: '',
        allowDirty: false,
      })
      const [br, setBr] = useState({ status: 'idle', local: [], current: '', blocking: [], error: null })

      // Fall back to the first configured project so the form is usable even
      // before the user clicks a row (and when only one project exists).
      const projectName = v.project || (props.projects[0] && props.projects[0].name) || ''

      // The picker lists what the user actually works on: projects from past runs
      // first (tagged 最近), then the remaining configured ones, each name once.
      const projectChoices = (() => {
        const seen = new Set()
        const out = []
        for (const run of (props.runs || [])) {
          for (const name of (Array.isArray(run && run.projects) ? run.projects : [])) {
            if (seen.has(name)) continue
            const found = (props.projects || []).find((p) => p.name === name)
            if (!found) continue
            seen.add(name)
            out.push({ name: name, path: found.path || '', recent: true })
          }
        }
        for (const p of (props.projects || [])) {
          if (seen.has(p.name)) continue
          seen.add(p.name)
          out.push({ name: p.name, path: p.path || '', recent: false })
        }
        return out
      })()
      const chooseProject = (name) => setV(Object.assign({}, v, { project: name, pickedPath: '', base: '' }))

      // A Jenkins job name belongs to the project, not to one requirement, so a
      // project switch carries its job into the field instead of leaving it
      // empty. Whatever the user typed is never overwritten: `autoJob` remembers
      // the value this effect filled in, and only that one is replaced.
      const autoJob = useRef({ value: '' })
      const configuredJob = (name, env) => {
        const entry = (props.projects || []).find((p) => p.name === name) || {}
        const map = entry.jenkins && typeof entry.jenkins === 'object' ? entry.jenkins : {}
        const value = map[env]
        if (typeof value === 'string') return value
        return String((value && value.job) || '')
      }
      useEffect(() => {
        const typed = String(v.jenkinsJob || '').trim()
        const untouched = !typed || v.jenkinsJob === autoJob.current.value
        const next = configuredJob(projectName, v.env)
        autoJob.current = { value: next }
        if (untouched && next !== v.jenkinsJob) setV(Object.assign({}, v, { jenkinsJob: next }))
      }, [projectName, v.env])

      useEffect(() => {
        if (!projectName) {
          setBr({ status: 'idle', local: [], current: '', blocking: [], defaultBase: '', error: null })
          return undefined
        }
        let live = true
        setBr({ status: 'loading', local: [], current: '', blocking: [], defaultBase: '', error: null })
        fetch('/delivery/api/branches?workspace=' + encodeURIComponent(WORKSPACE) + '&project=' + encodeURIComponent(projectName) + '&env=' + encodeURIComponent(v.env || 'test'))
          .then((r) => r.json().then((b) => ({ ok: r.ok, b: b })))
          .then((res) => {
            if (!live) return
            if (!res.ok || res.b.ok === false) {
              const err = (res.b && res.b.error && res.b.error.message) || '读取分支失败'
              setBr({ status: 'error', local: [], current: '', blocking: [], defaultBase: '', error: err })
              return
            }
            const local = res.b.local || []
            const fallback = res.b.defaultBase || res.b.current || local[0] || ''
            setBr({ status: 'ok', local: local, current: res.b.current || '', blocking: res.b.blocking || [], defaultBase: res.b.defaultBase || '', error: null })
            setV((prev) => (prev.base || !local.length ? prev : Object.assign({}, prev, { base: fallback })))
          })
          .catch((e) => {
            if (live) setBr({ status: 'error', local: [], current: '', blocking: [], defaultBase: '', error: String((e && e.message) || e) })
          })
        return () => { live = false }
      }, [projectName, v.env])

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
      // A directory the user picks is registered as a project first, then used
      // by name. Registering up front is what makes the later phases (branches,
      // verify, build, deploy) able to resolve it at all.
      // One code path for both entry points: the native picker and a pasted
      // path. Registering is what makes the directory resolvable by the later
      // phases, which look projects up by name in the config.
      const registerDir = async (dir) => {
        const target = String(dir || '').trim()
        if (!target) {
          setV(Object.assign({}, v, { pickError: '先填一个目录路径' }))
          return
        }
        setV(Object.assign({}, v, { picking: true, pickError: '' }))
        try {
          const res = await fetch('/delivery/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspace: WORKSPACE, path: target }),
          })
          const body = await res.json().catch(() => null)
          const err = body && body.error
          if (!res.ok || !body || body.ok === false) {
            setV(Object.assign({}, v, {
              picking: false,
              pickError: err ? String(err.code || 'ERROR') + ' · ' + String(err.message || '') : '登记项目失败',
            }))
            return
          }
          const registered = (body && body.project) || {}
          setV(Object.assign({}, v, {
            picking: false,
            pickError: '',
            pathInput: '',
            project: registered.name || '',
            pickedPath: registered.path || target,
            base: '',
          }))
        } catch (e) {
          setV(Object.assign({}, v, { picking: false, pickError: '登记项目失败：' + String((e && e.message) || e) }))
        }
      }
      const addProjectPath = () => registerDir(v.pathInput)
      const pickLocalProject = async () => {
        const service = uiContext
          ? (typeof uiContext.get === 'function' ? uiContext.get('uiWorkspace') : null) || uiContext.uiWorkspace
          : null
        if (!service || typeof service.pickDirectory !== 'function') {
          props.onWarn('当前界面不支持目录选择')
          return
        }
        let dir = null
        try {
          dir = await service.pickDirectory()
        } catch (e) {
          props.onWarn('选择目录失败：' + String((e && e.message) || e))
          return
        }
        if (!dir) return
        try {
          const res = await fetch('/delivery/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspace: WORKSPACE, path: dir }),
          })
          const body = await res.json().catch(() => null)
          const err = body && body.error
          if (!res.ok || !body || body.ok === false) {
            props.onWarn(err ? String(err.code || 'ERROR') + ' · ' + String(err.message || '') : '登记项目失败')
            return
          }
          const registered = (body && body.project) || {}
          setV(Object.assign({}, v, { project: registered.name || '', pickedPath: registered.path || dir, base: '' }))
        } catch (e) {
          props.onWarn('登记项目失败：' + String((e && e.message) || e))
        }
      }

      const docUrls = v.docs.map((item) => String(item || '').trim()).filter(Boolean)

      const submit = () => {
        if (!docUrls.length) { props.onWarn('先贴一个飞书文档'); return }
        if (!projectName) { props.onWarn('至少选一个项目'); return }
        if (br.status === 'error') { props.onWarn('读不到分支：' + br.error); return }
        const extra = {
          env: v.env || 'test',
          projects: [projectName],
          createBranch: true,
          createSession: true,
        }
        if (v.base) extra.base = v.base
        if (v.branch.trim()) extra.branch = v.branch.trim()
        const jenkinsJob = String(v.jenkinsJob || '').trim()
        if (jenkinsJob) extra.jenkinsJob = jenkinsJob
        if (v.allowDirty) extra.allowDirty = true
        if (docUrls.length) { extra.docUrls = docUrls; extra.docUrl = docUrls[0] }
        props.onSubmit(extra)
      }

      const branchChoices = br.local.length ? br.local : (br.current ? [br.current] : [])
      // 最近用过的项目做快捷入口；配置里的其余项目也要能一键选到
      const recentNames = projectChoices.filter((item) => item.recent).map((item) => item.name)
      const otherNames = projectChoices.filter((item) => !item.recent).map((item) => item.name)
      const projectPath = v.pickedPath || ((props.projects.find((p) => p.name === projectName) || {}).path || '')
      const projectChip = (name) => h('button', {
        key: name,
        style: Object.assign({}, S.smGhost, name === projectName
          ? { opacity: 1, border: '1px solid ' + ACCENT, background: ACCENT_BG, color: ACCENT }
          : null),
        onClick: () => chooseProject(name),
      }, name)

      return h('div', { style: S.wizard },
        h('h2', { style: S.wizh2 }, '新建交付'),
        h('p', { style: S.lead }, '贴飞书文档 → 选项目 → 建分支 → 开会话，四步走完开始开发。'),
        h(Step, { no: 1, label: '飞书文档', on: true },
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
            h('span', { style: { fontSize: 11, opacity: 0.6 } }, docUrls.length ? String(docUrls.length) + ' 个链接' : '必填')),
          h('div', { style: S.note }, '支持多个飞书文档；第一个作为需求文档，其余在 intake 阶段一并拉取。')),
        
        h(Step, { no: 2, label: '本地项目', on: true },
          h('div', { style: S.field },
            h('span', { style: { opacity: 0.5 } }, '📁'),
            h('span', {
              style: { flex: 1, minWidth: 0, wordBreak: 'break-all', fontSize: 12, opacity: projectPath ? 0.9 : 0.45 },
            }, projectPath || '未选择项目'),
            h('button', { style: S.smBtn, onClick: pickLocalProject }, '选择项目')),
          recentNames.length
            ? h('div', { style: S.inline },
                h('span', { style: { fontSize: 11, opacity: 0.55 } }, '最近：'),
                recentNames.map((name) => projectChip(name)))
            : null,
          otherNames.length
            ? h('div', { style: S.inline },
                h('span', { style: { fontSize: 11, opacity: 0.55 } }, '项目：'),
                otherNames.map((name) => projectChip(name)))
            : null,
          v.pickError ? h('div', { style: S.warn }, v.pickError) : null),
        h(Step, { no: 3, label: '分支', on: true },
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
                '工作区有 ' + String(br.blocking.length) + ' 个已跟踪文件改动，默认会拒绝切分支：' + br.blocking.slice(0, 3).join(' ; '),
                h('label', { style: { display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 6, cursor: 'pointer', fontWeight: 400 } },
                  h('input', {
                    type: 'checkbox', checked: Boolean(v.allowDirty),
                    onChange: (e) => setV(Object.assign({}, v, { allowDirty: e.target.checked })),
                  }),
                  h('span', {}, '带着这些改动一起切分支（不会丢弃任何改动；git 遇到冲突会直接报错）')))
            : null),
        h(Step, { no: 4, label: '部署前置', on: true },
          h('div', { style: Object.assign({}, S.note, { marginTop: 0, fontSize: 12 }) },
            '会在 ' + (projectName || '项目') + ' 仓库里真的基于「' + (v.base || '当前分支') + '」创建分支，并在 DSH 里新开一个对话。'),
          h('div', { style: S.field },
            h('span', { style: { opacity: 0.5 } }, 'Jenkins'),
            h('input', {
              style: S.bare, value: v.jenkinsJob,
              placeholder: 'Jenkins job 名，如 tongxi-test（可留空）',
              onChange: set('jenkinsJob'),
            })),
          h('div', { style: S.note },
            configuredJob(projectName, v.env)
              ? '已按项目 ' + projectName + ' 记录：' + configuredJob(projectName, v.env) + '。改了会写回 config.json，下次自动带出。'
              : '每个项目的 Jenkins job 名都不一样。这里填了会按项目名 + 环境记进 config.json，下次新建自动带出。'),
          h('div', { style: S.wizfoot },
            h('button', { style: Object.assign({}, S.primary, props.busy ? { opacity: 0.5 } : null), disabled: props.busy, onClick: submit },
              props.busy ? '创建中…' : '创建分支并新建会话'),
            h('button', { style: S.ghost, onClick: props.onCancel }, '取消'),
            h('span', { style: S.hint }, '保存后留在本页；需要开发时点交付卡片上的「打开开发会话」'))))
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

    // A failed action carries its reason in `error`, or — for a check run — in
    // summary plus the per-project details. Showing a bare "执行失败" throws the
    // one piece of information the user needs.
    const failureText = (body) => {
      const err = body && body.error
      if (err) return String(err.code || 'ERROR') + ' · ' + String(err.message || '')
      const summary = String((body && body.summary) || '').trim()
      const data = (body && body.data) || {}
      const lines = []
      if (summary) lines.push(summary)
      const details = data.details && typeof data.details === 'object' ? data.details : null
      if (details) {
        for (const name of Object.keys(details)) {
          const record = details[name] || {}
          const checks = Array.isArray(record.checks) ? record.checks : []
          for (const check of checks) {
            if (check.passed) continue
            lines.push('')
            lines.push('【' + name + ' / ' + (check.name || check.run || 'check') + '】' +
              (check.timedOut ? '超时' : '退出码 ' + check.code))
            const out = String(check.output || '').trim()
            if (out) lines.push(out.slice(-900))
          }
          if (record.checksNote) {
            lines.push('')
            lines.push('【' + name + '】' + record.checksNote)
          }
          if (record.branchOk === false) {
            lines.push('')
            lines.push('【' + name + '】分支不对：当前 ' + (record.currentBranch || '?') + '，应为 ' + (record.branch || '?'))
          }
          const secrets = record.secrets
          if (secrets && secrets.clean === false) {
            lines.push('')
            lines.push('【' + name + '】疑似密钥：' + (Array.isArray(secrets.hits) ? secrets.hits.join(', ') : String(secrets.hits)))
          }
        }
      }
      return lines.join('\n') || '执行失败（宿主没有返回原因）'
    }
      const post = useCallback((action, extra, runId, options) => {
        const silent = Boolean(options && options.silent)
        // A multi-project run builds and deploys one project at a time, so the
        // lock key carries the project: building alpha must not lock beta.
        const projectKey = extra && extra.project ? ':' + extra.project : ''
        const busyKey = runId ? action + ':' + runId + projectKey : action
        const buildKey = runId ? runId + projectKey : ''
        // A click on 构建 while Jenkins is still building is refused rather than
        // queued: the button is locked until the build reports success or
        // failure. Background polls pass silent and are exempt.
        if (!silent && action === 'build' && runId && PENDING_BUILDS.has(buildKey)) {
          setNote({ kind: 'ok', text: '构建还在进行中（Jenkins 尚未返回结果），结束后才能再次点击。' })
          return Promise.resolve({ ok: false, body: null, refused: true })
        }
        if (!silent && action === 'build' && runId) PENDING_BUILDS.add(buildKey)
        if (!silent) setBusy(busyKey)
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
              setNote({ kind: 'error', text: failureText(res.body) })
            } else {
              setNote({ kind: 'ok', text: String((res.body && res.body.summary) || '已完成') })
              // `new` returns a session id once the delivery conversation exists. A
              // missing id means the record was created without one, which is
              // worth surfacing instead of silently showing a run card.
              const created = action === 'new' ? (res.body && res.body.data && res.body.data.sessionId) : null
              const payload = (res.body && res.body.data) || {}
              if (action === 'new' && !created) {
                const why = payload.sessionError || payload.workspaceWarning || '宿主没有返回会话 id'
                setNote({ kind: 'error', text: '交付已创建，但没有创建开发会话：' + why })
              } else if (action === 'new') {
                // Creating a delivery stays on this page. The conversation is
                // ready, but navigating away automatically would hide the list
                // the user just added to; the card button opens it explicitly.
                setNote({
                  kind: 'ok',
                  text: '交付已创建，开发会话已就绪。需要继续开发时，点这张交付卡片上的「打开开发会话」。',
                })
              }
            }
            load()
            return { ok: !failed, body: res.body }
          })
          .catch((e) => {
            setNote({ kind: 'error', text: String(e && e.message ? e.message : e) })
            return { ok: false, body: null }
          })
          .finally(() => {
            if (!silent) {
              if (action === 'build' && runId) PENDING_BUILDS.delete(buildKey)
              setBusy('')
            }
          })
      }, [load])

      // A build outlives the click: the host keeps the run's build phase
      // "running" until Jenkins reports a result, and this loop notices that
      // result within a few seconds. Polling in the background is what lets the
      // button unlock by itself instead of pinning the page to one long request.
      const buildWatch = useRef({})

      const stopWatch = useCallback((key) => {
        const timer = buildWatch.current[key]
        if (timer) {
          clearTimeout(timer)
          delete buildWatch.current[key]
        }
      }, [])

      const watchBuild = useCallback((runId, hint, project) => {
        // Watches are keyed by project too: a multi-project run can have two
        // Jenkins builds in flight, each tracked by its own build URL.
        const key = runId + (project ? ':' + project : '')
        if (buildWatch.current[key]) return
        let next = hint || {}
        let misses = 0
        const tick = () => {
          buildWatch.current[key] = setTimeout(() => {
            delete buildWatch.current[key]
            // pollOnly tells the host to observe, never to start another build.
            const extra = { run: runId, waitSeconds: 0, pollOnly: true }
            if (project) extra.project = project
            if (next.buildUrl) extra.buildUrl = next.buildUrl
            if (next.queueUrl) extra.queueUrl = next.queueUrl
            post('build', extra, runId, { silent: true }).then((out) => {
              // A transient host error must not silently leave the button locked
              // at 构建中: retry a few times before giving up.
              if (!out || !out.ok) {
                misses += 1
                if (misses <= 3) tick()
                return
              }
              misses = 0
              const payload = (out.body && out.body.data) || {}
              const status = payload.status
              if (!status || status === 'success' || status === 'failed') return
              next = payload
              tick()
            })
          }, 5000)
        }
        tick()
      }, [post])

      // Resuming a build that is still running, including one left over from
      // before a page refresh: without this the locked button would never clear.
      useEffect(() => {
        const list = (state.data && state.data.runs) || []
        list.forEach((run) => {
          // Resume every in-flight project build after a refresh, not just the
          // legacy single build stored on run.build.
          const builds = run.builds && typeof run.builds === 'object' ? run.builds : {}
          let watching = false
          Object.keys(builds).forEach((project) => {
            const record = builds[project]
            if (record && ['running', 'queued', 'started'].includes(record.status)) {
              watchBuild(run.id, record, project)
              watching = true
            }
          })
          if (!watching && run.phases && run.phases.build && run.phases.build.status === 'running') {
            watchBuild(run.id, run.build || {})
          }
        })
      }, [state.data, watchBuild])

      useEffect(() => () => {
        Object.keys(buildWatch.current).forEach((key) => stopWatch(key))
      }, [stopWatch])

      const onAction = (action, run, extra) => {
        const payload = Object.assign({ run: run.id }, extra || {})
        // The click waits only long enough for Jenkins to hand back a queue or
        // build URL; the rest of the build is followed by watchBuild.
        if (action === 'build' && payload.waitSeconds == null) payload.waitSeconds = 12
        return post(action, payload, run.id).then((out) => {
          if (action === 'build' && out && out.ok) {
            const data = (out.body && out.body.data) || {}
            const status = data.status
            if (!status || status === 'running' || status === 'queued' || status === 'started') {
              const key = run.id + (payload.project ? ':' + payload.project : '')
              stopWatch(key)
              watchBuild(run.id, data, payload.project)
            }
          }
          return out
        })
      }

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
            runs: runs,
            envs: envs,
            busy: busy === 'new',
            onWarn: (text) => setNote({ kind: 'error', text: text }),
            onCancel: () => setCreating(false),
            onSubmit: (extra) => post('new', extra).then((out) => {
              if (out && out.ok) setCreating(false)
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
        uiContext = ctx
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
